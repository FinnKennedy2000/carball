// The pure geometry behind a map card: an SVG plan of the lap and an
// elevation strip, both built from the loaded track rather than from the
// design's own `roadPath` strings. Those were drawn in a different coordinate
// space, and before three of the tracks' narrows were widened, so they would
// quietly draw the wrong road. Sampling `shared/kart.js` instead means the
// card always matches whatever geometry a race actually runs on.
//
// Imports nothing from the DOM — every return value here is data (path
// strings and plain objects), so this tests in node and the next task turns
// it into markup.

import { TRACK, TRACK_N, pointAt, halfWidthAt, heightAt, boxSpots, padSpots } from '../shared/kart.js'
import { TRACKS } from '../shared/kart-tracks.js'
import { withTrack } from './kart-stats.js'

const PLAN_VB = { w: 1000, h: 620 }
const ELEV_VB = { w: 1000, h: 112 }

// Margin around the road on the plan, in viewBox units. The plan's widest
// stroke is the void dash at 2.4 and the jump band at 7 with round caps, both
// drawn on top of the fitted road; 40 units (4% of the 1000-wide box) clears
// twice the widest of those with room left over, so nothing in the drawing
// order can be clipped by the card's edge no matter which track it is.
const MARGIN = 40

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/** One path string through a list of {x, y} points, `M` then `L`s. */
function pathThrough(pts, close = false) {
  const body = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ')
  return close ? `${body} Z` : body
}

/** 1,234 -> "1,234" — the ticks are the only place this game prints a big number. */
function withCommas(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Sample the centreline and the road's half-width at every one of the sim's
 * TRACK_N nodes. Reused for the road polygon, the kerb edges and the centre
 * dashes, so the three always agree on where the road actually is.
 */
function sampleLap() {
  const pts = []
  for (let i = 0; i < TRACK_N; i++) {
    const s = TRACK.cum[i]
    const p = pointAt(s)
    const hw = halfWidthAt(s)
    pts.push({ x: p.x, y: p.y, nx: p.nx, ny: p.ny, tx: p.tx, ty: p.ty, hw, s })
  }
  return pts
}

/**
 * A straight-line fit from the lap's own bounding box (both kerb edges, not
 * just the centreline — that is the actual painted extent) into the plan's
 * viewBox, uniform on both axes so a long thin track is not stretched round.
 *
 * The sim is a plan view with y increasing "up" the map; SVG's y increases
 * down the page. Flipping y here, rather than leaving it alone, is what makes
 * the card's plan read the same way round as the design's mock — a straight
 * pass-through would draw every track upside down against it.
 */
function fitter(lapPts) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of lapPts) {
    for (const side of [1, -1]) {
      const x = p.x + p.nx * p.hw * side
      const y = p.y + p.ny * p.hw * side
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const w = Math.max(maxX - minX, 1e-6)
  const h = Math.max(maxY - minY, 1e-6)
  const scale = Math.min((PLAN_VB.w - 2 * MARGIN) / w, (PLAN_VB.h - 2 * MARGIN) / h)
  const padX = MARGIN + (PLAN_VB.w - 2 * MARGIN - w * scale) / 2
  const padY = MARGIN + (PLAN_VB.h - 2 * MARGIN - h * scale) / 2
  return (x, y) => ({ x: (x - minX) * scale + padX, y: (maxY - y) * scale + padY })
}

/** The road-space angle of the tangent at a lap point, as SVG rotation degrees. */
function headingDeg(tx, ty) {
  // atan2(-ty, tx) rather than atan2(ty, tx): the fitter flips y, so a
  // rotation drawn in screen space has to flip the same way the points did.
  return (Math.atan2(-ty, tx) * 180) / Math.PI
}

/**
 * Points at the lap nodes from fraction `from` to `to` (inclusive), for a jump
 * or a void. Assumes `from < to` — true of every jump and void on all six
 * tracks today — so a stretch crossing the start line (e.g. `[0.95, 0.05]`)
 * would silently come back empty rather than wrapping. Worth a comment, not
 * worth handling before a track actually needs it.
 */
function stretch(lapPts, from, to) {
  const i0 = Math.round(from * TRACK_N)
  const i1 = Math.round(to * TRACK_N)
  const out = []
  for (let i = i0; i <= i1; i++) out.push(lapPts[i % TRACK_N])
  return out
}

/**
 * The plan-view geometry for one track's card: the road, its edges, the
 * centre dashes, the void and jump marks, and where the pads, boxes and start
 * line sit, all in the `0 0 1000 620` viewBox the spec's plan SVG uses.
 *
 * `pads` and `boxes` are `{x, y, angle}` rather than path strings — both are
 * fixed-size rotated rects in the design (10x4.8 for a pad, 6.8x6.8 for a
 * box), so the card draws the rect and rotates it by `angle` degrees about
 * `(x, y)` rather than this module hand-rolling four corners per shape.
 */
export function planFor(key) {
  return withTrack(key, () => {
    const t = TRACKS[key]
    const lap = sampleLap()
    const project = fitter(lap)
    const at = (p) => project(p.x, p.y)

    // A lap point's kerb, `side` 1 for the left edge and -1 for the right.
    const kerb = (p, side) => at({ x: p.x + p.nx * p.hw * side, y: p.y + p.ny * p.hw * side })

    const left = lap.map((p) => kerb(p, 1))
    const right = lap.map((p) => kerb(p, -1))
    const centre = lap.map((p) => at(p))

    const road = pathThrough([...left, ...right.slice().reverse()], true)
    const edgeL = pathThrough([...left, left[0]])
    const edgeR = pathThrough([...right, right[0]])
    const centreDash = pathThrough([...centre, centre[0]])

    // Two subpaths per void, one down each kerb: `VOIDS` carries no side, and
    // buildWorld()'s wall loop runs `for (const side of [1, -1])` filtered by
    // the same `solid`, so a void leaves the barrier off *both* edges — the
    // drop really is on either side. Marked down the centreline instead it
    // would read as something in the road rather than as a missing edge.
    const voidPath = t.voids
      .flatMap(([from, to]) => {
        const pts = stretch(lap, from, to)
        return [1, -1].map((side) => pathThrough(pts.map((p) => kerb(p, side))))
      })
      .join(' ')

    const jumps = t.jumps.map(([from, to]) => pathThrough(stretch(lap, from, to).map(at)))

    const pads = padSpots().map((pad) => {
      const p = pointAt(pad.s)
      const sp = project(pad.x, pad.y)
      return { x: sp.x, y: sp.y, angle: headingDeg(p.tx, p.ty) }
    })

    const boxes = boxSpots().map((box) => {
      const p = pointAt(box.s)
      const sp = project(box.x, box.y)
      return { x: sp.x, y: sp.y, angle: headingDeg(p.tx, p.ty) }
    })

    const startCentre = pointAt(0)
    const startHalf = halfWidthAt(0)
    const startL = at({ x: startCentre.x + startCentre.nx * startHalf, y: startCentre.y + startCentre.ny * startHalf })
    const startR = at({ x: startCentre.x - startCentre.nx * startHalf, y: startCentre.y - startCentre.ny * startHalf })
    const start = pathThrough([startL, startR])

    return { road, edgeL, edgeR, centreDash, voidPath, jumps, pads, boxes, start, viewBox: `0 0 ${PLAN_VB.w} ${PLAN_VB.h}` }
  })
}

// How many points make up the elevation profile. 200 gives a smooth curve on
// every track's hill count without the line ever looking like the straight
// segments it actually is; one more sample closes the loop back onto sample 0.
const ELEV_SAMPLES = 200

// Where the mean height sits in the 112-tall strip: dead centre, so a climb
// and a drop have equally as much box to use.
const ELEV_MEAN_Y = 56

// Left over above and below the profile once it is centred on the mean, so
// the crest and the low point clear the strip's edge rather than touching it.
const ELEV_EDGE_MARGIN = 8

/**
 * The elevation-strip geometry for one track's card: the profile line, the
 * filled area under it, one band per jump and per void, and five distance
 * ticks, all in the `0 0 1000 112` viewBox the spec's elevation SVG uses.
 */
export function elevFor(key) {
  return withTrack(key, () => {
    const t = TRACKS[key]
    const L = TRACK.length
    const heights = []
    for (let i = 0; i <= ELEV_SAMPLES; i++) heights.push(heightAt((i / ELEV_SAMPLES) * L))

    const mean = heights.reduce((sum, h) => sum + h, 0) / heights.length
    const amplitude = Math.max(...heights.map((h) => Math.abs(h - mean)), 1e-6)
    const scale = (ELEV_MEAN_Y - ELEV_EDGE_MARGIN) / amplitude

    const pts = heights.map((h, i) => ({
      x: (i / ELEV_SAMPLES) * ELEV_VB.w,
      y: ELEV_MEAN_Y - (h - mean) * scale,
    }))

    const line = pathThrough(pts)
    const area = `${line} L ${fmt(ELEV_VB.w)} ${fmt(ELEV_VB.h)} L 0 ${fmt(ELEV_VB.h)} Z`

    const bands = [
      ...t.jumps.map(([from, to]) => ({ x: from * ELEV_VB.w, width: (to - from) * ELEV_VB.w, y: 0, height: ELEV_VB.h, kind: 'jump' })),
      ...t.voids.map(([from, to]) => ({ x: from * ELEV_VB.w, width: (to - from) * ELEV_VB.w, y: 0, height: ELEV_VB.h, kind: 'void' })),
    ]

    const length = Math.round(L)
    // No `x`: the card lays these out with `justify-content: space-between`,
    // which is exact because ticks are at i/4 by construction — a position
    // field here would just be an unread contract to keep in sync.
    const ticks = Array.from({ length: 5 }, (_, i) => ({ label: `${withCommas(Math.round((i / 4) * length))}m` }))

    return { line, area, bands, ticks }
  })
}
