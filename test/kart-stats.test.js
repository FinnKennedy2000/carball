import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  TRACK_KEYS,
  DEFAULT_TRACK,
  setTrack,
  activeTrack,
  TRACK,
  heightAt,
  CHASSIS_KEYS,
} from '../shared/kart.js'
import { statsFor, withTrack, CORNERS } from '../client/kart-stats.js'
import { PAR } from '../shared/kart-par.js'

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// In TRACK_KEYS order (circuit, bayside, grove, foundry, cliff, fracture).
// Jumps, voids, boxes and pads are the design's published counts from
// docs/specs/2026-08-22-kart-themes-and-scenery.md's "Measured stats" table,
// and they match the geometry exactly — they are array lengths, not floats.
//
// Length is the design's published number too (2279/1380/1680/2020/2380/2720m,
// measured off the drawn centreline), but the spline through the nodes lands
// up to 1.2m short of it on five of the six tracks — 0.05% of a lap, not worth
// chasing. So length gets a 2m tolerance rather than exact equality: loose
// enough to absorb that drift, tight enough that a real geometry change still
// has to come and update the literal below.
const LENGTH = [2279, 1380, 1680, 2020, 2380, 2720]
const JUMPS = [2, 0, 1, 2, 2, 3]
const VOIDS = [5, 0, 0, 1, 3, 4]
const BOXES = [24, 12, 15, 18, 21, 24]
const PADS = [12, 5, 6, 8, 9, 10]

test('withTrack restores the previously active track, even if fn throws', () => {
  setTrack(DEFAULT_TRACK)
  assert.equal(withTrack('bayside', () => activeTrack()), 'bayside')
  assert.equal(activeTrack(), DEFAULT_TRACK)

  assert.throws(() => withTrack('grove', () => {
    throw new Error('boom')
  }))
  assert.equal(activeTrack(), DEFAULT_TRACK, 'a thrown fn left the wrong track loaded')
})

test('every track meets itself at the line with no step in height', () => {
  // kart.test.js already walks the plan (pointAt/project round-trips) to prove
  // the loop closes on x/y; this is the elevation half of the same seam. The
  // hills are whole cycles per lap, so heightAt has to agree with itself at
  // s=0 and s=TRACK.length exactly, not just closely.
  try {
    for (const key of TRACK_KEYS) {
      setTrack(key)
      assert.equal(heightAt(0), heightAt(TRACK.length), `${key}: the road steps at the line`)
    }
  } finally {
    setTrack(DEFAULT_TRACK)
  }
})

test('measured stats match the design\'s published counts', () => {
  TRACK_KEYS.forEach((key, i) => {
    const s = statsFor(key)
    assert.ok(Math.abs(s.length - LENGTH[i]) <= 2, `${key} length ${s.length} vs published ${LENGTH[i]}`)
    assert.equal(s.jumps, JUMPS[i], `${key} jumps`)
    assert.equal(s.voids, VOIDS[i], `${key} voids`)
    assert.equal(s.boxes, BOXES[i], `${key} boxes`)
    assert.equal(s.pads, PADS[i], `${key} pads`)
    assert.deepEqual({ corners: s.corners, tight: s.tight }, CORNERS[key], `${key} corners/tight`)
  })
})

test('wmin never dips under three karts abreast', () => {
  // A kart is 2m wide, so three abreast plus room to pass is 6.6m plus a bit —
  // and the sim's own test already refuses a half-width under 6m, i.e. a
  // width under 12m.
  for (const key of TRACK_KEYS) {
    const s = statsFor(key)
    assert.ok(s.wmin >= 12, `${key}: wmin is only ${s.wmin.toFixed(1)}m`)
  }
})

test('box density stays close to the circuit\'s', () => {
  const circuit = statsFor('circuit')
  const boxDensity = circuit.boxes / circuit.length // one every ~95m
  // Box rows are `boxRows * 3` spread evenly, so they track a track's length
  // closely — 25% covers the whole field (worst case is foundry/cliff/fracture
  // at ~16-17%).
  for (const key of TRACK_KEYS) {
    if (key === 'circuit') continue
    const s = statsFor(key)
    const box = s.boxes / s.length
    assert.ok(
      Math.abs(box - boxDensity) / boxDensity < 0.25,
      `${key}: box density ${box.toFixed(4)}/m vs circuit's ${boxDensity.toFixed(4)}/m`,
    )
  }
})

// The design claims item boxes and boost pads both keep the circuit's density
// per metre. True of boxes; false of pads — the circuit runs a pad every
// ~190m and the five new tracks every 252-280m, because pads are placed by
// hand per track rather than by a length formula the way box rows are. So
// this asserts what is actually true of the pads instead of the claim the
// geometry contradicts: the five new tracks sit within a family of each
// other (observed spread is 10.9%, so 15% has headroom and still catches an
// outlier), and every track, circuit included, is at least one pad every
// 300m and no more than one every 150m.
test('pad spacing: the five new tracks are a family, and none is pad-starved or pad-stuffed', () => {
  const NEW_TRACKS = TRACK_KEYS.filter((key) => key !== 'circuit')
  const metresPerPad = Object.fromEntries(TRACK_KEYS.map((key) => {
    const s = statsFor(key)
    return [key, s.length / s.pads]
  }))
  const mean = NEW_TRACKS.reduce((sum, key) => sum + metresPerPad[key], 0) / NEW_TRACKS.length
  for (const key of NEW_TRACKS) {
    assert.ok(
      Math.abs(metresPerPad[key] - mean) / mean < 0.15,
      `${key}: a pad every ${metresPerPad[key].toFixed(0)}m vs the family's ${mean.toFixed(0)}m`,
    )
  }
  for (const key of TRACK_KEYS) {
    assert.ok(metresPerPad[key] >= 150 && metresPerPad[key] <= 300, `${key}: a pad every ${metresPerPad[key].toFixed(0)}m`)
  }
})

// The ladder used to be thirty-six simulated races (six chassis x six
// tracks) run by hand behind KART_LADDER=1, because driving them all takes
// minutes of CPU. shared/kart-par.js is that same 36-cell table, already
// simulated and committed, and test/kart-par.test.js pins its SIM_VERSION
// against the sim's — so a tuning change can't leave it stale unnoticed.
// Reading the ordering off PAR instead of re-driving the sim gets the same
// property in microseconds, always on, per chassis, so one inverted pair
// names both tracks and the chassis instead of failing the whole test.
const LADDER = ['bayside', 'grove', 'foundry', 'circuit', 'cliff', 'fracture']

test('the ladder holds: three-lap par increases bayside to fracture', () => {
  for (const chassis of CHASSIS_KEYS) {
    for (let i = 1; i < LADDER.length; i++) {
      const prev = PAR[LADDER[i - 1]][chassis]
      const next = PAR[LADDER[i]][chassis]
      assert.ok(
        next > prev,
        `${chassis}: ${LADDER[i - 1]} (${prev}ms) is not faster than ${LADDER[i]} (${next}ms)`,
      )
    }
  }
})

// This feature is presentation-only — themes, stats cards, the map and the
// 3D scenery around the sim — and was deliberately built without touching
// the sim itself. The pin is a tripwire for that boundary, not a ban on ever
// changing these files: if you meant to change the sim, update the hash
// below in the same commit.
test('shared/kart.js and shared/kart-tracks.js are untouched by this feature', () => {
  const base = fileURLToPath(new URL('../shared/', import.meta.url))
  assert.equal(
    sha256(base + 'kart.js'),
    // Updated by the merge that brought the phone controls in: the soft-wheel
    // input bit is a sim change, made deliberately and on purpose. The tripwire
    // fired exactly as intended.
    'ad980c4017eb84ddb3ae17030ab85ffc6d7894bb555f6c04a8f90f1932f4c48e',
    'shared/kart.js changed — this feature was presentation-only and deliberately did not touch the sim. ' +
      'If you meant to change the sim, update this hash in the same commit.',
  )
  assert.equal(
    sha256(base + 'kart-tracks.js'),
    'f50a15272a1545560e7e2c4320fa77eb27f94d582fee8d4569d154ec106cfaf2',
    'shared/kart-tracks.js changed — this feature was presentation-only and deliberately did not touch the sim. ' +
      'If you meant to change the sim, update this hash in the same commit.',
  )
})
