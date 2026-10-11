// Authoritative match simulation. Pure data in, pure data out: no Date, no Math.random.
// Physics lives in shared/physics/*; this file owns phases, scoring, events and stats.
import * as C from './constants.js'
import { ARENA, BOOST_PADS, inGoal } from './arena.js'
import { CARS, DEFAULT_CAR } from './cars.js'
import { stepCar as physStepCar, hitboxOf } from './physics/car.js'
import { stepBall, carHitsBall } from './physics/ball.js'
import { botInput } from './bot.js'
import { qyaw, qrot, dot, len, clamp } from './physics/math.js'

export const NEUTRAL_INPUT = Object.freeze({
  thr: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false,
})

/** Client prediction entry point: car-only physics + arena collision. Mutates `car`. */
export function stepCar(car, input, dt = C.DT, _state) {
  return physStepCar(car, input, dt)
}

const BOT_NAMES = ['Apex', 'Blitz', 'Cinder', 'Dash', 'Echo', 'Flux', 'Gizmo', 'Havoc', 'Ion', 'Jolt', 'Kilo', 'Nova']
// kickoff slots for blue (x, z); orange is the point-mirror
const SLOTS = [[-20.48, -25.6], [20.48, -25.6], [0, -46.08]]
const TOUCH_MEMORY = 5 * C.TICK_HZ

function rand(state) { // mulberry32
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function emit(state, type, fields) {
  const e = { id: state.nextEventId++, type, tick: state.tick, ...fields }
  state.events.push(e)
  return e
}

export function createMatch({ teamSize = 3, seed = 1 } = {}) {
  return {
    tick: 0, phase: 'pregame', phaseT: 0, clock: C.MATCH_SECONDS, overtime: false,
    score: [0, 0], teamSize: clamp(teamSize | 0, 1, C.MAX_PLAYERS / 2),
    ball: { p: [0, C.BALL_R, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0] },
    cars: [], pads: BOOST_PADS.map(() => true), padT: BOOST_PADS.map(() => 0),
    lastTouch: null, events: [], nextEventId: 0,
    inputs: {}, touches: [], rng: seed >>> 0, botSeq: 0, cdN: 3, threat: -1, threatBy: null,
  }
}

function makeCar({ id, name, team, body, bot }) {
  return {
    id: String(id), name: name ?? String(id), team: team === 1 ? 1 : 0, body: CARS[body] ? body : DEFAULT_CAR, bot: !!bot,
    p: [0, 1, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0],
    boost: C.BOOST_START, onGround: true, onWall: false, boosting: false, supersonic: false,
    dodging: false, jumped: false, doubleJumped: false, demolished: 0,
    stats: { score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0 },
  }
}

function spawn(state, car, slotIdx) {
  const [sx, sz] = SLOTS[slotIdx % SLOTS.length]
  const m = car.team === 0 ? 1 : -1
  const x = sx * m, z = sz * m
  car.p = [x, hitboxOf(car)[1] / 2 + 0.02, z]
  car.v = [0, 0, 0]; car.w = [0, 0, 0]
  car.q = qyaw(Math.atan2(-x, -z))
  car.boost = C.BOOST_START
  Object.assign(car, { onGround: true, onWall: false, boosting: false, supersonic: false, dodging: false, jumped: false, doubleJumped: false, demolished: 0, dodgeT: 0, jumpT: 0, pj: undefined })
}

function resetPositions(state) {
  for (const team of [0, 1]) {
    const order = [0, 1, 2]
    for (let i = 2; i > 0; i--) { const j = Math.floor(rand(state) * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    let k = 0
    for (const c of state.cars) if (c.team === team) spawn(state, c, order[k++ % 3])
  }
  state.ball = { p: [0, C.BALL_R, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0] }
  state.pads.fill(true); state.padT.fill(0)
  state.lastTouch = null; state.touches = []; state.threat = -1; state.threatBy = null
}

export function addPlayer(state, { id, name, team, body, bot = false }) {
  const car = makeCar({ id, name, team, body, bot })
  state.cars.push(car)
  state.inputs[car.id] = NEUTRAL_INPUT
  spawn(state, car, state.cars.filter((c) => c.team === car.team).length - 1)
  return car
}

export function removePlayer(state, id) {
  state.cars = state.cars.filter((c) => c.id !== id)
  delete state.inputs[id]
  state.touches = state.touches.filter((t) => t.id !== id)
  if (state.lastTouch === id) state.lastTouch = null
}

const num = (x) => (Number.isFinite(x) ? clamp(x, -1, 1) : 0)
export function setInput(state, id, i) {
  if (!i) return
  state.inputs[id] = {
    thr: num(i.thr), steer: num(i.steer), pitch: num(i.pitch), yaw: num(i.yaw), roll: num(i.roll),
    jump: !!i.jump, boost: !!i.boost, handbrake: !!i.handbrake,
  }
}

export function fillBots(state) {
  for (const team of [0, 1]) {
    let n = state.cars.filter((c) => c.team === team).length
    while (n++ < state.teamSize) {
      const k = state.botSeq++
      addPlayer(state, { id: `bot-${k}`, name: BOT_NAMES[k % BOT_NAMES.length] + (k >= BOT_NAMES.length ? ` ${Math.floor(k / BOT_NAMES.length) + 1}` : ''), team, body: Object.keys(CARS)[k % Object.keys(CARS).length], bot: true })
    }
  }
}

export function startMatch(state) {
  if (state.phase !== 'pregame') return
  state.score = [0, 0]; state.clock = C.MATCH_SECONDS; state.overtime = false
  beginCountdown(state)
}

function beginCountdown(state) {
  resetPositions(state)
  state.phase = 'countdown'; state.phaseT = C.COUNTDOWN_SECONDS; state.cdN = C.COUNTDOWN_SECONDS
  emit(state, 'countdown', { n: state.cdN })
}

const carById = (state, id) => state.cars.find((c) => c.id === id)

/** Which team's goal (0/1) is the ball on course to enter, ignoring everything but gravity? -1 = none. */
function shotThreat(ball) {
  const vz = ball.v[2]
  if (Math.abs(vz) < 8) return -1
  const gz = vz > 0 ? ARENA.halfLength : -ARENA.halfLength
  const t = (gz - ball.p[2]) / vz
  if (t <= 0 || t > 3) return -1
  const x = ball.p[0] + ball.v[0] * t, y = ball.p[1] + ball.v[1] * t - 0.5 * C.GRAVITY * t * t
  if (Math.abs(x) > ARENA.goal.halfWidth + 1 || y < 0 || y > ARENA.goal.height) return -1
  return vz > 0 ? 1 : 0 // team whose goal it is
}

function award(car, key, pts) { car.stats[key]++; car.stats.score += pts }

function onTouch(state, car, strength) {
  const t = state.touches
  if (state.lastTouch !== car.id) t.push({ id: car.id, team: car.team, tick: state.tick })
  else t[t.length - 1].tick = state.tick
  if (t.length > 6) t.shift()
  state.lastTouch = car.id
  const before = state.threat, after = shotThreat(state.ball)
  if (before === car.team && after !== car.team && state.threatBy !== car.team) { award(car, 'saves', C.POINTS.save); emit(state, 'save', { carId: car.id }) }
  if (after === 1 - car.team && before !== after) { award(car, 'shots', C.POINTS.shot); emit(state, 'shot', { carId: car.id }) }
  state.threat = after; state.threatBy = after >= 0 ? car.team : null
  if (strength > 0.08) emit(state, 'hit', { carId: car.id, strength, p: state.ball.p.slice() })
}

function goalScored(state, conceded) {
  const team = 1 - conceded
  const b = state.ball
  state.score[team]++
  let scorerId = state.lastTouch, assistId = null
  const last = carById(state, scorerId)
  if (last && last.team === team) {
    award(last, 'goals', C.POINTS.goal)
    const prev = [...state.touches].reverse().find((x) => x.id !== scorerId)
    if (prev && prev.team === team && state.tick - prev.tick < TOUCH_MEMORY) {
      const a = carById(state, prev.id)
      if (a) { award(a, 'assists', C.POINTS.assist); assistId = a.id }
    }
  }
  emit(state, 'goal', { team, scorerId, assistId, speed: len(b.v) * 3.6, p: b.p.slice() })
  state.phase = 'goal'; state.phaseT = C.GOAL_SECONDS
}

function endMatch(state) {
  const [a, b] = state.score
  const winner = a > b ? 0 : b > a ? 1 : 0
  const pool = state.cars.filter((c) => c.team === winner)
  pool.sort((x, y) => y.stats.score - x.stats.score || y.stats.goals - x.stats.goals)
  state.phase = 'over'; state.phaseT = 0
  emit(state, 'matchOver', { winner, mvpId: pool[0]?.id ?? null })
}

function padPickups(state, car) {
  if (car.boost >= C.BOOST_MAX || car.p[1] > 4) return
  for (let i = 0; i < BOOST_PADS.length; i++) {
    if (!state.pads[i]) continue
    const pad = BOOST_PADS[i]
    const r = pad.big ? C.PAD_BIG_R : C.PAD_SMALL_R
    const dx = car.p[0] - pad.p[0], dz = car.p[2] - pad.p[2]
    if (dx * dx + dz * dz > r * r) continue
    car.boost = Math.min(C.BOOST_MAX, car.boost + (pad.big ? C.PAD_BIG : C.PAD_SMALL))
    state.pads[i] = false; state.padT[i] = pad.big ? C.PAD_BIG_RESPAWN : C.PAD_SMALL_RESPAWN
    emit(state, 'boostPickup', { carId: car.id, pad: i, big: pad.big })
    if (car.boost >= C.BOOST_MAX) return
  }
}

function carVsCar(state, a, b) {
  const [aw, , al] = hitboxOf(a), [bw, , bl] = hitboxOf(b)
  const ra = aw / 2, rb = bw / 2
  const fa = qrot(a.q, [0, 0, 1]), fb = qrot(b.q, [0, 0, 1])
  let best = null, bestPen = 0
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const o1 = sa * (al / 2 - ra), o2 = sb * (bl / 2 - rb)
    const d = [b.p[0] + fb[0] * o2 - a.p[0] - fa[0] * o1, b.p[1] + fb[1] * o2 - a.p[1] - fa[1] * o1, b.p[2] + fb[2] * o2 - a.p[2] - fa[2] * o1]
    const dist = Math.hypot(d[0], d[1], d[2])
    const pen = ra + rb - dist
    if (pen > bestPen) { bestPen = pen; best = d.map((x) => x / (dist || 1)) }
  }
  if (!best) return
  const n = best // from a to b
  const vn = dot([b.v[0] - a.v[0], b.v[1] - a.v[1], b.v[2] - a.v[2]], n)
  const mid = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2]
  for (let i = 0; i < 3; i++) { a.p[i] -= n[i] * bestPen / 2; b.p[i] += n[i] * bestPen / 2 }
  // demolition: a supersonic car ramming an opponent
  if (a.team !== b.team) {
    const closeA = dot(a.v, n), closeB = -dot(b.v, n)
    const [att, vic, close] = closeA >= closeB ? [a, b, closeA] : [b, a, closeB]
    if (att.supersonic && close > 6) {
      vic.demolished = C.RESPAWN_SECONDS; vic.v = [0, 0, 0]; vic.w = [0, 0, 0]; vic.boosting = false; vic.supersonic = false
      award(att, 'demos', C.POINTS.demo)
      emit(state, 'demo', { attackerId: att.id, victimId: vic.id, p: mid })
      return
    }
  }
  if (vn < 0) {
    const j = (-(1 + C.BUMP_RESTITUTION) * vn) / 2
    for (let i = 0; i < 3; i++) { a.v[i] -= n[i] * j; b.v[i] += n[i] * j }
    if (-vn > 3) emit(state, 'bump', { carId: a.id, otherId: b.id, strength: clamp(-vn / 30, 0, 1) })
  }
}

export function step(state) {
  const dt = C.DT
  state.events = []
  state.tick++
  const { phase } = state

  // ---- phase timers
  if (phase === 'countdown') {
    state.phaseT -= dt
    const n = Math.max(0, Math.ceil(state.phaseT - 1e-9))
    if (n < state.cdN) { state.cdN = n; emit(state, 'countdown', { n }) }
    if (state.phaseT <= 0) { state.phase = 'play'; emit(state, 'kickoff', {}) }
    return state
  }
  if (phase === 'pregame') return state

  const live = state.phase === 'play' || state.phase === 'goal'

  // ---- cars
  for (const c of state.cars) {
    if (c.demolished > 0) {
      c.demolished -= dt
      // Each car its own slot, so two demolished at once do not respawn inside each other.
      if (c.demolished <= 0) spawn(state, c, state.cars.indexOf(c))
      continue
    }
    const input = !live ? NEUTRAL_INPUT : c.bot ? botInput(state, c) ?? NEUTRAL_INPUT : state.inputs[c.id] ?? NEUTRAL_INPUT
    const was = { g: c.onGround, j: c.jumped, d: c.doubleJumped, dg: c.dodging, ss: c.supersonic }
    stepCar(c, input, dt, state)
    if (input.jump && was.g && c.jumped && !was.j) emit(state, 'jump', { carId: c.id })
    else if (c.doubleJumped && !was.d) emit(state, c.dodging && !was.dg ? 'dodge' : 'jump', { carId: c.id })
    if (c.onGround && !was.g) emit(state, 'land', { carId: c.id })
    if (c.supersonic && !was.ss) emit(state, 'supersonic', { carId: c.id })
    padPickups(state, c)
  }
  for (let i = 0; i < state.padT.length; i++) {
    if (!state.pads[i] && (state.padT[i] -= dt) <= 0) state.pads[i] = true
  }

  // ---- contacts
  for (let i = 0; i < state.cars.length; i++) {
    const a = state.cars[i]
    if (a.demolished > 0) continue
    for (let j = i + 1; j < state.cars.length; j++) {
      const b = state.cars[j]
      if (b.demolished > 0 || a.demolished > 0) continue
      if (Math.abs(a.p[0] - b.p[0]) + Math.abs(a.p[2] - b.p[2]) < 8) carVsCar(state, a, b)
    }
  }
  const ball = state.ball
  stepBall(ball, dt)
  for (const c of state.cars) {
    if (c.demolished > 0) continue
    const s = carHitsBall(ball, c)
    if (s > 0 && live) onTouch(state, c, s)
  }
  if (state.phase === 'play') state.threat = state.threat === -1 ? shotThreat(ball) : state.threat
  state.threat = shotThreat(ball)

  // ---- scoring + clock
  if (state.phase === 'play') {
    const g = inGoal(ball.p, C.BALL_R)
    if (g >= 0) goalScored(state, g)
    else if (state.overtime) state.clock += dt
    else {
      state.clock = Math.max(0, state.clock - dt)
      if (state.clock <= 0) {
        if (state.score[0] !== state.score[1]) endMatch(state)
        else { state.overtime = true; state.clock = 0; emit(state, 'overtime', {}) }
      }
    }
  } else if (state.phase === 'goal') {
    state.phaseT -= dt
    if (state.phaseT <= 0) {
      if (state.overtime || (state.clock <= 0 && state.score[0] !== state.score[1])) endMatch(state)
      else beginCountdown(state)
    }
  }
  return state
}

const SKIP = new Set(['inputs', 'rng', 'touches', 'padT', 'cdN', 'botSeq', 'threat', 'threatBy', 'pj', 'jumpT', 'dodgeT'])
function copy(o) {
  if (Array.isArray(o)) return o.map(copy)
  if (o && typeof o === 'object') {
    const r = {}
    for (const k in o) if (!SKIP.has(k) && o[k] !== undefined) r[k] = copy(o[k])
    return r
  }
  return o
}
/** JSON-safe deep copy of everything clients need (internal bookkeeping omitted). */
export function snapshot(state) {
  return copy(state)
}
