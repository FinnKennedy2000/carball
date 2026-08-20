import test from 'node:test'
import assert from 'node:assert/strict'
import { IN_FWD, IN_ITEM, IN_LEFT, IN_RIGHT, IN_DRIFT, IN_BOOST, IN_AIM } from '../shared/constants.js'
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
  driftTier,
  heightAt,
  slopeAt,
  halfWidthAt,
  overVoid,
  VOIDS,
  JUMPS,
  jumpAt,
  JUMP_AIRTIME,
  RESPAWN_SECONDS,
  ITEMS,
  TRACK,
  LAPS,
  HALF_WIDTH,
  KERB,
  KART_R,
  MAX_SPEED,
  CHASSIS_STATS,
  CHASSIS_KEYS,
  statsOf,
  radiusOf,
  setTrack,
  trackFor,
  activeTrack,
  TRACKS,
  TRACK_KEYS,
  DEFAULT_TRACK,
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

/**
 * A driver that holds the drift button down and trims with the wheel — aim at a
 * point up the road, nudge toward it — which is how a drift is actually held.
 * Feeding a fixed steering bit instead just parks the kart in the outside wall.
 */
const driftAlong = (state, kart, ticks, extra = 0) => {
  let peakSlip = 0
  for (let i = 0; i < ticks; i++) {
    const here = project(kart.x, kart.y)
    const look = pointAt(here.s + 10 + Math.hypot(kart.vx, kart.vy) * 0.35)
    let err = Math.atan2(look.y - kart.y, look.x - kart.x) - kart.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    let bits = IN_FWD | IN_DRIFT | extra
    if (err > 0.05) bits |= IN_RIGHT
    else if (err < -0.05) bits |= IN_LEFT
    step(state, { 1: bits })
    peakSlip = Math.max(peakSlip, slipDeg(kart))
  }
  return peakSlip
}

/** How far the nose leads the direction of travel, in degrees: the slide. */
const slipDeg = (kart) =>
  Math.abs(
    Math.atan2(
      kart.vx * -Math.sin(kart.heading) + kart.vy * Math.cos(kart.heading),
      kart.vx * Math.cos(kart.heading) + kart.vy * Math.sin(kart.heading)
    )
  ) * (180 / Math.PI)

/** On the racing line at `s`, at speed, pointing the right way. */
const onLine = (kart, s, speed = 30) => {
  const p = pointAt(s)
  kart.x = p.x
  kart.y = p.y
  kart.heading = Math.atan2(p.ty, p.tx)
  kart.vx = p.tx * speed
  kart.vy = p.ty * speed
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

test('the road stops at a jump: quick enough clears it, slow enough falls in', () => {
  // Two jumps break the tarmac outright. The gap is a distance and the flight is
  // a time, so between them they are a speed you have to be doing at the lip.
  const mid = ((JUMPS[0][0] + JUMPS[0][1]) / 2) * TRACK.length
  const [from, to] = jumpAt(mid)
  const gap = to - from
  assert.ok(gap / JUMP_AIRTIME < 38, `no speed on the circuit clears a ${gap.toFixed(0)}m gap`)

  const over = (speed) => {
    const state = started(1, 5)
    state.phase = 'RACE'
    const kart = state.karts[0]
    onLine(kart, from - 12, speed)
    kart.prog = from - 12
    let flew = false
    for (let i = 0; i < 60 * 6 && kart.respawn === 0; i++) {
      step(state, { 1: IN_FWD })
      if (kart.air > 0) flew = true
      if (kart.air === 0 && flew && kart.respawn === 0) break
    }
    return { flew, fell: kart.respawn > 0, kart }
  }

  const cleared = over(36)
  assert.ok(cleared.flew, 'the kart drove across thin air')
  assert.ok(!cleared.fell, 'flat out over the lip and it still landed short')
  assert.ok(!jumpAt(project(cleared.kart.x, cleared.kart.y).s), 'it came down in the gap')

  const short = over(8)
  assert.ok(short.flew, 'crawling off the lip did not leave the ground')
  assert.ok(short.fell, 'a crawl carried it over a 40m gap')
  // Put back on the road before the lip, not on the nothing it fell into.
  assert.equal(jumpAt(short.kart.recoverAt), null)
})

test('a fall cannot happen where there is a barrier', () => {
  const state = started(1, 3)
  run(state, 200)
  const kart = state.karts[0]
  // A stretch with kerb and wall, driven straight at the edge for a good while.
  const s = TRACK.length * 0.05
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

test('holding the aim key fires out the back and lobs a peel up the road', () => {
  const state = started(1, 17)
  state.phase = 'RACE'
  const me = state.karts[0]
  const here = pointAt(0)
  me.x = here.x
  me.y = here.y
  me.heading = Math.atan2(here.ty, here.tx)
  const fx = Math.cos(me.heading)
  const fy = Math.sin(me.heading)

  me.item = ITEMS.findIndex((i) => i.key === 'green')
  me.itemCount = 1
  step(state, { 1: IN_ITEM | IN_AIM })
  assert.equal(state.shells.length, 1)
  const shell = state.shells[0]
  assert.ok(shell.vx * fx + shell.vy * fy < 0, 'the shell went forwards')
  assert.ok((shell.x - me.x) * fx + (shell.y - me.y) * fy < 0, 'it left from the nose')

  // Fire the same item forwards and it goes the other way, so the flip is the
  // key and not the item.
  me.item = ITEMS.findIndex((i) => i.key === 'green')
  me.itemCount = 1
  me.itemDown = false
  step(state, { 1: IN_ITEM })
  assert.ok(state.shells[1].vx * fx + state.shells[1].vy * fy > 0)

  // A lobbed peel lands ahead, and does not catch the kart that threw it while
  // it is still arming.
  me.item = ITEMS.findIndex((i) => i.key === 'banana')
  me.itemCount = 1
  me.itemDown = false
  step(state, { 1: IN_ITEM | IN_AIM })
  const peel = state.hazards[0]
  assert.ok((peel.x - me.x) * fx + (peel.y - me.y) * fy > 0, 'the peel landed behind')
  assert.ok(peel.arm > 0)
  assert.equal(me.spin, 0, 'the throw caught the thrower')
})

test('a bolt shrinks everyone ahead, and leaves a star and the field behind alone', () => {
  const state = started(4, 13)
  state.phase = 'RACE'
  const [me, victim, starred, behind] = state.karts
  me.prog = 100
  victim.prog = 200
  starred.prog = 300
  behind.prog = 50
  starred.star = 5
  behind.item = ITEMS.findIndex((i) => i.key === 'banana')
  behind.itemCount = 1
  me.item = ITEMS.findIndex((i) => i.key === 'bolt')
  step(state, { 1: IN_ITEM })
  assert.ok(victim.shrink > 0)
  assert.equal(starred.shrink, 0)
  assert.equal(me.shrink, 0)
  assert.equal(behind.shrink, 0, 'the bolt went backwards down the field')
  assert.ok(behind.item !== null, 'a kart behind lost the item it was holding')
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

test('a bang leaves a ring behind it for the renderer, and then clears', () => {
  const state = started(2, 24)
  state.phase = 'RACE'
  const [me] = state.karts
  holding(me, 'bomb')
  step(state, { 1: IN_ITEM })
  assert.equal(state.blasts.length, 0, 'the ring came before the bang')
  // Let the fuse burn all the way down rather than driving anyone into it.
  for (let i = 0; i < 250 && state.hazards.length; i++) step(state, {})
  assert.equal(state.blasts.length, 1, 'the bang left no ring')
  assert.ok(state.blasts[0].r > 0, 'the ring has no radius to draw')
  // It is a one-shot, not a state: a peer joining a second later sees nothing.
  for (let i = 0; i < 60; i++) step(state, {})
  assert.equal(state.blasts.length, 0, 'the ring never cleared')
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

test('every boost pad is on the tarmac, wherever the road narrows under it', () => {
  for (const pad of padSpots()) {
    // The narrows are the tight ones: a pad whose edge hangs off the road is a
    // reward for a line that puts you on the grass — or, over a drop, in it.
    const reach = Math.abs(pad.lane) + pad.halfWidth
    assert.ok(reach <= halfWidthAt(pad.s), `pad off the road at ${pad.s}: ${reach}`)
    assert.ok(!jumpAt(pad.s), `pad over a jump at ${pad.s}`)
  }
})

test('holding a drift charges a mini-turbo, and releasing it spends it', () => {
  // Rolling into a drift with the wheel over. The charge is time, so the only
  // thing that varies between these is how long the drift is held.
  const held = (ticks) => {
    const state = started(1, 13)
    state.phase = 'RACE'
    const kart = state.karts[0]
    onLine(kart, 625)
    // The flick that starts it, then the drift held and trimmed down the road.
    step(state, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
    driftAlong(state, kart, ticks - 1)
    const charged = driftTier(kart)
    kart.boost = 0 // a pad on the way past is not what this is measuring
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

test('a drift slides and holds its line rather than spinning on the spot', () => {
  // The bug: a drift turned at more than twice the grip rate, which is a ten
  // metre circle at speed. The kart pirouetted off the road inside half a
  // second, so the mini-turbo was unreachable and it read as a snap turn rather
  // than a slide.
  const state = started(1, 13)
  state.phase = 'RACE'
  const kart = state.karts[0]
  onLine(kart, 625)
  step(state, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
  const slid = driftAlong(state, kart, 129)
  assert.equal(driftTier(kart), 2, 'a drift that cannot be held for two seconds')
  const here = project(kart.x, kart.y)
  assert.ok(Math.abs(here.lateral) < halfWidthAt(here.s), 'the drift left the road')
  assert.ok(slid > 15, `the nose only ever led the line by ${slid.toFixed(0)} degrees`)

  // A grip turn on the same stretch barely slides at all — that is the contrast
  // the drift button is meant to buy.
  const grip = started(1, 13)
  grip.phase = 'RACE'
  const plain = grip.karts[0]
  onLine(plain, 625)
  let gripSlip = 0
  for (let i = 0; i < 40; i++) {
    run(grip, 1, { 1: IN_FWD | IN_RIGHT })
    gripSlip = Math.max(gripSlip, slipDeg(plain))
  }
  assert.ok(gripSlip < slid, `a grip turn slides as much as a drift: ${gripSlip.toFixed(0)} deg`)

  // Steering out of a drift opens the line, it does not flip it over.
  const dir = kart.driftDir
  const before = kart.heading
  run(state, 10, { 1: IN_FWD | IN_DRIFT | IN_LEFT })
  assert.equal(kart.driftDir, dir, 'the wheel flipped the drift')
  const turned = Math.atan2(Math.sin(kart.heading - before), Math.cos(kart.heading - before))
  assert.ok(turned * dir > 0, 'steering out of a drift turned the kart the other way')
})

test('a spin-out throws away a charged drift', () => {
  const state = started(1, 13)
  state.phase = 'RACE'
  const kart = state.karts[0]
  onLine(kart, 625)
  step(state, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
  driftAlong(state, kart, 129)
  assert.equal(driftTier(kart), 2)
  state.hazards.push({ kind: 'banana', x: kart.x, y: kart.y, owner: 99 })
  step(state, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
  assert.ok(kart.spin > 0)
  assert.equal(driftTier(kart), 0)
  assert.equal(kart.driftTime, 0)
  step(state, { 1: IN_FWD })
  assert.equal(kart.boost, 0, 'a spin-out paid out anyway')
})

test('a charge held into a fall or a bullet does not pay out afterwards', () => {
  // Both of these return out of stepKart before the drift block, so a charge
  // held at the moment they start is never spent — and was then handed over as
  // a free boost on the first tick the kart drove again.
  const charged = (extra) => {
    const state = started(1, 17)
    state.phase = 'RACE'
    const kart = state.karts[0]
    onLine(kart, 625)
    step(state, { 1: IN_FWD | IN_DRIFT | IN_RIGHT })
    driftAlong(state, kart, 129)
    assert.ok(kart.driftTime > 1.9, 'the drift never charged')
    kart.boost = 0 // as above: a pad on the way past would read as a payout
    Object.assign(kart, extra)
    return { state, kart }
  }

  const { state: fell, kart: dropped } = charged({ respawn: RESPAWN_SECONDS })
  run(fell, 200)
  assert.equal(dropped.boost, 0, 'a fall paid out the charge it threw away')

  const { state: flew, kart: flying } = charged({ bullet: 0.2 })
  run(flew, 20) // just past the end of the flight, and short of the next pad
  assert.equal(flying.boost, 0, 'a bullet paid out a charge held into it')
})

test('a shove does not fire a shrunk kart across the circuit', () => {
  const state = started(2, 21)
  state.phase = 'RACE'
  const [me, small] = state.karts
  const p = pointAt(200)
  small.shrink = 4
  small.x = p.x
  small.y = p.y
  me.x = p.x - p.tx * (KART_R * 1.4)
  me.y = p.y - p.ty * (KART_R * 1.4)
  me.heading = Math.atan2(p.ty, p.tx)
  me.vx = p.tx * 30
  me.vy = p.ty * 30
  step(state, {})
  // Light, so it is shoved further than a full-size kart would be — but a shove
  // is not a catapult, and being small is not a way to be launched off the road.
  assert.ok(Math.hypot(small.vx, small.vy) <= statsOf(small).top + 0.001,
    `a nudge sent it to ${Math.hypot(small.vx, small.vy).toFixed(1)} m/s`)
})

test('spinning out on a boost pad does not hand the boost straight back', () => {
  const state = started(1, 23)
  state.phase = 'RACE'
  const pad = padSpots()[0]
  const kart = state.karts[0]
  kart.x = pad.x
  kart.y = pad.y
  kart.heading = pad.heading
  state.hazards.push({ kind: 'banana', x: pad.x, y: pad.y, owner: 99 })
  step(state, {})
  assert.ok(kart.spin > 0, 'the banana missed')
  assert.equal(kart.boost, 0, 'a spun-out kart is boosting off the pad under it')
})

test('an item fires on space as well as on the item key', () => {
  // The HUD says "space to fire". It used to be true only in a solo race: the
  // solo loop patched space into the item bit itself and the room path, which
  // sends the raw keys, did not.
  const fired = (bits) => {
    const state = started(2, 29)
    state.phase = 'RACE'
    state.karts[0].item = ITEMS.findIndex((i) => i.key === 'banana')
    state.karts[0].itemCount = 1
    step(state, { 1: bits })
    return state.hazards.length
  }
  assert.equal(fired(IN_ITEM), 1, 'E did not fire')
  assert.equal(fired(IN_BOOST), 1, 'space did not fire')
  assert.equal(fired(0), 0, 'an item fired with nothing pressed')
})

test('a kart crawling in the road is something you go through, not a wall', () => {
  // The complaint this is for: a spin lasts 1.3s but the kart it happened to is
  // still at walking pace afterwards, and at full mass that is the same roadblock
  // wearing a different flag.
  const covered = (place) => {
    // The kart in front is not an AI: an AI drives itself away and the run then
    // measures following a slower car rather than being jammed behind a stopped
    // one, which is what is being fixed.
    const state = createRace([
      { id: 1, name: 'me' },
      { id: 2, name: 'stalled' },
    ], 29)
    begin(state)
    state.phase = 'RACE'
    const [me, other] = state.karts
    const p = pointAt(400)
    if (place) {
      other.x = p.x
      other.y = p.y
      other.s = 400
      other.vx = 0
      other.vy = 0
    } else {
      other.x = 1e6 // out of the way entirely, as the control
      other.y = 1e6
    }
    me.x = p.x - p.tx * 4.2
    me.y = p.y - p.ty * 4.2
    me.s = 400 - 4.2
    me.prog = 0
    me.heading = Math.atan2(p.ty, p.tx)
    me.vx = p.tx * 30
    me.vy = p.ty * 30
    run(state, 90, { 1: IN_FWD })
    return me.prog
  }

  const clear = covered(false)
  const blocked = covered(true)
  assert.ok(blocked > clear * 0.8, `a stopped kart cost ${(100 - (blocked / clear) * 100).toFixed(0)}% of the run`)
})

test('reversing swaps left and right', () => {
  const state = started(1, 31)
  state.phase = 'RACE'
  const kart = state.karts[0]
  const p = pointAt(400)
  kart.x = p.x
  kart.y = p.y
  const facing = Math.atan2(p.ty, p.tx)
  kart.heading = facing
  // Rolling backwards, with the wheel to the left.
  kart.vx = -p.tx * 8
  kart.vy = -p.ty * 8
  run(state, 20, { 1: IN_LEFT })
  const swung = Math.atan2(Math.sin(kart.heading - facing), Math.cos(kart.heading - facing))
  assert.ok(swung > 0.05, `the nose went the forward way: ${swung.toFixed(2)} rad`)
})

test('a chassis is six of the sim\'s own constants, and an unknown one is a Coupe', () => {
  const state = createRace([], 5)
  const van = addKart(state, { id: 1, name: 'van', chassis: 'van' })
  const junk = addKart(state, { id: 2, name: 'junk', chassis: 'hovercraft' })
  assert.equal(statsOf(van), CHASSIS_STATS.van)
  assert.equal(statsOf(junk), CHASSIS_STATS.coupe, 'anything off a channel is a Coupe')
  assert.equal(radiusOf(van), CHASSIS_STATS.van.radius)

  // The AI is dealt a car out of the race's own PRNG: every one is real, the
  // field is not six of the same, and the same seed deals the same six.
  const deal = (seed) =>
    createRace(
      Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `k${i}`, ai: true })),
      seed
    ).karts.map((k) => k.chassis)
  const dealt = deal(11)
  assert.ok(dealt.every((key) => CHASSIS_KEYS.includes(key)), dealt.join())
  assert.ok(new Set(dealt).size > 1, `one rail: ${dealt.join()}`)
  assert.deepEqual(deal(11), dealt)
})

test('the chassis is what the kart does: the Wedge runs away, the Van wins the shove', () => {
  // Flat out from the same place: top end and acceleration are the chassis'.
  const speedOf = (chassis) => {
    const state = createRace([{ id: 1, name: 'a', chassis }], 4)
    begin(state)
    run(state, 200) // the lights
    onLine(state.karts[0], 40, 0)
    run(state, 240, { 1: IN_FWD })
    return Math.hypot(state.karts[0].vx, state.karts[0].vy)
  }
  const wedge = speedOf('wedge')
  assert.ok(wedge > speedOf('van') + 2, `the Wedge only reached ${wedge.toFixed(1)} m/s`)

  // Driven into at the same speed from the same distance, the light kart is
  // shoved further than the heavy one: mass is the whole of the Van.
  const shoved = (hitter, victim) => {
    const state = createRace(
      [{ id: 1, name: 'h', chassis: hitter }, { id: 2, name: 'v', chassis: victim }],
      6
    )
    begin(state)
    state.phase = 'RACE'
    const [me, them] = state.karts
    const p = pointAt(300)
    onLine(them, 300, 0)
    me.x = p.x - p.tx * 3
    me.y = p.y - p.ty * 3
    me.heading = Math.atan2(p.ty, p.tx)
    me.vx = p.tx * 30
    me.vy = p.ty * 30
    step(state, {})
    return Math.hypot(them.vx, them.vy)
  }
  const bike = shoved('van', 'bike')
  const van = shoved('bike', 'van')
  assert.ok(bike > van + 1, `the Van shoved the Bike to ${bike.toFixed(1)}, the Bike ${van.toFixed(1)}`)
})

test('tucking in behind someone tows you along, and only from behind', () => {
  // Two karts nose to tail on the same line at the same speed, flat out. The
  // one in front is the control: whatever the road does to it — the hill, the
  // curve — it does to the one behind as well, so the only difference left
  // between the two runs is the slipstream.
  const place = (kart, s, side, speed, back = false) => {
    const p = pointAt(s)
    kart.chassis = 'coupe'
    kart.ai = false
    kart.x = p.x + p.nx * side
    kart.y = p.y + p.ny * side
    kart.s = s
    kart.prog = s
    kart.heading = Math.atan2(p.ty, p.tx) + (back ? Math.PI : 0)
    kart.vx = Math.cos(kart.heading) * speed
    kart.vy = Math.sin(kart.heading) * speed
  }

  // gap: how far up the road the other kart sits. side: how far across it sits.
  const trail = (gap, side = 0, back = false) => {
    const state = started(2, 5)
    state.phase = 'RACE'
    const [me, them] = state.karts
    place(me, 300, 0, 30)
    place(them, 300 + gap, side, 30, back)
    run(state, 40, { 1: IN_FWD, 2: IN_FWD })
    return { speed: Math.hypot(me.vx, me.vy), draft: me.draft }
  }

  const tucked = trail(8)
  const alone = trail(80) // far enough up the road to be nothing to do with us
  assert.ok(tucked.draft > 0.3, `no tow at 8m: ${tucked.draft.toFixed(2)}`)
  assert.equal(alone.draft, 0, 'towed by a kart 80m up the road')
  assert.ok(
    tucked.speed > alone.speed + 0.5,
    `tow was worth nothing: ${tucked.speed.toFixed(2)} vs ${alone.speed.toFixed(2)}`,
  )

  // Alongside is not behind, and neither is nose to nose.
  assert.equal(trail(8, 6).draft, 0, 'towed by a kart in the next lane')
  assert.equal(trail(8, 0, true).draft, 0, 'towed by a kart coming the other way')
  assert.equal(trail(-8).draft, 0, 'towed by a kart behind us')
})

// Maps ----------------------------------------------------------------------

test('every map is a closed circuit the sim can place a race on', () => {
  try {
    for (const key of TRACK_KEYS) {
      assert.equal(setTrack(key), key)
      assert.equal(activeTrack(), key)
      const t = TRACKS[key]
      // The length falls out of a Catmull-Rom through the nodes rather than being
      // declared beside them, so this is what catches a table with its decimal
      // point in the wrong place.
      assert.ok(TRACK.length > 1100, `${key} is only ${TRACK.length.toFixed(0)}m`)

      // A six-kart grid stands on the widest part of the road, and the line is
      // where the road is widest: the grid and the renderer's chequer band both
      // assume it.
      const widths = Array.from({ length: 60 }, (_, i) => halfWidthAt((i / 60) * TRACK.length))
      assert.equal(halfWidthAt(0), Math.max(...widths), `${key} is not widest at the line`)
      assert.equal(halfWidthAt(0), HALF_WIDTH, `${key}: HALF_WIDTH is not the line's width`)
      assert.ok(Math.min(...widths) > 6, `${key} narrows to ${Math.min(...widths).toFixed(1)}m`)

      // Nothing off the road: a pad hanging over a drop is a trap rather than a
      // decision, and a box in the grass is one nobody takes.
      for (const spot of padSpots()) {
        const hit = project(spot.x, spot.y)
        const room = halfWidthAt(hit.s) + 0.01
        assert.ok(Math.abs(hit.lateral) + spot.halfWidth <= room, `${key}: a pad hangs off the tarmac`)
      }
      for (const spot of boxSpots()) {
        const hit = project(spot.x, spot.y)
        assert.ok(Math.abs(hit.lateral) <= halfWidthAt(hit.s), `${key}: a box is off the road`)
      }
      assert.equal(boxSpots().length, t.boxRows * 3)

      // A gap you can clear flat out and not at a crawl, which is the whole
      // point of one and the reason each map has its own airtime.
      for (const [from, to] of JUMPS) {
        const gap = (to - from) * TRACK.length
        assert.ok(gap / JUMP_AIRTIME < 38, `${key}: nothing clears a ${gap.toFixed(0)}m gap`)
        assert.ok(gap / JUMP_AIRTIME > 20, `${key}: a ${gap.toFixed(0)}m gap is a bump, not a jump`)
      }
      // The hills are whole cycles per lap, or the road has a step in it.
      assert.ok(Math.abs(heightAt(0) - heightAt(TRACK.length)) < 0.001, `${key} steps at the line`)
    }
  } finally {
    setTrack(DEFAULT_TRACK)
  }
})

test('a race is dealt a map off its seed, and an AI field gets round all of them', () => {
  try {
    const seen = new Set()
    for (let seed = 0; seed < TRACK_KEYS.length * 3; seed++) seen.add(trackFor(seed))
    assert.equal(seen.size, TRACK_KEYS.length, 'the seeds do not reach every map')
    // Same seed, same map: a replay has to land on the same road.
    assert.equal(trackFor(12345), trackFor(12345))

    // Going again never hands you back the road you just finished on, whatever
    // the seed deals — and it still lands on a real map.
    for (const key of TRACK_KEYS) {
      for (let seed = 0; seed < TRACK_KEYS.length * 4; seed++) {
        const next = trackFor(seed, key)
        assert.notEqual(next, key, `going again on ${key} dealt ${key} back`)
        assert.ok(TRACK_KEYS.includes(next), `going again on ${key} dealt ${next}`)
      }
    }

    for (const key of TRACK_KEYS) {
      const state = createRace(
        field().map((r) => ({ ...r, ai: true })),
        7,
        key,
      )
      assert.equal(state.track, key)
      begin(state)
      for (let i = 0; i < 60 * 700 && state.phase !== 'OVER'; i++) step(state, {})
      assert.equal(state.phase, 'OVER', `nobody finished on ${key}`)
      const winner = state.karts.find((k) => k.place === 1)
      assert.ok(winner.lap >= LAPS, `the winner on ${key} only got to lap ${winner.lap}`)
    }
  } finally {
    setTrack(DEFAULT_TRACK)
  }
})
