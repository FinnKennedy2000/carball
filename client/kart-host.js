// The room authority for a race, exactly as host.js is for a match: one
// player's browser owns the only simulation, applies everyone's inputs and
// broadcasts snapshots. The same trust note applies — a host is another player,
// so parse() runs on everything that comes off the channel, and no token ever
// goes on it.
//
// The football host is not reused because almost nothing of it is about
// transport: it is teams, goals, a score and a clock. What the two share —
// the channel, the buffer, the input path — lives in net.js, which both use.

import * as C from '../shared/constants.js'
import {
  createRace,
  addKart,
  removeKart,
  begin,
  step,
  trackFor,
  TRACKS,
  RESUME_COUNT,
} from '../shared/kart.js'
import { parse } from '../shared/protocol.js'

const HOST_CID = ' host'
const MAX_CATCHUP_STEPS = 3
// The field is filled out with AI so a two-player room is still a race.
const GRID = 6
const AI_NAMES = ['Bolt', 'Ripsaw', 'Comet', 'Nitro', 'Sledge']
const AI_ID_BASE = 1000

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 32) >>> 0
}

/**
 * An empty race on one of the maps. Dealt off the same seed the race is unless
 * the host has pinned one, and either way the choice rides in the snapshot so
 * the peers draw the road their host is simulating.
 *
 * `avoid` is only about not dealing the same random map twice running, so it has
 * no say once someone has chosen: a host who asks for Foundry every race gets
 * Foundry every race. Anything unrecognised is treated as no choice at all.
 */
function freshRace(avoid = null, pinned = null) {
  const seed = randomSeed()
  const track = TRACKS[pinned] ? pinned : trackFor(seed, avoid)
  return createRace([], seed, track)
}

export function startKartHost({ send, live = () => {}, hostName, hostChassis }) {
  let state = freshRace()
  const players = new Map() // cid -> { id, name, bits }
  let nextId = 1
  let timer = null
  let accumulator = 0
  let lastTickAt = 0
  let ticksSinceSnapshot = 0
  let announced = false

  const host = seat(HOST_CID, hostName, hostChassis)

  function seat(cid, name, chassis) {
    // `seq` is the last input of theirs this sim has actually applied. It goes
    // back out in the snapshot so a peer predicting its own kart knows which of
    // its keypresses are already baked into the state it is predicting from,
    // and replays only the ones that are not.
    const player = { id: nextId++, cid, name, chassis, bits: 0, seq: -1 }
    players.set(cid, player)
    // Only before the lights: a race in progress is not somewhere to drop a new
    // kart, so a late arrival waits in the room and starts the next one.
    if (state.phase === 'WAITING') addKart(state, { id: player.id, name, chassis })
    return player
  }

  function roster() {
    return [...players.values()].map((p) => ({ id: p.id, name: p.name, team: 0, car: 0 }))
  }

  function broadcastRoster() {
    send('roster', { players: roster() })
  }

  function onPeerMessage(raw) {
    const msg = parse(raw)
    if (!msg || msg.cid === HOST_CID) return

    if (msg.t === 'hello') {
      const existing = players.get(msg.cid)
      // Realtime redelivers on reconnect: a repeated hello is a re-announce.
      if (existing) {
        send('welcome', { cid: msg.cid, id: existing.id, code: null, team: 0 })
        broadcastRoster()
        return
      }
      if (players.size >= C.MAX_PLAYERS) {
        send('reject', { cid: msg.cid, reason: 'Room is full' })
        return
      }
      const player = seat(msg.cid, msg.name, msg.chassis)
      send('welcome', { cid: msg.cid, id: player.id, code: null, team: 0 })
      broadcastRoster()
      return
    }

    if (msg.t === 'input') {
      const player = players.get(msg.cid)
      // Realtime delivers in order over one connection, so a lower seq than the
      // one already applied is a redelivery rather than news.
      if (player && msg.seq > player.seq) {
        player.bits = msg.bits
        player.seq = msg.seq
      }
      return
    }

    if (msg.t === 'pause') {
      const player = players.get(msg.cid)
      if (player) pause(msg.on, player.name)
      return
    }

    if (msg.t === 'bye') drop(msg.cid)
  }

  function drop(cid) {
    const player = players.get(cid)
    if (!player) return
    players.delete(cid)
    // A kart left behind would sit on the grid blocking it, and would be placed
    // in a race nobody is driving it in.
    removeKart(state, player.id)
    broadcastRoster()
  }

  /**
   * Stop the race, or start it again. Anyone in the room may ask, so this is the
   * one place it happens — and the name comes with it, because a race that has
   * stopped for no visible reason reads as the room having broken.
   */
  function pause(on, byName) {
    const was = state.paused
    state.paused = Boolean(on)
    state.pausedBy = state.paused ? byName : null
    // Only on the way back, and only into a race that was actually running: the
    // grid has a countdown of its own and does not need a second one.
    if (was && !state.paused && state.phase === 'RACE') state.resumeIn = RESUME_COUNT
    // The clock the tick loop catches up from. Left alone, coming back off a
    // pause hands step() the whole stopped duration as one enormous frame.
    lastTickAt = Date.now()
    accumulator = 0
  }

  /** A fresh race with everyone in the room, the field filled out with AI. */
  function beginRace(pinned = null) {
    state = freshRace(state.track, pinned)
    for (const p of players.values()) addKart(state, { id: p.id, name: p.name, chassis: p.chassis })
    for (let i = 0; state.karts.length < GRID && i < AI_NAMES.length; i++) {
      addKart(state, { id: AI_ID_BASE + i, name: AI_NAMES[i], ai: true })
    }
    announced = false
    begin(state)
  }

  function pump() {
    const now = Date.now()
    accumulator += (now - lastTickAt) / 1000
    lastTickAt = now

    let steps = 0
    while (accumulator >= C.DT && steps < MAX_CATCHUP_STEPS) {
      tick()
      accumulator -= C.DT
      steps++
    }
    if (accumulator >= C.DT) accumulator = 0
  }

  function tick() {
    const inputs = {}
    for (const p of players.values()) inputs[p.id] = p.bits
    step(state, inputs)

    if (state.phase === 'OVER' && !announced) {
      announced = true
      // Finish order is the result, and first is the winner. Whoever did not
      // cross before the flag is placed on how far they got, and has no time.
      send('matchover', {
        matchId: crypto.randomUUID(),
        score: null,
        players: [...state.karts]
          .sort((a, b) => a.place - b.place)
          .map((k) => ({ id: k.id, name: k.name, place: k.place, time: k.finished, ai: k.ai })),
      })
    }

    live(state)
    ticksSinceSnapshot++
    if (ticksSinceSnapshot >= C.TICK_HZ / C.SNAPSHOT_HZ) {
      ticksSinceSnapshot = 0
      send('snap', { s: snapshot() })
    }
  }

  /**
   * The state, minus what a peer can work out for itself: an item box never
   * moves, so only its cooldown travels. Everything else goes as it is.
   */
  function snapshot() {
    // Which input each kart's state includes, by the seq the peer sent with it.
    // Cheap enough to be free — a handful of integers on a payload measured in
    // kilobytes — and it is what makes a peer's own-kart prediction exact
    // rather than approximate.
    const acks = {}
    for (const p of players.values()) acks[p.id] = p.seq
    return { ...state, boxes: state.boxes.map((b) => b.cooldown), acks }
  }

  lastTickAt = Date.now()
  timer = setInterval(pump, 1000 / C.TICK_HZ)

  return {
    hostId: host.id,
    hostTeam: 0,
    roster,
    onPeerMessage,
    /**
     * Start the lights, or start the next race once one is over. `pinned` is the
     * map the host asked for, or nothing for a random one.
     */
    begin: beginRace,
    /** Stop the race for the whole room, or start it again. */
    setPaused: pause,
    setLocalBits: (bits) => {
      host.bits = bits
    },
    dropPeer: drop,
    stop: () => {
      clearInterval(timer)
      timer = null
    },
  }
}
