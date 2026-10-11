import test from 'node:test'
import assert from 'node:assert/strict'
import { engineParams, estimateThrottle, crowdIntensity, quatAxes, pullToward, ballBounce, hitShape, GEARS } from '../client/audio/helpers.js'

test('engine pitch rises within a gear and drops on a shift', () => {
  const a = engineParams(GEARS[2] + 0.5, 1, false)
  const b = engineParams(GEARS[3] - 0.1, 1, false)
  const c = engineParams(GEARS[3] + 0.1, 1, false)
  assert.ok(b.freq > a.freq)
  assert.ok(c.freq < b.freq)
  assert.equal(c.gear, 3)
  for (const v of [0, 5, 20, 60, 500]) assert.ok(Number.isFinite(engineParams(v, 0.5, true).freq))
})

test('throttle estimate', () => {
  assert.equal(estimateThrottle(0, 0, 0.016, true), 1)
  assert.ok(estimateThrottle(10, 12, 0.1, false) > estimateThrottle(10, 8, 0.1, false))
  assert.ok(estimateThrottle(1, 1, 0, false) >= 0)
})

test('crowd swells near goals and with ball speed, stays in 0..1', () => {
  const mid = crowdIntensity([0, 1, 0], [0, 0, 0])
  const goal = crowdIntensity([0, 1, 58], [0, 0, 0])
  const fast = crowdIntensity([0, 1, 0], [0, 0, 60])
  assert.ok(goal > mid && fast > mid)
  assert.ok(crowdIntensity([0, 0, 999], [999, 999, 999]) <= 1)
  assert.ok(crowdIntensity([NaN, 0, NaN], [0, 0, 0]) >= 0)
})

test('quatAxes identity looks down -Z, yaw 90deg looks down -X', () => {
  const id = quatAxes([0, 0, 0, 1])
  assert.deepEqual(id.f.map((x) => Math.round(x) + 0), [0, 0, -1])
  const s = Math.SQRT1_2
  const yaw = quatAxes([0, s, 0, s])
  assert.deepEqual(yaw.f.map((x) => Math.round(x) + 0), [-1, 0, 0])
  assert.deepEqual(yaw.u.map((x) => Math.round(x) + 0), [0, 1, 0])
})

test('pullToward', () => {
  assert.deepEqual(pullToward([10, 0, 0], [0, 0, 0], 0.5), [5, 0, 0])
})

test('ball bounce detection', () => {
  assert.ok(ballBounce([39, 5, 0], [10, 0, 0], [-8, 0, 0]) > 0)
  assert.equal(ballBounce([0, 5, 0], [10, 0, 0], [-8, 0, 0]), 0)
  assert.ok(ballBounce([0, 1, 0], [0, -12, 0], [0, 9, 0]) > 0)
})

test('hit shape: harder = louder and lower', () => {
  assert.ok(hitShape(1).gain > hitShape(0.1).gain)
  assert.ok(hitShape(1).pitch < hitShape(0.1).pitch)
})
