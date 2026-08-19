import test from 'node:test'
import assert from 'node:assert/strict'
import { IN_FWD, IN_ITEM, IN_LEFT, IN_RIGHT, IN_DRIFT } from '../shared/constants.js'
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
  padSpots,
  heightAt,
  slopeAt,
  halfWidthAt,
  overVoid,
  VOIDS,
  RESPAWN_SECONDS,
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
  assert.ok(TRACK.length > 1100, `the circuit is only ${TRACK.length.toFixed(0)}m`)
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
  for (let i = 0; i < 60 * 700 && state.phase !== 'OVER'; i++) step(state, {})
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
  for (let i = 0; i < 60 * 700 && state.phase !== 'OVER'; i++) step(state, {})
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
    // A kart being fished out is off the road by definition; everyone else is
    // held inside the barrier, at whatever width the road is there.
    if (kart.respawn > 0) continue
    const hit = project(kart.x, kart.y)
    const limit = halfWidthAt(hit.s) + KERB - KART_R + 0.5
    assert.ok(Math.abs(hit.lateral) <= limit, `off track: ${hit.lateral} at ${hit.s}`)
  }
})

test('the road is not the same width all the way round', () => {
  const widths = []
  for (let i = 0; i < 40; i++) widths.push(halfWidthAt((i / 40) * TRACK.length))
  assert.ok(Math.max(...widths) - Math.min(...widths) > 3, 'the circuit is a constant-width loop')
  // The grid needs the full width: six karts line up across the start line.
  assert.equal(halfWidthAt(0), Math.max(...widths))
})

test('driving off a void is a fall, a wait, and a drop back onto the road', () => {
  const state = started(1, 3)
  run(state, 200) // the lights, which the karts sit still through
  const kart = state.karts[0]
  // Into the middle of the first drop, pointed straight at the edge.
  const s = TRACK.length * ((VOIDS[0][0] + VOIDS[0][1]) / 2)
  const p = pointAt(s)
  assert.ok(overVoid(s))
  kart.x = p.x
  kart.y = p.y
  kart.s = s
  kart.prog = s
  kart.heading = Math.atan2(p.ny, p.nx)
  const before = kart.prog

  for (let i = 0; i < 180 && kart.respawn === 0; i++) step(state, { 1: IN_FWD })
  assert.equal(kart.respawn, RESPAWN_SECONDS, 'never went over the edge')

  // Held: the throttle does nothing while it waits.
  const [x, y] = [kart.x, kart.y]
  run(state, 30, { 1: IN_FWD | IN_LEFT })
  assert.equal(kart.x, x)
  assert.equal(kart.y, y)
  assert.ok(kart.respawn > 0)

  for (let i = 0; i < 300 && kart.respawn > 0; i++) step(state, {})
  const hit = project(kart.x, kart.y)
  assert.ok(Math.abs(hit.lateral) <= halfWidthAt(hit.s), `dropped off the road: ${hit.lateral}`)
  // The fall costs the metres it was worth, rather than crediting them.
  assert.ok(kart.prog < before, `progress went up: ${before} -> ${kart.prog}`)
})

test('a fall cannot happen where there is a barrier', () => {
  const state = started(1, 3)
  run(state, 200)
  const kart = state.karts[0]
  // A stretch with kerb and wall, driven straight at the edge for a good while.
  const s = TRACK.length * 0.4
  assert.equal(overVoid(s), false)
  const p = pointAt(s)
  kart.x = p.x
  kart.y = p.y
  kart.s = s
  kart.prog = s
  kart.heading = Math.atan2(p.ny, p.nx)
  run(state, 60 * 5, { 1: IN_FWD })
  assert.equal(kart.respawn, 0)
})

test('a kart being fished out is out of the game while it waits', () => {
  const state = started(2, 3)
  run(state, 200)
  const [kart, other] = state.karts
  kart.respawn = RESPAWN_SECONDS
  kart.recoverAt = 40
  other.x = kart.x
  other.y = kart.y
  other.item = ITEMS.findIndex((i) => i.key === 'green')
  other.heading = 0
  step(state, { 2: IN_ITEM })
  run(state, 30, {})
  assert.equal(kart.spin, 0, 'a held kart was hit by a shell')
  assert.equal(kart.item, null, 'a held kart collected a box')
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

const holding = (kart, key) => {
  kart.item = ITEMS.findIndex((i) => i.key === key)
  kart.itemCount = ITEMS[kart.item].count ?? 1
}

test('a triple is one item spent three times', () => {
  const state = started(1, 21)
  state.phase = 'RACE'
  const me = state.karts[0]
  holding(me, 'banana3')
  for (let i = 1; i <= 3; i++) {
    step(state, { 1: IN_ITEM })
    step(state, {})
    assert.equal(state.hazards.length, i, `throw ${i}`)
    if (i < 3) assert.ok(me.item !== null, 'the slot emptied early')
  }
  assert.equal(me.item, null, 'the slot held on past the third')
})

test('a bob-omb catches everything standing near it', () => {
  const state = started(3, 22)
  state.phase = 'RACE'
  const [me, near, far] = state.karts
  holding(me, 'bomb')
  step(state, { 1: IN_ITEM })
  const bomb = state.hazards[0]
  // Parked either side of it, so this is the blast reaching them rather than
  // the AI driving into it.
  near.ai = false
  far.ai = false
  let hitNear = false
  let hitFar = false
  for (let i = 0; i < 250 && state.hazards.length; i++) {
    near.x = bomb.x + 6
    near.y = bomb.y
    far.x = bomb.x + 40
    far.y = bomb.y
    step(state, {})
    hitNear ||= near.spin > 0
    hitFar ||= far.spin > 0
  }
  assert.equal(state.hazards.length, 0, 'the bomb never went off')
  assert.ok(hitNear, 'the blast missed a kart beside it')
  assert.ok(!hitFar, 'the blast reached across the circuit')
})

test('a POW spins everyone ahead and nobody behind', () => {
  const state = started(3, 23)
  state.phase = 'RACE'
  const [me, ahead, behind] = state.karts
  me.prog = 100
  ahead.prog = 200
  behind.prog = 50
  holding(me, 'pow')
  step(state, { 1: IN_ITEM })
  assert.ok(ahead.spin > 0)
  assert.equal(behind.spin, 0)
  assert.equal(me.spin, 0)
})

test('a spiny shell goes for the leader, not the kart in front of you', () => {
  const state = started(3, 24)
  state.phase = 'RACE'
  const [me, next, leader] = state.karts
  me.prog = 10
  next.prog = 60
  leader.prog = 400
  holding(me, 'blue')
  step(state, { 1: IN_ITEM })
  assert.equal(state.shells[0].target, leader.id)
})

test('a thundercloud is passed on by a bump, and shrinks whoever is left with it', () => {
  const state = started(2, 25)
  state.phase = 'RACE'
  const [me, other] = state.karts
  holding(me, 'cloud')
  step(state, { 1: IN_ITEM })
  assert.ok(me.cloud > 0)
  other.x = me.x + KART_R
  other.y = me.y
  step(state, {})
  assert.equal(me.cloud, 0, 'the cloud stayed put')
  assert.ok(other.cloud > 0)
  // Left holding it: it goes off, and shrinks them.
  other.cloud = 0.02
  run(state, 3, {})
  assert.ok(other.shrink > 0)
})

test('a mega mushroom squashes what it touches and shrugs off a shell', () => {
  const state = started(2, 26)
  state.phase = 'RACE'
  const [me, other] = state.karts
  holding(me, 'mega')
  step(state, { 1: IN_ITEM })
  assert.ok(me.mega > 0)
  other.x = me.x + KART_R
  other.y = me.y
  other.vx = 0
  other.vy = 0
  step(state, {})
  assert.ok(other.spin > 0, 'a mega drove through a kart and left it alone')
  holding(other, 'green')
  other.heading = Math.atan2(me.y - other.y, me.x - other.x)
  for (let i = 0; i < 20; i++) step(state, { 2: IN_ITEM })
  assert.equal(me.spin, 0, 'a shell stopped a mega')
})

test('a bullet bill flies the line at a speed nothing else has', () => {
  const state = started(1, 27)
  state.phase = 'RACE'
  const me = state.karts[0]
  holding(me, 'bullet')
  step(state, { 1: IN_ITEM })
  run(state, 60, {})
  assert.ok(Math.hypot(me.vx, me.vy) > 70, `speed ${Math.hypot(me.vx, me.vy)}`)
  // On the road, not through the barrier: it holds the racing line for you.
  const hit = project(me.x, me.y)
  assert.ok(Math.abs(hit.lateral) < halfWidthAt(hit.s), `lateral ${hit.lateral}`)
})

test('the leader never rolls a comeback item', () => {
  const state = started(6, 28)
  state.phase = 'RACE'
  const me = state.karts[0]
  const seen = new Set()
  for (let i = 0; i < 400; i++) {
    me.place = 1
    me.item = null
    const spot = boxSpots()[i % boxSpots().length]
    state.boxes.forEach((b) => (b.cooldown = 0))
    me.x = spot.x
    me.y = spot.y
    step(state, {})
    if (me.item !== null) seen.add(ITEMS[me.item].key)
  }
  for (const key of ['star', 'bullet', 'bolt', 'gold', 'blue', 'red']) {
    assert.ok(!seen.has(key), `the leader was handed a ${key}`)
  }
  assert.ok(seen.has('banana') && seen.has('green'), [...seen].join(','))
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
      if (me.item === null) continue
      const key = ITEMS[me.item].key
      // The basics you throw behind you, against the ones that close a gap.
      if (key === 'banana' || key === 'green') tally[1]++
      if (key === 'red' || key === 'bolt' || key === 'star') tally[2]++
    }
  }
  // Leading, it should be nearly all bananas and green shells; at the back,
  // nearly none of them and most of the chasing ones.
  assert.ok(front[1] > back[1] * 3, `basics: ${front[1]} vs ${back[1]}`)
  assert.ok(back[2] > front[2] * 3, `strong: ${back[2]} vs ${front[2]}`)
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

test('a shell fired on a Turbo does not run its own kart over', () => {
  const state = started(1, 8)
  state.phase = 'RACE' // past the lights
  const me = state.karts[0]
  // Up to boost pace, pointed down the road, with a green shell in hand.
  const p = pointAt(40)
  me.x = p.x
  me.y = p.y
  me.s = 40
  me.heading = Math.atan2(p.ty, p.tx)
  me.vx = p.tx * 56
  me.vy = p.ty * 56
  me.boost = 1.6
  me.item = ITEMS.findIndex((i) => i.key === 'green')

  step(state, { 1: IN_FWD | IN_ITEM })
  assert.equal(state.shells.length, 1)
  // The shell has to be quicker than the kart that fired it, or the kart drives
  // into it the moment its own immunity lapses.
  assert.ok(Math.hypot(state.shells[0].vx, state.shells[0].vy) > 56)
  run(state, 120, { 1: IN_FWD })
  assert.equal(me.spin, 0, 'spun itself out on its own shell')
})

test('the end of a Turbo bleeds off rather than cutting', () => {
  const state = started(1, 9)
  state.phase = 'RACE'
  const me = state.karts[0]
  const p = pointAt(40)
  me.x = p.x
  me.y = p.y
  me.s = 40
  me.heading = Math.atan2(p.ty, p.tx)
  me.vx = p.tx * 56
  me.vy = p.ty * 56
  me.boost = 0.02 // about to run out

  let last = Math.hypot(me.vx, me.vy)
  let worst = 0
  // Only the moment the Turbo runs out, and only for as long as the kart is
  // still on the tarmac: the grass has its own much harder cap, and drifting
  // onto it is not what this is about.
  for (let i = 0; i < 20; i++) {
    step(state, { 1: IN_FWD })
    const now = Math.hypot(me.vx, me.vy)
    worst = Math.max(worst, last - now)
    last = now
  }
  // No single tick may take a big bite: the old hard clamp took 18 m/s in one.
  assert.ok(worst < 3, `lost ${worst.toFixed(1)} m/s in a tick`)
  // And the speed is carried out of the boost rather than left behind in it.
  assert.ok(last > 40, `only doing ${last.toFixed(1)} a third of a second later`)
})

test('a kart that is home drives on down the road rather than into the barrier', () => {
  const state = started(2, 23)
  run(state, 190) // the lights, during which nothing moves
  const me = state.karts[0]
  const p = pointAt(TRACK.length - 4)
  me.x = p.x
  me.y = p.y
  me.s = TRACK.length - 4
  me.prog = state.laps * TRACK.length - 4
  me.heading = Math.atan2(p.ty, p.tx)
  me.vx = Math.cos(me.heading) * 20
  me.vy = Math.sin(me.heading) * 20
  // The other kart is an AI, so the race does not end the moment this one is
  // home and there is something to watch it do afterwards.
  state.karts[1].ai = true

  run(state, 30, { 1: IN_FWD })
  assert.notEqual(me.finished, null, 'never crossed the line')

  // Five seconds of nobody driving it: it should still be on the tarmac and
  // still moving, not parked against the wall with the throttle pinned.
  run(state, 60 * 5, {})
  const hit = project(me.x, me.y)
  assert.ok(Math.abs(hit.lateral) < HALF_WIDTH, `off the road at ${hit.lateral.toFixed(1)}m`)
  assert.ok(Math.hypot(me.vx, me.vy) > 5, 'parked')
})

test('a climb costs you speed, and the drop the other side gives it back', () => {
  // The steepest part of the profile either way, found from the gradient
  // itself so this does not have to know where the hills were put.
  let up = 0
  let down = 0
  for (let i = 0; i < 400; i++) {
    const s = (i / 400) * TRACK.length
    // Away from the drops: a kart put down on one of those has a fall to worry
    // about rather than a gradient.
    if (overVoid(s) || overVoid(s + 60)) continue
    if (slopeAt(s) > slopeAt(up)) up = s
    if (slopeAt(s) < slopeAt(down)) down = s
  }
  assert.ok(slopeAt(up) > 0.1, `too flat to test: ${slopeAt(up)}`)
  // A closed circuit has to meet itself, or the road would be a helix.
  assert.ok(Math.abs(heightAt(0) - heightAt(TRACK.length)) < 1e-9)

  const speedAfter = (from) => {
    const state = started(1, 31)
    run(state, 190) // the lights
    const kart = state.karts[0]
    const p = pointAt(from)
    kart.x = p.x
    kart.y = p.y
    kart.s = from
    kart.heading = Math.atan2(p.ty, p.tx)
    // Rolling, not stood still: from a standstill on a slope it slides
    // backwards off the road rather than driving anywhere.
    kart.vx = p.tx * 20
    kart.vy = p.ty * 20
    // Coasting rather than on the throttle. On full throttle both ends of the
    // circuit reach the speed cap and the hill is invisible in the number: with
    // the engine out of it, the gradient is the only thing acting.
    run(state, 60)
    return Math.hypot(kart.vx, kart.vy)
  }

  const uphill = speedAfter(up)
  const downhill = speedAfter(down)
  assert.ok(downhill > uphill + 1, `hill does nothing: ${uphill} vs ${downhill}`)
})

test('driving into a spinning kart shoves it out of the way', () => {
  const state = started(2, 5)
  const [me, other] = state.karts
  state.phase = 'RACE'
  const p = pointAt(200)
  // Nose to tail on the centre line, both pointing down the road, the one in
  // front spinning: the case that used to beach you.
  other.x = p.x
  other.y = p.y
  other.s = 200
  other.spin = 1
  me.x = p.x - p.tx * (KART_R * 1.6)
  me.y = p.y - p.ty * (KART_R * 1.6)
  me.heading = Math.atan2(p.ty, p.tx)
  me.vx = p.tx * 30
  me.vy = p.ty * 30
  const before = { x: other.x, y: other.y, speed: Math.hypot(me.vx, me.vy) }
  run(state, 12, { 1: IN_FWD })
  const moved = Math.hypot(other.x - before.x, other.y - before.y)
  const mine = Math.hypot(me.x - before.x, me.y - before.y)
  assert.ok(moved > 3, `the spinner barely moved: ${moved.toFixed(2)}m`)
  assert.ok(moved > mine * 0.5, 'the spinner moved less than half as far as its attacker')
  assert.ok(
    Math.hypot(me.vx, me.vy) > before.speed * 0.7,
    `driving through a spinner cost too much speed: ${Math.hypot(me.vx, me.vy).toFixed(1)}`,
  )
})

test('a mega mushroom shoves harder than it is shoved', () => {
  const state = started(2, 5)
  const [big, small] = state.karts
  state.phase = 'RACE'
  const p = pointAt(200)
  big.mega = 5
  big.x = p.x
  big.y = p.y
  small.x = p.x + p.nx * (KART_R * 2)
  small.y = p.y + p.ny * (KART_R * 2)
  small.star = 9 // so the mega squashing it does not end the test early
  const from = { bx: big.x, by: big.y, sx: small.x, sy: small.y }
  step(state, {})
  const bigMoved = Math.hypot(big.x - from.bx, big.y - from.by)
  const smallMoved = Math.hypot(small.x - from.sx, small.y - from.sy)
  assert.ok(smallMoved > bigMoved * 2, `mega moved ${bigMoved} vs ${smallMoved}`)
})

test('a spin-out ends with the kart pointing down the road', () => {
  const state = started(1, 5)
  const kart = state.karts[0]
  const p = pointAt(300)
  state.phase = 'RACE'
  kart.x = p.x
  kart.y = p.y
  kart.spin = 1.2
  kart.heading = Math.atan2(p.ty, p.tx) + Math.PI // backwards, mid-pirouette
  run(state, 100)
  assert.equal(kart.spin, 0)
  const here = pointAt(kart.s)
  const off = Math.abs(Math.atan2(
    Math.sin(kart.heading - Math.atan2(here.ty, here.tx)),
    Math.cos(kart.heading - Math.atan2(here.ty, here.tx)),
  ))
  assert.ok(off < 0.9, `left facing ${off.toFixed(2)} rad off the road`)
})

test('a kart just spun out cannot be spun out again straight away', () => {
  const state = started(1, 5)
  const kart = state.karts[0]
  kart.spin = 0.01
  state.phase = 'RACE'
  kart.grace = 2
  run(state, 2)
  assert.equal(kart.spin, 0)
  kart.grace = 0.5
  // A banana under the wheels while the grace is running does nothing.
  state.hazards.push({ kind: 'banana', x: kart.x, y: kart.y, owner: 99 })
  step(state, {})
  assert.equal(kart.spin, 0, 'hit through the grace period')
  run(state, 40) // grace runs down
  state.hazards.push({ kind: 'banana', x: kart.x, y: kart.y, owner: 99 })
  step(state, {})
  assert.ok(kart.spin > 0, 'still immune after the grace ran out')
})

test('a boost pad gives you a boost, and missing it does not', () => {
  const on = started(1, 9)
  on.phase = 'RACE'
  const pad = padSpots()[0]
  const kart = on.karts[0]
  kart.x = pad.x
  kart.y = pad.y
  kart.heading = pad.heading
  step(on, {})
  assert.ok(kart.boost > 1, `no boost on the pad: ${kart.boost}`)

  const off = started(1, 9)
  off.phase = 'RACE'
  const missed = off.karts[0]
  const p = pointAt(pad.s)
  // The same point on the road, but out at the far edge of the tarmac.
  const edge = halfWidthAt(pad.s) - 1
  missed.x = p.x + p.nx * (pad.lane > 0 ? -edge : edge)
  missed.y = p.y + p.ny * (pad.lane > 0 ? -edge : edge)
  missed.heading = pad.heading
  step(off, {})
  assert.equal(missed.boost, 0, 'the whole road is a boost pad')
})

test('no boost pad is laid over a drop', () => {
  for (const pad of padSpots()) assert.ok(!overVoid(pad.s), `pad over a void at ${pad.s}`)
})

test('holding a drift charges a mini-turbo, and releasing it spends it', () => {
  // Rolling into a drift with the wheel over. The charge is time, so the only
  // thing that varies between these is how long the drift is held.
  const held = (ticks) => {
    const state = started(1, 13)
    state.phase = 'RACE'
    const kart = state.karts[0]
    // Into the right-hander after the line, which is a corner a drift can
    // actually be held through.
    const p = pointAt(40)
    kart.x = p.x
    kart.y = p.y
    kart.heading = Math.atan2(p.ty, p.tx)
    kart.vx = p.tx * 30
    kart.vy = p.ty * 30
    run(state, ticks, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
    const charged = kart.driftCharge
    step(state, { 1: IN_FWD }) // let go
    return { charged, boost: kart.boost }
  }

  const short = held(20) // a third of a second — nothing earned
  assert.equal(short.charged, 0)
  assert.equal(short.boost, 0)

  const first = held(70) // past the first tier
  assert.equal(first.charged, 1)
  assert.ok(first.boost > 0.4 && first.boost < 0.7, `tier one gave ${first.boost}`)

  const second = held(130) // past the second
  assert.equal(second.charged, 2)
  assert.ok(second.boost > 0.8, `tier two gave ${second.boost}`)
  assert.ok(second.boost > first.boost, 'the second tier is not worth more')
})

test('a spin-out throws away a charged drift', () => {
  const state = started(1, 13)
  state.phase = 'RACE'
  const kart = state.karts[0]
  const p = pointAt(40)
  kart.x = p.x
  kart.y = p.y
  kart.heading = Math.atan2(p.ty, p.tx)
  kart.vx = p.tx * 30
  kart.vy = p.ty * 30
  run(state, 130, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
  assert.equal(kart.driftCharge, 2)
  state.hazards.push({ kind: 'banana', x: kart.x, y: kart.y, owner: 99 })
  step(state, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
  assert.ok(kart.spin > 0)
  assert.equal(kart.driftCharge, 0)
  assert.equal(kart.driftTime, 0)
  step(state, { 1: IN_FWD })
  assert.equal(kart.boost, 0, 'a spin-out paid out anyway')
})
