// The room creator's browser is the authority (this runs inside sim-worker.js).
// It owns the only simulation, applies everyone's inputs at a fixed 60 Hz, and
// broadcasts quantised snapshots. Offline play is the same thing with `send` as a
// no-op: one code path.
//
// TRUST: a host is another player, so nothing here is a real security boundary,
// but parse() runs on every peer message so hostile payloads cannot crash the match.
// The host leaving ends the room; no host migration.

import * as C from '../shared/constants.js'
import {
  createMatch, addPlayer, removePlayer, setInput, step, startMatch, fillBots, snapshot, NEUTRAL_INPUT,
} from '../shared/sim.js'
import { parse, cleanBody, encodeSnapshot, dequantizeInput } from '../shared/protocol.js'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no O/I: codes get read aloud
const MAX_CATCHUP_STEPS = 5
const STALE_INPUT_MS = 3000 // keepalive is 1 Hz; silence this long means a stuck key or a dead tab
const SNAP_EVERY = Math.max(1, Math.round(C.TICK_HZ / C.SNAPSHOT_HZ))

export function randomCode() {
  let out = ''
  for (let i = 0; i < 4; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

export function startHost({
  code,
  hostCid = null,
  send = () => {},
  live = () => {},
  onFatal = () => {},
  name,
  team,
  body,
  teamSize = 3,
  seed = (Math.random() * 2 ** 32) >>> 0,
}) {
  teamSize = Math.min(Math.max(1, teamSize | 0), C.MAX_PLAYERS / 2)
  const capacity = teamSize * 2
  const state = createMatch({ teamSize, seed })
  const players = new Map() // cid -> { id, cid, name, team, body, input, seq, lastMsg, host }
  let nextId = 1
  let timer = null
  let accumulator = 0
  let lastAt = 0
  let ticks = 0
  let pumpEvents = []
  let recentEvents = [[], []] // events of the last two snapshots, resent so one loss is harmless

  const HOST_CID = ' host' // cannot collide: parse() produces no cid with a leading space
  const hostPlayer = seat(HOST_CID, name, team, body, true)
  fillBots(state)

  function humansOn(t) {
    let n = 0
    for (const p of players.values()) if (p.team === t) n++
    return n
  }

  function seat(cid, pname, want, pbody, isHost = false) {
    const side = want !== null && want !== undefined && humansOn(want) < teamSize ? want : humansOn(0) <= humansOn(1) ? 0 : 1
    const id = `p${nextId++}`
    // A bot holds the slot this human is taking.
    const bot = state.cars.find((c) => c.bot && c.team === side)
    if (bot) removePlayer(state, bot.id)
    const player = {
      id, cid, name: pname, team: side, body: cleanBody(pbody) ?? undefined, input: NEUTRAL_INPUT,
      seq: 0, lastMsg: Date.now(), host: isHost,
    }
    players.set(cid, player)
    addPlayer(state, { id, name: pname, team: side, body: player.body, bot: false })
    return player
  }

  function roster() {
    // Read from the sim so bots appear with the names/bodies the sim gave them.
    return state.cars.map((c) => ({
      id: c.id, name: c.name, team: c.team, body: c.body, bot: !!c.bot, host: c.id === hostPlayer.id,
    }))
  }
  const broadcastRoster = () => send('roster', { players: roster(), teamSize })

  function onPeerMessage(raw) {
    const msg = parse(raw)
    if (!msg || msg.cid === HOST_CID) return

    if (msg.t === 'hello') {
      const existing = players.get(msg.cid)
      // Realtime redelivers and joiners retry; a repeat is a re-announce, not a second seat.
      if (existing) {
        send('welcome', { cid: msg.cid, id: existing.id, code, team: existing.team, host: hostCid })
        return
      }
      if (players.size >= capacity) {
        send('reject', { cid: msg.cid, reason: 'Room is full' })
        return
      }
      const p = seat(msg.cid, msg.name, msg.team, msg.body)
      send('welcome', { cid: msg.cid, id: p.id, code, team: p.team, host: hostCid })
      broadcastRoster()
    } else if (msg.t === 'input') {
      const p = players.get(msg.cid)
      // seq may repeat after a reconnect; only the newest input matters.
      if (p && msg.seq >= p.seq) {
        p.seq = msg.seq
        p.input = dequantizeInput(msg)
        p.lastMsg = Date.now()
      }
    } else if (msg.t === 'bye') drop(msg.cid)
  }

  function drop(cid) {
    const p = players.get(cid)
    if (!p || p.host) return
    players.delete(cid)
    removePlayer(state, p.id)
    fillBots(state)
    broadcastRoster()
  }

  function result() {
    const ev = state.events.find((e) => e.type === 'matchOver')
    return {
      score: state.score.slice(),
      winner: ev.winner,
      mvpId: ev.mvpId ?? null,
      players: state.cars.map((c) => ({ id: c.id, name: c.name, team: c.team, bot: !!c.bot, stats: { ...c.stats } })),
    }
  }

  function tick() {
    const now = Date.now()
    for (const p of players.values()) {
      setInput(state, p.id, !p.host && now - p.lastMsg > STALE_INPUT_MS ? NEUTRAL_INPUT : p.input)
    }
    step(state)

    const events = state.events
    if (events.some((e) => e.type === 'matchOver')) send('matchover', { result: result() })

    ticks++
    pumpEvents.push(...events)
    recentEvents[0].push(...events)
    if (ticks % SNAP_EVERY === 0) {
      const acks = {}
      for (const p of players.values()) acks[p.id] = p.seq
      send('snap', { s: encodeSnapshot(state, acks, recentEvents.flat()) })
      recentEvents = [[], recentEvents[0]]
    }
  }

  function pump() {
    try {
      pumpSteps()
    } catch (err) {
      clearInterval(timer)
      timer = null
      onFatal(err)
    }
  }

  function pumpSteps() {
    const now = performance.now()
    accumulator += (now - lastAt) / 1000
    lastAt = now
    let steps = 0
    while (accumulator >= C.DT && steps < MAX_CATCHUP_STEPS) {
      tick()
      accumulator -= C.DT
      steps++
    }
    if (accumulator >= C.DT) accumulator = 0 // fell too far behind; drop the debt
    // One state per pump, after catch-up: the main thread interpolates between these.
    // Events from every tick of the pump ride along, in order.
    if (steps > 0) live(snapshot(state), pumpEvents)
    pumpEvents = []
  }

  lastAt = performance.now()
  timer = setInterval(pump, 1000 / C.TICK_HZ)

  return {
    hostId: hostPlayer.id,
    hostTeam: hostPlayer.team,
    roster,
    onPeerMessage,
    begin: () => {
      if (state.phase === 'pregame') startMatch(state)
    },
    /** The host's own input never goes over the wire. */
    setLocalInput: (input) => {
      hostPlayer.input = input
    },
    dropPeer: drop,
    stop: () => {
      clearInterval(timer)
      timer = null
    },
  }
}
