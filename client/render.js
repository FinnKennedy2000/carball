// Low-poly 3D view of a 2D simulation. Sim x maps to world x, sim y maps to
// world z, world y is up. A positive sim heading rotates +x toward +y, which is
// +z here, so mesh rotation.y is the negated heading.

import * as THREE from 'three'
import * as C from '../shared/constants.js'
import { CARS, DEFAULT_CAR } from '../shared/cars.js'
import { ITEMS } from '../shared/rumble.js'

const TEAM_COLOR = [0x3b82f6, 0xf97316]
const GROUND = 0x1b2432

// One colour per item, so what went off is readable from the ring alone rather
// than only from the HUD. Keyed by name: ITEMS' order is a wire format, and this
// should not have to move when something is appended to it.
const ITEM_COLOR = {
  haymaker: 0xffd166,
  boot: 0xff6b6b,
  freeze: 0x6aa8ff,
  hook: 0x7ee7ff,
  magnet: 0xc084fc,
}
// The burst ring's radius at full spread, and the tether's height off the deck.
const BURST_R = 6
const TETHER_Y = 1.4
const TETHER_R = 0.16
// Reused so a per-frame tether costs no allocation.
const FROM = new THREE.Vector3()
const TO = new THREE.Vector3()
const DIR = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

let renderer
let scene
let camera
let localId = null
const carMeshes = new Map() // id -> Group
const carModels = new Map() // id -> the model index its mesh was built from
let ballMesh
let freezeRing
let localRing
// Per-car Rumble visuals, built on demand and tracking carMeshes. A car without
// an item in flight keeps its objects, hidden: six cars is not worth churning.
const carFx = new Map() // id -> { tether, burst }
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

  // Around a held ball. Always in the scene, shown only while it hangs.
  freezeRing = new THREE.Mesh(
    new THREE.RingGeometry(C.BALL_R + 0.5, C.BALL_R + 1.1, 32),
    new THREE.MeshBasicMaterial({
      color: ITEM_COLOR.freeze,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  freezeRing.rotation.x = -Math.PI / 2
  freezeRing.visible = false
  scene.add(freezeRing)

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

/** One of the models in shared/cars.js, in the side's colour. */
export function makeCar(team, model = DEFAULT_CAR) {
  const spec = CARS[model] ?? CARS[DEFAULT_CAR]
  const group = new THREE.Group()

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(...spec.body),
    new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], flatShading: true, roughness: 0.45 }),
  )
  body.position.y = spec.body[1] / 2 + 0.15
  body.castShadow = true
  group.add(body)

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(...spec.roof),
    new THREE.MeshStandardMaterial({ color: 0x11151d, flatShading: true }),
  )
  roof.position.set(spec.roofAt[0], spec.roofAt[1], 0)
  roof.castShadow = true
  group.add(roof)

  // A nose flash so facing is readable at this camera distance.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(...spec.nose),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f5 }),
  )
  nose.position.set(spec.body[0] / 2, body.position.y, 0)
  group.add(nose)

  return group
}

/**
 * `nameOf` and `carOf` map a car id to its player's name and chosen model, both
 * null until the roster arrives. A car is drawn before that — the snapshot beats
 * the roster on a mid-match join — so the mesh is rebuilt if the model turns out
 * to be something other than what it was first built with.
 */
export function draw(state, nameOf = () => null, carOf = () => null) {
  const seen = new Set()
  for (const car of state.cars) {
    seen.add(car.id)
    const model = carOf(car.id) ?? DEFAULT_CAR
    let mesh = carMeshes.get(car.id)
    if (mesh && carModels.get(car.id) !== model) {
      scene.remove(mesh)
      mesh = null
    }
    if (!mesh) {
      mesh = makeCar(car.team, model)
      carMeshes.set(car.id, mesh)
      carModels.set(car.id, model)
      scene.add(mesh)
    }
    mesh.position.set(car.x, 0, car.y)
    mesh.rotation.y = -car.heading
    drawFx(car, state.ball)
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
    carModels.delete(id)
    carLabels.get(id)?.remove()
    carLabels.delete(id)
    const fx = carFx.get(id)
    if (fx) {
      scene.remove(fx.tether, fx.burst)
      carFx.delete(id)
    }
  }
  if (!seen.has(localId)) localRing.visible = false

  ballMesh.position.set(state.ball.x, C.BALL_R, state.ball.y)
  // Roll the ball in its direction of travel so it does not look like it is sliding.
  ballMesh.rotation.z -= (state.ball.vx / C.BALL_R) * 0.016
  ballMesh.rotation.x += (state.ball.vy / C.BALL_R) * 0.016
  // A held ball hangs perfectly still, which reads as a bug unless it is lit as
  // something someone did. Rumble only; in a normal match freeze is never set.
  ballMesh.material.emissive.setHex(state.ball.freeze > 0 ? 0x2b6cff : 0x000000)
  freezeRing.visible = state.ball.freeze > 0
  if (freezeRing.visible) {
    freezeRing.position.set(state.ball.x, 0.05, state.ball.y)
    // Turning slowly, so a held ball still reads as something being done to it
    // rather than as a dropped frame.
    freezeRing.rotation.z += 0.01
  }

  renderer.render(scene, camera)
}

/**
 * A car's Rumble visuals: the tether to the ball while a hook or a magnet runs,
 * and an expanding ring for whatever it last fired. Both are driven entirely by
 * state the snapshot carries, so a peer sees them exactly as the host does.
 */
function drawFx(car, ball) {
  // Nothing here exists in a normal match, and there is no reason to build it.
  if (car.fx === undefined && car.hook === undefined) return

  let fx = carFx.get(car.id)
  if (!fx) {
    fx = { tether: makeTether(), burst: makeBurst() }
    scene.add(fx.tether, fx.burst)
    carFx.set(car.id, fx)
  }

  // The tether. A hook pulls the car in, a magnet drags the ball out — one line
  // either way, coloured for which of the two is happening.
  const pulling = car.hook > 0 ? 'hook' : car.magnet > 0 ? 'magnet' : null
  fx.tether.visible = pulling !== null
  if (pulling) {
    // A cylinder rather than a line: WebGL ignores linewidth, so a THREE.Line is
    // one pixel wide whatever it is asked for — which at this camera distance is
    // not a tether, it is a scratch on the screen.
    FROM.set(car.x, TETHER_Y, car.y)
    TO.set(ball.x, C.BALL_R, ball.y)
    DIR.subVectors(TO, FROM)
    const length = DIR.length()
    fx.tether.position.copy(FROM).addScaledVector(DIR, 0.5)
    fx.tether.scale.set(1, Math.max(length, 0.001), 1)
    // The geometry stands along +y, so it is turned to face down the gap.
    if (length > 1e-6) fx.tether.quaternion.setFromUnitVectors(UP, DIR.divideScalar(length))
    fx.tether.material.color.setHex(ITEM_COLOR[pulling])
  }

  // The burst, expanding and fading over the life of the mark.
  const item = car.fx === null || car.fx === undefined ? null : ITEMS[car.fx]
  fx.burst.visible = item !== null && car.fxTimer > 0
  if (fx.burst.visible) {
    const left = Math.min(1, car.fxTimer / C.FX_SECONDS)
    fx.burst.position.set(car.x, 0.04, car.y)
    fx.burst.scale.setScalar(1 + (1 - left) * BURST_R)
    fx.burst.material.color.setHex(ITEM_COLOR[item.key] ?? 0xffffff)
    fx.burst.material.opacity = left
  }
}

function makeTether() {
  // A unit-length cylinder, stretched and turned into place each frame.
  const tether = new THREE.Mesh(
    new THREE.CylinderGeometry(TETHER_R, TETHER_R, 1, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      // Additive, so it lights up against a deliberately dark pitch instead of
      // sinking into it.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  tether.visible = false
  return tether
}

function makeBurst() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1.2, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  return ring
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
