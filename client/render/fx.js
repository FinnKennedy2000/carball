// Particles, ribbons, shockwaves, debris and camera shake. All pooled; nothing
// allocates per frame.
import * as THREE from 'three'

const R = Math.random

// ---------------- point-sprite particle pool ----------------
function makePool(N, additive) {
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 4)
  const siz = new Float32Array(N)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('size', new THREE.BufferAttribute(siz, 1).setUsage(THREE.DynamicDrawUsage))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 } },
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute float size; attribute vec4 color; uniform float uScale; varying vec4 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.);
        gl_PointSize = clamp(size*uScale/max(-mv.z,0.5), 0., 400.); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      varying vec4 vC;
      void main(){ vec2 d = gl_PointCoord-.5; float r = length(d)*2.; if(r>1.) discard;
        float a = pow(1.-r, 1.6); gl_FragColor = vec4(vC.rgb, vC.a*a); }`,
  })
  const pts = new THREE.Points(geo, mat)
  pts.frustumCulled = false
  const st = {
    N, pts, mat, geo, pos, col, siz, cursor: 0,
    vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N),
    life: new Float32Array(N), max: new Float32Array(N), s0: new Float32Array(N), s1: new Float32Array(N),
    r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N), a: new Float32Array(N),
    grav: new Float32Array(N), drag: new Float32Array(N),
  }
  return st
}

function emitP(P, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0) {
  const i = P.cursor
  P.cursor = (i + 1) % P.N
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z
  P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz
  P.life[i] = life; P.max[i] = life; P.s0[i] = s0; P.s1[i] = s1
  P.r[i] = r; P.g[i] = g; P.b[i] = b; P.a[i] = a; P.grav[i] = grav; P.drag[i] = drag
}

function stepP(P, dt, floorY) {
  const { pos, col, siz } = P
  for (let i = 0; i < P.N; i++) {
    const l = P.life[i]
    if (l <= 0) {
      if (siz[i] !== 0) { siz[i] = 0; col[i * 4 + 3] = 0 }
      continue
    }
    P.life[i] = l - dt
    const k = 1 - (l - dt) / P.max[i] // 0..1 age
    const dr = Math.max(0, 1 - P.drag[i] * dt)
    P.vx[i] *= dr; P.vy[i] = P.vy[i] * dr - P.grav[i] * dt; P.vz[i] *= dr
    const o = i * 3
    pos[o] += P.vx[i] * dt; pos[o + 1] += P.vy[i] * dt; pos[o + 2] += P.vz[i] * dt
    if (pos[o + 1] < floorY && P.grav[i] > 0) { pos[o + 1] = floorY; P.vy[i] *= -0.35; P.vx[i] *= 0.8; P.vz[i] *= 0.8 }
    siz[i] = P.s0[i] + (P.s1[i] - P.s0[i]) * k
    const f = 1 - k
    col[i * 4] = P.r[i]; col[i * 4 + 1] = P.g[i]; col[i * 4 + 2] = P.b[i]
    col[i * 4 + 3] = P.a[i] * f * Math.min(1, k * 12 + 0.2)
  }
  P.geo.attributes.position.needsUpdate = true
  P.geo.attributes.color.needsUpdate = true
  P.geo.attributes.size.needsUpdate = true
}

// ---------------- ribbon trail ----------------
export class Trail {
  constructor(n, color, additive = true) {
    this.n = n
    this.hist = new Float32Array(n * 7) // x y z sx sy sz w
    this.head = 0
    this.count = 0
    this.color = new THREE.Color(color)
    this.pos = new Float32Array(n * 2 * 3)
    this.cols = new Float32Array(n * 2 * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(this.cols, 3).setUsage(THREE.DynamicDrawUsage))
    const idx = []
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    g.setIndex(idx)
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }))
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.idle = 0
  }
  /** push a sample; width 0 = fade out */
  push(x, y, z, sx, sy, sz, w) {
    this.head = (this.head + 1) % this.n
    const o = this.head * 7
    const h = this.hist
    h[o] = x; h[o + 1] = y; h[o + 2] = z; h[o + 3] = sx; h[o + 4] = sy; h[o + 5] = sz; h[o + 6] = w
    this.count = Math.min(this.count + 1, this.n)
    this.idle = w > 0.001 ? 0 : this.idle + 1
    if (this.idle > this.n) { this.mesh.visible = false; return }
    this.mesh.visible = true
    const { n, pos, cols, hist, color } = this
    for (let i = 0; i < n; i++) {
      const src = ((this.head - i + n) % n) * 7
      const live = i < this.count
      const f = live ? 1 - i / (n - 1) : 0
      const w2 = hist[src + 6] * f
      const o2 = i * 6
      pos[o2] = hist[src] + hist[src + 3] * w2; pos[o2 + 1] = hist[src + 1] + hist[src + 4] * w2; pos[o2 + 2] = hist[src + 2] + hist[src + 5] * w2
      pos[o2 + 3] = hist[src] - hist[src + 3] * w2; pos[o2 + 4] = hist[src + 1] - hist[src + 4] * w2; pos[o2 + 5] = hist[src + 2] - hist[src + 5] * w2
      const c = f * f * Math.min(1, hist[src + 6] * 4)
      cols[o2] = cols[o2 + 3] = color.r * c
      cols[o2 + 1] = cols[o2 + 4] = color.g * c
      cols[o2 + 2] = cols[o2 + 5] = color.b * c
    }
    this.mesh.geometry.attributes.position.needsUpdate = true
    this.mesh.geometry.attributes.color.needsUpdate = true
  }
  reset() { this.count = 0; this.idle = this.n + 1; this.mesh.visible = false }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose() }
}

// ---------------- the fx system ----------------
export function createFx(scene) {
  const add = makePool(3000, true)
  const smoke = makePool(600, false)
  scene.add(smoke.pts, add.pts)
  const group = new THREE.Group()
  scene.add(group)

  // shockwave rings + one shell
  const ringGeo = new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2)
  const shellGeo = new THREE.SphereGeometry(1, 48, 24)
  const waves = []
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(i < 6 ? ringGeo : shellGeo, new THREE.MeshBasicMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }))
    if (i >= 6) m.material.onBeforeCompile = (sh) => { // fade to nothing at the silhouette: no hard edge
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vN; varying vec3 vV;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvN = normalize(normalMatrix * normal); vV = -(modelViewMatrix * vec4(position, 1.)).xyz;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vN; varying vec3 vV;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= pow(abs(dot(normalize(vN), normalize(vV))), 1.6);')
    }
    m.visible = false
    group.add(m)
    waves.push({ m, t: 0, dur: 1, r1: 10, a: 1, shell: i >= 6 })
  }
  let waveCur = 0
  function wave(shell, x, y, z, r1, dur, color, a = 1, tilt = false) {
    let w
    for (let k = 0; k < 8; k++) {
      const c = waves[(waveCur + k) % 8]
      if (c.shell === shell) { w = c; waveCur = (waveCur + k + 1) % 8; break }
    }
    w.t = 0; w.dur = dur; w.r1 = r1; w.a = a
    w.m.position.set(x, y, z)
    w.m.material.color.copy(color).multiplyScalar(2.2)
    w.m.visible = true
  }

  // debris
  const DN = 40
  const debrisGeo = new THREE.BoxGeometry(1, 1, 1)
  const debris = new THREE.InstancedMesh(debrisGeo, new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.7 }), DN)
  debris.frustumCulled = false
  debris.castShadow = true
  group.add(debris)
  const D = {
    p: new Float32Array(DN * 3), v: new Float32Array(DN * 3), r: new Float32Array(DN * 3), rv: new Float32Array(DN * 3),
    s: new Float32Array(DN * 3), life: new Float32Array(DN),
  }
  let dCur = 0
  const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler(), dp = new THREE.Vector3(), ds = new THREE.Vector3()
  const dc = new THREE.Color()
  for (let i = 0; i < DN; i++) { dm.makeScale(0, 0, 0); debris.setMatrixAt(i, dm); debris.setColorAt(i, dc.set(0xffffff)) }

  // fireworks queue
  const FW = 24
  const fw = { t: new Float32Array(FW), x: new Float32Array(FW), y: new Float32Array(FW), z: new Float32Array(FW), c: new Array(FW).fill(null), n: 0 }
  const tmpC = new THREE.Color()

  const sh = { trauma: 0, t: 0 }
  const light = { l: null, v: 0, dur: 1, t0: 0, col: new THREE.Color() }

  // ---- emitters ----
  function sparks(x, y, z, n, speed, r, g, b, dirx = 0, diry = 1, dirz = 0, spread = 1) {
    for (let i = 0; i < Math.min(n, 150); i++) {
      const vx = (R() - 0.5) * 2 * spread + dirx, vy = (R() - 0.3) * 1.6 * spread + diry, vz = (R() - 0.5) * 2 * spread + dirz
      const k = speed * (0.4 + R() * 0.8)
      emitP(add, x, y, z, vx * k, vy * k, vz * k, 0.35 + R() * 0.5, 0.3, 0.05, r, g, b, 1, 14, 0.8)
    }
  }
  function burst(x, y, z, n, speed, color, life = 1.2, size = 0.8, grav = 6) {
    for (let i = 0; i < Math.min(n, 150); i++) {
      let vx = R() - 0.5, vy = R() - 0.5, vz = R() - 0.5
      const l = Math.hypot(vx, vy, vz) || 1
      const k = (speed * (0.3 + R() * 0.9)) / l
      emitP(add, x, y, z, vx * k, vy * k, vz * k, life * (0.5 + R() * 0.7), size, size * 0.1, color.r * 2, color.g * 2, color.b * 2, 1, grav, 0.6)
    }
  }
  function smokePuff(x, y, z, n, speed, size, r, g, b, a = 0.35, life = 1.2) {
    for (let i = 0; i < Math.min(n, 150); i++) {
      emitP(smoke, x + (R() - 0.5) * size, y, z + (R() - 0.5) * size, (R() - 0.5) * speed, R() * speed * 0.5 + 0.3, (R() - 0.5) * speed, life * (0.6 + R() * 0.6), size * 0.4, size * 1.6, r, g, b, a, -0.5, 1.2)
    }
  }
  function shake(a) { sh.trauma = Math.min(1, sh.trauma + a) }
  function flash(color, intensity, dur) { light.col.copy(color); light.v = intensity; light.dur = dur; light.t0 = intensity }
  function spawnDebris(x, y, z, color, n) {
    for (let k = 0; k < n; k++) {
      const i = dCur; dCur = (dCur + 1) % DN
      D.p[i * 3] = x; D.p[i * 3 + 1] = y; D.p[i * 3 + 2] = z
      const sp = 10 + R() * 18
      D.v[i * 3] = (R() - 0.5) * sp; D.v[i * 3 + 1] = 6 + R() * sp * 0.8; D.v[i * 3 + 2] = (R() - 0.5) * sp
      D.rv[i * 3] = (R() - 0.5) * 14; D.rv[i * 3 + 1] = (R() - 0.5) * 14; D.rv[i * 3 + 2] = (R() - 0.5) * 14
      D.r[i * 3] = R() * 6; D.r[i * 3 + 1] = R() * 6; D.r[i * 3 + 2] = R() * 6
      const s = 0.2 + R() * 0.45
      D.s[i * 3] = s; D.s[i * 3 + 1] = s * (0.3 + R()); D.s[i * 3 + 2] = s * (0.5 + R())
      D.life[i] = 2.2 + R() * 1.4
      debris.setColorAt(i, R() < 0.5 ? color : dc.set(0x1a1d24))
      if (debris.instanceColor) debris.instanceColor.needsUpdate = true
    }
  }

  function goal(x, y, z, team, teamColor, arenaH, hw, hl) {
    const c = teamColor
    burst(x, y, z, 700, 38, c, 1.8, 1.4, 8)
    burst(x, y, z, 250, 24, tmpC.set(1, 1, 1), 1.2, 1.0, 8)
    wave(false, x, 0.4, z, 70, 1.1, c, 0.45)
    wave(false, x, 0.4, z, 45, 0.8, tmpC.set(1, 1, 1), 0.3)
    wave(true, x, y, z, 40, 0.9, c, 0.12)
    flash(c, 1400, 2.2)
    shake(0.95)
    // confetti rain
    for (let i = 0; i < 360; i++) {
      const cc = i % 3 === 0 ? tmpC.set(1, 1, 1) : c
      emitP(smoke, (R() - 0.5) * 2 * hw, arenaH * (0.7 + R() * 0.3), (R() - 0.5) * 2 * hl, (R() - 0.5) * 3, -2 - R() * 3, (R() - 0.5) * 3, 3 + R() * 2, 0.6, 0.5, cc.r * (0.6 + R() * 0.5), cc.g * (0.6 + R() * 0.5), cc.b * (0.6 + R() * 0.5), 0.95, 0.3, 0.2)
    }
    // fireworks over the next two seconds, above the goal end
    for (let i = 0; i < 14 && fw.n < FW; i++) {
      const k = fw.n++
      fw.t[k] = 0.15 + i * 0.16 + R() * 0.1
      fw.x[k] = (R() - 0.5) * hw * 1.4
      fw.y[k] = arenaH * (0.6 + R() * 0.5)
      fw.z[k] = Math.sign(z || (team ? 1 : -1)) * hl * (0.2 + R() * 0.7)
      fw.c[k] = i % 2 ? c : tmpC.set(1, 0.95, 0.7).clone()
    }
  }
  function demo(x, y, z, color) {
    const c = tmpC.set(1, 0.55, 0.12)
    burst(x, y, z, 260, 30, c, 1.0, 1.4, 6)
    burst(x, y, z, 90, 18, color, 0.9, 1.1, 6)
    burst(x, y, z, 70, 40, tmpC.set(1, 0.95, 0.7), 0.5, 0.7, 4)
    smokePuff(x, y, z, 40, 9, 3.2, 0.12, 0.1, 0.1, 0.55, 2.2)
    wave(false, x, Math.max(y - 0.5, 0.2), z, 14, 0.5, c.clone(), 0.8)
    wave(true, x, y, z, 7, 0.4, c.clone(), 0.5)
    spawnDebris(x, y, z, color, 18)
    flash(c.clone(), 250, 0.6)
  }

  function update(dt, camera, viewH, floorY = 0.05) {
    const tanH = Math.tan((camera.fov * Math.PI) / 360)
    add.mat.uniforms.uScale.value = smoke.mat.uniforms.uScale.value = viewH / (2 * tanH)
    stepP(add, dt, floorY)
    stepP(smoke, dt, floorY)
    // waves
    for (const w of waves) {
      if (!w.m.visible) continue
      w.t += dt
      const k = w.t / w.dur
      if (k >= 1) { w.m.visible = false; continue }
      const e = 1 - (1 - k) * (1 - k)
      const s = Math.max(0.01, w.r1 * e)
      w.m.scale.set(s, w.shell ? s : 1, s)
      w.m.material.opacity = w.a * (1 - k) * (1 - k)
    }
    // debris
    let any = false
    for (let i = 0; i < DN; i++) {
      if (D.life[i] <= 0) continue
      any = true
      D.life[i] -= dt
      const o = i * 3
      D.v[o + 1] -= 24 * dt
      D.p[o] += D.v[o] * dt; D.p[o + 1] += D.v[o + 1] * dt; D.p[o + 2] += D.v[o + 2] * dt
      if (D.p[o + 1] < 0.2) { D.p[o + 1] = 0.2; D.v[o + 1] *= -0.4; D.v[o] *= 0.7; D.v[o + 2] *= 0.7; D.rv[o] *= 0.6; D.rv[o + 1] *= 0.6; D.rv[o + 2] *= 0.6 }
      D.r[o] += D.rv[o] * dt; D.r[o + 1] += D.rv[o + 1] * dt; D.r[o + 2] += D.rv[o + 2] * dt
      const sc = D.life[i] > 0 ? Math.min(1, D.life[i] * 2) : 0
      de.set(D.r[o], D.r[o + 1], D.r[o + 2])
      dq.setFromEuler(de)
      dp.set(D.p[o], D.p[o + 1], D.p[o + 2])
      ds.set(D.s[o] * sc, D.s[o + 1] * sc, D.s[o + 2] * sc)
      dm.compose(dp, dq, ds)
      debris.setMatrixAt(i, dm)
    }
    if (any) debris.instanceMatrix.needsUpdate = true
    // fireworks
    for (let k = 0; k < fw.n; k++) {
      fw.t[k] -= dt
      if (fw.t[k] <= 0) {
        burst(fw.x[k], fw.y[k], fw.z[k], 90, 16, fw.c[k], 1.6, 1.1, 4)
        burst(fw.x[k], fw.y[k], fw.z[k], 20, 7, tmpC.set(1, 1, 1), 1.0, 1.4, 3)
        fw.n--
        fw.t[k] = fw.t[fw.n]; fw.x[k] = fw.x[fw.n]; fw.y[k] = fw.y[fw.n]; fw.z[k] = fw.z[fw.n]; fw.c[k] = fw.c[fw.n]
        k--
      }
    }
    // light flash
    if (light.l) {
      light.v = Math.max(0, light.v - (light.t0 / light.dur) * dt)
      light.l.intensity = light.v
      light.l.color.copy(light.col)
    }
    sh.trauma = Math.max(0, sh.trauma - dt * 1.1)
    sh.t += dt
  }

  function shakeOffset(out) {
    const a = sh.trauma * sh.trauma
    const t = sh.t * 38
    out.x = a * (Math.sin(t * 1.3) + Math.sin(t * 2.7 + 1)) * 0.5
    out.y = a * (Math.sin(t * 1.9 + 2) + Math.sin(t * 3.1)) * 0.5
    out.z = a * Math.sin(t * 1.1 + 4)
    return out
  }

  return {
    group, add, smoke, sparks, burst, smokePuff, shake, flash, wave, goal, demo, update, shakeOffset,
    setLight(l) { light.l = l },
    get trauma() { return sh.trauma },
    dispose() {
      for (const P of [add, smoke]) { P.geo.dispose(); P.mat.dispose() }
      ringGeo.dispose(); shellGeo.dispose(); debrisGeo.dispose(); debris.material.dispose(); debris.dispose()
      for (const w of waves) w.m.material.dispose()
    },
  }
}
