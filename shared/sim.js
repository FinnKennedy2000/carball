// The only authoritative simulation. Pure and deterministic: fixed timestep,
// fixed body iteration order, no Math.random, no Date, no I/O.
//
// Damping uses linear (1 - rate*dt) rather than exp(-rate*dt) so results do not
// depend on a JS engine's transcendental function accuracy.

import * as C from './constants.js'

export function createState() {
  const state = {
    tick: 0,
    // Nothing moves until the host starts the match, so a room can fill up first.
    phase: 'WAITING',
    phaseTimer: 0,
    clock: C.MATCH_SECONDS,
    overtime: false, // sudden death: the clock ran out level
    lastScorer: null, // car id credited with the most recent goal, or null
    score: [0, 0],
    // lastTouch: the car that hit the ball most recently, for goal credit.
    ball: { x: 0, y: 0, vx: 0, vy: 0, lastTouch: null },
    cars: [],
  }
  return state
}

export function addCar(state, id, team) {
  const car = { id, team, x: 0, y: 0, vx: 0, vy: 0, heading: 0, boost: C.BOOST_MAX }
  state.cars.push(car)
  // Cars are kept sorted by id so the collision iteration order never depends on
  // join order. Determinism, and it makes snapshots diff-friendly.
  state.cars.sort((a, b) => a.id - b.id)
  // Only the joining car is placed. A mid-match join must not move the ball.
  placeCar(car, state.cars.filter((c) => c.team === team).indexOf(car))
  return car
}

export function removeCar(state, id) {
  const i = state.cars.findIndex((c) => c.id === id)
  if (i !== -1) state.cars.splice(i, 1)
}

/** Leave WAITING and run the kickoff countdown. The host's call to make. */
export function kickoff(state) {
  if (state.phase !== 'WAITING') return
  state.phase = 'KICKOFF'
  state.phaseTimer = C.KICKOFF_SECONDS
}

export function resetPositions(state) {
  state.ball.x = 0
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0
  state.ball.lastTouch = null

  const perTeam = [0, 0]
  for (const car of state.cars) placeCar(car, perTeam[car.team]++)
}

function placeCar(car, slot) {
  const side = car.team === C.TEAM_BLUE ? -1 : 1
  // Fan out from the centre line: 0, +1, -1, +2, -2 ...
  const rank = Math.ceil(slot / 2) * (slot % 2 === 1 ? 1 : -1)
  car.x = side * (C.ARENA_W / 4)
  car.y = rank * (C.ARENA_H / 5)
  car.heading = side === -1 ? 0 : Math.PI
  car.vx = 0
  car.vy = 0
  car.boost = C.BOOST_MAX
}

/** Advance one fixed tick. `inputs` maps car id -> input bitmask. Mutates and returns state. */
export function step(state, inputs) {
  const dt = C.DT
  state.tick++

  if (state.phase === 'WAITING') return state

  if (state.phase === 'OVER') {
    // Nothing moves, but the timer runs so the room knows when to reset.
    state.phaseTimer = Math.max(0, state.phaseTimer - dt)
    return state
  }

  if (state.phase === 'KICKOFF' || state.phase === 'GOAL') {
    // Bodies are frozen during the countdown; only the timer runs.
    state.phaseTimer -= dt
    if (state.phaseTimer <= 0) {
      if (state.phase === 'GOAL') {
        resetPositions(state)
        state.phase = 'KICKOFF'
        state.phaseTimer = C.KICKOFF_SECONDS
      } else {
        state.phase = 'PLAY'
        state.phaseTimer = 0
      }
    }
    return state
  }

  state.clock -= dt

  for (const car of state.cars) stepCar(car, inputs[car.id] | 0, dt)
  stepBall(state.ball, dt)

  for (let i = 0; i < state.cars.length; i++) {
    for (let j = i + 1; j < state.cars.length; j++) {
      collide(state.cars[i], state.cars[j], C.CAR_R, C.CAR_R, C.CAR_MASS, C.CAR_MASS)
    }
  }
  for (const car of state.cars) {
    if (collide(car, state.ball, C.CAR_R, C.BALL_R, C.CAR_MASS, C.BALL_MASS)) {
      state.ball.lastTouch = car.id
    }
  }

  for (const car of state.cars) confineCar(car)

  // Speed ceilings are enforced *after* collisions, not just after engine forces —
  // an impulse from a car is exactly what would otherwise launch the ball past its cap.
  clampSpeed(state.ball, C.BALL_MAX_SPEED)
  // Headroom above the engine cap so a collision can still shove a car around,
  // but a pile-up cannot accumulate speed without bound.
  for (const car of state.cars) clampSpeed(car, C.CAR_BOOST_MAX_SPEED * 1.5)

  const scorer = confineBall(state.ball)
  if (scorer !== null) {
    state.score[scorer]++
    // Credited only if the last toucher was attacking that goal — an own goal
    // counts on the scoreboard but is nobody's goal.
    const toucher = state.cars.find((c) => c.id === state.ball.lastTouch)
    state.lastScorer = toucher && toucher.team === scorer ? toucher.id : null
    // Entering either phase freezes the ball, so this cannot re-trigger while it
    // sits in the net. In overtime the first goal is the last one.
    state.phase = state.overtime ? 'OVER' : 'GOAL'
    state.phaseTimer = state.overtime ? C.OVER_SECONDS : C.GOAL_SECONDS
  }

  if (state.clock <= 0) {
    state.clock = 0
    if (state.score[0] === state.score[1]) {
      // Level at full time: play on rather than draw. Also covers a goal that
      // levelled it on the final tick — the GOAL pause runs, then sudden death.
      state.overtime = true
    } else {
      // A goal on the whistle still counts, and ends it either way.
      state.phase = 'OVER'
      state.phaseTimer = C.OVER_SECONDS
    }
  }
  return state
}

function stepCar(car, bits, dt) {
  const boosting = (bits & C.IN_BOOST) !== 0 && car.boost > 0
  const drifting = (bits & C.IN_DRIFT) !== 0
  const speed = Math.hypot(car.vx, car.vy)

  // Steering authority scales with speed, with a floor so you can still pivot slowly.
  const turnScale =
    (C.TURN_MIN_FACTOR + (1 - C.TURN_MIN_FACTOR) * Math.min(1, speed / (C.CAR_MAX_SPEED * 0.5))) *
    (drifting ? C.TURN_DRIFT_FACTOR : 1)
  // Left steers clockwise on screen: the camera looks down the -z axis, which
  // mirrors the sim's y, so a positive heading change reads as a right turn.
  let steer = 0
  if (bits & C.IN_LEFT) steer -= 1
  if (bits & C.IN_RIGHT) steer += 1
  car.heading = wrapAngle(car.heading + steer * C.TURN_RATE * turnScale * dt)

  const fx = Math.cos(car.heading)
  const fy = Math.sin(car.heading)

  let accel = 0
  if (bits & C.IN_FWD) accel += C.CAR_ACCEL
  if (bits & C.IN_BACK) accel -= C.CAR_REVERSE_ACCEL
  if (boosting) accel += C.CAR_BOOST_ACCEL
  car.vx += fx * accel * dt
  car.vy += fy * accel * dt

  if (boosting) car.boost = Math.max(0, car.boost - C.BOOST_DRAIN * dt)
  else car.boost = Math.min(C.BOOST_MAX, car.boost + C.BOOST_REFILL * dt)

  // Split velocity into forward and lateral, damp them at different rates. The
  // lateral term is what makes this feel like a car and not a hovercraft; drift
  // slackens it so the car slides through a turn instead of railing round it.
  const fwd = car.vx * fx + car.vy * fy
  const lat = car.vx * -fy + car.vy * fx
  const newFwd = fwd * damp(C.CAR_DRAG, dt)
  const newLat = lat * damp(drifting ? C.GRIP_DRIFT : C.GRIP, dt)
  car.vx = fx * newFwd - fy * newLat
  car.vy = fy * newFwd + fx * newLat

  clampSpeed(car, boosting ? C.CAR_BOOST_MAX_SPEED : C.CAR_MAX_SPEED)

  car.x += car.vx * dt
  car.y += car.vy * dt
}

function stepBall(ball, dt) {
  const d = damp(C.BALL_DRAG, dt)
  ball.vx *= d
  ball.vy *= d
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
}

/**
 * Resolve a circle/circle overlap: separate by mass, then apply a normal impulse.
 * Restitution is below 1 so repeated collisions cannot inject energy.
 */
function collide(a, b, ra, rb, ma, mb) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const r = ra + rb
  const d2 = dx * dx + dy * dy
  if (d2 >= r * r) return false

  let d = Math.sqrt(d2)
  let nx
  let ny
  if (d < 1e-6) {
    // Exactly coincident centres have no normal. Pick one deterministically.
    nx = 1
    ny = 0
    d = 1e-6
  } else {
    nx = dx / d
    ny = dy / d
  }

  const invA = 1 / ma
  const invB = 1 / mb
  const invSum = invA + invB

  const overlap = r - d
  a.x -= nx * overlap * (invA / invSum)
  a.y -= ny * overlap * (invA / invSum)
  b.x += nx * overlap * (invB / invSum)
  b.y += ny * overlap * (invB / invSum)

  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn > 0) return true // already separating

  const j = (-(1 + C.RESTITUTION_BODY) * vn) / invSum
  a.vx -= j * invA * nx
  a.vy -= j * invA * ny
  b.vx += j * invB * nx
  b.vy += j * invB * ny
  return true
}

/** Cars are confined to the full rectangle — they cannot drive into the goals. */
function confineCar(car) {
  reflectAxis(car, 'x', 'vx', C.MIN_X + C.CAR_R, C.MAX_X - C.CAR_R)
  reflectAxis(car, 'y', 'vy', C.MIN_Y + C.CAR_R, C.MAX_Y - C.CAR_R)
}

/**
 * Confine the ball, allowing it through the goal mouths.
 * Returns the scoring team index, or null.
 */
function confineBall(ball) {
  reflectAxis(ball, 'y', 'vy', C.MIN_Y + C.BALL_R, C.MAX_Y - C.BALL_R)

  const inMouth = Math.abs(ball.y) <= C.GOAL_H / 2
  if (inMouth) {
    // Goal line is the wall itself, and it takes the *whole* ball: a ball still
    // sitting on the line is play on, as in the real game.
    if (ball.x + C.BALL_R <= C.MIN_X) return C.TEAM_ORANGE
    if (ball.x - C.BALL_R >= C.MAX_X) return C.TEAM_BLUE
    return null
  }
  reflectAxis(ball, 'x', 'vx', C.MIN_X + C.BALL_R, C.MAX_X - C.BALL_R)
  return null
}

/** Positional clamp plus velocity reflection — cannot tunnel, since it is not a raycast. */
function reflectAxis(body, pos, vel, lo, hi) {
  if (body[pos] < lo) {
    body[pos] = lo
    body[vel] = Math.abs(body[vel]) * C.RESTITUTION_WALL
  } else if (body[pos] > hi) {
    body[pos] = hi
    body[vel] = -Math.abs(body[vel]) * C.RESTITUTION_WALL
  }
}

function damp(rate, dt) {
  return Math.max(0, 1 - rate * dt)
}

function clampSpeed(body, max) {
  const s = Math.hypot(body.vx, body.vy)
  if (s > max) {
    const k = max / s
    body.vx *= k
    body.vy *= k
  }
}

function wrapAngle(a) {
  const twoPi = Math.PI * 2
  a %= twoPi
  if (a > Math.PI) a -= twoPi
  else if (a < -Math.PI) a += twoPi
  return a
}

/** Cheap structural hash, used by the determinism test. */
export function hashState(state) {
  const nums = [state.tick, state.phase.length, state.overtime ? 1 : 0, state.score[0], state.score[1], state.ball.x, state.ball.y, state.ball.vx, state.ball.vy]
  for (const c of state.cars) nums.push(c.id, c.x, c.y, c.vx, c.vy, c.heading, c.boost)
  let h = 2166136261
  for (const n of nums) {
    const s = String(Math.round(n * 1e6))
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return h >>> 0
}
