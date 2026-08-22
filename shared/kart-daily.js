// The daily's three objectives: a gimme, a skill and a price, chosen by the day
// number and identical for every player in the world.
//
// This module watches a race and never touches it. Every predicate reads a
// field the kart already carries, which is why shared/kart.js is unchanged by
// any of this — and there is a test that proves it.

import { CHASSIS_KEYS, LAPS, TRACKS, TRACK_KEYS } from './kart.js'
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
