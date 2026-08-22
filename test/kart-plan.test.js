import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACK, TRACK_N, halfWidthAt, heightAt, padSpots, TRACK_KEYS } from '../shared/kart.js'
import { statsFor, withTrack } from '../client/kart-stats.js'
import { planFor, elevFor } from '../client/kart-plan.js'

const PLAN_MARGIN = 40
const PLAN_VB = { w: 1000, h: 620 }
const EPS = 0.5 // half a viewBox unit of slack for the fitter's own rounding

/** All the numbers in an SVG path string, in order. */
function numbersIn(path) {
  return (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
}

/** {x, y} pairs, in order, out of an SVG path string's own numbers. */
function pointsIn(path) {
  const nums = numbersIn(path)
  const pts = []
  for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
  return pts
}

/**
 * road is built as [...left (forward), ...right (reversed)], closed with Z —
 * that is planFor's own contract, not something this test invents — so its
 * point list splits cleanly back into the left and right edge arrays at every
 * one of the TRACK_N sampled nodes.
 */
function edgesFromRoad(road) {
  const pts = pointsIn(road)
  const n = pts.length / 2
  return { left: pts.slice(0, n), right: pts.slice(n).reverse() }
}

function assertValidPath(path, label) {
  assert.ok(path.length > 0, `${label} is empty`)
  assert.ok(path.startsWith('M'), `${label} does not start with M: ${path}`)
  assert.ok(!path.includes('NaN'), `${label} contains NaN: ${path}`)
}

/** Every x (even index) / y (odd index) number in a path stays within the plan's margin box. */
function assertWithinMargin(path, label) {
  const nums = numbersIn(path)
  for (let i = 0; i < nums.length; i += 2) {
    const x = nums[i]
    const y = nums[i + 1]
    assert.ok(x >= PLAN_MARGIN - EPS && x <= PLAN_VB.w - PLAN_MARGIN + EPS, `${label} x=${x} breaks the margin`)
    assert.ok(y >= PLAN_MARGIN - EPS && y <= PLAN_VB.h - PLAN_MARGIN + EPS, `${label} y=${y} breaks the margin`)
  }
}

for (const key of TRACK_KEYS) {
  test(`planFor(${key}) is valid, closed, margin-contained geometry`, () => {
    const plan = planFor(key)
    const stats = statsFor(key)

    assert.equal(plan.viewBox, '0 0 1000 620')

    for (const [label, path] of [
      ['road', plan.road],
      ['edgeL', plan.edgeL],
      ['edgeR', plan.edgeR],
      ['centreDash', plan.centreDash],
      ['start', plan.start],
    ]) {
      assertValidPath(path, label)
      assertWithinMargin(path, label)
    }

    // The road is the one path meant to be filled, so it is the one that has
    // to actually close back on itself.
    assert.ok(plan.road.trim().endsWith('Z'), 'road polygon is not closed')

    // voidPath is a real path only on tracks that have a void to draw; an
    // empty string is the honest answer for the three that don't.
    if (stats.voids > 0) {
      assertValidPath(plan.voidPath, 'voidPath')
      assertWithinMargin(plan.voidPath, 'voidPath')
    } else {
      assert.equal(plan.voidPath, '')
    }

    assert.equal(plan.jumps.length, stats.jumps)
    for (const jump of plan.jumps) {
      assertValidPath(jump, 'jump')
      assertWithinMargin(jump, 'jump')
    }

    assert.equal(plan.boxes.length, stats.boxes, 'box count does not match statsFor')
    assert.equal(plan.pads.length, stats.pads, 'pad count does not match statsFor')

    for (const shape of [...plan.boxes, ...plan.pads]) {
      assert.ok(Number.isFinite(shape.x) && Number.isFinite(shape.y) && Number.isFinite(shape.angle))
      assert.ok(shape.x >= PLAN_MARGIN - EPS && shape.x <= PLAN_VB.w - PLAN_MARGIN + EPS)
      assert.ok(shape.y >= PLAN_MARGIN - EPS && shape.y <= PLAN_VB.h - PLAN_MARGIN + EPS)
    }

    // Fits inside the margin box (checked above) is not the same as fills it —
    // a scale bug that undershoots would still pass every check above while
    // leaving the card looking empty. The fitter always maximises scale on
    // whichever axis is tighter for that track's shape, so the road's own
    // bounding box has to reach the available span on at least one axis. 1%
    // of that span is slack for the coordinates' own 2-decimal rounding, not
    // for any error in the fit itself.
    const roadPts = pointsIn(plan.road)
    const xs = roadPts.map((p) => p.x)
    const ys = roadPts.map((p) => p.y)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    const targetW = PLAN_VB.w - 2 * PLAN_MARGIN
    const targetH = PLAN_VB.h - 2 * PLAN_MARGIN
    assert.ok(
      spanX >= targetW * 0.99 || spanY >= targetH * 0.99,
      `${key}: road span (${spanX.toFixed(1)}x${spanY.toFixed(1)}) does not fill either axis of the ${targetW}x${targetH} box`,
    )

    // A pad's (x, y) sits on the road's normal at its own s, the same as the
    // left and right edges — so however the fitter maps raw space to screen
    // space, a pad's screen point still has to fall between the screen-space
    // left and right edges at the nearest sampled node. This is an affine
    // identity (an affine map preserves a point's position along the chord
    // between two other points), so it holds regardless of the fitter's
    // scale, offset, or which way it flips an axis — a mirrored or
    // wrong-side normal fails it, a correct one cannot.
    const { left, right } = edgesFromRoad(plan.road)
    withTrack(key, () => {
      for (const [i, pad] of padSpots().entries()) {
        const idx = Math.round((pad.s / TRACK.length) * TRACK_N) % TRACK_N
        const hw = halfWidthAt(pad.s)
        const frac = 0.5 + pad.lane / (2 * hw) // 0 at the right edge, 1 at the left
        const expected = {
          x: right[idx].x + frac * (left[idx].x - right[idx].x),
          y: right[idx].y + frac * (left[idx].y - right[idx].y),
        }
        const got = plan.pads[i]
        // A few units of slack: the nearest sampled node is at most half a
        // node-spacing away from the pad's true s, and the road curves a
        // little across that gap.
        assert.ok(
          Math.hypot(got.x - expected.x, got.y - expected.y) < 4,
          `${key} pad ${i}: (${got.x.toFixed(1)},${got.y.toFixed(1)}) is not between the road's edges at s=${pad.s.toFixed(1)}`,
        )
      }
    })
  })

  test(`elevFor(${key}) closes the loop and has five ticks ending at the lap length`, () => {
    const elev = elevFor(key)
    const stats = statsFor(key)

    assertValidPath(elev.line, 'line')
    assertValidPath(elev.area, 'area')
    assert.ok(elev.area.trim().endsWith('Z'), 'elevation area is not closed')

    const lineNums = numbersIn(elev.line)
    const firstY = lineNums[1]
    const lastY = lineNums[lineNums.length - 1]
    assert.equal(firstY, lastY, 'elevation line does not meet itself at the start/finish')

    assert.equal(elev.bands.length, stats.jumps + stats.voids, 'band count is not jumps + voids')
    for (const band of elev.bands) {
      assert.ok(['jump', 'void'].includes(band.kind))
      assert.ok(Number.isFinite(band.x) && Number.isFinite(band.width))
      assert.ok(band.width > 0)
    }

    assert.equal(elev.ticks.length, 5)
    const last = elev.ticks[elev.ticks.length - 1]
    const metres = Number(last.label.replace(/[^0-9]/g, ''))
    assert.equal(metres, stats.length, 'last tick is not the lap length')
    assert.equal(elev.ticks[0].label, '0m')

    // The line must be the right way up, not just closed: SVG y grows
    // downward, so the crest of the lap has to land at a smaller y than the
    // low point, not a larger one. Recomputed independently from heightAt on
    // the same 0..200 sampling grid elevFor uses, so the indices line up with
    // elev.line's points exactly. Compared by height (crest vs low point),
    // not by matching the screen-space extremum's index — a lap's true crest
    // can straddle two adjacent samples closely enough that which one comes
    // out lowest after 2-decimal rounding is not worth pinning down; an
    // inverted profile still fails this outright.
    const heights = withTrack(key, () => Array.from({ length: 201 }, (_, i) => heightAt((i / 200) * TRACK.length)))
    const crestIndex = heights.indexOf(Math.max(...heights))
    const lowIndex = heights.indexOf(Math.min(...heights))
    const linePts = pointsIn(elev.line)
    assert.ok(
      linePts[crestIndex].y < linePts[lowIndex].y,
      `${key}: the crest (index ${crestIndex}) is not drawn above the low point (index ${lowIndex}) — profile is upside down`,
    )
  })
}
