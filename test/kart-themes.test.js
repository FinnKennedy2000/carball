import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACK_KEYS } from '../shared/kart.js'
import { THEMES, themeFor, cssVars, hex, worldColors } from '../client/kart-themes.js'

const HEX_RE = /^#[0-9a-f]{6}$/i
const COLOUR_TOKENS = ['tint', 'road', 'kerb', 'edge', 'pad', 'deck']
const CSS_TOKENS = ['tint', 'road', 'kerb', 'edge', 'pad', 'bg', 'atmo']

test('a theme exists for every track key, and only for track keys', () => {
  assert.deepEqual(Object.keys(THEMES).sort(), [...TRACK_KEYS].sort())
})

test('every colour token is a well-formed #rrggbb string', () => {
  for (const key of TRACK_KEYS) {
    const theme = THEMES[key]
    for (const token of COLOUR_TOKENS) {
      assert.match(theme[token], HEX_RE, `${key}.${token} is not #rrggbb`)
    }
  }
})

test('the pad colour is #cbb98a everywhere except foundry', () => {
  for (const key of TRACK_KEYS) {
    const expected = key === 'foundry' ? '#e8c98f' : '#cbb98a'
    assert.equal(THEMES[key].pad, expected, `${key}.pad`)
  }
})

test('hex round-trips a hex string to the number three.js wants', () => {
  assert.equal(hex('circuit', 'tint'), 0x9184d9)
  for (const key of TRACK_KEYS) {
    for (const token of COLOUR_TOKENS) {
      const parsed = hex(key, token)
      assert.equal(typeof parsed, 'number')
      assert.ok(Number.isInteger(parsed) && !Number.isNaN(parsed), `${key}.${token} parsed to NaN`)
      assert.equal(`#${parsed.toString(16).padStart(6, '0')}`, THEMES[key][token], `${key}.${token} did not round-trip`)
    }
  }
})

test('themeFor falls back to the default track for an unknown key', () => {
  assert.deepEqual(themeFor('not-a-track'), THEMES.circuit)
  assert.deepEqual(themeFor(undefined), THEMES.circuit)
})

test('cssVars names every token the map screen reads, in order, and nothing else', () => {
  for (const key of TRACK_KEYS) {
    const vars = cssVars(key)
    const names = [...vars.matchAll(/--track-([a-z]+):/g)].map((m) => m[1])
    assert.deepEqual(names, CSS_TOKENS, `${key}: cssVars token list`)
    for (const token of CSS_TOKENS) {
      assert.ok(vars.includes(`--track-${token}: ${THEMES[key][token]};`), `${key}: --track-${token} value`)
    }
  }
})

test('the circuit has one background layer: atmo is an empty string, not absent', () => {
  assert.equal(THEMES.circuit.atmo, '')
  assert.equal(typeof THEMES.circuit.atmo, 'string')
  // Every other track actually stacks two layers.
  for (const key of TRACK_KEYS) {
    if (key === 'circuit') continue
    assert.ok(THEMES[key].atmo.length > 0, `${key}: atmo should not be empty`)
  }
})

// Structural checks on the gradient strings, so a single mistyped character
// in a long rgba() or percentage does not slip past a spot check: every
// background is two comma-joined layers (one for the circuit), every layer
// is a gradient function, and the tint's own rgba() appears in both bg and
// (where present) atmo, tying the two together to the track's own colour.
test('every bg/atmo gradient has the right layer count and carries the theme tint', () => {
  const splitLayers = (css) => {
    // Top-level commas only — gradient arguments have commas of their own.
    const layers = []
    let depth = 0
    let start = 0
    for (let i = 0; i < css.length; i++) {
      const c = css[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ',' && depth === 0) {
        layers.push(css.slice(start, i).trim())
        start = i + 1
      }
    }
    layers.push(css.slice(start).trim())
    return layers
  }

  for (const key of TRACK_KEYS) {
    const theme = THEMES[key]
    const bgLayers = splitLayers(theme.bg)
    assert.equal(bgLayers.length, 2, `${key}: bg layer count`)
    for (const layer of bgLayers) assert.match(layer, /-gradient\(/, `${key}: bg layer is not a gradient`)

    if (key === 'circuit') {
      assert.equal(theme.atmo, '')
    } else {
      const atmoLayers = splitLayers(theme.atmo)
      assert.ok(atmoLayers.length >= 2, `${key}: atmo should stack at least two layers`)
      for (const layer of atmoLayers) assert.match(layer, /-gradient\(/, `${key}: atmo layer is not a gradient`)
    }

    // The tint's rgb triple, e.g. '#9184d9' -> '145,132,217', should show up
    // in the rgba() of at least one bg layer (and the atmo, where present) —
    // a transcription that dropped or fat-fingered the tint would show up as
    // a colour mismatch here, not just a shape mismatch.
    const r = Number.parseInt(theme.tint.slice(1, 3), 16)
    const g = Number.parseInt(theme.tint.slice(3, 5), 16)
    const b = Number.parseInt(theme.tint.slice(5, 7), 16)
    const rgbTriple = `${r},${g},${b}`
    assert.ok(theme.bg.includes(rgbTriple), `${key}: bg does not mention the tint's rgba(${rgbTriple})`)
    if (theme.atmo) assert.ok(theme.atmo.includes(rgbTriple), `${key}: atmo does not mention the tint's rgba(${rgbTriple})`)
  }
})

// Every bg and every atmo, pinned verbatim — eleven strings across the six
// tracks (circuit has no atmo). The structural test above catches a wrong
// layer count or a mismatched tint colour; this catches anything else a
// transcription could get wrong (a percentage, a stop position, an angle)
// that the structural test's tint-triple check would not touch.
test('every bg and atmo is transcribed exactly', () => {
  const expected = {
    circuit: {
      bg: 'radial-gradient(110% 80% at 20% 0%, rgba(145,132,217,0.13) 0%, transparent 60%), linear-gradient(180deg, #10141f 0%, #0b0e14 70%)',
    },
    bayside: {
      bg: 'radial-gradient(120% 90% at 18% 0%, rgba(111,195,201,0.16) 0%, transparent 62%), linear-gradient(180deg, #0c1c25 0%, #07131a 72%)',
      atmo: 'repeating-linear-gradient(0deg, rgba(111,195,201,0.045) 0 1px, transparent 1px 16px), radial-gradient(70% 40% at 82% 96%, rgba(111,195,201,0.10) 0%, transparent 70%)',
    },
    grove: {
      bg: 'radial-gradient(120% 90% at 22% 0%, rgba(143,196,140,0.14) 0%, transparent 60%), linear-gradient(180deg, #101c14 0%, #08110c 74%)',
      atmo: 'radial-gradient(22% 30% at 14% 22%, rgba(143,196,140,0.09) 0%, transparent 70%), radial-gradient(18% 26% at 62% 12%, rgba(143,196,140,0.07) 0%, transparent 70%), radial-gradient(26% 34% at 88% 62%, rgba(143,196,140,0.06) 0%, transparent 72%)',
    },
    foundry: {
      bg: 'radial-gradient(110% 80% at 20% 0%, rgba(224,150,92,0.13) 0%, transparent 58%), linear-gradient(180deg, #1a1210 0%, #0d0908 76%)',
      atmo: 'radial-gradient(80% 46% at 50% 104%, rgba(224,150,92,0.20) 0%, transparent 68%), radial-gradient(28% 20% at 12% 88%, rgba(224,110,60,0.12) 0%, transparent 70%)',
    },
    cliff: {
      bg: 'radial-gradient(120% 90% at 24% 0%, rgba(143,182,217,0.15) 0%, transparent 62%), linear-gradient(180deg, #121a24 0%, #080c12 76%)',
      atmo: 'repeating-linear-gradient(112deg, rgba(200,222,240,0.035) 0 2px, transparent 2px 30px), radial-gradient(60% 34% at 50% 100%, rgba(143,182,217,0.10) 0%, transparent 70%)',
    },
    fracture: {
      bg: 'radial-gradient(120% 90% at 20% 0%, rgba(193,132,217,0.15) 0%, transparent 60%), linear-gradient(180deg, #170f1d 0%, #0a070d 76%)',
      atmo: 'repeating-linear-gradient(64deg, rgba(193,132,217,0.05) 0 1px, transparent 1px 46px), radial-gradient(50% 40% at 76% 88%, rgba(193,132,217,0.12) 0%, transparent 70%)',
    },
  }
  for (const key of TRACK_KEYS) {
    assert.equal(THEMES[key].bg, expected[key].bg, `${key}.bg`)
    if (key === 'circuit') {
      assert.equal(THEMES[key].atmo, '', `${key}.atmo`)
    } else {
      assert.equal(THEMES[key].atmo, expected[key].atmo, `${key}.atmo`)
    }
  }
})

test('difficulty pips: 1-5, distinct per track, matching the spec', () => {
  const expected = { circuit: 4, bayside: 1, grove: 2, foundry: 3, cliff: 4, fracture: 5 }
  for (const key of TRACK_KEYS) {
    assert.equal(THEMES[key].diff, expected[key], `${key}.diff`)
    assert.ok(THEMES[key].diff >= 1 && THEMES[key].diff <= 5)
  }
})

test('every track has a note and its notes paragraphs, circuit two, the rest three', () => {
  for (const key of TRACK_KEYS) {
    const theme = THEMES[key]
    assert.equal(typeof theme.note, 'string')
    assert.ok(theme.note.length > 0, `${key}: note is empty`)
    const expected = key === 'circuit' ? 2 : 3
    assert.equal(theme.notes.length, expected, `${key}: expected ${expected} notes`)
    for (const paragraph of theme.notes) assert.ok(paragraph.length > 0, `${key}: an empty note paragraph`)
  }
})

test("circuit's legend copy matches the design verbatim, ladder figure corrected", () => {
  assert.equal(
    THEMES.circuit.note,
    'None of it is the same corner twice: two hairpins you have to brake for, three long radii you can carry, and a hook with a blind exit.',
  )
  assert.equal(
    THEMES.circuit.notes[0],
    'The tarmac breathes from 32m across the line to 14m in the narrows. Four of those narrows have no barrier.',
  )
  // Corrected against the measured ladder (190.2-205.4s for three laps), not
  // the design's stale 69.57–69.64s.
  assert.equal(
    THEMES.circuit.notes[1],
    'All six chassis solve to 63.4–68.5s a lap here, so it sits between Foundry Loop and Cliff Spiral on this ladder.',
  )
  assert.ok(!THEMES.circuit.notes.some((p) => p.includes('69.57') || p.includes('69.64')), 'circuit note still quotes the stale ladder figure')
})

test('cliff and fracture notes do not quote a width narrower than the road actually is', () => {
  // The design's 15m/11m are what the road used to measure at its narrowest;
  // the geometry landed wider. The prose must not contradict the stat beside
  // it — see docs/specs/2026-08-22-kart-themes-and-scenery.md's closing note
  // under "Track notes".
  assert.ok(!THEMES.cliff.note.includes('15m'), 'cliff note still quotes the stale 15m')
  assert.ok(!THEMES.fracture.note.includes('11m'), 'fracture note still quotes the stale 11m')
  assert.ok(!THEMES.fracture.notes.some((p) => p.includes('11m')), 'a fracture note paragraph still quotes 11m')
})

test('THEMES does not carry diffLabel or lapEst — those live in shared/kart-tracks.js', () => {
  for (const key of TRACK_KEYS) {
    assert.equal('diffLabel' in THEMES[key], false, `${key}: diffLabel should not be duplicated here`)
    assert.equal('lapEst' in THEMES[key], false, `${key}: lapEst should not be duplicated here`)
  }
})

const WORLD_NUMBER_FIELDS = ['background', 'ground', 'grass', 'drop', 'deck', 'barrier', 'tarmac', 'kerbTint', 'kerbLight', 'line', 'itemBox']

test('worldColors resolves a full, numeric set of world colours for every track', () => {
  for (const key of TRACK_KEYS) {
    const colors = worldColors(key)
    for (const field of WORLD_NUMBER_FIELDS) {
      const value = colors[field]
      assert.equal(typeof value, 'number', `${key}.${field} should be a number`)
      assert.ok(Number.isInteger(value) && !Number.isNaN(value), `${key}.${field} is NaN`)
      assert.ok(value >= 0 && value <= 0xffffff, `${key}.${field} is out of RGB range`)
    }
    assert.match(colors.boostPad, HEX_RE, `${key}.boostPad is not #rrggbb`)
  }
})

test('worldColors ties tarmac, kerb, deck and item colours straight to the theme tokens', () => {
  for (const key of TRACK_KEYS) {
    const colors = worldColors(key)
    assert.equal(colors.tarmac, hex(key, 'road'))
    assert.equal(colors.kerbTint, hex(key, 'tint'))
    assert.equal(colors.kerbLight, hex(key, 'kerb'))
    assert.equal(colors.deck, hex(key, 'deck'))
    assert.equal(colors.itemBox, hex(key, 'tint'))
    assert.equal(colors.boostPad, THEMES[key].pad)
  }
})

test('worldColors is a pure function of the track key', () => {
  assert.deepEqual(worldColors('circuit'), worldColors('circuit'))
  assert.notDeepEqual(worldColors('circuit'), worldColors('fracture'))
})

// The design's scene builder carried a per-theme deck colour and depth that
// the spec's first pass at "Theme tokens" omitted — a lagoon causeway sits
// just above the tide flats, and the ridge road is cut into a mountainside,
// so one constant cannot stand in for both. Pinned here the way the pad
// colour above is pinned, so a future edit to THEMES has to touch this test.
const DECK_DEPTHS = {
  circuit: 3.2,
  bayside: 1.4,
  grove: 1.0,
  foundry: 1.8,
  cliff: 16,
  fracture: 2.2,
}

test('deckDepth is a positive number of metres, pinned per track', () => {
  for (const key of TRACK_KEYS) {
    assert.equal(THEMES[key].deckDepth, DECK_DEPTHS[key], `${key}.deckDepth`)
    assert.equal(worldColors(key).deckDepth, DECK_DEPTHS[key], `worldColors(${key}).deckDepth`)
    assert.ok(THEMES[key].deckDepth > 0, `${key}.deckDepth should be positive`)
  }
})
