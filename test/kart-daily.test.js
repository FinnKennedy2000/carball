import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACKS, TRACK_KEYS, CHASSIS_KEYS } from '../shared/kart.js'
import { ROSTER, dailyFor, dayNumber, DAILY_EPOCH } from '../shared/kart-daily.js'

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

function supports(track, needs) {
  const t = TRACKS[track]
  if (needs === 'jumps') return t.jumps.length > 0
  if (needs === 'pads') return t.pads.length > 0
  if (needs === 'boxes') return t.boxRows > 0
  if (needs === 'voids') return t.voids.length > 0
  return true
}
