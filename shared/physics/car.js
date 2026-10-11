// Car-only physics: driving, jumping, flipping, air control, boost, arena collision.
// No ball, no other cars, no events (sim.js diffs flags to make events). Mutates `car`.
import * as C from '../constants.js'
import { CARS, DEFAULT_CAR } from '../cars.js'
import { arenaDistance } from '../arena.js'
import { dot, cross, len, clamp, qrot, qintegrate, qfromto } from './math.js'

export const hitboxOf = (car) => (CARS[car.body] ?? CARS[DEFAULT_CAR]).hitbox

const sgn = (x) => (x < 0 ? -1 : 1)
const add = (a, b, k) => { a[0] += b[0] * k; a[1] += b[1] * k; a[2] += b[2] * k }

/** World position of a local-space point on the car. */
function toWorld(car, q, lx, ly, lz) {
  const r = qrot(q, [lx, ly, lz])
  return [car.p[0] + r[0], car.p[1] + r[1], car.p[2] + r[2]]
}

export function stepCar(car, input, dt) {
  if (car.demolished > 0) return car
  const [W, H, L] = hitboxOf(car)
  const q = car.q
  const fwd = qrot(q, [0, 0, 1])
  const up = qrot(q, [0, 1, 0])
  const right = cross(fwd, up)
  const v = car.v

  // ---- timers
  car.jumpT = (car.jumpT ?? 0) + dt
  if (car.dodgeT > 0) { car.dodgeT -= dt; if (car.dodgeT <= 0) { car.dodgeT = 0; car.dodging = false } }
  car.dodging = car.dodgeT > 0

  // ---- wheel contact probe (bottom corners)
  let contacts = 0
  const n = [0, 0, 0]
  for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
    const w = toWorld(car, q, sx * W * 0.5, -H * 0.5, sz * L * 0.4)
    const s = arenaDistance(w)
    if (s.d < (car.onGround ? C.WHEEL_STICKY : C.WHEEL_CONTACT)) { contacts++; add(n, s.n, 1) }
  }
  const jumpLaunch = car.jumped && car.jumpT < 0.1 // still leaving the ground
  let grounded = contacts > 0 && !jumpLaunch
  const nl = len(n)
  if (nl > 1e-6) { n[0] /= nl; n[1] /= nl; n[2] /= nl } else { n[0] = 0; n[1] = 1; n[2] = 0 }

  const wasGrounded = car.onGround
  if (grounded) {
    car.jumped = false; car.doubleJumped = false; car.dodgeT = 0; car.dodging = false; car.jumpT = 0
  } else if (wasGrounded && !car.jumped) { car.jumped = true; car.jumpT = 0 } // drove off a ledge: flip window starts now
  car.onGround = grounded
  car.onWall = grounded && n[1] < 0.75

  // ---- jump / double jump / dodge
  const pj = car.pj ?? input.jump
  car.pj = !!input.jump
  if (input.jump && !pj) {
    if (grounded) {
      add(v, up, C.JUMP_V); car.jumped = true; car.jumpT = 0; grounded = false; car.onGround = false; car.onWall = false
    } else if (car.jumped && !car.doubleJumped && car.jumpT < C.FLIP_WINDOW) {
      const f = -input.pitch, s = clamp(input.yaw + input.roll, -1, 1)
      const mag = Math.hypot(f, s)
      car.doubleJumped = true
      if (mag > C.DODGE_DEADZONE) {
        const hf = Math.hypot(fwd[0], fwd[2]) || 1, hr = Math.hypot(right[0], right[2]) || 1
        const dx = ((fwd[0] / hf) * f + (right[0] / hr) * s) / mag
        const dz = ((fwd[2] / hf) * f + (right[2] / hr) * s) / mag
        v[0] += dx * C.DODGE_IMPULSE; v[2] += dz * C.DODGE_IMPULSE
        v[1] *= 0.4
        const sp = C.DODGE_SPIN
        const a = clamp(-f, -1, 1) * sp, b = s * sp
        car.w = [right[0] * a + fwd[0] * b, right[1] * a + fwd[1] * b, right[2] * a + fwd[2] * b]
        car.dodgeT = C.DODGE_TIME; car.dodging = true
      } else add(v, up, C.JUMP_V)
    }
  }
  // holding jump lifts a little higher
  if (input.jump && car.jumped && !car.doubleJumped && car.jumpT < C.JUMP_HOLD_TIME && !grounded) add(v, up, C.JUMP_HOLD_ACCEL * dt)

  // ---- boost
  let boosting = false
  if (input.boost && car.boost > 0) {
    boosting = true
    car.boost = Math.max(0, car.boost - C.BOOST_DRAIN * dt)
  }
  car.boosting = boosting

  if (grounded) {
    // drive along the surface
    const fp = [fwd[0] - n[0] * dot(fwd, n), fwd[1] - n[1] * dot(fwd, n), fwd[2] - n[2] * dot(fwd, n)]
    const fl = len(fp) || 1
    fp[0] /= fl; fp[1] /= fl; fp[2] /= fl
    const rp = cross(fp, n)
    let vf = dot(v, fp), vl = dot(v, rp)
    // following a curve (floor -> wall) turns the velocity instead of crashing into it
    const sp0 = len(v), vn0 = dot(v, n)
    if (wasGrounded && vn0 < 0 && -vn0 < 0.5 * sp0) {
      const k = sp0 / (Math.hypot(vf, vl) || 1)
      if (k < 1.6) { vf *= k; vl *= k }
    }
    const thr = clamp(input.thr, -1, 1)
    if (thr !== 0) {
      if (vf * thr < -0.5) vf += sgn(thr) * C.CAR_BRAKE * Math.abs(thr) * dt
      else vf += sgn(thr) * C.CAR_DRIVE_ACCEL * (1 - clamp(Math.abs(vf) / C.CAR_DRIVE_MAX, 0, 1)) * Math.abs(thr) * dt
    } else if (!boosting) vf -= sgn(vf) * Math.min(Math.abs(vf), C.CAR_COAST * dt)
    if (boosting && Math.hypot(vf, vl) < C.CAR_BOOST_MAX_SPEED) vf += C.CAR_BOOST_ACCEL * dt
    if (input.handbrake) vf -= sgn(vf) * Math.min(Math.abs(vf), 3 * Math.abs(vf) * dt)
    vl *= Math.exp(-(input.handbrake ? C.CAR_SLIDE_GRIP : C.CAR_GRIP) * dt)
    v[0] = fp[0] * vf + rp[0] * vl; v[1] = fp[1] * vf + rp[1] * vl; v[2] = fp[2] * vf + rp[2] * vl
    // steering
    const sp = Math.abs(vf)
    const rate = C.CAR_TURN_LOW + (C.CAR_TURN_HIGH - C.CAR_TURN_LOW) * clamp(sp / C.CAR_BOOST_MAX_SPEED, 0, 1)
    const turn = clamp(input.steer, -1, 1) * rate * (input.handbrake ? 1.5 : 1) * clamp(sp / 1.5, 0.15, 1) * (vf < -0.5 ? -1 : 1)
    car.w = [-n[0] * turn, -n[1] * turn, -n[2] * turn]
    // settle onto the surface
    const ax = cross(up, n), s = len(ax), ang = Math.atan2(s, dot(up, n))
    if (s > 1e-6 && ang > 1e-4) qintegrate(q, [ax[0] / s, ax[1] / s, ax[2] / s], ang * Math.min(1, 45 * dt))
  } else {
    v[1] -= C.GRAVITY * dt
    if (boosting && len(v) < C.CAR_BOOST_MAX_SPEED) add(v, fwd, C.CAR_BOOST_ACCEL * dt)
    if (!car.dodging) {
      const w = car.w
      const ctl = (axis, target, active) => {
        const c = dot(w, axis)
        const c2 = active ? c + (target - c) * Math.min(1, C.AIR_RESPONSE * dt) : c * Math.exp(-C.AIR_DAMP * dt)
        add(w, axis, c2 - c)
      }
      ctl(right, input.pitch * C.AIR_PITCH, Math.abs(input.pitch) > 0.05)
      ctl([-up[0], -up[1], -up[2]], input.yaw * C.AIR_YAW, Math.abs(input.yaw) > 0.05)
      ctl(fwd, input.roll * C.AIR_ROLL, Math.abs(input.roll) > 0.05)
    }
  }

  // clamp speed
  const sp = len(v)
  if (sp > 46) { v[0] *= 46 / sp; v[1] *= 46 / sp; v[2] *= 46 / sp }
  const supersonic = sp >= (car.supersonic ? C.CAR_SUPERSONIC_OFF : C.CAR_SUPERSONIC)
  car.supersonic = supersonic

  // ---- integrate
  add(car.p, v, dt)
  qintegrate(q, car.w, dt)

  // ---- arena collision with the 8 hitbox corners
  let roofN = null
  for (let it = 0; it < 2; it++) {
    let worst = 0, wn = null
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const s = arenaDistance(toWorld(car, q, sx * W * 0.5, sy * H * 0.5, sz * L * 0.5))
      if (s.d < worst) { worst = s.d; wn = s.n }
    }
    if (!wn) break
    if (!grounded && it === 0 && wn[1] > 0.5) roofN = wn
    add(car.p, wn, -worst)
    const vn = dot(v, wn)
    if (vn < 0) {
      const spB = len(v)
      add(v, wn, -vn * (1 + (grounded ? 0 : 0.2)))
      if (grounded && -vn < 0.6 * spB) { // riding into a curve: turn, don't crash
        const k = spB / (len(v) || 1)
        if (k < 1.8) { v[0] *= k; v[1] *= k; v[2] *= k }
      }
    }
    if (!grounded) { car.w[0] *= 0.9; car.w[1] *= 0.9; car.w[2] *= 0.9 }
  }
  // resting on roof/side: grind to a halt and roll back onto the wheels
  if (roofN) {
    const f = Math.exp(-3 * dt)
    v[0] *= f; v[2] *= f
    const u = qrot(q, [0, 1, 0]), ax = cross(u, roofN), s = len(ax), ang = Math.atan2(s, dot(u, roofN))
    if (s > 1e-6) qintegrate(q, [ax[0] / s, ax[1] / s, ax[2] / s], ang * Math.min(1, 2.5 * dt))
    car.w[0] = car.w[1] = car.w[2] = 0
  }
  return car
}
