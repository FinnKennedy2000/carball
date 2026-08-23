// Theme tokens for the six tracks — one set of colours, backdrop gradients,
// difficulty pips and legend prose per key, so nothing downstream (the map
// screen, the world, the HUD) ever writes a theme colour down twice.
//
// Every string here is transcribed character-for-character from
// docs/specs/2026-08-22-kart-themes-and-scenery.md's "Theme tokens",
// "Grounds and atmosphere", "Theme blurbs" and "Track notes" sections. `diff`,
// `note` and `notes` for the circuit are the exception — see the comment on
// the circuit's entry below for why and where they come from instead.
//
// `diffLabel` and `lapEst` are not carried here: both already live in
// shared/kart-tracks.js, and a card reads them from there. Two sources of
// truth for the same string is exactly what this module exists to prevent.

import { DEFAULT_TRACK } from '../shared/kart.js'

/**
 * `road` is both the map-card's plan fill and the world's 3D tarmac, and the
 * design disagreed with itself about it: the map-card script paints darker
 * plan fills (#132430, #16221a, #241a16, #182029, #1f1626) than the values
 * below, while kart-map-scenes-3d.js uses exactly these values as its 3D
 * tarmac. One token has to serve both, and the tarmac wins the argument — the
 * darker set exists only to sit a flat plan on a dark card, while the tarmac
 * is the thing the player is looking at for a minute a lap.
 *
 * The circuit's tarmac is `#49536b` today; giving it `#22262f` makes the
 * existing track visibly darker. That is intended — the circuit gets a theme
 * like every other track now.
 */
export const THEMES = {
  circuit: {
    label: 'Harbour floodlights',
    tint: '#9184d9',
    road: '#22262f',
    kerb: '#d7d7de',
    edge: '#3a4152',
    deck: '#171a22',
    deckDepth: 3.2,
    pad: '#cbb98a',
    bg: 'radial-gradient(110% 80% at 20% 0%, rgba(145,132,217,0.13) 0%, transparent 60%), linear-gradient(180deg, #10141f 0%, #0b0e14 70%)',
    // The spec gives the circuit one background layer, not two. `atmo` is an
    // empty string here — present on every theme, never absent — so a
    // consumer can always concatenate `bg` and `atmo` without first checking
    // whether `atmo` exists; cssVars() and the test below both rely on that.
    atmo: '',
    blurb: 'The reference lap, and the one every chassis is balanced against: eleven corners, two 33m hairpins, four narrows and two jumps.',
    diff: 4,
    // The circuit's legend copy, from the map-card design's own text — see
    // the circuit entry under docs/specs' "Track notes" section.
    note: 'None of it is the same corner twice: two hairpins you have to brake for, three long radii you can carry, and a hook with a blind exit.',
    notes: [
      'The tarmac breathes from 32m across the line to 14m in the narrows. Four of those narrows have no barrier.',
      // The design's third paragraph quoted 69.57–69.64s, and the spec's own
      // "ladder" table later gave 63.4–68.5s — both measured with the AI's
      // item live, which it lays down and then drives into on a one-kart
      // race (see scripts/kart-par.mjs's comment). shared/kart-par.js is the
      // clean-lap authority: PAR.circuit's six chassis, each divided by
      // three laps, run 54,339-59,861ms, i.e. 54.3-59.9s a lap. The point the
      // sentence makes — the circuit sits between Foundry Loop and Cliff
      // Spiral — still holds either way.
      'All six chassis solve to 54.3–59.9s a lap here, so it sits between Foundry Loop and Cliff Spiral on this ladder.',
    ],
  },
  bayside: {
    label: 'Lagoon shallows',
    tint: '#6fc3c9',
    road: '#1c2b33',
    kerb: '#dce6e6',
    edge: '#2f4d57',
    deck: '#14222a',
    deckDepth: 1.4,
    pad: '#cbb98a',
    bg: 'radial-gradient(120% 90% at 18% 0%, rgba(111,195,201,0.16) 0%, transparent 62%), linear-gradient(180deg, #0c1c25 0%, #07131a 72%)',
    atmo: 'repeating-linear-gradient(0deg, rgba(111,195,201,0.045) 0 1px, transparent 1px 16px), radial-gradient(70% 40% at 82% 96%, rgba(111,195,201,0.10) 0%, transparent 70%)',
    blurb: 'Tide flats — the road runs a causeway between sandbanks; spray off the seawall on the long sweeps.',
    diff: 1,
    note: 'Six bends, none tighter than 85m, joined by two long sweeps. Nothing punishes a bad line, so the lap is decided by the item you are holding.',
    notes: [
      'Every corner goes flat in the Roadster — no braking anywhere on the lap.',
      'Width never drops below 26m: three karts abreast the whole way round, so passes happen everywhere.',
      'No jumps, no drops, no narrows. This is the track to learn drifting on.',
    ],
  },
  grove: {
    label: 'Canopy floor',
    tint: '#8fc48c',
    road: '#232a25',
    kerb: '#dfe6dc',
    edge: '#374b3b',
    deck: '#141c16',
    deckDepth: 1.0,
    pad: '#cbb98a',
    bg: 'radial-gradient(120% 90% at 22% 0%, rgba(143,196,140,0.14) 0%, transparent 60%), linear-gradient(180deg, #101c14 0%, #08110c 74%)',
    atmo: 'radial-gradient(22% 30% at 14% 22%, rgba(143,196,140,0.09) 0%, transparent 70%), radial-gradient(18% 26% at 62% 12%, rgba(143,196,140,0.07) 0%, transparent 70%), radial-gradient(26% 34% at 88% 62%, rgba(143,196,140,0.06) 0%, transparent 72%)',
    blurb: 'Old orchard — light comes down in patches through the canopy, and the verges are soft.',
    diff: 2,
    note: 'Three even lobes, four corners, one narrow through the middle and a single small jump that clears at any speed.',
    notes: [
      'The jump lands on a straight, so a bad take costs momentum but never a spin.',
      'T2 tightens on exit — the one place the AI reliably runs wide.',
      'The narrow at two-fifths distance is 22m across: two abreast, not three.',
    ],
  },
  foundry: {
    label: 'Molten foundry',
    tint: '#e0965c',
    road: '#2a221e',
    kerb: '#e6ddd2',
    edge: '#57392a',
    deck: '#1b1512',
    deckDepth: 1.8,
    pad: '#e8c98f',
    bg: 'radial-gradient(110% 80% at 20% 0%, rgba(224,150,92,0.13) 0%, transparent 58%), linear-gradient(180deg, #1a1210 0%, #0d0908 76%)',
    atmo: 'radial-gradient(80% 46% at 50% 104%, rgba(224,150,92,0.20) 0%, transparent 68%), radial-gradient(28% 20% at 12% 88%, rgba(224,110,60,0.12) 0%, transparent 70%)',
    blurb: 'Working steelworks — pour glow under the banking, and the air above the pit line shimmers.',
    diff: 3,
    note: 'The middle ground: two jumps, two narrows and one stretch with nothing on the outside.',
    notes: [
      'Both jumps sit at a corner exit, so the launch angle is yours to get wrong.',
      'The unguarded stretch on the back half runs 150m and cambers away from the road.',
      'Wide enough to fight over on the front straight, tight enough that the last third rewards a clean line.',
    ],
  },
  cliff: {
    label: 'Frost ridge',
    tint: '#8fb6d9',
    road: '#232a33',
    kerb: '#e4ecf4',
    edge: '#3d4c5c',
    deck: '#2a2f36',
    deckDepth: 16,
    pad: '#cbb98a',
    bg: 'radial-gradient(120% 90% at 24% 0%, rgba(143,182,217,0.15) 0%, transparent 62%), linear-gradient(180deg, #121a24 0%, #080c12 76%)',
    atmo: 'repeating-linear-gradient(112deg, rgba(200,222,240,0.035) 0 2px, transparent 2px 30px), radial-gradient(60% 34% at 50% 100%, rgba(143,182,217,0.10) 0%, transparent 70%)',
    blurb: 'Above the cloud line — thin air, ice on the shaded side of every hairpin, drifting snow across the exits.',
    diff: 4,
    // The spec's own note says "16m" here, not "15m": the road in the repo
    // is 16.2m at its narrowest, wider than the design's published 15m, and
    // the stat row beside this prose shows the derived truth. Left at 15m
    // the note would contradict the number next to it.
    note: 'Nine corners on a climbing loop, 26m at the tightest, 16m at the narrowest, and 420m of road with nothing beside it.',
    notes: [
      'You brake hard several times a lap and most of those are downhill into a narrow.',
      'Three unguarded stretches, all on the outside of a corner. The rail is worth holding here.',
      'The second jump is uphill: arrive slow and you land on the ramp face.',
    ],
  },
  fracture: {
    label: 'Rift',
    tint: '#c184d9',
    road: '#272130',
    kerb: '#e4dcea',
    edge: '#4b3459',
    deck: '#1b1522',
    deckDepth: 2.2,
    pad: '#cbb98a',
    bg: 'radial-gradient(120% 90% at 20% 0%, rgba(193,132,217,0.15) 0%, transparent 60%), linear-gradient(180deg, #170f1d 0%, #0a070d 76%)',
    atmo: 'repeating-linear-gradient(64deg, rgba(193,132,217,0.05) 0 1px, transparent 1px 46px), radial-gradient(50% 40% at 76% 88%, rgba(193,132,217,0.12) 0%, transparent 70%)',
    blurb: 'Broken ground — the circuit is stitched across a splitting plateau, and the voids are the crack itself.',
    diff: 5,
    // Same drift as cliff, in the other direction: the road is 12.4m at its
    // narrowest against the design's published 11m, so both mentions below
    // are edited to the derived 12m rather than left to contradict the stat
    // row.
    note: 'Nothing here is flat and nothing is wide. Three jumps, five narrows down to 12m, and 690m without a barrier.',
    notes: [
      '12m at the tightest is one kart plus a mistake. Items decide this track more than pace does.',
      'Four unguarded stretches — a quarter of the lap has a drop on one side.',
      'Three jumps, none of them onto a straight. Landing pointed the wrong way is normal.',
    ],
  },
}

// The tokens cssVars() emits, and the order it emits them in. Named once so
// the map screen's CSS and the test asserting this list can never drift
// apart silently — add a token here and the test file's literal has to
// change too, or it fails.
const CSS_TOKENS = ['tint', 'road', 'kerb', 'edge', 'pad', 'bg', 'atmo']

/** The theme for a track key, or the default track's if the key is unknown. */
export function themeFor(key) {
  return THEMES[key] ?? THEMES[DEFAULT_TRACK]
}

/** The inline `style` string a map card sets to put one theme on one element. */
export function cssVars(key) {
  const theme = themeFor(key)
  return CSS_TOKENS.map((token) => `--track-${token}: ${theme[token]};`).join(' ')
}

// hex() is called for the same six keys every race — buildWorld asks for all
// of them once per load — so each `#rrggbb` is parsed once and kept rather
// than re-parsed every call.
const hexCache = new Map()

/** A theme colour as the number three.js wants, e.g. '#9184d9' -> 0x9184d9. */
export function hex(key, token) {
  const cacheKey = `${key}.${token}`
  let value = hexCache.get(cacheKey)
  if (value === undefined) {
    value = Number.parseInt(themeFor(key)[token].slice(1), 16)
    hexCache.set(cacheKey, value)
  }
  return value
}

/** `color`'s channels scaled by `factor` (0-1) — a darker shade of the same hue. */
function shade(color, factor) {
  const r = Math.round(((color >> 16) & 0xff) * factor)
  const g = Math.round(((color >> 8) & 0xff) * factor)
  const b = Math.round((color & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}

/**
 * The numeric colours client/kart.js needs to build and light one track's
 * world. buildWorld() and initRenderer() call this and pick no literal colour
 * of their own — every world colour comes from here, so a theme change is a
 * change to this module alone.
 *
 * `tarmac`, `kerbTint`, `kerbLight`, `line`, `itemBox` and `deck` are theme
 * tokens read straight off THEMES. `deckDepth` is the matching per-theme
 * metres for the deck skirt — a lagoon causeway sits just above the tide
 * flats, the ridge road is cut into a mountainside, and one constant cannot
 * be both. `background`, `ground`, `grass` and `drop` are shades of `edge`,
 * the one token that is already a muted, mid-dark version of the theme's
 * hue: scaling its channels down keeps the ground, the void and the sky
 * looking like they belong to the same track without inventing new hex
 * literals this file does not already carry (see the header comment above
 * on why every string here is transcribed from the spec). `boostPad` is the
 * one colour field that stays a `#rrggbb` string rather than a number: it
 * feeds a 2D canvas context, not a THREE.Color.
 */
export function worldColors(key) {
  const edge = hex(key, 'edge')
  return {
    background: shade(edge, 0.35),
    ground: shade(edge, 0.42),
    grass: shade(edge, 0.58),
    drop: shade(edge, 0.09),
    deck: hex(key, 'deck'),
    deckDepth: themeFor(key).deckDepth,
    barrier: edge,
    tarmac: hex(key, 'road'),
    kerbTint: hex(key, 'tint'),
    kerbLight: hex(key, 'kerb'),
    line: hex(key, 'kerb'),
    itemBox: hex(key, 'tint'),
    boostPad: themeFor(key).pad,
  }
}
