// The item models, one at a time on a turntable. A workbench for the props in
// kart-items.js: the race is where they are used, this is where they are looked
// at. Drag to turn one round, and it drifts back to turning by itself.

import * as THREE from 'three'
import { ITEM_MODELS, buildItem } from './kart-items.js'

const stage = document.querySelector('.stage')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0f111a)
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
const renderer = new THREE.WebGLRenderer({ antialias: true })
stage.append(renderer.domElement)

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x141824, 1.1))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
key.position.set(4, 7, 5)
scene.add(key)
const fill = new THREE.DirectionalLight(0x8fb4ff, 0.5)
fill.position.set(-5, 2, -4)
scene.add(fill)

// A dark disc under the model, so it is standing on something.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4, 48),
  new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.9 }),
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const turntable = new THREE.Group()
scene.add(turntable)

let spin = 0
let drag = null

function show(key) {
  turntable.clear()
  const model = buildItem(key)
  model.scale.setScalar(2.4)
  turntable.add(model)
  document.getElementById('cap-name').textContent = ITEM_MODELS[key].name
  document.getElementById('cap-note').textContent = ITEM_MODELS[key].note
  for (const button of list.children) {
    button.setAttribute('aria-pressed', String(button.dataset.key === key))
  }
}

const list = document.getElementById('list')
for (const key of Object.keys(ITEM_MODELS)) {
  const button = document.createElement('button')
  button.className = 'pick'
  button.dataset.key = key
  button.setAttribute('aria-pressed', 'false')
  button.innerHTML = `${ITEM_MODELS[key].name}<span>${key}</span>`
  button.addEventListener('click', () => show(key))
  list.append(button)
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  drag = e.clientX
  renderer.domElement.setPointerCapture(e.pointerId)
})
renderer.domElement.addEventListener('pointermove', (e) => {
  if (drag === null) return
  spin += (e.clientX - drag) * 0.01
  drag = e.clientX
})
for (const type of ['pointerup', 'pointercancel']) {
  renderer.domElement.addEventListener(type, () => {
    drag = null
  })
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

function frame() {
  if (drag === null) spin += 0.006
  turntable.rotation.y = spin
  camera.position.set(0, 2.6, 6.2)
  camera.lookAt(0, 1.1, 0)
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
show(Object.keys(ITEM_MODELS)[0])
frame()
