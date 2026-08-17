import test from 'node:test'
import assert from 'node:assert/strict'

import * as C from '../shared/constants.js'
import { createState, addCar, step, hashState } from '../shared/sim.js'
import { parse } from '../shared/protocol.js'
import { buildRow } from '../api/record-match.js'

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

test('a ball resting on the goal line is not yet a goal', () => {
  const state = twoCarGame()
  state.phase = 'PLAY'
  state.phaseTimer = 0

  // Centre past the line but the far edge still short of it: play on.
  state.ball.x = C.MIN_X - C.BALL_R + 0.1
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0

  run(state, 30, () => 0)
  assert.deepEqual(state.score, [0, 0], 'not over until the whole ball is')

  // A nudge that takes the last of it across does score.
  state.ball.vx = -5
  run(state, 30, () => 0)
  assert.deepEqual(state.score, [0, 1])
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

test('a goal is credited to the last attacker to touch the ball', () => {
  const state = twoCarGame()
  state.phase = 'PLAY'
  state.phaseTimer = 0

  // Blue (car 1, attacking +x) nudges the ball into the orange goal.
  state.cars[0].x = C.MAX_X - 8
  state.cars[0].y = 0
  state.cars[0].heading = 0
  state.cars[1].x = C.MIN_X + 5 // keep orange out of it
  state.ball.x = C.MAX_X - 4
  state.ball.y = 0
  state.ball.vx = 30
  run(state, 30, (t, id) => (id === 1 ? C.IN_FWD : 0))

  assert.deepEqual(state.score, [1, 0])
  assert.equal(state.lastScorer, 1, 'blue is credited')

  // The same shot from the wrong end is an own goal: on the board, uncredited.
  const own = twoCarGame()
  own.phase = 'PLAY'
  own.phaseTimer = 0
  own.cars[0].x = C.MIN_X + 8
  own.cars[0].y = 0
  own.cars[0].heading = Math.PI // blue facing its own goal
  own.cars[1].x = C.MAX_X - 5
  own.ball.x = C.MIN_X + 4
  own.ball.y = 0
  own.ball.vx = -30
  run(own, 30, (t, id) => (id === 1 ? C.IN_FWD : 0))

  assert.deepEqual(own.score, [0, 1], 'the goal still counts')
  assert.equal(own.lastScorer, null, 'but nobody is credited')
})

test('a reported result becomes a row, or is refused', () => {
  const ID = '3f1a7c2e-9b4d-4e8a-8c1f-2d6e5a0b7c93'
  const win = buildRow('u-blue', { matchId: ID, score: [2, 1], team: C.TEAM_BLUE, goals: 2 })
  assert.deepEqual(win, {
    match_id: ID,
    user_id: 'u-blue',
    team: C.TEAM_BLUE,
    goals: 2,
    won: true,
    drawn: false,
  })
  assert.equal(buildRow('u-o', { matchId: ID, score: [2, 1], team: C.TEAM_ORANGE, goals: 1 }).won, false)

  const drawn = buildRow('u-x', { matchId: ID, score: [3, 3], team: C.TEAM_BLUE, goals: 1 })
  assert.ok(drawn.drawn && !drawn.won, 'a draw is neither won nor lost')

  // The user id comes from the verified token, never the body.
  const spoofed = buildRow('u-real', { matchId: ID, score: [1, 0], team: 0, goals: 1, user_id: 'u-fake' })
  assert.equal(spoofed.user_id, 'u-real')

  for (const bad of [
    null,
    'nope',
    { matchId: 'not-a-uuid', score: [1, 0], team: 0, goals: 0 },
    { matchId: ID, score: [1], team: 0, goals: 0 },
    { matchId: ID, score: [1, 0], team: 3, goals: 0 },
    { matchId: ID, score: [1, 0], team: 0, goals: -1 },
    // More goals than the side actually scored is not a result, it is a claim.
    { matchId: ID, score: [1, 0], team: 0, goals: 2 },
  ]) {
    assert.equal(buildRow('u', bad), null, `should reject: ${JSON.stringify(bad)}`)
  }
})

test('malformed peer messages are rejected without throwing', () => {
  const CID = 'peer-1'
  for (const bad of [
    null,
    'a string',
    [],
    { t: 'nope', cid: CID },
    { t: 'input', cid: CID, seq: -1, bits: 0 },
    { t: 'input', cid: CID, seq: 1.5, bits: 0 },
    { t: 'input', cid: CID, seq: 0, bits: 999 },
    { t: 'input', cid: CID, seq: 0, bits: '3' },
    { t: 'hello', cid: CID, name: 12 },
    { t: 'hello', name: 'x' }, // no cid: there is nobody to answer
    { t: 'input', cid: 'x'.repeat(100), seq: 0, bits: 0 },
  ]) {
    assert.equal(parse(bad), null, `should reject: ${JSON.stringify(bad)}`)
  }

  assert.deepEqual(parse({ t: 'input', cid: CID, seq: 7, bits: C.IN_ALL }), {
    t: 'input',
    cid: CID,
    seq: 7,
    bits: C.IN_ALL,
  })
  assert.equal(parse({ t: 'hello', cid: CID, name: '  bob  ' }).name, 'bob')
  assert.equal(parse({ t: 'hello', cid: CID, name: '\u0007\u0000' }).name, 'player')
  // A side request is optional, and anything that is not a team means "anywhere".
  assert.equal(parse({ t: 'hello', cid: CID, name: 'x', team: 1 }).team, 1)
  assert.equal(parse({ t: 'hello', cid: CID, name: 'x' }).team, null)
  assert.equal(parse({ t: 'hello', cid: CID, name: 'x', team: 7 }).team, null)
  assert.equal(parse({ t: 'hello', cid: CID, name: 'x', team: '0' }).team, null)
})
