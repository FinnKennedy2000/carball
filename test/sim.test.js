import test from 'node:test'
import assert from 'node:assert/strict'

import * as C from '../shared/constants.js'
import { createState, addCar, step, hashState } from '../shared/sim.js'
import { parse } from '../server/protocol.js'

/** A repeatable pseudo-random input stream — no Math.random, so runs are comparable. */
function scriptedBits(tick, id) {
  const n = (tick * 2654435761 + id * 40503) >>> 0
  return (n >>> 13) & C.IN_ALL
}

function twoCarGame() {
  const state = createState()
  addCar(state, 1, C.TEAM_BLUE)
  addCar(state, 2, C.TEAM_ORANGE)
  return state
}

function run(state, ticks, inputFn) {
  for (let t = 0; t < ticks; t++) {
    const inputs = {}
    for (const car of state.cars) inputs[car.id] = inputFn(t, car.id)
    step(state, inputs)
  }
  return state
}

test('the same inputs produce the same state', () => {
  const a = run(twoCarGame(), 600, scriptedBits)
  const b = run(twoCarGame(), 600, scriptedBits)
  assert.equal(hashState(a), hashState(b))
})

test('the ball cannot escape through a wall', () => {
  const state = twoCarGame()
  state.phase = 'PLAY'
  state.phaseTimer = 0

  // Fire the ball at the walls at maximum speed, well clear of the goal mouths.
  for (let t = 0; t < 600; t++) {
    if (t % 40 === 0) {
      const away = C.GOAL_H / 2 + 4
      state.ball.y = t % 80 === 0 ? away : -away
      state.ball.vx = t % 80 === 0 ? C.BALL_MAX_SPEED : -C.BALL_MAX_SPEED
      state.ball.vy = t % 80 === 0 ? C.BALL_MAX_SPEED : -C.BALL_MAX_SPEED
    }
    step(state, {})
    assert.ok(state.ball.x >= C.MIN_X - 0.001, `ball left via -x at tick ${t}: ${state.ball.x}`)
    assert.ok(state.ball.x <= C.MAX_X + 0.001, `ball left via +x at tick ${t}: ${state.ball.x}`)
    assert.ok(state.ball.y >= C.MIN_Y - 0.001, `ball left via -y at tick ${t}: ${state.ball.y}`)
    assert.ok(state.ball.y <= C.MAX_Y + 0.001, `ball left via +y at tick ${t}: ${state.ball.y}`)
  }
})

test('a ball sitting in the net scores exactly once', () => {
  const state = twoCarGame()
  state.phase = 'PLAY'
  state.phaseTimer = 0

  state.ball.x = C.MIN_X + 1
  state.ball.y = 0
  state.ball.vx = -20
  state.ball.vy = 0

  // Long enough to cross the line, sit there, and run the whole GOAL phase out.
  run(state, Math.ceil((C.GOAL_SECONDS + 1) * C.TICK_HZ), () => 0)

  assert.deepEqual(state.score, [0, 1], 'exactly one goal to orange')
  assert.equal(state.phase, 'KICKOFF')
  assert.equal(state.ball.x, 0, 'kickoff resets the ball')
})

test('repeated collisions do not inject energy', () => {
  const state = twoCarGame()
  state.phase = 'PLAY'
  state.phaseTimer = 0

  // Park the two cars on top of each other and hold full throttle into each other.
  state.cars[0].x = -2
  state.cars[0].y = 0
  state.cars[0].heading = 0
  state.cars[1].x = 2
  state.cars[1].y = 0
  state.cars[1].heading = Math.PI

  const ceiling = C.CAR_BOOST_MAX_SPEED * 1.5 + 1
  for (let t = 0; t < 1000; t++) {
    step(state, { 1: C.IN_ALL, 2: C.IN_ALL })
    for (const car of state.cars) {
      const speed = Math.hypot(car.vx, car.vy)
      assert.ok(speed <= ceiling, `car ${car.id} reached ${speed} at tick ${t}`)
    }
    assert.ok(Math.hypot(state.ball.vx, state.ball.vy) <= C.BALL_MAX_SPEED + 0.001)
  }
})

test('steering direction matches the screen, and drift slackens grip', () => {
  // Start from a straight run at speed, then turn for half a second.
  const drive = (bits) => {
    const state = twoCarGame()
    state.phase = 'PLAY'
    state.phaseTimer = 0
    const car = state.cars[0]
    car.x = 0
    car.y = 0
    car.heading = 0 // +x, which the camera shows as screen-right
    for (let t = 0; t < 60; t++) step(state, { 1: C.IN_FWD })
    for (let t = 0; t < 30; t++) step(state, { 1: bits })
    return car
  }

  // sim +y is screen-down, so a right turn must carry the car to +y.
  assert.ok(drive(C.IN_FWD | C.IN_RIGHT).y > 1, 'D curves right on screen')
  assert.ok(drive(C.IN_FWD | C.IN_LEFT).y < -1, 'A curves left on screen')

  // Slip angle: how far the car's travel lags the way it points.
  const slipDeg = (bits) => {
    const car = drive(bits)
    const fwd = car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading)
    const lat = car.vx * -Math.sin(car.heading) + car.vy * Math.cos(car.heading)
    return Math.abs((Math.atan2(lat, fwd) * 180) / Math.PI)
  }
  assert.ok(slipDeg(C.IN_FWD | C.IN_RIGHT) < 20, 'gripped cornering barely slides')
  assert.ok(slipDeg(C.IN_FWD | C.IN_RIGHT | C.IN_DRIFT) > 30, 'drifting slides')
})

test('a level clock goes to sudden death, a lead ends the match', () => {
  // Level at full time: play on, and the next goal wins it.
  const level = twoCarGame()
  level.phase = 'PLAY'
  level.phaseTimer = 0
  level.clock = 0.5
  run(level, 60, () => 0)
  assert.equal(level.overtime, true, 'tied at 0:00 means overtime')
  assert.equal(level.phase, 'PLAY', 'and play continues')

  level.ball.x = C.MIN_X + 1
  level.ball.vx = -20
  run(level, 30, () => 0)
  assert.deepEqual(level.score, [0, 1])
  assert.equal(level.phase, 'OVER', 'the first overtime goal ends it')

  // The match holds on OVER long enough to read the score, and nothing moves.
  const held = level.phaseTimer
  assert.ok(held > 1, `OVER holds for ${held}s`)
  run(level, 30, () => 0)
  assert.equal(level.phase, 'OVER')
  assert.ok(level.phaseTimer < held)

  // A lead at full time just ends it.
  const led = twoCarGame()
  led.phase = 'PLAY'
  led.phaseTimer = 0
  led.clock = 0.5
  led.score = [2, 1]
  run(led, 60, () => 0)
  assert.equal(led.phase, 'OVER')
  assert.equal(led.overtime, false)
})

test('malformed messages are rejected without throwing', () => {
  const bad = [
    'not json',
    '[]',
    'null',
    '"a string"',
    JSON.stringify({ t: 'nope' }),
    JSON.stringify({ t: 'input', seq: -1, bits: 0 }),
    JSON.stringify({ t: 'input', seq: 1.5, bits: 0 }),
    JSON.stringify({ t: 'input', seq: 0, bits: 999 }),
    JSON.stringify({ t: 'input', seq: 0, bits: '3' }),
    JSON.stringify({ t: 'join', name: 'x', code: 'toolong' }),
    JSON.stringify({ t: 'join', name: 'x', code: 12 }),
    'x'.repeat(600),
  ]
  for (const raw of bad) assert.equal(parse(raw), null, `should reject: ${raw.slice(0, 40)}`)

  assert.deepEqual(parse(JSON.stringify({ t: 'input', seq: 7, bits: C.IN_ALL })), {
    t: 'input',
    seq: 7,
    bits: C.IN_ALL,
  })
  assert.equal(parse(JSON.stringify({ t: 'join', name: '  bob  ', code: 'abcd' })).code, 'ABCD')
  assert.equal(parse(JSON.stringify({ t: 'create', name: '\u0007\u0000' })).name, 'player')
  // A side request is optional, and anything that is not a team means "anywhere".
  assert.equal(parse(JSON.stringify({ t: 'create', name: 'x', team: 1 })).team, 1)
  assert.equal(parse(JSON.stringify({ t: 'create', name: 'x' })).team, null)
  assert.equal(parse(JSON.stringify({ t: 'create', name: 'x', team: 7 })).team, null)
  assert.equal(parse(JSON.stringify({ t: 'create', name: 'x', team: '0' })).team, null)
})
