import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parse, quantizeInput, dequantizeInput, inputChanged, encodeSnapshot, decodeSnapshot,
  cleanCode, cleanName, parseRoster, cleanEvent,
} from '../shared/protocol.js'

const body = (x) => ({ p: [x, 1.234, -3.5], v: [10.55, 0, -22], q: [0, 0.7071, 0, 0.7071], w: [0, 1.5, 0] })
const car = (id) => ({
  id, ...body(5), boost: 42.4, onGround: true, onWall: false, boosting: true, supersonic: false,
  dodging: false, jumped: true, doubleJumped: false, demolished: 0,
  stats: { score: 100, goals: 1, assists: 0, saves: 2, shots: 3, demos: 0 },
})
const state = () => ({
  tick: 1234, phase: 'play', phaseT: 2.5, clock: 187.34, overtime: false, score: [2, 1], teamSize: 3,
  ball: body(0), cars: [car('p1'), car('bot-1')], pads: [true, false, true], lastTouch: 'p1',
})

test('input quantization round-trips within 1/127', () => {
  const i = { thr: 1, steer: -0.5, pitch: 0.3, yaw: 0, roll: -1, jump: true, boost: false, handbrake: true }
  const d = dequantizeInput(quantizeInput(i))
  for (const k of ['thr', 'steer', 'pitch', 'yaw', 'roll']) assert.ok(Math.abs(d[k] - i[k]) <= 1 / 127)
  assert.deepEqual([d.jump, d.boost, d.handbrake], [true, false, true])
  assert.deepEqual(quantizeInput({ thr: 9, steer: NaN, pitch: -9, yaw: 0, roll: 0 }).a.slice(0, 3), [127, 0, -127])
})

test('inputChanged: deadband but exact on buttons and return-to-rest', () => {
  const a = quantizeInput({ steer: 0.5 })
  assert.equal(inputChanged(a, quantizeInput({ steer: 0.51 })), false)
  assert.equal(inputChanged(a, quantizeInput({ steer: 0.6 })), true)
  assert.equal(inputChanged(a, quantizeInput({ steer: 0, jump: false })), true)
  assert.equal(inputChanged(quantizeInput({ steer: 0.01 }), quantizeInput({})), true)
  assert.equal(inputChanged(a, quantizeInput({ steer: 0.5, boost: true })), true)
})

test('parse validates peer messages', () => {
  const q = quantizeInput({ thr: 1 })
  assert.deepEqual(parse({ t: 'input', cid: 'x', seq: 3, ...q }), { t: 'input', cid: 'x', seq: 3, ...q })
  for (const bad of [
    null, [], { t: 'input', cid: 'x', seq: -1, ...q }, { t: 'input', cid: 'x', seq: 1, a: [0, 0, 0, 0, 200], b: 0 },
    { t: 'input', cid: 'x', seq: 1, a: [0, 0, 0], b: 0 }, { t: 'input', cid: 'x', seq: 1, a: q.a, b: 99 },
    { t: 'input', seq: 1, ...q }, { t: 'nope', cid: 'x' },
  ]) assert.equal(parse(bad), null)
  assert.equal(parse({ t: 'hello', cid: 'x', name: 'A\u0000B   C', team: 7, body: '../x' }).name, 'AB C')
  assert.equal(parse({ t: 'hello', cid: 'x', name: 'n', team: 7, body: '../x' }).team, null)
  assert.equal(parse({ t: 'hello', cid: 'x', name: 'n', body: '../x' }).body, null)
})

test('decoded events are whitelisted and sanitised', () => {
  const ev = [
    { id: 1, type: 'goal', tick: 5, team: 0, p: [1, 2, 3], scorerId: 'p1' },
    { id: 2, type: '<script>', tick: 5 },
    { id: 3, type: 'hit', tick: 5, carId: '<img onerror=x>', strength: 0.5, evil: { a: 1 }, p: [1, 'x', 3] },
    { id: 4, type: 'hit', tick: NaN },
  ]
  const { events } = decodeSnapshot(encodeSnapshot(state(), {}, ev))
  assert.deepEqual(events.map((e) => e.id), [1, 3])
  assert.equal(events[1].carId, undefined)
  assert.equal(events[1].evil, undefined)
  assert.equal(events[1].p, undefined)
  assert.equal(events[1].strength, 0.5)
})

test('cleaners', () => {
  assert.equal(cleanCode(' abcd '), 'ABCD')
  assert.equal(cleanCode('abc'), null)
  assert.equal(cleanName('x'.repeat(40)).length, 16)
  assert.equal(parseRoster({ players: [{ id: 'bad id', name: 'a' }] }), null)
})

test('snapshot round-trip within quantization error, JSON-safe, compact', () => {
  const s = state()
  const ev = [{ id: 7, type: 'goal', tick: 1230, team: 0, speed: 71.23456, p: [1.23456, 2, 3] }]
  const wire = JSON.parse(JSON.stringify(encodeSnapshot(s, { p1: 9 }, ev)))
  const { state: d, acks, events } = decodeSnapshot(wire)
  assert.equal(d.tick, 1234)
  assert.equal(d.phase, 'play')
  assert.deepEqual(d.score, [2, 1])
  assert.deepEqual(d.pads, [true, false, true])
  assert.equal(d.lastTouch, 'p1')
  assert.ok(Math.abs(d.cars[0].p[1] - 1.234) < 0.006)
  assert.ok(Math.abs(d.cars[0].v[0] - 10.55) < 0.006)
  assert.ok(Math.abs(d.cars[0].q[1] - 0.7071) < 1e-3)
  assert.ok(Math.abs(d.clock - 187.34) < 0.006)
  assert.equal(d.cars[0].boosting, true)
  assert.equal(d.cars[0].onWall, false)
  assert.equal(d.cars[0].stats.saves, 2)
  assert.equal(acks.p1, 9)
  assert.equal(acks['bot-1'], 0)
  assert.equal(events[0].speed, 71.23)
  assert.ok(JSON.stringify(wire).length < 1200)
})

test('decodeSnapshot rejects garbage', () => {
  const wire = encodeSnapshot(state())
  assert.equal(decodeSnapshot(null), null)
  assert.equal(decodeSnapshot([]), null)
  assert.equal(decodeSnapshot(wire.slice(0, 5)), null)
  const bad = structuredClone(wire); bad[12][0][3] = 'x'
  assert.equal(decodeSnapshot(bad), null)
  const bad2 = structuredClone(wire); bad2[0] = 99
  assert.equal(decodeSnapshot(bad2), null)
})

test('cleanEvent clamps numeric fields and keeps nulls', () => {
  const e = cleanEvent({ id: 1, type: 'hit', tick: 5, strength: 9, speed: 1e6, n: 99, team: 7, pad: 500 })
  assert.deepEqual([e.strength, e.speed, e.n, e.team], [1, 400, 3, 0])
  assert.ok(e.pad <= 40 && e.pad >= 0 && cleanEvent({ id: 1, type: 'boostPickup', tick: 1, pad: -4 }).pad === 0)
  const g = cleanEvent({ id: 2, type: 'goal', tick: 1, scorerId: null, assistId: 'p1' })
  assert.equal(g.scorerId, null)
  assert.equal(g.assistId, 'p1')
})

test('decodeSnapshot validates teamSize, lastTouch and ranges', () => {
  const w = encodeSnapshot(state())
  for (const [i, v] of [[8, 9], [11, 'bad id!'], [3, -5], [4, 1e12]]) {
    const bad = structuredClone(w); bad[i] = v
    assert.equal(decodeSnapshot(bad), null, `index ${i}`)
  }
})
