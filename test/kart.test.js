import test from 'node:test'
import assert from 'node:assert/strict'
import { IN_FWD, IN_ITEM, IN_LEFT } from '../shared/constants.js'
import {
  createRace,
  addKart,
  removeKart,
  begin,
  step,
  hashRace,
  project,
  pointAt,
  boxSpots,
  ITEMS,
  TRACK,
  LAPS,
  HALF_WIDTH,
  KERB,
  KART_R,
} from '../shared/kart.js'

const field = (n = 6) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `k${i + 1}`, ai: i > 0 }))

/** A race with the lights already out. Every test but the waiting-room one. */
const started = (n = 6, seed = 1) => {
  const state = createRace(field(n), seed)
  begin(state)
  return state
}

const run = (state, ticks, inputs = {}) => {
  for (let i = 0; i < ticks; i++) step(state, inputs)
  return state
}

test('the circuit closes and every point projects back onto it', () => {
  assert.ok(TRACK.length > 500)
  for (let i = 0; i < 20; i++) {
    const s = (i / 20) * TRACK.length
    const p = pointAt(s)
    const back = project(p.x, p.y)
    assert.ok(Math.abs(back.lateral) < 0.5, `lateral ${back.lateral}`)
    assert.ok(Math.abs(back.s - s) < 6, `s ${back.s} vs ${s}`)
  }
})

test('the countdown holds the field, then releases it', () => {
  const state = started(6, 1)
  const startX = state.karts[1].x
  run(state, 60, { 1: IN_FWD })
  assert.equal(state.phase, 'COUNT')
  assert.equal(state.karts[1].x, startX)
  run(state, 140, { 1: IN_FWD })
  assert.equal(state.phase, 'RACE')
  assert.notEqual(state.karts[1].x, startX)
})

test('a race that the player never finishes still ends', () => {
  const state = started(6, 21)
  // Kart 1 is handed no input at all: it sits on the grid while the AI race.
  for (let i = 0; i < 60 * 400 && state.phase !== 'OVER'; i++) step(state, {})
  assert.equal(state.phase, 'OVER')
  assert.equal(state.karts[0].finished, null)
})

test('the same seed and inputs give the same race', () => {
  const a = run(started(6, 99), 1200, { 1: IN_FWD | IN_LEFT })
  const b = run(started(6, 99), 1200, { 1: IN_FWD | IN_LEFT })
  assert.equal(hashRace(a), hashRace(b))
  const c = run(started(6, 100), 1200, { 1: IN_FWD | IN_LEFT })
  assert.notEqual(hashRace(a), hashRace(c))
})

test('an AI field completes three laps and is placed in finishing order', () => {
  const state = createRace(field().map((r) => ({ ...r, ai: true })), 7)
  begin(state)
  for (let i = 0; i < 60 * 400 && state.phase !== 'OVER'; i++) step(state, {})
  assert.equal(state.phase, 'OVER')
  const winner = state.karts.find((k) => k.place === 1)
  assert.equal(winner.id, state.finishers[0])
  assert.ok(winner.lap >= LAPS, `winner on lap ${winner.lap}`)
  // Places are the finishing order, and anyone still out on the circuit when
  // the flag falls is placed behind everyone who crossed.
  const places = [...state.karts].sort((a, b) => a.place - b.place)
  places.forEach((k, i) => assert.equal(k.place, i + 1))
  const crossed = places.filter((k) => k.finished !== null)
  crossed.forEach((k, i) => assert.equal(k.place, i + 1))
  crossed.slice(1).forEach((k, i) => assert.ok(k.finished >= crossed[i].finished))
})

test('nothing leaves the circuit, however hard it is driven at the barrier', () => {
  const state = started(2, 3)
  run(state, 60 * 30, { 1: IN_FWD | IN_LEFT })
  for (const kart of state.karts) {
    const hit = project(kart.x, kart.y)
    assert.ok(Math.abs(hit.lateral) <= HALF_WIDTH + KERB - KART_R + 0.5, `off track: ${hit.lateral}`)
  }
})

test('a box hands out an item, then goes on cooldown', () => {
  const state = started(1, 5)
  const me = state.karts[0]
  const spot = boxSpots()[0]
  state.phase = 'RACE'
  me.x = spot.x
  me.y = spot.y
  step(state, {})
  assert.ok(me.item !== null)
  const box = state.boxes.find((b) => b.x === spot.x && b.y === spot.y)
  assert.ok(box.cooldown > 0)
})

test('a banana is dropped behind, and spins out whoever finds it', () => {
  const state = started(2, 5)
  state.phase = 'RACE'
  const me = state.karts[0]
  const other = state.karts[1]
  me.item = ITEMS.findIndex((i) => i.key === 'banana')
  step(state, { 1: IN_ITEM })
  assert.equal(state.hazards.length, 1)

  const banana = state.hazards[0]
  other.x = banana.x
  other.y = banana.y
  step(state, {})
  assert.ok(other.spin > 0)
  assert.equal(state.hazards.length, 0)
})

test('a red shell chases the kart ahead and takes it out', () => {
  const state = started(2, 11)
  state.phase = 'RACE'
  const me = state.karts[0]
  const ahead = state.karts[1]
  // Put the target up the road, off to one side so a straight shot would miss.
  const here = pointAt(0)
  me.x = here.x
  me.y = here.y
  me.heading = Math.atan2(here.ty, here.tx)
  me.prog = 0
  const there = pointAt(50)
  ahead.x = there.x + there.nx * 6
  ahead.y = there.y + there.ny * 6
  ahead.prog = 50
  ahead.vx = 0
  ahead.vy = 0

  me.item = ITEMS.findIndex((i) => i.key === 'red')
  step(state, { 1: IN_ITEM })
  assert.equal(state.shells.length, 1)
  assert.equal(state.shells[0].target, ahead.id)
  for (let i = 0; i < 120 && ahead.spin === 0; i++) step(state, {})
  assert.ok(ahead.spin > 0, 'the shell never arrived')
})

test('a bolt shrinks everyone else and leaves a star alone', () => {
  const state = started(3, 13)
  state.phase = 'RACE'
  const [me, victim, starred] = state.karts
  starred.star = 5
  me.item = ITEMS.findIndex((i) => i.key === 'bolt')
  step(state, { 1: IN_ITEM })
  assert.ok(victim.shrink > 0)
  assert.equal(starred.shrink, 0)
  assert.equal(me.shrink, 0)
})

test('the roll favours the back of the field', () => {
  const front = { 1: 0, 2: 0 }
  const back = { 1: 0, 2: 0 }
  for (const [place, tally] of [[1, front], [6, back]]) {
    const state = started(6, 4)
    state.phase = 'RACE'
    const me = state.karts[0]
    for (let i = 0; i < 400; i++) {
      me.place = place
      me.item = null
      const spot = boxSpots()[i % boxSpots().length]
      state.boxes.forEach((b) => (b.cooldown = 0))
      me.x = spot.x
      me.y = spot.y
      step(state, {})
      if (me.item !== null) tally[ITEMS[me.item].key === 'banana' ? 1 : 2]++
    }
  }
  // Bananas are a leader's item, so the front of the field should see far more.
  assert.ok(front[1] > back[1], `${front[1]} vs ${back[1]}`)
})

test('a lap only turns over on the line, not on a lateral wobble', () => {
  const state = started(1, 2)
  state.phase = 'RACE'
  const me = state.karts[0]
  const p = pointAt(TRACK.length - 5)
  me.x = p.x
  me.y = p.y
  me.prog = TRACK.length - 5
  me.s = TRACK.length - 5
  me.heading = Math.atan2(p.ty, p.tx)
  run(state, 40, { 1: IN_FWD })
  assert.equal(me.lap, 1, `prog ${me.prog}`)
})

test('a kart can be seated and dropped while the grid waits', () => {
  const state = createRace([{ id: 1, name: 'host' }], 3)
  assert.equal(state.phase, 'WAITING')
  const joined = addKart(state, { id: 2, name: 'joiner' })
  assert.equal(state.karts.length, 2)
  // Second on the grid, so not on top of the kart already there.
  assert.ok(Math.hypot(joined.x - state.karts[0].x, joined.y - state.karts[0].y) > 4)
  // Nothing moves until the host starts it.
  run(state, 120, { 1: IN_FWD })
  assert.equal(state.karts[0].prog, -8)
  removeKart(state, 2)
  assert.equal(state.karts.length, 1)
  begin(state)
  run(state, 300, { 1: IN_FWD }) // the lights take three seconds of that
  assert.ok(state.karts[0].prog > -8)
})

test('the flag falls as soon as every person is home', () => {
  const state = started(3, 17)
  const [me, ai] = [state.karts[0], state.karts[1]]
  ai.ai = true
  state.karts[2].ai = true
  // Put the human on the line with the lap already behind it.
  me.prog = state.laps * TRACK.length - 2
  const p = pointAt(TRACK.length - 2)
  me.x = p.x
  me.y = p.y
  me.s = TRACK.length - 2
  me.heading = Math.atan2(p.ty, p.tx)
  run(state, 60 * 4, { 1: IN_FWD })
  assert.equal(state.phase, 'OVER')
  assert.equal(state.karts[0].place, 1)
  // The AI are still out there, and are placed on how far they got.
  assert.equal(ai.finished, null)
  assert.ok(ai.place > 1)
})
