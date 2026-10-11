// The stadium: turf, glass, goals, stands, crowd, floodlights, sky, boost pads.
import * as THREE from 'three'
import { ARENA, BOOST_PADS } from '../../shared/arena.js'
import { TEAM_COLORS, perimeter, sweep, arcProfile, canvasTex, radialTex, rng } from './util.js'

const BLUE = new THREE.Color(TEAM_COLORS[0])
const ORANGE = new THREE.Color(TEAM_COLORS[1])

export function createStadium(renderer) {
  const A = ARENA
  const hw = A.halfWidth
  const hl = A.halfLength
  const H = A.height
  const cR = A.cornerR
  const wR = Math.min(A.wallR ?? 4, H / 3)
  const G = A.goal
  const gw = G.halfWidth
  const gh = G.height
  const gd = G.depth

  const root = new THREE.Group()
  const disposables = []
  const own = (x) => (disposables.push(x), x)
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uFlash: { value: 0 } }

  // ---------- perimeters ----------
  const per = perimeter(hw, hl, cR, 12, [gw, -gw])
  const tintAt = (z, c) => {
    // blue -z, orange +z, neutral cyan-white in the middle
    const t = THREE.MathUtils.clamp(z / (hl * 0.9), -1, 1)
    const k = Math.pow(Math.abs(t), 1.5)
    c.setRGB(0.55, 0.85, 1.0).lerp(t < 0 ? BLUE : ORANGE, k)
    return c
  }
  const inMouth = (i, i2, yTop) => {
    const a = per.pts[i]
    const b = per.pts[i2]
    return a.end !== 0 && a.end === b.end && Math.abs(a.ex) <= gw + 1e-3 && Math.abs(b.ex) <= gw + 1e-3 && yTop <= gh + 1e-3
  }

  // ---------- turf texture ----------
  const TW = 2048
  const TH = Math.round((TW * hl) / hw)
  const ppm = TW / (2 * hw)
  const X = (x) => (x + hw) * ppm
  const Y = (z) => (1 - (z + hl) / (2 * hl)) * TH
  const R = rng(7)
  const lineDraw = (g, w, glow) => {
    g.lineCap = 'round'
    g.lineWidth = w * ppm
    g.strokeStyle = '#fff'
    g.shadowColor = glow
    g.shadowBlur = glow ? 14 : 0
    const L = (x0, z0, x1, z1) => {
      g.beginPath()
      g.moveTo(X(x0), Y(z0))
      g.lineTo(X(x1), Y(z1))
      g.stroke()
    }
    // halfway + circle
    L(-hw + wR, 0, hw - wR, 0)
    g.beginPath()
    g.arc(X(0), Y(0), hl * 0.17 * ppm, 0, Math.PI * 2)
    g.stroke()
    g.beginPath()
    g.arc(X(0), Y(0), 0.5 * ppm, 0, Math.PI * 2)
    g.fillStyle = '#fff'
    g.fill()
    // boxes at both ends
    for (const s of [-1, 1]) {
      const zl = s * (hl - wR * 0.6)
      const zb = s * (hl - hl * 0.2)
      const zg = s * (hl - hl * 0.075)
      L(-gw * 2.1, zb, gw * 2.1, zb)
      L(-gw * 2.1, zb, -gw * 2.1, zl)
      L(gw * 2.1, zb, gw * 2.1, zl)
      L(-gw * 1.35, zg, gw * 1.35, zg)
      L(-gw * 1.35, zg, -gw * 1.35, zl)
      L(gw * 1.35, zg, gw * 1.35, zl)
    }
  }
  const turfTex = canvasTex(TW, TH, (g, w, h) => {
    const stripes = 14
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#0f4a2c' : '#0b3b23'
      g.fillRect(0, (i * h) / stripes, w, h / stripes + 1)
    }
    // team-tinted ends
    for (const s of [-1, 1]) {
      const gr = g.createLinearGradient(0, Y(s * hl), 0, Y(s * hl * 0.35))
      const c = s < 0 ? '30,123,255' : '255,122,26'
      gr.addColorStop(0, `rgba(${c},0.55)`)
      gr.addColorStop(1, `rgba(${c},0)`)
      g.fillStyle = gr
      g.fillRect(0, Math.min(Y(s * hl), Y(s * hl * 0.35)), w, Math.abs(Y(s * hl) - Y(s * hl * 0.35)))
    }
    // grain
    for (let i = 0; i < 90000; i++) {
      g.fillStyle = R() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)'
      g.fillRect(R() * w, R() * h, 2, 2 + R() * 3)
    }
    // soft line bed under the glow
    g.globalAlpha = 0.5
    lineDraw(g, 0.45, '')
    g.globalAlpha = 1
  }, { aniso: 8 })
  const glowTex = canvasTex(TW, TH, (g, w, h) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    lineDraw(g, 0.32, 'rgba(120,200,255,1)')
    // team rings at the goals
    for (const s of [-1, 1]) {
      g.strokeStyle = s < 0 ? '#1e7bff' : '#ff7a1a'
      g.lineWidth = 0.5 * ppm
      g.shadowColor = g.strokeStyle
      g.shadowBlur = 20
      g.beginPath()
      g.arc(X(0), Y(s * hl), gw * 1.0 * ppm, 0, Math.PI * 2)
      g.stroke()
    }
  }, { aniso: 8 })
  const turfMat = own(new THREE.MeshStandardMaterial({
    map: turfTex, emissiveMap: glowTex, emissive: new THREE.Color(0xbfe4ff), emissiveIntensity: 0.8,
    roughness: 0.55, metalness: 0.05, envMapIntensity: 0.6,
  }))
  disposables.push(turfTex, glowTex)

  // floor fan (inset by wR) + fillet ramps
  {
    const pts = per.pts
    const tmp = { x: 0, z: 0, nx: 0, nz: 0 }
    const pos = [0, 0, 0]
    const uv = [0.5, 0.5]
    for (const p of pts) {
      // floor edge of the ramp is at inset wR
      const o = wR
      if (p.arc) {
        const rr = Math.max(per.r - o, 0.02)
        tmp.x = p.x + p.c * rr
        tmp.z = p.z + p.s * rr
      } else {
        tmp.x = p.ex
        tmp.z = p.end * (hl - o)
      }
      pos.push(tmp.x, 0, tmp.z)
      uv.push((tmp.x + hw) / (2 * hw), (tmp.z + hl) / (2 * hl))
    }
    const idx = []
    for (let i = 0; i < pts.length; i++) idx.push(0, 1 + ((i + 1) % pts.length), 1 + i)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    const floor = new THREE.Mesh(g, turfMat)
    floor.receiveShadow = true
    floor.name = 'floor'
    root.add(floor)
    disposables.push(g)

    const fil = sweep(per, arcProfile(wR, wR, wR, -Math.PI / 2, -Math.PI, 8), {
      uv: 'planar', hx: hw, hz: hl, skip: (i, i2) => inMouth(i, i2, 0),
    })
    const ramp = new THREE.Mesh(fil, turfMat)
    ramp.receiveShadow = true
    turfMat.side = THREE.DoubleSide
    root.add(ramp)
    disposables.push(fil)
  }

  // ---------- glass walls ----------
  const wallProfile = [
    { o: 0, y: wR, no: 1, ny: 0 },
    { o: 0, y: gh, no: 1, ny: 0 },
    { o: 0, y: H - wR, no: 1, ny: 0 },
    ...arcProfile(wR, H - wR, wR, Math.PI, Math.PI / 2, 10).slice(1),
  ]
  // add a few wall-height steps so the hex shader has resolution + goal edge vertex
  const glassGeo = own(sweep(per, wallProfile, {
    skip: (i, i2, j) => inMouth(i, i2, wallProfile[j + 1].y),
  }))
  const glassMat = own(new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uHalfLen: { value: hl }, uBlue: { value: BLUE }, uOrange: { value: ORANGE } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uHalfLen, uFlash; uniform vec3 uBlue, uOrange;
      varying vec3 vW; varying vec3 vN;
      // hex distance
      float hex(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.,1.73))), p.x); }
      vec4 hexc(vec2 uv){ vec2 r = vec2(1.,1.73); vec2 h = r*.5; vec2 a = mod(uv,r)-h; vec2 b = mod(uv-h,r)-h; vec2 g = dot(a,a)<dot(b,b)?a:b; return vec4(g, uv-g); }
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float fr = pow(1. - abs(dot(normalize(vN), V)), 2.2);
        vec2 uv = vec2(vW.x + vW.z, vW.y) * 0.22;
        vec4 hc = hexc(uv);
        float e = .5 - hex(hc.xy);
        float edge = smoothstep(.06,.0,e);
        float pulse = .5+.5*sin(uTime*.7 + length(hc.zw)*.9);
        float t = clamp(vW.z/(uHalfLen*.9), -1., 1.);
        vec3 tint = mix(vec3(.45,.8,1.), t<0.?uBlue:uOrange, pow(abs(t),1.4));
        float a = .035 + fr*.16 + edge*(.035 + .05*pulse);
        // brighter near the floor and ceiling rims
        a += uFlash*.25*edge;
        gl_FragColor = vec4(tint*a*2.2, 1.);
      }`,
  }))
  root.add(new THREE.Mesh(glassGeo, glassMat))

  // neon rails along wall (floor rim + top), team tinted by z
  const railCol = (x, y, z, c) => tintAt(z, c).multiplyScalar(1.3)
  const mkRail = (y0, y1, o) => {
    const g = own(sweep(per, [{ o, y: y0 }, { o, y: y1 }], {
      color: railCol, skip: (i, i2) => inMouth(i, i2, 0) && y0 < gh,
    }))
    const m = new THREE.Mesh(g, own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false })))
    root.add(m)
  }
  mkRail(wR - 0.2, wR + 0.25, 0.04)
  mkRail(H - wR - 0.3, H - wR + 0.2, 0.04)
  mkRail(H - 0.35, H - 0.05, wR - 0.05)

  // ---------- goals ----------
  const goals = []
  for (const s of [-1, 1]) {
    const team = s < 0 ? 0 : 1
    const col = TEAM_COLORS[team]
    const grp = new THREE.Group()
    grp.position.z = s * hl
    grp.scale.z = s
    // goal frame: posts + crossbar (emissive)
    const frameMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.2), toneMapped: false }))
    const post = own(new THREE.CylinderGeometry(0.45, 0.45, gh, 14))
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(post, frameMat)
      m.position.set(sx * gw, gh / 2, 0)
      grp.add(m)
    }
    const bar = new THREE.Mesh(own(new THREE.CylinderGeometry(0.45, 0.45, gw * 2, 14)), frameMat)
    bar.rotation.z = Math.PI / 2
    bar.position.set(0, gh, 0)
    grp.add(bar)
    // net: back, two sides, roof
    const netTex = canvasTex(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h)
      g.strokeStyle = '#ffffff'
      g.lineWidth = 3
      for (let i = 0; i <= 8; i++) {
        g.beginPath(); g.moveTo((i * w) / 8, 0); g.lineTo((i * w) / 8, h); g.stroke()
        g.beginPath(); g.moveTo(0, (i * h) / 8); g.lineTo(w, (i * h) / 8); g.stroke()
      }
    }, { repeat: true })
    disposables.push(netTex)
    const netMat = own(new THREE.MeshBasicMaterial({
      map: netTex, color: new THREE.Color(col).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(0.9),
      transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    const mkNet = (w, h, rx, ry, px, py, pz) => {
      const t = netTex.clone()
      t.needsUpdate = true
      t.repeat.set(w / 3, h / 3)
      disposables.push(t)
      const m = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), netMat.clone())
      m.material.map = t
      disposables.push(m.material)
      m.rotation.set(rx, ry, 0)
      m.position.set(px, py, pz)
      grp.add(m)
    }
    mkNet(gw * 2, gh, 0, 0, 0, gh / 2, gd)
    mkNet(gd, gh, 0, Math.PI / 2, -gw, gh / 2, gd / 2)
    mkNet(gd, gh, 0, Math.PI / 2, gw, gh / 2, gd / 2)
    mkNet(gw * 2, gd, Math.PI / 2, 0, 0, gh, gd / 2)
    // goal floor + glow
    const gfloor = new THREE.Mesh(own(new THREE.PlaneGeometry(gw * 2, gd + wR)), own(new THREE.MeshStandardMaterial({
      color: 0x08101c, emissive: new THREE.Color(col).multiplyScalar(0.18), roughness: 0.4, metalness: 0.4,
    })))
    gfloor.rotation.x = -Math.PI / 2
    gfloor.position.set(0, 0.01, (gd - wR) / 2)
    gfloor.receiveShadow = true
    grp.add(gfloor)
    // back-wall glow pad
    const glow = new THREE.Mesh(own(new THREE.PlaneGeometry(gw * 2.4, gh * 1.3)), own(new THREE.MeshBasicMaterial({
      map: own(radialTex()), color: new THREE.Color(col).multiplyScalar(1.4), transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })))
    glow.position.set(0, gh * 0.5, gd - 0.3)
    grp.add(glow)
    root.add(grp)
    goals.push(grp)
  }

  // ---------- stands ----------
  const d0 = gd + 5
  const rows = 13
  const rowD = 1.15
  const rowH = 0.8
  const R2 = rng(99)
  {
    const prof = [{ o: -(d0 - 2.2), y: 0 }, { o: -(d0 - 2.2), y: 2.2 }, { o: -d0, y: 2.2 }]
    const standPer = perimeter(hw, hl, cR, 12, [])
    // ad board
    const adTex = canvasTex(1024, 64, (g, w, h) => {
      g.fillStyle = '#05080f'; g.fillRect(0, 0, w, h)
      const words = ['CARBALL', 'TURBO', 'NITRO', 'AERIAL', 'BOOST', 'SUPERSONIC']
      g.font = '800 42px sans-serif'; g.textBaseline = 'middle'
      let x = 20
      let i = 0
      while (x < w) {
        const c = ['#1e7bff', '#ff7a1a', '#9ef', '#fff'][i % 4]
        g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 12
        const t = words[i % words.length]
        g.fillText(t, x, h / 2)
        x += g.measureText(t).width + 60
        i++
      }
    }, { repeat: true })
    disposables.push(adTex)
    adTex.repeat.set(1, 1)
    const adGeo = own(sweep(standPer, [{ o: -(d0 - 2.2), y: 0.1 }, { o: -(d0 - 2.2), y: 2.1 }], { runScale: 70, profScale: 2 }))
    root.add(new THREE.Mesh(adGeo, own(new THREE.MeshBasicMaterial({ map: adTex, side: THREE.DoubleSide, toneMapped: false, color: 0xcccccc }))))

    // terraces
    const tp = [{ o: -d0, y: 0 }]
    for (let k = 0; k < rows; k++) {
      tp.push({ o: -(d0 + k * rowD), y: 2.2 + (k + 1) * rowH })
      tp.push({ o: -(d0 + (k + 1) * rowD), y: 2.2 + (k + 1) * rowH })
    }
    const ytop = 2.2 + rows * rowH
    const dback = d0 + rows * rowD
    tp.push({ o: -dback, y: ytop + 14 })
    const terr = own(sweep(standPer, tp, {}))
    const stairs = new THREE.Mesh(terr, own(new THREE.MeshStandardMaterial({
      color: 0x1b2433, roughness: 0.9, metalness: 0.1, flatShading: true, side: THREE.DoubleSide,
    })))
    root.add(stairs)
    // roof canopy + LED rim
    const rp = [{ o: -(dback + 3), y: ytop + 14 }, { o: -(dback - 12), y: ytop + 20 }]
    const roofGeo = own(sweep(standPer, rp, {}))
    root.add(new THREE.Mesh(roofGeo, own(new THREE.MeshStandardMaterial({ color: 0x0a0f18, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide }))))
    const ledGeo = own(sweep(standPer, [{ o: -(dback - 12), y: ytop + 19.4 }, { o: -(dback - 12), y: ytop + 20.2 }], {
      color: (x, y, z, c) => c.setRGB(1.6, 1.8, 2.2),
    }))
    root.add(new THREE.Mesh(ledGeo, own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }))))
    // LED rim along the front of the roof too
    const led2 = own(sweep(standPer, [{ o: -(dback - 12), y: ytop + 20 }, { o: -(dback - 12), y: ytop + 20.3 }], {
      color: (x, y, z, c) => tintAt(z, c).multiplyScalar(2.5),
    }))
    root.add(new THREE.Mesh(led2, own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }))))

    // crowd instances: walk each row's polyline at fixed spacing
    const spots = []
    const finePer = perimeter(hw, hl, cR, 16, [])
    const tmp = { x: 0, z: 0, nx: 0, nz: 0 }
    const pts = finePer.pts
    for (let k = 0; k < rows; k++) {
      const o = -(d0 + (k + 0.5) * rowD)
      const y = 2.2 + (k + 1) * rowH
      const spacing = 1.05
      let carry = 0
      let px = 0
      let pz = 0
      let pnx = 0
      let pnz = 0
      for (let i = 0; i <= pts.length; i++) {
        perimPointLocal(finePer, pts[i % pts.length], o, tmp)
        if (i > 0) {
          const L = Math.hypot(tmp.x - px, tmp.z - pz)
          let t = spacing - carry
          while (t <= L) {
            const f = t / L
            spots.push([px + (tmp.x - px) * f, y, pz + (tmp.z - pz) * f, tmp.nx, tmp.nz, k])
            t += spacing
          }
          carry = L - (t - spacing)
        }
        px = tmp.x; pz = tmp.z; pnx = tmp.nx; pnz = tmp.nz
      }
    }
    // shuffle so truncating the instance count thins the crowd evenly
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(R2() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]]
    }
    const N = spots.length
    const cg = own(new THREE.BoxGeometry(0.42, 0.8, 0.36))
    cg.translate(0, 0.45, 0)
    const phase = new Float32Array(N)
    const palette = [0x203a63, 0x7a1f2a, 0xcfd6e0, 0x2a2f3a, 0x35563a, 0xd7b45b, 0x5b3c8c, 0xe9e9e9].map((c) => new THREE.Color(c))
    const crowdMat = own(new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */`
        attribute float aPhase; uniform float uTime, uExcite;
        varying vec3 vC; varying float vPh; varying float vShade;
        void main(){
          vec3 p = position;
          float s = sin(uTime*(3.0+aPhase*2.5)+aPhase*40.);
          p.y += max(0., s) * (0.02 + uExcite*0.6);
          vec4 w = modelMatrix * instanceMatrix * vec4(p,1.);
          vC = instanceColor; vPh = aPhase;
          vShade = 0.55 + 0.45*normal.y + 0.15*normal.z;
          gl_Position = projectionMatrix*viewMatrix*w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uFlash; varying vec3 vC; varying float vPh; varying float vShade;
        void main(){
          vec3 c = vC*vShade*0.75;
          float f = step(0.9985, fract(sin(vPh*917.3 + floor(uTime*2.0+vPh*13.))*437.5));
          c += f*vec3(6.,6.,5.5);
          gl_FragColor = vec4(c,1.);
        }`,
    }))
    const crowd = new THREE.InstancedMesh(cg, crowdMat, N)
    crowd.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1))
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const sc = new THREE.Vector3()
    const pv = new THREE.Vector3()
    const col = new THREE.Color()
    for (let i = 0; i < N; i++) {
      const [x, y, z, nx, nz] = spots[i]
      q.setFromAxisAngle(up, Math.atan2(nx, nz))
      const s = 0.85 + R2() * 0.4
      sc.set(s, s, s)
      pv.set(x + (R2() - 0.5) * 0.3, y, z + (R2() - 0.5) * 0.3)
      m4.compose(pv, q, sc)
      crowd.setMatrixAt(i, m4)
      col.copy(palette[Math.floor(R2() * palette.length)])
      const t = THREE.MathUtils.clamp(z / (hl + 20), -1, 1)
      if (R2() < Math.abs(t) * 1.1) col.lerp(t < 0 ? BLUE : ORANGE, 0.75)
      crowd.setColorAt(i, col)
      phase[i] = R2()
    }
    crowd.frustumCulled = false
    root.add(crowd)
    var crowdMesh = crowd
    var crowdTotal = N
  }

  // ---------- floodlights ----------
  const lamps = []
  {
    const dback = d0 + rows * rowD
    const lx = hw + dback + 6
    const lz = hl + dback + 6
    const towerH = H * 2.4 + 25
    const poleGeo = own(new THREE.CylinderGeometry(0.7, 1.4, towerH, 8))
    const poleMat = own(new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.7, metalness: 0.5 }))
    const panelGeo = own(new THREE.PlaneGeometry(1.7, 1.7))
    const panelMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 0.95).multiplyScalar(3.5), toneMapped: false, side: THREE.DoubleSide }))
    const flareTex = own(radialTex([[0, 'rgba(255,255,245,1)'], [0.15, 'rgba(255,250,230,0.6)'], [0.5, 'rgba(180,210,255,0.12)'], [1, 'rgba(120,160,255,0)']], 256))
    const flareMat = own(new THREE.SpriteMaterial({ map: flareTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.9 }))
    const coneGeo = own(new THREE.ConeGeometry(34, 1, 24, 1, true))
    coneGeo.translate(0, -0.5, 0)
    coneGeo.rotateX(-Math.PI / 2) // apex at origin, opening toward +z (we lookAt the centre)
    const coneMat = own(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normal; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 vP; varying vec3 vN; void main(){ float t = clamp(vP.z, 0., 1.); gl_FragColor = vec4(vec3(.5,.62,.9)*0.05*(1.-t*.6),1.); }',
    }))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const g = new THREE.Group()
      g.position.set(sx * lx, 0, sz * lz)
      const pole = new THREE.Mesh(poleGeo, poleMat)
      pole.position.y = towerH / 2
      g.add(pole)
      const head = new THREE.Group()
      head.position.y = towerH
      for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) {
        const p = new THREE.Mesh(panelGeo, panelMat)
        p.position.set((a - 1.5) * 1.9, (b - 1) * 1.9, 0)
        head.add(p)
      }
      const spr = new THREE.Sprite(flareMat)
      spr.scale.setScalar(26)
      spr.position.z = 1
      head.add(spr)
      g.add(head)
      head.lookAt(new THREE.Vector3(-sx * lx, -towerH, -sz * lz).add(head.position))
      // cone of light toward the pitch
      const cone = new THREE.Mesh(coneGeo, coneMat)
      const len = Math.hypot(lx, lz, towerH)
      cone.scale.set(1, 1, len)
      cone.position.copy(head.position)
      cone.lookAt(new THREE.Vector3(-sx * lx, -towerH, -sz * lz).add(head.position))
      g.add(cone)
      root.add(g)
      lamps.push(g)
    }
  }

  // ---------- sky ----------
  const sky = new THREE.Mesh(
    own(new THREE.SphereGeometry(1800, 32, 16)),
    own(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: /* glsl */`
        varying vec3 vD;
        float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vD);
          float y = d.y;
          vec3 top = vec3(.008,.014,.045), mid = vec3(.03,.05,.13), hor = vec3(.16,.13,.22);
          vec3 c = mix(hor, mid, smoothstep(0.,.25,y)); c = mix(c, top, smoothstep(.2,.9,y));
          // city glow band
          c += vec3(.25,.12,.08)*exp(-abs(y)*14.)*.5;
          // stars
          vec3 g = floor(d*260.); float r = h(g);
          float star = step(.9965, r) * smoothstep(0.05,.35,y);
          star *= .5+.5*h(g+3.);
          c += star*vec3(.9,.95,1.)*1.5;
          // moon
          vec3 m = normalize(vec3(-.5,.45,-.75)); float md = dot(d,m);
          c += vec3(.8,.9,1.)*smoothstep(.9992,.9996,md)*3. + vec3(.35,.45,.7)*pow(max(md,0.),90.)*.5;
          gl_FragColor = vec4(c,1.);
        }`,
    })),
  )
  sky.renderOrder = -10
  root.add(sky)

  // ---------- scoreboard ----------
  const sbCanvas = document.createElement('canvas')
  sbCanvas.width = 1024
  sbCanvas.height = 256
  const sbCtx = sbCanvas.getContext('2d')
  const sbTex = new THREE.CanvasTexture(sbCanvas)
  sbTex.colorSpace = THREE.SRGBColorSpace
  disposables.push(sbTex)
  let sbKey = ''
  const sbGroup = new THREE.Group()
  {
    const m = own(new THREE.MeshBasicMaterial({ map: sbTex, toneMapped: false }))
    const side = own(new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.5, metalness: 0.7 }))
    const w = 36
    const h = 9
    const box = new THREE.Mesh(own(new THREE.BoxGeometry(w, h, w)), [side, side, side, side, side, side])
    box.scale.set(1, 1, 1)
    sbGroup.add(box)
    const face = own(new THREE.PlaneGeometry(w - 1, h - 1))
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Mesh(face, m)
      const a = (k * Math.PI) / 2
      p.position.set(Math.sin(a) * (w / 2 + 0.05), 0, Math.cos(a) * (w / 2 + 0.05))
      p.rotation.y = a
      sbGroup.add(p)
    }
    sbGroup.position.y = H + 22
    root.add(sbGroup)
  }
  function drawScoreboard(state) {
    const s = state?.score ?? [0, 0]
    const t = Math.max(0, Math.ceil(state?.clock ?? 0))
    const key = `${s[0]}|${s[1]}|${t}|${state?.overtime ? 1 : 0}`
    if (key === sbKey) return
    sbKey = key
    const g = sbCtx
    g.fillStyle = '#04070d'
    g.fillRect(0, 0, 1024, 256)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '900 150px system-ui, sans-serif'
    g.fillStyle = '#1e7bff'; g.shadowColor = '#1e7bff'; g.shadowBlur = 24
    g.fillText(String(s[0]), 170, 120)
    g.fillStyle = '#ff7a1a'; g.shadowColor = '#ff7a1a'
    g.fillText(String(s[1]), 854, 120)
    g.fillStyle = '#fff'; g.shadowColor = '#9cf'; g.font = '800 96px system-ui, sans-serif'
    const mm = state?.overtime ? '+' : ''
    g.fillText(`${mm}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, 512, 110)
    g.font = '700 28px system-ui, sans-serif'; g.shadowBlur = 0; g.fillStyle = '#8aa'
    g.fillText(state?.overtime ? 'OVERTIME' : 'CARBALL', 512, 215)
    sbTex.needsUpdate = true
  }
  drawScoreboard(null)

  // ---------- boost pads ----------
  const pads = BOOST_PADS
  const bigIdx = []
  const smallIdx = []
  pads.forEach((p, i) => (p.big ? bigIdx : smallIdx).push(i))
  const padTex = own(radialTex([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]))
  const discGeo = own(new THREE.CylinderGeometry(1, 1.15, 0.12, 20))
  const baseMat = own(new THREE.MeshStandardMaterial({ color: 0x111a28, roughness: 0.35, metalness: 0.8 }))
  const padBase = new THREE.InstancedMesh(discGeo, baseMat, pads.length)
  const glowPlane = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))
  const padGlow = new THREE.InstancedMesh(glowPlane, own(new THREE.MeshBasicMaterial({
    map: padTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  })), pads.length)
  const orbGeo = own(new THREE.IcosahedronGeometry(1, 2))
  const orbMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }))
  const padOrb = new THREE.InstancedMesh(orbGeo, orbMat, Math.max(bigIdx.length, 1))
  const beamGeo = own(new THREE.CylinderGeometry(0.9, 1.2, 1, 16, 1, true))
  beamGeo.translate(0, 0.5, 0)
  const padBeam = new THREE.InstancedMesh(beamGeo, own(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float vY; varying vec3 vC; void main(){ vY = position.y; vC = instanceColor; gl_Position = projectionMatrix*viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.); }',
    fragmentShader: 'varying float vY; varying vec3 vC; void main(){ gl_FragColor = vec4(vC*(1.-vY)*(1.-vY)*0.55,1.); }',
  })), Math.max(bigIdx.length, 1))
  const ringGeo = own(new THREE.RingGeometry(0.72, 0.95, 24).rotateX(-Math.PI / 2))
  const padRing = new THREE.InstancedMesh(ringGeo, own(new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide })), pads.length)
  for (const m of [padBase, padGlow, padOrb, padBeam, padRing]) { m.frustumCulled = false; root.add(m) }
  const padOn = new Array(pads.length).fill(null)
  const padColActive = new THREE.Color(1.0, 0.85, 0.3)
  const padColSmall = new THREE.Color(1.0, 0.7, 0.25)
  const padDim = new THREE.Color(0.06, 0.05, 0.04)
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const V = new THREE.Vector3()
  const S = new THREE.Vector3()
  const tmpC = new THREE.Color()
  const bigSlot = new Map(bigIdx.map((pi, k) => [pi, k]))
  pads.forEach((p, i) => {
    const r = p.big ? 1.9 : 1.0
    M.compose(V.set(p.p[0], 0.06, p.p[2]), Q.identity(), S.set(r, 1, r))
    padBase.setMatrixAt(i, M)
    M.compose(V.set(p.p[0], 0.1, p.p[2]), Q.identity(), S.set(r * 4.2, 1, r * 4.2))
    padGlow.setMatrixAt(i, M)
    M.compose(V.set(p.p[0], 0.13, p.p[2]), Q.identity(), S.set(r, 1, r))
    padRing.setMatrixAt(i, M)
  })
  padBase.instanceMatrix.needsUpdate = padGlow.instanceMatrix.needsUpdate = padRing.instanceMatrix.needsUpdate = true

  function updatePads(state, t) {
    const act = state?.pads
    for (let i = 0; i < pads.length; i++) {
      const on = act ? !!act[i] : true
      if (padOn[i] !== on) {
        padOn[i] = on
        const base = pads[i].big ? padColActive : padColSmall
        tmpC.copy(on ? base : padDim)
        padRing.setColorAt(i, tmpC)
        padGlow.setColorAt(i, tmpC.copy(on ? base : padDim).multiplyScalar(on ? (pads[i].big ? 0.9 : 0.55) : 0.2))
        if (padRing.instanceColor) padRing.instanceColor.needsUpdate = true
        if (padGlow.instanceColor) padGlow.instanceColor.needsUpdate = true
      }
    }
    for (let k = 0; k < bigIdx.length; k++) {
      const i = bigIdx[k]
      const p = pads[i].p
      const on = padOn[i]
      const bob = 2.6 + Math.sin(t * 2 + k) * 0.35
      const s = on ? 0.95 + Math.sin(t * 3 + k) * 0.07 : 0.0001
      Q.setFromAxisAngle(V.set(0, 1, 0), t + k)
      M.compose(V.set(p[0], bob, p[2]), Q, S.set(s, s, s))
      padOrb.setMatrixAt(k, M)
      tmpC.copy(padColActive)
      padOrb.setColorAt(k, tmpC.multiplyScalar(2.2))
      M.compose(V.set(p[0], 0.1, p[2]), Q.identity(), S.set(on ? 1 : 0.0001, on ? 9 : 0.0001, on ? 1 : 0.0001))
      padBeam.setMatrixAt(k, M)
      padBeam.setColorAt(k, tmpC.copy(padColActive).multiplyScalar(0.8))
    }
    padOrb.instanceMatrix.needsUpdate = true
    padBeam.instanceMatrix.needsUpdate = true
    if (padOrb.instanceColor) padOrb.instanceColor.needsUpdate = true
    if (padBeam.instanceColor) padBeam.instanceColor.needsUpdate = true
  }

  // ---------- lights & environment ----------
  const hemi = new THREE.HemisphereLight(0x6f8cff, 0x14202f, 0.45)
  root.add(hemi)
  const sun = new THREE.DirectionalLight(0xdfe9ff, 1.6)
  sun.position.set(hw * 0.4, H * 4, hl * 0.2)
  sun.target.position.set(0, 0, 0)
  sun.shadow.mapSize.set(2048, 2048)
  const sc2 = sun.shadow.camera
  const ext = Math.max(hw, hl) * 1.1
  sc2.left = -ext * 0.8; sc2.right = ext * 0.8; sc2.top = ext; sc2.bottom = -ext
  sc2.near = 1; sc2.far = H * 10
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.05
  root.add(sun, sun.target)
  const fill = new THREE.DirectionalLight(0xff9a60, 0.5)
  fill.position.set(-hw, H * 2, -hl * 0.5)
  root.add(fill)
  const flash = new THREE.PointLight(0xffffff, 0, 400, 1.2)
  root.add(flash)

  function setQuality(q) {
    const frac = q === 'low' ? 0.2 : q === 'high' ? 1 : 0.55
    crowdMesh.count = Math.floor(crowdTotal * frac)
    sun.castShadow = q === 'high'
    sun.shadow.needsUpdate = true
  }

  function update(state, t, dt, excite) {
    uniforms.uTime.value = t
    uniforms.uExcite.value = excite
    updatePads(state, t)
    drawScoreboard(state)
    sbGroup.rotation.y = t * 0.05
  }

  function dispose() {
    for (const d of disposables) d?.dispose?.()
    padBase.dispose(); padGlow.dispose(); padOrb.dispose(); padBeam.dispose(); padRing.dispose(); crowdMesh.dispose()
  }

  return { root, update, setQuality, dispose, flash, sun, uniforms, goals, dims: { hw, hl, H, wR, gw, gh, gd, standOuter: d0 + rows * rowD } }
}

// local copy of perimPoint avoiding an import cycle in the hot loop above
function perimPointLocal(per, p, o, out) {
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
}
