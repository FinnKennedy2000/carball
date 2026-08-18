// Low-poly 3D view of a 2D simulation. Sim x maps to world x, sim y maps to
// world z, world y is up. A positive sim heading rotates +x toward +y, which is
// +z here, so mesh rotation.y is the negated heading.

import * as THREE from 'three'
import * as C from '../shared/constants.js'

const TEAM_COLOR = [0x3b82f6, 0xf97316]
const GROUND = 0x1b2432

let renderer
let scene
let camera
let localId = null
const carMeshes = new Map() // id -> Group
let ballMesh
let localRing
let labelBox
const carLabels = new Map() // id -> span, tracking carMeshes
// Above the roof, and above the ball, so a label never sits on what it names.
const LABEL_Y = 5.5
const LABEL_AT = new THREE.Vector3()

export function initRenderer(canvas) {
  labelBox = document.getElementById('labels')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0e14)
  scene.fog = new THREE.Fog(0x0b0e14, 90, 190)

  camera = new THREE.PerspectiveCamera(45, 1, 1, 400)
  camera.position.set(0, 64, 50)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x14181f, 0.55))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(-30, 60, 20)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const s = sun.shadow.camera
  s.left = -55
  s.right = 55
  s.top = 40
  s.bottom = -40
  s.near = 1
  s.far = 160
  scene.add(sun)

  buildArena()
  ballMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(C.BALL_R, 1),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf4, flatShading: true, roughness: 0.35 }),
  )
  ballMesh.castShadow = true
  scene.add(ballMesh)

  localRing = new THREE.Mesh(
    new THREE.RingGeometry(C.CAR_R + 0.5, C.CAR_R + 1.1, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  )
  localRing.rotation.x = -Math.PI / 2
  localRing.position.y = 0.06
  localRing.visible = false
  scene.add(localRing)

  resize()
  addEventListener('resize', resize)
}

export function setLocalId(id) {
  localId = id
}

function buildArena() {
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(C.ARENA_W, C.ARENA_H),
    new THREE.MeshStandardMaterial({ color: GROUND, roughness: 0.95 }),
  )
  pitch.rotation.x = -Math.PI / 2
  pitch.receiveShadow = true
  scene.add(pitch)

  addLine(new THREE.PlaneGeometry(0.35, C.ARENA_H), 0, 0)
  const circle = new THREE.Mesh(
    new THREE.RingGeometry(7.6, 7.95, 48),
    lineMaterial(),
  )
  circle.rotation.x = -Math.PI / 2
  circle.position.y = 0.02
  scene.add(circle)

  const wallH = 3
  const wallT = 1
  // Side walls.
  addWall(0, C.MIN_Y - wallT / 2, C.ARENA_W + wallT * 2, wallT, wallH, 0x2a3648)
  addWall(0, C.MAX_Y + wallT / 2, C.ARENA_W + wallT * 2, wallT, wallH, 0x2a3648)
  // End walls, split around the goal mouth.
  const segLen = (C.ARENA_H - C.GOAL_H) / 2
  const segOff = C.GOAL_H / 2 + segLen / 2
  for (const [x, team] of [
    [C.MIN_X - wallT / 2, C.TEAM_BLUE],
    [C.MAX_X + wallT / 2, C.TEAM_ORANGE],
  ]) {
    addWall(x, -segOff, wallT, segLen, wallH, 0x2a3648)
    addWall(x, segOff, wallT, segLen, wallH, 0x2a3648)
    addGoal(x, TEAM_COLOR[team])
  }
}

function addGoal(x, color) {
  const depth = C.GOAL_DEPTH
  const dir = Math.sign(x)
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(depth, 3.4, C.GOAL_H),
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      roughness: 0.6,
    }),
  )
  net.position.set(x + (dir * depth) / 2, 1.7, 0)
  scene.add(net)

  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(C.GOAL_H, 3.4), lineMaterial(color, 0.9))
  mouth.rotation.y = -dir * (Math.PI / 2)
  mouth.position.set(x, 1.7, 0)
  scene.add(mouth)
}

function addWall(x, z, w, d, h, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  )
  mesh.position.set(x, h / 2, z)
  scene.add(mesh)
}

function addLine(geometry, x, z) {
  const mesh = new THREE.Mesh(geometry, lineMaterial())
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x, 0.02, z)
  scene.add(mesh)
}

function lineMaterial(color = 0xffffff, opacity = 0.14) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
}

function makeCar(team) {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1.5, 2.6),
    new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], flatShading: true, roughness: 0.45 }),
  )
  body.position.y = 0.9
  body.castShadow = true
  group.add(body)

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.8, 2.1),
    new THREE.MeshStandardMaterial({ color: 0x11151d, flatShading: true }),
  )
  roof.position.set(-0.35, 1.9, 0)
  roof.castShadow = true
  group.add(roof)

  // A nose flash so facing is readable at this camera distance.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.1, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f5 }),
  )
  nose.position.set(2.0, 0.9, 0)
  group.add(nose)

  return group
}

/** `nameOf` maps a car id to a player name, or null while the roster is unknown. */
export function draw(state, nameOf = () => null) {
  const seen = new Set()
  for (const car of state.cars) {
    seen.add(car.id)
    let mesh = carMeshes.get(car.id)
    if (!mesh) {
      mesh = makeCar(car.team)
      carMeshes.set(car.id, mesh)
      scene.add(mesh)
    }
    mesh.position.set(car.x, 0, car.y)
    mesh.rotation.y = -car.heading
    drawLabel(car, nameOf(car.id))
    if (car.id === localId) {
      localRing.visible = true
      localRing.position.x = car.x
      localRing.position.z = car.y
    }
  }
  for (const [id, mesh] of carMeshes) {
    if (seen.has(id)) continue
    scene.remove(mesh)
    carMeshes.delete(id)
    carLabels.get(id)?.remove()
    carLabels.delete(id)
  }
  if (!seen.has(localId)) localRing.visible = false

  ballMesh.position.set(state.ball.x, C.BALL_R, state.ball.y)
  // Roll the ball in its direction of travel so it does not look like it is sliding.
  ballMesh.rotation.z -= (state.ball.vx / C.BALL_R) * 0.016
  ballMesh.rotation.x += (state.ball.vy / C.BALL_R) * 0.016

  renderer.render(scene, camera)
}

/**
 * The name over a car, as DOM rather than a sprite: it costs no texture, and it
 * picks up the HUD's own type. Projected each frame, which is nothing at six cars.
 */
function drawLabel(car, name) {
  let label = carLabels.get(car.id)
  if (!name) {
    label?.remove()
    carLabels.delete(car.id)
    return
  }
  if (!label) {
    label = document.createElement('span')
    // The side never changes once a car is seated, so the class is set once.
    label.className = `car-label ${car.team === C.TEAM_BLUE ? 'blue' : 'orange'}`
    labelBox.append(label)
    carLabels.set(car.id, label)
  }
  if (label.textContent !== name) label.textContent = name
  const p = LABEL_AT.set(car.x, LABEL_Y, car.y).project(camera)
  const x = (p.x * 0.5 + 0.5) * innerWidth
  const y = (0.5 - p.y * 0.5) * innerHeight
  label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`
}

function resize() {
  const w = innerWidth
  const h = innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
