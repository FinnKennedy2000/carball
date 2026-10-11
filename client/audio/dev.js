// Dev bench: buttons for every event plus a fake moving state driving update().
import { createAudio } from './index.js'

const audio = createAudio()
window.audio = audio
const cam = { position: { x: 0, y: 12, z: -30 }, quaternion: { x: 0, y: 1, z: 0, w: 0 } } // looks +Z
const mkCar = (id, team, phase) => ({
  id, team, p: [0, 0.5, 0], v: [0, 0, 0], boost: 50, onGround: true, onWall: false,
  boosting: false, supersonic: false, demolished: 0, phase,
})
const state = {
  phase: 'play', overtime: false,
  ball: { p: [0, 2, 0], v: [0, 0, 0] },
  cars: [mkCar('me', 0), mkCar('b1', 1), mkCar('b2', 1), mkCar('b3', 0)],
}
let t = 0
window.fake = { state, running: true }
function frame() {
  t += 1 / 60
  if (window.fake.running) {
    state.cars.forEach((c, i) => {
      const sp = 8 + 20 * (0.5 + 0.5 * Math.sin(t * 0.4 + i))
      const a = t * 0.3 + i * 1.7
      c.p = [Math.sin(a) * 25, 0.5, Math.cos(a) * 40]
      c.v = [Math.cos(a) * sp, 0, -Math.sin(a) * sp]
      c.boosting = Math.sin(t * 0.7 + i) > 0.3
    })
    state.cars[3].demolished = Math.sin(t * 0.2) > 0.9 ? 3 : 0
    state.ball.p = [Math.sin(t * 0.5) * 30, 3 + Math.abs(Math.sin(t * 2)) * 6, Math.sin(t * 0.35) * 58]
    state.ball.v = [Math.cos(t * 0.5) * 15, 0, Math.cos(t * 0.35) * 20]
  }
  audio.update(state, 'me', cam)
  requestAnimationFrame(frame)
}
frame()

const box = document.getElementById('b')
const add = (label, fn) => {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = () => { audio.unlock(); fn() }
  box.append(b)
}
add('unlock', () => {})
add('music on', () => audio.setMusic(true))
add('music off', () => audio.setMusic(false))
let id = 0
const ev = (type, f = {}) => () => audio.onEvent({ id: ++id, type, tick: 0, carId: 'me', p: [0, 2, 10], ...f }, state, 'me')
for (const n of [3, 2, 1, 0]) add('countdown ' + n, ev('countdown', { n }))
for (const [l, e] of [
  ['kickoff', ev('kickoff')], ['hit soft', ev('hit', { strength: 0.2 })], ['hit hard', ev('hit', { strength: 1 })],
  ['jump', ev('jump')], ['dodge', ev('dodge')], ['land', ev('land')], ['bump', ev('bump', { strength: 0.8 })],
  ['demo', ev('demo', { victimId: 'b1' })], ['pad small', ev('boostPickup', { big: false })], ['pad big', ev('boostPickup', { big: true })],
  ['supersonic', ev('supersonic')], ['shot', ev('shot')], ['save', ev('save')], ['goal', ev('goal', { team: 0 })],
  ['overtime', ev('overtime')], ['matchOver', ev('matchOver')],
]) add(l, e)
for (const u of ['hover', 'click', 'back', 'start']) add('ui ' + u, () => audio.playUi(u))
