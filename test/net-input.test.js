import test from 'node:test'
import assert from 'node:assert/strict'
import { keyboardInput, gamepadInput, deadZone, mergeInput, DEFAULT_BINDINGS, setBinding, getBindings, resetBindings } from '../client/input.js'

test('W maps to throttle and nose-down, A/D to steer and yaw', () => {
  const i = keyboardInput(new Set(['forward', 'right']))
  assert.deepEqual([i.thr, i.pitch, i.steer, i.yaw], [1, -1, 1, 1])
  const s = keyboardInput(new Set(['back']))
  assert.deepEqual([s.thr, s.pitch], [-1, 1])
})

test('handbrake + A/D is air roll, not yaw', () => {
  const i = keyboardInput(new Set(['handbrake', 'left']))
  assert.deepEqual([i.steer, i.yaw, i.roll, i.handbrake], [-1, 0, -1, true])
  assert.equal(keyboardInput(new Set(['rollRight'])).roll, 1)
})

test('dead zone is radial and rescaled', () => {
  assert.deepEqual(deadZone(0.1, 0.05), [0, 0])
  const [x, y] = deadZone(1, 0)
  assert.ok(Math.abs(x - 1) < 1e-9 && y === 0)
  const [m] = deadZone(0.56, 0)
  assert.ok(Math.abs(m - 0.5) < 1e-9)
})

test('gamepad: triggers throttle, stick forward is nose down, A jumps', () => {
  const pad = { axes: [0, -1], buttons: Array.from({ length: 16 }, () => ({ value: 0, pressed: false })) }
  pad.buttons[7] = { value: 0.8, pressed: true }
  pad.buttons[0] = { value: 1, pressed: true }
  const i = gamepadInput(pad)
  assert.ok(Math.abs(i.thr - 0.8) < 1e-9)
  assert.equal(i.pitch, -1)
  assert.equal(i.jump, true)
  assert.equal(mergeInput(keyboardInput(new Set()), i).thr, i.thr)
})

test('rebinding swaps conflicts and survives without localStorage', () => {
  setBinding('jump', 'KeyW')
  assert.equal(getBindings().jump, 'KeyW')
  assert.equal(getBindings().forward, DEFAULT_BINDINGS.jump)
  resetBindings()
  assert.deepEqual(getBindings(), DEFAULT_BINDINGS)
})
