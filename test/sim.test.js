import test from 'node:test'
import assert from 'node:assert/strict'
import * as C from '../shared/constants.js'
import { createMatch, addPlayer, removePlayer, setInput, step, startMatch, fillBots, snapshot, stepCar, NEUTRAL_INPUT } from '../shared/sim.js'
import { ARENA, BOOST_PADS, arenaDistance, inGoal } from '../shared/arena.js'
import { CARS, DEFAULT_CAR } from '../shared/cars.js'

const I = (o) => ({ ...NEUTRAL_INPUT, ...o })
const run = (s, n) => { for (let i = 0; i < n; i++) step(s) }
function play1() { // one car, in 'play'
  const s = createMatch({ teamSize: 1, seed: 7 })
  addPlayer(s, { id: 'a', name: 'A', team: 0 })
  startMatch(s); run(s, 200)
  assert.equal(s.phase, 'play')
  return s
}
const finite = (s) => JSON.stringify(snapshot(s), (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v)).indexOf('"NaN"') < 0

test('arena helpers', () => {
  assert.ok(arenaDistance([0, 5, 0]).d > 4)
  assert.ok(arenaDistance([0, 0, 0]).d < 0.01)
  assert.equal(inGoal([0, 2, -ARENA.halfLength - 3], C.BALL_R), 0)
  assert.equal(inGoal([0, 2, ARENA.halfLength + 3], C.BALL_R), 1)
  assert.equal(inGoal([0, 2, 0], C.BALL_R), -1)
  assert.equal(BOOST_PADS.filter((p) => p.big).length, 6)
  assert.ok(Object.keys(CARS).length >= 4 && CARS[DEFAULT_CAR])
})

test('ball falls, bounces, stays inside', () => {
  const s = play1()
  s.ball.p = [5, 15, 5]; s.ball.v = [10, 0, 7]
  let minY = 99, bounced = false, prevVy = 0
  for (let i = 0; i < 600; i++) {
    step(s)
    if (s.phase !== 'play') break
    if (prevVy < -3 && s.ball.v[1] > 0) bounced = true
    prevVy = s.ball.v[1]; minY = Math.min(minY, s.ball.p[1])
    assert.ok(arenaDistance(s.ball.p).d > C.BALL_R - 0.05)
  }
  assert.ok(bounced && minY >= C.BALL_R - 0.05)
})

test('countdown to play with events', () => {
  const s = createMatch({ teamSize: 1 })
  addPlayer(s, { id: 'a', team: 0 })
  startMatch(s)
  assert.equal(s.phase, 'countdown')
  const ev = [...s.events]
  for (let i = 0; i < 200; i++) { step(s); ev.push(...s.events) }
  assert.deepEqual(ev.filter((e) => e.type === 'countdown').map((e) => e.n), [3, 2, 1, 0])
  assert.ok(ev.some((e) => e.type === 'kickoff'))
  assert.equal(s.phase, 'play')
  const ids = ev.map((e) => e.id)
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b))
})

test('car accelerates, steers, boosts', () => {
  const s = play1()
  s.ball.p = [30, 30, 30]
  setInput(s, 'a', I({ thr: 1 })); run(s, 60)
  const sp1 = Math.hypot(...s.cars[0].v)
  assert.ok(sp1 > 8, `speed ${sp1}`)
  const b0 = s.cars[0].boost
  setInput(s, 'a', I({ thr: 1, boost: true })); run(s, 30)
  assert.ok(s.cars[0].boost < b0 && Math.hypot(...s.cars[0].v) > sp1)
  const h0 = s.cars[0].q.slice()
  setInput(s, 'a', I({ thr: 1, steer: 1 })); run(s, 30)
  assert.notDeepEqual(s.cars[0].q, h0)
})

test('jump, double jump, dodge', () => {
  const s = play1()
  const c = s.cars[0]
  s.ball.p = [30, 30, 30]
  setInput(s, 'a', I({ jump: true })); run(s, 3)
  assert.ok(c.jumped && !c.onGround)
  setInput(s, 'a', I()); run(s, 12)
  const vy = c.v[1], y = c.p[1]
  setInput(s, 'a', I({ jump: true })); run(s, 2)
  assert.ok(c.doubleJumped && c.v[1] > vy - 2, 'double jump lifts')
  // dodge
  const d = play1(); const k = d.cars[0]; d.ball.p = [30, 30, 30]
  setInput(d, 'a', I({ jump: true })); run(d, 3); setInput(d, 'a', I()); run(d, 12)
  const sp = Math.hypot(k.v[0], k.v[2])
  setInput(d, 'a', I({ jump: true, pitch: -1 })); run(d, 2)
  assert.ok(k.dodging || k.doubleJumped)
  assert.ok(Math.hypot(k.v[0], k.v[2]) > sp + 6, 'dodge speed burst')
  assert.ok(d.events.length >= 0)
  // lands again
  setInput(d, 'a', I()); run(d, 300)
  assert.ok(k.onGround && !k.jumped)
})

test('dodge emits dodge event, jump emits jump', () => {
  const s = play1(); s.ball.p = [30, 30, 30]
  const ev = []
  setInput(s, 'a', I({ jump: true })); run(s, 3); ev.push(...s.events)
  const all = []
  const rec = () => { all.push(...s.events) }
  setInput(s, 'a', I()); for (let i = 0; i < 10; i++) { step(s); rec() }
  setInput(s, 'a', I({ jump: true, pitch: -1 })); for (let i = 0; i < 3; i++) { step(s); rec() }
  assert.ok(all.some((e) => e.type === 'dodge'))
})

test('boost pads refill and respawn', () => {
  const s = play1(); s.ball.p = [30, 30, 30]
  const c = s.cars[0]
  const i = BOOST_PADS.findIndex((p) => !p.big)
  c.boost = 10; c.p = [BOOST_PADS[i].p[0], 0.56, BOOST_PADS[i].p[2]]
  const ev = []
  for (let k = 0; k < 3; k++) { step(s); ev.push(...s.events) }
  assert.ok(Math.abs(c.boost - (10 + C.PAD_SMALL)) < 1e-6)
  assert.ok(ev.some((e) => e.type === 'boostPickup' && e.pad === i))
  assert.equal(s.pads[i], false)
  c.p = [0, 0.56, 0]
  run(s, C.PAD_SMALL_RESPAWN * 60 + 5)
  assert.equal(s.pads[i], true)
})

test('goal updates score, emits goal, resets to countdown', () => {
  const s = play1()
  s.ball.p = [0, 3, 45]; s.ball.v = [0, 0, 40]
  s.lastTouch = 'a'; s.touches = [{ id: 'a', team: 0, tick: s.tick }]
  const ev = []
  for (let i = 0; i < 120 && s.phase === 'play'; i++) { step(s); ev.push(...s.events) }
  assert.deepEqual(s.score, [1, 0])
  const g = ev.find((e) => e.type === 'goal')
  assert.ok(g && g.team === 0 && g.scorerId === 'a' && g.speed > 50)
  assert.equal(s.cars[0].stats.goals, 1)
  assert.equal(s.phase, 'goal')
  run(s, 60 * C.GOAL_SECONDS + 5)
  assert.equal(s.phase, 'countdown')
  assert.equal(s.ball.v[2], 0)
})

test('demolition and respawn', () => {
  const s = createMatch({ teamSize: 1, seed: 3 })
  addPlayer(s, { id: 'a', team: 0 }); addPlayer(s, { id: 'b', team: 1 })
  startMatch(s); run(s, 200)
  const [a, b] = s.cars
  s.ball.p = [35, 30, 0]
  a.p = [0, 0.56, 0]; a.q = [0, 0, 0, 1]; a.v = [0, 0, 33]; a.supersonic = true
  b.p = [0, 0.56, 4]; b.q = [0, 1, 0, 0]; b.v = [0, 0, 0]
  const ev = []
  for (let i = 0; i < 20; i++) { setInput(s, 'a', I({ thr: 1, boost: true })); step(s); ev.push(...s.events) }
  assert.ok(ev.some((e) => e.type === 'demo' && e.attackerId === 'a' && e.victimId === 'b'))
  assert.ok(b.demolished > 0 && a.stats.demos === 1)
  run(s, 60 * C.RESPAWN_SECONDS + 5)
  assert.equal(b.demolished <= 0, true)
})

test('overtime, matchOver with winner and mvp', () => {
  const s = play1(); s.clock = 0.05; s.score = [0, 0]
  const ev = []
  for (let i = 0; i < 10; i++) { step(s); ev.push(...s.events) }
  assert.ok(s.overtime && ev.some((e) => e.type === 'overtime'))
  s.ball.p = [0, 3, 45]; s.ball.v = [0, 0, 40]; s.lastTouch = 'a'; s.touches = [{ id: 'a', team: 0, tick: s.tick }]
  for (let i = 0; i < 60 * 6; i++) { step(s); ev.push(...s.events) }
  const m = ev.find((e) => e.type === 'matchOver')
  assert.ok(m && m.winner === 0 && m.mvpId === 'a')
  assert.equal(s.phase, 'over')
})

test('removePlayer works for bots, fillBots fills', () => {
  const s = createMatch({ teamSize: 2 })
  fillBots(s)
  assert.equal(s.cars.length, 4)
  assert.ok(s.cars.every((c) => c.bot && /^bot-\d+$/.test(c.id)))
  assert.equal(new Set(s.cars.map((c) => c.name)).size, 4)
  removePlayer(s, s.cars[0].id)
  assert.equal(s.cars.length, 3)
})

test('stepCar mutates a car in place and snapshot is JSON-safe', () => {
  const s = play1()
  const snap = snapshot(s)
  const car = JSON.parse(JSON.stringify(snap.cars[0]))
  stepCar(car, I({ thr: 1 }), C.DT, snap)
  assert.ok(car.v[2] > 0)
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(snap))), JSON.stringify(snap))
})

test('deterministic', () => {
  const mk = () => {
    const s = createMatch({ teamSize: 2, seed: 99 }); fillBots(s); startMatch(s)
    for (let i = 0; i < 600; i++) { setInput(s, s.cars[0].id, I({ thr: 1, steer: Math.sin(i / 30), boost: i % 90 < 30, jump: i % 100 === 0 })); step(s) }
    return JSON.stringify(snapshot(s))
  }
  assert.equal(mk(), mk())
})

test('2v2 bots, 3 simulated minutes, no NaN, fast enough', () => {
  const s = createMatch({ teamSize: 2, seed: 5 }); fillBots(s); startMatch(s)
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < 60 * 180; i++) {
    step(s)
    if (i % 600 === 0) assert.ok(finite(s))
    for (const c of s.cars) assert.ok(arenaDistance(c.p).d > -3, 'car left the arena')
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / (60 * 180)
  assert.ok(finite(s))
  assert.ok(ms < 1, `step took ${ms} ms`)
})
