# Kart themes, map screen and 3D scenery — implementation plan

**Status: shipped**, head commit `14be96c`. The checkboxes below were left
unticked as the working record of the plan rather than updated retroactively;
treat this paragraph as the status instead of the tasks. Two deviations from
the plan as written: Task 3 (the map screen) split into a pure-geometry half
and a UI half, rather than landing as one step; and Task 4's planned
`test/kart-world.test.js` was folded into `test/kart-themes.test.js` because
the code under test needs a DOM, which `kart-world.test.js` wasn't set up
for.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the six circuits its own theme, put a real map screen in
front of them, and build themed 3D scenery around the road — without moving the
geometry or touching the sim.

**Architecture:** One new client module (`client/kart-themes.js`) holds the six
token sets and is the only place a theme colour is written down. A second
(`client/kart-plan.js`) turns a track key into the SVG paths a card needs, so the
map screen and the tests read the same geometry. `client/kart.js` grows a map
screen and passes the active theme into `buildWorld()`, which stops hardcoding
its colours. Scenery is a third module (`client/kart-scenery.js`) keyed by theme,
built from the track data with a seeded RNG and instanced props.
`shared/kart.js` and `shared/kart-tracks.js` are not modified.

**Tech Stack:** Plain ES modules, no framework. `node --test` for tests, Vite for
the build, three.js for the renderer. No new dependency.

**Spec:** `docs/specs/2026-08-22-kart-themes-and-scenery.md`

## Global Constraints

- **`shared/kart.js` is not modified.** The theme and the scenery are decoration;
  neither may change a lap time, a collision or a hash. Task 1 ends with a test
  that proves the file is untouched.
- **`shared/kart-tracks.js` is not modified either.** The geometry landed
  already and the measured stats are derived from it rather than typed beside it.
  The two editorial numbers that cannot be derived — corner count and tightest
  radius — go in the new theme module, not into the track table.
- **The track keys do not change.** `bayside`, `grove`, `foundry`, `cliff`,
  `fracture`. They are persisted in `localStorage` and travel on the wire as
  `race.track`.
- **No new colour globals in `client/nocturne.css`.** Theme tokens are set as
  custom properties on the card or the screen element, so six themes render on
  one page. Nocturne's own tokens (`--color-accent`, `--space-*`, `--radius-*`,
  `--font-*`) are used as-is.
- **No new Realtime message, no snapshot change, no `SNAPSHOT_HZ` change.**
- Tests run with `pnpm test` (`node --test 'test/*.test.js'`). The suite is 155
  tests on `main`'s successor; all of them stay green.
- Prose comments explain *why the number is the number*, matching the house style
  in `shared/constants.js`.
- Do not add AI-attribution trailers to commit messages.
- One commit per task, and `pnpm test` plus `pnpm build` clean before each.

---

### Task 1: Measured stats and the tests that hold them

The stats the cards display, derived from the geometry that exists, plus the
tests the brief asks for.

**Files:**
- Create: `client/kart-stats.js`
- Test: `test/kart-stats.test.js`

**Interfaces:**
- Consumes: `TRACKS`, `TRACK_KEYS`, `setTrack`, `activeTrack`, `TRACK`,
  `halfWidthAt`, `heightAt`, `boxSpots`, `padSpots` from `shared/kart.js`
- Produces: `statsFor(key)` → `{ length, corners, tight, wmax, wmin, rise,
  jumps, boxes, pads, voids }`, and `CORNERS` — the one table of
  editorial numbers (corner count and tightest radius per track) that cannot be
  measured off the road.

- [ ] **Step 1: `CORNERS`, the two numbers that are a judgement**

  Corner count and tightest radius come off the drawn centreline in the design
  and are not recoverable from a sampled spline without deciding what counts as
  a corner. Everything else is measured. Comment says exactly that.

  | key | corners | tight |
  |---|---|---|
  | circuit | 11 | 33 |
  | bayside | 6 | 85 |
  | grove | 4 | 56 |
  | foundry | 9 | 38 |
  | cliff | 9 | 26 |
  | fracture | 14 | 19 |

- [ ] **Step 2: `statsFor(key)`**

  Save `activeTrack()`, `setTrack(key)`, read, `setTrack` back. The sim's track
  is a module singleton, so this is the honest way to ask about a road that is
  not loaded; it is synchronous, so no frame runs in between. Derive:

  - `length` — `TRACK.length`, rounded
  - `wmax` / `wmin` — twice the max and min of `halfWidthAt` over the lap,
    sampled at every node
  - `rise` — max minus min of `heightAt` over the lap
  - `jumps` / `voids` — array lengths off `TRACKS[key]`
  - `boxes` — `boxSpots().length`
  - `pads` — `padSpots().length`

- [ ] **Step 3: Tests**

  - Every track's loop closes: last point back to first within a node's spacing,
    and `heightAt(0) === heightAt(TRACK.length)`. (`test/kart.test.js` covers the
    first half already; this asserts the elevation seam too.)
  - Length, jumps, voids, boxes and pads match the design's published counts
    exactly — 2279/1380/1680/2020/2380/2720m, 2/0/1/2/2/3 jumps, 5/0/0/1/3/4
    voids, 24/12/15/18/21/24 boxes, 12/5/6/8/9/10 pads.
  - `wmin` is never under 12m anywhere — three karts abreast is 6.6m of kart plus
    room, and the sim's own test already refuses a half-width under 6.
  - Box density per metre and pad density per metre are within 25% of the
    circuit's. The circuit runs a box every 95m and a pad every 190m; the
    tolerance is wide because a 1,380m track cannot hit the same ratio with whole
    rows of three.
  - **The ladder holds.** For each of the six chassis, the AI's three-lap time
    is strictly increasing across `bayside → grove → foundry → circuit → cliff →
    fracture`. Driven with `createRace`/`addKart`/`begin`/`step`, same as the par
    generator on the `kart-daily` branch. Six chassis × six tracks of simulated
    racing is slow, so this test is skipped unless `KART_LADDER=1` — the
    measured table lives in the spec and the check is there to run by hand after
    a tuning change.
  - `shared/kart.js` and `shared/kart-tracks.js` are byte-identical to `main`.

- [ ] **Step 4: `pnpm test`, `pnpm build`, commit**

---

### Task 2: Theme tokens

**Files:**
- Create: `client/kart-themes.js`
- Modify: `client/nocturne.css` (nothing but a comment pointing at the module)
- Test: `test/kart-themes.test.js`

**Interfaces:**
- Produces: `THEMES` — one entry per track key with `label`, `tint`, `road`,
  `kerb`, `edge`, `pad`, `bg`, `atmo`, `blurb`, `diff`, `diffLabel`, `note`,
  `notes`; `themeFor(key)`; `cssVars(key)` → the custom-property string a card
  sets; `hex(key, token)` → the number three.js wants.

- [ ] **Step 1: The six token sets**

  Verbatim from the spec's tables — tint, road, kerb light, edge, pad, the two
  gradient layers, the blurb, the difficulty and the three notes. `road` takes
  the spec's value, not the map-card script's darker plan fill; the comment
  records that the design file disagreed with itself and why this side won.

  Fracture's and cliff's notes are edited where they quote a width the road no
  longer has (11m and 15m), so the prose does not contradict the stat beside it.

- [ ] **Step 2: `cssVars(key)` and `hex(key, token)`**

  `cssVars` returns `--track-tint: …; --track-road: …; …` for a card's inline
  `style`, which is what keeps six themes on one page without six sets of
  globals. `hex` parses `#rrggbb` to a number once per key, memoised, because
  `buildWorld` asks for the same six values every race.

- [ ] **Step 3: Tests**

  - A theme exists for every key in `TRACK_KEYS`, and no theme exists for a key
    that is not a track.
  - Every colour is a `#rrggbb`, so `hex` cannot silently return `NaN`.
  - `hex` round-trips: `#9184d9` → `0x9184d9`.
  - `cssVars` names every token the map screen's CSS reads — the list is asserted
    against a literal, so adding a token to one side and not the other fails.
  - The pad colour is `#cbb98a` on all six except foundry, which is `#e8c98f`.

- [ ] **Step 4: `pnpm test`, `pnpm build`, commit**

---

### Task 3: The map screen

**Files:**
- Create: `client/kart-plan.js`
- Modify: `client/kart.html`, `client/kart.js`
- Test: `test/kart-plan.test.js`

**Interfaces:**
- `client/kart-plan.js` produces `planFor(key)` → `{ road, edgeL, edgeR,
  centreDash, voidPath, jumps, pads, boxes, start, viewBox }` and `elevFor(key)`
  → `{ line, area, bands, ticks }`, all in the design's `0 0 1000 620` and
  `0 0 1000 112` spaces.
- `client/kart.js` grows `showMap()` / `chooseMap(key)` and passes the theme into
  `buildWorld()`.

- [ ] **Step 1: `planFor(key)`**

  Same `setTrack` save/restore as `statsFor`. Walk the lap at every node, take
  `pointAt(s)` and `halfWidthAt(s)`, and emit the left and right edges as one
  closed polygon for the road plus two open paths for the kerb edges. Fit the
  lap's bounding box into the 1000×620 viewBox with a uniform scale and a margin,
  so a long thin track and a round one both fill the card.

  The plan is drawn from the track data, not from the design's `roadPath` — the
  design's paths are in their own coordinate space and were drawn before the
  three narrows were widened.

  Void stretches, jump marks, pads (from `padSpots()`) and boxes (from
  `boxSpots()`) are placed and rotated to the road exactly as the spec's drawing
  order says. The start line is the road's full width at `s = 0`.

- [ ] **Step 2: `elevFor(key)`**

  `heightAt` sampled 200 times around the lap, mapped so the mean sits on y=56
  and the extremes clear the 112 box. `area` closes the line down to the
  baseline. `bands` are one rect per jump (warm) and per void (red), x and width
  from the lap fractions. `ticks` are five distance labels, `0m` to the lap
  length, thousands-separated.

- [ ] **Step 3: The card, in `kart.html`**

  One `<template>`-free card built in JS from the theme and the stats, and a
  `#map-screen` container that holds six of them in a column, scrollable. Layout,
  stat row, legend copy and drawing order follow the spec section by section:
  header row with kicker/pips/difficulty/theme chip, the `1fr 246px` plan and
  legend grid, the elevation strip with its label row and ticks.

  The two gradient layers go on absolutely-positioned children of the card, and
  every colour in the card comes from `var(--track-*)` set by `cssVars(key)` on
  the card element.

- [ ] **Step 4: Wire it into the pick flow**

  Replace `#map-pick`'s `<select>` with a button that opens `#map-screen`, and
  keep `mapChoice` / `pickedMap()` / `STORED_MAP` exactly as they are — the
  screen is a different way to set the same variable. Random stays an option: a
  seventh card at the top, unthemed, that reads as "any of the six".

  Clicking a card selects it and closes the screen. The selected card carries a
  tint ring. Keyboard: arrows move, Enter selects, Escape closes.

  The race HUD's `#track-name` picks up the theme chip and the tint, and the
  results and waiting cards take the tint on their kicker — that is the
  "consumed everywhere" the brief asks for, and it is three lines each.

- [ ] **Step 5: Tests**

  `client/kart-plan.js` imports nothing from the DOM, so it tests in node:

  - Every path is non-empty, starts with `M`, and contains no `NaN`.
  - The road polygon is closed and its bounding box sits inside the viewBox with
    the margin intact, on all six tracks.
  - Box and pad counts in the plan match `statsFor`.
  - Band count equals jumps plus voids.
  - The elevation line's first and last y are equal — the lap closes on the
    strip too.
  - `ticks` has five entries and the last is the lap length.

- [ ] **Step 6: `pnpm test`, `pnpm build`, commit**

- [ ] **Step 7: Look at it**

  Load `/kart` in Chrome, open the map screen, and check all six cards render,
  the themes are distinguishable, and nothing overflows horizontally at 1280px
  and 1920px. Screenshot the six.

---

### Task 4: Theme the road package

The world stops hardcoding its colours before anything is added around it.

**Files:**
- Modify: `client/kart.js`
- Test: `test/kart-world.test.js` (new, pure-function coverage only)

- [ ] **Step 1: Baseline the budget**

  Before any change: load a race on the circuit in Chrome and record
  `renderer.info.render.calls`, `renderer.info.render.triangles` and
  `renderer.info.memory.geometries` from a steady frame. Do the same on
  fracture. Write both into the plan here — every later measurement is against
  these two numbers.

- [ ] **Step 2: Colours out of `buildWorld`**

  `scene.background`, `scene.fog`, the ground plate, the grass ribbon, the drop
  ribbon, the kerb, the tarmac and the dashes all take their colour from
  `themeFor(activeTrack())` instead of the literals at
  `client/kart.js:817`–`869`. The pads take the theme's `pad`.

  The kerb becomes two-tone, alternating between the tint and the kerb-light
  colour **on arc length, not on node index** — a stripe every 6m. The design
  alternated every two samples of a 1m-per-sample curve; the real tracks sample
  every 7–14m, so per-node alternation gives 14–28m stripes.

  Materials get names: `tarmac`, `kerb`, `deck`, `line`, `grass`, `drop`,
  `barrier`, `item-box`, `boost-pad`.

- [ ] **Step 3: The deck skirt**

  A vertical skirt under the outer kerb edge, per-theme depth, so the road reads
  as a deck rather than a decal. It replaces nothing — the existing drop ribbon
  stays, because that is what makes a void look like somewhere you can go off.

- [ ] **Step 4: Tests and measurement**

  Colour selection is a pure function of the track key, so test that: every
  track resolves a full set of world colours and none of them is `NaN`. Then
  re-measure draw calls on circuit and fracture and record the delta.

- [ ] **Step 5: `pnpm test`, `pnpm build`, commit**

---

### Task 5: Themed scenery

**Files:**
- Create: `client/kart-scenery.js`
- Modify: `client/kart.js` (one call in `buildWorld`, one disposal path)
- Test: `test/kart-scenery.test.js`

**Interfaces:**
- Produces: `buildScenery(key, ctx)` → `THREE.Group`, where `ctx` carries the
  centreline sampler, the half-width sampler, the height sampler and the theme.
  One builder per theme, dispatched off the track key.

- [ ] **Step 1: The shared primitives**

  A seeded RNG (`rng(seed)`, the design's LCG), an instanced-prop helper that
  takes a geometry, a material and a list of transforms and returns one
  `InstancedMesh`, and a scatter helper that walks the lap and offers positions
  at a lateral offset either side. All placement is seeded off the track key, so
  every client grows the same trees.

- [ ] **Step 2: The six themes**

  As the spec's inventory. Every repeated prop is one `InstancedMesh`: trunks,
  canopy, rocks, posts, masts, buoys, sandbanks, stacks, slabs, truss ties,
  truss struts. Ground and water plates are one mesh each. Gantries and
  grandstands are few enough to be plain meshes.

  Nothing is placed as an inward-offset ribbon. `FOLD_CAP` in
  `client/kart-ribbon.js` inverts an inside edge past 85% of the corner's
  radius, and the design's cliff cut slope sits 32m inside the centreline — that
  folds on most of cliff and all of fracture. The cut slope is instanced rock
  panels stepped along the inside instead, and the drift and the seawall go
  through the existing fold-capped `ribbon()`.

- [ ] **Step 3: Budget**

  Re-measure draw calls, triangles and geometries on circuit and fracture. The
  target is the Step 1 baseline plus no more than a handful — instancing means
  the tree count does not move the call count. If a theme lands over, cut prop
  variety before cutting prop count: two canopy materials become one before
  fifty-four trees become twenty.

  Report the before and after numbers in the task's report.

- [ ] **Step 4: Tests**

  `buildScenery` needs three.js but not a DOM, so it tests in node:

  - Every track builds a group without throwing.
  - Every mesh in it has a name, and every material has a name.
  - Two builds of the same track produce identical positions — the RNG is
    seeded, so the world is the same on both clients.
  - Two different tracks produce different positions.
  - The instanced-prop count is what the theme says, so a scatter that silently
    drops props fails.
  - No object sits above the road surface where a kart drives: for every mesh,
    its bounding box either clears the road's half-width laterally or sits below
    the deck. This is the test that stops scenery from becoming a wall.

- [ ] **Step 5: `pnpm test`, `pnpm build`, commit**

- [ ] **Step 6: Look at it**

  A lap of each of the six in Chrome. Screenshot each. Check the frame time on
  fracture, which has the most scenery and the tightest corners.

---

## Open questions

None blocking. Two things recorded rather than resolved:

1. The ladder's *spacing* does not match the brief — Foundry Loop is 13% quicker
   than the circuit rather than level with it, and Cliff Spiral is the track that
   sits level. The order is right on all six chassis, so no geometry moves.
2. The design's `lapEst` labels run up to 15% long against the AI's measured
   laps. They stay: they are an estimate for a person, and the card shows them as
   `≈`.
