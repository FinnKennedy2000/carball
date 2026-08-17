// A room owns one simulation and the sockets watching it. Rooms are created on
// demand and deleted when the last player leaves; nothing is persisted.

import { randomUUID } from 'node:crypto'

import * as C from '../shared/constants.js'
import { createState, addCar, removeCar, resetPositions, step } from '../shared/sim.js'
import { recordMatch } from './accounts.js'

// No O/0 or I/1 — codes get read aloud and typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const MAX_CATCHUP_STEPS = 3

export class Room {
  constructor(code, onEmpty) {
    this.code = code
    this.onEmpty = onEmpty
    this.state = createState()
    this.players = new Map() // id -> { id, name, socket, bits }
    this.nextId = 1
    this.timer = null
    this.accumulator = 0
    this.lastTickAt = 0
    this.ticksSinceSnapshot = 0
  }

  get full() {
    return this.players.size >= C.MAX_PLAYERS
  }

  /**
   * `identity` is the verified account for this socket, or null for a guest. A
   * signed-in player's name comes from it, not from the client's own claim.
   */
  join(socket, name, wanted = null, identity = null) {
    const id = this.nextId++
    // A requested side is honoured unless it is already full; otherwise balance.
    const team =
      wanted !== null && this.teamCount(wanted) < C.MAX_PER_TEAM ? wanted : this.smallestTeam()
    // team is kept on the player so a rematch does not reshuffle the sides.
    // goals accumulate across the match for the stats row written at the end.
    const player = {
      id,
      name: identity?.username ?? name,
      socket,
      team,
      bits: 0,
      userId: identity?.userId ?? null,
      goals: 0,
    }
    this.players.set(id, player)
    addCar(this.state, id, team)

    send(socket, { t: 'joined', id, code: this.code, team, name: player.name, signedIn: Boolean(identity) })
    this.broadcastRoster()
    if (!this.timer) this.start()
    return player
  }

  leave(id) {
    if (!this.players.delete(id)) return
    removeCar(this.state, id)
    if (this.players.size === 0) {
      this.stop()
      this.onEmpty(this.code)
      return
    }
    this.broadcastRoster()
  }

  setInput(id, bits) {
    const player = this.players.get(id)
    // Only the latest input matters. A late packet is corrected by the next one.
    if (player) player.bits = bits
  }

  teamCount(team) {
    let n = 0
    for (const car of this.state.cars) if (car.team === team) n++
    return n
  }

  smallestTeam() {
    const blue = this.teamCount(C.TEAM_BLUE)
    return blue <= this.state.cars.length - blue ? C.TEAM_BLUE : C.TEAM_ORANGE
  }

  start() {
    this.lastTickAt = Date.now()
    this.timer = setInterval(() => this.pump(), 1000 / C.TICK_HZ)
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
  }

  /** Drain elapsed real time into fixed ticks, with a cap so a stall cannot death-spiral. */
  pump() {
    const now = Date.now()
    this.accumulator += (now - this.lastTickAt) / 1000
    this.lastTickAt = now

    let steps = 0
    while (this.accumulator >= C.DT && steps < MAX_CATCHUP_STEPS) {
      this.tick()
      this.accumulator -= C.DT
      steps++
    }
    if (this.accumulator >= C.DT) this.accumulator = 0 // fell too far behind; drop the debt
  }

  tick() {
    const inputs = {}
    for (const p of this.players.values()) inputs[p.id] = p.bits

    const before = this.state.score[0] + this.state.score[1]
    const wasOver = this.state.phase === 'OVER'
    step(this.state, inputs)
    if (this.state.score[0] + this.state.score[1] > before) this.creditGoal()

    // Full time is announced the moment it happens, so the panel is up for the
    // whole OVER phase rather than arriving with the next kickoff.
    if (!wasOver && this.state.phase === 'OVER') this.announceFullTime()
    // Let the final score sit on screen before the next match starts.
    if (this.state.phase === 'OVER' && this.state.phaseTimer <= 0) this.restart()

    this.ticksSinceSnapshot++
    if (this.ticksSinceSnapshot >= C.TICK_HZ / C.SNAPSHOT_HZ) {
      this.ticksSinceSnapshot = 0
      this.broadcast({ t: 'snap', s: this.state })
    }
  }

  /** The sim names the car that earned the goal, or nobody for an own goal. */
  creditGoal() {
    const scorer = this.players.get(this.state.lastScorer)
    if (scorer) scorer.goals++
  }

  /** The final score plus who scored what, for the full-time panel. */
  announceFullTime() {
    this.broadcast({
      t: 'matchover',
      score: this.state.score.slice(),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        goals: p.goals,
      })),
    })
  }

  restart() {
    const finalScore = this.state.score.slice()
    // Written before the state is thrown away. Deliberately not awaited: a slow
    // or failing database must not stall the tick loop.
    recordMatch(randomUUID(), finalScore, [...this.players.values()])
    for (const p of this.players.values()) p.goals = 0
    this.state = createState()
    for (const p of this.players.values()) addCar(this.state, p.id, p.team)
    resetPositions(this.state)
  }

  broadcastRoster() {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      signedIn: Boolean(p.userId),
    }))
    this.broadcast({ t: 'roster', players })
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg)
    for (const p of this.players.values()) send(p.socket, payload)
  }
}

export class Rooms {
  constructor() {
    this.byCode = new Map()
  }

  create() {
    let code
    do {
      code = randomCode()
    } while (this.byCode.has(code))
    const room = new Room(code, (c) => this.byCode.delete(c))
    this.byCode.set(code, room)
    return room
  }

  get(code) {
    return this.byCode.get(code) ?? null
  }
}

function randomCode() {
  let out = ''
  for (let i = 0; i < 4; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

function send(socket, msg) {
  if (socket.readyState !== 1) return // not OPEN
  socket.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
}
