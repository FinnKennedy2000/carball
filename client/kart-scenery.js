// What stands around the road.
//
// Task 4 gave every map its own tarmac, kerb and deck; this file gives each one
// somewhere to be. Six inventories, one per theme, from the "Scenery, per
// theme" section of docs/specs/2026-08-22-kart-themes-and-scenery.md: a harbour,
// a lagoon, an orchard, a steelworks, a ridge above the cloud line, and a
// splitting plateau.
//
// Three rules shape all of it.
//
// It is decoration. Nothing here is read by shared/kart.js, so no prop can
// change a lap time, a collision or a race hash. Placement is still seeded off
// the track key, so two players in the same room see the same trees.
//
// Everything that repeats is one InstancedMesh. A grove is fifty-four trees and
// two draw calls; a hundred plain meshes would be a hundred. Plates are one mesh
// each. That is what keeps the whole world inside the draw-call budget the
// circuit already renders in.
//
// Nothing is placed as a raw inward offset. An inside edge pushed past 85% of a
// corner's radius comes out the far side — see the header of kart-ribbon.js for
// what that looked like — so inward scenery is either discrete instances whose
// site is checked against the whole road (see `siteAt` below) or a band routed
// through the same fold-capped offset the tarmac uses.

import * as THREE from 'three'
import * as K from '../shared/kart.js'
import { foldCapped, isInside } from './kart-ribbon.js'
import { themeFor } from './kart-themes.js'

/**
 * How many of each repeated prop a theme stands up. Named here rather than
 * buried in the six builders so a test can assert the world actually got them:
 * a scatter that silently placed forty trees instead of fifty-four is a bug you
 * would never notice by looking.
 */
export const SCENERY_COUNTS = {
  circuit: { mast: 18, 'mast-head': 18, grandstand: 4, 'grandstand-roof': 4 },
  bayside: { sandbank: 26, buoy: 14 },
  grove: { trunk: 54, 'canopy-a': 30, 'canopy-b': 24, rock: 22 },
  foundry: {
    'pour-channel': 7,
    'gantry-leg': 12,
    'gantry-beam': 6,
    stack: 9,
    'stack-cap': 9,
    pipe: 14,
  },
  cliff: { 'cut-panel': 34, 'inner-face': 18, post: 40, peak: 12, 'peak-cap': 12 },
  // fracture's abutment count is not a choice: there is one at every place the
  // road stops or starts again, which on this map is fourteen. If the track
  // data ever moves a void, the count test below fails and says so.
  fracture: {
    plateau: 26,
    'rift-wall': 20,
    'truss-tie': 30,
    'truss-strut': 30,
    abutment: 14,
    'loose-slab': 18,
  },
}

// Primitives ----------------------------------------------------------------

/** A track key as a number, so the same map seeds the same world everywhere. */
function seedOf(key) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The design's LCG: the same generator shared/kart.js uses for a race. */
export function rng(seed) {
  let state = seed >>> 0 || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/** `color`'s channels scaled by `factor` — a lighter or darker shade of it. */
function shade(color, factor) {
  const c = (v) => Math.min(255, Math.round(v * factor))
  return (c((color >> 16) & 0xff) << 16) | (c((color >> 8) & 0xff) << 8) | c(color & 0xff)
}

/** How high the road stands at node `i`. */
function nodeY(i) {
  return K.heightAt(K.TRACK.cum[i])
}

/** Node `i` of the centre line pushed sideways, held short of folding. */
function offsetPoint(i, rawOffset) {
  const pts = K.TRACK.pts
  const offset = foldCapped(i, rawOffset)
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return [a.x - ((b.y - a.y) / len) * offset, a.y + ((b.x - a.x) / len) * offset, offset]
}

/** The y rotation that lays a box's own +x along the road at node `i`. */
function alongRoad(i) {
  const pts = K.TRACK.pts
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  return Math.atan2(-(b.y - a.y), b.x - a.x)
}

/** Whether the road is there at all at node `i` — no void, no jump gap. */
function solidAt(i) {
  const s = K.TRACK.cum[i]
  return !K.overVoid(s) && K.jumpAt(s) === null
}

/** The nodes where the road stops or starts again — a truss's ends. */
function brinks() {
  const out = []
  for (let i = 0; i < K.TRACK_N; i++) {
    if (solidAt(i) !== solidAt((i + 1) % K.TRACK_N)) out.push(i)
  }
  return out
}

/** The lowest the road gets on this map, for the plates that hang under it. */
function lowestRoad() {
  let low = Infinity
  for (let i = 0; i < K.TRACK_N; i++) low = Math.min(low, nodeY(i))
  return low
}

/**
 * One prop, repeated. `xforms` is a list of `{ x, y, z, rx, ry, rz, s }` —
 * position, an Euler turn (any of the three, all optional), and a scale that is
 * either one number or `[x, y, z]`.
 */
function props(geo, material, xforms, name) {
  const mesh = new THREE.InstancedMesh(geo, material, xforms.length)
  mesh.name = name
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const euler = new THREE.Euler()
  xforms.forEach((t, k) => {
    pos.set(t.x, t.y, t.z)
    euler.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)
    q.setFromEuler(euler)
    const s = t.s ?? 1
    if (Array.isArray(s)) scale.set(s[0], s[1], s[2])
    else scale.setScalar(s)
    mesh.setMatrixAt(k, m.compose(pos, q, scale))
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/**
 * A place to stand something, `dist` metres past the kerb at node `i`, on the
 * outside of the bend or the inside of it.
 *
 * The offset is fold-capped like every other edge in the world, and then the
 * result is checked against the *whole* road rather than against node `i` alone:
 * 30m inside a hairpin is 30m from this node and possibly two metres from the
 * far side of the same hairpin. Returns null when the site is no good, and the
 * caller walks on to the next node.
 */
function siteAt(i, dist, toward, clear) {
  const s = K.TRACK.cum[i]
  const want = K.halfWidthAt(s) + K.KERB + dist
  // isInside answers for a positive offset; the far side is the other one.
  const outward = isInside(i, want) ? -1 : 1
  const [x, z, offset] = offsetPoint(i, (toward === 'in' ? -outward : outward) * want)
  const near = K.project(x, z)
  if (Math.abs(near.lateral) < K.halfWidthAt(near.s) + K.KERB + clear) return null
  // `mid` rides along for the props that span the road rather than stand
  // beside it — a gantry beam and a truss strut are centred on the road.
  return { i, s, x, z, y: nodeY(i), offset, ry: alongRoad(i), mid: K.pointAt(s) }
}

/**
 * `count` sites spread round the lap, walking on past the ones that would put a
 * prop on the road. Spaced evenly and then jittered rather than picked at
 * random, so a scatter cannot leave half the lap bare; the jitter comes off the
 * theme's seeded RNG, so it comes out the same on every client.
 *
 * Throws if a site cannot be found for every prop, rather than quietly building
 * a thinner world than the theme asked for.
 */
function scatter(rand, count, { toward = 'out', near = 8, far = 24, clear = 4, solid = false } = {}) {
  const n = K.TRACK_N
  const start = Math.floor(rand() * n)
  const step = n / count
  const out = []
  for (let k = 0; k < count; k++) {
    const dist = near + rand() * (far - near)
    const from = Math.round(start + k * step + rand() * step * 0.7) % n
    let site = null
    for (let tries = 0; tries < n && !site; tries++) {
      const i = (from + tries) % n
      if (solid && !solidAt(i)) continue
      site = siteAt(i, dist, toward, clear)
    }
    if (!site) throw new Error(`no room for prop ${k} of ${count} on ${K.activeTrack()}`)
    out.push(site)
  }
  return out
}

/**
 * A band following the road, as one mesh. Each entry in `specs` is a pair of
 * edges — `{ a, b }` are lateral offsets from the centre line and `ya`, `yb`
 * their heights above the road — so a horizontal shelf and the vertical face
 * under it come out of the same call, and both sides of the road come out of one
 * geometry rather than two draw calls.
 *
 * Every offset goes through foldCapped, which is the whole reason a band is
 * allowed to sit on the inside at all.
 */
function band(specs, keep, material, name) {
  const n = K.TRACK_N
  const verts = []
  const idx = []
  for (const spec of specs) {
    const base = verts.length / 3
    for (let i = 0; i < n; i++) {
      const [ax, az] = offsetPoint(i, spec.a(i))
      const [bx, bz] = offsetPoint(i, spec.b(i))
      verts.push(ax, nodeY(i) + spec.ya(i), az, bx, nodeY(i) + spec.yb(i), bz)
    }
    for (let i = 0; i < n; i++) {
      if (!keep(i)) continue
      const p = base + i * 2
      const q = base + ((i + 1) % n) * 2
      idx.push(p, q, p + 1, q, q + 1, p + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, material)
  mesh.name = name
  return mesh
}

/** A flat plate the size of the map, hung at `y`. The horizon under a theme. */
function plate(y, material, name, reach = 2.1) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(K.TRACK_R * reach, 48), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.name = name
  return mesh
}

function solidMat(color, name, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, name, ...extra })
}

function glowMat(color, name, intensity = 0.9) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.5,
    name,
  })
}

// Themes --------------------------------------------------------------------

/**
 * The scenery for one track, as a group ready to add to the world. `key` picks
 * the builder and seeds the placement; the live road comes from shared/kart.js,
 * which buildWorld has already pointed at this track by the time this runs.
 */
export function buildScenery(key, theme = themeFor(key)) {
  const group = new THREE.Group()
  group.name = 'scenery'
  const builder = BUILDERS[key]
  if (!builder) return group
  const tint = Number.parseInt(theme.tint.slice(1), 16)
  const edge = Number.parseInt(theme.edge.slice(1), 16)
  const kerb = Number.parseInt(theme.kerb.slice(1), 16)
  const counts = SCENERY_COUNTS[key]
  const ctx = {
    rand: rng(seedOf(key)),
    tint,
    edge,
    kerb,
    deckDepth: theme.deckDepth,
    floor: lowestRoad(),
    counts,
  }
  for (const part of builder(ctx)) group.add(part)
  return group
}

/**
 * Harbour floodlights. Water below the deck, lights on the outside, stands on
 * the inside, and a rail along both edges — a permanent circuit with a harbour
 * behind the paddock.
 */
function circuit({ rand, tint, edge, kerb, deckDepth, floor, counts }) {
  const parts = []
  parts.push(
    plate(
      floor - deckDepth - 6,
      solidMat(shade(edge, 0.5), 'water', { roughness: 0.25, metalness: 0.6 }),
      'harbour-water',
    ),
  )

  // The masts, and their heads as a second instance rather than a second mesh
  // each: the head is the only emissive thing on the mast and materials are what
  // split a draw call, not props.
  const masts = scatter(rand, counts.mast, { toward: 'out', near: 10, far: 26 })
  const mastH = 20
  parts.push(
    props(
      new THREE.CylinderGeometry(0.5, 0.8, mastH, 6),
      solidMat(shade(edge, 1.3), 'steel'),
      masts.map((m) => ({ x: m.x, y: m.y + mastH / 2, z: m.z })),
      'mast',
    ),
  )
  parts.push(
    props(
      new THREE.BoxGeometry(5, 1.4, 1.2),
      glowMat(shade(kerb, 1), 'floodlight', 1.4),
      masts.map((m) => ({ x: m.x, y: m.y + mastH, z: m.z, ry: m.ry })),
      'mast-head',
    ),
  )

  // Stands on the inside of the long corners, where a crowd would actually see
  // something. 30m in is where the fold cap starts biting, so most candidate
  // nodes are rejected and the four that survive are on the open bends.
  const stands = scatter(rand, counts.grandstand, { toward: 'in', near: 22, far: 34, clear: 10 })
  parts.push(
    props(
      new THREE.BoxGeometry(38, 9, 14),
      solidMat(shade(edge, 0.8), 'concrete'),
      stands.map((s) => ({ x: s.x, y: s.y + 4.5, z: s.z, ry: s.ry })),
      'grandstand',
    ),
  )
  parts.push(
    props(
      new THREE.BoxGeometry(40, 0.8, 16),
      solidMat(shade(tint, 0.7), 'roof'),
      stands.map((s) => ({ x: s.x, y: s.y + 11, z: s.z, ry: s.ry })),
      'grandstand-roof',
    ),
  )

  // The rail: a metal shelf and its face, both sides, one mesh. Only where the
  // road is solid — a rail across a void is a bridge, which this road has not
  // got.
  const outer = (i) => K.halfWidthAt(K.TRACK.cum[i]) + K.KERB + 2.4
  parts.push(
    band(
      [
        { a: outer, b: (i) => outer(i) + 0.6, ya: () => 1.3, yb: () => 1.3 },
        { a: outer, b: outer, ya: () => 1.3, yb: () => 0.5 },
        { a: (i) => -outer(i), b: (i) => -outer(i) - 0.6, ya: () => 1.3, yb: () => 1.3 },
        { a: (i) => -outer(i), b: (i) => -outer(i), ya: () => 1.3, yb: () => 0.5 },
      ],
      solidAt,
      solidMat(shade(edge, 1.5), 'barrier', { metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }),
      'harbour-rail',
    ),
  )
  return parts
}

/**
 * Lagoon shallows. Tide flats with a sheet of water over them, sandbanks either
 * side, a seawall on the outside and buoys standing off it.
 */
function bayside({ rand, tint, edge, deckDepth, floor, counts }) {
  const parts = []
  parts.push(plate(floor - deckDepth - 6, solidMat(shade(edge, 0.7), 'flats'), 'tide-flats'))
  // The water sits *between* the flats and the road, which is what makes the
  // road read as a causeway: you can see the bottom through it.
  parts.push(
    plate(
      floor - deckDepth - 2.5,
      new THREE.MeshStandardMaterial({
        color: shade(tint, 0.8),
        transparent: true,
        opacity: 0.45,
        roughness: 0.15,
        metalness: 0.4,
        name: 'water',
      }),
      'lagoon-water',
      1.5,
    ),
  )

  const banks = scatter(rand, counts.sandbank, { toward: 'out', near: 6, far: 44 })
  parts.push(
    props(
      new THREE.SphereGeometry(1, 10, 6),
      solidMat(shade(edge, 1.4), 'sand'),
      banks.map((b, k) => ({
        x: b.x,
        y: floor - deckDepth - 4.5,
        z: b.z,
        // Flattened, and not all the same size: a row of identical domes reads
        // as a fence rather than as a tide flat.
        s: [7 + (k % 5) * 2.5, 1.6 + (k % 3) * 0.5, 6 + (k % 4) * 3],
      })),
      'sandbank',
    ),
  )

  // The seawall: a top shelf and the face under it, outside the kerb, one mesh.
  const wall = (i) => K.halfWidthAt(K.TRACK.cum[i]) + K.KERB + 3
  parts.push(
    band(
      [
        { a: wall, b: (i) => wall(i) + 2, ya: () => 1.1, yb: () => 1.1 },
        { a: (i) => wall(i) + 2, b: (i) => wall(i) + 2, ya: () => 1.1, yb: () => -4 },
        { a: (i) => -wall(i), b: (i) => -wall(i) - 2, ya: () => 1.1, yb: () => 1.1 },
        { a: (i) => -wall(i) - 2, b: (i) => -wall(i) - 2, ya: () => 1.1, yb: () => -4 },
      ],
      () => true,
      solidMat(shade(edge, 1.1), 'seawall', { side: THREE.DoubleSide }),
      'seawall',
    ),
  )

  const buoys = scatter(rand, counts.buoy, { toward: 'out', near: 16, far: 50 })
  parts.push(
    props(
      new THREE.ConeGeometry(1.1, 3.2, 7),
      glowMat(tint, 'buoy', 1.1),
      buoys.map((b) => ({ x: b.x, y: floor - deckDepth - 0.4, z: b.z })),
      'buoy',
    ),
  )
  return parts
}

/** Canopy floor. Trunks and canopy in two greens, and rock on the verges. */
function grove({ rand, tint, edge, floor, deckDepth, counts }) {
  const parts = []
  parts.push(plate(floor - deckDepth - 1, solidMat(shade(edge, 0.9), 'forest-floor'), 'forest-floor'))

  // 13-73m out, per the inventory. The far ones are what give the orchard
  // depth; the near ones are what you actually brush past.
  const trees = scatter(rand, counts.trunk, { toward: 'out', near: 13, far: 73 })
  const trunkH = 9
  parts.push(
    props(
      new THREE.CylinderGeometry(0.55, 0.85, trunkH, 6),
      solidMat(shade(edge, 0.75), 'bark'),
      trees.map((t) => ({ x: t.x, y: t.y + trunkH / 2 - 1, z: t.z })),
      'trunk',
    ),
  )
  // Two greens rather than one, which is the whole look of the theme: a single
  // canopy colour reads as one plastic hedge from the road.
  const canopy = new THREE.SphereGeometry(1, 8, 6)
  const split = counts['canopy-a']
  parts.push(
    props(
      canopy,
      solidMat(shade(tint, 0.85), 'canopy'),
      trees.slice(0, split).map((t, k) => ({ x: t.x, y: t.y + trunkH + 1, z: t.z, s: 4.5 + (k % 4) })),
      'canopy-a',
    ),
  )
  parts.push(
    props(
      canopy,
      solidMat(shade(tint, 0.55), 'canopy'),
      trees.slice(split).map((t, k) => ({ x: t.x, y: t.y + trunkH + 0.4, z: t.z, s: 3.8 + (k % 3) })),
      'canopy-b',
    ),
  )

  const rocks = scatter(rand, counts.rock, { toward: 'out', near: 3, far: 11, clear: 2.5 })
  parts.push(
    props(
      new THREE.DodecahedronGeometry(1),
      solidMat(shade(edge, 1.2), 'rock'),
      rocks.map((r, k) => ({ x: r.x, y: r.y - 0.2, z: r.z, ry: r.ry, s: 0.9 + (k % 4) * 0.35 })),
      'rock',
    ),
  )
  return parts
}

/**
 * Molten foundry. A shop floor, pour channels running under the road, gantries
 * over it, stacks behind, pipe runs along, and one ladle.
 */
function foundry({ rand, tint, edge, deckDepth, floor, counts }) {
  const parts = []
  parts.push(plate(floor - deckDepth - 2, solidMat(shade(edge, 0.8), 'shop-floor'), 'shop-floor'))

  // The pour glow the blurb promises, crossing *under* the road rather than
  // over it: the light comes up past the deck's edge and nothing is in the way
  // of a kart.
  const pours = scatter(rand, counts['pour-channel'], { toward: 'out', near: 6, far: 10 })
  parts.push(
    props(
      new THREE.BoxGeometry(9, 0.6, 90),
      glowMat(tint, 'molten', 1.6),
      pours.map((p) => ({ x: p.x, y: floor - deckDepth - 1.4, z: p.z, ry: p.ry })),
      'pour-channel',
    ),
  )

  // Gantries: two legs and a beam over the road. The beam is the one thing here
  // allowed to span the tarmac, and it hangs high enough to clear a kart at the
  // top of a jump — JUMP_RISE reaches 9m, so 14m is the floor, not 6.
  const gantries = scatter(rand, counts['gantry-beam'], { toward: 'out', near: 4, far: 7, solid: true })
  const legH = 15
  parts.push(
    props(
      new THREE.BoxGeometry(1.4, legH, 1.4),
      solidMat(shade(edge, 1.4), 'steel'),
      gantries.flatMap((g) => {
        const half = K.halfWidthAt(g.s) + K.KERB + 3
        return [1, -1].map((side) => ({
          x: g.mid.x + g.mid.nx * side * half,
          y: g.y + legH / 2,
          z: g.mid.y + g.mid.ny * side * half,
        }))
      }),
      'gantry-leg',
    ),
  )
  parts.push(
    props(
      new THREE.BoxGeometry(2, 1.6, 1),
      solidMat(shade(tint, 0.6), 'gantry'),
      gantries.map((g) => ({
        x: g.mid.x,
        y: g.y + legH,
        z: g.mid.y,
        ry: g.ry,
        // One geometry, stretched across whatever the road is doing there.
        // The box is 2m across, so this scale is the half-span in metres.
        s: [K.halfWidthAt(g.s) + K.KERB + 4, 1, 1],
      })),
      'gantry-beam',
    ),
  )

  // Stacks in a row behind everything, with the caps lit.
  const stacks = scatter(rand, counts.stack, { toward: 'out', near: 40, far: 90 })
  const stackH = 34
  parts.push(
    props(
      new THREE.CylinderGeometry(3, 4.5, stackH, 8),
      solidMat(shade(edge, 0.95), 'stack'),
      stacks.map((s) => ({ x: s.x, y: s.y + stackH / 2, z: s.z })),
      'stack',
    ),
  )
  parts.push(
    props(
      new THREE.CylinderGeometry(3.2, 3.2, 2, 8),
      glowMat(tint, 'molten', 1.3),
      stacks.map((s) => ({ x: s.x, y: s.y + stackH + 1, z: s.z })),
      'stack-cap',
    ),
  )

  const pipes = scatter(rand, counts.pipe, { toward: 'out', near: 12, far: 30 })
  parts.push(
    props(
      new THREE.CylinderGeometry(0.7, 0.7, 26, 6),
      solidMat(shade(edge, 1.2), 'steel'),
      pipes.map((p, k) => ({
        x: p.x,
        y: p.y + 2 + (k % 3) * 1.3,
        z: p.z,
        // Laid along the road rather than standing: a turn about z tips the
        // cylinder's own axis onto the horizontal, then ry aims it.
        rz: Math.PI / 2,
        ry: p.ry,
      })),
      'pipe',
    ),
  )

  // One ladle. The only prop in the whole file that does not repeat, so it is
  // the only one that is a plain mesh.
  const ladle = scatter(rand, 1, { toward: 'out', near: 18, far: 18 })[0]
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 4, 8, 12),
    solidMat(shade(edge, 1.1), 'steel'),
  )
  bowl.position.set(ladle.x, ladle.y + 4, ladle.z)
  bowl.name = 'ladle'
  parts.push(bowl)
  return parts
}

/**
 * Frost ridge. A cloud deck a long way down, the mountain cut away on the
 * inside, drifting snow across the inner kerb, marker posts on the drop side,
 * and peaks standing out of the cloud.
 */
function cliff({ rand, tint, edge, kerb, deckDepth, floor, counts }) {
  const parts = []
  // Well below the 16m deck skirt, and translucent: the road is above the cloud
  // line, so what is under it should not read as ground.
  parts.push(
    plate(
      floor - deckDepth - 40,
      new THREE.MeshStandardMaterial({
        color: shade(kerb, 0.9),
        transparent: true,
        opacity: 0.5,
        roughness: 1,
        name: 'cloud',
      }),
      'cloud-deck',
      1.6,
    ),
  )

  // The cut slope, as instanced rock panels stepped along the inside rather than
  // an inward-offset ribbon: 32m inside the centre line inverts on most of this
  // map's corners. See the file header.
  const cut = scatter(rand, counts['cut-panel'], { toward: 'in', near: 6, far: 14, clear: 3 })
  const rockMat = solidMat(shade(edge, 1.1), 'rock')
  parts.push(
    props(
      new THREE.BoxGeometry(14, 12, 6),
      rockMat,
      cut.map((c, k) => ({
        x: c.x,
        y: c.y + 4 + (k % 4),
        z: c.z,
        ry: c.ry,
        // Leaned back into the hillside, so it reads as a cut face rather than
        // as a wall standing beside the road.
        rz: 0.22,
      })),
      'cut-panel',
    ),
  )
  // The inner face behind it, taller and further in where the corner allows.
  parts.push(
    props(
      new THREE.BoxGeometry(26, 34, 10),
      rockMat,
      scatter(rand, counts['inner-face'], { toward: 'in', near: 16, far: 26, clear: 8 }).map((f) => ({
        x: f.x,
        y: f.y + 12,
        z: f.z,
        ry: f.ry,
      })),
      'inner-face',
    ),
  )

  // Drifting snow across the exits: a band at the inner kerb, which is safe
  // because every offset in it goes through foldCapped and foldCapped never
  // pulls an edge inside the kerb.
  const inner = (i) => K.halfWidthAt(K.TRACK.cum[i]) + K.KERB
  parts.push(
    band(
      [
        { a: inner, b: (i) => inner(i) + 5, ya: () => 0.18, yb: () => 0.9 },
        { a: (i) => -inner(i), b: (i) => -inner(i) - 5, ya: () => 0.18, yb: () => 0.9 },
      ],
      solidAt,
      solidMat(shade(kerb, 1), 'snow', { side: THREE.DoubleSide, roughness: 1 }),
      'snow-drift',
    ),
  )

  const posts = scatter(rand, counts.post, { toward: 'out', near: 2.5, far: 4, clear: 2 })
  parts.push(
    props(
      new THREE.BoxGeometry(0.35, 3, 0.35),
      glowMat(tint, 'marker', 0.7),
      posts.map((p) => ({ x: p.x, y: p.y + 1.5, z: p.z })),
      'post',
    ),
  )

  // Peaks out of the cloud, well clear of the road, with the snow on top as a
  // second instance of the same cone.
  const peaks = scatter(rand, counts.peak, { toward: 'out', near: 70, far: 150, clear: 30 })
  const cone = new THREE.ConeGeometry(1, 1, 7)
  parts.push(
    props(
      cone,
      rockMat,
      peaks.map((p, k) => ({
        x: p.x,
        y: floor - deckDepth - 40 + (26 + (k % 4) * 9) / 2,
        z: p.z,
        s: [16 + (k % 3) * 6, 26 + (k % 4) * 9, 16 + (k % 3) * 6],
      })),
      'peak',
    ),
  )
  parts.push(
    props(
      cone,
      solidMat(shade(kerb, 1), 'snow'),
      peaks.map((p, k) => ({
        x: p.x,
        y: floor - deckDepth - 40 + (26 + (k % 4) * 9) * 0.86,
        z: p.z,
        s: [(16 + (k % 3) * 6) * 0.3, (26 + (k % 4) * 9) * 0.28, (16 + (k % 3) * 6) * 0.3],
      })),
      'peak-cap',
    ),
  )
  return parts
}

/**
 * Rift. Plateau slabs and rift walls either side, a light in the crack far
 * below, the truss the road is stitched across, and slabs hanging in the light.
 */
function fracture({ rand, tint, edge, deckDepth, floor, counts }) {
  const parts = []
  // The rift light: emissive, a long way down, and the only thing you see when
  // you look over an edge here.
  parts.push(
    plate(floor - deckDepth - 55, glowMat(tint, 'rift-light', 1.2), 'rift-light', 1.15),
  )

  const slab = new THREE.BoxGeometry(1, 1, 1)
  const rockMat = solidMat(shade(edge, 1.05), 'plateau')
  parts.push(
    props(
      slab,
      rockMat,
      scatter(rand, counts.plateau, { toward: 'out', near: 22, far: 52, clear: 20 }).map((p, k) => ({
        x: p.x,
        y: p.y - 3 - (k % 3),
        z: p.z,
        ry: p.ry + (k % 5) * 0.15,
        s: [18 + (k % 4) * 6, 6 + (k % 3) * 2, 13 + (k % 4) * 4],
      })),
      'plateau',
    ),
  )
  parts.push(
    props(
      slab,
      solidMat(shade(edge, 0.65), 'rift-wall'),
      scatter(rand, counts['rift-wall'], { toward: 'out', near: 26, far: 70, clear: 12 }).map(
        (w, k) => ({
          x: w.x,
          y: floor - deckDepth - 14 + (k % 3) * 5,
          z: w.z,
          ry: w.ry,
          s: [26 + (k % 4) * 8, 22, 8],
        }),
      ),
      'rift-wall',
    ),
  )

  // The truss the road is stitched across: ties hanging straight down under the
  // deck and struts crossing between them. All of it below the deck skirt, so
  // none of it is anywhere a kart can reach.
  const ties = scatter(rand, counts['truss-tie'], { toward: 'out', near: 1.5, far: 2.5, clear: 1, solid: true })
  const steel = solidMat(shade(tint, 0.5), 'steel')
  parts.push(
    props(
      new THREE.BoxGeometry(1, 16, 1),
      steel,
      ties.map((t) => ({ x: t.x, y: t.y - deckDepth - 9, z: t.z })),
      'truss-tie',
    ),
  )
  parts.push(
    props(
      new THREE.BoxGeometry(1, 0.9, 1),
      steel,
      ties.map((t) => ({
        x: t.mid.x,
        y: t.y - deckDepth - 14,
        z: t.mid.y,
        ry: t.ry,
        // Stretched across to the far side of the road: one strut per tie,
        // under the deck, which is what an abutment-to-abutment truss looks
        // like from below.
        s: [(K.halfWidthAt(t.s) + K.KERB) * 2, 1, 1],
      })),
      'truss-strut',
    ),
  )

  // The abutments the truss lands on: one block under each lip where the road
  // stops or starts again, which is where a real truss would be carrying its
  // load into the rock. Instanced like the rest — there are fourteen of them,
  // not two.
  parts.push(
    props(
      new THREE.BoxGeometry(1, 10, 7),
      solidMat(shade(edge, 0.85), 'abutment'),
      brinks().map((i) => {
        const p = K.pointAt(K.TRACK.cum[i])
        return {
          x: p.x,
          // Hung a good way clear of the deck rather than tucked under it: the
          // block is 7m along the road and the road at a jump lip climbs a
          // couple of metres over that, so a tight fit is a fit that clips.
          y: nodeY(i) - deckDepth - 12,
          z: p.y,
          ry: alongRoad(i),
          s: [(K.halfWidthAt(K.TRACK.cum[i]) + K.KERB) * 2.4, 1, 1],
        }
      }),
      'abutment',
    ),
  )

  parts.push(
    props(
      new THREE.DodecahedronGeometry(1),
      rockMat,
      scatter(rand, counts['loose-slab'], { toward: 'out', near: 8, far: 34 }).map((s, k) => ({
        x: s.x,
        y: floor - deckDepth - 12 - (k % 6) * 5,
        z: s.z,
        ry: s.ry,
        rx: (k % 4) * 0.3,
        s: 3 + (k % 4) * 1.6,
      })),
      'loose-slab',
    ),
  )
  return parts
}

const BUILDERS = { circuit, bayside, grove, foundry, cliff, fracture }
