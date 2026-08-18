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

// One palette for both the bodywork and the dot beside a name in the HUD, so a
// kart is the same colour wherever it appears. THREE takes a CSS string.
const COLORS = ['#3b82f6', '#f97316', '#22c55e', '#ef4444', '#a855f7', '#eab308']
const kartColor = (id) => COLORS[(id - 1) % COLORS.length]

/**
 * The item marks, from the design: one flat glyph per item in its own colour.
 * Keyed by ITEMS' key rather than its index, which is a wire format.
 */
const ITEM_ART = {
  boost: {
    color: '#f0b429',
    svg: '<g fill="none" stroke="#f0b429" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10 L18 20 L8 30"/><path d="M20 10 L30 20 L20 30"/></g>',
  },
  banana: {
    color: '#eab308',
    svg: '<path d="M9 9 C10 24 17 31 32 31 C30 23 25 16 18 13 C15 11.5 12 10 9 9 Z" fill="#eab308"/><path d="M9 9 C11 22 18 29 32 31" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.6"/>',
  },
  green: {
    color: '#22c55e',
    svg: '<path d="M20 7 L31 13 L31 26 L20 32 L9 26 L9 13 Z" fill="#22c55e"/><path d="M20 7 L20 32 M9 13 L31 26 M31 13 L9 26" stroke="rgba(0,0,0,0.32)" stroke-width="1.6" fill="none"/>',
  },
  red: {
    color: '#ef4444',
    svg: '<path d="M20 7 L31 13 L31 26 L20 32 L9 26 L9 13 Z" fill="#ef4444"/><path d="M20 7 L20 32 M9 13 L31 26 M31 13 L9 26" stroke="rgba(0,0,0,0.32)" stroke-width="1.6" fill="none"/>',
  },
  bolt: {
    color: '#9184d9',
    svg: '<path d="M23 6 L11 22 L18 22 L15 34 L29 17 L21.5 17 Z" fill="#9184d9"/>',
  },
  star: {
    color: '#ffd166',
    svg: '<path d="M20 6 L24.2 15.6 L34.6 16.7 L26.8 23.6 L29 33.8 L20 28.4 L11 33.8 L13.2 23.6 L5.4 16.7 L15.8 15.6 Z" fill="#ffd166"/>',
  },
}
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
// What the item slot and the effect chips are currently showing, so neither is
// rebuilt on a frame where nothing about them changed.
let shownItem
let shownEffects = ''
// The slot reels through every item before settling on the one you actually
// picked up: which is which matters, and a mark that simply appears is missed
// at the speed the rest of the screen is moving.
const REEL_MS = 900
let heldItem // what the sim says is in the slot, reel or no reel
let reelUntil = 0
let reelAt = 0 // when the reel takes its next step
let reelIndex = 0
// The lap the banner last called, and when the final-lap flash started: a lap
// turning over is a moment, and the banner has to be told to stop showing it.
let calledLap = -1
let flashUntil = 0

configure({
  makeWorker: () => new Worker(new URL('./kart-sim-worker.js', import.meta.url), { type: 'module' }),
  blend: blendKart,
})

initRenderer()
startInput()
wireGate()
showItemSet()
requestAnimationFrame(frame)

// Getting in ----------------------------------------------------------------

function wireGate() {
  const name = el('name')
  name.value = localStorage.getItem(STORED_NAME) || ''
  // An invite link is this page's own URL with the room in the hash, so a code
  // there means someone sent us to a room rather than to the way-in screen.
  const invited = netEnabled ? cleanCode(location.hash.slice(1)) : null
  if (invited) el('code').value = invited
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
  el('copy').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#${roomCode}`
    try {
      await navigator.clipboard.writeText(link)
      el('copy').textContent = 'Link copied'
    } catch {
      // No clipboard outside a secure context — the code is the shareable part.
      el('copy').textContent = `Room code ${roomCode}`
    }
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

  // Arriving on someone's link goes straight into their room, exactly as the
  // football page does it. Without a name to send there is nothing to do but
  // ask for one — the code is already in the box, so Join is one press away.
  if (invited) join(invited)

  // A link pasted into a tab that is already on this page changes the hash
  // without reloading anything, so the load-time check above never runs — the
  // link would look broken. onJoined sets the hash itself, hence the guard.
  addEventListener('hashchange', () => {
    const code = netEnabled ? cleanCode(location.hash.slice(1)) : null
    if (code && code !== roomCode) {
      el('code').value = code
      join(code)
    }
  })

  /** Straight in if we have a name to send, otherwise ask for one. */
  function join(code) {
    if (name.value) enterRoom(code)
    else {
      el('gate').hidden = false
      el('gate-note').textContent = `Room ${code} — your name, then Join.`
      name.focus()
    }
  }
}

/**
 * The item set on the way-in screen: each mark, what it does, and how the roll
 * leans by where you are running. Drawn once, from the sim's own weight table
 * rather than a copy of it.
 */
function showItemSet() {
  const max = Math.max(...K.ROLL_FRONT, ...K.ROLL_BACK)
  const bar = (label, weight) =>
    `<span class="weight"><span>${label}</span><span class="bar"><i style="width:${(weight / max) * 100}%"></i></span></span>`
  el('items-grid').innerHTML = K.ITEMS.map((item, i) => {
    const art = ITEM_ART[item.key]
    return `<div class="item-card" style="--item:${art.color}">
      <div class="head">
        <span class="mark"><svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">${art.svg}</svg></span>
        <span><span class="name">${item.name}</span><br /><span class="hint">${item.hint}</span></span>
      </div>
      <div class="weights">${bar('Front', K.ROLL_FRONT[i])}${bar('Back', K.ROLL_BACK[i])}</div>
    </div>`
  }).join('')
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
  shownItem = undefined
  heldItem = undefined
  reelUntil = 0
  calledLap = -1
  flashUntil = 0
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
  // Far below the lowest dip, so the hills never poke through it: at this
  // distance it is a horizon rather than ground you look at.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(K.TRACK_R * 2.2, 64),
    new THREE.MeshStandardMaterial({ color: 0x16301f, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -20
  scene.add(ground)

  // The road's width varies around the lap, so every strip is built from
  // halfWidthAt rather than one number — the tarmac you see is the tarmac the
  // physics grips. The kerb stops where the drops are; the road does not.
  const half = (i) => K.halfWidthAt(K.TRACK.cum[i])
  const onVoid = (i) => K.overVoid(K.TRACK.cum[i])
  const solid = (i) => !onVoid(i) && !onVoid((i + 1) % K.TRACK_N)

  // Grass that climbs with the road, so the tarmac is laid on a hillside rather
  // than floating over a flat green plate. Kept in close: pushed much further
  // out, the inside of the hairpin folds over itself.
  scene.add(ribbon((i) => half(i) + 22, -0.35, 0x1c3a26, 1, solid))
  // Only where the ground gives out: the drop. No wider than the grass it
  // replaces, or it wedges out past the hillside as a black shard, and far
  // enough down to read as somewhere you would not want to be.
  scene.add(ribbon((i) => half(i) + 22, -14, 0x05070c, 1, (i) => !solid(i)))
  scene.add(ribbon((i) => half(i) + K.KERB, 0.01, 0x6b4a22, 1, solid)) // the kerb, then
  scene.add(ribbon(half, 0.03, 0x49536b)) // the tarmac on top of it
  // The racing line, in dashes rather than one continuous stripe: a solid line
  // gives the eye nothing to track, and the dashes flicking past the nose are
  // most of what tells you how fast you are actually going.
  scene.add(dashes(0.4, 0.05, 0xffffff, 0.4))

  // The barrier, as a wall either side — with the void stretches left open,
  // which is what makes them look like somewhere you can go off.
  for (const side of [1, -1]) {
    scene.add(wall((i) => side * (half(i) + K.KERB), 2.4, solid))
  }

  buildFinish()

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
    mesh.position.set(box.x, K.heightAt(box.s) + 2, box.y)
    scene.add(mesh)
    boxMeshes.push(mesh)
  }
}

/**
 * The line, as something you can see coming: a chequered band across the road
 * under a gantry over it. A painted stripe is invisible until you are on top of
 * it, which is no way to know where a race ends.
 */
function buildFinish() {
  const p = K.pointAt(0)
  const half = K.halfWidthAt(0)
  const base = K.heightAt(0)
  // Along the road, and across it. Everything below is placed in those two.
  const ax = p.tx
  const az = p.ty
  const bx = -p.ty
  const bz = p.tx

  const squares = 14
  const size = (half * 2) / squares
  const light = new THREE.MeshBasicMaterial({ color: 0xf3f5fe })
  const dark = new THREE.MeshBasicMaterial({ color: 0x11151d })
  const tile = new THREE.PlaneGeometry(size, size)
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < squares; col++) {
      const mesh = new THREE.Mesh(tile, (row + col) % 2 === 0 ? light : dark)
      const across = -half + size * (col + 0.5)
      const along = size * (row - 0.5)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(p.x + bx * across + ax * along, base + 0.07, p.y + bz * across + az * along)
      scene.add(mesh)
    }
  }

  // The gantry: a post either side of the road and a beam across the top, so
  // the finish is a thing on the horizon rather than a mark on the floor.
  const postH = 9
  const postGeo = new THREE.BoxGeometry(1.2, postH, 1.2)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x596b8c, flatShading: true })
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(postGeo, postMat)
    const across = side * (half + 1.6)
    post.position.set(p.x + bx * across, base + postH / 2, p.y + bz * across)
    scene.add(post)
  }
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry((half + 2.2) * 2, 2.2, 1),
    new THREE.MeshStandardMaterial({ color: 0x9184d9, emissive: 0x2b2741, flatShading: true }),
  )
  beam.position.set(p.x, base + postH - 1, p.y)
  // Its length runs across the road, not along it: a turn about y maps the
  // box's own +x onto the across vector.
  beam.rotation.y = Math.atan2(-bz, bx)
  scene.add(beam)
}

/**
 * A flat strip following the centre line. `halfWidth` is a function of the node
 * index, and `keep` decides which segments are drawn at all.
 */
function ribbon(halfWidth, y, color, opacity = 1, keep) {
  // `y` is a height above the road now, not a height above the world.
  const geo = strip(halfWidth, (x, z, i) => [x, nodeY(i) + y, z], keep)
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

/** Every other segment of the centre line, as a flat dash. */
function dashes(halfWidth, y, color, opacity) {
  const pts = K.TRACK.pts
  const verts = []
  const idx = []
  for (let i = 0; i < pts.length; i += 2) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / len) * halfWidth
    const nz = ((b.x - a.x) / len) * halfWidth
    const v = verts.length / 3
    const ay = nodeY(i) + y
    const by = nodeY((i + 1) % pts.length) + y
    verts.push(a.x + nx, ay, a.y + nz, a.x - nx, ay, a.y - nz, b.x + nx, by, b.y + nz, b.x - nx, by, b.y - nz)
    idx.push(v, v + 2, v + 1, v + 2, v + 3, v + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }),
  )
}

/** A vertical band standing on the polyline, offset sideways by `offset(i)`. */
function wall(offset, height, keep) {
  const n = K.TRACK.pts.length
  const verts = []
  for (let i = 0; i < n; i++) {
    const [ox, oz] = offsetPoint(i, offset(i))
    verts.push(ox, nodeY(i), oz, ox, nodeY(i) + height, oz)
  }
  return new THREE.Mesh(
    geometryFrom(verts, n, keep),
    new THREE.MeshStandardMaterial({ color: 0x596b8c, roughness: 0.8, side: THREE.DoubleSide }),
  )
}

function strip(halfWidth, place, keep) {
  const n = K.TRACK.pts.length
  const verts = []
  for (let i = 0; i < n; i++) {
    const [lx, lz] = offsetPoint(i, halfWidth(i))
    const [rx, rz] = offsetPoint(i, -halfWidth(i))
    verts.push(...place(lx, lz, i), ...place(rx, rz, i))
  }
  return geometryFrom(verts, n, keep)
}

/** How high the road stands at polyline node `i`. */
function nodeY(i) {
  return K.heightAt(K.TRACK.cum[i])
}

/** The road's height under any point on the map, for the things that move. */
function groundY(x, z) {
  return K.heightAt(K.project(x, z).s)
}

/** Node `i` of the centre line, pushed sideways onto its own normal. */
function offsetPoint(i, offset) {
  const pts = K.TRACK.pts
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return [a.x - ((b.y - a.y) / len) * offset, a.y + ((b.x - a.x) / len) * offset]
}

/**
 * Two vertices per node, closed back onto the first: a ring of quads. `keep`
 * drops the segment that starts at a node, which is how the scenery is left out
 * over a drop without building a separate mesh per run of road.
 */
function geometryFrom(verts, n, keep = () => true) {
  const idx = []
  for (let i = 0; i < n; i++) {
    if (!keep(i)) continue
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
      mesh = makeKart(kartColor(kart.id))
      kartMeshes.set(kart.id, mesh)
      scene.add(mesh)
    }
    if (kart.respawn > 0) {
      // Fished out: it drops out of the world where it went over, is carried
      // back up the road, and is set down on the spot the sim will resume it.
      const t = 1 - kart.respawn / K.RESPAWN_SECONDS
      const home = K.pointAt(kart.recoverAt)
      mesh.position.set(
        kart.x + (home.x - kart.x) * t,
        K.heightAt(kart.recoverAt) - 26 * Math.sin(Math.PI * t),
        kart.y + (home.y - kart.y) * t,
      )
      mesh.rotation.set(0, -kart.heading - t * 6, 0)
    } else {
      mesh.position.set(kart.x, K.heightAt(kart.s), kart.y)
      // Nose up the climb and down the drop. 'YZX' so the pitch is taken about
      // the kart's own lateral axis, after it has been turned to its heading.
      mesh.rotation.set(0, -kart.heading, Math.atan(K.slopeAt(kart.s)), 'YZX')
    }
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
    mesh.position.set(shell.x, groundY(shell.x, shell.y) + 1.2, shell.y)
    mesh.material.color.setHex(shell.red ? 0xef4444 : 0x22c55e)
  })
  syncPool(hazardPool, race.hazards, makeBanana, (mesh, hazard) => {
    mesh.position.set(hazard.x, groundY(hazard.x, hazard.y) + 0.8, hazard.y)
  })

  const me = race.karts.find((k) => k.id === myId) ?? race.karts[0]
  if (me) {
    const fx = Math.cos(me.heading)
    const fy = Math.sin(me.heading)
    // How fast this feels, as a fraction of flat out. Everything below hangs
    // off it: the eye reads speed from the view widening and the camera
    // dropping back far more than from a number in the corner.
    const rush = Math.min(1.4, Math.hypot(me.vx, me.vy) / K.MAX_SPEED)
    // The camera rides the road too, or a crest throws it underground and the
    // next dip leaves it looking at the sky.
    const here = K.heightAt(me.s)
    camPos.set(me.x - fx * (20 + rush * 6), here + 10.5 - rush * 2, me.y - fy * (20 + rush * 6))
    // Eased rather than pinned, so a spin-out does not whip the camera round.
    camera.position.lerp(camPos, 0.12)
    const aimX = me.x + fx * 16
    const aimZ = me.y + fy * 16
    camAim.set(aimX, groundY(aimX, aimZ) + 2.5, aimZ)
    camera.lookAt(camAim)

    const wantFov = 60 + rush * 14 + (me.boost > 0 ? 6 : 0)
    camera.fov += (wantFov - camera.fov) * 0.08
    camera.updateProjectionMatrix()

    // Streaks down the edges of the screen, in from nothing at about half of
    // top speed so ordinary running is not permanently smeared.
    el('speed-lines').style.opacity = Math.max(0, Math.min(1, (rush - 0.5) * 2.2))
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

  el('lap').textContent = String(Math.min(me.lap + 1, race.laps))
  el('lap-total').textContent = `/${race.laps}`
  el('place').textContent = String(me.place)
  el('place-suffix').textContent = ordinalSuffix(me.place)
  el('speed').textContent = Math.round(Math.hypot(me.vx, me.vy) * 3.6)
  el('time').textContent = clock(race.time)

  showItem(me.item === undefined ? null : me.item)
  showEffects(me)

  // The last lap is worth calling, and so is crossing the line: both are
  // moments rather than states, so they are flashed for a couple of seconds.
  if (me.lap !== calledLap) {
    if (calledLap !== -1 && me.lap === race.laps - 1) flashUntil = performance.now() + 2500
    calledLap = me.lap
  }
  const flashing = performance.now() < flashUntil

  const banner = el('banner')
  const sub = el('banner-sub')
  let sublabel = ''
  if (race.phase === 'COUNT') {
    const n = Math.ceil(race.timer)
    banner.textContent = n > 0 ? String(n) : 'GO'
    banner.hidden = false
  } else if (me.finished !== null) {
    // Home, with the rest of the field still out there. The card comes up when
    // the flag falls; until then this is the only thing saying you are done.
    banner.textContent = 'FINISHED'
    banner.hidden = false
    sublabel = `${ordinal(me.place)} · ${clock(me.finished)} · waiting for the flag`
  } else if (me.respawn > 0) {
    banner.textContent = `RESCUE ${me.respawn.toFixed(1)}`
    banner.hidden = false
  } else if (me.spin > 0) {
    banner.textContent = 'SPUN OUT'
    banner.hidden = false
  } else if (flashing) {
    banner.textContent = 'FINAL LAP'
    banner.hidden = false
  } else if (race.time < 1.5) {
    banner.textContent = 'GO'
    banner.hidden = false
  } else {
    banner.hidden = true
  }
  // The card covers the screen at the flag; nothing belongs under it.
  if (race.phase === 'OVER') {
    banner.hidden = true
    sublabel = ''
  }
  sub.hidden = sublabel === ''
  if (sublabel) sub.textContent = sublabel

  el('standings').innerHTML = [...race.karts]
    .sort((a, b) => a.place - b.place)
    .map(
      (k) => `<li class="${k.id === myId ? 'me' : ''}"><span>${k.place}</span>${dot(k.id)}<span>${escapeHtml(k.name)}</span></li>`,
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

function dot(id) {
  return `<span class="dot" style="background:${kartColor(id)}"></span>`
}

/**
 * What is in the slot. The icon is only rebuilt when the item changes: this
 * runs every frame, and re-parsing an SVG sixty times a second for a mark that
 * has not moved is work for nothing.
 */
function showItem(index) {
  const now = performance.now()
  if (index !== heldItem) {
    // Only a pickup reels. Spending one empties the slot on the spot, and so
    // does firing mid-reel — the slot never shows something you cannot use.
    reelUntil = index !== null && (heldItem === null || heldItem === undefined) ? now + REEL_MS : 0
    heldItem = index
  }

  const reeling = now < reelUntil
  if (reeling && now >= reelAt) {
    reelIndex = (reelIndex + 1) % K.ITEMS.length
    // Slowing as it runs down, so it lands on the last one rather than stopping
    // mid-blur: ~40ms a step at the start, ~190ms at the end.
    const done = 1 - (reelUntil - now) / REEL_MS
    reelAt = now + 40 + 150 * done * done
  }
  paintItem(reeling ? reelIndex : index, reeling)
}

/** The slot, showing one item — the one you have, or one the reel is passing. */
function paintItem(index, reeling) {
  const item = index === null || index === undefined ? null : K.ITEMS[index]
  const slot = el('item-slot')
  slot.classList.toggle('full', Boolean(item))
  el('item-name').textContent = item ? item.name : 'No item'
  el('item-hint').textContent = reeling
    ? 'rolling…'
    : item
      ? 'space to fire'
      : 'drive through a box'
  if (index === shownItem) return
  shownItem = index
  const art = item ? ITEM_ART[item.key] : null
  slot.style.setProperty('--item', art?.color ?? 'transparent')
  el('item-icon').innerHTML = art
    ? `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">${art.svg}</svg>`
    : '<span class="blank"></span>'
}

/** The effects running on your own kart, as chips over the slot. */
function showEffects(me) {
  const chips = []
  if (me.boost > 0) chips.push(['tag-accent', `Boost ${me.boost.toFixed(1)}s`])
  if (me.star > 0) chips.push(['tag-accent', `Star ${me.star.toFixed(1)}s`])
  if (me.shrink > 0) chips.push(['tag-neutral', `Shrunk ${me.shrink.toFixed(1)}s`])
  const html = chips.map(([kind, text]) => `<span class="tag ${kind}">${text}</span>`).join('')
  if (html !== shownEffects) {
    shownEffects = html
    el('effects').innerHTML = html
  }
}

/** Before the lights, in a room: who is in, and the host's start button. */
function showWaitingRoom() {
  el('results').hidden = true
  el('start').hidden = !isHost
  el('waiting-list').innerHTML = roster
    .map((p) => `<li class="${p.id === myId ? 'me' : ''}">${dot(p.id)} ${escapeHtml(p.name)}</li>`)
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
      .map((k) => ({ id: k.id, name: k.name, place: k.place, time: k.finished, me: k.id === myId }))

  el('verdict').textContent = verdict(rows)
  el('result-rows').innerHTML = rows
    .map((r) => {
      const time = r.time === null || r.time === undefined ? 'DNF' : clock(r.time)
      return `<div class="result-row${r.me ? ' me' : ''}"><span>${r.place}</span>${dot(r.id)}<span>${escapeHtml(r.name)}</span><span class="time">${time}</span></div>`
    })
    .join('')
  // Only the host can put a room back on the grid; solo can always go again.
  el('restart').hidden = !solo && !isHost
}

const PLACINGS = ['Race won', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']

/**
 * How it went, in the design's words: the placing and the gap that decided it —
 * to the kart ahead, or for a winner to the one that came next.
 */
function verdict(rows) {
  const mine = rows.find((r) => r.me)
  if (!mine) return 'Race over'
  const placing = PLACINGS[mine.place - 1] ?? ordinal(mine.place)
  if (mine.time === null || mine.time === undefined) return `${placing} — did not finish`
  const rival = rows.find((r) => r.place === (mine.place === 1 ? 2 : mine.place - 1))
  if (!rival || rival.time === null || rival.time === undefined) return placing
  return `${placing}, by ${Math.abs(mine.time - rival.time).toFixed(1)}s`
}

function ordinalSuffix(n) {
  return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
}

function ordinal(n) {
  return `${n}${ordinalSuffix(n)}`
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

// Enter in the name field is the same as pressing whatever is in front of you:
// the room whose link brought you here, or a solo race.
el('name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !isTyping(e.target)) return
  if (cleanCode(el('code').value)) el('join').click()
  else el('solo').click()
})
