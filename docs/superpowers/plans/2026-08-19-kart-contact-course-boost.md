# Kart Contact, Course, Pads, Drift Turbo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Stronger kart-on-kart contact (especially against spinners), a longer
circuit, boost pads, drift mini-turbos, a silent post-hit grace period, and
readable per-item kart animations.

**Architecture:** Sim changes are local to `shared/kart.js` — a mass function
used by `bump()`, new per-kart timers (`grace`, `driftTime`, `driftCharge`), and
a stateless `PADS` table tested per tick. Renderer changes are local to
`client/kart.js` — the pad chevrons in `buildTrack()` and a `dressKart()` called
from `draw()`. The multiplayer snapshot is the whole state, so new fields travel
without protocol work.

**Tech Stack:** vanilla ES modules, three.js 0.171, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-19-kart-contact-course-boost-design.md`

## Global Constraints

- `shared/kart.js` stays pure and deterministic: no `Math.random`, no `Date`.
  Randomness comes off `state.seed` via `rand(state)`.
- Every new per-kart numeric field must be added to `hashRace()`.
- Every new per-kart field must be initialised in `addKart()`.
- Existing tests must keep passing: `pnpm test` (76 tests before this work).
- Renderer must not allocate per frame — pool or pre-build meshes.

---

### Task 1: Mass-aware contact, loose spinners

**Files:** Modify `shared/kart.js` (`bump`, `stepKart` drag/grip, new
`massOf`); Test `test/kart.test.js`.

**Produces:** `massOf(kart)` (not exported), `SPIN_DRAG`, `LOOSE`, restitution
`2.2`.

- [ ] Test: driving into a spinning kart displaces the spinner further than the
  driver, and the driver keeps >70% of its speed.
- [ ] Test: a Mega kart shoves a normal kart further than it is shoved.
- [ ] Implement `massOf` = `kartScale(kart)**2 * (spin > 0 ? LOOSE : 1)`;
  split `bump()` position and impulse by inverse mass; restitution 1.4 → 2.2.
- [ ] While `spin > 0`, drag = `SPIN_DRAG` (1.2) and lateral grip = `GRIP_DRIFT`.
- [ ] Run `pnpm test`, commit.

### Task 2: Spin-out ends pointing down the road

**Files:** Modify `shared/kart.js` (`stepKart` spin countdown); Test
`test/kart.test.js`.

- [ ] Test: spin a kart out, run until `spin === 0`, assert heading is within
  ~0.35 rad of the road tangent at its `s`.
- [ ] Implement: when the spin countdown reaches 0, set heading to
  `Math.atan2(p.ty, p.tx)` for `pointAt(kart.s)`.
- [ ] Run `pnpm test`, commit.

### Task 3: Silent grace period after a hit

**Files:** Modify `shared/kart.js` (`addKart`, `stepKart`, `spinOut`, `blast`,
`hashRace`); Test `test/kart.test.js`.

**Produces:** `kart.grace`, `GRACE_AFTER = 1.5`.

- [ ] Test: a kart spun out cannot be spun out again while `grace > 0`, and can
  once it expires.
- [ ] Implement `grace` field, counted down in `stepKart`; `spinOut()` and the
  blast path return early while `grace > 0`; `spinOut()` sets
  `grace = SPIN_SECONDS + GRACE_AFTER`. No HUD surface.
- [ ] Add `grace` to `hashRace()`. Run `pnpm test`, commit.

### Task 4: A longer circuit

**Files:** Modify `shared/kart.js` (`TRACK_R`, `TRACK_N`, `trackPoint`,
`BOX_ROWS`); Test `test/kart.test.js`.

- [ ] Test: `TRACK.length > 1100` and the circuit still closes (extend the
  existing closure test rather than duplicating it).
- [ ] Implement `TRACK_R = 215`, `TRACK_N = 400`, extra `+0.05*cos(7a)`
  harmonic, `BOX_ROWS = 20`.
- [ ] Run `pnpm test` — the AI-completes-three-laps test needs its tick budget
  raised in proportion; do that in the same commit. Commit.

### Task 5: Boost pads

**Files:** Modify `shared/kart.js` (`PADS`, `PAD_SECONDS`, `hitPads`, `step`);
Modify `client/kart.js` (`buildTrack` chevrons); Test `test/kart.test.js`.

**Produces:** `export const PADS = [{ t, lane, half }]`, `PAD_SECONDS = 1.1`,
`export function padSpots()` returning `{x, y, s, lane, half, angle}` for the
renderer.

- [ ] Test: a kart placed on a pad gains boost after one step; the same kart
  offset laterally clear of the pad gains none.
- [ ] Implement `hitPads(kart)` called per kart in `step()`: project, compare
  `s` against each pad's `s` within a longitudinal half-length and `lateral`
  against `lane ± half`, set `kart.boost = max(boost, PAD_SECONDS)`.
- [ ] Renderer: build a flat chevron-marked plane per pad from `padSpots()`.
- [ ] Run `pnpm test`, `pnpm build`, commit.

### Task 6: Drift mini-turbo

**Files:** Modify `shared/kart.js` (`addKart`, `stepKart`, `spinOut`,
`hashRace`); Modify `client/kart.js` (HUD chip + sparks); Test
`test/kart.test.js`.

**Produces:** `kart.driftTime`, `kart.driftCharge`, `DRIFT_TIERS = [0.9, 1.9]`,
`DRIFT_BOOST = [0.55, 0.95]`, `DRIFT_MIN_SPEED`.

- [ ] Test: holding drift and steering for 1.2s then releasing gives
  `boost ≈ 0.55`; holding 2.2s gives `≈ 0.95`; releasing at 0.4s gives none.
- [ ] Test: spinning out mid-drift throws the charge away.
- [ ] Implement the charge/release in `stepKart` before the steering block;
  clear both fields in `spinOut()`; add both to `hashRace()`.
- [ ] Run `pnpm test`, commit.

### Task 7: Item animations

**Files:** Modify `client/kart.js` (`makeKart`, new `dressKart`, `draw`).

- [ ] `makeKart` builds and hides: a bullet hull group, two flame cones, two
  spark clusters. Keep references on the group (`mesh.userData`).
- [ ] `dressKart(mesh, kart)`: bullet swap, flame sizing off `boost`, spark
  colour off `driftCharge`, star hue cycle, mega bob, spin roll.
- [ ] Call it from `draw()` in place of the current inline emissive line.
- [ ] `pnpm build`, then verify in a headless browser race, commit.

### Task 8: Verification pass

- [ ] `pnpm test` (all green), `pnpm build`.
- [ ] Play a solo race in a headless browser: confirm pads fire, a drift
  release boosts, a bullet turns the kart into a rocket, and shoving a spinning
  AI works.
- [ ] Run the `ship` gate (silent-failure-hunter, type-design-analyzer).
