import test from 'node:test'
import assert from 'node:assert/strict'
import { KEY, load, record, save, streaks } from '../client/kart-daily-store.js'

/** The two methods of localStorage this module uses, and nothing else. */
function fakeStorage(seed = null) {
  const map = new Map(seed ? [[KEY, JSON.stringify(seed)]] : [])
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    read: () => JSON.parse(map.get(KEY)),
  }
}

const ALL = [true, true, true]
const SOME = [true, true, false]

test('a fresh player starts with nothing and no streak', () => {
  const rec = load(fakeStorage(), 10, 1)
  assert.equal(rec.bestMs, null)
  assert.deepEqual(rec.met, [false, false, false])
  assert.deepEqual(streaks(rec, 10), { time: 0, perfect: 0 })
})

test('beating par starts a time streak and all three starts a perfect one', () => {
  let rec = load(fakeStorage(), 10, 1)
  rec = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  assert.deepEqual(streaks(rec, 10), { time: 1, perfect: 1 })
  assert.equal(rec.bestMs, 90_000)
  assert.equal(rec.badgeMs, 90_000)
})

test('a consecutive day extends a streak and a gap resets it', () => {
  let rec = load(fakeStorage(), 10, 1)
  rec = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  rec = record(rec, { day: 11, ms: 90_000, met: ALL, parMs: 95_000 })
  assert.deepEqual(streaks(rec, 11), { time: 2, perfect: 2 })

  // Day 12 skipped entirely.
  rec = record(rec, { day: 13, ms: 90_000, met: ALL, parMs: 95_000 })
  assert.deepEqual(streaks(rec, 13), { time: 1, perfect: 1 })
})

test('a missed day shows as zero before it is played', () => {
  let rec = load(fakeStorage(), 10, 1)
  rec = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  // Nothing recorded on 11 or 12; asking on 12 is already a broken streak.
  assert.deepEqual(streaks(rec, 11), { time: 1, perfect: 1 })
  assert.deepEqual(streaks(rec, 12), { time: 0, perfect: 0 })
})

test('missing par leaves the time streak alone', () => {
  let rec = load(fakeStorage(), 10, 1)
  rec = record(rec, { day: 10, ms: 99_000, met: SOME, parMs: 95_000 })
  assert.deepEqual(streaks(rec, 10), { time: 0, perfect: 0 })
  assert.equal(rec.bestMs, 99_000)
  assert.equal(rec.badgeMs, null)
})

test('the day keeps the best time and the best single run of ticks', () => {
  let rec = load(fakeStorage(), 10, 1)
  rec = record(rec, { day: 10, ms: 92_000, met: SOME, parMs: 95_000 })
  rec = record(rec, { day: 10, ms: 97_000, met: ALL, parMs: 95_000 })
  assert.equal(rec.bestMs, 92_000, 'the fast run stays the fast run')
  assert.equal(rec.badgeMs, 97_000, 'the clean sweep is its own time')
  assert.deepEqual(rec.met, ALL, 'three in one run beats two in a faster one')
})

test('a streak is claimed once a day, however many runs', () => {
  let rec = load(fakeStorage(), 10, 1)
  rec = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  rec = record(rec, { day: 10, ms: 89_000, met: ALL, parMs: 95_000 })
  assert.deepEqual(streaks(rec, 10), { time: 1, perfect: 1 })
})

test('a new day clears the times and keeps the streaks', () => {
  const storage = fakeStorage()
  let rec = load(storage, 10, 1)
  rec = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  save(storage, rec)

  const next = load(storage, 11, 1)
  assert.equal(next.day, 11)
  assert.equal(next.bestMs, null)
  assert.deepEqual(next.met, [false, false, false])
  assert.equal(next.timeStreak, 1)
  assert.equal(next.lastTimeDay, 10)
})

test('a sim change drops the times and keeps the streaks', () => {
  const storage = fakeStorage()
  let rec = load(storage, 10, 1)
  rec = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  save(storage, rec)

  // A time set on different physics is not the same time. Turning up is still
  // turning up.
  const after = load(storage, 10, 2)
  assert.equal(after.bestMs, null)
  assert.deepEqual(after.met, [false, false, false])
  assert.deepEqual(streaks(after, 10), { time: 1, perfect: 1 })
})

test('a corrupt record reads as a fresh one rather than throwing', () => {
  const map = new Map([[KEY, '{not json']])
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: () => {} }
  const rec = load(storage, 10, 1)
  assert.equal(rec.bestMs, null)
  assert.deepEqual(streaks(rec, 10), { time: 0, perfect: 0 })
})

test('two runs do not combine into a day that was never run', () => {
  let rec = load(fakeStorage(), 10, 1)
  // Neither run is a sweep, and their union would be. A union implementation
  // would report all three; the day's ticks are one run's or they are nothing.
  rec = record(rec, { day: 10, ms: 92_000, met: [true, true, false], parMs: 95_000 })
  rec = record(rec, { day: 10, ms: 93_000, met: [false, false, true], parMs: 95_000 })
  assert.deepEqual(rec.met, [true, true, false])
  assert.equal(rec.badgeMs, null, 'no run swept, so there is no badge time')
})

test('a second run on a day does not re-claim or reset the streak', () => {
  let rec = load(fakeStorage(), 10, 1)
  rec = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  rec = record(rec, { day: 11, ms: 90_000, met: ALL, parMs: 95_000 })
  assert.deepEqual(streaks(rec, 11), { time: 2, perfect: 2 })
  // Racing again the same day must neither bump the streak nor reset it. With
  // the once-a-day guard gone this collapses to 1.
  rec = record(rec, { day: 11, ms: 89_000, met: ALL, parMs: 95_000 })
  assert.deepEqual(streaks(rec, 11), { time: 2, perfect: 2 })
})

test('recording a run leaves the record it was given alone', () => {
  const rec = load(fakeStorage(), 10, 1)
  const snapshot = JSON.stringify(rec)
  const next = record(rec, { day: 10, ms: 90_000, met: ALL, parMs: 95_000 })
  assert.equal(JSON.stringify(rec), snapshot, 'input was mutated')
  assert.notEqual(rec.met, next.met, 'the met array is shared between records')
})

test('a day before the epoch still round-trips', () => {
  // dayNumber() is negative for a clock set before 2026, and that day is as
  // real as any other. Range-checking it away wipes the streak on reload.
  const storage = fakeStorage()
  let rec = load(storage, -1, 1)
  rec = record(rec, { day: -1, ms: 90_000, met: ALL, parMs: 95_000 })
  save(storage, rec)
  const back = load(storage, -1, 1)
  assert.equal(back.lastTimeDay, -1)
  assert.deepEqual(streaks(back, -1), { time: 1, perfect: 1 })
})
