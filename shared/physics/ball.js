// Ball physics: gravity, drag, arena bounces, rolling spin, and the car hit model.
import * as C from '../constants.js'
import { arenaDistance } from '../arena.js'
import { dot, cross, len, clamp, qrot, qintegrate } from './math.js'
import { hitboxOf } from './car.js'

export function stepBall(ball, dt) {
  const { p, v } = ball
  v[1] -= C.GRAVITY * dt
  const drag = Math.exp(-C.BALL_DRAG * dt)
  v[0] *= drag; v[1] *= drag; v[2] *= drag
  const sp = len(v)
  if (sp > C.BALL_MAX_SPEED) { const k = C.BALL_MAX_SPEED / sp; v[0] *= k; v[1] *= k; v[2] *= k }
  p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt
  let bounce = 0
  for (let it = 0; it < 2; it++) {
    const s = arenaDistance(p)
    const pen = C.BALL_R - s.d
    if (pen <= 0) break
    const n = s.n
    p[0] += n[0] * pen; p[1] += n[1] * pen; p[2] += n[2] * pen
    const vn = dot(v, n)
    if (vn < 0) {
      const e = -vn < 2.5 ? 0 : C.BALL_RESTITUTION
      v[0] -= n[0] * vn * (1 + e); v[1] -= n[1] * vn * (1 + e); v[2] -= n[2] * vn * (1 + e)
      bounce = Math.max(bounce, -vn)
    }
    // rolling: spin follows the surface speed
    const vt = [v[0] - n[0] * dot(v, n), v[1] - n[1] * dot(v, n), v[2] - n[2] * dot(v, n)]
    const roll = cross(n, vt)
    const k = Math.min(1, 6 * dt)
    for (let i = 0; i < 3; i++) ball.w[i] += (roll[i] / C.BALL_R - ball.w[i]) * k
  }
  qintegrate(ball.q, ball.w, dt)
  return bounce
}

/** Resolve ball vs car OBB. Returns hit strength 0..1 (0 = no meaningful contact). Mutates ball. */
export function carHitsBall(ball, car) {
  const [W, H, L] = hitboxOf(car)
  const qi = [-car.q[0], -car.q[1], -car.q[2], car.q[3]]
  const d = [ball.p[0] - car.p[0], ball.p[1] - car.p[1], ball.p[2] - car.p[2]]
  const loc = qrot(qi, d)
  const hx = W / 2, hy = H / 2, hz = L / 2
  const cx = clamp(loc[0], -hx, hx), cy = clamp(loc[1], -hy, hy), cz = clamp(loc[2], -hz, hz)
  let nx = loc[0] - cx, ny = loc[1] - cy, nz = loc[2] - cz
  let dist = Math.hypot(nx, ny, nz)
  if (dist >= C.BALL_R) return 0
  if (dist < 1e-6) { nx = 0; ny = 1; nz = 0; dist = 0 } else { nx /= dist; ny /= dist; nz /= dist }
  const n = qrot(car.q, [nx, ny, nz])
  const r = qrot(car.q, [cx, cy, cz])
  const vc = cross(car.w, r)
  vc[0] += car.v[0]; vc[1] += car.v[1]; vc[2] += car.v[2]
  const rel = [ball.v[0] - vc[0], ball.v[1] - vc[1], ball.v[2] - vc[2]]
  const vn = dot(rel, n)
  const pen = C.BALL_R - dist
  ball.p[0] += n[0] * pen; ball.p[1] += n[1] * pen; ball.p[2] += n[2] * pen
  if (vn > -1) return 0 // resting contact / separating: no impulse
  const j = (-(1 + C.BALL_RESTITUTION) * vn) / (1 / C.BALL_MASS + 1 / C.CAR_MASS)
  ball.v[0] += (n[0] * j) / C.BALL_MASS; ball.v[1] += (n[1] * j) / C.BALL_MASS; ball.v[2] += (n[2] * j) / C.BALL_MASS
  // arcade kick: push away from the car's centre, flattened along its up axis
  const up = qrot(car.q, [0, 1, 0])
  const du = dot(d, up)
  const h = [d[0] - up[0] * du * 0.65, d[1] - up[1] * du * 0.65, d[2] - up[2] * du * 0.65]
  const hl = len(h) || 1
  const relSp = len(rel)
  const extra = Math.min(relSp * C.BALL_HIT_EXTRA, C.BALL_HIT_EXTRA_MAX)
  ball.v[0] += (h[0] / hl) * extra; ball.v[1] += (h[1] / hl) * extra; ball.v[2] += (h[2] / hl) * extra
  return clamp(relSp / 45, 0.05, 1)
}
