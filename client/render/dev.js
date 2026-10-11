// Fake animated state to look at the renderer without the rest of the game.
import { createRenderer, createCarPreview } from './index.js'
import { ARENA, BOOST_PADS } from '../../shared/arena.js'
import { carKeys } from './cars.js'
import * as THREE from 'three'

const qs = new URLSearchParams(location.search)
const canvas = document.getElementById('c')
const r = createRenderer(canvas, { quality: qs.get('q') || 'medium' })
window.addEventListener('resize', () => r.resize())
const keys = carKeys()
const N = 6
const cars = []
for (let i = 0; i < N; i++) {
  cars.push({ id: 'c' + i, name: ['Finn', 'Nova', 'Rex', 'Kite', 'Zed', 'Orbit'][i], team: i % 2, body: keys[i % keys.length], bot: i > 0 })
}
const scene = qs.get('scene') || 'play' // play | menu
const q = new THREE.Quaternion(), e = new THREE.Euler(), yq = new THREE.Quaternion()
let t = 0
let phase = 'play'
const pads = BOOST_PADS.map(() => true)
const lead = { speed: 1 }

function mk() {
  const R = ARENA.halfWidth * 0.55
  const out = cars.map((c, i) => {
    const a = t * (0.35 + i * 0.05) * (i % 2 ? -1 : 1) + i * 1.1
    const rr = R * (0.45 + 0.1 * i)
    const x = Math.cos(a) * rr * 0.9, z = Math.sin(a) * rr * 1.3
    const dir = (i % 2 ? -1 : 1)
    const vx = -Math.sin(a) * dir * 20, vz = Math.cos(a) * dir * 20 * 1.3
    const yaw = Math.atan2(vx, vz)
    const air = i === 2 ? Math.max(0, Math.sin(t * 1.3)) : 0
    e.set(air * 0.6 * Math.sin(t * 3), yaw, air * Math.sin(t * 2) * 1.2, 'YXZ')
    q.setFromEuler(e)
    const boosting = i % 3 === 0 || i === 4
    return {
      ...c, p: [x, 0.9 + air * 14, z], v: [vx * (boosting ? 2 : 1), 0, vz * (boosting ? 2 : 1)], q: [q.x, q.y, q.z, q.w],
      w: [0, dir * 0.4, 0], boost: 60, onGround: air < 0.05, onWall: false, boosting, supersonic: i === 0 || i === 3,
      dodging: false, jumped: false, doubleJumped: false, demolished: phase === 'demo' && i === 5 ? 3 : 0,
      stats: {},
    }
  })
  const by = 2.6 + Math.abs(Math.sin(t * 1.7)) * 8
  const fr = window.__dev?.ballFreeze
  const ball = { p: fr ? [0, 4, 15] : [Math.sin(t * 0.6) * 15, by, Math.cos(t * 0.45) * 30], v: [Math.cos(t * 0.6) * 9, Math.cos(t * 1.7) * 14, -Math.sin(t * .45) * 13 * 2], q: [0, 0, 0, 1], w: [0, 0, 0] }
  e.set(t * 1.3, t * 0.7, t * 0.4)
  q.setFromEuler(e)
  ball.q = [q.x, q.y, q.z, q.w]
  pads.forEach((_, i) => (pads[i] = ((Math.floor(t / 4) + i) % 5) !== 0))
  return { tick: 0, phase, phaseT: 3, clock: 242, overtime: false, score: [2, 1], teamSize: 3, ball, cars: out, pads: pads.slice(), lastTouch: 'c1', events: [] }
}

let last = performance.now()
let state = null
let evId = 0
const hud = document.getElementById('hud')
let frames = 0, acc = 0
const fire = (type, extra) => r.onEvent({ id: ++evId, type, tick: 0, ...extra })
window.__dev = {
  r, fire, set(k, v) { ({ phase: () => (phase = v), t: () => (t = v), scene: () => (qsScene = v) })[k]?.() },
  get state() { return state },
}
let qsScene = scene
const timers = []
function loop(now) {
  if (now - last < 8) return
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  t += dt
  state = qsScene === 'menu' ? null : mk()
  r.render(state, dt, 'c0')
  frames++; acc += dt
  if (acc > 1) { hud.textContent = `${(frames / acc).toFixed(0)} fps  ${r.camera.position.toArray().map((x) => x.toFixed(0))}`; frames = 0; acc = 0 }
}
const raf = (n) => { loop(n); requestAnimationFrame(raf) }
requestAnimationFrame(raf)
setInterval(() => document.hidden && loop(performance.now()), 33) // hidden tabs get no rAF
// periodic fake events
setInterval(() => {
  if (!state || qsScene === 'menu' || qs.has('quiet')) return
  const k = Math.floor(t / 6) % 4
  const b = state.ball
  if (k === 0) fire('hit', { carId: 'c1', strength: Math.random(), p: b.p })
  if (k === 1) fire('demo', { attackerId: 'c0', victimId: 'c5', p: state.cars[5].p })
  if (k === 2) fire('boostPickup', { carId: 'c0', pad: Math.floor(Math.random() * BOOST_PADS.length), big: Math.random() < 0.4 })
  if (k === 3) fire('land', { carId: 'c2' })
}, 1500)
if (qs.has('preview')) {
  const c2 = document.createElement('canvas')
  c2.style.cssText = 'position:fixed;right:10px;bottom:10px;width:960px;height:540px;background:linear-gradient(#0a1424,#1a2a44)'
  document.body.appendChild(c2)
  window.__preview = createCarPreview(c2)
}

window.__shot = async (name) => {
  loop(performance.now() + 20)
  const url = canvas.toDataURL('image/png')
  const res = await fetch('/__save?name=' + name, { method: 'POST', body: url })
  return res.text()
}

window.__carShot = async (name, key, team, angle) => {
  const p = window.__preview
  p.setBody(key); p.setTeam(team); p.resize(); p.renderNow(angle)
  const c = document.querySelector('canvas:last-of-type')
  const res = await fetch('/__save?name=' + name, { method: 'POST', body: c.toDataURL('image/png') })
  return res.text()
}

window.__ballShot = async (name) => {
  r.setCameraOverride([0, 5, 22], [0, 4, 15], 40)
  window.__dev.ballFreeze = true
  loop(performance.now() + 20); loop(performance.now() + 60)
  const res = await fetch('/__save?name=' + name, { method: 'POST', body: canvas.toDataURL('image/png') })
  r.setCameraOverride(null)
  return res.text()
}
