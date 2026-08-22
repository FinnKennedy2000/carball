import test from 'node:test'
import assert from 'node:assert/strict'
import { IN_BACK, IN_DRIFT, IN_FWD, IN_LEFT } from '../shared/constants.js'
import { addKart, begin, createRace, step, TRACKS, TRACK_KEYS, CHASSIS_KEYS, hashRace } from '../shared/kart.js'
import { ROSTER, dailyFor, dayNumber, DAILY_EPOCH, cleared, observe, settle, startProgress, detailOf } from '../shared/kart-daily.js'

const DAYS = 400

test('a day is the same three wherever it is asked for', () => {
  const a = dailyFor(142)
  const b = dailyFor(142)
  assert.equal(a.track, b.track)
  assert.equal(a.chassis, b.chassis)
  assert.equal(a.seed, b.seed)
  assert.deepEqual(
    a.objectives.map((o) => o.key),
    b.objectives.map((o) => o.key)
  )
})

test('the day number counts whole days from the epoch', () => {
  assert.equal(dayNumber(DAILY_EPOCH), 0)
  assert.equal(dayNumber(DAILY_EPOCH + 86_400_000 - 1), 0)
  assert.equal(dayNumber(DAILY_EPOCH + 86_400_000), 1)
  // A clock set before the epoch still gives a usable day rather than NaN.
  assert.equal(dayNumber(DAILY_EPOCH - 1), -1)
  assert.ok(dailyFor(-1).objectives.every(Boolean))
})

test('track and chassis walk a 36-day cycle', () => {
  for (let d = 0; d < DAYS; d++) {
    const daily = dailyFor(d)
    assert.equal(daily.track, TRACK_KEYS[d % 6])
    assert.equal(daily.chassis, CHASSIS_KEYS[Math.floor(d / 6) % 6])
  }
  assert.equal(dailyFor(0).track, dailyFor(36).track)
  assert.equal(dailyFor(0).chassis, dailyFor(36).chassis)
})

test('one objective per slot, always three', () => {
  for (let d = 0; d < DAYS; d++) {
    const slots = dailyFor(d).objectives.map((o) => o.slot)
    assert.deepEqual(slots, [1, 2, 3], `day ${d}`)
  }
})

test('an objective is never dealt on a track that cannot support it', () => {
  for (let d = 0; d < DAYS; d++) {
    const { track, objectives } = dailyFor(d)
    const t = TRACKS[track]
    for (const o of objectives) {
      if (o.needs === 'jumps') assert.ok(t.jumps.length > 0, `${o.key} on ${track}`)
      if (o.needs === 'pads') assert.ok(t.pads.length > 0, `${o.key} on ${track}`)
      if (o.needs === 'boxes') assert.ok(t.boxRows > 0, `${o.key} on ${track}`)
      if (o.needs === 'voids') assert.ok(t.voids.length > 0, `${o.key} on ${track}`)
    }
  }
})

// The two the capability table exists for: bayside has no jumps at all, and
// neither bayside nor grove has a void, so nothing can fall off them.
test('bayside never asks for a jump and grove never asks you not to fall', () => {
  for (let d = 0; d < DAYS; d++) {
    const { track, objectives } = dailyFor(d)
    const keys = objectives.map((o) => o.key)
    if (track === 'bayside') {
      for (const k of ['jumps', 'jumpeverylap', 'nospinjump']) assert.ok(!keys.includes(k))
    }
    if (track === 'bayside' || track === 'grove') assert.ok(!keys.includes('nofall'))
  }
})

test('every objective in the roster gets dealt', () => {
  const seen = new Set()
  for (let d = 0; d < DAYS; d++) for (const o of dailyFor(d).objectives) seen.add(o.key)
  const missing = ROSTER.filter((o) => !seen.has(o.key)).map((o) => o.key)
  assert.deepEqual(missing, [], `never dealt in ${DAYS} days: ${missing.join(', ')}`)
})

// The bug this design exists to prevent: with `day % 4` against a 6-day track
// cycle, a track only ever sees two of its objectives.
test('a slot cycles the whole pool for a track before repeating', () => {
  for (const track of TRACK_KEYS) {
    for (const slot of [1, 2, 3]) {
      const pool = ROSTER.filter((o) => o.slot === slot && supports(track, o.needs))
      const picks = []
      for (let d = 0; d < DAYS; d++) {
        const daily = dailyFor(d)
        if (daily.track === track) picks.push(daily.objectives[slot - 1].key)
      }
      // Walk it a pool at a time: each window must be a permutation.
      for (let i = 0; i + pool.length <= picks.length; i += pool.length) {
        const window = picks.slice(i, i + pool.length)
        assert.equal(new Set(window).size, pool.length, `${track} slot ${slot} window ${i}: ${window.join(',')}`)
      }
    }
  }
})

// The bug this caught in review: `visit` is constant across a six-day block, so
// every day in the block takes the same position in its track's cycle. Slot 3's
// pool is composed the same on all six tracks, so with the track absent from the
// shuffle seed all six days dealt the identical objective.
test('a block of six days does not deal one slot the same objective throughout', () => {
  for (let block = 0; block < 20; block++) {
    for (const slot of [1, 2, 3]) {
      const keys = []
      for (let i = 0; i < 6; i++) keys.push(dailyFor(block * 6 + i).objectives[slot - 1].key)
      assert.ok(new Set(keys).size > 1, `block ${block} slot ${slot} was all ${keys[0]}`)
    }
  }
})

test('the same objective rarely lands in the same slot two days running', () => {
  let repeats = 0
  for (let d = 1; d < 400; d++) {
    const before = dailyFor(d - 1).objectives
    const now = dailyFor(d).objectives
    for (let i = 0; i < 3; i++) if (before[i].key === now[i].key) repeats++
  }
  // 1197 slot-transitions (399 days x 3). Independent shuffles per track put the floor near
  // 1-in-7 (~170); the bug this replaced scored 711.
  assert.ok(repeats < 300, `${repeats} of 1197 transitions repeated`)
})

function supports(track, needs) {
  const t = TRACKS[track]
  if (needs === 'jumps') return t.jumps.length > 0
  if (needs === 'pads') return t.pads.length > 0
  if (needs === 'boxes') return t.boxRows > 0
  if (needs === 'voids') return t.voids.length > 0
  return true
}

/** A one-kart daily-shaped race, stepped with fixed input, watched throughout. */
function run(track, chassis, bits, ticks) {
  const state = createRace([{ id: 1, name: 'me', chassis }], 7, track)
  const kart = state.karts[0]
  begin(state)
  // Past the lights first. The grid countdown is its own phase lasting three
  // seconds — 180 ticks — so an input pattern indexed from tick zero would
  // spend all of it steering a kart that has not been released yet.
  let guard = 0
  while (state.phase !== 'RACE' && guard++ < 600) step(state, {})
  const p = startProgress({ ...dailyFor(0), track, chassis }, state.laps)
  for (let i = 0; i < ticks; i++) {
    step(state, { 1: typeof bits === 'function' ? bits(i, kart) : bits })
    if (state.phase === 'RACE') observe(p, kart, 1 / 60)
  }
  return { state, kart, p }
}

const objectiveOf = (key) => ROSTER.find((o) => o.key === key)

test('drifting for long enough clears drift school, and not drifting does not', () => {
  const held = run('circuit', 'coupe', IN_FWD | IN_LEFT | IN_DRIFT, 60 * 12)
  assert.ok(held.p.driftFor >= 8, `only drifted ${held.p.driftFor.toFixed(1)}s`)
  assert.ok(cleared(objectiveOf('drifttime'), held.p, held.kart))

  const straight = run('circuit', 'coupe', IN_FWD, 60 * 12)
  assert.equal(straight.p.driftFor, 0)
  assert.ok(!cleared(objectiveOf('drifttime'), straight.p, straight.kart))
})

test('a boost lights the jets counter and a standstill does not', () => {
  // Drifting then releasing is the only way to a boost with no items in play.
  const drifted = run('circuit', 'coupe', (i) => (i < 180 ? IN_FWD | IN_LEFT | IN_DRIFT : IN_FWD), 60 * 20)
  assert.ok(drifted.p.boostFor > 0, 'a released drift should light a boost')

  const parked = run('circuit', 'coupe', 0, 60 * 5)
  assert.equal(parked.p.boostFor, 0)
  assert.ok(!cleared(objectiveOf('boostlit'), parked.p, parked.kart))
})

test('a drift charge is counted once per drift, not once per tick', () => {
  // Three seconds, not two: driftTime only accumulates above DRIFT_MIN_SPEED
  // (12 m/s), so a shorter drift from a standing start never reaches tier one.
  const one = run('circuit', 'coupe', (i) => (i < 180 ? IN_FWD | IN_LEFT | IN_DRIFT : IN_FWD), 60 * 6)
  assert.equal(one.p.charges, 1, 'one held drift is one charge')
})

test('the longest drift is the longest unbroken one, not the total', () => {
  // Two short drifts with a gap: the total passes three seconds, the longest
  // single one does not.
  const bits = (i) => (i % 120 < 100 ? IN_FWD | IN_LEFT | IN_DRIFT : IN_FWD)
  const { p, kart } = run('circuit', 'coupe', bits, 60 * 8)
  assert.ok(p.driftFor > 3)
  assert.ok(p.longestDrift < 3, `longest was ${p.longestDrift.toFixed(2)}s`)
  assert.ok(!cleared(objectiveOf('longdrift'), p, kart))
})

test('a clean run keeps the clean sheet and a spin loses it', () => {
  const clean = run('circuit', 'coupe', IN_FWD, 60 * 10)
  assert.ok(!clean.p.spun)
  assert.ok(cleared(objectiveOf('nospin'), clean.p, clean.kart))

  const { p, kart } = run('circuit', 'coupe', IN_FWD, 1)
  kart.spin = 1
  observe(p, kart, 1 / 60)
  assert.ok(p.spun)
  assert.ok(!cleared(objectiveOf('nospin'), p, kart))
})

test('top speed is the highest reached, in km/h', () => {
  const { p, kart } = run('circuit', 'wedge', IN_FWD, 60 * 15)
  assert.ok(p.topSpeed > 100, `only reached ${p.topSpeed.toFixed(0)} km/h`)
  assert.equal(Math.round(p.topSpeed), Math.round(p.topSpeed), 'a number, not NaN')
  // Reversing never gets near it.
  const back = run('circuit', 'wedge', IN_BACK, 60 * 15)
  assert.ok(back.p.topSpeed < p.topSpeed)
})

test('settle returns one verdict and one line of detail per objective', () => {
  const { p, kart } = run('circuit', 'coupe', IN_FWD, 60 * 10)
  // Three keys this task implements, rather than a real day: a day's slot 3 is
  // Task 4's work and settle would rightly throw on it.
  const daily = { objectives: ['finish', 'topspeed', 'nospin'].map(objectiveOf) }
  const out = settle({ ...p, daily }, kart)
  assert.equal(out.met.length, 3)
  assert.equal(out.detail.length, 3)
  for (const m of out.met) assert.equal(typeof m, 'boolean')
  for (const d of out.detail) assert.equal(typeof d, 'string')
})

test('a lap down the middle misses pads, which is what makes them a price', () => {
  // The AI drives the centreline; the pads sit against the edges of the wide
  // sections. If a centreline lap swept them all, slot 3 would cost nothing.
  const state = createRace([], 7, 'circuit')
  const kart = addKart(state, { id: 1, name: 'par', chassis: 'coupe' })
  kart.ai = true
  begin(state)
  const p = startProgress(dailyFor(0), state.laps)
  for (let i = 0; i < 60 * 400 && kart.finished === null; i++) {
    step(state, {})
    if (state.phase === 'RACE') observe(p, kart, 1 / 60)
  }
  assert.ok(p.padList.length > 0, 'the circuit has pads')
  assert.ok(p.pads.size < p.padList.length, `a centreline lap took all ${p.padList.length} pads`)
  assert.ok(!cleared(objectiveOf('allpads'), p, kart))
})

test('never touching a pad is its own objective', () => {
  const parked = run('circuit', 'coupe', 0, 60 * 3)
  assert.equal(parked.p.pads.size, 0)
  assert.ok(cleared(objectiveOf('nopads'), parked.p, parked.kart))
})

test('the grass fails tarmac only, and the racing line does not', () => {
  const online = run('circuit', 'coupe', IN_FWD, 60 * 6)
  assert.ok(!online.p.offRoad, 'a straight launch off the grid is on the road')
  assert.ok(cleared(objectiveOf('ontarmac'), online.p, online.kart))

  // Put it well outside the road and watch one tick.
  const { p, kart } = run('circuit', 'coupe', IN_FWD, 1)
  kart.x += 400
  kart.y += 400
  observe(p, kart, 1 / 60)
  assert.ok(p.offRoad)
  assert.ok(!cleared(objectiveOf('ontarmac'), p, kart))
})

test('taking a box is recorded against the lap it was taken on', () => {
  const { p, kart } = run('circuit', 'coupe', IN_FWD, 1)
  kart.item = 0
  observe(p, kart, 1 / 60)
  assert.ok(p.tookItem)
  assert.ok(p.boxLaps.has(kart.lap))
  assert.ok(!cleared(objectiveOf('noitem'), p, kart))
  // Held across ticks, it is still one box, not one per tick.
  observe(p, kart, 1 / 60)
  assert.equal(p.boxLaps.size, 1)
})

test('standing still after the grace period fails no coasting', () => {
  const parked = run('circuit', 'coupe', 0, 60 * 6)
  assert.ok(parked.p.minSpeed < 60)
  assert.ok(!cleared(objectiveOf('speedfloor'), parked.p, parked.kart))
})

// The guarantee the whole design rests on: watching a race must not change it.
test('watching a race changes nothing about it', () => {
  const watched = createRace([{ id: 1, name: 'me', chassis: 'coupe' }], 99, 'circuit')
  begin(watched)
  const p = startProgress(dailyFor(0), watched.laps)
  for (let i = 0; i < 1200; i++) {
    step(watched, { 1: IN_FWD | IN_LEFT })
    if (watched.phase === 'RACE') observe(p, watched.karts[0], 1 / 60)
  }

  const alone = createRace([{ id: 1, name: 'me', chassis: 'coupe' }], 99, 'circuit')
  begin(alone)
  for (let i = 0; i < 1200; i++) step(alone, { 1: IN_FWD | IN_LEFT })

  assert.equal(hashRace(watched), hashRace(alone))
})

// The 1200-tick test above never picks up a box, so it cannot catch an observer
// that consumes the seeded PRNG (the item roll is the only in-race consumer of
// it). An AI-driven full race does drive through boxes, so run the same
// watched-vs-unwatched comparison there, and check a box was actually taken.
test('watching a full, item-eating race still changes nothing about it', () => {
  const watched = createRace([], 7, 'bayside')
  const wKart = addKart(watched, { id: 1, name: 'par', chassis: 'wedge' })
  wKart.ai = true
  begin(watched)
  const p = startProgress(dailyFor(0), watched.laps)
  for (let i = 0; i < 60 * 400 && watched.phase !== 'OVER'; i++) {
    const wasRacing = watched.phase === 'RACE'
    step(watched, {})
    if (wasRacing) observe(p, wKart, 1 / 60)
  }

  const alone = createRace([], 7, 'bayside')
  const aKart = addKart(alone, { id: 1, name: 'par', chassis: 'wedge' })
  aKart.ai = true
  begin(alone)
  for (let i = 0; i < 60 * 400 && alone.phase !== 'OVER'; i++) step(alone, {})

  assert.equal(hashRace(watched), hashRace(alone))
  assert.ok(p.tookItem, 'the watched race never picked up an item')
})

test('the finishing lap is watched, so a flying finish can be cleared', () => {
  const state = createRace([], 7, 'bayside')
  const kart = addKart(state, { id: 1, name: 'par', chassis: 'wedge' })
  // Seated as a person then handed to the AI, so it drives the named chassis
  // down the centreline — addKart deals an AI its own chassis otherwise.
  kart.ai = true
  begin(state)
  const p = startProgress(dailyFor(0), state.laps)
  // The client's own gating: sample the phase before the step, or the tick that
  // carries the last crossing is thrown away.
  for (let i = 0; i < 60 * 400 && state.phase !== 'OVER'; i++) {
    const wasRacing = state.phase === 'RACE'
    step(state, {})
    if (wasRacing) observe(p, kart, 1 / 60)
  }
  assert.equal(state.phase, 'OVER')
  assert.notEqual(kart.finished, null)
  assert.equal(p.lineSpeeds.length, state.laps, 'every lap crossing should be recorded')
  assert.ok(cleared(objectiveOf('flatoutline'), p, kart))
})

test('settle reports on every objective of a finished day', () => {
  const state = createRace([], 7, 'circuit')
  const kart = addKart(state, { id: 1, name: 'par', chassis: 'coupe' })
  kart.ai = true
  begin(state)
  const daily = dailyFor(0)
  const p = startProgress(daily, state.laps)
  for (let i = 0; i < 60 * 400 && state.phase !== 'OVER'; i++) {
    const wasRacing = state.phase === 'RACE'
    step(state, {})
    if (wasRacing) observe(p, kart, 1 / 60)
  }
  const out = settle(p, kart)
  assert.equal(out.met.length, 3)
  assert.equal(out.detail.length, 3)
  for (const m of out.met) assert.equal(typeof m, 'boolean')
  for (const d of out.detail) assert.ok(d.length > 0)
})

test('an unrecognised objective is a loud error, not a silent false', () => {
  const { p, kart } = run('circuit', 'coupe', IN_FWD, 60 * 2)
  const bogus = { key: 'nonesuch', slot: 3, name: 'Nonesuch', hint: '', needs: null, target: null }
  assert.throws(() => cleared(bogus, p, kart), /nonesuch/)
  assert.throws(() => detailOf(bogus, p, kart), /nonesuch/)
})
