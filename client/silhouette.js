// Flat SVG portraits of the cars, for pages that have no business loading
// three.js — the garage list, and the garage's own preview.
//
// The shapes are generated from the same shared/cars.js boxes the renderer
// builds, not drawn by hand: a model added to that table shows up here without
// anyone remembering to draw it, and a portrait cannot drift from the car you
// actually get on the pitch.
//
// One projection, one scale, one function. Every portrait is drawn at PX_PER_UNIT
// with the viewBox fitted around the result, so a Van really does look bigger
// than a Roadster in the list — which is the whole point of picking a silhouette.

const PX_PER_UNIT = 46
// Isometric: 30 degrees, so the top face and two sides are all visible.
const COS = Math.cos(Math.PI / 6)
const SIN = Math.sin(Math.PI / 6)

// The renderer's own colours — TEAM_COLOR, the roof, and the nose flash.
export const TEAM_PAINT = ['#3b82f6', '#f97316']
const ROOF = '#11151d'
const NOSE = '#f4f4f5'

// Top face full strength, the two sides progressively darker.
const SHADE = { top: 1, x: 0.78, z: 0.6 }

const project = (x, y, z) => [(x - z) * COS * PX_PER_UNIT, ((x + z) * SIN - y) * PX_PER_UNIT]

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16)
  const part = (shift) => Math.round(((n >> shift) & 0xff) * k)
  return `rgb(${part(16)},${part(8)},${part(0)})`
}

/**
 * The three faces of one box that face the viewer, back to front. A box is
 * [length, height, width] centred at `at` = [x, y, z], as in cars.js.
 */
function boxFaces([l, h, w], [cx, cy, cz], colour) {
  const x0 = cx - l / 2
  const x1 = cx + l / 2
  const y0 = cy - h / 2
  const y1 = cy + h / 2
  const z0 = cz - w / 2
  const z1 = cz + w / 2

  // Only the +x, +z and +y faces can be seen from this angle, and the top is
  // drawn last because it sits above both sides.
  return [
    { pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], k: SHADE.z },
    { pts: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], k: SHADE.x },
    { pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], k: SHADE.top },
  ].map(({ pts, k }) => ({
    points: pts.map(([x, y, z]) => project(x, y, z)),
    fill: shade(colour, k),
  }))
}

/** Every face of one car, back to front: body, then what sits on it. */
function carFaces(spec, team) {
  const bodyY = spec.body[1] / 2 + 0.15
  return [
    ...boxFaces(spec.body, [0, bodyY, 0], TEAM_PAINT[team] ?? TEAM_PAINT[0]),
    ...boxFaces(spec.nose, [spec.body[0] / 2, bodyY, 0], NOSE),
    ...boxFaces(spec.roof, [spec.roofAt[0], spec.roofAt[1], 0], ROOF),
  ]
}

/**
 * An `<svg>` for one car, sized by its own bounds so it can be dropped into any
 * width. Returns markup rather than a node because both callers want it as the
 * innards of something they already have.
 *
 * Every value in it is a number off the table or one of the colour constants
 * above — no name, no input, nothing from the channel — so callers can set it as
 * innerHTML. Keep it that way: interpolate text in here and that stops holding.
 */
export function carSvg(spec, team = 0) {
  const faces = carFaces(spec, team)
  const xs = faces.flatMap((f) => f.points.map((p) => p[0]))
  const ys = faces.flatMap((f) => f.points.map((p) => p[1]))
  // Room for the shadow, which sits below and a little wider than the car.
  const pad = 10
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const width = Math.max(...xs) - minX + pad
  const height = Math.max(...ys) - minY + pad * 2

  const ground = project(0, 0, 0)
  const shadow = `<ellipse cx="${ground[0].toFixed(1)}" cy="${(ground[1] + 6).toFixed(1)}" rx="${(
    spec.body[0] * PX_PER_UNIT * 0.62
  ).toFixed(1)}" ry="${(spec.body[2] * PX_PER_UNIT * 0.3).toFixed(1)}" fill="#080b10" opacity="0.45"/>`

  const polys = faces
    .map(
      (f) =>
        `<polygon points="${f.points
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(' ')}" fill="${f.fill}"/>`,
    )
    .join('')

  return `<svg viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(
    1,
  )}" class="car-svg">${shadow}${polys}</svg>`
}

/** length × height × width, the way the garage lists it. */
export function dimensions(spec) {
  return spec.body.map((n) => n.toFixed(1)).join(' × ')
}
