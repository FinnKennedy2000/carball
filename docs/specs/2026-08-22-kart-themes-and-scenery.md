# Kart map themes and 3D scenery

**Status:** spec. Carries the numbers out of the Claude Design project
`a4fb76d3-8aff-42c5-bcf9-d5f2c939d646` so the repo does not depend on it.
**Design sources:** `Car Football - Kart Maps.dc.html` (map cards, palettes,
legend copy), `kart-map-scenes-3d.js` (scene builder), `tracks/kart-track-0{1..5}-*.js`
(measured stats), `kart-map-main.js` (the circuit in the same shape).
**Verified against the tree at `d374015`.**

## What is already built

`shared/kart-tracks.js` on `main` already holds all six circuits, converted from
this same design in an earlier pass: `circuit`, `bayside`, `grove`, `foundry`,
`cliff`, `fracture`, each with `nodes`, `widths`, `hills`, `voids`, `jumps`,
`airtime`, `boxRows` and `pads`. `test/kart.test.js` already asserts, for every
track, that the loop closes, that the road is widest at the line, and that it
never narrows past 6m of half-width.

So the geometry is not the work. The work is the measured numbers as *data*, the
theme tokens, the map screen and the world.

## Track keys

The keys stay as they are: `bayside`, `grove`, `foundry`, `cliff`, `fracture`.
Not `bayside-sweep` and friends. The key is persisted in `localStorage` as the
host's map choice and travels on the wire as `race.track` in every snapshot, so
renaming it silently breaks a saved pick and a room whose two ends disagree.

## Measured stats

Out of the design files. `corners` and `tight` are editorial — what counts as a
corner is a judgement, and the tightest radius is measured off the drawn
centreline — so they are carried as data. Everything else is derived from the
geometry at load, because a number typed beside the road it describes drifts
away from it.

| Track | Length | Corners | Tightest | Width | Rise | Jumps | Boxes | Pads | Voids |
|---|---|---|---|---|---|---|---|---|---|
| circuit | 2,279m | 11 | 33m | 32–14m | 60m | 2 | 24 | 12 | 5 |
| bayside | 1,380m | 6 | 85m | 32–26m | 16m | 0 | 12 | 5 | 0 |
| grove | 1,680m | 4 | 56m | 30–22m | 26m | 1 | 15 | 6 | 0 |
| foundry | 2,020m | 9 | 38m | 28–18m | 40m | 2 | 18 | 8 | 1 |
| cliff | 2,380m | 9 | 26m | 26–15m | 64m | 2 | 21 | 9 | 3 |
| fracture | 2,720m | 14 | 19m | 24–11m | 82m | 3 | 24 | 10 | 4 |

**The four narrows drifted.** The road in the repo is wider at its narrowest
than the design says on four tracks — foundry 21.2m against 18m, cliff 16.2m
against 15m, fracture 12.4m against 11m, and bayside 26.5m against 26m, which
the card rounds to 27m. That happened when the geometry was
landed, and it is the right way round: `test/kart.test.js` will not accept a
half-width under 6m, because a kart is 2m wide and a road you cannot pass on is
not a road. The cards display the *derived* width, not the design's label. The
design's 18/15/11 are wrong about the tarmac that exists.

**Fracture's rise drifted as well.** Not a width this time: the spline through
its nodes climbs 76.4m against the design's 82m, a 7% gap, where the other five
tracks' rises match to sub-metre. Same ruling as the narrows — the card shows
the derived 76m, because the road that exists is the one being described.

**Box and pad counts are exact.** `boxRows × 3` gives 24/12/15/18/21/24 and the
pad arrays give 12/5/6/8/9/10 — both match the design on every track.

**The length labels run a hair long.** The design's numbers above were measured off the
drawn centreline; the spline built through the nodes at load lands up to 1.2m
short of them on five of the six tracks — 0.05% of a lap. The cards display
the measured value, so the circuit reads 2,278m and not 2,279m.

**Pad density is not box density.** The design's claim that item boxes and
boost pads both keep the main track's density per metre holds for boxes —
every track is within 25% of the circuit's — and does not for pads: the
circuit runs a pad every ~190m, and the five new tracks run one every
252-280m, well outside that. Pads are placed by hand per track rather than by
a length formula the way box rows are, so the five new tracks are a family of
their own instead.

## The ladder

Measured at `d374015`, the AI's three-lap time down the centreline:

| Track | Fastest | Slowest | Lap |
|---|---|---|---|
| bayside | 116.1s | 129.6s | ≈38.7s |
| grove | 141.7s | 159.9s | ≈47.2s |
| foundry | 165.4s | 186.5s | ≈55.1s |
| circuit | 190.2s | 205.4s | ≈63.4s |
| cliff | 195.5s | 220.1s | ≈65.2s |
| fracture | 224.5s | 251.0s | ≈74.8s |

The order is the same in all six chassis, so the ladder holds. The spacing is
not what the brief describes: Foundry Loop is 13% quicker than the circuit
rather than level with it, and the track that sits level with the circuit is
Cliff Spiral, 2.8% away. Recorded, not corrected — the geometry is not being
moved to fit a sentence.

The `lapEst` labels already in `shared/kart-tracks.js` (`≈ 42s` … `≈ 88s`) run
long against these times by up to 15%. They are the design's estimates for a
person rather than the AI's measured lap, and they stay as they are.

## Theme tokens

One set per track, consumed by the map screen, the world, the HUD and the
results. Tint is the only chromatic colour: a line and a glow, never a fill.

| Track | Theme | Tint | Road | Kerb light | Edge | Pad |
|---|---|---|---|---|---|---|
| circuit | Harbour floodlights | `#9184d9` | `#22262f` | `#d7d7de` | `#3a4152` | `#cbb98a` |
| bayside | Lagoon shallows | `#6fc3c9` | `#1c2b33` | `#dce6e6` | `#2f4d57` | `#cbb98a` |
| grove | Canopy floor | `#8fc48c` | `#232a25` | `#dfe6dc` | `#374b3b` | `#cbb98a` |
| foundry | Molten foundry | `#e0965c` | `#2a221e` | `#e6ddd2` | `#57392a` | `#e8c98f` |
| cliff | Frost ridge | `#8fb6d9` | `#232a33` | `#e4ecf4` | `#3d4c5c` | `#cbb98a` |
| fracture | Rift | `#c184d9` | `#272130` | `#e4dcea` | `#4b3459` | `#cbb98a` |

**The design file disagrees with itself about `road`.** The map-card script uses
darker plan fills (`#132430`, `#16221a`, `#241a16`, `#182029`, `#1f1626`) than
the values above, while `kart-map-scenes-3d.js` uses exactly the values above as
its 3D `tarmac`. One token serves both, and it is the value above — the darker
set exists only to sit a flat plan on a dark card, and the tarmac is the thing
the player actually looks at for a minute a lap.

The circuit's tarmac is `#49536b` today. Giving it `#22262f` makes the existing
track visibly darker. That is intended: the circuit gets a theme like the rest.

### Grounds and atmosphere

Lifted from the map-card script. Two stacked layers per card, both absolute and
inset 0, `bg` under `atmo`.

**circuit** — one layer only:
`radial-gradient(110% 80% at 20% 0%, rgba(145,132,217,0.13) 0%, transparent 60%), linear-gradient(180deg, #10141f 0%, #0b0e14 70%)`

**bayside**
- bg: `radial-gradient(120% 90% at 18% 0%, rgba(111,195,201,0.16) 0%, transparent 62%), linear-gradient(180deg, #0c1c25 0%, #07131a 72%)`
- atmo: `repeating-linear-gradient(0deg, rgba(111,195,201,0.045) 0 1px, transparent 1px 16px), radial-gradient(70% 40% at 82% 96%, rgba(111,195,201,0.10) 0%, transparent 70%)`

**grove**
- bg: `radial-gradient(120% 90% at 22% 0%, rgba(143,196,140,0.14) 0%, transparent 60%), linear-gradient(180deg, #101c14 0%, #08110c 74%)`
- atmo: `radial-gradient(22% 30% at 14% 22%, rgba(143,196,140,0.09) 0%, transparent 70%), radial-gradient(18% 26% at 62% 12%, rgba(143,196,140,0.07) 0%, transparent 70%), radial-gradient(26% 34% at 88% 62%, rgba(143,196,140,0.06) 0%, transparent 72%)`

**foundry**
- bg: `radial-gradient(110% 80% at 20% 0%, rgba(224,150,92,0.13) 0%, transparent 58%), linear-gradient(180deg, #1a1210 0%, #0d0908 76%)`
- atmo: `radial-gradient(80% 46% at 50% 104%, rgba(224,150,92,0.20) 0%, transparent 68%), radial-gradient(28% 20% at 12% 88%, rgba(224,110,60,0.12) 0%, transparent 70%)`

**cliff**
- bg: `radial-gradient(120% 90% at 24% 0%, rgba(143,182,217,0.15) 0%, transparent 62%), linear-gradient(180deg, #121a24 0%, #080c12 76%)`
- atmo: `repeating-linear-gradient(112deg, rgba(200,222,240,0.035) 0 2px, transparent 2px 30px), radial-gradient(60% 34% at 50% 100%, rgba(143,182,217,0.10) 0%, transparent 70%)`

**fracture**
- bg: `radial-gradient(120% 90% at 20% 0%, rgba(193,132,217,0.15) 0%, transparent 60%), linear-gradient(180deg, #170f1d 0%, #0a070d 76%)`
- atmo: `repeating-linear-gradient(64deg, rgba(193,132,217,0.05) 0 1px, transparent 1px 46px), radial-gradient(50% 40% at 76% 88%, rgba(193,132,217,0.12) 0%, transparent 70%)`

### Theme blurbs

Shown in the legend, in the tint.

- **circuit** — The reference lap, and the one every chassis is balanced against: eleven corners, two 33m hairpins, four narrows and two jumps.
- **bayside** — Tide flats — the road runs a causeway between sandbanks; spray off the seawall on the long sweeps.
- **grove** — Old orchard — light comes down in patches through the canopy, and the verges are soft.
- **foundry** — Working steelworks — pour glow under the banking, and the air above the pit line shimmers.
- **cliff** — Above the cloud line — thin air, ice on the shaded side of every hairpin, drifting snow across the exits.
- **fracture** — Broken ground — the circuit is stitched across a splitting plateau, and the voids are the crack itself.

## Card layout

One card per track, in the design's order, at the design's proportions
(1440×1040 in the mock; the internals are all `width:100%` so the card scales).

1. **Header row**, baseline-aligned, space-between.
   - Left column: a row of `kicker` (11px, 0.18em, uppercase, tint) · five
     difficulty pips (16×3px, 2px radius, lit ones in the tint, unlit
     `rgba(233,233,237,0.14)`) · `diffLabel · lapEst a lap` (11px, 0.14em,
     uppercase, neutral-500) · theme chip (11px, 0.14em, uppercase, 3px 9px,
     `radius-sm`, tint text, `inset 0 0 0 1px` in the edge colour). Then the
     name as an `h2` — the design draws it as an `h1`, but six cards share one
     screen that already has its own heading, so seven `h1`s would be worse
     than the departure — (40px, heading face, weight 500, -0.03em). Then a 150×1px
     rule, `linear-gradient(90deg, tint 0%, tint 44%, transparent 100%)`.
   - Right: eight stats in a `space-6` row — Lap, Corners, Tightest, Width,
     Rise, Jumps, Boxes, Pads. Label 10px/0.16em/uppercase/neutral-500 over a
     26px heading-face tabular number, unit suffixes at 16px in neutral-600.
2. **Plan and legend**, `grid-template-columns: 1fr 246px`, `space-8`, aligned
   start. The plan is an SVG on `viewBox="0 0 1000 620"`. The legend is a
   `radius-md` panel, `rgba(22,24,38,0.6)`, `inset 0 0 0 1px` neutral-900.
3. **Elevation strip** — a label row (`Elevation, one lap` / `{rise}m between
   the low point and the crest · warm bands are the jumps, red the unguarded
   stretches`), an SVG on `viewBox="0 0 1000 112"` with
   `preserveAspectRatio="none"`, and five distance ticks beneath it.

### Plan drawing order

Back to front, so nothing important is buried:

1. road polygon, filled in `road`
2. left and right kerb edges, stroked `edge` at 1.6
3. centre dashes, `rgba(233,233,237,0.14)` at 1, `stroke-dasharray="5 11"`
4. void stretches, `#d98484` at 2.4, `stroke-dasharray="7 6"`, opacity 0.85
5. jumps, `#cbb98a` at 7, opacity 0.5, round caps
6. boost pads, 10×4.8 rects with 1px radius, filled `pad` at 0.6, rotated to
   the road
7. item boxes, 6.8×6.8 rects with 1.4px radius, no fill, stroked `tint` at 1.4,
   rotated to the road
8. start line, `#e9e9ed` at 3, `stroke-dasharray="4 4"`

### Elevation strip drawing order

1. bands — one rect per jump and per void across the full height, each at
   opacity 0.16; jumps warm, voids red. The design carried a per-band opacity
   in data that was never transcribed here, so 0.16 is a judgement made
   against the built card: it reads behind the profile line without competing
   with it.
2. the mean line at y=56, `rgba(233,233,237,0.14)` at 1, `stroke-dasharray="6 8"`
3. the area under the profile, filled with a vertical gradient from the tint at
   full opacity to the tint at zero, whole path at opacity 0.34
4. the profile line, stroked in the tint at 1.8

### Legend copy

Verbatim, in this order. Swatch first, then the text.

- 14×14 box, `1.4px solid` tint, 2px radius — **Item box — three abreast**
  (the circuit's reads **Item box — three abreast, eight rows**)
- 14×8 fill `#cbb98a` at 0.6, 1px radius — **Boost pad — off the centre line**
- 14×6 fill `#cbb98a` at 0.5, 3px radius — **Jump — the road stops**
- 14px `2px dashed #d98484` top border — **No barrier — only the drop**
- 14px `2px solid` edge top border — **Kerb**
- 14px `3px dashed #e9e9ed` top border — **Start / finish**
- a `color-divider` hairline
- the theme blurb, in the tint
- the track's `note`
- its `notes`, one paragraph each — three for the five new tracks, two for the circuit

Note the legend's boost-pad swatch stays `#cbb98a` on every card in the
design, including Foundry, even though Foundry's pads are `#e8c98f` in the plan
and in the world. That is the design's own inconsistency and it is not worth
preserving: the pad swatch uses the theme's `pad`, so the legend describes the
card it sits on.

The jump swatch is the other way round, and stays `#cbb98a` everywhere: a pad
is the same object on every map, so Foundry lightens it to keep reading as a
pad against that theme, while a jump is the road ending rather than an object
in the road, and the design draws it the one warm colour on all six. So the
jump is deliberately not themed — in the swatch, in the plan band and in the
elevation band alike, all three off one `--map-jump: #cbb98a` — and a seventh
theme token whose value never varies is not worth having.

### Track notes

**circuit** — *None of it is the same corner twice: two hairpins you have to
brake for, three long radii you can carry, and a hook with a blind exit.*
- The tarmac breathes from 32m across the line to 14m in the narrows. Four of those narrows have no barrier.
- All six chassis solve to 63.4–68.5s a lap here, so it sits between Foundry Loop and Cliff Spiral on this ladder.

The design's third paragraph put this at 69.57–69.64s a lap; corrected here
against the measured ladder (190.2–205.4s for three laps), which puts it at
63.4–68.5s. The point it makes — the circuit sits between Foundry Loop and
Cliff Spiral — still holds.

**bayside** — *Six bends, none tighter than 85m, joined by two long sweeps.
Nothing punishes a bad line, so the lap is decided by the item you are holding.*
- Every corner goes flat in the Roadster — no braking anywhere on the lap.
- Width never drops below 26m: three karts abreast the whole way round, so passes happen everywhere.
- No jumps, no drops, no narrows. This is the track to learn drifting on.

**grove** — *Three even lobes, four corners, one narrow through the middle and a
single small jump that clears at any speed.*
- The jump lands on a straight, so a bad take costs momentum but never a spin.
- T2 tightens on exit — the one place the AI reliably runs wide.
- The narrow at two-fifths distance is 22m across: two abreast, not three.

**foundry** — *The middle ground: two jumps, two narrows and one stretch with
nothing on the outside.*
- Both jumps sit at a corner exit, so the launch angle is yours to get wrong.
- The unguarded stretch on the back half runs 150m and cambers away from the road.
- Wide enough to fight over on the front straight, tight enough that the last third rewards a clean line.

**cliff** — *Nine corners on a climbing loop, 26m at the tightest, 15m at the
narrowest, and 420m of road with nothing beside it.*
- You brake hard several times a lap and most of those are downhill into a narrow.
- Three unguarded stretches, all on the outside of a corner. The rail is worth holding here.
- The second jump is uphill: arrive slow and you land on the ramp face.

**fracture** — *Nothing here is flat and nothing is wide. Three jumps, five
narrows down to 11m, and 690m without a barrier.*
- 11m at the tightest is one kart plus a mistake. Items decide this track more than pace does.
- Four unguarded stretches — a quarter of the lap has a drop on one side.
- Three jumps, none of them onto a straight. Landing pointed the wrong way is normal.

Two of these describe widths the road no longer has — cliff's "15m at the
narrowest" and fracture's "11m" and "five narrows down to 11m". The stat row
shows the derived truth beside them, so the prose is edited to match rather than
left to contradict the number next to it.

## The world

`kart-map-scenes-3d.js` is the spec for what a track looks like from the kart.
It is a standalone viewer: ~150m of hand-written sample curve per track with a
road package and themed scenery around it. Two things carry over — the *road
package* and the *scenery inventory*. The sample curves do not: the real road
comes from the track data.

### Road package

Per track, all in metres, y-up:

- `tarmac` — the road ribbon at the road's half-width
- `kerb` — 1.1m ribbons either side at +0.12, alternating between the tint and
  the kerb-light colour
- `deck` — a vertical skirt hanging under the kerb's outer edge, per-theme depth
- `line` — centre dashes at +0.03, 0.5m wide
- `boost-pad` — emissive bands in the theme's pad colour
- `item-box` — emissive cubes in the tint

The design's `roadway()` invents its own box and pad placements from an RNG and
two fixed lap fractions. The real ones come from `K.boxSpots()` and the track's
`pads`, which is what the physics reads.

The design alternates the kerb colour every two samples of a 140-sample 150m
curve — about a 2m stripe. The real tracks sample every 7–14m, so alternating
per node gives 14–28m stripes. The kerb alternates on arc length, not index.

### Scenery, per theme

- **circuit / Harbour floodlights** — harbour water plate below the deck;
  floodlight masts with emissive heads on the outside; grandstands with roofs on
  the inside; a metal barrier ribbon along the outside.
- **bayside / Lagoon shallows** — tide flats plate under a translucent water
  plate; flattened sandbank domes scattered either side; a low seawall (top
  ribbon plus face skirt) on the outside; emissive buoy cones offset from the
  road.
- **grove / Canopy floor** — forest floor plate; trunk cylinders with canopy
  spheres in two greens, scattered 13–73m out; small rock dodecahedra near the
  verge.
- **foundry / Molten foundry** — shop floor plate; emissive pour channels
  crossing under the road; gantries (two legs and a beam) spanning the road;
  stacks with emissive caps in a row behind; horizontal pipe runs; a ladle.
- **cliff / Frost ridge** — a translucent cloud deck well below; a rock cut
  slope and inner face on the inside; a snow drift ribbon along the inner kerb;
  marker posts along the outside; rock cones with snow caps standing out of the
  cloud.
- **fracture / Rift** — plateau and rift-wall slabs either side; an emissive
  rift-light plane far below; a truss under the road (ties and struts) with
  abutments; loose slab dodecahedra hanging in the light.

### Budget

Scenery is instanced wherever a prop repeats — trunks, canopy, posts, masts,
stacks, buoys, sandbanks, slabs, rocks, truss ties and struts. Draw calls stay
in the same range as the circuit renders in today; the count is measured before
and after and reported. Materials are named (`tarmac`, `kerb`, `deck`, `line`,
`item-box`, `boost-pad`, `barrier`, `rock`, `snow`, `bark`, `canopy`, `steel`,
`molten`, `plateau`, …) so a theme can swap one.

### What the engine will not do

- Any scenery drawn as an inward-offset ribbon runs into `FOLD_CAP` in
  `client/kart-ribbon.js`. The design's cliff cut slope sits 32m inside the
  centreline, which inverts on anything tighter than about 38m — that is most of
  cliff and all of fracture. Inward scenery is placed as discrete instances, or
  routed through the existing fold-capped `ribbon()`, never as a raw offset.
- The design's ridge `deckDepth` of 16m and its 40m inner face fight the grass
  ribbon at +22 and the drop ribbon that `buildWorld()` already lays. Theming
  reconciles the two rather than stacking them.
- Scenery is client-side decoration. It never touches `shared/kart.js`, so it
  cannot change a lap time or a collision. Placement is still seeded off the
  track key so two players see the same trees.
- `client/render.js` and `client/model-viewer.js` are not involved.
  `render.js` renders Carball — ball, teams, item effects. `model-viewer.js` is
  the chassis turntable. The kart world is built in `client/kart.js`
  `buildWorld()` on top of `client/kart-ribbon.js`.
