// Geometry + texture helpers shared by the stadium, cars and fx.
import * as THREE from 'three'

export const TEAM_COLORS = [0x1e7bff, 0xff7a1a] // blue, orange
export const TEAM_CSS = ['#1e7bff', '#ff7a1a']

/**
 * Points of a rounded rectangle (half extents hx,hz, corner radius r) inset by
 * `o` (negative = outward). Same arc centres for every `o`, so rings at
 * different insets line up vertex for vertex. `endX` inserts extra vertices on
 * the two end walls (z = +-hz) so goal mouths have exact edges.
 * Order is counter-clockwise in the XZ plane. Normals point toward the centre.
 */
export function perimeter(hx, hz, r, n = 10, endX = []) {
  const P = []
  const cx = hx - r
  const cz = hz - r
  const corner = (sx, sz, a0) => {
    for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * (Math.PI / 2)
      const c = Math.cos(a)
      const s = Math.sin(a)
      P.push({ x: sx * cx, z: sz * cz, c, s, arc: true, end: 0, ex: 0 })
    }
  }
  const g = [...endX].sort((a, b) => b - a) // descending
  corner(1, 1, 0)
  // +z end wall, travelling +x -> -x
  for (const x of g) P.push({ x, z: 0, c: 0, s: 1, arc: false, end: 1, ex: x, straight: true })
  corner(-1, 1, Math.PI / 2)
  corner(-1, -1, Math.PI)
  // -z end wall, travelling -x -> +x
  for (const x of [...g].reverse()) P.push({ x, z: 0, c: 0, s: -1, arc: false, end: -1, ex: x, straight: true })
  corner(1, -1, Math.PI * 1.5)
  return { pts: P, hx, hz, r, cx, cz }
}

/** Position + inward normal of perimeter point `p` at inset `o`. */
export function perimPoint(per, p, o, out) {
  if (p.arc) {
    const rr = Math.max(per.r - o, 0.02)
    out.x = p.x + p.c * rr
    out.z = p.z + p.s * rr
    out.nx = -p.c
    out.nz = -p.s
  } else {
    out.x = p.ex
    out.z = p.end * (per.hz - o)
    out.nx = 0
    out.nz = -p.end
  }
  return out
}

/**
 * Sweep a (o, y) profile around a perimeter. profile: [{o,y,no,ny}].
 * opts: skip(i,j)->bool, uv:'planar'|'run', hx,hz, color(x,y,z,target) ,runScale
 */
export function sweep(per, profile, opts = {}) {
  const P = per.pts.length
  const Q = profile.length
  const pos = new Float32Array(P * Q * 3)
  const nor = new Float32Array(P * Q * 3)
  const uv = new Float32Array(P * Q * 2)
  const col = opts.color ? new Float32Array(P * Q * 3) : null
  const tmp = { x: 0, z: 0, nx: 0, nz: 0 }
  const c = new THREE.Color()
  let run = 0
  let px = 0
  let pz = 0
  for (let i = 0; i < P; i++) {
    for (let j = 0; j < Q; j++) {
      const pr = profile[j]
      perimPoint(per, per.pts[i], pr.o, tmp)
      const k = (i * Q + j) * 3
      pos[k] = tmp.x
      pos[k + 1] = pr.y
      pos[k + 2] = tmp.z
      nor[k] = tmp.nx * (pr.no ?? 1)
      nor[k + 1] = pr.ny ?? 0
      nor[k + 2] = tmp.nz * (pr.no ?? 1)
      if (opts.uv === 'planar') {
        uv[(i * Q + j) * 2] = (tmp.x + opts.hx) / (2 * opts.hx)
        uv[(i * Q + j) * 2 + 1] = (tmp.z + opts.hz) / (2 * opts.hz)
      }
      if (col) {
        opts.color(tmp.x, pr.y, tmp.z, c)
        col[k] = c.r
        col[k + 1] = c.g
        col[k + 2] = c.b
      }
    }
    // arc length along the run for u coordinate
    perimPoint(per, per.pts[i], 0, tmp)
    if (i > 0) run += Math.hypot(tmp.x - px, tmp.z - pz)
    px = tmp.x
    pz = tmp.z
    if (opts.uv !== 'planar') {
      let acc = 0
      for (let j = 0; j < Q; j++) {
        if (j > 0) acc += Math.hypot(profile[j].o - profile[j - 1].o, profile[j].y - profile[j - 1].y)
        uv[(i * Q + j) * 2] = run / (opts.runScale || 1)
        uv[(i * Q + j) * 2 + 1] = acc / (opts.profScale || 1)
      }
    }
  }
  const idx = []
  for (let i = 0; i < P; i++) {
    const i2 = (i + 1) % P
    for (let j = 0; j < Q - 1; j++) {
      if (opts.skip && opts.skip(i, i2, j)) continue
      const a = i * Q + j
      const b = i2 * Q + j
      const d = i * Q + j + 1
      const e = i2 * Q + j + 1
      idx.push(a, b, d, b, e, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(idx)
  return g
}

export function arcProfile(centerO, centerY, R, a0, a1, n) {
  const out = []
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n
    const cs = Math.cos(a)
    const sn = Math.sin(a)
    out.push({ o: centerO + R * cs, y: centerY + R * sn, no: -cs, ny: -sn })
  }
  return out
}

export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace
  t.anisotropy = opts.aniso ?? 4
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export function radialTex(stops = [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], size = 128) {
  return canvasTex(size, size, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    for (const [o, c] of stops) gr.addColorStop(o, c)
    g.fillStyle = gr
    g.fillRect(0, 0, w, h)
  })
}

// deterministic rng so the stadium looks the same every load
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
