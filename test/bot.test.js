import test from 'node:test'
import assert from 'node:assert/strict'
import { botInput } from '../shared/bot.js'
let sim = {}
try { sim = await import('../shared/sim.js') } catch {}

// tiny deterministic rng for building states
const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)

function fakeState(r) {
  const car = (id, team) => {
    const a = r() * 6.28
    return { id, team, bot: true, p: [(r() - 0.5) * 70, 1 + r() * 10, (r() - 0.5) * 90], v: [(r() - 0.5) * 40, (r() - 0.5) * 10, (r() - 0.5) * 40],
      q: [0, Math.sin(a / 2), 0, Math.cos(a / 2)], w: [0, 0, 0], boost: r() * 100, onGround: r() < 0.6, onWall: false,
      demolished: 0, jumped: false, doubleJumped: false, dodging: false }
  }
  return { phase: 'play', ball: { p: [(r() - 0.5) * 60, 2 + r() * 15, (r() - 0.5) * 80], v: [(r() - 0.5) * 40, (r() - 0.5) * 20, (r() - 0.5) * 40], q: [0, 0, 0, 1], w: [0, 0, 0] },
    cars: [car('bot-0', 0), car('bot-1', 0), car('bot-2', 1), car('bot-3', 1)], pads: Array(40).fill(true) }
}

test('valid ranges and determinism', () => {
  const r = rng(7)
  for (let i = 0; i < 300; i++) {
    const st = fakeState(r)
    const c = st.cars[i % 4]
    const a = botInput(st, c)
    const b = botInput(JSON.parse(JSON.stringify(st)), JSON.parse(JSON.stringify(c)))
    for (const k of ['thr', 'steer', 'pitch', 'yaw', 'roll']) assert.ok(Number.isFinite(a[k]) && Math.abs(a[k]) <= 1, k)
    for (const k of ['jump', 'boost', 'handbrake']) assert.equal(typeof a[k], 'boolean', k)
    assert.deepEqual(a, b)
  }
})

const ready = typeof sim.createMatch === 'function' && typeof sim.fillBots === 'function'
const maybe = ready ? test : test.skip

maybe('2v2 bot match scores and bots touch the ball', () => {
  const s = sim.createMatch({ teamSize: 2, seed: 3 })
  sim.fillBots(s); sim.startMatch(s)
  let touched = false
  for (let i = 0; i < 60 * 180; i++) {
    for (const c of s.cars) sim.setInput(s, c.id, botInput(s, c))
    sim.step(s)
    if (s.lastTouch) touched = true
  }
  assert.ok(touched, 'bots touched the ball')
  assert.ok(s.score[0] + s.score[1] >= 1, `score ${s.score}`)
})

maybe('1v1 bot reaches a stationary ball in midfield', () => {
  const s = sim.createMatch({ teamSize: 1, seed: 5 })
  sim.fillBots(s); sim.startMatch(s)
  let n = 0
  while (s.phase !== 'play' && n++ < 60 * 10) sim.step(s)
  s.ball.p = [10, s.ball.p[1], 5]; s.ball.v = [0, 0, 0]; s.lastTouch = null
  for (let i = 0; i < 60 * 6 && !s.lastTouch; i++) {
    for (const c of s.cars) sim.setInput(s, c.id, c.team === 0 ? botInput(s, c) : {})
    sim.step(s)
  }
  assert.ok(s.lastTouch, 'ball touched within 6 s')
})
