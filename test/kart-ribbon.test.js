// The strips the world is drawn from. One thing matters here and it is not
// visible in a unit test on its own: no strip may fold back over the road, since
// a strip that has folded is a sheet laid over the tarmac with the karts under
// it. Checked on every map, because it is a property of a corner's radius and
// the next map added is the one that breaks it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACK, TRACK_KEYS, setTrack, DEFAULT_TRACK, halfWidthAt, KERB } from '../shared/kart.js'
import { foldCapped, bendRadius, isInside, FOLD_CAP } from '../client/kart-ribbon.js'

// What the world is actually built from, widest last.
const GRASS = 22

test('no strip folds back over the road, on any map', () => {
  try {
    let everClamped = 0
    for (const key of TRACK_KEYS) {
      setTrack(key)
      for (let i = 0; i < TRACK.pts.length; i++) {
        const half = halfWidthAt(TRACK.cum[i])
        const radius = bendRadius(i)
        for (const side of [1, -1]) {
          // Only the inside of a bend can invert; pushing outwards only ever
          // makes the curve gentler.
          const grass = side * (half + GRASS)
          if (!isInside(i, grass)) continue
          const got = Math.abs(foldCapped(i, grass))
          if (got < half + GRASS) everClamped++
          assert.ok(
            got <= Math.max(radius, half + KERB) + 1e-9,
            `${key}: the grass reaches ${got.toFixed(1)}m into a ${radius.toFixed(1)}m corner at s=${TRACK.cum[i].toFixed(0)}`,
          )
        }
      }
    }
    // If nothing anywhere needed holding back, this test is watching nothing —
    // the maps have hairpins tighter than the 22m the grass sits out at.
    assert.ok(everClamped > 0, 'no edge was ever held back, so this proves nothing')
  } finally {
    setTrack(DEFAULT_TRACK)
  }
})

test('the road and its kerb are never pulled in to protect the grass', () => {
  try {
    for (const key of TRACK_KEYS) {
      setTrack(key)
      for (let i = 0; i < TRACK.pts.length; i++) {
        const half = halfWidthAt(TRACK.cum[i])
        for (const side of [1, -1]) {
          // The tarmac you see has to be the tarmac the physics grips.
          assert.ok(
            Math.abs(foldCapped(i, side * half)) >= half - 1e-9,
            `${key}: the tarmac was narrowed at s=${TRACK.cum[i].toFixed(0)}`,
          )
          assert.ok(
            Math.abs(foldCapped(i, side * (half + KERB))) >= half + KERB - 1e-9,
            `${key}: the kerb was narrowed at s=${TRACK.cum[i].toFixed(0)}`,
          )
        }
      }
    }
  } finally {
    setTrack(DEFAULT_TRACK)
  }
})

test('the outside of a bend is left alone, however tight it is', () => {
  try {
    setTrack('fracture') // the tightest hairpins of the six
    let checked = 0
    for (let i = 0; i < TRACK.pts.length; i++) {
      for (const side of [1, -1]) {
        const out = side * (halfWidthAt(TRACK.cum[i]) + GRASS)
        if (isInside(i, out)) continue
        assert.equal(foldCapped(i, out), out)
        checked++
      }
    }
    assert.ok(checked > 0)
    // And the cap is a fraction of the radius rather than the whole of it: an
    // edge exactly on the centre of the curve is a point, not a strip.
    assert.ok(FOLD_CAP > 0 && FOLD_CAP < 1)
  } finally {
    setTrack(DEFAULT_TRACK)
  }
})
