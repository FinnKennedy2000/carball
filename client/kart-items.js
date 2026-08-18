// Kart item models: original low-poly props, built from primitives so there are
// no asset files to ship. Same contract as the rest of the client — pure
// functions of THREE, returning a named Group centred on the origin, y-up,
// about 1.2 units across. Scale to taste at the call site: the game's karts are
// KART_R 2.2, so an item riding at 1.0–1.5 reads right on the road.
//
// Every mesh and material is named, so an OBJ/GLB export lands in Blender with
// its parts intact.

import * as THREE from 'three'

const mat = (name, color, opts = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15, ...opts })
  m.name = name
  return m
}
const mesh = (name, geo, material) => {
  const m = new THREE.Mesh(geo, material)
  m.name = name
  m.castShadow = true
  m.receiveShadow = true
  return m
}
const group = (name) => {
  const g = new THREE.Group()
  g.name = name
  return g
}

// Shared palette. Keeping the set small is what makes a field of items read as
// one game rather than a bag of props.
const PAINT = {
  shellGreen: () => mat('shell_green', 0x2fbe5f, { roughness: 0.35 }),
  shellRed: () => mat('shell_red', 0xe0453f, { roughness: 0.35 }),
  shellBlue: () => mat('shell_blue', 0x3b7ae0, { roughness: 0.35 }),
  rim: () => mat('rim_cream', 0xe8e3d2, { roughness: 0.6 }),
  dark: () => mat('graphite', 0x1b1f2a, { roughness: 0.7, metalness: 0.05 }),
  steel: () => mat('steel', 0x8e9ab5, { roughness: 0.35, metalness: 0.35 }),
  gold: () => mat('gold', 0xf0b429, { roughness: 0.3, metalness: 0.3 }),
  amber: () => mat('amber', 0xffd166, { roughness: 0.25 }),
  violet: () => mat('violet', 0x9184d9, { roughness: 0.35 }),
  peel: () => mat('peel_yellow', 0xe9c33a, { roughness: 0.55 }),
  ink: () => mat('ink', 0x171531, { roughness: 0.95, metalness: 0 }),
}

// --- shells -----------------------------------------------------------------
// A faceted armour dome on a cream rim: low enough to sit on the tarmac, and
// distinct in silhouette from the karts' own boxes.
function shell(skin, homing) {
  const g = group(homing ? 'shell_red' : 'shell_green')
  const rim = PAINT.rim()

  const dome = mesh('dome', new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), skin)
  dome.geometry.scale(1, 0.78, 1)
  dome.position.y = 0.2
  g.add(dome)

  const apex = mesh('apex', new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), rim)
  apex.geometry.scale(1, 0.7, 1)
  apex.position.y = 0.575
  g.add(apex)

  const band = mesh('rim_band', new THREE.TorusGeometry(0.5, 0.075, 8, 28), rim)
  band.rotation.x = Math.PI / 2
  band.position.y = 0.2
  g.add(band)

  const belly = mesh('belly', new THREE.SphereGeometry(0.47, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), rim)
  belly.geometry.scale(1, 0.34, 1)
  belly.position.y = 0.199
  g.add(belly)

  if (homing) {
    // The homing fin. It is the only thing that tells the two shells apart at a
    // glance from behind, which is when it matters.
    const fin = new THREE.Shape()
    fin.moveTo(0, 0)
    fin.lineTo(0.34, 0.1)
    fin.lineTo(0.1, 0.42)
    fin.lineTo(0, 0.3)
    const f = mesh(
      'fin',
      new THREE.ExtrudeGeometry(fin, { depth: 0.06, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 1 }),
      PAINT.dark(),
    )
    f.rotation.y = Math.PI / 2
    f.position.set(0.03, 0.24, 0.28)
    g.add(f)
  }
  return g
}

export const buildGreenShell = () => shell(PAINT.shellGreen(), false)
export const buildRedShell = () => shell(PAINT.shellRed(), true)

/**
 * The spiny shell: the same armour in blue, with a pair of wings — it is the
 * only item that flies over the field rather than along it.
 */
export function buildSpinyShell() {
  const g = shell(PAINT.shellBlue(), true)
  g.name = 'shell_spiny'
  for (const side of [1, -1]) {
    // Stubby swept wings rather than blades: they have to read as a shell that
    // flies without turning it into a dart.
    const wing = mesh('wing', new THREE.ConeGeometry(0.16, 0.3, 5), PAINT.rim())
    wing.geometry.scale(1, 1, 0.4)
    wing.rotation.set(0, 0, (side * Math.PI) / 2.6)
    wing.position.set(side * 0.5, 0.42, 0)
    g.add(wing)
  }
  for (let i = 0; i < 5; i++) {
    const spike = mesh('spike_' + i, new THREE.ConeGeometry(0.07, 0.2, 6), PAINT.rim())
    const a = (i / 5) * Math.PI * 2
    spike.position.set(Math.cos(a) * 0.3, 0.52, Math.sin(a) * 0.3)
    g.add(spike)
  }
  return g
}

// --- banana -----------------------------------------------------------------
export function buildBanana() {
  const g = group('banana')
  const peel = PAINT.peel()
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.5, 0.06, 0.1),
    new THREE.Vector3(-0.22, 0.22, -0.06),
    new THREE.Vector3(0.14, 0.24, -0.06),
    new THREE.Vector3(0.46, 0.08, 0.1),
  ])
  const body = mesh('peel_body', new THREE.TubeGeometry(curve, 28, 0.15, 12, false), peel)
  g.add(body)
  for (const [i, t] of [0, 1].entries()) {
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    const tip = mesh(`tip_${i}`, new THREE.ConeGeometry(0.13, 0.14, 12), i === 0 ? PAINT.dark() : peel)
    tip.position.copy(p)
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.multiplyScalar(t === 0 ? -1 : 1))
    g.add(tip)
  }
  // A thin strip laid along the top: the split skin, the thing that says peel
  // rather than fruit.
  const strip = mesh('peel_strip', new THREE.TubeGeometry(curve, 24, 0.06, 8, false), PAINT.rim())
  strip.position.y = 0.098
  g.add(strip)
  return g
}

// --- turbo ------------------------------------------------------------------
// A thruster, not a mushroom: nozzle, fins, and a lit core.
export function buildTurbo() {
  const g = group('turbo')
  const steel = PAINT.steel()
  const nozzle = mesh('nozzle', new THREE.CylinderGeometry(0.3, 0.44, 0.44, 24), steel)
  nozzle.position.y = 0.22
  g.add(nozzle)
  const collar = mesh('collar', new THREE.TorusGeometry(0.31, 0.055, 8, 24), PAINT.gold())
  collar.rotation.x = Math.PI / 2
  collar.position.y = 0.44
  g.add(collar)
  const throat = mesh('throat', new THREE.CylinderGeometry(0.22, 0.3, 0.16, 24), steel)
  throat.position.y = 0.52
  g.add(throat)
  // The lit plume, tapering to a point: the whole read at speed is this cone.
  const core = mesh('core', new THREE.ConeGeometry(0.24, 0.62, 20), PAINT.amber())
  core.position.y = 0.9
  g.add(core)
  const base = mesh('base_ring', new THREE.TorusGeometry(0.44, 0.06, 8, 28), PAINT.gold())
  base.rotation.x = Math.PI / 2
  base.position.y = 0.05
  g.add(base)
  // Three vents cut into the socket, as raised gold slots — enough detail to
  // stop the cone reading as a plain traffic cone.
  for (let i = 0; i < 3; i++) {
    const vent = mesh('vent_' + i, new THREE.BoxGeometry(0.14, 0.2, 0.06), PAINT.gold())
    const a = (i / 3) * Math.PI * 2
    vent.position.set(Math.cos(a) * 0.4, 0.24, Math.sin(a) * 0.4)
    vent.rotation.y = -a + Math.PI / 2
    g.add(vent)
  }
  return g
}

// --- bolt -------------------------------------------------------------------
export function buildBolt() {
  const g = group('bolt')
  const s = new THREE.Shape()
  const pts = [
    [0.12, 0.62], [-0.26, 0.06], [-0.02, 0.06], [-0.14, -0.62],
    [0.28, -0.04], [0.04, -0.04],
  ]
  s.moveTo(pts[0][0], pts[0][1])
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y)
  const body = mesh(
    'bolt_body',
    new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2 }),
    PAINT.violet(),
  )
  body.geometry.center()
  body.position.y = 0.62
  g.add(body)
  return g
}

// --- star -------------------------------------------------------------------
export function buildStar() {
  const g = group('star')
  const s = new THREE.Shape()
  const R = 0.6, r = 0.26
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    const rad = i % 2 === 0 ? R : r
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad
    i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)
  }
  const body = mesh(
    'star_body',
    new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 2 }),
    PAINT.amber(),
  )
  body.geometry.center()
  body.position.y = 0.62
  g.add(body)
  return g
}

// --- the pickup box and its decoy ------------------------------------------
function cagedBox(name, skin, edge) {
  const g = group(name)
  const S = 0.86
  const body = mesh('body', new THREE.BoxGeometry(S, S, S), skin)
  body.position.y = S / 2
  g.add(body)
  const half = S / 2
  const axes = [
    ['x', [0, 0, 1], [1, 0, 0]],
    ['y', [0, 1, 0], [0, 0, 0]],
    ['z', [1, 0, 0], [0, 0, 1]],
  ]
  let n = 0
  for (const [axis] of axes) {
    for (const a of [-half, half]) {
      for (const b of [-half, half]) {
        const bar = mesh(`edge_${n++}`, new THREE.CylinderGeometry(0.035, 0.035, S + 0.07, 6), edge)
        if (axis === 'x') { bar.rotation.z = Math.PI / 2; bar.position.set(0, half + a, b) }
        else if (axis === 'y') { bar.position.set(a, half, b) }
        else { bar.rotation.x = Math.PI / 2; bar.position.set(a, half + b, 0) }
        g.add(bar)
      }
    }
  }
  return g
}

export function buildItemBox() {
  const g = cagedBox('item_box', mat('box_gold', 0xffd166, { roughness: 0.3, transparent: true, opacity: 0.55 }), PAINT.gold())
  // The mark inside: an octahedron, the same diamond the HUD slot uses when
  // it is empty. No letter, so it needs no localising.
  const core = mesh('mark', new THREE.OctahedronGeometry(0.3, 0), PAINT.rim())
  core.position.y = 0.43
  g.add(core)
  return g
}

export function buildTrapBox() {
  const g = cagedBox('trap_box', mat('trap_body', 0x2a2334, { roughness: 0.6 }), mat('trap_edge', 0x6c5aa8, { roughness: 0.4 }))
  // Spikes on four faces: at speed the decoy has to be readable as wrong.
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  dirs.forEach(([x, z], i) => {
    const spike = mesh(`spike_${i}`, new THREE.ConeGeometry(0.12, 0.26, 8), PAINT.steel())
    spike.position.set(x * 0.62, 0.43, z * 0.62)
    spike.rotation.z = x ? (-x * Math.PI) / 2 : 0
    spike.rotation.x = z ? (z * Math.PI) / 2 : 0
    g.add(spike)
  })
  return g
}

// --- bomb -------------------------------------------------------------------
export function buildBomb() {
  const g = group('bomb')
  const shellMat = PAINT.dark()
  const body = mesh('casing', new THREE.SphereGeometry(0.44, 24, 16), shellMat)
  body.position.y = 0.44
  g.add(body)
  const band = mesh('band', new THREE.TorusGeometry(0.44, 0.045, 8, 28), PAINT.steel())
  band.rotation.x = Math.PI / 2
  band.position.y = 0.44
  g.add(band)
  const neck = mesh('neck', new THREE.CylinderGeometry(0.13, 0.17, 0.16, 16), PAINT.steel())
  neck.position.y = 0.9
  g.add(neck)
  const fuse = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.96, 0),
    new THREE.Vector3(0.1, 1.12, 0.04),
    new THREE.Vector3(0.02, 1.24, -0.08),
    new THREE.Vector3(-0.12, 1.34, 0.02),
  ])
  g.add(mesh('fuse', new THREE.TubeGeometry(fuse, 20, 0.032, 8, false), PAINT.peel()))
  const spark = mesh('spark', new THREE.IcosahedronGeometry(0.09, 0), PAINT.amber())
  spark.position.copy(fuse.getPointAt(1))
  g.add(spark)
  return g
}

// --- ink burst --------------------------------------------------------------
export function buildInk() {
  const g = group('ink_burst')
  const ink = PAINT.ink()
  const blobs = [
    [0, 0.3, 0, 0.34], [0.3, 0.22, 0.12, 0.22], [-0.26, 0.24, -0.14, 0.25],
    [0.1, 0.16, -0.32, 0.18], [-0.14, 0.14, 0.3, 0.16], [0.44, 0.1, -0.2, 0.11],
  ]
  blobs.forEach(([x, y, z, r], i) => {
    const b = mesh(`blob_${i}`, new THREE.SphereGeometry(r, 16, 12), ink)
    b.geometry.scale(1, 0.5, 1)
    b.position.set(x, y, z)
    g.add(b)
  })
  // Two flecks thrown clear of the splat, so the shape has an edge.
  ;[[0.6, 0.06, 0.24, 0.07], [-0.52, 0.05, -0.3, 0.06]].forEach(([x, y, z, r], i) => {
    const f = mesh(`fleck_${i}`, new THREE.SphereGeometry(r, 10, 8), ink)
    f.geometry.scale(1, 0.6, 1)
    f.position.set(x, y, z)
    g.add(f)
  })
  // Two droplets in the air over the splat, so the silhouette is not a puddle.
  ;[[0.16, 0.42, 0.1, 0.075], [-0.2, 0.5, -0.06, 0.055]].forEach(([x, y, z, r], i) => {
    const d = mesh(`drop_${i}`, new THREE.SphereGeometry(r, 12, 10), ink)
    d.position.set(x, y, z)
    g.add(d)
  })
  return g
}

// --- leader-seeking missile -------------------------------------------------
export function buildSeeker() {
  const g = group('seeker')
  const steel = PAINT.steel()
  const body = mesh('body', new THREE.CapsuleGeometry(0.2, 0.5, 12, 20), steel)
  body.rotation.z = Math.PI / 2
  body.position.y = 0.34
  g.add(body)
  const nose = mesh('nose', new THREE.ConeGeometry(0.2, 0.34, 20), mat('nose_red', 0xe0453f, { roughness: 0.35 }))
  nose.rotation.z = -Math.PI / 2
  nose.position.set(0.62, 0.34, 0)
  g.add(nose)
  const collar = mesh('collar', new THREE.TorusGeometry(0.2, 0.035, 8, 20), PAINT.violet())
  collar.rotation.y = Math.PI / 2
  collar.position.set(0.42, 0.34, 0)
  g.add(collar)
  for (let i = 0; i < 3; i++) {
    const fin = mesh('fin_' + i, new THREE.BoxGeometry(0.26, 0.03, 0.24), PAINT.violet())
    const a = (i / 3) * Math.PI * 2
    fin.position.set(-0.34, 0.34 + Math.sin(a) * 0.18, Math.cos(a) * 0.18)
    fin.rotation.x = -a
    g.add(fin)
  }
  const flare = mesh('flare', new THREE.ConeGeometry(0.16, 0.3, 16), PAINT.amber())
  flare.rotation.z = Math.PI / 2
  flare.position.set(-0.8, 0.34, 0)
  g.add(flare)
  return g
}

/**
 * The catalogue. Keys line up with the item table in shared/kart.js where one
 * exists; the rest are roles the road needs a shape for.
 */
export const ITEM_MODELS = {
  boost: { name: 'Turbo', build: buildTurbo, note: 'a burst of speed' },
  banana: { name: 'Banana', build: buildBanana, note: 'drops behind you' },
  green: { name: 'Green Shell', build: buildGreenShell, note: 'fires straight ahead' },
  red: { name: 'Red Shell', build: buildRedShell, note: 'homes on the kart ahead' },
  blue: { name: 'Spiny Shell', build: buildSpinyShell, note: 'flies to the leader' },
  bolt: { name: 'Bolt', build: buildBolt, note: 'shrinks everyone else' },
  star: { name: 'Star', build: buildStar, note: 'untouchable, and quick' },
  box: { name: 'Item Box', build: buildItemBox, note: 'the pickup itself' },
  trap: { name: 'Trap Box', build: buildTrapBox, note: 'a decoy that spins you out' },
  bomb: { name: 'Bomb', build: buildBomb, note: 'drops, waits, and blasts a radius' },
  ink: { name: 'Ink Burst', build: buildInk, note: 'blinds the karts ahead' },
  seeker: { name: 'Seeker', build: buildSeeker, note: 'flies to whoever is leading' },
}

export function buildItem(key) {
  const entry = ITEM_MODELS[key]
  if (!entry) throw new Error('unknown item: ' + key)
  return entry.build()
}
