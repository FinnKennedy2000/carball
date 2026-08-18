// The kart game's page: one tab, one race, five AI. The simulation is
// shared/kart.js and runs right here on a fixed timestep — there is no host and
// no channel, because there is nobody else in the race to agree with.
//
// Sim x maps to world x and sim y to world z, exactly as render.js does it, so
// a positive heading is a negated rotation.y.

import * as THREE from 'three'
import * as K from '../shared/kart.js'
import { IN_ITEM, IN_BOOST } from '../shared/constants.js'
import { startInput, currentBits } from './input.js'

const el = (id) => document.getElementById(id)

const COLORS = [0x3b82f6, 0xf97316, 0x22c55e, 0xef4444, 0xa855f7, 0xeab308]
const AI_NAMES = ['Bolt', 'Ripsaw', 'Comet', 'Nitro', 'Sledge']
const PLAYER_ID = 1
const MAX_CATCHUP = 5

let race = null
let scene
let camera
let renderer
const kartMeshes = new Map()
const boxMeshes = []
const shellPool = []
const hazardPool = []
const camPos = new THREE.Vector3()
const camAim = new THREE.Vector3()
let lastFrame = 0
let accumulator = 0

initRenderer()
startInput()
newRace()
el('restart').addEventListener('click', () => {
  el('results').hidden = true
  newRace()
})
requestAnimationFrame(frame)

function newRace() {
  const name = localStorage.getItem('carball.name') || 'You'
  const racers = [{ id: PLAYER_ID, name, ai: false }]
  AI_NAMES.forEach((n, i) => racers.push({ id: i + 2, name: n, ai: true }))
  race = K.createRace(racers, (Math.random() * 2 ** 32) >>> 0)
  for (const [, mesh] of kartMeshes) scene.remove(mesh)
  kartMeshes.clear()
  accumulator = 0
  lastFrame = performance.now()
}

function frame(now) {
  requestAnimationFrame(frame)
  accumulator += Math.min(0.25, (now - lastFrame) / 1000)
  lastFrame = now

  let steps = 0
  const dt = 1 / 60
  while (accumulator >= dt && steps < MAX_CATCHUP) {
    let bits = currentBits()
    // Space fires as well as E: on a kart there is nothing else for it to do.
    if (bits & IN_BOOST) bits |= IN_ITEM
    K.step(race, { [PLAYER_ID]: bits })
    accumulator -= dt
    steps++
  }
  if (accumulator >= dt) accumulator = 0

  draw()
  updateHud()
}

// Scene ---------------------------------------------------------------------

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: el('view'), antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0e14)
  scene.fog = new THREE.Fog(0x0b0e14, 120, 320)

  camera = new THREE.PerspectiveCamera(60, 1, 1, 900)
  camera.position.set(0, 20, 40)

  scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x1a2b1c, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-60, 120, 40)
  scene.add(sun)

  buildTrack()
  resize()
  addEventListener('resize', resize)
}

function buildTrack() {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(K.TRACK_R * 2.2, 64),
    new THREE.MeshStandardMaterial({ color: 0x1c3a26, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.2
  scene.add(ground)

  scene.add(ribbon(K.HALF_WIDTH + K.KERB, 0.01, 0x6b4a22)) // the kerb, then
  scene.add(ribbon(K.HALF_WIDTH, 0.03, 0x49536b)) // the tarmac on top of it
  scene.add(ribbon(0.35, 0.05, 0xffffff, 0.35)) // the racing line

  // The barrier, as a wall either side. Same polyline, stood up.
  for (const side of [1, -1]) scene.add(wall(side * (K.HALF_WIDTH + K.KERB), 2.4))

  // Start/finish, a stripe across the road at s = 0.
  const p = K.pointAt(0)
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(K.HALF_WIDTH * 2, 2.5),
    new THREE.MeshBasicMaterial({ color: 0xf3f5fe, transparent: true, opacity: 0.75 }),
  )
  line.rotation.x = -Math.PI / 2
  line.rotation.z = -Math.atan2(p.ty, p.tx)
  line.position.set(p.x, 0.07, p.y)
  scene.add(line)

  // Item boxes, one mesh each, hidden while a box is on its cooldown.
  const geo = new THREE.BoxGeometry(2.6, 2.6, 2.6)
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0x6b4b00,
    transparent: true,
    opacity: 0.85,
    flatShading: true,
  })
  for (const box of K.boxSpots()) {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(box.x, 2, box.y)
    scene.add(mesh)
    boxMeshes.push(mesh)
  }
}

/** A flat strip of the given half-width, following the centre line. */
function ribbon(halfWidth, y, color, opacity = 1) {
  const pts = K.TRACK.pts
  const n = pts.length
  const verts = []
  const idx = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    verts.push(a.x + nx * halfWidth, y, a.y + ny * halfWidth)
    verts.push(a.x - nx * halfWidth, y, a.y - ny * halfWidth)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = ((i + 1) % n) * 2
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
  )
}

/** A vertical band standing on the polyline, offset sideways by `offset`. */
function wall(offset, height) {
  const pts = K.TRACK.pts
  const n = pts.length
  const verts = []
  const idx = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    verts.push(a.x + nx * offset, 0, a.y + ny * offset)
    verts.push(a.x + nx * offset, height, a.y + ny * offset)
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = ((i + 1) % n) * 2
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x596b8c, roughness: 0.8, side: THREE.DoubleSide }),
  )
}

function makeKart(color) {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1.1, 2.4),
    new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.45 }),
  )
  body.position.y = 0.9
  group.add(body)
  const driver = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 1.2, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x11151d, flatShading: true }),
  )
  driver.position.set(-0.4, 2, 0)
  group.add(driver)
  for (const [dx, dz] of [[1.4, 1.3], [1.4, -1.3], [-1.4, 1.3], [-1.4, -1.3]]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1d26, flatShading: true }),
    )
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(dx, 0.7, dz)
    group.add(wheel)
  }
  return group
}

// Frame ---------------------------------------------------------------------

function draw() {
  for (const kart of race.karts) {
    let mesh = kartMeshes.get(kart.id)
    if (!mesh) {
      mesh = makeKart(COLORS[(kart.id - 1) % COLORS.length])
      kartMeshes.set(kart.id, mesh)
      scene.add(mesh)
    }
    mesh.position.set(kart.x, 0, kart.y)
    mesh.rotation.y = -kart.heading
    // Shrunk by a Bolt, or lit up by a star: both have to be readable at a
    // glance from behind, so they change the shape rather than only a number.
    const shrunk = kart.shrink > 0
    mesh.scale.setScalar(shrunk ? 0.55 : 1)
    const glow = kart.star > 0 ? 0xffe066 : 0x000000
    mesh.children[0].material.emissive.setHex(glow)
  }

  race.boxes.forEach((box, i) => {
    const mesh = boxMeshes[i]
    if (!mesh) return
    mesh.visible = box.cooldown === 0
    mesh.rotation.y += 0.03
    mesh.rotation.x += 0.01
  })

  syncPool(shellPool, race.shells, makeShell, (mesh, shell) => {
    mesh.position.set(shell.x, 1.2, shell.y)
    mesh.material.color.setHex(shell.red ? 0xef4444 : 0x22c55e)
  })
  syncPool(hazardPool, race.hazards, makeBanana, (mesh, hazard) => {
    mesh.position.set(hazard.x, 0.8, hazard.y)
  })

  const me = race.karts.find((k) => k.id === PLAYER_ID)
  if (me) {
    const fx = Math.cos(me.heading)
    const fy = Math.sin(me.heading)
    camPos.set(me.x - fx * 22, 11, me.y - fy * 22)
    // Eased rather than pinned, so a spin-out does not whip the camera round
    // with the kart.
    camera.position.lerp(camPos, 0.12)
    camAim.set(me.x + fx * 16, 2.5, me.y + fy * 16)
    camera.lookAt(camAim)
  }
  renderer.render(scene, camera)
}

/** Grow a mesh pool to fit a list of bodies, hide the rest. */
function syncPool(pool, bodies, make, place) {
  while (pool.length < bodies.length) {
    const mesh = make()
    scene.add(mesh)
    pool.push(mesh)
  }
  pool.forEach((mesh, i) => {
    mesh.visible = i < bodies.length
    if (mesh.visible) place(mesh, bodies[i])
  })
}

function makeShell() {
  return new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.2, 0),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, flatShading: true, emissive: 0x0d2f18 }),
  )
}

function makeBanana() {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 1.6, 6),
    new THREE.MeshStandardMaterial({ color: 0xeab308, flatShading: true }),
  )
  mesh.rotation.z = Math.PI
  return mesh
}

// HUD -----------------------------------------------------------------------

function updateHud() {
  const me = race.karts.find((k) => k.id === PLAYER_ID)
  if (!me) return

  el('lap').textContent = `${Math.min(me.lap + 1, race.laps)}/${race.laps}`
  el('place').textContent = ordinal(me.place)
  el('place-of').textContent = `of ${race.karts.length}`
  el('speed').textContent = Math.round(Math.hypot(me.vx, me.vy) * 3.6)
  el('time').textContent = clock(race.time)

  const item = me.item === null ? null : K.ITEMS[me.item]
  el('item-name').textContent = item ? item.name : '—'
  el('item-hint').textContent = item ? item.hint : 'drive through a box'
  el('item-slot').classList.toggle('full', Boolean(item))

  const banner = el('banner')
  if (race.phase === 'COUNT') {
    const n = Math.ceil(race.timer)
    banner.textContent = n > 0 ? String(n) : 'GO'
    banner.hidden = false
  } else if (me.spin > 0) {
    banner.textContent = 'SPUN OUT'
    banner.hidden = false
  } else if (race.time < 1.5) {
    banner.textContent = 'GO'
    banner.hidden = false
  } else {
    banner.hidden = true
  }

  const standings = el('standings')
  const order = [...race.karts].sort((a, b) => a.place - b.place)
  standings.innerHTML = order
    .map(
      (k) =>
        `<li class="${k.id === PLAYER_ID ? 'me' : ''}"><b>${k.place}</b><span>${escapeHtml(k.name)}</span></li>`,
    )
    .join('')

  if (race.phase === 'OVER' && el('results').hidden) showResults(me)
}

function showResults(me) {
  el('results').hidden = false
  el('verdict').textContent =
    me.place === 1 ? 'Race won' : me.place <= 3 ? `${ordinal(me.place)} — podium` : ordinal(me.place)
  const order = [...race.karts].sort((a, b) => a.place - b.place)
  el('result-rows').innerHTML = order
    .map(
      (k) => `<tr class="${k.id === PLAYER_ID ? 'me' : ''}">
        <td>${k.place}</td><td>${escapeHtml(k.name)}</td>
        <td class="tabular">${k.finished === null ? 'DNF' : clock(k.finished)}</td>
      </tr>`,
    )
    .join('')
}

function ordinal(n) {
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

function clock(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds * 100) % 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
