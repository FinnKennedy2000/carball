// The daily's three objectives: a gimme, a skill and a price, chosen by the day
// number and identical for every player in the world.
//
// This module watches a race and never touches it. Every predicate reads a
// field the kart already carries, which is why shared/kart.js is unchanged by
// any of this — and there is a test that proves it.

import { CHASSIS_KEYS, driftTier, LAPS, padSpots, TRACKS, TRACK_KEYS } from './kart.js'
import { PAR } from './kart-par.js'

// Everyone is on the same day at the same instant, which is what makes a board
// coherent. The cost is that the day turns over mid-evening for some of the
// world, and that is the right trade for a board.
export const DAILY_EPOCH = Date.UTC(2026, 0, 1)
const DAY_MS = 86_400_000

/** Flooring modulo, so a clock set before the epoch still gives a valid index. */
function mod(n, m) {
  return ((n % m) + m) % m
}

export function dayNumber(nowMs) {
  return Math.floor((nowMs - DAILY_EPOCH) / DAY_MS)
}

/**
 * Twenty-one objectives, seven to a slot. `needs` is the track feature the
 * objective cannot do without — a jump cannot be landed on a track with no
 * jumps, and nothing can fall off a track with no void. `target` is read by the
 * predicate that uses it and is null for the pass/fail ones.
 */
export const ROSTER = [
  // Slot 1 — the gimme. Cleared by racing normally.
  { key: 'finish', slot: 1, name: 'Chequered flag', hint: 'see it through', needs: null, target: null },
  { key: 'jumps', slot: 1, name: 'Air miles', hint: 'land three jumps', needs: 'jumps', target: 3 },
  // 180 km/h is arithmetic, not taste: boosted top is BOOST_MAX for every
  // chassis (201.6 km/h) and the un-boosted tops run 129.6 to 149.4, so this
  // needs one boost and is equally reachable in all six.
  { key: 'topspeed', slot: 1, name: 'Flat out', hint: 'reach 180 km/h', needs: null, target: 180 },
  { key: 'charges', slot: 1, name: 'Turbo school', hint: 'charge four drift boosts', needs: null, target: 4 },
  { key: 'boostlit', slot: 1, name: 'Jets on', hint: 'ten seconds with boost lit', needs: null, target: 10 },
  { key: 'jumpeverylap', slot: 1, name: 'Frequent flyer', hint: 'land a jump on every lap', needs: 'jumps', target: LAPS },
  // 120 is under every chassis's un-boosted top, so this only asks that you do
  // not arrive at the line crawling. At 150 a van could not do it without a
  // boost on all three crossings, which is not a gimme.
  { key: 'flatoutline', slot: 1, name: 'Flying finish', hint: 'cross the line above 120 km/h every lap', needs: null, target: 120 },

  // Slot 2 — the skill. Rewards the fast line.
  { key: 'drifttime', slot: 2, name: 'Drift school', hint: 'eight seconds sideways', needs: null, target: 8 },
  { key: 'nospin', slot: 2, name: 'Clean sheet', hint: 'never spin out', needs: null, target: null },
  { key: 'nofall', slot: 2, name: 'Sure-footed', hint: 'never leave the circuit', needs: 'voids', target: null },
  { key: 'tiertwo', slot: 2, name: 'Deep blue', hint: 'four tier-two drifts', needs: null, target: 4 },
  { key: 'longdrift', slot: 2, name: 'One long one', hint: 'an unbroken three-second drift', needs: null, target: 3 },
  { key: 'tiertwoeverylap', slot: 2, name: 'Blue every lap', hint: 'a tier-two drift on every lap', needs: null, target: LAPS },
  { key: 'nospinjump', slot: 2, name: 'Stick the landing', hint: 'never spin out after a jump', needs: 'jumps', target: null },

  // Slot 3 — the price. Costs you time.
  { key: 'allpads', slot: 3, name: 'Scenic route', hint: 'touch every speed pad', needs: 'pads', target: null },
  { key: 'nopads', slot: 3, name: 'Cold jets', hint: 'never touch a speed pad', needs: 'pads', target: null },
  { key: 'padsonelap', slot: 3, name: 'Grand tour', hint: 'every pad on a single lap', needs: 'pads', target: null },
  { key: 'boxeachlap', slot: 3, name: 'Sticky fingers', hint: 'take a box on every lap', needs: 'boxes', target: LAPS },
  { key: 'noitem', slot: 3, name: 'Empty handed', hint: 'finish with no item ever in hand', needs: 'boxes', target: null },
  { key: 'ontarmac', slot: 3, name: 'Tarmac only', hint: 'never a wheel on the grass', needs: null, target: null },
  { key: 'speedfloor', slot: 3, name: 'No coasting', hint: 'never drop below 60 km/h', needs: null, target: 60 },
]

function supports(track, needs) {
  const t = TRACKS[track]
  if (needs === 'jumps') return (t.jumps?.length ?? 0) > 0
  if (needs === 'pads') return (t.pads?.length ?? 0) > 0
  if (needs === 'boxes') return (t.boxRows ?? 0) > 0
  if (needs === 'voids') return (t.voids?.length ?? 0) > 0
  return true
}

/**
 * Fisher-Yates on a xorshift32. Deliberately not Math.random and not a sort
 * comparator: the order has to be a pure function of the seed and identical in
 * every engine, or two players would be given different objectives on the same
 * day.
 */
function shuffled(pool, seed) {
  const out = [...pool]
  let h = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    h ^= h << 13
    h >>>= 0
    h ^= h >>> 17
    h ^= h << 5
    h >>>= 0
    const j = h % (i + 1)
    const t = out[i]
    out[i] = out[j]
    out[j] = t
  }
  return out
}

/**
 * One slot's objective for a day.
 *
 * A plain stride cannot be used here: the track is `day % 6`, so on any one
 * track `day` is congruent to a single value mod 6 and something like `day % 4`
 * would only ever take two values — the same two gimmes on that track forever.
 * A bare hash of the day fixes that but has no anti-repeat guarantee, so it
 * deals the identical objective two days running about one time in seven.
 *
 * So: a slot's pool depends only on the track, which means there are six stable
 * pools, and each is cycled over successive visits to its track. Every
 * objective comes up once before any repeats, and the order is reshuffled each
 * time round.
 */
function pickFor(slot, track, day) {
  const pool = ROSTER.filter((o) => o.slot === slot && supports(track, o.needs))
  // Cannot happen with the six tracks that exist: every slot has at least five
  // members needing nothing. Loud rather than silently dealing from elsewhere,
  // because a slot with no eligible objective means a new track is missing a
  // feature the roster assumes.
  if (!pool.length) throw new Error(`no slot ${slot} objective fits ${track}`)
  const visit = Math.floor(day / TRACK_KEYS.length)
  const era = Math.floor(visit / pool.length)
  // The track is in the seed, and it has to be. `visit` is constant across the
  // six days of a block, so the position within the cycle is the same for all
  // six — and slot 3's pool is composed identically on every track, so without
  // the track here an identical shuffle hands out the same objective six days
  // running. That is the repetition this whole scheme exists to prevent.
  const seed =
    (Math.imul(era + 1, 2654435761) ^
      Math.imul(slot + 1, 40503) ^
      Math.imul(TRACK_KEYS.indexOf(track) + 1, 2246822519)) >>>
    0
  return shuffled(pool, seed)[mod(visit, pool.length)]
}

export function dailyFor(day) {
  const track = TRACK_KEYS[mod(day, TRACK_KEYS.length)]
  const chassis = CHASSIS_KEYS[mod(Math.floor(day / TRACK_KEYS.length), CHASSIS_KEYS.length)]
  return {
    day,
    seed: day >>> 0,
    track,
    chassis,
    parMs: PAR[track]?.[chassis] ?? null,
    objectives: [pickFor(1, track, day), pickFor(2, track, day), pickFor(3, track, day)],
  }
}

const KMH = 3.6
// A bad landing and the spin it causes are the same event a beat apart, so a
// window is what connects them.
const SPIN_AFTER_JUMP = 1.5
// No coasting ignores the first moments after the lights: a grid start is not
// coasting, it is a grid start.
const FLOOR_GRACE = 2

/**
 * Everything the day's three objectives need to watch, gathered as the race
 * runs. Built after createRace, because the pad list comes off the loaded track.
 */
export function startProgress(daily, laps = LAPS) {
  return {
    daily,
    // The race's own lap count rather than the constant, so "on every lap"
    // means what the race means by a lap.
    laps,
    t: 0,
    padList: padSpots(),
    prevAir: 0,
    prevTier: 0,
    prevLap: 0,
    landedAt: -Infinity,
    jumps: 0,
    jumpLaps: new Set(),
    topSpeed: 0,
    minSpeed: Infinity,
    charges: 0,
    tierTwo: 0,
    tierTwoLaps: new Set(),
    driftFor: 0,
    longestDrift: 0,
    boostFor: 0,
    lineSpeeds: [],
    spun: false,
    fellOff: false,
    spunAfterJump: false,
    pads: new Set(),
    padsByLap: new Map(),
    boxLaps: new Set(),
    hadItem: false,
    tookItem: false,
    offRoad: false,
  }
}

/** One tick's worth of watching. Reads the kart; writes only to `p`. */
export function observe(p, kart, dt) {
  p.t += dt
  const speed = Math.hypot(kart.vx, kart.vy) * KMH
  if (speed > p.topSpeed) p.topSpeed = speed
  if (p.t > FLOOR_GRACE && kart.finished === null && speed < p.minSpeed) p.minSpeed = speed

  // A landing is air falling back to zero, and it is the only moment a jump can
  // be counted: nothing reaches a kart while it is up there.
  if (p.prevAir > 0 && kart.air === 0) {
    p.jumps++
    p.jumpLaps.add(kart.lap)
    p.landedAt = p.t
  }
  p.prevAir = kart.air

  const tier = driftTier(kart)
  if (tier >= 1 && p.prevTier < 1) p.charges++
  if (tier >= 2 && p.prevTier < 2) {
    p.tierTwo++
    p.tierTwoLaps.add(kart.lap)
  }
  p.prevTier = tier
  // driftTime resets when the drift is released, so the longest unbroken drift
  // is simply the running maximum of it — no extra state.
  if (kart.driftTime > 0) p.driftFor += dt
  if (kart.driftTime > p.longestDrift) p.longestDrift = kart.driftTime
  if (kart.boost > 0) p.boostFor += dt

  if (kart.spin > 0) {
    p.spun = true
    if (p.t - p.landedAt < SPIN_AFTER_JUMP) p.spunAfterJump = true
  }
  if (kart.fell > 0 || kart.respawn > 0) p.fellOff = true

  // The speed carried over the line, once per crossing.
  if (kart.lap > p.prevLap) p.lineSpeeds.push(speed)
  p.prevLap = kart.lap
}

/** Did this objective land? Throws on a key it does not know, deliberately. */
export function cleared(o, p, kart) {
  switch (o.key) {
    case 'finish':
      return kart.finished !== null
    case 'jumps':
      return p.jumps >= o.target
    case 'topspeed':
      return p.topSpeed >= o.target
    case 'charges':
      return p.charges >= o.target
    case 'boostlit':
      return p.boostFor >= o.target
    case 'jumpeverylap':
      return everyLap(p, p.jumpLaps)
    case 'flatoutline':
      return p.lineSpeeds.length >= p.laps && p.lineSpeeds.every((s) => s >= o.target)
    case 'drifttime':
      return p.driftFor >= o.target
    case 'nospin':
      return !p.spun
    case 'nofall':
      return !p.fellOff
    case 'tiertwo':
      return p.tierTwo >= o.target
    case 'longdrift':
      return p.longestDrift >= o.target
    case 'tiertwoeverylap':
      return everyLap(p, p.tierTwoLaps)
    case 'nospinjump':
      return !p.spunAfterJump
    default:
      throw new Error(`unknown objective: ${o.key}`)
  }
}

function everyLap(p, set) {
  for (let l = 0; l < p.laps; l++) if (!set.has(l)) return false
  return true
}

/** A short line for the panel: where you are, against what it wants. */
export function detailOf(o, p, kart) {
  switch (o.key) {
    case 'finish':
      return kart.finished !== null ? 'home' : 'still out there'
    case 'jumps':
      return `${p.jumps}/${o.target}`
    case 'topspeed':
      return `${Math.round(p.topSpeed)} / ${o.target} km/h`
    case 'charges':
      return `${p.charges}/${o.target}`
    case 'boostlit':
      return `${p.boostFor.toFixed(1)}s / ${o.target}s`
    case 'jumpeverylap':
      return `${p.jumpLaps.size}/${p.laps} laps`
    case 'flatoutline':
      return `${p.lineSpeeds.filter((s) => s >= o.target).length}/${p.laps} laps`
    case 'drifttime':
      return `${p.driftFor.toFixed(1)}s / ${o.target}s`
    case 'nospin':
      return p.spun ? 'spun out' : 'clean'
    case 'nofall':
      return p.fellOff ? 'went off' : 'stayed on'
    case 'tiertwo':
      return `${p.tierTwo}/${o.target}`
    case 'longdrift':
      return `${p.longestDrift.toFixed(1)}s / ${o.target}s`
    case 'tiertwoeverylap':
      return `${p.tierTwoLaps.size}/${p.laps} laps`
    case 'nospinjump':
      return p.spunAfterJump ? 'lost it on a landing' : 'stuck them'
    default:
      throw new Error(`unknown objective: ${o.key}`)
  }
}

export function settle(p, kart) {
  return {
    met: p.daily.objectives.map((o) => cleared(o, p, kart)),
    detail: p.daily.objectives.map((o) => detailOf(o, p, kart)),
  }
}
