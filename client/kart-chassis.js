// Kart chassis models: six low-poly vehicles built from primitives, so there
// are still no asset files to ship. Same contract as kart-items.js — pure
// functions of THREE returning a named Group, y-up, +x forward, sitting on the
// ground plane at y = 0. Lengths are the real metres from the stat table, so a
// model dropped beside another is honestly scaled.
//
// Paint is the player accent; team colour is applied at the call site by
// setting the material named `paint`.

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

const PAINT = {
  paint: () => mat('paint', 0x9184d9, { roughness: 0.42 }),
  dark: () => mat('graphite', 0x1b1f2a, { roughness: 0.7, metalness: 0.05 }),
  glass: () => mat('glass', 0x0b0e14, { roughness: 0.18, metalness: 0.4 }),
  steel: () => mat('steel', 0x8e9ab5, { roughness: 0.35, metalness: 0.4 }),
  trim: () => mat('trim', 0xcbb98a, { roughness: 0.35, metalness: 0.3 }),
  rubber: () => mat('rubber', 0x14161f, { roughness: 0.9, metalness: 0 }),
}

/** A wheel with a rim, lying in the x/y plane and spinning about z. */
function wheel(name, r, width, rubber, rim) {
  const g = group(name)
  const tyre = mesh('tyre', new THREE.CylinderGeometry(r, r, width, 16), rubber)
  tyre.rotation.x = Math.PI / 2
  g.add(tyre)
  const hub = mesh('rim', new THREE.CylinderGeometry(r * 0.45, r * 0.45, width * 1.04, 12), rim)
  hub.rotation.x = Math.PI / 2
  g.add(hub)
  return g
}

/** Four wheels at ±wheelbase/2, ±track/2. */
function axles(g, { r, width, wheelbase, track }, rubber, rim) {
  let n = 0
  for (const x of [wheelbase / 2, -wheelbase / 2]) {
    for (const z of [track / 2, -track / 2]) {
      const w = wheel('wheel_' + n++, r, width, rubber, rim)
      w.position.set(x, r, z)
      g.add(w)
    }
  }
}

/** A box with its bottom face at y = base. */
function slab(name, [l, h, w], x, base, material, opts = {}) {
  const m = mesh(name, new THREE.BoxGeometry(l, h, w), material)
  m.position.set(x, base + h / 2, opts.z ?? 0)
  return m
}

// --- Coupe ------------------------------------------------------------------
// The baseline: 4m long, a roof that starts behind the front axle, a nose that
// is neither a wedge nor a snub.
export function buildCoupe() {
  const g = group('coupe')
  const paint = PAINT.paint()
  axles(g, { r: 0.34, width: 0.24, wheelbase: 2.5, track: 2.2 }, PAINT.rubber(), PAINT.steel())
  g.add(slab('body', [4, 0.62, 2.4], 0, 0.28, paint))
  const shoulder = slab('shoulder', [2.9, 0.34, 2.3], -0.1, 0.9, paint)
  g.add(shoulder)
  const roof = slab('roof', [1.9, 0.42, 1.9], -0.35, 1.24, paint)
  g.add(roof)
  g.add(slab('glass_front', [0.5, 0.4, 1.8], 0.68, 1.2, PAINT.glass()))
  g.add(slab('glass_side_l', [1.8, 0.34, 0.06], -0.35, 1.28, PAINT.glass(), { z: 0.96 }))
  g.add(slab('glass_side_r', [1.8, 0.34, 0.06], -0.35, 1.28, PAINT.glass(), { z: -0.96 }))
  g.add(slab('nose', [0.5, 0.3, 2.1], 1.9, 0.4, PAINT.trim()))
  g.add(slab('splitter', [0.3, 0.1, 2.3], 1.95, 0.18, PAINT.dark()))
  return g
}

// --- Wedge ------------------------------------------------------------------
// Longer, lower, and pointed: the silhouette is one plane from the splitter to
// the tail, and the cabin is a slot cut into it.
export function buildWedge() {
  const g = group('wedge')
  const paint = PAINT.paint()
  axles(g, { r: 0.31, width: 0.26, wheelbase: 2.9, track: 2.1 }, PAINT.rubber(), PAINT.steel())
  const s = new THREE.Shape()
  s.moveTo(-2.2, 0)
  s.lineTo(-2.2, 0.62)
  s.lineTo(-0.4, 0.82)
  s.lineTo(1.4, 0.5)
  s.lineTo(2.2, 0.22)
  s.lineTo(2.2, 0)
  const body = mesh('body', new THREE.ExtrudeGeometry(s, { depth: 2.2, bevelEnabled: false }), paint)
  body.position.set(0, 0.24, -1.1)
  g.add(body)
  g.add(slab('cabin', [1.3, 0.3, 1.5], -0.5, 0.98, PAINT.glass()))
  g.add(slab('fin_l', [1.6, 0.26, 0.12], -1.3, 0.9, paint, { z: 0.85 }))
  g.add(slab('fin_r', [1.6, 0.26, 0.12], -1.3, 0.9, paint, { z: -0.85 }))
  const wing = slab('wing', [0.5, 0.08, 2.2], -2.1, 1.02, PAINT.trim())
  g.add(wing)
  g.add(slab('splitter', [0.4, 0.08, 2.2], 2.05, 0.16, PAINT.dark()))
  return g
}

// --- Van --------------------------------------------------------------------
// Tall, short, and heavy: one volume, and the mass reads before the numbers do.
export function buildVan() {
  const g = group('van')
  const paint = PAINT.paint()
  axles(g, { r: 0.38, width: 0.3, wheelbase: 2.3, track: 2.4 }, PAINT.rubber(), PAINT.steel())
  g.add(slab('body', [3.6, 1.5, 2.7], -0.1, 0.34, paint))
  g.add(slab('nose', [0.5, 0.9, 2.5], 1.85, 0.34, paint))
  g.add(slab('glass_front', [0.14, 0.55, 2.2], 2.06, 0.95, PAINT.glass()))
  g.add(slab('glass_side_l', [1.9, 0.5, 0.06], -0.2, 1.05, PAINT.glass(), { z: 1.37 }))
  g.add(slab('glass_side_r', [1.9, 0.5, 0.06], -0.2, 1.05, PAINT.glass(), { z: -1.37 }))
  g.add(slab('bumper', [0.3, 0.34, 2.7], 2.05, 0.2, PAINT.dark()))
  g.add(slab('roof_rack', [2.6, 0.1, 2.2], -0.3, 1.84, PAINT.trim()))
  return g
}

// --- Roadster ---------------------------------------------------------------
// Open-topped and short in the wheelbase: a windscreen, a headrest fairing,
// and no roof to hide the driver behind.
export function buildRoadster() {
  const g = group('roadster')
  const paint = PAINT.paint()
  axles(g, { r: 0.32, width: 0.25, wheelbase: 2.4, track: 2.0 }, PAINT.rubber(), PAINT.steel())
  g.add(slab('body', [3.8, 0.66, 2.2], 0, 0.26, paint))
  const tub = mesh('tub', new THREE.BoxGeometry(1.5, 0.3, 1.4), PAINT.dark())
  tub.position.set(-0.3, 0.98, 0)
  g.add(tub)
  g.add(slab('screen', [0.1, 0.34, 1.4], 0.5, 0.92, PAINT.glass()))
  const fairing = mesh(
    'fairing',
    new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    paint,
  )
  fairing.geometry.scale(1.1, 0.6, 1.0)
  fairing.position.set(-1.32, 0.9, 0)
  g.add(fairing)
  g.add(slab('nose', [0.6, 0.26, 1.9], 1.85, 0.34, PAINT.trim()))
  g.add(slab('sill_l', [2.4, 0.16, 0.12], -0.2, 0.72, PAINT.trim(), { z: 1.06 }))
  g.add(slab('sill_r', [2.4, 0.16, 0.12], -0.2, 0.72, PAINT.trim(), { z: -1.06 }))
  return g
}

// --- Open-wheel -------------------------------------------------------------
// Wheels outside the body, a narrow tub between them, wings at both ends: the
// grip chassis, and the one that goes flying when it is touched.
export function buildOpenWheel() {
  const g = group('open_wheel')
  const paint = PAINT.paint()
  axles(g, { r: 0.36, width: 0.34, wheelbase: 2.3, track: 1.9 }, PAINT.rubber(), PAINT.trim())
  const tub = mesh('tub', new THREE.CylinderGeometry(0.34, 0.26, 2.6, 10), paint)
  tub.rotation.z = Math.PI / 2
  tub.position.set(-0.1, 0.42, 0)
  g.add(tub)
  const nose = mesh('nose', new THREE.ConeGeometry(0.24, 1.1, 10), paint)
  nose.rotation.z = -Math.PI / 2
  nose.position.set(1.6, 0.36, 0)
  g.add(nose)
  const halo = mesh('halo', new THREE.TorusGeometry(0.34, 0.045, 6, 18), PAINT.steel())
  halo.rotation.y = Math.PI / 2
  halo.position.set(-0.15, 0.78, 0)
  g.add(halo)
  g.add(slab('headrest', [0.4, 0.24, 0.5], -0.7, 0.6, PAINT.dark()))
  g.add(slab('wing_front', [0.34, 0.07, 1.7], 2.0, 0.14, PAINT.trim()))
  g.add(slab('wing_rear', [0.44, 0.08, 1.5], -1.5, 0.86, PAINT.trim()))
  g.add(slab('wing_rear_post', [0.12, 0.5, 0.12], -1.5, 0.4, PAINT.dark()))
  const engine = mesh('engine', new THREE.BoxGeometry(0.8, 0.4, 0.7), PAINT.steel())
  engine.position.set(-0.95, 0.5, 0)
  g.add(engine)
  return g
}

// --- Bike -------------------------------------------------------------------
// Two wheels inline, a spine between them, and a fairing over the front: the
// narrow chassis. 0.9m wide, which is the whole reason to ride it.
export function buildBike() {
  const g = group('bike')
  const paint = PAINT.paint()
  const rubber = PAINT.rubber()
  const rim = PAINT.trim()
  const front = wheel('wheel_front', 0.4, 0.16, rubber, rim)
  front.position.set(0.78, 0.4, 0)
  g.add(front)
  const rear = wheel('wheel_rear', 0.42, 0.2, rubber, rim)
  rear.position.set(-0.82, 0.42, 0)
  g.add(rear)
  const spine = mesh('spine', new THREE.BoxGeometry(1.7, 0.24, 0.34), paint)
  spine.position.set(-0.05, 0.66, 0)
  g.add(spine)
  const tank = mesh('tank', new THREE.SphereGeometry(0.3, 14, 10), paint)
  tank.geometry.scale(1.7, 0.75, 1.0)
  tank.position.set(0.12, 0.86, 0)
  g.add(tank)
  const seat = mesh('seat', new THREE.BoxGeometry(0.7, 0.14, 0.3), PAINT.dark())
  seat.position.set(-0.62, 0.88, 0)
  g.add(seat)
  const tail = mesh('tail', new THREE.ConeGeometry(0.16, 0.5, 10), paint)
  tail.rotation.z = Math.PI / 2
  tail.position.set(-1.05, 0.92, 0)
  g.add(tail)
  // Fork and fairing.
  for (const z of [0.13, -0.13]) {
    const fork = mesh(
      `fork_${z > 0 ? 'l' : 'r'}`,
      new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8),
      PAINT.steel(),
    )
    fork.position.set(0.72, 0.74, z)
    fork.rotation.z = -0.28
    g.add(fork)
  }
  const fairing = mesh(
    'fairing',
    new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    paint,
  )
  fairing.geometry.scale(0.9, 1.5, 1.0)
  fairing.position.set(0.62, 0.82, 0)
  g.add(fairing)
  const bars = mesh('bars', new THREE.CylinderGeometry(0.035, 0.035, 0.62, 8), PAINT.steel())
  bars.rotation.x = Math.PI / 2
  bars.position.set(0.5, 1.06, 0)
  g.add(bars)
  const engine = mesh('engine', new THREE.BoxGeometry(0.5, 0.34, 0.34), PAINT.steel())
  engine.position.set(-0.15, 0.5, 0)
  g.add(engine)
  return g
}

/** The stats each chassis overrides, in the order the garage shows them. */
export const STAT_LABELS = ['accel', 'top', 'grip', 'turn', 'mass', 'radius']

/**
 * The lineup. `stats` are accel (m/s²), top speed (m/s), grip (lateral
 * damping, 1/s), turn rate (rad/s), mass (× the baseline) and collision radius
 * (m) — the Coupe's are the numbers shared/kart.js already races on. Balanced
 * so a clean lap of the circuit is within a tenth of a second across the set:
 * the differences are meant to show up in traffic.
 */
export const CHASSIS = {
  coupe: { name: 'Coupe', build: buildCoupe, stats: [34, 38, 10, 2.5, 1.0, 2.2], note: 'the baseline' },
  wedge: { name: 'Wedge', build: buildWedge, stats: [33, 41.5, 9.0, 2.35, 1.0, 2.2], note: 'top end' },
  van: { name: 'Van', build: buildVan, stats: [31, 36.5, 11.0, 2.3, 1.25, 2.5], note: 'mass' },
  roadster: {
    name: 'Roadster',
    build: buildRoadster,
    stats: [36, 37, 10.6, 2.8, 0.9, 2.1],
    note: 'turn-in',
  },
  openwheel: {
    name: 'Open-wheel',
    build: buildOpenWheel,
    stats: [35, 36, 11.4, 2.7, 0.95, 2.0],
    note: 'grip',
  },
  bike: { name: 'Bike', build: buildBike, stats: [37, 40.5, 9.2, 2.9, 0.7, 1.6], note: 'two wheels' },
}

export function buildChassis(key) {
  const entry = CHASSIS[key]
  if (!entry) throw new Error('unknown chassis: ' + key)
  return entry.build()
}
