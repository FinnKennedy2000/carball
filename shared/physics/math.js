// Tiny vec3 / quat helpers. Quats are [x,y,z,w]. Vectors are plain arrays.
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a) => Math.hypot(a[0], a[1], a[2])
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)

export function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}
export function qnorm(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n
  return q
}
export function qrot(q, v) {
  const [x, y, z, w] = q
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
/** Rotate q by the angular velocity w (world, rad/s) over dt. In place. */
export function qintegrate(q, w, dt) {
  const m = Math.hypot(w[0], w[1], w[2])
  if (m < 1e-9) return q
  const h = m * dt * 0.5, s = Math.sin(h) / m
  const r = qmul([w[0] * s, w[1] * s, w[2] * s, Math.cos(h)], q)
  q[0] = r[0]; q[1] = r[1]; q[2] = r[2]; q[3] = r[3]
  return qnorm(q)
}
/** Shortest rotation taking unit a to unit b. */
export function qfromto(a, b) {
  const d = dot(a, b)
  if (d < -0.9999) { const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = cross(a, ax); return qnorm([c[0], c[1], c[2], 0]) }
  const c = cross(a, b)
  return qnorm([c[0], c[1], c[2], 1 + d])
}
export const qyaw = (psi) => [0, Math.sin(psi / 2), 0, Math.cos(psi / 2)]
