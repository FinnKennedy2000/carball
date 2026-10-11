// Transport + client-side state. The room is a Supabase Realtime channel
// `room:<CODE>`; the creator's tab hosts the sim in a Web Worker (host.js), peers
// send inputs and render snapshots. Offline play is the same worker with no channel.
//
// Message budget (Realtime free tier ~100 msg/s project-wide, counting fan-out):
// the host sends SNAPSHOT_HZ snapshots/s (each delivered to every peer); a peer
// sends inputs only on change, capped at 20/s, plus a 1/s keepalive. Roster /
// welcome / matchover are a handful per match. See the NET report for numbers.
//
// The pure parts (interpolation, prediction, event dedupe) live in predict.js and
// the wire format in shared/protocol.js, both unit-tested without a browser.

import { supabase, enabled as supabaseEnabled } from './auth.js'
import { randomCode } from './host.js'
import { currentInput } from './input.js'
import { stepCar } from '../shared/sim.js'
import {
  cleanCode, cleanName, cleanTeam, cleanBody, decodeSnapshot, parseRoster, parseWelcome, parseResult,
  quantizeInput, inputChanged,
} from '../shared/protocol.js'
import {
  createBuffer, pushSnapshot, sampleBuffer, createEventQueue, acceptEvents, releaseEvents,
  createRtt, noteSent, noteAck, createPredictor,
} from './predict.js'

export const enabled = supabaseEnabled

export const handlers = {
  onJoined: () => {},
  onRoster: () => {},
  onError: () => {},
  onMatchOver: () => {},
  onClosed: () => {},
}

const INPUT_MIN_GAP_MS = 50 // <= 20 Hz
const KEEPALIVE_MS = 1000
const JOIN_TIMEOUT_MS = 10000
const HELLO_RETRY_MS = 1500
let interpDelayMs = 100

/** Render delay behind the newest snapshot. Must exceed one snapshot interval (~67 ms). */
export function setInterpDelay(ms) {
  interpDelayMs = Math.max(0, ms)
}

const cid = crypto.randomUUID()

let worker = null // host / offline only
let channel = null
let me = null // my car id
let hosting = false
let rosterList = []
let liveState = null // host: the sim's own state, zero delay
const buf = createBuffer()
const events = createEventQueue()
const rtt = createRtt()
const predictor = createPredictor(stepCar)
let renderTick = 0
let lastSampleAt = 0
let inputTimer = null
let seq = 0
let lastSent = null
let lastSentAt = 0
let settleJoin = () => {}

export const myId = () => me
export const isHost = () => hosting
export const roster = () => rosterList.slice()

// ---------- room lifecycle ----------

function spawnWorker(msg) {
  worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' })
  return new Promise((resolve) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'live') {
        liveState = data.s
        acceptEvents(events, data.events)
      } else if (data.type === 'send') hostSend(data.event, data.payload)
      else if (data.type === 'started') resolve(data)
    }
    worker.postMessage({ type: 'start', ...msg })
  })
}

/** What the host broadcasts. Realtime does not echo to the sender, so handle it locally too. */
function hostSend(event, payload) {
  channel?.send({ type: 'broadcast', event, payload })
  if (event === 'roster') {
    rosterList = parseRoster(payload) ?? rosterList
    handlers.onRoster(rosterList.slice())
  } else if (event === 'matchover') {
    const result = parseResult(payload.result)
    if (result) handlers.onMatchOver(result)
  }
}

async function startHosting(extra, code) {
  await leave()
  const started = await spawnWorker({ code, ...extra })
  hosting = true
  me = started.hostId
  rosterList = parseRoster({ players: started.roster }) ?? []
  startInputLoop()
  handlers.onJoined({ code, myId: me, isHost: true })
  handlers.onRoster(rosterList.slice())
}

const hostArgs = ({ name, team, body, teamSize }) => ({
  name: cleanName(name) ?? 'player',
  team: cleanTeam(team),
  body: cleanBody(body) ?? undefined,
  teamSize,
})

export async function createRoom(opts) {
  if (!enabled) throw new Error('Multiplayer is not configured')
  await leave()
  let code = null
  for (let attempt = 0; attempt < 3 && !code; attempt++) {
    const candidate = randomCode()
    await open(candidate, true)
    // A room is its host's presence in the channel; if one is already there, the code is taken.
    if (await presenceHasOtherHost()) await closeChannel()
    else code = candidate
  }
  if (!code) throw new Error('Could not find a free room code, try again')
  await startHosting(hostArgs(opts), code)
  return { code }
}

export async function playOffline(opts) {
  await leave()
  await startHosting(hostArgs(opts), null)
  worker.postMessage({ type: 'begin' }) // no lobby offline; harmless if the UI also calls beginMatch()
}

export async function joinRoom({ name, code, team, body }) {
  const room = cleanCode(code)
  if (!room) throw reportError(new Error('Room codes are 4 letters'))
  if (!enabled) throw reportError(new Error('Multiplayer is not configured'))
  await leave()
  try {
    await open(room, false)
  } catch (e) {
    throw reportError(e)
  }

  const hello = { t: 'hello', cid, name: cleanName(name) ?? 'player', team: cleanTeam(team), body: cleanBody(body) }
  const welcome = await new Promise((resolve) => {
    let retry = null
    const done = (w, error) => {
      clearTimeout(timer)
      clearInterval(retry)
      settleJoin = () => {}
      resolve({ w, error })
    }
    const timer = setTimeout(() => done(null, 'No room with that code'), JOIN_TIMEOUT_MS)
    settleJoin = done
    // The host may not be subscribed yet, and a hello is cheap: ask until answered.
    send('peer', hello)
    retry = setInterval(() => send('peer', hello), HELLO_RETRY_MS)
  })

  if (!welcome.w) {
    // A late welcome may already have seated us; give the seat back rather than park a car.
    await leave()
    const err = new Error(welcome.error)
    handlers.onError(err.message)
    throw err
  }
  me = welcome.w.id
  hosting = false
  startInputLoop()
  handlers.onJoined({ code: room, myId: me, isHost: false })
}

function reportError(e) {
  handlers.onError(e.message)
  return e
}

/** Host only: leave the pregame and start the countdown. */
export function beginMatch() {
  worker?.postMessage({ type: 'begin' })
}

export async function leave() {
  stopInputLoop()
  const wasHost = hosting
  if (worker) {
    if (wasHost && channel) channel.send({ type: 'broadcast', event: 'closed', payload: {} })
    worker.postMessage({ type: 'stop' })
    worker.terminate()
    worker = null
  } else if (channel) {
    // Awaited: removing the channel first would drop the goodbye and leave a parked car.
    await channel.send({ type: 'broadcast', event: 'peer', payload: { t: 'bye', cid } })
  }
  await closeChannel()
  hosting = false
  me = null
  rosterList = []
  liveState = null
  buf.snaps.length = 0
  buf.offset = null
  events.pending.length = 0
  events.lastId = -1
  predictor.reset()
  rtt.sent.clear()
  rtt.lastAck = -1
}

async function closeChannel() {
  const c = channel
  channel = null
  if (c) await supabase.removeChannel(c)
}

// Free the seat if the tab goes away. Best effort: the host also drops anyone
// Realtime reports as gone from presence.
if (typeof addEventListener !== 'undefined') addEventListener('pagehide', () => void leave())

// ---------- channel ----------

const send = (event, payload) => channel?.send({ type: 'broadcast', event, payload })

function open(code, asHost) {
  channel = supabase.channel(`room:${code}`, { config: { presence: { key: cid } } })
  const ch = channel

  ch
    .on('broadcast', { event: 'peer' }, ({ payload }) => worker?.postMessage({ type: 'peer', payload }))
    .on('broadcast', { event: 'snap' }, ({ payload }) => !worker && onSnapshot(payload?.s))
    .on('broadcast', { event: 'roster' }, ({ payload }) => {
      const players = !worker && parseRoster(payload)
      if (players) {
        rosterList = players
        handlers.onRoster(players.slice())
      }
    })
    .on('broadcast', { event: 'welcome' }, ({ payload }) => {
      const w = payload?.cid === cid && parseWelcome(payload)
      if (w) settleJoin(w)
    })
    .on('broadcast', { event: 'reject' }, ({ payload }) => {
      if (payload?.cid === cid) settleJoin(null, typeof payload.reason === 'string' ? payload.reason.slice(0, 80) : 'Could not join')
    })
    .on('broadcast', { event: 'matchover' }, ({ payload }) => {
      const result = !worker && parseResult(payload?.result)
      if (result) handlers.onMatchOver(result)
    })
    .on('broadcast', { event: 'closed' }, () => !worker && hostGone())
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const p of leftPresences) {
        if (worker) worker.postMessage({ type: 'dropPeer', cid: p.cid ?? p.key })
        else if (p.host) hostGone()
      }
    })

  return new Promise((resolve, reject) => {
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        lastSent = null // the host may hold stale input from before a reconnect
        ch.track({ cid, host: asHost })
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Could not reach the room'))
    })
  })
}

async function presenceHasOtherHost() {
  await new Promise((r) => setTimeout(r, 600)) // let the first presence sync land
  const state = channel?.presenceState() ?? {}
  return Object.entries(state).some(([key, metas]) => key !== cid && metas.some((m) => m.host))
}

let closing = false
async function hostGone() {
  if (closing || !channel) return
  closing = true
  try {
    await leave()
  } finally {
    closing = false
  }
  handlers.onClosed()
}

// ---------- snapshots (peer) ----------

function onSnapshot(raw) {
  const snap = decodeSnapshot(raw)
  if (!snap) return
  const now = performance.now()
  if (!pushSnapshot(buf, snap.state, now)) return
  acceptEvents(events, snap.events)

  if (me && me in snap.acks) noteAck(rtt, snap.acks[me], now)
  const own = snap.state.cars.find((c) => c.id === me)
  if (!own) return
  // Prediction only means anything while the car is actually being driven.
  if (snap.state.phase !== 'play') predictor.reset()
  predictor.correct(own, rtt.ms / 2000, currentInput(), snap.state)
}

function decorate(state) {
  const by = new Map(rosterList.map((p) => [p.id, p]))
  for (const c of state.cars) {
    const r = by.get(c.id)
    if (r) {
      c.name = r.name
      c.team = r.team
      c.body = r.body
      c.bot = r.bot
    }
  }
  return state
}

/** The state to draw now (ms from performance.now()), or null before anything has arrived. */
export function sampleState(nowMs = performance.now()) {
  if (liveState) return liveState // host / offline: the present, no delay

  const res = sampleBuffer(buf, nowMs, interpDelayMs)
  if (!res) return null
  renderTick = res.tick
  const dt = Math.min(0.1, Math.max(0, (nowMs - lastSampleAt) / 1000))
  lastSampleAt = nowMs

  const state = { ...res.state, cars: res.state.cars.map((c) => ({ ...c })) }
  if (res.state.phase === 'play') {
    const pred = predictor.advance(dt, currentInput(), res.state)
    const i = state.cars.findIndex((c) => c.id === me)
    if (pred && i >= 0) state.cars[i] = { ...state.cars[i], ...pred }
  }
  return decorate(state)
}

/** New events since the last call, each exactly once. Peers see them as the render clock reaches them. */
export function drainEvents() {
  return releaseEvents(events, worker ? Infinity : renderTick)
}

// ---------- input ----------

function startInputLoop() {
  stopInputLoop()
  inputTimer = setInterval(flushInput, 16)
}

function stopInputLoop() {
  clearInterval(inputTimer)
  inputTimer = null
  lastSent = null
}

function flushInput() {
  const now = performance.now()
  const input = currentInput()
  const q = quantizeInput(input)
  if (worker) {
    // The host's own input never touches the network: any change goes straight in.
    if (inputChanged(lastSent, q, 1)) {
      lastSent = q
      worker.postMessage({ type: 'input', input })
    }
    return
  }
  const due = now - lastSentAt >= INPUT_MIN_GAP_MS && inputChanged(lastSent, q)
  if (!due && now - lastSentAt < KEEPALIVE_MS) return
  lastSent = q
  lastSentAt = now
  noteSent(rtt, ++seq, now)
  send('peer', { t: 'input', cid, seq, a: q.a, b: q.b })
}
