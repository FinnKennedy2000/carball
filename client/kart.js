// The kart page. Two ways in from the same screen:
//
//   Solo   — the simulation runs right here against five AI. No account, no
//            Realtime, nothing to reach.
//   Room   — the same simulation, owned by one player's browser and broadcast,
//            over the transport in net.js that the football game already uses.
//            Finish order is the result: first across the line wins.
//
// Sim x maps to world x and sim y to world z, as in render.js, so a positive
// heading is a negated rotation.y.

import * as THREE from 'three'
import * as K from '../shared/kart.js'
import { IN_ITEM, IN_BOOST } from '../shared/constants.js'
import { cleanCode } from '../shared/protocol.js'
import { startInput, currentBits, isTyping } from './input.js'
import {
  configure,
  createRoom,
  joinRoom,
  beginMatch,
  sampleState,
  handlers,
  enabled as netEnabled,
} from './net.js'

const el = (id) => document.getElementById(id)

const COLORS = [0x3b82f6, 0xf97316, 0x22c55e, 0xef4444, 0xa855f7, 0xeab308]
const AI_NAMES = ['Bolt', 'Ripsaw', 'Comet', 'Nitro', 'Sledge']
const SOLO_ID = 1
const MAX_CATCHUP = 5
const STORED_NAME = 'carball.name'

let scene
let camera
let renderer
const kartMeshes = new Map()
const boxMeshes = []
const shellPool = []
const hazardPool = []
const camPos = new THREE.Vector3()
const camAim = new THREE.Vector3()

let race = null // the live state: our own in solo, the sampled snapshot in a room
let myId = SOLO_ID
let solo = true
let isHost = false
let roomCode = null
let roster = []
let results = null // the finishing order, once a room's race is over
let lastFrame = 0
let accumulator = 0

configure({
  makeWorker: () => new Worker(new URL('./kart-sim-worker.js', import.meta.url), { type: 'module' }),
  blend: blendKart,
})

initRenderer()
startInput()
wireGate()
requestAnimationFrame(frame)

// Getting in ----------------------------------------------------------------

function wireGate() {
  const name = el('name')
  name.value = localStorage.getItem(STORED_NAME) || ''
  const joined = cleanCode(location.hash.slice(1))
  if (joined) el('code').value = joined
  if (!netEnabled) {
    el('room-side').hidden = true
    el('gate-note').textContent = 'Rooms need a Supabase project configured. Solo works either way.'
  }

  el('solo').addEventListener('click', startSolo)
  el('create').addEventListener('click', () => enterRoom(null))
  el('join').addEventListener('click', () => enterRoom(el('code').value))
  el('code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') enterRoom(el('code').value)
  })
  el('start').addEventListener('click', () => beginMatch())
  el('restart').addEventListener('click', () => {
    if (solo) {
      el('results').hidden = true
      startSolo()
    } else if (isHost) {
      beginMatch()
    }
  })
  el('copy').addEventListener('click', () => {
    const link = `${location.origin}${location.pathname}#${roomCode}`
    navigator.clipboard?.writeText(link)
    el('copy').textContent = 'Copied'
  })

  handlers.onJoined = (msg) => {
    myId = msg.id
    roomCode = msg.code
    solo = false
    el('gate').hidden = true
    el('room-strip').hidden = false
    el('room-code').textContent = msg.code
    el('start').hidden = !isHost
    location.hash = msg.code // a refresh rejoins rather than opening a room
  }
  handlers.onRoster = (players) => {
    roster = players
  }
  handlers.onError = (reason) => {
    el('gate-note').textContent = reason
    el('gate').hidden = false
  }
  handlers.onMatchOver = (_score, players) => {
    results = players.map((p) => ({ ...p, me: p.id === myId }))
  }
}

function saveName() {
  const value = el('name').value.trim().slice(0, 16) || 'You'
  localStorage.setItem(STORED_NAME, value)
  return value
}

function startSolo() {
  const name = saveName()
  solo = true
  myId = SOLO_ID
  results = null
  el('gate').hidden = true
  el('room-strip').hidden = true
  const racers = [{ id: SOLO_ID, name, ai: false }]
  AI_NAMES.forEach((n, i) => racers.push({ id: i + 2, name: n, ai: true }))
  race = K.createRace(racers, (Math.random() * 2 ** 32) >>> 0)
  K.begin(race)
  clearKarts()
  accumulator = 0
  lastFrame = performance.now()
}

async function enterRoom(code) {
  const name = saveName()
  const clean = cleanCode(code || '')
  if (code && !clean) {
    el('gate-note').textContent = 'A room code is four letters.'
    return
  }
  el('gate-note').textContent = clean ? 'Joining…' : 'Opening a room…'
  results = null
  clearKarts()
  try {
    isHost = !clean
    // Team and car mean nothing in a race; the channel's hello carries them
    // because it is the football game's message, and they are simply ignored.
    if (clean) await joinRoom(name, clean, null, 0)
    else await createRoom(name, null, 0, 'kart')
  } catch (err) {
    isHost = false
    el('gate-note').textContent = err?.message ?? 'Could not reach the room.'
  }
}

function clearKarts() {
  for (const [, mesh] of kartMeshes) scene.remove(mesh)
  kartMeshes.clear()
}

/** Two snapshots straddling the render moment. Bodies move; the rest is discrete. */
function blendKart(a, b, t) {
  const prev = new Map(a.karts.map((k) => [k.id, k]))
  return {
    ...b,
    phase: a.phase,
    timer: a.timer,
    time: a.time,
    karts: b.karts.map((kb) => {
      const ka = prev.get(kb.id)
      if (!ka) return kb // joined between snapshots
      return {
        ...kb,
        x: lerp(ka.x, kb.x, t),
        y: lerp(ka.y, kb.y, t),
        heading: lerpAngle(ka.heading, kb.heading, t),
      }
    }),
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// Frame ---------------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame)
  const dt = 1 / 60
  accumulator += Math.min(0.25, (now - lastFrame) / 1000)
  lastFrame = now

  if (solo && race) {
    let steps = 0
    while (accumulator >= dt && steps < MAX_CATCHUP) {
      K.step(race, { [myId]: playerBits() })
      accumulator -= dt
      steps++
    }
    if (accumulator >= dt) accumulator = 0
  } else if (!solo) {
    // In a room the input goes over the channel on its own timer, and the state
    // is whatever the host last said it was.
    race = sampleState() ?? race
  }

  if (race) {
    draw()
    updateHud()
  }
  renderer.render(scene, camera)
}

function playerBits() {
  let bits = currentBits()
  // Space fires as well as E: on a kart there is nothing else for it to do.
  if (bits & IN_BOOST) bits |= IN_ITEM
  return bits
}

// Scene ---------------------------------------------------------------------

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: el('view'), antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0e14)
  scene.fog = new THREE.Fog(0x0b0e14, 120, 320)

  camera = new THREE.PerspectiveCamera(60, 1, 1, 900)
  camera.position.set(0, 40, 90)
  camera.lookAt(0, 0, 0)

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

  // Item boxes: one mesh per spot, hidden while that box is on its cooldown.
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
  const geo = strip(halfWidth, (x, z) => [x, y, z])
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
  for (let i = 0; i < n; i++) {
    const [ox, oz] = offsetPoint(i, offset)
    verts.push(ox, 0, oz, ox, height, oz)
  }
  return new THREE.Mesh(
    geometryFrom(verts, n),
    new THREE.MeshStandardMaterial({ color: 0x596b8c, roughness: 0.8, side: THREE.DoubleSide }),
  )
}

function strip(halfWidth, place) {
  const n = K.TRACK.pts.length
  const verts = []
  for (let i = 0; i < n; i++) {
    const [lx, lz] = offsetPoint(i, halfWidth)
    const [rx, rz] = offsetPoint(i, -halfWidth)
    verts.push(...place(lx, lz), ...place(rx, rz))
  }
  return geometryFrom(verts, n)
}

/** Node `i` of the centre line, pushed sideways onto its own normal. */
function offsetPoint(i, offset) {
  const pts = K.TRACK.pts
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return [a.x - ((b.y - a.y) / len) * offset, a.y + ((b.x - a.x) / len) * offset]
}

/** Two vertices per node, closed back onto the first: a ring of quads. */
function geometryFrom(verts, n) {
  const idx = []
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = ((i + 1) % n) * 2
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
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

function draw() {
  const seen = new Set()
  for (const kart of race.karts) {
    seen.add(kart.id)
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
    mesh.scale.setScalar(kart.shrink > 0 ? 0.55 : 1)
    mesh.children[0].material.emissive.setHex(kart.star > 0 ? 0xffe066 : 0x000000)
  }
  for (const [id, mesh] of kartMeshes) {
    if (seen.has(id)) continue
    scene.remove(mesh)
    kartMeshes.delete(id)
  }

  race.boxes.forEach((box, i) => {
    const mesh = boxMeshes[i]
    if (!mesh) return
    // The host holds boxes as objects; a snapshot carries only the cooldown,
    // since a box never moves.
    mesh.visible = (typeof box === 'number' ? box : box.cooldown) === 0
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

  const me = race.karts.find((k) => k.id === myId) ?? race.karts[0]
  if (me) {
    const fx = Math.cos(me.heading)
    const fy = Math.sin(me.heading)
    camPos.set(me.x - fx * 22, 11, me.y - fy * 22)
    // Eased rather than pinned, so a spin-out does not whip the camera round.
    camera.position.lerp(camPos, 0.12)
    camAim.set(me.x + fx * 16, 2.5, me.y + fy * 16)
    camera.lookAt(camAim)
  }
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
  const me = race.karts.find((k) => k.id === myId)
  const waiting = race.phase === 'WAITING'
  el('hud').hidden = waiting
  // The grid card comes down the moment the lights do, whoever started it.
  el('waiting').hidden = !waiting
  if (waiting) {
    showWaitingRoom()
    return
  }
  // Seated after the lights went out: there is no kart to follow yet, and the
  // grid card is not up either, so the banner is the only place to say so.
  if (!me) {
    const banner = el('banner')
    banner.textContent = 'IN THE NEXT RACE'
    banner.hidden = race.phase === 'OVER'
    return
  }

  el('lap').textContent = `${Math.min(me.lap + 1, race.laps)}/${race.laps}`
  el('place').textContent = ordinal(me.place)
  el('place-of').textContent = `of ${race.karts.length}`
  el('speed').textContent = Math.round(Math.hypot(me.vx, me.vy) * 3.6)
  el('time').textContent = clock(race.time)

  const item = me.item === null || me.item === undefined ? null : K.ITEMS[me.item]
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

  el('standings').innerHTML = [...race.karts]
    .sort((a, b) => a.place - b.place)
    .map(
      (k) =>
        `<li class="${k.id === myId ? 'me' : ''}"><b>${k.place}</b><span>${escapeHtml(k.name)}</span></li>`,
    )
    .join('')

  if (race.phase === 'OVER') {
    if (el('results').hidden) showResults()
  } else if (!el('results').hidden) {
    // The host started the next one: everyone's card comes down with it.
    el('results').hidden = true
    results = null
  }
}

/** Before the lights, in a room: who is in, and the host's start button. */
function showWaitingRoom() {
  el('results').hidden = true
  el('start').hidden = !isHost
  el('waiting-list').innerHTML = roster
    .map((p) => `<li class="${p.id === myId ? 'me' : ''}">${escapeHtml(p.name)}</li>`)
    .join('')
  el('waiting-hint').textContent = isHost
    ? 'Start when everyone is in. Empty seats are filled with AI.'
    : 'Waiting for the host to start the race.'
}

function showResults() {
  el('waiting').hidden = true
  el('results').hidden = false
  // In a room the host's message is the record; solo, the state is right here.
  const rows =
    results ??
    [...race.karts]
      .sort((a, b) => a.place - b.place)
      .map((k) => ({ name: k.name, place: k.place, time: k.finished, me: k.id === myId }))

  const mine = rows.find((r) => r.me)
  el('verdict').textContent = !mine
    ? 'Race over'
    : mine.place === 1
      ? 'Race won'
      : mine.place <= 3
        ? `${ordinal(mine.place)} — podium`
        : ordinal(mine.place)
  el('result-rows').innerHTML = rows
    .map(
      (r) => `<tr class="${r.me ? 'me' : ''}">
        <td>${r.place}</td><td>${escapeHtml(r.name)}</td>
        <td class="tabular">${r.time === null || r.time === undefined ? 'DNF' : clock(r.time)}</td>
      </tr>`,
    )
    .join('')
  // Only the host can put a room back on the grid; solo can always go again.
  el('restart').hidden = !solo && !isHost
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

// Enter in the name field is the same as pressing whatever is in front of you.
el('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && isTyping(e.target)) el('solo').click()
})
