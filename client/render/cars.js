// Procedural cars: lofted bodies, glass cabins, wheels, lights, boost flame.
// Everything is built in hitbox space: x = width, y = height, z = length
// (forward = +Z), then sized from the body's hitbox in shared/cars.js.
import * as THREE from 'three'
import { CARS } from '../../shared/cars.js'
import { TEAM_COLORS } from './util.js'

// body station: [z, halfWidth(0..1), yBottom, yTop] in hitbox fractions (y/z -0.5..0.5)
// cabin station: [z, halfWidth, yTop]
const TEMPLATES = {
  octane: {
    body: [[-0.5, 0.78, -0.2, 0.1], [-0.46, 0.92, -0.22, 0.16], [-0.25, 1, -0.22, 0.14], [0.1, 1, -0.22, 0.04], [0.36, 0.96, -0.22, -0.06], [0.5, 0.78, -0.2, -0.14]],
    cabin: [[-0.3, 0.74, 0.12], [-0.22, 0.78, 0.44], [0.0, 0.78, 0.5], [0.14, 0.75, 0.38], [0.26, 0.7, 0.04]],
    wing: 'duck', splitter: 1, wheelZ: 0.31,
  },
  dominus: {
    body: [[-0.5, 0.85, -0.2, 0.08], [-0.44, 0.98, -0.22, 0.12], [-0.2, 1, -0.22, 0.08], [0.2, 1, -0.22, -0.04], [0.42, 0.9, -0.21, -0.16], [0.5, 0.6, -0.2, -0.2]],
    cabin: [[-0.22, 0.8, 0.06], [-0.12, 0.82, 0.34], [0.04, 0.8, 0.38], [0.2, 0.74, 0.0]],
    wing: 'none', splitter: 2, wheelZ: 0.32,
  },
  breakout: {
    body: [[-0.5, 0.7, -0.2, 0.06], [-0.4, 0.9, -0.22, 0.12], [-0.1, 0.95, -0.22, 0.04], [0.3, 0.9, -0.22, -0.12], [0.5, 0.4, -0.2, -0.22]],
    cabin: [[-0.32, 0.6, 0.06], [-0.2, 0.66, 0.36], [-0.04, 0.64, 0.4], [0.12, 0.56, 0.0]],
    wing: 'blade', splitter: 2, wheelZ: 0.33,
  },
  merc: {
    body: [[-0.5, 0.92, -0.18, 0.28], [-0.46, 1, -0.2, 0.3], [0.2, 1, -0.2, 0.22], [0.42, 0.97, -0.2, 0.08], [0.5, 0.86, -0.18, -0.02]],
    cabin: [[-0.4, 0.88, 0.28], [-0.36, 0.9, 0.5], [0.0, 0.9, 0.52], [0.2, 0.86, 0.46], [0.3, 0.8, 0.2]],
    wing: 'none', splitter: 0, wheelZ: 0.3,
  },
  hotshot: {
    body: [[-0.5, 0.8, -0.2, 0.0], [-0.44, 0.95, -0.22, 0.1], [-0.2, 1, -0.22, 0.1], [0.12, 1, -0.22, 0.0], [0.4, 0.92, -0.21, -0.1], [0.5, 0.7, -0.2, -0.16]],
    cabin: [[-0.16, 0.7, 0.04], [-0.06, 0.74, 0.34], [0.08, 0.72, 0.36], [0.2, 0.66, 0.0]],
    wing: 'big', splitter: 1, wheelZ: 0.31,
  },
  venom: {
    body: [[-0.5, 0.88, -0.22, 0.14], [-0.34, 1, -0.22, 0.18], [0.0, 1, -0.22, 0.1], [0.36, 0.94, -0.22, -0.02], [0.5, 0.8, -0.2, -0.1]],
    cabin: [[-0.34, 0.8, 0.14], [-0.26, 0.82, 0.46], [-0.04, 0.8, 0.5], [0.1, 0.76, 0.42], [0.22, 0.7, 0.0]],
    wing: 'duck', splitter: 1, wheelZ: 0.3,
  },
}
const TEMPLATE_KEYS = Object.keys(TEMPLATES)

/** Normalise CARS (object keyed by body, or legacy array) into [[key, def]]. */
export function carEntries() {
  return Array.isArray(CARS) ? CARS.map((c, i) => [String(i), c]) : Object.entries(CARS)
}
export const carKeys = () => carEntries().map(([k]) => k)

function lookup(key) {
  const e = carEntries()
  let i = e.findIndex(([k]) => k === String(key))
  if (i < 0) i = 0
  return { key: e[i]?.[0] ?? 'octane', def: e[i]?.[1] ?? {}, index: i }
}
function templateFor(key, d, index) {
  const name = String(d?.name ?? key).toLowerCase()
  for (const t of TEMPLATE_KEYS) if (name.includes(t) || key.toLowerCase().includes(t)) return TEMPLATES[t]
  return TEMPLATES[TEMPLATE_KEYS[index % TEMPLATE_KEYS.length]]
}
function hitbox(d) {
  const h = d?.hitbox
  if (Array.isArray(h) && h.length >= 3) return h
  return [2.2, 1.1, 3.4] // until a body declares its hitbox
}

const K = 28
function loft(st, cabin) {
  const S = st.length
  const pos = new Float32Array((S + 2) * K * 3)
  const e = 2 / (cabin ? 2.6 : 4.0)
  const put = (i, z, hw, y0, y1, scale = 1) => {
    const cy = (y0 + y1) / 2
    const hh = (y1 - y0) / 2
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      const o = (i * K + k) * 3
      pos[o] = hw * scale * Math.sign(c) * Math.pow(Math.abs(c), e)
      pos[o + 1] = cy + hh * scale * Math.sign(s) * Math.pow(Math.abs(s), e)
      pos[o + 2] = z
    }
  }
  put(0, st[0].z - 0.002, st[0].hw, st[0].y0, st[0].y1, 0.02)
  for (let i = 0; i < S; i++) put(i + 1, st[i].z, st[i].hw, st[i].y0, st[i].y1)
  put(S + 1, st[S - 1].z + 0.002, st[S - 1].hw, st[S - 1].y0, st[S - 1].y1, 0.02)
  const idx = []
  for (let i = 0; i < S + 1; i++) {
    for (let k = 0; k < K; k++) {
      const a = i * K + k
      const b = i * K + ((k + 1) % K)
      idx.push(a, b, a + K, b, b + K, a + K)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function softTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function createCarKit() {
  const geoCache = new Map()
  const matCache = new Map()
  const owned = []
  const own = (x) => (owned.push(x), x)

  const carbon = own(new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.5, metalness: 0.6 }))
  const glass = own(new THREE.MeshPhysicalMaterial({ color: 0x05080f, roughness: 0.04, metalness: 0.9, clearcoat: 1, envMapIntensity: 1.8 }))
  const tire = own(new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.85, metalness: 0 }))
  const rim = own(new THREE.MeshStandardMaterial({ color: 0xc8d0dc, roughness: 0.25, metalness: 1 }))
  const headMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 0.92).multiplyScalar(4), toneMapped: false }))
  const tailMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.05).multiplyScalar(3), toneMapped: false }))
  const soft = own(softTexture())

  const cached = (k, make) => (matCache.has(k) ? matCache.get(k) : (matCache.set(k, own(make())), matCache.get(k)))
  const paint = (team) => cached('p' + team, () => new THREE.MeshPhysicalMaterial({
    color: TEAM_COLORS[team], metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4,
  }))
  const glowMat = (team) => cached('g' + team, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_COLORS[team]).multiplyScalar(2.4), toneMapped: false }))
  const flameMat = (team) => cached('f' + team, () => new THREE.MeshBasicMaterial({
    map: soft, color: team ? new THREE.Color(1, 0.55, 0.15).multiplyScalar(2) : new THREE.Color(0.35, 0.65, 1).multiplyScalar(2.2),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }))

  const wheelGeo = own(new THREE.CylinderGeometry(1, 1, 1, 24).rotateZ(Math.PI / 2))
  const rimGeo = own(new THREE.CylinderGeometry(0.62, 0.62, 1, 20).rotateZ(Math.PI / 2))
  const boxGeo = own(new THREE.BoxGeometry(1, 1, 1))
  const flameGeo = own(new THREE.ConeGeometry(0.5, 1, 14, 1, true).translate(0, -0.5, 0).rotateX(Math.PI / 2)) // tip at origin, widens toward -z
  const glowPlane = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))

  function bodyGeos(key) {
    if (geoCache.has(key)) return geoCache.get(key)
    const { def: d, index } = lookup(key)
    const T = templateFor(key, d, index)
    const [W, H, L] = hitbox(d)
    const body = own(loft(T.body.map(([z, hw, y0, y1]) => ({ z: z * L, hw: hw * W * 0.46, y0: y0 * H, y1: (y1 + 0.08) * H }))))
    const cab = own(loft(T.cabin.map(([z, hw, y1]) => ({ z: z * L, hw: hw * W * 0.4, y0: 0.0 * H, y1: (y1 + 0.07) * H })), true))
    const r = { body, cab, T, W, H, L }
    geoCache.set(key, r)
    return r
  }

  function build(key, team) {
    const g = bodyGeos(lookup(key).key)
    const { T, W, H, L } = g
    const root = new THREE.Group()
    const model = new THREE.Group()
    root.add(model)
    const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, cast = true) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.scale.set(sx, sy, sz)
      m.castShadow = cast
      model.add(m)
      return m
    }
    for (const [geo, mat] of [[g.body, paint(team)], [g.cab, glass]]) {
      const m = new THREE.Mesh(geo, mat)
      m.castShadow = true
      model.add(m)
    }
    add(boxGeo, carbon, 0, -0.33 * H, 0, W * 0.78, H * 0.06, L * 0.86)
    if (T.splitter) add(boxGeo, carbon, 0, -0.3 * H, L * 0.505, W * 0.84, H * 0.025 * T.splitter, L * 0.04)
    if (T.wing !== 'none') {
      const big = T.wing === 'big' || T.wing === 'blade'
      const y = H * (T.wing === 'duck' ? 0.2 : 0.34)
      add(boxGeo, paint(team), 0, y, -L * 0.47, W * 0.96, H * 0.04, L * (big ? 0.12 : 0.08))
      for (const sx of [-1, 1]) add(boxGeo, carbon, sx * W * 0.3, y / 2, -L * 0.46, W * 0.04, y, L * 0.03)
    }
    for (const sx of [-1, 1]) {
      add(boxGeo, glowMat(team), sx * W * 0.455, -0.1 * H, 0, W * 0.012, H * 0.025, L * 0.55, false)
      add(boxGeo, headMat, sx * W * 0.3, -0.13 * H, L * 0.495, W * 0.2, H * 0.06, L * 0.02, false)
    }
    add(boxGeo, tailMat, 0, 0, -L * 0.495, W * 0.78, H * 0.05, L * 0.015, false)

    const wr = Math.min(H * 0.31, W * 0.18)
    const tw = wr * 0.85
    const wheels = []
    for (const fz of [1, -1]) for (const sx of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.position.set(sx * (W * 0.5 - tw * 0.5), -H * 0.5 + wr, fz * T.wheelZ * L)
      const spin = new THREE.Group()
      const tr = new THREE.Mesh(wheelGeo, tire)
      tr.scale.set(tw, wr, wr)
      tr.castShadow = true
      const rm = new THREE.Mesh(rimGeo, rim)
      rm.scale.set(tw * 1.02, wr, wr)
      spin.add(tr, rm)
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(boxGeo, carbon)
        sp.scale.set(tw * 1.08, wr * 1.1, wr * 0.16)
        sp.rotation.x = (k * Math.PI * 2) / 5
        spin.add(sp)
      }
      pivot.add(spin)
      model.add(pivot)
      wheels.push({ pivot, spin, front: fz > 0 })
    }
    const flames = []
    const fm = flameMat(team)
    for (const sx of [-1, 1]) {
      const f = new THREE.Group()
      f.position.set(sx * W * 0.22, -H * 0.1, -L * 0.5)
      const outer = new THREE.Mesh(flameGeo, fm)
      const inner = new THREE.Mesh(flameGeo, fm)
      f.add(outer, inner)
      f.visible = false
      model.add(f)
      flames.push({ g: f, outer, inner })
    }
    const ug = new THREE.Mesh(glowPlane, new THREE.MeshBasicMaterial({
      map: soft, color: new THREE.Color(TEAM_COLORS[team]).multiplyScalar(1.5), transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }))
    ug.scale.set(W * 1.7, 1, L * 1.5)
    ug.position.y = -H * 0.46
    model.add(ug)
    owned.push(ug.material)
    return { root, model, wheels, flames, key, team, W, H, L, wr, spinAngle: 0, steer: 0, flameT: 0 }
  }

  function dispose() {
    for (const o of owned) o.dispose?.()
    geoCache.clear()
    matCache.clear()
  }
  return { build, dispose }
}

/** Per-frame wheel spin, steering and flame. */
export function animateCar(rig, dt, fwdSpeed, yawRate, onGround, boosting, time) {
  rig.spinAngle += (fwdSpeed / (rig.wr || 0.3)) * dt
  const sgn = fwdSpeed < 0 ? -1 : 1
  const target = onGround ? THREE.MathUtils.clamp((sgn * yawRate) / (Math.abs(fwdSpeed) * 0.08 + 1.5), -0.6, 0.6) : 0
  rig.steer += (target - rig.steer) * Math.min(1, dt * 12)
  for (const w of rig.wheels) {
    w.spin.rotation.x = rig.spinAngle
    if (w.front) w.pivot.rotation.y = rig.steer
  }
  rig.flameT += ((boosting ? 1 : 0) - rig.flameT) * Math.min(1, dt * 18)
  const on = rig.flameT > 0.04
  for (const f of rig.flames) {
    f.g.visible = on
    if (on) {
      const fl = 0.85 + 0.15 * Math.sin(time * 90 + f.g.position.x * 7) + 0.1 * Math.sin(time * 53)
      const len = rig.L * 0.9 * rig.flameT * fl
      const wd = rig.W * 0.22 * rig.flameT
      f.outer.scale.set(wd, wd, len)
      f.inner.scale.set(wd * 0.5, wd * 0.5, len * 0.6)
    }
  }
}
