// Transport plus the snapshot buffer. The room is a Supabase Realtime channel
// rather than a socket to our own server, because Vercel has nowhere to run one.
// One peer in the channel is the host and owns the simulation (see host.js);
// everyone else sends inputs and renders what comes back.
//
// Realtime's message allowance is project-wide, so the two rates that matter are
// SNAPSHOT_HZ and how often inputs go out. Inputs are sent only when the pressed
// keys actually change — holding W is one message, not sixty a second — which is
// what brings a match inside the budget.
//
// The client does not simulate: it renders a short way in the past and
// interpolates between the two snapshots straddling that moment.

import * as C from '../shared/constants.js'
import { currentBits, onInputChange } from './input.js'
import { randomCode } from './host.js'
import { supabase, enabled as supabaseEnabled } from './auth.js'

// Above one snapshot interval (1/12 s) or there is nothing to interpolate
// towards and motion stutters at the buffer's edge. Every millisecond here is a
// millisecond of input lag, so it sits just far enough clear of that floor to
// absorb ordinary jitter: raise it if Realtime is stuttering, lower it and the
// view starts running off the end of the buffer.
const INTERP_DELAY_MS = 120
const BUFFER_MAX = 24
// Generous, because giving up early is worse than waiting: the host may already
// have seated us by the time we stop listening. Measured round trips to a room
// on the far side of Realtime are well under a second; this is for a bad one.
const JOIN_TIMEOUT_MS = 10000

const buffer = [] // [{ recvAt, s }], oldest first
// The host's own sim, handed over every tick by the worker. Present rather than
// interpolated, so the host plays with no buffer delay at all.
let liveState = null
let channel = null
let host = null // the sim worker, in the tab that created the room
let seq = 0
let inputTimer = null
let lastBits = -1
let settleJoin = () => {} // replaced while a join is in flight
const cid = crypto.randomUUID()

export const handlers = {
  onJoined: () => {},
  onRoster: () => {},
  onError: () => {},
  onMatchOver: () => {},
  onClosed: () => {},
}

/**
 * Realtime is the transport, so a project must be configured for multiplayer to
 * work at all — unlike accounts, which stay optional.
 */
export const enabled = supabaseEnabled

export async function createRoom(name, team, car, mode) {
  const code = randomCode()
  await open(code)

  host = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' })
  const started = new Promise((resolve) => {
    host.onmessage = ({ data }) => {
      if (data.type === 'send') hostSend(data.event, data.payload)
      else if (data.type === 'live') liveState = data.s
      else if (data.type === 'started') resolve(data)
    }
  })
  host.postMessage({ type: 'start', code, hostName: name, hostTeam: team, hostCar: car, mode })

  const { hostId, hostTeam, roster } = await started
  handlers.onJoined({ id: hostId, code, team: hostTeam })
  handlers.onRoster(roster)
  startSendingInput()
}

export async function joinRoom(name, code, team, car) {
  await open(code)

  const settled = waitForWelcome()
  // Everything aimed at the host goes on the one 'peer' event, so host.js has a
  // single validated entry point rather than a listener per message type.
  send('peer', { t: 'hello', cid, name, team, car })
  const welcome = await settled
  if (!welcome) {
    // We may have been seated after all, by a welcome that arrived too late to
    // catch. Leaving it at that parks an undriven car in the match for the rest
    // of the game, so give the seat back before walking away.
    await close()
    return // the error has already been reported
  }

  handlers.onJoined({ id: welcome.id, code, team: welcome.team })
  startSendingInput()
}

/** Subscribe to the room's channel and wire every event we care about. */
async function open(code) {
  await close()
  channel = supabase.channel(`room:${code}`, {
    // The host must not receive its own snapshots back, and a joiner's own
    // input echo is equally useless: self defaults to false, which is what we want.
    config: { presence: { key: cid } },
  })

  channel
    .on('broadcast', { event: 'snap' }, ({ payload }) => {
      buffer.push({ recvAt: performance.now(), s: payload.s })
      while (buffer.length > BUFFER_MAX) buffer.shift()
    })
    .on('broadcast', { event: 'roster' }, ({ payload }) => handlers.onRoster(payload.players))
    .on('broadcast', { event: 'matchover' }, ({ payload }) =>
      handlers.onMatchOver(payload.score, payload.players, payload.matchId),
    )
    // Peer messages are only the host's business, and only in the host's tab.
    .on('broadcast', { event: 'peer' }, ({ payload }) =>
      host?.postMessage({ type: 'peer', payload }),
    )
    // The answer to our own hello. Bound here rather than in joinRoom because a
    // channel only registers listeners added before subscribe().
    .on('broadcast', { event: 'welcome' }, ({ payload }) => {
      if (payload.cid === cid) settleJoin(payload)
    })
    .on('broadcast', { event: 'reject' }, ({ payload }) => {
      if (payload.cid === cid) settleJoin(null, payload.reason)
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const p of leftPresences) host?.postMessage({ type: 'dropPeer', cid: p.key ?? p.cid })
    })

  return new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({ cid })
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(new Error('could not reach the room'))
      }
    })
  })
}

/**
 * A room only exists while its host is in the channel, so "no room with that
 * code" is really "nobody answered" — hence a timeout rather than a lookup.
 */
function waitForWelcome() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => settleJoin(null, 'No room with that code'), JOIN_TIMEOUT_MS)
    // The channel's listeners outlive this promise, so settleJoin is what makes
    // sure only the first answer counts.
    settleJoin = (welcome, error) => {
      clearTimeout(timer)
      settleJoin = () => {}
      if (error) handlers.onError(error)
      resolve(welcome)
    }
  })
}

/** Host only: leave the waiting phase. A peer has no host worker to tell. */
export function beginMatch() {
  host?.postMessage({ type: 'begin' })
}

/** Send the pressed keys if they have changed since the last time we looked. */
function flushInput() {
  const bits = currentBits()
  if (bits === lastBits) return
  lastBits = bits
  if (host) host.postMessage({ type: 'localBits', bits })
  else send('peer', { t: 'input', cid, seq: seq++, bits })
}

export function startSendingInput() {
  if (inputTimer) return
  // Driven off the key change, so a press goes out on the spot rather than
  // waiting up to a poll interval. Costs no extra messages: the same changes
  // are sent, just sooner.
  onInputChange(flushInput)
  // The poll stays as the backstop, for a bit that changes without a key event
  // of its own — a key held across a tab switch, or the blur handler clearing
  // one. Only a change costs a message, so an idle poll is free.
  inputTimer = setInterval(flushInput, 1000 / C.TICK_HZ)
}

function stopSendingInput() {
  onInputChange(null)
  clearInterval(inputTimer)
  inputTimer = null
  lastBits = -1
}

function send(event, payload) {
  channel?.send({ type: 'broadcast', event, payload })
}

/**
 * What the host sends. Realtime does not echo a message back to its sender, so
 * the host's own tab has to be handed everything it broadcasts or it would miss
 * its own roster and full-time panel. Snapshots are the exception: the host
 * renders liveState, which is the same sim five times fresher.
 */
function hostSend(event, payload) {
  send(event, payload)
  if (event === 'roster') {
    handlers.onRoster(payload.players)
  } else if (event === 'matchover') {
    handlers.onMatchOver(payload.score, payload.players, payload.matchId)
  }
}

export async function close() {
  stopSendingInput()
  const wasHost = Boolean(host)
  host?.postMessage({ type: 'stop' })
  host?.terminate()
  host = null

  const leaving = channel
  channel = null
  buffer.length = 0
  liveState = null
  if (!leaving) return

  // A joiner frees its seat on the way out. A host has no one to tell: the room
  // is the host, and it ends with them. The send is awaited because removing
  // the channel first would drop the goodbye and leave a parked car behind.
  if (!wasHost) await leaving.send({ type: 'broadcast', event: 'peer', payload: { t: 'bye', cid } })
  supabase.removeChannel(leaving)
}

// Leaving the tab should free the seat rather than leave a parked car behind.
// Nothing can be awaited here, so this is best effort: the host also drops a
// peer that Realtime reports as gone from the channel's presence.
addEventListener('pagehide', () => void close())

/** Interpolated view of the world, or null until two snapshots have arrived. */
export function sampleState() {
  // The host is the authority and its sim is right here, a tick old at most.
  if (liveState) return liveState
  if (buffer.length === 0) return null
  const renderAt = performance.now() - INTERP_DELAY_MS

  let older = null
  let newer = null
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].recvAt <= renderAt) {
      older = buffer[i]
      newer = buffer[i + 1] ?? null
      break
    }
  }
  // Not enough history yet, or we have fallen behind the buffer: show the newest.
  if (!older) return buffer[0].s
  if (!newer) return older.s

  const span = newer.recvAt - older.recvAt
  const t = span > 0 ? (renderAt - older.recvAt) / span : 0
  return blend(older.s, newer.s, t)
}

function blend(a, b, t) {
  const carsA = new Map(a.cars.map((c) => [c.id, c]))
  return {
    // Discrete fields come from the older snapshot so the banner and the score
    // change at the same moment the bodies do.
    tick: a.tick,
    // Named explicitly, like everything else here: a field this function does
    // not mention is a field a joiner never sees.
    mode: a.mode,
    phase: a.phase,
    phaseTimer: a.phaseTimer,
    clock: a.clock,
    overtime: a.overtime,
    score: a.score,
    lastScorer: a.lastScorer,
    ball: {
      x: lerp(a.ball.x, b.ball.x, t),
      y: lerp(a.ball.y, b.ball.y, t),
      vx: b.ball.vx,
      vy: b.ball.vy,
      freeze: b.ball.freeze,
      stuckTo: b.ball.stuckTo,
    },
    cars: b.cars.map((cb) => {
      const ca = carsA.get(cb.id)
      if (!ca) return cb // joined between snapshots
      return {
        ...cb,
        x: lerp(ca.x, cb.x, t),
        y: lerp(ca.y, cb.y, t),
        heading: lerpAngle(ca.heading, cb.heading, t),
        boost: lerp(ca.boost, cb.boost, t),
      }
    }),
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}
