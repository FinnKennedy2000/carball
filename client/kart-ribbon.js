// Where the edge of a strip goes.
//
// The world is built from strips that follow the centre line at an offset: the
// tarmac at the road's half-width, the kerb a little wider, the grass 22m wider
// again. Offsetting a curve inwards has a limit that offsetting it outwards does
// not — the inside edge cannot be pushed past the centre of the curve it is
// going round. Past that point it comes out the far side and the strip is inside
// out, which on the tightest hairpins laid a sheet of grass over the tarmac with
// the karts underneath it.
//
// Kept out of kart.js so it can be checked against every map without a browser.

import { TRACK, halfWidthAt, KERB } from '../shared/kart.js'

// How much of a corner's radius an inside edge may eat into. An edge pushed the
// whole way arrives at a point; past it, it inverts.
export const FOLD_CAP = 0.85

/** The circle through three consecutive nodes, and which way the road bends. */
function bendAt(i) {
  const pts = TRACK.pts
  const n = pts.length
  const a = pts[(i - 1 + n) % n]
  const b = pts[i]
  const c = pts[(i + 1) % n]
  const d1 = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const d2 = Math.hypot(c.x - b.x, c.y - b.y) || 1
  // Which way the line is turning, as the change in direction over the node.
  const tx = (c.x - b.x) / d2 - (b.x - a.x) / d1
  const ty = (c.y - b.y) / d2 - (b.y - a.y) / d1
  // The same normal the offset is applied along, so the question below is about
  // direction rather than about anyone's handedness convention.
  const nx = -(c.y - b.y) / d2
  const ny = (c.x - b.x) / d2
  const across = Math.hypot(c.x - a.x, c.y - a.y)
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
  return {
    straight: Math.hypot(tx, ty) < 1e-9 || area < 1e-9,
    // Positive when a positive offset is the inside of the bend.
    towards: tx * nx + ty * ny,
    // Read off the circle through the three nodes rather than off the change in
    // direction: the chord of an angle is shorter than the angle, so the cheap
    // reading calls a sharp corner gentle — and the sharp ones are the ones that
    // fold.
    radius: (d1 * d2 * across) / (4 * area),
  }
}

/** The radius of the road's curve at node `i`, for a test to check against. */
export function bendRadius(i) {
  const bend = bendAt(i)
  return bend.straight ? Infinity : bend.radius
}

/** Whether `offset` at node `i` points into the bend rather than out of it. */
export function isInside(i, offset) {
  const bend = bendAt(i)
  if (bend.straight) return false
  return bend.towards > 0 ? offset > 0 : offset < 0
}

/**
 * `offset` at node `i`, held short of folding. Never pulled tighter than the
 * road and its kerb whatever the corner does: the tarmac you see is the tarmac
 * the physics grips, and narrowing that to protect the grass would trade a
 * hidden kart for a road with a bite out of it.
 */
export function foldCapped(i, offset) {
  const bend = bendAt(i)
  if (bend.straight) return offset // a straight has no inside
  const inside = bend.towards > 0 ? offset > 0 : offset < 0
  if (!inside) return offset
  const floor = halfWidthAt(TRACK.cum[i]) + KERB
  const cap = Math.max(bend.radius * FOLD_CAP, floor)
  return Math.sign(offset) * Math.min(Math.abs(offset), cap)
}
