// Pure audio maths: no WebAudio, no DOM, so node:test can exercise it.

export const DEFAULT_ARENA = { halfWidth: 40, halfLength: 60, height: 20, goal: { halfWidth: 8, height: 7, depth: 6 } }

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
export const lerp = (a, b, t) => a + (b - a) * t
export const fin = (x, d = 0) => (Number.isFinite(x) ? x : d)
export const hypot3 = (v) => Math.hypot(v[0], v[1], v[2])

// Gear change points in m/s (CAR_MAX_SPEED 18, boost cap 48).
export const GEARS = [0, 6, 12, 19, 28, 40]

/**
 * Fill `out` with engine voice params. rpm sweeps 0..1 inside a gear and drops
 * back on each shift, which is what makes it sound like gears rather than a siren.
 */
export function engineParams(speed, throttle, boosting, out = {}) {
  let g = GEARS.length - 1
  for (let i = 1; i < GEARS.length; i++) if (speed < GEARS[i]) { g = i - 1; break }
  const lo = GEARS[g]
  const hi = g === GEARS.length - 1 ? lo + 14 : GEARS[g + 1]
  const rpm = clamp((speed - lo) / (hi - lo))
  const load = clamp(throttle)
  out.gear = g
  out.rpm = rpm
  out.freq = 38 + 20 * g * 0.6 + rpm * (55 + g * 6) + load * 8 + (boosting ? 10 : 0)
  out.cutoff = 380 + rpm * 700 + load * 1400 + (boosting ? 700 : 0)
  out.gain = 0.12 + 0.2 * load + 0.08 * rpm
  return out
}

/** Throttle guess from forward acceleration (no input in state). 0..1. */
export function estimateThrottle(prevSpeed, speed, dt, boosting) {
  if (boosting) return 1
  if (!(dt > 0)) return 0.3
  return clamp(0.25 + (speed - prevSpeed) / dt / 10)
}

/** 0..1 crowd excitement from ball position and speed. */
export function crowdIntensity(ballP, ballV, arena = DEFAULT_ARENA) {
  const hl = arena.halfLength || 60
  const near = clamp((Math.abs(fin(ballP[2])) / hl - 0.45) / 0.55) // 0 at midfield-ish, 1 at goal line
  const sp = clamp(hypot3(ballV) / 45)
  return clamp(0.18 + 0.5 * near * near + 0.3 * sp)
}

/** Listener forward and up vectors from a quaternion (camera looks down -Z). */
export function quatAxes(q, out = { f: [0, 0, -1], u: [0, 1, 0] }) {
  const [x, y, z, w] = q
  out.f[0] = -2 * (x * z + w * y)
  out.f[1] = -2 * (y * z - w * x)
  out.f[2] = -(1 - 2 * (x * x + y * y))
  out.u[0] = 2 * (x * y - w * z)
  out.u[1] = 1 - 2 * (x * x + z * z)
  out.u[2] = 2 * (y * z + w * x)
  return out
}

/** Pull a position toward the listener (own car sounds closer). Writes into out. */
export function pullToward(p, cam, k, out = [0, 0, 0]) {
  for (let i = 0; i < 3; i++) out[i] = cam[i] + (p[i] - cam[i]) * k
  return out
}

/** Ball bounce: velocity component flipped sign near a wall/floor/ceiling. Returns strength 0..1 or 0. */
export function ballBounce(p, prevV, v, arena = DEFAULT_ARENA) {
  const near = (c, lim) => Math.abs(c) > lim - 3.5
  const flips = [
    [0, arena.halfWidth],
    [2, arena.halfLength],
  ]
  let best = 0
  for (const [i, lim] of flips) {
    if (near(p[i], lim) && prevV[i] * v[i] < 0) best = Math.max(best, Math.abs(prevV[i] - v[i]))
  }
  if (p[1] < 3.5 && prevV[1] < 0 && v[1] > 0) best = Math.max(best, v[1] - prevV[1])
  return clamp(best / 40)
}

/** Event strength 0..1 -> gain, pitch ratio (hard hits are lower and louder). */
export function hitShape(strength) {
  const s = clamp(strength)
  return { gain: 0.25 + 0.75 * s, pitch: 1.25 - 0.45 * s }
}
