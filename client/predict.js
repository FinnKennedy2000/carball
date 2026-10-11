// Pure client-side maths: snapshot interpolation, event dedupe, own-car prediction.
// No DOM, no network, no imports from the sim (stepCar is injected), so all of it
// runs under node --test.
//
// PREDICTION CHOICE (documented as the contract asked): a full rewind-and-replay
// reconcile is not possible because the ball and other cars only exist on the host,
// so a car's path depends on collisions the client cannot see. Instead the client
// steps its own car with stepCar() and local input every tick (zero input lag),
// and on each snapshot takes the host's version of that car, advances it by the
// measured one-way latency under the current input (so both are "now"), and pulls
// the predicted car toward it by a fraction. A big error (demo, kickoff reset,
// hard collision) snaps. The ball and everyone else are interpolated, ~100 ms old.

const TICK_HZ = 60
const MAX_EXTRAP_MS = 150

export const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Shortest-arc spherical interpolation of unit quaternions [x,y,z,w]. */
export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  let s = 1
  if (d < 0) { d = -d; s = -1 }
  let ka, kb
  if (d > 0.9995) {
    ka = 1 - t
    kb = t * s
  } else {
    const th = Math.acos(d)
    const sn = Math.sin(th)
    ka = Math.sin((1 - t) * th) / sn
    kb = (Math.sin(t * th) / sn) * s
  }
  const x = ka * a[0] + kb * b[0], y = ka * a[1] + kb * b[1], z = ka * a[2] + kb * b[2], w = ka * a[3] + kb * b[3]
  const n = Math.hypot(x, y, z, w) || 1
  return [x / n, y / n, z / n, w / n]
}

export function lerpBody(a, b, t) {
  return { p: lerp3(a.p, b.p, t), v: lerp3(a.v, b.v, t), q: slerp(a.q, b.q, t), w: lerp3(a.w, b.w, t) }
}

/** Blend two states. Discrete fields (phase, score, clock) come from the older one. */
export function interpolate(a, b, t) {
  const byId = new Map(a.cars.map((c) => [c.id, c]))
  return {
    ...a,
    ball: { ...b.ball, ...lerpBody(a.ball, b.ball, t) },
    cars: b.cars.map((cb) => {
      const ca = byId.get(cb.id)
      if (!ca) return cb
      return { ...(t < 0.5 ? ca : cb), ...lerpBody(ca, cb, t), boost: lerp(ca.boost, cb.boost, t) }
    }),
  }
}

/** Dead-reckon a state forward `dt` seconds along its velocities. Used briefly when starved. */
export function extrapolate(s, dt) {
  const adv = (o) => ({ ...o, p: [o.p[0] + o.v[0] * dt, o.p[1] + o.v[1] * dt, o.p[2] + o.v[2] * dt] })
  return { ...s, ball: adv(s.ball), cars: s.cars.map((c) => (c.demolished > 0 ? c : adv(c))) }
}

// ---------- snapshot buffer ----------
//
// Snapshots are placed on the HOST's timeline (tick / 60) rather than by arrival
// time, so jittery delivery does not jitter playback. `offset` maps host time to
// local time: it jumps down to the fastest delivery seen and creeps up slowly,
// which also absorbs clock drift.

export function createBuffer(max = 24) {
  return { snaps: [], offset: null, max }
}

export function pushSnapshot(buf, state, recvAt, events = null) {
  const last = buf.snaps[buf.snaps.length - 1]
  if (last && state.tick <= last.state.tick) {
    if (state.tick === last.state.tick) return false // duplicate
    if (last.state.tick - state.tick > TICK_HZ) { buf.snaps.length = 0; buf.offset = null; if (events) { events.lastId = -1; events.pending.length = 0 } } // host restarted
    else return false // late and out of order
  }
  const t = (state.tick * 1000) / TICK_HZ
  const o = recvAt - t
  buf.offset = buf.offset === null || o < buf.offset ? o : buf.offset + (o - buf.offset) * 0.02
  buf.snaps.push({ t, state })
  while (buf.snaps.length > buf.max) buf.snaps.shift()
  return true
}

/** The state to draw at local time nowMs, `delayMs` in the past. Returns {state, tick} or null. */
export function sampleBuffer(buf, nowMs, delayMs = 100) {
  const { snaps } = buf
  if (snaps.length === 0) return null
  const rt = nowMs - buf.offset - delayMs
  const tick = (rt * TICK_HZ) / 1000
  const first = snaps[0], last = snaps[snaps.length - 1]
  if (rt <= first.t) return { state: first.state, tick }
  if (rt >= last.t) {
    const ahead = Math.min(rt - last.t, MAX_EXTRAP_MS)
    return { state: ahead > 0 ? extrapolate(last.state, ahead / 1000) : last.state, tick }
  }
  let i = snaps.length - 1
  while (snaps[i - 1].t > rt) i--
  const a = snaps[i - 1], b = snaps[i]
  return { state: interpolate(a.state, b.state, (rt - a.t) / (b.t - a.t)), tick }
}

// ---------- events ----------

/**
 * Events arrive piggybacked on snapshots and may repeat (retransmit, overlap).
 * Ids are monotone, so a high-water mark dedupes. Events are held until the
 * render clock reaches their tick so effects line up with the delayed picture.
 */
export function createEventQueue() {
  return { lastId: -1, pending: [] }
}

const MAX_PENDING = 256
const MAX_ID_JUMP = 5000
const MAX_TICK_AHEAD = 600

/** `latestTick` (newest snapshot tick) bounds how far ahead an event may claim to be. */
export function acceptEvents(q, events, latestTick = Infinity) {
  for (const e of events) {
    if (e.id <= q.lastId || (q.lastId >= 0 && e.id > q.lastId + MAX_ID_JUMP) || e.tick > latestTick + MAX_TICK_AHEAD) continue
    if (q.pending.length >= MAX_PENDING) q.pending.shift()
    q.lastId = e.id
    q.pending.push(e)
  }
}

/** Remove and return events due at renderTick (Infinity releases everything). */
export function releaseEvents(q, renderTick = Infinity) {
  let n = 0
  while (n < q.pending.length && q.pending[n].tick <= renderTick) n++
  return q.pending.splice(0, n)
}

// ---------- RTT ----------

export function createRtt() {
  return { sent: new Map(), lastAck: -1, ms: 100 }
}
export function noteSent(r, seq, now) {
  r.sent.set(seq, now)
  if (r.sent.size > 64) r.sent.delete(r.sent.keys().next().value)
}
/** Call with each snapshot's ack for us. Only a newly acked seq carries timing. */
export function noteAck(r, seq, now, snapIntervalMs = 66) {
  if (seq === r.lastAck || !r.sent.has(seq)) return r.ms
  r.lastAck = seq
  const sample = Math.max(0, now - r.sent.get(seq) - snapIntervalMs / 2)
  r.ms += (sample - r.ms) * 0.25
  return r.ms
}

// ---------- own-car prediction ----------

const clone = (c) => ({ ...c, p: [...c.p], v: [...c.v], q: [...c.q], w: [...c.w] })

/**
 * stepCar(car, input, dt, state) mutates (or returns) a car. `blend` is the share
 * of the error removed per snapshot; errors above `snapDist` metres snap.
 */
export function createPredictor(stepCar, { dt = 1 / TICK_HZ, blend = 0.3, snapDist = 3, maxLatencyS = 0.3 } = {}) {
  let car = null
  let acc = 0
  const off = [0, 0, 0] // render-only position error, decays smoothly instead of stepping at each snapshot
  const step = (c, input, state) => stepCar(c, input, dt, state) ?? c

  return {
    get car() { return car },
    reset() { car = null; acc = 0; off[0] = off[1] = off[2] = 0 },
    /** Advance by frame time with local input. Returns the predicted car (or null before the first snapshot). */
    advance(frameDt, input, state) {
      if (!car) return null
      const k = Math.exp(-frameDt * 10)
      off[0] *= k; off[1] *= k; off[2] *= k
      acc = Math.min(acc + frameDt, 0.1)
      while (acc >= dt) { car = step(car, input, state); acc -= dt }
      return { ...car, p: [car.p[0] + off[0], car.p[1] + off[1], car.p[2] + off[2]] }
    },
    /** Fold in the host's version of our car. `latencyS` = estimated one-way time. */
    correct(auth, latencyS, input, state) {
      if (!auth) return
      if (!car || auth.demolished > 0 || car.demolished > 0) { car = clone(auth); off[0] = off[1] = off[2] = 0; return }
      let target = clone(auth)
      const n = Math.min(Math.round(Math.min(latencyS, maxLatencyS) / dt), 30)
      for (let i = 0; i < n; i++) target = step(target, input, state)
      const err = Math.hypot(target.p[0] - car.p[0], target.p[1] - car.p[1], target.p[2] - car.p[2])
      if (err > snapDist) { car = { ...target }; off[0] = off[1] = off[2] = 0; return }
      const was = car.p
      car = {
        ...target, // discrete flags, boost, stats are authoritative
        p: lerp3(car.p, target.p, blend),
        v: lerp3(car.v, target.v, blend),
        q: slerp(car.q, target.q, blend),
        w: lerp3(car.w, target.w, blend),
      }
      for (let i = 0; i < 3; i++) off[i] += was[i] - car.p[i] // keep what is drawn where it was
    },
  }
}
