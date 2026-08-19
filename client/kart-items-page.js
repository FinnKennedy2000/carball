// The item models, one at a time on a turntable. A workbench for the props in
// kart-items.js: the race is where they are used, this is where they are looked
// at. Drag to orbit, scroll to zoom, right-drag to pan; it turns by itself until
// you touch it. The toolbar hands the model over as OBJ + MTL or GLB, at the
// size buildItem makes it, so the file is worth opening in something else.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ITEM_MODELS, buildItem } from './kart-items.js'

const stage = document.querySelector('.stage')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0f111a)
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
stage.append(renderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.autoRotate = true
controls.autoRotateSpeed = 1.2
controls.addEventListener('start', () => {
  controls.autoRotate = false
})

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x141824, 1.1))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
key.position.set(4, 7, 5)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.bias = -0.0002
scene.add(key)
const fill = new THREE.DirectionalLight(0x8fb4ff, 0.5)
fill.position.set(-5, 2, -4)
scene.add(fill)

// The model's own shadow is the only floor: a plane that catches it and is
// otherwise invisible, slid up to whatever the model is standing on.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.35 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

let model = null

function show(key) {
  if (model) scene.remove(model)
  model = buildItem(key)
  model.traverse((part) => {
    if (part.isMesh) {
      part.castShadow = true
      part.receiveShadow = true
    }
  })
  scene.add(model)
  frameCamera()
  document.getElementById('cap-name').textContent = ITEM_MODELS[key].name
  document.getElementById('cap-note').textContent = ITEM_MODELS[key].note
  document.title = `${ITEM_MODELS[key].name} — kart items`
  for (const button of list.children) {
    button.setAttribute('aria-pressed', String(button.dataset.key === key))
  }
}

// Back the camera off far enough that the model's bounding sphere fits the
// frame, whatever size the model happens to be, and aim the orbit at its middle.
function frameCamera() {
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return
  floor.position.y = box.min.y
  const ball = box.getBoundingSphere(new THREE.Sphere())
  const distance = (ball.radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.35
  camera.position
    .copy(ball.center)
    .add(new THREE.Vector3(1, 0.55, 1.25).normalize().multiplyScalar(distance))
  camera.near = Math.max(distance / 100, 0.01)
  camera.far = distance * 100
  camera.updateProjectionMatrix()
  controls.target.copy(ball.center)
  controls.update()
  const span = ball.radius * 3
  Object.assign(key.shadow.camera, {
    left: -span,
    right: span,
    top: span,
    bottom: -span,
  })
  key.shadow.camera.updateProjectionMatrix()
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

function currentKey() {
  return [...list.children].find((b) => b.getAttribute('aria-pressed') === 'true').dataset.key
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// OBJ carries geometry only, so the materials go out beside it in an MTL and
// every mesh and material needs a name for the o / usemtl lines to point at.
function nameParts() {
  const materials = []
  let n = 0
  model.traverse((part) => {
    if (!part.isMesh) return
    if (!part.name) part.name = `part_${n}`
    n += 1
    for (const material of [part.material].flat()) {
      if (!material || materials.includes(material)) continue
      if (!material.name) material.name = `mat_${materials.length}`
      materials.push(material)
    }
  })
  return materials
}

async function exportObj() {
  const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js')
  const materials = nameParts()
  const base = `kart-${currentKey()}`
  const obj = `mtllib ${base}.mtl\n${new OBJExporter().parse(model)}`
  let mtl = '# Exported from the kart item workbench\n'
  for (const material of materials) {
    const { r, g, b } = material.color ?? { r: 0.8, g: 0.8, b: 0.8 }
    const shine = Math.round((1 - (material.roughness ?? 0.5)) * 200)
    mtl += `newmtl ${material.name}\n`
    mtl += `Kd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}\n`
    mtl += 'Ks 0.2000 0.2000 0.2000\n'
    mtl += `Ns ${shine}\n`
    mtl += `d ${(material.opacity ?? 1).toFixed(4)}\n\n`
  }
  download(new Blob([obj], { type: 'text/plain' }), `${base}.obj`)
  download(new Blob([mtl], { type: 'text/plain' }), `${base}.mtl`)
}

async function exportGlb() {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  nameParts()
  const buffer = await new GLTFExporter().parseAsync(model, { binary: true })
  download(new Blob([buffer], { type: 'model/gltf-binary' }), `kart-${currentKey()}.glb`)
}

document.getElementById('export-obj').addEventListener('click', exportObj)
document.getElementById('export-glb').addEventListener('click', exportGlb)

function resize() {
  const { clientWidth: w, clientHeight: h } = stage
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

function draw() {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(draw)
}
show(Object.keys(ITEM_MODELS)[0])
draw()
