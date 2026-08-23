# Skill ladder — where it got to, and what round 5 has to do

Branch `kart-skill-ladder`, one commit on top of `main`. Not merged. `main` is
unaffected and still has the rounds 1–3 AI, which is live.

## The goal

A race should be a ladder the player climbs: some karts they catch and pass,
some they have to work for. Today every AI drives to the same standard and the
finishing order is decided by the chassis roll and the item table.

## What is on the branch

`kart.skill`, one number per AI kart, dealt in `begin()` — not `addKart`,
because the field size is only known once the lights go on and a rung-per-kart
deal needs it. A two-AI race must contain one weak and one strong, not two
weak. Five behaviours derive from a multiplier `worse = 1.35 → 0.65`:

| lever | weak kart | strong kart |
|---|---|---|
| share of the racing line | 0.66 | 1.08 |
| cashing the mini-turbo | lets go a fraction short of tier one | holds to tier two, cashes, re-lights |
| drift gate | opens later | `max(0.85, worse)`, clamped so it never opens past where round 1 showed off-road explodes |
| braking | lifts on the approach for a corner the strong kart takes flat | flat |
| hands and nerve | coarser deadband, higher bar for a gap | finer, bolder |

`k.skill` is in `hashRace`. No `Math.random`, no `Date`. 212 tests pass.

## What works

Measured over 6 tracks × 20 seeds against an ablated control (same build,
`skill = 0.5` for everyone, `rand` draw kept so the item stream is identical):

| | with skill | control |
|---|---|---|
| skill vs finishing position (Pearson) | −0.159 | no variance |
| lap gap, strongest vs weakest | **0.445 s** | −0.020 s |
| strongest kart wins | 20.0% | 16.7% (= random) |

Per track, the gap per lap:

| circuit | foundry | fracture | grove | cliff | bayside |
|---|---|---|---|---|---|
| **+1.41 s** | **+1.49 s** | **+1.50 s** | −0.03 s | −0.34 s | −1.36 s |

On the three tight circuits the ladder is real and a player would feel it. The
strongest kart wins 45% / 35% / 20% there against a 16.7% baseline.

## The three reasons it is not merged

**1. The ladder only exists on half the maps.** Grove, cliff and bayside show
nothing, and bayside is inverted. The builder's explanation is that those
circuits are wide and fast, everyone is speed-capped almost all the time, so
there is no corner time for the levers to bite on. *That explanation is
unverified and I doubt it* — rounds 1–3 cut bayside's winning lap from 107.8 s
to 94.7 s, a 12% gain, and the racing line is precisely a corner-time lever.
Both cannot be true. **Settle this first; it decides whether the dead tracks
are a bug in the levers or a property of the circuits.**

**2. The ladder is built entirely downward.** The strongest kart is 0.36 s a
lap *slower* than the uniform AI it replaced (best lap 51.42 s vs 51.07 s).
Every kart is at or below the old standard, so the field gets easier on
average — the opposite of the ask. The "better" direction is currently a no-op:
the drift gate is clamped at 0.85 and extra line share hits the corridor limit,
so a strong kart has nowhere to gain. **A strong kart must end up at least as
quick as the old uniform AI, or this makes the game easier.**

**3. Three banked bars slipped**, on the pinned harness `scratchpad/telemetry.mjs`:

| | now | bar | ablated control |
|---|---|---|---|
| apexIn | 0.498 | 0.50 | 0.492 |
| drift % | 14.62 | 15 | 15.21 |
| winning lap set | 152.18 s | 148.0 | 149.79 |

The builder argues these should be re-expressed as *the strongest kart in the
field* rather than the field mean, since a field containing deliberately worse
drivers has a lower mean by construction. **That reasoning is sound in
principle and unruled-on in practice** — the critic was cut off before it could
decide. Note the control misses the winner bar too, which suggests something
drifted for reasons unrelated to skill and should be checked before the bar is
moved. Do not let the bar move without establishing that.

## Two findings worth keeping regardless

- **Mini-turbos are close to pace-neutral in this sim.** 9.3 vs 26.2 turbo tiers
  per race produces mean speeds of 38.17 vs 37.97 m/s — the grip a drift gives
  up costs about what the boost pays back. This is a balance fact about the game
  for human players, not just the AI, and it is worth deciding whether that is
  intended before tuning around it.
- **Weaving on straights costs nothing**, because everyone is speed-capped
  there. A heading wobble does not lengthen the path enough to matter, so
  "sloppy hands" is not a lap-time lever outside corners.
- The item roll is a deliberate rubber band worth roughly 12 s of finish spread
  against a 1.3 s pace ladder. That is why the correlation is −0.16 rather than
  −0.6. **The item table sets the ceiling on how much any skill ladder can
  show** — worth knowing before pushing the ladder harder.

## The frontier already walked, so round 5 does not re-walk it

| config | skill·place | gap/lap | apexIn | drift% | off-road% |
|---|---|---|---|---|---|
| line share + drift gate + worth only | −0.064 | 0.11 | 0.472 | 11.9 | 1.05 |
| + cash the turbo | −0.133 | 0.18 | — | — | — |
| + coarse hands | −0.060 | 0.52 | — | — | — |
| recentred on 1.0 | −0.062 | 0.34 | 0.509 | 16.2 | 1.72 |
| + brake in the corner | −0.152 | 0.62 | 0.493 | 12.9 | 1.26 |
| coarse hands on straights only | 0.007 | −0.03 | 0.491 | 14.7 | 1.47 |
| **on the branch: brake on approach** | **−0.159** | **0.45** | **0.498** | **14.6** | **1.31** |

## Round 5, in order

1. **Settle the speed-cap question.** Measure, per track, what fraction of a lap
   each kart spends at `MAX_SPEED`, and where the rounds 1–3 lap-time gain on
   bayside/grove/cliff actually came from. If there is corner time on those
   tracks, the dead ladder is a bug and fixing it is the whole job.
2. **Make the top of the ladder faster, not just the bottom slower.** Find a
   lever that gains lap time without trading into off-road. If none exists, say
   so with the measurement and accept that the ladder straddles by making the
   strong kart merely *equal* to the old uniform AI.
3. **Rule the bars question before quoting any bar.** Strongest-kart or field
   mean, decided once, and check why the control misses the winner bar.
4. Only then tune the spread.

## Process notes, learned the hard way this session

- Measure on `scratchpad/telemetry.mjs`, the harness pinned at the start and
  never edited. Where a bespoke harness is needed, name it, and never quote a
  number from a reconstruction when the pinned instrument can read it.
- Always compare against an **ablated control of the same build** — the feature
  switched off — never against the previous generation. Three separate claims
  this session were inflated by comparing against the wrong thing, and one
  reported regression turned out not to exist at all.
- A metric that only moves when karts collide is bump displacement, not
  behaviour. Check the floor before claiming a multiple.
