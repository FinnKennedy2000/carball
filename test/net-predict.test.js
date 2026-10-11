import test from 'node:test'
import assert from 'node:assert/strict'
import {
  slerp, interpolate, createBuffer, pushSnapshot, sampleBuffer, createEventQueue, acceptEvents,
  releaseEvents, createRtt, noteSent, noteAck, createPredictor,
} from '../client/predict.js'

const st = (tick, x, id = 'a') => ({
  tick, phase: 'play',
  ball: { p: [x, 0, 0], v: [60, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0] },
  cars: [{ id, p: [x, 0, 0], v: [60, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0], boost: 0, demolished: 0 }],
})

test('slerp halfway between identity and 90deg about y', () => {
  const h = Math.SQRT1_2
  const q = slerp([0, 0, 0, 1], [0, h, 0, h], 0.5)
  const a = Math.sin(Math.PI / 8)
  assert.ok(Math.abs(q[1] - a) < 1e-9 && Math.abs(q[3] - Math.cos(Math.PI / 8)) < 1e-9)
  // shortest arc: -q is the same rotation
  const r = slerp([0, 0, 0, 1], [0, -h, 0, -h], 0.5)
  assert.ok(r[3] > 0.9)
})

test('interpolate blends bodies, keeps older discrete fields', () => {
  const a = st(0, 0), b = st(6, 6); b.phase = 'goal'
  const m = interpolate(a, b, 0.5)
  assert.equal(m.phase, 'play')
  assert.equal(m.cars[0].p[0], 3)
  assert.equal(m.ball.p[0], 3)
})

test('buffer: interpolates on the host timeline, extrapolates briefly, ignores dupes/late', () => {
  const buf = createBuffer()
  assert.equal(pushSnapshot(buf, st(0, 0), 1000), true)
  assert.equal(pushSnapshot(buf, st(6, 6), 1100), true) // 100 ms of host time
  assert.equal(pushSnapshot(buf, st(6, 6), 1105), false)
  assert.equal(pushSnapshot(buf, st(3, 3), 1110), false)
  // offset=1000; now=1150 delay=100 -> rt=50ms -> halfway
  assert.equal(sampleBuffer(buf, 1150, 100).state.cars[0].p[0], 3)
  // starved: rt=150ms (50 past newest) -> 50ms of velocity extrapolation = 3 m
  assert.ok(Math.abs(sampleBuffer(buf, 1250, 100).state.cars[0].p[0] - 9) < 1e-9)
  // starved far longer: extrapolation capped at 150 ms
  assert.ok(Math.abs(sampleBuffer(buf, 5000, 100).state.cars[0].p[0] - 15) < 1e-9)
  assert.equal(sampleBuffer(createBuffer(), 0), null)
})

test('buffer: jitter does not move playback; tick regression resets', () => {
  const buf = createBuffer()
  pushSnapshot(buf, st(0, 0), 1000)
  pushSnapshot(buf, st(6, 6), 1160) // late by 60 ms: offset stays at the fast one
  assert.ok(buf.offset < 1002)
  pushSnapshot(buf, st(200, 9), 5000)
  pushSnapshot(buf, st(1, 0), 5100)
  assert.equal(buf.snaps.length, 1)
})

test('events dedupe by id and release on render tick', () => {
  const q = createEventQueue()
  acceptEvents(q, [{ id: 1, tick: 10 }, { id: 2, tick: 20 }])
  acceptEvents(q, [{ id: 2, tick: 20 }, { id: 3, tick: 30 }, { id: 1, tick: 10 }])
  assert.deepEqual(releaseEvents(q, 15).map((e) => e.id), [1])
  assert.deepEqual(releaseEvents(q, 15), [])
  acceptEvents(q, [{ id: 3, tick: 30 }]) // already seen
  assert.deepEqual(releaseEvents(q).map((e) => e.id), [2, 3])
  assert.deepEqual(releaseEvents(q), [])
})

test('rtt only learns from newly acked seqs', () => {
  const r = createRtt()
  noteSent(r, 1, 1000)
  const a = noteAck(r, 1, 1200)
  assert.ok(a > 100 && a < 200)
  assert.equal(noteAck(r, 1, 9999), a)
})

test('predictor: steps with input, blends toward authority, snaps on big error', () => {
  const stepCar = (c, input, dt) => { c.p[0] += input.thr * 10 * dt; return c }
  const p = createPredictor(stepCar, { blend: 0.5, snapDist: 3 })
  const auth = (x) => ({ id: 'a', p: [x, 0, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0], demolished: 0 })
  assert.equal(p.advance(0.1, { thr: 1 }), null)
  p.correct(auth(0), 0, { thr: 1 })
  p.advance(1, { thr: 1 }) // clamped to 0.1 s of catch-up -> ~1 m
  assert.ok(Math.abs(p.car.p[0] - 1) < 0.2)
  const before = p.car.p[0]
  p.correct(auth(0), 0, { thr: 1 })
  assert.ok(Math.abs(p.car.p[0] - before / 2) < 1e-9)
  p.correct(auth(50), 0, { thr: 1 })
  assert.equal(p.car.p[0], 50)
  // latency advances the target under the current input: 6 ticks of thr=1 -> +1 m
  const p2 = createPredictor(stepCar)
  p2.correct(auth(0), 0, { thr: 0 })
  p2.correct(auth(0), 0.1, { thr: 1 })
  assert.ok(Math.abs(p2.car.p[0] - 0.3 * 1.0) < 0.31)
})

test('acceptEvents caps the queue and rejects absurd ids and ticks', () => {
  const q = createEventQueue()
  acceptEvents(q, [{ id: 10, tick: 0 }]) // first event may be any id (late join)
  acceptEvents(q, [{ id: 99999, tick: 0 }, { id: 12, tick: 5000 }], 100)
  assert.equal(q.pending.length, 1)
  for (let i = 0; i < 400; i++) acceptEvents(q, [{ id: 11 + i, tick: 0 }])
  assert.equal(q.pending.length, 256)
})

test('pushSnapshot resets the event queue on host restart', () => {
  const buf = createBuffer(), q = createEventQueue()
  pushSnapshot(buf, st(1000, 0), 0, q)
  acceptEvents(q, [{ id: 50, tick: 0 }])
  pushSnapshot(buf, st(5, 0), 10, q)
  assert.equal(q.lastId, -1)
})

test('predictor render offset decays smoothly after a correction', () => {
  const step = (c) => { c.p[0] += 0; return c }
  const p = createPredictor(step, { blend: 0.5 })
  const car = (x) => ({ p: [x, 0, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0], demolished: 0 })
  p.correct(car(0), 0, {}, {})
  p.correct(car(1), 0, {}, {})
  assert.ok(Math.abs(p.advance(0, {}, {}).p[0]) < 1e-9) // drawn where it was
  assert.ok(Math.abs(p.advance(0.1, {}, {}).p[0] - 0.316) < 0.01)
})
