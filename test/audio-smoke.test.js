// Drives createAudio() against a recording WebAudio stub: nothing may throw, and no param may get NaN.
import test from 'node:test'
import assert from 'node:assert/strict'

const bad = []
const chk = (n, v) => { if (typeof v === 'number' && !Number.isFinite(v)) bad.push(n) }
const param = (name) => {
  const p = { _v: 0 }
  Object.defineProperty(p, 'value', { get: () => p._v, set: (v) => { chk(name, v); p._v = v } })
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues'])
    p[m] = (...a) => { a.forEach((x) => chk(name + '.' + m, x)); return p }
  return p
}
const PARAMS = /^(gain|frequency|Q|detune|positionX|positionY|positionZ|forwardX|forwardY|forwardZ|upX|upY|upZ|threshold|knee|ratio|attack|release)$/
const node = (kind) => new Proxy({ kind, onended: null }, {
  get(t, k) {
    if (k in t) return t[k]
    if (k === 'connect') return (d) => d
    if (['start', 'stop', 'disconnect', 'setPosition', 'setOrientation'].includes(k)) return () => {}
    if (typeof k === 'string' && PARAMS.test(k)) return (t[k] = param(kind + '.' + k))
    return undefined
  },
  set(t, k, v) { t[k] = v; return true },
})
class FakeCtx {
  constructor() { this.state = 'running'; this.sampleRate = 8000; this.currentTime = 1; this.destination = node('dest'); this.listener = node('listener') }
  resume() { return Promise.resolve() }
  createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) } }
}
for (const k of ['Gain', 'BiquadFilter', 'Oscillator', 'BufferSource', 'WaveShaper', 'Panner', 'Convolver', 'DynamicsCompressor'])
  FakeCtx.prototype['create' + k] = function () { return node(k) }
globalThis.AudioContext = FakeCtx

test('audio runs headless without throwing or NaN params', async () => {
  const { createAudio } = await import('../client/audio/index.js')
  const a = createAudio()
  a.update({ cars: [] }, 'x', null); a.onEvent({ type: 'goal' }, {}, 'x'); a.playUi('click'); a.setMusic(true); a.setVolume({ master: 0.5 })
  a.unlock()
  const cam = { position: { x: 0, y: 10, z: -30 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  const car = (id) => ({ id, p: [1, 1, 1], v: [20, 0, 5], boosting: true, onGround: true, demolished: 0 })
  const st = { phase: 'play', ball: { p: [39, 1, 50], v: [-10, 5, 30] }, cars: Array.from({ length: 8 }, (_, i) => car('c' + i)) }
  for (let i = 0; i < 30; i++) { st.ball.v[0] *= -1; a.update(st, 'c0', cam) }
  st.cars.splice(2); a.update(st, 'c0', cam)
  for (const type of ['countdown', 'kickoff', 'hit', 'shot', 'save', 'goal', 'demo', 'jump', 'dodge', 'land', 'boostPickup', 'supersonic', 'overtime', 'matchOver', 'bump'])
    a.onEvent({ type, n: 0, strength: 0.7, big: true, carId: 'c0', victimId: 'c1', p: [0, 1, 2] }, st, 'c0')
  for (const u of ['hover', 'click', 'back', 'start']) a.playUi(u)
  a.setVolume({ master: 1, sfx: 1, music: 1, crowd: 1 }); a.setMusic(false)
  assert.deepEqual(bad, [])
})
