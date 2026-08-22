# The Daily Line — three objectives a day

**Status:** spec, reviewed and amended. Nothing built, nothing committed.
**Companion to:** `docs/specs/2026-08-21-kart-carball-five-features.md`, which
this depends on only for `SIM_VERSION`.
**Every line reference below was verified against the tree at `d374015`.**

## Goal

Give Kart's daily a reason to be replayed within the day, not just opened once:
three named objectives alongside the clock, chosen by the day number, identical
for every player in the world.

## Decisions taken

Settled in review; recorded so the plan does not relitigate them.

1. **Objectives, not modifiers.** The day never changes the rules of the sim.
   Same track, same physics, same three laps. This is what keeps the sim
   untouched.
2. **Three slots with fixed jobs** — a gimme, a skill, and a price. One of each
   every day, so there is a real decision but never a wasted run.
3. **All three must land in one run.** A perfect day is deliberately a slower day.
4. **Two separate streaks.** A time streak for beating par, a perfect streak for
   the three. The fast run and the clean sweep are different runs and neither
   spoils the other.
5. **Par is the AI's time**, generated rather than hand-tuned.
6. **Slot 3 pays nothing.** A box on a one-kart road yields an item you cannot
   use; that is the honest version of a price. `roll()` is not touched.
7. **Twenty-one objectives, seven per slot, on a per-track cycle.** Twelve on a
   hash was the first draft and it was wrong twice over — see *Choosing the
   three*.

## Day identity

```js
// Everyone is on the same day at the same instant, which is what makes a
// global board coherent. The cost is that the day turns over mid-evening for
// some of the world, and that is the right trade for a board.
export const DAILY_EPOCH = Date.UTC(2026, 0, 1)
export function dayNumber(nowMs) {
  return Math.floor((nowMs - DAILY_EPOCH) / 86_400_000)
}
```

- `track = TRACK_KEYS[mod(day, 6)]`
- `chassis = CHASSIS_KEYS[mod(Math.floor(day / 6), 6)]`
- `seed = day >>> 0`

Six tracks x six chassis is **36 days before a track/chassis pair repeats**, and
no PRNG chooses them, so there is no seed distribution to audit. `mod` is a
flooring modulo, so a clock set before the epoch gives a valid day rather than
an index of `NaN`.

## The module

One new file, `shared/kart-daily.js`. Pure, no DOM, no imports outside
`shared/`. It observes a race; it never writes to one.

```js
export function dayNumber(nowMs)         // -> integer day index
export function dailyFor(day)            // -> Daily
export function startProgress(daily, laps)   // -> Progress   (call AFTER createRace)
export function observe(progress, kart, dt)  // once per tick, RACE only
export function settle(progress, kart)   // -> { met: [bool,bool,bool], detail: [string,string,string] }
```

```js
// Daily
{
  day: 142,
  seed: 142,
  track: 'grove',
  chassis: 'van',
  parMs: 165000,                     // from shared/kart-par.js, or null
  objectives: [gimme, skill, price]  // always exactly three, in slot order
}

// Objective
{
  key: 'allpads',
  slot: 3,
  name: 'Scenic route',
  hint: 'touch every speed pad',
  needs: 'pads',        // 'pads' | 'jumps' | 'boxes' | 'voids' | null
  target: null          // meaning depends on key; null for pass/fail
}
```

`observe` is called from the client's frame loop immediately after `K.step()`,
once per simulated tick, with the same `dt` the sim used, and only while
`state.phase === 'RACE'`. It takes no `state`: nothing it watches lives above the
kart, and an unused parameter is a promise the module does not keep. The lap
count it needs for "on every lap" comes from `startProgress`.

`startProgress` captures the track's pad list once, so it **must be called after
`createRace`**, which is what sets the track.

## The roster

Twenty-one objectives, seven per slot. Every one reads a field the kart already
carries — this is the whole reason no sim change is needed.

### Slot 1 — the gimme

| key | Name / hint | Predicate | needs | target |
|---|---|---|---|---|
| `finish` | Chequered flag — see it through | `kart.finished !== null` | — | — |
| `jumps` | Air miles — land three jumps | count `prevAir > 0 && kart.air === 0` | `jumps` | 3 |
| `topspeed` | Flat out — reach 180 km/h | `max(hypot(vx,vy) * 3.6) >= 180` | — | 180 |
| `charges` | Turbo school — charge four drift boosts | count `driftTier()` rising to `>= 1` | — | 4 |
| `boostlit` | Jets on — ten seconds with boost lit | accumulate `dt` while `kart.boost > 0` | — | 10 |
| `jumpeverylap` | Frequent flyer — land a jump on every lap | set of laps carrying a landing | `jumps` | 3 |
| `flatoutline` | Flying finish — cross the line above 120 km/h every lap | speed at each lap turnover | — | 120 |

Two thresholds are arithmetic, not taste. `max = boosting ? BOOST_MAX : st.top`
(`shared/kart.js:1003`); `BOOST_MAX = 56` m/s = 201.6 km/h for **every** chassis,
while un-boosted tops run 36–41.5 m/s = 129.6–149.4 km/h (`CHASSIS_STATS`,
`shared/kart.js:63`).

- `topspeed` at 180 km/h therefore cannot be reached without a boost, and is
  equally reachable in all six chassis. A gimme with one nudge in it.
- `flatoutline` at 120 km/h is under every chassis's un-boosted top, so it asks
  only that you do not arrive at the line crawling. At 150 it would have been
  unreachable in a van without a boost on all three crossings, which is not a
  gimme.

`driftTier()` is already exported (`shared/kart.js:1519`); use it rather than
comparing against `DRIFT_TIERS` by hand.

### Slot 2 — the skill

| key | Name / hint | Predicate | needs | target |
|---|---|---|---|---|
| `drifttime` | Drift school — eight seconds sideways | accumulate `dt` while `kart.driftTime > 0` | — | 8 |
| `nospin` | Clean sheet — never spin out | fail if `kart.spin > 0` on any observed tick | — | — |
| `nofall` | Sure-footed — never leave the circuit | fail if `kart.fell > 0 \|\| kart.respawn > 0` | `voids` | — |
| `tiertwo` | Deep blue — four tier-two drifts | count `driftTier()` rising to `2` | — | 4 |
| `longdrift` | One long one — an unbroken three-second drift | `max(kart.driftTime)` | — | 3 |
| `tiertwoeverylap` | Blue every lap — a tier-two drift on every lap | set of laps carrying a tier-two rise | — | 3 |
| `nospinjump` | Stick the landing — never spin out after a jump | fail if `spin > 0` within 1.5s of a landing | `jumps` | — |

`kart.driftTime` resets to 0 when the drift is released, so `longdrift` is
simply the running maximum of it — no extra state.

**Cut deliberately:** "six seconds of slipstream". `kart.draft` is derived from
other karts and is permanently 0 with one kart on the road.

### Slot 3 — the price

| key | Name / hint | Predicate | needs | target |
|---|---|---|---|---|
| `allpads` | Scenic route — touch every speed pad | every pad index touched | `pads` | — |
| `nopads` | Cold jets — never touch a speed pad | no pad index touched | `pads` | — |
| `padsonelap` | Grand tour — every pad on a single lap | one lap carrying every pad index | `pads` | — |
| `boxeachlap` | Sticky fingers — take a box on every lap | `kart.item` goes null→non-null on each lap | `boxes` | 3 |
| `noitem` | Empty handed — finish with no item ever in hand | fail if `kart.item !== null` on any tick | `boxes` | — |
| `ontarmac` | Tarmac only — never a wheel on the grass | fail if off-road on any observed tick | — | — |
| `speedfloor` | No coasting — never drop below 60 km/h | fail if `hypot(vx,vy) * 3.6 < 60` | — | 60 |

`nopads` is the clearest price in the roster: every speed pad on the track is a
boost you have to refuse. `noitem` is the mirror of `boxeachlap` — boxes sit
three abreast on the road (`boxSpots`, `shared/kart.js:622`), so avoiding all of
them means weaving off the line just as taking all of them does.

Three of these mirror logic that already exists, and must mirror it **exactly**
or the panel will disagree with what the player felt.

**`allpads` / `nopads` / `padsonelap`** reproduce `hitPads`
(`shared/kart.js:470`) using only exported pieces — `project()`, `padSpots()`,
`PAD_LENGTH` (`shared/kart.js:430`) and `TRACK.length`:

```js
// Skipped in exactly the cases hitPads skips, so a pad this counts is a pad
// that gave you the boost.
if (kart.respawn > 0 || kart.finished !== null || kart.spin > 0) return
const hit = project(kart.x, kart.y)
p.padList.forEach((pad, i) => {
  let along = hit.s - pad.s
  if (along > TRACK.length / 2) along -= TRACK.length
  if (along < -TRACK.length / 2) along += TRACK.length
  if (Math.abs(along) > PAD_LENGTH / 2) return
  if (Math.abs(hit.lateral - pad.lane) > pad.halfWidth) return
  p.pads.add(i)
  p.padsByLap.get(kart.lap)?.add(i) ?? p.padsByLap.set(kart.lap, new Set([i]))
})
```

`padSpots()` already returns `lane` (the clamped `padLane`) and `halfWidth`
(`pad.half`), so the private `padLane` is not needed.

**`ontarmac`** reproduces the sim's own off-road test verbatim —
`Math.abs(hit.lateral) > halfWidthAt(hit.s)` (`shared/kart.js:987`) — and skips
while `kart.air > 0 || kart.fell > 0 || kart.respawn > 0`. Without that skip, a
track with a jump over a gap would fail the objective for flying, which is the
opposite of the intent.

**`speedfloor`** ignores the first 2 seconds after the lights and everything
after `kart.finished !== null`. Standing on the grid at 0 km/h is not coasting.

## Choosing the three

The first draft picked each slot with `hash(day) % pool.length` over a
twelve-objective roster. That was wrong twice, and both are worth recording so
they are not reintroduced:

1. **A plain stride cannot be used at all.** `track = day % 6`, so for any fixed
   track `day` is congruent to one value mod 6 — and `day % 4` then takes only
   *two* distinct values on that track. Grove Run would deal the same two gimmes
   forever.
2. **A hash has no anti-repeat guarantee.** Independent picks on consecutive days
   mean a ~1-in-`n` chance of dealing the identical objective two days running,
   and it can run three deep. With four per slot that is a quarter of all days.

**The fix: a shuffled cycle per track.** A slot's eligible pool is a function of
`day % 6` only, so there are six stable pools per slot. Cycle each pool over
successive *visits to that track*:

```js
function pickFor(slot, track, day) {
  const pool = ROSTER.filter((o) => o.slot === slot && supports(track, o.needs))
  const visit = Math.floor(day / TRACK_KEYS.length)   // which time round on this track
  const era = Math.floor(visit / pool.length)
  // The track belongs in the seed. `visit` is constant across the six days of a
  // block, so all six take the same position in their cycle; slot 3's pool is
  // composed identically on every track, so without the track here the same
  // objective is dealt six days running.
  const seed =
    (Math.imul(era + 1, 2654435761) ^
      Math.imul(slot + 1, 40503) ^
      Math.imul(TRACK_KEYS.indexOf(track) + 1, 2246822519)) >>> 0
  return shuffled(pool, seed)[mod(visit, pool.length)]
}

// Fisher-Yates on a xorshift32, so the order is a pure function of the seed and
// identical in every browser: no Math.random, no engine-dependent sort.
function shuffled(pool, seed) {
  const out = [...pool]
  let h = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    h ^= h << 13; h >>>= 0
    h ^= h >>> 17
    h ^= h << 5; h >>>= 0
    const j = h % (i + 1)
    const t = out[i]; out[i] = out[j]; out[j] = t
  }
  return out
}
```

Every objective in a track's pool appears exactly once before any repeat, and the
order reshuffles each cycle. Measured over 400 days, the same objective lands in
the same slot on consecutive days 191 times out of 1200 transitions — the ~1/7
floor for independent per-track shuffles. Without the track in the seed it was
711, which is the defect this arithmetic exists to avoid.

With a pool of seven on a track visited every sixth day, **an objective cannot
return to that track for 42 days**. The only
coincidence left is the last pick of one cycle matching the first of the next,
which is one visit in seven and forty-two real days apart.

### Filtering by track — and it is load-bearing

- `needs: 'jumps'` → `TRACKS[track].jumps?.length > 0`
- `needs: 'pads'` → `TRACKS[track].pads?.length > 0`
- `needs: 'boxes'` → `TRACKS[track].boxRows > 0`
- `needs: 'voids'` → `TRACKS[track].voids?.length > 0`
- `needs: null` → always eligible

The actual capability table:

| track | jumps | pads | boxRows | voids | pool 1 | pool 2 | pool 3 |
|---|---|---|---|---|---|---|---|
| circuit | 2 | 12 | 8 | 5 | 7 | 7 | 7 |
| bayside | **0** | 5 | 4 | **0** | 5 | 5 | 7 |
| grove | 1 | 6 | 5 | **0** | 7 | 6 | 7 |
| foundry | 2 | 8 | 6 | 1 | 7 | 7 | 7 |
| cliff | 2 | 9 | 7 | 3 | 7 | 7 | 7 |
| fracture | 3 | 10 | 8 | 4 | 7 | 7 | 7 |

Two consequences. **Bayside has no jumps**, so `jumps`, `jumpeverylap` and
`nospinjump` must never be dealt there. And `kart.fell` only ever increments over
a void (`overVoid`), so `nofall` is *unfailable* on bayside and grove — which is
why it carries `needs: 'voids'`. An objective that cannot be failed is worse than
no objective: it reads as a tick the player did not earn.

`jumps` keeps a target of 3 against a three-lap race, so on grove — one jump on
the circuit — it means taking that jump on all three laps. Still a gimme,
because the jump is on the road you were driving anyway.

## Par

Par is the one thing the daily needs that does not exist. The `lap: 69.62`
figures in `client/kart-chassis.js:261` are six hand-written numbers for one
reference lap of one track — not a per-track par table.

**Generate it.** `scripts/kart-par.mjs` runs a headless one-kart AI race for each
of the 36 `(track, chassis)` pairs and writes `shared/kart-par.js` as a nested
object of milliseconds. Par is then *the AI's time*: legible to a player ("beat
the AI"), self-maintaining, and regenerated whenever `SIM_VERSION` changes.

**The non-obvious step.** `addKart()` overwrites the chassis of any AI kart with
a random one (`shared/kart.js:748`) and gives it a random line offset (`:752`).
Passing `{ai: true, chassis}` therefore does *not* get an AI driving that
chassis. `addKart` returns the kart, so:

```js
// Seated as a person, then handed to the AI: addKart deals an AI its own
// chassis and its own offset, and par needs the named chassis on the
// centreline — the same line every time this is regenerated.
const k = addKart(state, { id: 1, name: 'par', chassis })
k.ai = true
```

`k.offset` stays 0, so the par lap is driven dead centre and is reproducible.
Step until `k.finished !== null`, with a tick ceiling so a track the AI cannot
complete fails the script loudly instead of hanging.

## Storage and the two streaks

One key, `carball.kart.daily`:

```json
{
  "v": 1,
  "sim": 1,
  "day": 142,
  "bestMs": 161060,
  "badgeMs": 167900,
  "met": [true, true, false],
  "timeStreak": 7,
  "lastTimeDay": 142,
  "perfectStreak": 2,
  "lastPerfectDay": 141
}
```

**Streaks are computed, not incremented.** On clearing a day:

```js
timeStreak = lastTimeDay === day - 1 ? timeStreak + 1 : 1
lastTimeDay = day
```

For display, a streak reads as 0 unless `lastTimeDay >= day - 1`. A missed day
therefore costs the streak with no scheduled job and no cleanup pass — the gap is
evidence enough.

**The day's ticks are the best set landed in a single run, not a union across
runs.** All three in one run is the whole point.

**On a `sim` mismatch, times reset and streaks survive.** A personal best set on
different physics is not a personal best, but a streak is a record of turning up,
and a tuning change is not the player's fault.

## Screen

A **Daily** button on Kart's gate, beside "Race five AI". It calls a
`startDaily()` that is `startSolo()` with three changes: the racer list is one
kart, the seed and track come from `dailyFor()`, and the chassis is the day's
rather than the stored preference. Boxes stay exactly as they are.

During the race, a small panel under the existing readouts: three rows, each a
tick or a cross, a name, and progress where it is countable (`2.4s / 8.0s`,
`6/12`). Live, because a price you cannot see the cost of is not a decision.

At the flag, the results panel gains the day's line, both streaks, and — when all
three landed — the one thing worth celebrating. A **Copy result** button puts one
line on the clipboard:

```
Daily Line #142 ✓✓✗ 2:41.06 🔥7
```

No link, no image: a line of text pastes into anything.

## Why the day is fair

`rand(state)` has exactly three consumers: `shared/kart.js:748` and `:752`, both
AI-only and both before the lights, and `roll()` at `:1149`. **On a one-kart
daily the only in-race consumer of the PRNG is the item roll.** A player's route
can therefore change which item they were given and *nothing physical* — no
divergence in the road, the pads, or the boxes' positions.

And with `state.karts.length === 1`, `roll()` computes `frac = 0` and reads
`ROLL_TABLE[0]` — the leader row: bananas, green shells, fake boxes. Items with
nobody to use them on. This is why slot 3 pays nothing and why that is correct
rather than a shortcoming: a box on the daily is a route decision, not a lottery
ticket.

## Testing

`test/kart-daily.test.js`:

1. `dailyFor(142)` twice gives the same triple, track, chassis and seed.
2. Over days 0–400, no objective is ever dealt whose `needs` the day's track does
   not support — in particular `jumps`, `jumpeverylap` and `nospinjump` never
   appear on bayside, and `nofall` never appears on bayside or grove.
3. Over days 0–400, every one of the 21 keys is dealt at least once.
4. **No objective repeats on the same track until its pool is exhausted:** for
   each track and slot, walk that track's days in order and assert the picks form
   repeating permutations of the pool.
5. One scripted run per objective key, asserting met and not-met either side of
   the threshold. `nospin`, `nofall`, `ontarmac` and `noitem` each get a run where
   the condition is violated exactly once.
6. `allpads` on a track with pads: a run down the centreline misses at least one
   pad and the objective is not met. This is the test that proves slot 3 costs
   something.
7. **The tracker is observation-only:** step an identical race 1200 ticks twice,
   once with `observe()` attached and once without, and assert
   `hashRace(a) === hashRace(b)`.

`test/kart-par.test.js`: all 36 pairs present, every entry a finite number inside
a plausible band.

`test/kart-daily-store.test.js`: day rollover keeps streaks and clears times; a
consecutive day extends a streak; a gap resets it; a `sim` mismatch drops times
and keeps streaks; corrupt JSON yields a usable empty record.

## Second wave — the lap-consistency family

The most interesting material available needs `kart.splits`, the four-line sim
change in Feature 1 of the companion spec. It is **not** in this spec, because
adding it here would break the no-sim-change property that makes the rest of this
cheap and safe. Once Feature 1 lands, three objectives drop straight into the
roster with no other work:

- *Metronome* (skill) — all three laps within two seconds of each other
- *Building* (skill) — every lap faster than the one before
- *Under the clock* (gimme) — no lap slower than par/3 plus five seconds

## Out of scope

- **A global board and server submission.** Needs `api/submit-daily.js` with
  authoritative re-simulation, which needs the Node-vs-browser determinism
  question answered first. The daily works fully as a local streak until then,
  and guests keep it — gating the daily behind sign-in would break the funnel it
  exists to fix.
- **Carball's daily.** Its own spec; it needs new sim code, which this does not.
- **Daily modifiers** — mirrored tracks, low grip, one-lap sprints. Rejected in
  review in favour of objectives.
- **Ghost of the day's best**, which arrives free once Feature 2 of the companion
  spec exists.

## Cost

| Piece | Size |
|---|---|
| `shared/kart-daily.js` | ~300 lines: 21 descriptors and their predicates |
| `scripts/kart-par.mjs` + `shared/kart-par.js` | ~60 lines and a generated table |
| `client/kart-daily-store.js` | ~90 lines |
| `client/kart.js` — `startDaily()`, panel, results, clipboard | ~150 lines |
| `client/kart.html` — button and panel markup | ~30 lines |
| Three test files | ~320 lines |

No change to `shared/kart.js`. No new dependency. No new Realtime message.
