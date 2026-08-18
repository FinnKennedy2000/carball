import test from 'node:test'
import assert from 'node:assert/strict'

import * as C from '../shared/constants.js'
import { createState, addCar, resetPositions, step, kickoff, hashState } from '../shared/sim.js'
import { ITEMS } from '../shared/rumble.js'
import { parse } from '../shared/protocol.js'
import { CARS, DEFAULT_CAR } from '../shared/cars.js'
import { buildRow } from '../api/record-match.js'
import { renameProblem } from '../client/auth.js'

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

/** A Rumble match in PLAY, with the two cars parked where the test puts them. */
function rumbleGame(seed = 12345) {
  const state = createState('rumble', seed)
  addCar(state, 1, C.TEAM_BLUE)
  addCar(state, 2, C.TEAM_ORANGE)
  state.phase = 'PLAY'
  state.phaseTimer = 0
  return state
}

/** Put a named item in a car's hand, whatever the roll would have given it. */
function hand(car, key) {
  car.item = ITEMS.findIndex((i) => i.key === key)
  car.itemTimer = 0
  car.itemDown = false
}

/** One tick with `bits` for car `id` and nothing for anyone else. */
function tickWith(state, id, bits) {
  const inputs = {}
  for (const car of state.cars) inputs[car.id] = car.id === id ? bits : 0
  step(state, inputs)
}

/** Press the item key: one tick down (the rising edge), one tick up. */
function fireItem(state, id) {
  tickWith(state, id, C.IN_ITEM)
  tickWith(state, id, 0)
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

test('a room waits, frozen, until the host kicks off', () => {
  const state = twoCarGame()
  assert.equal(state.phase, 'WAITING')

  const clock = state.clock
  run(state, 120, () => C.IN_ALL) // everyone flooring it changes nothing
  assert.equal(state.phase, 'WAITING')
  assert.equal(state.clock, clock)
  assert.ok(state.cars.every((c) => c.vx === 0 && c.vy === 0))

  kickoff(state)
  assert.equal(state.phase, 'KICKOFF')
  run(state, Math.ceil(C.KICKOFF_SECONDS * C.TICK_HZ) + 5, () => 0)
  assert.equal(state.phase, 'PLAY')
  assert.ok(state.clock < clock)
})

test('kickoff spawns keep the corners, and the ball line clear until 3v3', () => {
  const sides = (n) => {
    const state = createState()
    for (let i = 0; i < n; i++) {
      addCar(state, i * 2 + 1, C.TEAM_BLUE)
      addCar(state, i * 2 + 2, C.TEAM_ORANGE)
    }
    resetPositions(state)
    return state
  }

  for (const n of [1, 2]) {
    const state = sides(n)
    // Nobody lined up on the ball: that spot put someone on it every kickoff.
    assert.ok(
      state.cars.every((c) => Math.abs(c.y) > C.BALL_R + C.CAR_R),
      `${n}v${n} should leave the ball's line clear`,
    )
  }

  // The back spot is third in the table, so it only comes out at three a side.
  const full = sides(3)
  const middle = full.cars.filter((c) => Math.abs(c.y) < 1)
  assert.equal(middle.length, 2, 'one straight-on car per side at 3v3')

  // The first car of each side starts diagonally opposite the other's.
  const [blue, orange] = [C.TEAM_BLUE, C.TEAM_ORANGE].map((t) =>
    full.cars.find((c) => c.team === t),
  )
  assert.equal(Math.sign(blue.x), -Math.sign(orange.x))
  assert.equal(Math.sign(blue.y), -Math.sign(orange.y))

  // Everyone is inside the pitch, and aimed at the centre spot rather than at
  // whatever wall happens to be in front of them.
  for (const car of full.cars) {
    assert.ok(Math.abs(car.x) <= C.MAX_X - C.CAR_R, 'inside the end walls')
    assert.ok(Math.abs(car.y) <= C.MAX_Y - C.CAR_R, 'inside the side walls')
    const toCentre = Math.atan2(-car.y, -car.x)
    assert.ok(Math.abs(car.heading - toCentre) < 1e-9, 'pointed at the ball')
  }
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

test('a ball pinched against a wall is fired along it', () => {
  // Coast a car into a ball resting on the top wall. No throttle: the speed
  // under test is the speed that actually lands.
  const pinch = ({ vy = 0, vx = 0, offset = -0.6 }) => {
    const state = twoCarGame()
    state.phase = 'PLAY'
    state.phaseTimer = 0
    const [car, spare] = state.cars
    spare.x = 0
    spare.y = -20
    spare.vx = 0
    spare.vy = 0

    state.ball.x = 0
    state.ball.y = C.MAX_Y - C.BALL_R
    state.ball.vx = 0
    state.ball.vy = 0

    car.x = offset
    car.y = C.MAX_Y - C.BALL_R - C.CAR_R - 1
    car.heading = Math.atan2(vy, vx)
    car.vx = vx
    car.vy = vy

    let peak = 0
    for (let t = 0; t < 90; t++) {
      step(state, {})
      peak = Math.max(peak, Math.hypot(state.ball.vx, state.ball.vy))
    }
    return { peak, ball: state.ball }
  }

  const hard = pinch({ vy: C.CAR_MAX_SPEED })
  assert.ok(hard.peak > C.CAR_MAX_SPEED * 3, `squeezing it out fast (${hard.peak})`)
  assert.ok(hard.peak <= C.BALL_MAX_SPEED + 1e-6, 'and still capped')

  // Proportional: a crawl is a nudge, not a rocket.
  const soft = pinch({ vy: 4 })
  assert.ok(soft.peak < hard.peak / 2, `${soft.peak} from a crawl vs ${hard.peak}`)

  // Brushing along the wall is not a pinch — nothing is being squeezed.
  const brush = pinch({ vx: C.CAR_MAX_SPEED, offset: -3.2 })
  assert.ok(brush.peak < C.CAR_MAX_SPEED * 1.5, `an ordinary touch (${brush.peak})`)
})

test('a shot off the post comes back out', () => {
  // Fire the ball at the goal from open play, aimed at a given y on the line.
  const shootAt = (y) => {
    const state = twoCarGame()
    state.phase = 'PLAY'
    state.phaseTimer = 0
    // Cars out of the way, so only the ball and the woodwork are in play.
    for (const car of state.cars) {
      car.x = 0
      car.y = 20
      car.vx = 0
      car.vy = 0
    }
    state.ball.x = C.MIN_X + 14
    state.ball.y = y
    state.ball.vx = -30
    state.ball.vy = 0
    run(state, 60, () => 0)
    return state
  }

  const post = shootAt(C.GOAL_H / 2)
  assert.deepEqual(post.score, [0, 0], 'off the woodwork is not a goal')
  assert.ok(post.ball.x > C.MIN_X, `came back out, not in (x ${post.ball.x})`)
  // Separated cleanly rather than left sitting inside the post.
  const gap = Math.hypot(post.ball.x - C.MIN_X, post.ball.y - C.GOAL_H / 2)
  assert.ok(gap >= C.BALL_R + C.POST_R - 1e-6, `clear of the post (${gap})`)
  assert.ok(Math.hypot(post.ball.vx, post.ball.vy) > 5, 'and it rebounds, not stops')

  // The mouth is still a mouth: a shot with room to spare goes in.
  assert.deepEqual(shootAt(3).score, [0, 1], 'inside the post still scores')
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

test('a car can drive into the goal, but not out the back of it', () => {
  const state = twoCarGame()
  state.phase = 'PLAY'
  state.phaseTimer = 0
  state.ball.x = 30 // clear of the cars and outside the goal mouth
  state.ball.y = 20

  // Straight at the blue goal, dead centre, boost held.
  const car = state.cars[0]
  car.x = C.MIN_X + 10
  car.y = 0
  car.heading = Math.PI
  for (let t = 0; t < 180; t++) {
    step(state, { 1: C.IN_FWD | C.IN_BOOST })
    assert.ok(car.x >= C.MIN_X - C.GOAL_DEPTH + C.CAR_R - 1e-9, `left the net at ${car.x}`)
  }
  assert.ok(car.x < C.MIN_X, `should be behind the line, was ${car.x}`)

  // And once inside, the mouth is the wall: no driving out through the side.
  car.heading = Math.PI / 2
  for (let t = 0; t < 120; t++) {
    step(state, { 1: C.IN_FWD | C.IN_BOOST })
    if (car.x < C.MIN_X) {
      assert.ok(Math.abs(car.y) <= C.GOAL_H / 2 - C.CAR_R + 1e-9, `out the side at ${car.y}`)
    }
  }

  // A car on the posts is stopped at the line, with the pitch still its limit.
  const post = state.cars[1]
  post.x = C.MIN_X + 4
  post.y = C.GOAL_H / 2 // straddling a post
  post.vx = 0
  post.vy = 0
  post.heading = Math.PI
  for (let t = 0; t < 120; t++) step(state, { 2: C.IN_FWD | C.IN_BOOST })
  assert.ok(post.x >= C.MIN_X + C.CAR_R - 1e-9, `squeezed past a post to ${post.x}`)
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

test('driving into someone harder sends them further', () => {
  // Park a target, hit it at a given closing speed, take the worst it suffers.
  const ram = (speed) => {
    const state = twoCarGame()
    state.phase = 'PLAY'
    state.phaseTimer = 0
    // Clear of the cars and outside the goal mouth, so no goal freezes the sim.
    state.ball.x = 30
    state.ball.y = 20

    const [hitter, target] = state.cars
    hitter.x = -6
    hitter.y = 0
    hitter.heading = 0
    hitter.vx = speed
    target.x = 0
    target.y = 0
    target.heading = 0
    target.vx = 0
    target.vy = 0

    let peak = 0
    for (let t = 0; t < 60; t++) {
      step(state, { 1: 0, 2: 0 })
      peak = Math.max(peak, Math.hypot(target.vx, target.vy))
    }
    return peak
  }

  const nudge = ram(5)
  const shunt = ram(12)
  const clout = ram(C.CAR_MAX_SPEED)
  assert.ok(shunt > nudge * 2, `${shunt} should dwarf a ${nudge} nudge`)
  assert.ok(clout > shunt * 1.5, `${clout} should dwarf a ${shunt} shunt`)
  // Faster than you were going: that is the arcade part, and it stays bounded.
  assert.ok(clout > C.CAR_MAX_SPEED)
  assert.ok(clout <= C.CAR_BOOST_MAX_SPEED * 1.5)
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

test('a claimed car model is bounded, not trusted', () => {
  const hello = (car) => parse({ t: 'hello', cid: 'peer-1', name: 'x', car })
  // Cosmetic, so junk means the default rather than a dropped message: a peer on
  // a stale build still gets a seat.
  for (const junk of [undefined, null, -1, 1.5, '1', CARS.length, 1e9, {}]) {
    assert.equal(hello(junk).car, DEFAULT_CAR, `should default: ${JSON.stringify(junk)}`)
  }
  for (let i = 0; i < CARS.length; i++) assert.equal(hello(i).car, i)
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

// Rumble --------------------------------------------------------------------

test('a rumble match is as reproducible as a normal one', () => {
  const a = run(rumbleGame(), 900, scriptedBits)
  const b = run(rumbleGame(), 900, scriptedBits)
  assert.equal(hashState(a), hashState(b))
  // And items really are dealt, or the hash above proves nothing about them.
  // Checked on a quiet match rather than the scripted one: scripted input can
  // score, and a goal restarts every cooldown, so whether a roll lands inside
  // the window is luck rather than something worth asserting.
  const quiet = run(rumbleGame(), Math.ceil(C.ITEM_COOLDOWN * C.TICK_HZ) + 5, () => 0)
  assert.ok(quiet.cars.every((c) => c.item !== null), 'items are dealt')
  assert.notEqual(quiet.seed, rumbleGame().seed, 'and the roll moved the seed')
})

test('a different seed deals a different sequence of items', () => {
  const seen = (seed) => {
    const state = rumbleGame(seed)
    const items = []
    // Take each item out of the slot by hand rather than firing it: what is
    // under test is the roll, not what the items do.
    while (items.length < 12) {
      run(state, 1, () => 0)
      if (state.cars[0].item !== null) {
        items.push(state.cars[0].item)
        state.cars[0].item = null
        state.cars[0].itemTimer = C.ITEM_COOLDOWN
      }
    }
    return items.join('')
  }
  assert.notEqual(seen(1), seen(999999))
})

test('a normal match deals nothing at all', () => {
  const state = twoCarGame()
  state.phase = 'PLAY'
  run(state, C.ITEM_COOLDOWN * C.TICK_HZ + 60, () => C.IN_ITEM)
  assert.ok(state.cars.every((c) => c.item === undefined))
  assert.equal(state.ball.freeze, 0)
})

test('an item lands on a timer and is spent by one press', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  assert.equal(me.item, null)

  run(state, Math.ceil(C.ITEM_COOLDOWN * C.TICK_HZ) - 2, () => 0)
  assert.equal(me.item, null, 'nothing before the cooldown is up')
  run(state, 4, () => 0)
  assert.notEqual(me.item, null, 'dealt once it is')

  fireItem(state, me.id)
  assert.equal(me.item, null, 'and the press spends it')
  assert.ok(me.itemTimer > C.ITEM_COOLDOWN - 1, 'the wait starts over')
})

test('holding the item key does not spend the next item too', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'freeze')

  tickWith(state, me.id, C.IN_ITEM) // the rising edge spends it
  assert.equal(me.item, null)

  // Held down through a whole cooldown: the next item must survive.
  me.itemTimer = 0.05
  for (let t = 0; t < 30; t++) tickWith(state, me.id, C.IN_ITEM)
  assert.notEqual(me.item, null, 'a held key must not burn what arrives next')
})

test('a haymaker punches the ball away without touching it', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'haymaker')
  me.x = -10
  me.y = 0
  me.vx = 0
  me.vy = 0
  state.ball.x = 0
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0

  fireItem(state, me.id)
  assert.ok(state.ball.vx > C.HAYMAKER_IMPULSE * 0.9, 'driven away from the car')
  assert.ok(Math.abs(state.ball.vy) < 1e-6, 'and straight down the line')
  assert.equal(state.ball.lastTouch, me.id, 'a punch counts for goal credit')
})

test('a haymaker out of range does nothing but spend the item', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'haymaker')
  me.x = -C.ITEM_RANGE - 12
  me.y = 0
  state.ball.x = 0
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0

  fireItem(state, me.id)
  assert.ok(Math.abs(state.ball.vx) < 1e-6)
  assert.equal(me.item, null)
})

test('a boot punts the nearest opponent, never a team-mate', () => {
  const state = rumbleGame()
  addCar(state, 3, C.TEAM_BLUE)
  const me = state.cars.find((c) => c.id === 1)
  const mate = state.cars.find((c) => c.id === 3)
  const foe = state.cars.find((c) => c.id === 2)
  hand(me, 'boot')

  me.x = 0
  me.y = 0
  // The team-mate is closer than the opponent, and must still be ignored.
  mate.x = 4
  mate.y = 0
  mate.vx = 0
  mate.vy = 0
  foe.x = 9
  foe.y = 0
  foe.vx = 0
  foe.vy = 0
  // Nothing must reach the ball and confuse the reading.
  state.ball.x = 0
  state.ball.y = C.MAX_Y - C.BALL_R

  fireItem(state, me.id)
  run(state, 10, () => 0)
  // Measured as ground covered rather than as a fraction of BOOT_IMPULSE: how
  // much of a shove survives depends on the victim's heading, since GRIP damps
  // sideways motion hard. Where they end up is the claim; the speed is not.
  assert.ok(foe.x > 9 + 2, 'the opponent is sent away')
  assert.ok(Math.abs(mate.x - 4) < 0.5, 'the team-mate is left alone')
})

test('a frozen ball hangs, and a touch frees it', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'freeze')
  me.x = -20
  me.y = 0
  state.ball.x = 0
  state.ball.y = 0
  state.ball.vx = 30
  state.ball.vy = 0

  fireItem(state, me.id)
  assert.equal(state.ball.vx, 0, 'stopped dead')

  run(state, 60, () => 0)
  assert.ok(Math.abs(state.ball.x) < 1e-6, 'and it stays where it was held')
  assert.ok(state.ball.freeze > 0)

  // A car reaching it breaks the hold rather than bouncing off a fixed ball.
  const foe = state.cars[1]
  foe.x = C.BALL_R + C.CAR_R - 0.2
  foe.y = 0
  foe.vx = -20
  foe.vy = 0
  step(state, {})
  assert.equal(state.ball.freeze, 0, 'a touch frees it')
  step(state, {})
  assert.ok(state.ball.vx < 0, 'and the touch moves it')
})

test('a freeze wears off on its own', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'freeze')
  me.x = -20
  me.y = -20
  state.ball.x = 0
  state.ball.y = 0

  fireItem(state, me.id)
  run(state, Math.ceil(C.FREEZE_SECONDS * C.TICK_HZ) + 5, () => 0)
  assert.equal(state.ball.freeze, 0)
})

test('a grappling hook winches the car into the ball at full speed', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  state.cars[1].y = C.MAX_Y - C.CAR_R // out of the way
  hand(me, 'hook')
  me.x = -30
  me.y = 0
  me.heading = Math.PI // pointed away: the winch must not care
  me.vx = 0
  me.vy = 0
  state.ball.x = 0
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0

  const gap = Math.abs(state.ball.x - me.x)
  fireItem(state, me.id)
  run(state, 10, () => 0)
  // Full boost pace from a standing start, facing the wrong way: an
  // accelerating pull could not do this, grip would eat most of it.
  assert.ok(Math.hypot(me.vx, me.vy) > C.HOOK_SPEED * 0.9, 'winched at full speed')

  // It arrives, and lets go on arrival. Measured by when the hook clears rather
  // than by the gap at the end: reaching the ball at boost pace launches it, so
  // the distance between the two opens up again straight afterwards.
  let ticks = 10
  while (me.hook > 0 && ticks < C.HOOK_SECONDS * C.TICK_HZ * 2) {
    run(state, 1, () => 0)
    ticks++
  }
  assert.equal(me.hook, 0, 'it lets go once it gets there')
  assert.equal(state.ball.lastTouch, me.id, 'because it got there')
  // Thirty metres at boost pace is well under a second.
  assert.ok(ticks < C.TICK_HZ, `arrived in ${ticks} ticks`)
  assert.ok(gap > 25, 'from across the pitch')
})

test('a magnetizer drags the ball toward the car, but only in range', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'magnet')
  me.x = 0
  me.y = 0
  state.ball.x = C.MAGNET_RANGE + 6
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0

  fireItem(state, me.id)
  run(state, 30, () => 0)
  assert.ok(Math.abs(state.ball.vx) < 1e-6, 'out of reach, so nothing moves')

  state.ball.x = 10
  run(state, 30, () => 0)
  assert.ok(state.ball.vx < -1, 'in reach, so it comes to you')
})

test('kickoff clears whatever anyone was holding', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'magnet')
  me.magnet = C.MAGNET_SECONDS

  // Score, which resets positions on the way back to kickoff.
  state.ball.x = C.MAX_X - C.BALL_R - 0.1
  state.ball.y = 0
  state.ball.vx = 40
  run(state, Math.ceil((C.GOAL_SECONDS + 0.5) * C.TICK_HZ), () => 0)

  assert.equal(me.item, null)
  assert.equal(me.magnet, 0)
  assert.equal(state.ball.freeze, 0)
})

test('firing marks the car for long enough to be drawn', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'haymaker')
  me.x = -10
  me.y = 0
  state.ball.x = 0
  state.ball.y = 0

  assert.equal(me.fx, null)
  fireItem(state, me.id)
  assert.equal(ITEMS[me.fx].key, 'haymaker')
  // Long enough that a peer reading snapshots at SNAPSHOT_HZ cannot miss it.
  assert.ok(me.fxTimer * C.SNAPSHOT_HZ > 3)

  run(state, Math.ceil(C.FX_SECONDS * C.TICK_HZ) + 2, () => 0)
  assert.equal(me.fx, null, 'and it clears itself')
  assert.equal(me.fxTimer, 0)
})

test('a boot marks the car it lands on, not just the one that fired', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  const foe = state.cars[1]
  hand(me, 'boot')
  me.x = 0
  me.y = 0
  foe.x = 8
  foe.y = 0
  state.ball.x = 0
  state.ball.y = C.MAX_Y - C.BALL_R // out of the way

  fireItem(state, me.id)
  assert.equal(ITEMS[foe.fx].key, 'boot', 'the victim is marked where it landed')
  assert.equal(ITEMS[me.fx].key, 'boot')
})

test('a fluffed item still marks the car that spent it', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  hand(me, 'haymaker')
  me.x = -C.ITEM_RANGE - 15 // nowhere near the ball
  me.y = 0
  state.ball.x = 0
  state.ball.y = 0

  fireItem(state, me.id)
  assert.notEqual(me.fx, null, 'spending it should look like something happened')
})

test('a disruptor jams an opponent wide open', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  const foe = state.cars[1]
  hand(me, 'disruptor')
  me.x = 0
  me.y = 0
  foe.x = 8
  foe.y = 0
  foe.heading = 0
  foe.vx = 0
  foe.vy = 0
  state.ball.x = 0
  state.ball.y = C.MAX_Y - C.BALL_R // out of the way

  fireItem(state, me.id)
  assert.ok(foe.disrupt > 0)

  // Flat out despite the brake being held, and the steering still answers.
  const before = foe.x
  for (let t = 0; t < 40; t++) tickWith(state, foe.id, C.IN_BACK)
  assert.ok(foe.x > before + 2, 'the throttle is not its own any more')

  run(state, Math.ceil(C.DISRUPT_SECONDS * C.TICK_HZ), () => 0)
  assert.equal(foe.disrupt, 0, 'and it wears off')
})

test('a swapper trades places across the pitch', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  const foe = state.cars[1]
  hand(me, 'swapper')
  me.x = -30
  me.y = -10
  foe.x = 30
  foe.y = 12
  // Well beyond anything else's reach: distance is the point of this one.
  assert.ok(Math.hypot(foe.x - me.x, foe.y - me.y) > C.ITEM_RANGE)

  fireItem(state, me.id)
  assert.ok(me.x > 20, 'we are where they were')
  assert.ok(foe.x < -20, 'and they are where we were')
})

test('a spiked ball rides the car and can be carried in', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  const foe = state.cars[1]
  foe.x = 0
  foe.y = C.MAX_Y - C.CAR_R // out of the way
  hand(me, 'spike')

  // Facing the orange goal, with the ball just ahead.
  me.x = 20
  me.y = 0
  me.heading = 0
  state.ball.x = me.x + C.CAR_R + C.BALL_R - 0.3
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0

  fireItem(state, me.id)
  assert.ok(me.spike > 0, 'armed')
  run(state, 3, () => 0)
  assert.equal(state.ball.stuckTo, me.id, 'and it welds on contact')

  // Drive at the goal: the ball goes with us, and crossing the line counts.
  const scoreBefore = state.score[C.TEAM_BLUE]
  run(state, 90, (t, id) => (id === me.id ? C.IN_FWD | C.IN_BOOST : 0))
  assert.ok(state.score[C.TEAM_BLUE] > scoreBefore, 'carried over the line')
})

test('a carried ball is knocked loose by anyone else reaching it', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  const foe = state.cars[1]
  hand(me, 'spike')
  me.x = 0
  me.y = 0
  me.heading = 0
  state.ball.x = C.CAR_R + C.BALL_R - 0.3
  state.ball.y = 0

  fireItem(state, me.id)
  run(state, 3, () => 0)
  assert.equal(state.ball.stuckTo, me.id)

  // The opponent arrives at the ball.
  foe.x = state.ball.x + C.BALL_R + C.CAR_R - 0.2
  foe.y = 0
  foe.vx = -25
  foe.vy = 0
  step(state, {})
  assert.equal(state.ball.stuckTo, null, 'a challenge frees it')
})

test('a spike lets go when its time is up', () => {
  const state = rumbleGame()
  const me = state.cars[0]
  state.cars[1].y = C.MAX_Y - C.CAR_R
  hand(me, 'spike')
  me.x = 0
  me.y = 0
  me.heading = 0
  state.ball.x = C.CAR_R + C.BALL_R - 0.3
  state.ball.y = 0

  fireItem(state, me.id)
  run(state, 3, () => 0)
  assert.equal(state.ball.stuckTo, me.id)

  run(state, Math.ceil(C.SPIKE_SECONDS * C.TICK_HZ) + 5, () => 0)
  assert.equal(state.ball.stuckTo, null)
})

test('a tornado drags opponents and the ball, but not team-mates', () => {
  const state = rumbleGame()
  addCar(state, 3, C.TEAM_BLUE)
  const me = state.cars.find((c) => c.id === 1)
  const foe = state.cars.find((c) => c.id === 2)
  const mate = state.cars.find((c) => c.id === 3)
  hand(me, 'tornado')

  me.x = 0
  me.y = 0
  for (const c of [foe, mate]) {
    c.x = 8
    c.y = 0
    c.vx = 0
    c.vy = 0
  }
  state.ball.x = -8
  state.ball.y = 0
  state.ball.vx = 0
  state.ball.vy = 0

  fireItem(state, me.id)
  run(state, 20, () => 0)
  assert.ok(Math.hypot(foe.vx, foe.vy) > 1, 'the opponent is caught')
  assert.ok(Math.hypot(state.ball.vx, state.ball.vy) > 1, 'and so is the ball')
  assert.ok(Math.hypot(mate.vx, mate.vy) < 0.5, 'a team-mate is left out of it')
})

test('nine items still deal reproducibly', () => {
  const a = run(rumbleGame(4242), 1200, scriptedBits)
  const b = run(rumbleGame(4242), 1200, scriptedBits)
  assert.equal(hashState(a), hashState(b))
})

test('the item bit survives the protocol', () => {
  const msg = parse({ t: 'input', cid: 'x', seq: 1, bits: C.IN_ITEM })
  assert.equal(msg.bits, C.IN_ITEM)
  assert.equal(parse({ t: 'input', cid: 'x', seq: 1, bits: C.IN_ALL + 1 }), null)
})

test('a refused rename says which rule it broke', () => {
  // A clash is refused rather than suffixed the way sign-up does it.
  assert.equal(renameProblem({ code: '23505' }), 'That name is taken')
  assert.equal(renameProblem({ code: '23514' }), 'Two to sixteen characters')
  // Anything else is passed through rather than dressed up as a rule.
  assert.equal(renameProblem({ code: '42501', message: 'permission denied' }), 'permission denied')
})
