import test from 'node:test'
import assert from 'node:assert/strict'
import * as C from '../shared/constants.js'
import * as K from '../shared/kart.js'
import { autoThrottleWanted } from '../client/kart-touch.js'

// A phone has no throttle pad — the game holds it. Which means this predicate is
// the throttle: written inline it compared the phase against 'RACING', a phase
// this sim does not have, so it was a constant false and the kart would not move
// while the HUD said "throttle is held for you". Nothing in a screenshot catches
// that, so the check runs a real race and asks the sim what its phases are.

function racing() {
  const race = K.createRace([{ id: 'me', name: 'Finn' }], 1)
  K.begin(race)
  // Past the lights. The countdown is a few seconds at DT a step.
  for (let i = 0; i < 600 && race.phase === 'COUNT'; i++) K.step(race, {})
  return race
}

test('the throttle comes on once the lights go out', () => {
  const race = racing()
  assert.notEqual(race.phase, 'COUNT', 'the countdown should be over by now')
  const me = race.karts[0]
  assert.equal(autoThrottleWanted(race, me), true, `phase was ${race.phase}`)
})

test('the throttle is off on the grid', () => {
  const race = K.createRace([{ id: 'me', name: 'Finn' }], 1)
  assert.equal(autoThrottleWanted(race, race.karts[0]), false)
  K.begin(race)
  assert.equal(autoThrottleWanted(race, race.karts[0]), false, 'not during the countdown either')
})

test('the throttle is off while stopped, resuming, home, and seated out', () => {
  const race = racing()
  const me = race.karts[0]

  race.paused = true
  assert.equal(autoThrottleWanted(race, me), false, 'paused')
  race.paused = false

  race.resumeIn = 3
  assert.equal(autoThrottleWanted(race, me), false, 'counting back in')
  race.resumeIn = 0

  me.finished = 42.5
  assert.equal(autoThrottleWanted(race, me), false, 'already home')
  me.finished = null

  assert.equal(autoThrottleWanted(race, undefined), false, 'no kart to drive')
  assert.equal(autoThrottleWanted(race, me), true, 'and back on once none of that holds')
})

test('a held throttle is what actually moves the kart', () => {
  const race = racing()
  const me = race.karts[0]
  const before = Math.hypot(me.vx, me.vy)
  for (let i = 0; i < 60; i++) K.step(race, { me: C.IN_FWD })
  assert.ok(
    Math.hypot(me.vx, me.vy) > before + 1,
    'IN_FWD for a second should be worth more than a metre a second',
  )
})
