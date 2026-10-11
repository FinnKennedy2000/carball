// Arena geometry. Y up, goals at +-Z. Everything is a signed distance field so the
// sim can collide cars and ball against floor, curved walls, ceiling and goals.
export const ARENA = {
  halfWidth: 41, halfLength: 51, height: 20, cornerR: 8, wallR: 4,
  goal: { halfWidth: 9, height: 6.5, depth: 8 },
}

// RL layout (1 uu = 1 cm): 6 big pads + 28 small, mirrored on both axes.
const S = [
  [0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308], [0, -2816],
  [-3584, -2484], [3584, -2484], [-1788, -2300], [1788, -2300], [-2048, -1036], [0, -1024], [2048, -1036],
]
const B = [[-3072, -4096], [3072, -4096], [-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096]]
export const BOOST_PADS = [
  ...B.map(([x, z]) => ({ p: [x / 100, 0, z / 100], big: true })),
  ...S.map(([x, z]) => ({ p: [x / 100, 0, z / 100], big: false })),
  ...S.map(([x, z]) => ({ p: [x / 100, 0, -z / 100], big: false })),
  { p: [-10.24, 0, 0], big: false },
  { p: [10.24, 0, 0], big: false },
]

/** Inside distance to the field box (rounded vertical corners, floor/ceiling fillets). Writes normal into n. */
function boxDist(x, y, z, n) {
  const { halfWidth: hw, halfLength: hl, height: H, cornerR: cR, wallR: r } = ARENA
  // 2D rounded rectangle in XZ
  const sx = x < 0 ? -1 : 1, sz = z < 0 ? -1 : 1
  const qx = Math.abs(x) - (hw - cR), qz = Math.abs(z) - (hl - cR)
  let a, ax, az
  if (qx > 0 && qz > 0) {
    const h = Math.hypot(qx, qz) || 1e-9
    a = cR - h; ax = -sx * qx / h; az = -sz * qz / h
  } else if (qx > qz) { a = hw - Math.abs(x); ax = -sx; az = 0 } else { a = hl - Math.abs(z); ax = 0; az = -sz }
  // vertical: floor or ceiling, whichever is nearer
  const up = y < H / 2
  const b = up ? y : H - y
  const by = up ? 1 : -1
  let d, na, nb
  if (a < r && b < r) {
    const da = r - a, db = r - b
    const h = Math.hypot(da, db) || 1e-9
    d = r - h; na = da / h; nb = db / h
  } else if (a < b) { d = a; na = 1; nb = 0 } else { d = b; na = 0; nb = 1 }
  n[0] = ax * na; n[1] = by * nb; n[2] = az * na
  return d
}

const _n = [0, 0, 0]
/** Signed distance to the nearest surface (>0 inside) and inward unit normal. */
export function arenaDistance(p, out) {
  const { halfLength: hl, goal: g } = ARENA
  const x = p[0], y = p[1], z = p[2]
  let d = boxDist(x, y, z, _n)
  let n0 = _n[0], n1 = _n[1], n2 = _n[2]
  // goal box (carved beyond the end walls); a box with sharp edges, union with the field
  const az = Math.abs(z)
  if (az > hl - 6 && Math.abs(x) < g.halfWidth + 6) {
    const ds = [g.halfWidth - Math.abs(x), g.height - y, y, hl + g.depth - az, az - (hl - 6)]
    let m = 0
    for (let i = 1; i < 5; i++) if (ds[i] < ds[m]) m = i
    if (ds[m] > d) {
      d = ds[m]
      const s = z < 0 ? -1 : 1
      n0 = n1 = n2 = 0
      if (m === 0) n0 = x < 0 ? 1 : -1
      else if (m === 1) n1 = -1
      else if (m === 2) n1 = 1
      else if (m === 3) n2 = -s
      else n2 = s
    }
  }
  if (out) { out.d = d; out.n = [n0, n1, n2]; return out }
  return { d, n: [n0, n1, n2] }
}

/**
 * Which goal is the ball fully inside? 0 = the goal at -Z (blue's, so orange scored),
 * 1 = the goal at +Z (orange's, so blue scored), -1 = neither.
 * "Fully" = ball centre past the goal line by a radius.
 */
export function inGoal(p, r) {
  const g = ARENA.goal
  if (Math.abs(p[0]) > g.halfWidth || p[1] > g.height + r) return -1
  if (p[2] < -(ARENA.halfLength + r)) return 0
  if (p[2] > ARENA.halfLength + r) return 1
  return -1
}
