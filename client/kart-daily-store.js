// The daily's memory. Streak arithmetic is real logic and deserves a test, so
// it lives here rather than in kart.js — and `storage` is a parameter rather
// than a reach for localStorage, which is what makes it testable under node.

export const KEY = 'carball.kart.daily'
const VERSION = 1

function empty(day, sim) {
  return {
    v: VERSION,
    sim,
    day,
    bestMs: null,
    badgeMs: null,
    met: [false, false, false],
    timeStreak: 0,
    lastTimeDay: null,
    perfectStreak: 0,
    lastPerfectDay: null,
  }
}

const int = (n) => (Number.isInteger(n) && n >= 0 ? n : 0)
// A day index is signed on purpose, unlike the count and the duration beside
// it: dayNumber() returns a negative day for a clock set before the epoch and
// dailyFor() handles one, so rejecting negatives here would silently wipe such
// a player's streak on their next load.
const dayOr = (n) => (Number.isInteger(n) ? n : null)
const msOr = (n) => (Number.isFinite(n) && n > 0 ? n : null)

/**
 * Read the record, rolled forward to `day`.
 *
 * A `sim` mismatch drops the times and keeps the streaks: a personal best set
 * on different physics is not a personal best, but a streak is a record of
 * turning up and a tuning change is not the player's fault.
 */
export function load(storage, day, sim) {
  let raw = null
  try {
    raw = JSON.parse(storage.getItem(KEY) ?? 'null')
  } catch {
    return empty(day, sim)
  }
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return empty(day, sim)

  const rec = {
    ...empty(day, sim),
    timeStreak: int(raw.timeStreak),
    lastTimeDay: dayOr(raw.lastTimeDay),
    perfectStreak: int(raw.perfectStreak),
    lastPerfectDay: dayOr(raw.lastPerfectDay),
  }
  // Today's runs survive a reload; yesterday's do not, and neither do times
  // from a different sim.
  if (raw.sim === sim && raw.day === day) {
    rec.bestMs = msOr(raw.bestMs)
    rec.badgeMs = msOr(raw.badgeMs)
    rec.met = Array.isArray(raw.met) && raw.met.length === 3 ? raw.met.map(Boolean) : rec.met
  }
  return rec
}

export function save(storage, rec) {
  storage.setItem(KEY, JSON.stringify(rec))
}

const count = (met) => met.filter(Boolean).length

/**
 * Fold one finished run into the record. Pure: it returns the next record and
 * leaves the one it was given alone.
 */
export function record(rec, { day, ms, met, parMs }) {
  const next = rec.day === day ? { ...rec, met: [...rec.met] } : { ...rec, ...blank(), day }
  const perfect = met.every(Boolean)

  if (next.bestMs === null || ms < next.bestMs) next.bestMs = ms
  if (perfect && (next.badgeMs === null || ms < next.badgeMs)) next.badgeMs = ms
  // The day's ticks are the best set landed in a single run, never a union
  // across runs: all three at once is the whole point of the three.
  if (count(met) > count(next.met)) next.met = [...met]

  // Claimed once a day however many runs it took, and a streak only continues
  // from the day before.
  if (parMs !== null && ms <= parMs && next.lastTimeDay !== day) {
    next.timeStreak = next.lastTimeDay === day - 1 ? next.timeStreak + 1 : 1
    next.lastTimeDay = day
  }
  if (perfect && next.lastPerfectDay !== day) {
    next.perfectStreak = next.lastPerfectDay === day - 1 ? next.perfectStreak + 1 : 1
    next.lastPerfectDay = day
  }
  return next
}

function blank() {
  return { bestMs: null, badgeMs: null, met: [false, false, false] }
}

/**
 * What to put on screen. A streak reads as zero unless it was kept yesterday or
 * today, so a missed day costs it with no scheduled job and no cleanup pass —
 * the gap in the record is evidence enough.
 */
export function streaks(rec, day) {
  return {
    time: rec.lastTimeDay !== null && rec.lastTimeDay >= day - 1 ? rec.timeStreak : 0,
    perfect: rec.lastPerfectDay !== null && rec.lastPerfectDay >= day - 1 ? rec.perfectStreak : 0,
  }
}
