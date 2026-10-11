// Bot driver: botInput(state, car) -> input. Pure and deterministic; per-bot variation comes
// from a hash of car.id; the only memory is car.botMem (plain JSON).
import { ARENA, BOOST_PADS } from './arena.js'
import * as C from './constants.js'

const BALL_R = C.BALL_R ?? 1.85
const HL = ARENA?.halfLength ?? 51
const HW = ARENA?.halfWidth ?? 41
const GOAL_HW = ARENA?.goal?.halfWidth ?? 9
const G = C.GRAVITY ?? 18

const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v)
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }
const rot = (q, v) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx)
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx]
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l] }

const out = (o) => ({ thr: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false, ...o })

function predictBall(ball, t) {
  let y = ball.p[1] + ball.v[1] * t - 0.5 * G * t * t
  let vy = ball.v[1] - G * t
  if (y < BALL_R) { y = BALL_R + Math.abs(y - BALL_R) * 0.6 ; vy = Math.abs(vy) * 0.6 }
  const cl = (v, m) => Math.max(-m, Math.min(m, v))
  return [cl(ball.p[0] + ball.v[0] * t, HW - BALL_R), y, cl(ball.p[2] + ball.v[2] * t, HL + 6)]
}

// Orient the nose toward world direction d (and keep the roof up) while airborne.
function airControl(car, d, wantBoostCone = 0.25) {
  const fwd = rot(car.q, [0, 0, 1]), up = rot(car.q, [0, 1, 0])
  const right = cross(fwd, up)
  const l = Math.hypot(d[0], d[1], d[2]) || 1
  const dl = [dot(d, right) / l, dot(d, up) / l, dot(d, fwd) / l]
  const behind = dl[2] < 0
  return {
    yaw: clamp(dl[0] * 4 + (behind ? Math.sign(dl[0] || 1) : 0)),
    pitch: clamp(dl[1] * 4 + (behind ? Math.sign(dl[1] || 1) : 0)),
    roll: clamp(dot(up, right) * 4),
    aligned: dl[2] > 1 - wantBoostCone,
  }
}

export function botInput(state, car) {
  if (car.demolished > 0) return out({})
  const mem = car.botMem || (car.botMem = {})
  const h = hash(String(car.id))
  const skill = 0.85 + (h & 255) / 255 * 0.3 // 0.85..1.15
  const aimNoise = (((h >>> 8) & 255) / 255 - 0.5) * 1.5
  const s = car.team === 0 ? 1 : -1 // attack direction along Z
  const goal = [0, s * HL] // enemy goal centre (x,z)
  const own = [0, -s * HL]
  const me = car.p, ball = state.ball
  const fwd3 = rot(car.q, [0, 0, 1]), up3 = rot(car.q, [0, 1, 0])
  const right3 = cross(fwd3, up3)
  const speed = Math.hypot(car.v[0], car.v[2])
  const dBall = Math.hypot(ball.p[0] - me[0], ball.p[2] - me[2])
  const playing = state.phase === 'play' || state.phase === 'countdown'

  // ---- airborne
  if (!car.onGround && !car.onWall) {
    // dodge sequence in flight
    if (mem.dg > 0) {
      mem.dg++
      if (mem.dg === 6) { mem.dg = 0; return out({ jump: true, pitch: -1, boost: false }) }
      return out({ pitch: 0, jump: false })
    }
    const t = clamp(dBall / Math.max(speed + 10, 15), 0.1, 1.5)
    const tgt = mem.aer ? predictBall(ball, t) : null
    if (tgt) {
      const a = airControl(car, [tgt[0] - me[0], tgt[1] - me[1], tgt[2] - me[2]])
      return out({ yaw: a.yaw, pitch: a.pitch, roll: a.roll, boost: a.aligned && car.boost > 3 && tgt[1] > me[1] - 1 })
    }
    // recover: nose along velocity (horizontal), roof up
    const d = [car.v[0], Math.max(-2, car.v[1] * 0.3), car.v[2]]
    const a = airControl(car, speed > 3 ? d : [fwd3[0], 0, fwd3[2]])
    return out({ yaw: a.yaw * 0.5, pitch: a.pitch, roll: a.roll })
  }
  mem.aer = 0
  if (mem.dg > 0) mem.dg = 0

  // flipped on the ground: pop and spin
  if (car.onGround && up3[1] < -0.3) return out({ jump: !car.jumped, roll: 1, thr: 1 })

  // ---- roles
  const mates = state.cars.filter((c) => c.team === car.team && c.demolished <= 0)
  const eta = (c) => Math.hypot(ball.p[0] - c.p[0], ball.p[2] - c.p[2]) + ((hash(String(c.id)) & 15) * 0.05)
  const myEta = eta(car)
  const attacker = mates.every((c) => c === car || eta(c) >= myEta)
  const depth = (c) => c.p[2] * s
  const lastBack = mates.every((c) => c === car || depth(c) >= depth(car) - 0.01)
  const ballDepth = ball.p[2] * s
  const kickoff = Math.hypot(ball.p[0], ball.p[2]) < 1.5 && Math.hypot(ball.v[0], ball.v[2]) < 0.5

  // ---- target selection (xz)
  let tx, tz, wantBoost = false, urgent = attacker
  const tLead = clamp(dBall / Math.max(speed + 12, 18), 0, 1.2) * skill
  const bp = kickoff ? ball.p : predictBall(ball, tLead)
  const shot = norm2(goal[0] - bp[0], goal[1] - bp[2])

  if (attacker && !(lastBack && ballDepth < -HL * 0.45 && mates.length > 1 && false)) {
    const toBall = norm2(bp[0] - me[0], bp[2] - me[2])
    const aligned = toBall[0] * shot[0] + toBall[1] * shot[1]
    const off = BALL_R + (aligned > 0.6 ? 0 : clamp(dBall * 0.35, 3, 9))
    if (kickoff || aligned > 0.6 || dBall < 7) { tx = bp[0] - shot[0] * 0.6 + aimNoise * 0.3; tz = bp[2] - shot[1] * 0.6 }
    else { tx = bp[0] - shot[0] * off; tz = bp[2] - shot[1] * off }
    // keep the approach point inside the field
    tx = clamp(tx, -HW + 3, HW - 3); tz = clamp(tz, -HL + 3, HL - 3)
    wantBoost = true
  } else {
    // support / defend: sit between ball and own goal, further back the deeper the ball is on our side
    const back = ballDepth < 0 ? 0.25 : 0.55
    tx = own[0] + (bp[0] - own[0]) * 0.5
    tz = own[1] + (bp[2] - own[1]) * back
    if (lastBack && ballDepth < -HL * 0.2) { tz = own[1] * 0.75; tx = bp[0] * 0.3 }
    if (kickoff) { tz = own[1] * 0.45; tx = 0 }
    tx = clamp(tx, -GOAL_HW - 8, GOAL_HW + 8)
    urgent = false
  }

  // ---- boost pads when low and not in the thick of it
  if (BOOST_PADS && (!attacker || dBall > 35) && car.boost < 30 && !kickoff) {
    let best = null, bd = 1e9
    BOOST_PADS.forEach((p, i) => {
      if (state.pads && state.pads[i] === false) return
      if (!p.big && car.boost > 15) return
      const d = Math.hypot(p.p[0] - me[0], p.p[2] - me[2]) - (p.big ? 12 : 0)
      if (d < bd) { bd = d; best = p }
    })
    if (best && bd < 45) { tx = best.p[0]; tz = best.p[2]; urgent = false; wantBoost = false }
  }

  // ---- steering
  const dx = tx - me[0], dz = tz - me[2]
  const dist = Math.hypot(dx, dz)
  const err = Math.atan2(dx * right3[0] + dz * right3[2], dx * fwd3[0] + dz * fwd3[2]) // + = target to the right
  const steer = clamp(err * 2.2)
  const ae = Math.abs(err)
  let thr = 1
  let boost = false
  let handbrake = ae > 1.1 && speed > 9 && dist > 6
  // target behind and close: back up toward it
  if (ae > 2.4 && dist < 12 && !urgent) { thr = -1 }
  if (!urgent && dist < 6) thr = clamp((dist - 2) * 0.4 - speed * 0.06, -0.5, 0.6)
  if (wantBoost || kickoff) boost = ae < 0.22 && (dist > 10 || kickoff) && car.boost > 4
  if (!urgent && !wantBoost && ae < 0.2 && dist > 25 && car.boost > 40) boost = true
  if (speed > (C.CAR_BOOST_MAX_SPEED ?? 34) - 2) boost = false

  // ---- jumps: aerial / dodge at the ball
  let jump = false, pitch = 0
  const bh = ball.p[1]
  const flat = dBall
  const ballAhead = (ball.p[0] - me[0]) * fwd3[0] + (ball.p[2] - me[2]) * fwd3[2] > 0
  if (playing && car.onGround && attacker && ballAhead) {
    const ballErr = Math.atan2((ball.p[0] - me[0]) * right3[0] + (ball.p[2] - me[2]) * right3[2], (ball.p[0] - me[0]) * fwd3[0] + (ball.p[2] - me[2]) * fwd3[2])
    if (bh > 5 && flat < 16 && flat > 3 && Math.abs(ballErr) < 0.5 && car.boost > 15) {
      jump = true; mem.aer = 1 // aerial: jump now, steer in the air
    } else if (bh < 5 && flat < 7.5 && Math.abs(ballErr) < 0.3 && speed > 8 && (kickoff || ae < 0.35)) {
      jump = true; mem.dg = 1 // dodge: jump now, flip a few ticks later
    }
  }
  if (jump) { thr = 1; boost = false }
  // stuck recovery: barely moving while meant to be going somewhere -> back out, then hop
  mem.st = state.phase === 'play' && speed < 1.5 && dist > 5 ? (mem.st || 0) + 1 : 0
  if (mem.st > 40 || mem.rv > 0) {
    mem.rv = mem.rv > 0 ? mem.rv - 1 : 50
    if (mem.st > 40) mem.st = 0
    return out({ thr: -1, steer: -steer, jump: mem.rv === 1 })
  }
  return out({ thr, steer, jump, boost, handbrake, pitch })
}
