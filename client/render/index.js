// Renderer entry. See REBUILD.md "Rendering".
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'
import * as C from '../../shared/constants.js'
import { BOOST_PADS } from '../../shared/arena.js'
import { createStadium } from './stadium.js'
import { createCarKit, animateCar, carKeys } from './cars.js'
import { createBall } from './ball.js'
import { createFx, Trail } from './fx.js'
import { makeEnvironment } from './env.js'
import { TEAM_COLORS, TEAM_CSS, radialTex } from './util.js'

export { createCarPreview } from './preview.js'

// Model forward axis. The cars are built facing +Z in local space; flip to
// Math.PI if the sim's orientation convention has forward = -Z.
const MODEL_YAW = 0
const BALL_R = C.BALL_R ?? 1

export const QUALITY = {
  low: { pr: 0.75, shadows: false, bloom: false, aa: 'none', msaa: 0 },
  medium: { pr: 1.25, shadows: false, bloom: true, aa: 'fxaa', msaa: 0 },
  high: { pr: 2, shadows: true, bloom: true, aa: 'msaa', msaa: 4 },
}

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _f = new THREE.Vector3()
const _u = new THREE.Vector3()
const _r = new THREE.Vector3()
const _w = new THREE.Vector3()
const _look = new THREE.Vector3()
const _shake = { x: 0, y: 0, z: 0 }
const UP = new THREE.Vector3(0, 1, 0)
const damp = (k, dt) => 1 - Math.exp(-k * dt)

export function createRenderer(canvas, { quality = 'medium' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const env = makeEnvironment(renderer)
  scene.environment = env
  scene.environmentIntensity = 0.55
  const camera = new THREE.PerspectiveCamera(75, 1, 0.3, 4000)
  scene.add(camera)

  const stadium = createStadium(renderer)
  scene.add(stadium.root)
  const D = stadium.dims
  const fx = createFx(scene)
  fx.setLight(stadium.flash)
  const kit = createCarKit()
  const ball = createBall(BALL_R)
  scene.add(ball.group)
  const ballTrail = new Trail(26, 0x9fe0ff)
  scene.add(ballTrail.mesh)

  // ground contact: soft blobs + ball indicator ring
  const blobTex = radialTex([[0, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']], 64)
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.8 })
  const ballBlob = new THREE.Mesh(blobGeo, blobMat)
  scene.add(ballBlob)
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 1).multiplyScalar(2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const ballRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), ringMat)
  scene.add(ballRing)

  // ---------- quality / post ----------
  let q = 'medium'
  let composer = null
  let bloom = null
  let fxaa = null
  let W = 1
  let Hh = 1
  function pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, QUALITY[q].pr)
  }
  function buildPost() {
    composer?.dispose?.()
    composer = bloom = fxaa = null
    const P = QUALITY[q]
    if (q === 'low') return
    const pr = pixelRatio()
    const rt = new THREE.WebGLRenderTarget(W * pr, Hh * pr, { type: THREE.HalfFloatType, samples: P.msaa })
    composer = new EffectComposer(renderer, rt)
    composer.setPixelRatio(pr)
    composer.setSize(W, Hh)
    composer.addPass(new RenderPass(scene, camera))
    if (P.bloom) {
      const s = q === 'high' ? 1 : 0.5
      bloom = new UnrealBloomPass(new THREE.Vector2(W * s, Hh * s), q === 'high' ? 0.42 : 0.38, 0.45, 1.0)
      composer.addPass(bloom)
    }
    composer.addPass(new OutputPass())
    if (P.aa === 'fxaa') {
      fxaa = new ShaderPass(FXAAShader)
      composer.addPass(fxaa)
    }
    applyFxaaRes()
  }
  function applyFxaaRes() {
    if (fxaa) {
      const pr = pixelRatio()
      fxaa.material.uniforms.resolution.value.set(1 / (W * pr), 1 / (Hh * pr))
    }
  }
  function resize() {
    W = Math.max(2, canvas.clientWidth || window.innerWidth)
    Hh = Math.max(2, canvas.clientHeight || window.innerHeight)
    renderer.setPixelRatio(pixelRatio())
    renderer.setSize(W, Hh, false)
    camera.aspect = W / Hh
    camera.updateProjectionMatrix()
    if (composer) {
      composer.setPixelRatio(pixelRatio())
      composer.setSize(W, Hh)
      bloom?.resolution.set(W * (q === 'high' ? 1 : 0.5), Hh * (q === 'high' ? 1 : 0.5))
      applyFxaaRes()
    }
  }
  function setQuality(name) {
    if (!QUALITY[name]) name = 'medium'
    q = name
    renderer.shadowMap.enabled = QUALITY[q].shadows
    stadium.setQuality(q)
    blobMat.opacity = QUALITY[q].shadows ? 0.35 : 0.8
    renderer.setPixelRatio(pixelRatio())
    buildPost()
    resize()
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true })
  }

  // ---------- cars ----------
  const rigs = new Map() // id -> { rig, plate, blob, boostTrail, superTrails, seen, body, team, name }
  let nowT = 0
  function plateFor(e, car) {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const g = c.getContext('2d')
    g.font = '800 30px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const name = String(car.name ?? '').slice(0, 16)
    const w = Math.min(244, g.measureText(name).width + 40)
    g.fillStyle = 'rgba(6,10,18,0.72)'
    g.beginPath()
    g.roundRect(128 - w / 2, 8, w, 48, 14)
    g.fill()
    g.fillStyle = TEAM_CSS[car.team ? 1 : 0]
    g.fillRect(128 - w / 2 + 8, 52, w - 16, 3)
    g.fillStyle = '#fff'
    g.fillText(name, 128, 31)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    const m = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })
    const s = new THREE.Sprite(m)
    s.renderOrder = 999
    s.scale.set(0.16, 0.04, 1)
    s.center.set(0.5, 0)
    s.material.sizeAttenuation = false
    scene.add(s)
    e.plate = s
  }
  function makeEntry(car) {
    const e = { rig: kit.build(car.body, car.team ? 1 : 0), body: car.body, team: car.team ? 1 : 0, name: car.name, plate: null, seen: 0 }
    e.rig.model.rotation.y = MODEL_YAW
    scene.add(e.rig.root)
    e.blob = new THREE.Mesh(blobGeo, blobMat)
    scene.add(e.blob)
    e.boostTrail = new Trail(22, e.team ? 0xffa040 : 0x50a0ff)
    e.sTrailL = new Trail(18, 0xcff0ff)
    e.sTrailR = new Trail(18, 0xcff0ff)
    e.trailW = 0
    e.superW = 0
    scene.add(e.boostTrail.mesh, e.sTrailL.mesh, e.sTrailR.mesh)
    plateFor(e, car)
    return e
  }
  function freeEntry(e) {
    scene.remove(e.rig.root, e.blob, e.boostTrail.mesh, e.sTrailL.mesh, e.sTrailR.mesh, e.plate)
    e.boostTrail.dispose(); e.sTrailL.dispose(); e.sTrailR.dispose()
    e.plate.material.map.dispose(); e.plate.material.dispose()
  }

  // ---------- camera ----------
  const cam = {
    mode: 'ball', fovBase: 75, dist: 1, height: 1, stiff: 1,
    pos: new THREE.Vector3(0, 20, 60), look: new THREE.Vector3(), yaw: 0, init: false, fov: 75,
    blend: 0,
  }
  let lastGoalSign = 1
  let excite = 0
  let lastState = null

  function setCamera(pos, look, dt, k) {
    if (!cam.init) { cam.pos.copy(pos); cam.look.copy(look); cam.init = true }
    const a = damp(k, dt)
    cam.pos.lerp(pos, a)
    cam.look.lerp(look, damp(k * 1.3, dt))
  }
  function clampCam(v) {
    const lim = Math.abs(v.x) < D.gw ? D.hl + D.gd - 1.5 : D.hl - 1.5
    v.x = THREE.MathUtils.clamp(v.x, -(D.hw - 1.5), D.hw - 1.5)
    v.z = THREE.MathUtils.clamp(v.z, -lim, lim)
    v.y = THREE.MathUtils.clamp(v.y, 0.8, D.H - 1)
  }

  function updateCamera(state, myId, dt, me) {
    let k = 9 * cam.stiff
    let fov = cam.fovBase
    if (cam.override) {
      _v.fromArray(cam.override[0]); _look.fromArray(cam.override[1])
      cam.pos.copy(_v); cam.look.copy(_look); cam.init = true
      fov = cam.override[2] ?? 50
    } else if (!state) {
      // showcase: orbit the stadium with the turntable car in the middle
      const t = nowT * 0.12
      const r = 14 + Math.sin(nowT * 0.17) * 3
      _v.set(Math.cos(t) * r, 3.5 + Math.sin(nowT * 0.23) * 1.6, Math.sin(t) * r)
      _look.set(0, 1.3, 0)
      setCamera(_v, _look, dt, 4)
      fov = 42
    } else if (state.phase === 'goal') {
      const g = lastGoalSign
      const t = nowT * 0.5
      const R = D.hl * 0.45
      _v.set(Math.sin(t) * R * 0.9, D.H * 0.35, g * (D.hl - R * 0.5) - g * Math.cos(t) * R * 0.5)
      _look.set(0, D.gh * 0.4, g * (D.hl + D.gd * 0.3))
      setCamera(_v, _look, dt, 2.2)
      fov = 70
    } else if (me && !me.demolished) {
      const L = me.rigL || 3
      const dist = L * 2.6 * cam.dist
      const hgt = L * 0.8 * cam.height + 0.4
      const bp = state.ball.p
      _u.set(me.p[0], me.p[1], me.p[2])
      // forward from orientation
      _f.set(0, 0, 1).applyQuaternion(_q.set(me.q[0], me.q[1], me.q[2], me.q[3]))
      let hx = _f.x, hz = _f.z
      const hl = Math.hypot(hx, hz)
      if (hl < 0.3) { hx = Math.sin(cam.yaw); hz = Math.cos(cam.yaw) } else { hx /= hl; hz /= hl }
      const toBx = bp[0] - me.p[0], toBz = bp[2] - me.p[2]
      const bd = Math.hypot(toBx, toBz)
      const ballCam = cam.mode === 'ball' && bd > dist * 0.5
      if (ballCam) { hx = toBx / bd; hz = toBz / bd }
      const target = Math.atan2(hx, hz)
      let d = target - cam.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      cam.yaw = cam.init ? cam.yaw + d * damp(ballCam ? 7 : 10, dt) : target
      const sx = Math.sin(cam.yaw), sz = Math.cos(cam.yaw)
      _v.set(me.p[0] - sx * dist, me.p[1] + hgt, me.p[2] - sz * dist)
      if (ballCam) {
        // aim between car and ball, favouring the ball
        _look.set(bp[0] * 0.75 + me.p[0] * 0.25, Math.max(bp[1], 1) * 0.75 + me.p[1] * 0.25 + 0.5, bp[2] * 0.75 + me.p[2] * 0.25)
      } else {
        _look.set(me.p[0] + sx * dist * 0.9, me.p[1] + hgt * 0.35, me.p[2] + sz * dist * 0.9)
      }
      clampCam(_v)
      const sp = Math.hypot(me.v[0], me.v[1], me.v[2])
      fov += Math.min(sp / (C.CAR_BOOST_MAX_SPEED || 48), 1.2) * 7 + (me.boosting ? 3 : 0)
      setCamera(_v, _look, dt, k)
    } else {
      // spectate / dead: orbit the ball
      const bp = state.ball.p
      const t = nowT * 0.18
      const R = D.hw * 0.9
      _v.set(bp[0] + Math.cos(t) * R, Math.min(D.H * 0.4, 14) + bp[1] * 0.3, bp[2] + Math.sin(t) * R)
      _look.set(bp[0], bp[1], bp[2])
      clampCam(_v)
      setCamera(_v, _look, dt, 2)
      fov = 70
    }
    cam.fov += (fov - cam.fov) * damp(4, dt)
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix() }
    camera.position.copy(cam.pos)
    fx.shakeOffset(_shake)
    camera.position.x += _shake.x * 0.8
    camera.position.y += _shake.y * 0.8
    camera.lookAt(cam.look)
    camera.rotateZ(_shake.z * 0.04)
  }

  // ---------- main ----------
  const exhaust = new THREE.Vector3()
  const kickoffTurn = { car: 0, t: 0 }
  let showcaseRig = null
  let showcaseKey = ''
  const keys = carKeys()

  function showcase(dt) {
    // menu turntable: cycle bodies and team colour
    kickoffTurn.t += dt
    const idx = Math.floor(kickoffTurn.t / 5)
    const key = keys[idx % keys.length]
    const team = Math.floor(idx / keys.length) % 2
    const sk = key + team
    if (sk !== showcaseKey) {
      if (showcaseRig) scene.remove(showcaseRig.root)
      showcaseRig = kit.build(key, team)
      showcaseRig.model.rotation.y = MODEL_YAW
      scene.add(showcaseRig.root)
      showcaseKey = sk
    }
    const s = 1.5
    showcaseRig.root.scale.setScalar(s)
    showcaseRig.root.position.set(0, (showcaseRig.H * s) / 2 + 0.01, 0)
    showcaseRig.root.rotation.y = kickoffTurn.t * 0.35
    for (const w of showcaseRig.wheels) w.spin.rotation.x += dt * 1.5
  }

  const dummyPads = null
  function render(state, dtIn, myId) {
    const dt = Math.min(Math.max(dtIn || 0.016, 0.0001), 0.1)
    nowT += dt
    lastState = state
    if (showcaseRig) showcaseRig.root.visible = !state
    if (!state) showcase(dt)

    let me = null
    if (state) {
      const cars = state.cars
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]
        let e = rigs.get(car.id)
        const t = car.team ? 1 : 0
        if (e && (e.body !== car.body || e.team !== t || e.name !== car.name)) { freeEntry(e); rigs.delete(car.id); e = null }
        if (!e) { e = makeEntry(car); rigs.set(car.id, e) }
        e.seen = nowT
        const rig = e.rig
        car.rigL = rig.L
        const alive = !(car.demolished > 0)
        rig.root.visible = alive
        e.blob.visible = alive
        e.plate.visible = alive && car.id !== myId
        if (car.id === myId) me = car
        if (!alive) {
          e.boostTrail.reset(); e.sTrailL.reset(); e.sTrailR.reset()
          continue
        }
        rig.root.position.set(car.p[0], car.p[1], car.p[2])
        rig.root.quaternion.set(car.q[0], car.q[1], car.q[2], car.q[3])
        _q.set(car.q[0], car.q[1], car.q[2], car.q[3])
        _f.set(0, 0, 1).applyQuaternion(_q)
        _u.set(0, 1, 0).applyQuaternion(_q)
        _r.set(1, 0, 0).applyQuaternion(_q)
        const fwdSpeed = car.v[0] * _f.x + car.v[1] * _f.y + car.v[2] * _f.z
        const yawRate = car.w[0] * _u.x + car.w[1] * _u.y + car.w[2] * _u.z
        animateCar(rig, dt, fwdSpeed, yawRate, car.onGround || car.onWall, car.boosting, nowT)
        // trails
        e.trailW += ((car.boosting ? 1 : 0) - e.trailW) * damp(14, dt)
        _w.set(0, -rig.H * 0.1, -rig.L * 0.5).applyQuaternion(_q).add(rig.root.position)
        e.boostTrail.push(_w.x, _w.y, _w.z, _r.x, _r.y, _r.z, rig.W * 0.22 * e.trailW)
        e.superW += ((car.supersonic ? 1 : 0) - e.superW) * damp(10, dt)
        for (const [tr, sx] of [[e.sTrailL, -1], [e.sTrailR, 1]]) {
          _w.set(sx * rig.W * 0.5, rig.H * 0.1, -rig.L * 0.4).applyQuaternion(_q).add(rig.root.position)
          tr.push(_w.x, _w.y, _w.z, _u.x, _u.y, _u.z, 0.18 * e.superW)
        }
        // blob shadow
        const h = Math.max(car.p[1] - rig.H * 0.5, 0)
        const bs = rig.L * 1.25 * (1 + h * 0.06)
        e.blob.position.set(car.p[0], 0.045, car.p[2])
        e.blob.scale.set(bs * 0.8, 1, bs)
        e.blob.rotation.y = Math.atan2(_f.x, _f.z)
        e.blob.visible = h < 12 && car.p[1] < D.H
        // nameplate above the car, constant screen size
        e.plate.position.set(car.p[0], car.p[1] + rig.H * 0.9 + 0.6, car.p[2])
        const dd = Math.hypot(car.p[0] - camera.position.x, car.p[1] - camera.position.y, car.p[2] - camera.position.z)
        e.plate.material.opacity = THREE.MathUtils.clamp((dd - 6) / 8, 0, 1)
        // boost smoke puffs and wheel dust
        if (car.boosting && Math.random() < 0.6) {
          _w.set(0, -rig.H * 0.1, -rig.L * 0.55).applyQuaternion(_q).add(rig.root.position)
          fx.sparks(_w.x, _w.y, _w.z, 1, 6, e.team ? 1.6 : 0.5, e.team ? 0.7 : 0.9, e.team ? 0.2 : 2, -_f.x * 2, -_f.y * 2, -_f.z * 2, 0.35)
        }
      }
      // cull cars that left
      for (const [id, e] of rigs) if (e.seen !== nowT) { freeEntry(e); rigs.delete(id) }
      if (rigs.size === 0) { /* nothing */ }
      // ball
      const b = state.ball
      ball.group.visible = true
      ball.group.position.set(b.p[0], b.p[1], b.p[2])
      ball.mesh.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3])
      const bsp = Math.hypot(b.v[0], b.v[1], b.v[2])
      ball.uniforms.uGlow.value = 0.8 + Math.min(bsp / 40, 1.5)
      const touch = state.lastTouch ? rigs.get(state.lastTouch) : null
      if (touch) { ball.uniforms.uSeam.value.setHex(TEAM_COLORS[touch.team]).multiplyScalar(1.2).lerp(_col.set(0.6, 0.9, 1), 0.35); ballTrail.color.setHex(TEAM_COLORS[touch.team]).lerp(_col.set(1, 1, 1), 0.25); ballRing.material.color.setHex(TEAM_COLORS[touch.team]).lerp(_col.set(1, 1, 1), 0.3).multiplyScalar(2) }
      // ribbon facing the camera
      _v.set(b.v[0], b.v[1], b.v[2])
      _w.copy(camera.position).sub(ball.group.position)
      _r.crossVectors(_v, _w).normalize()
      const tw = THREE.MathUtils.clamp((bsp - 22) / 30, 0, 1)
      ballTrail.push(b.p[0], b.p[1], b.p[2], _r.x, _r.y, _r.z, BALL_R * 0.85 * tw)
      // ground ring + blob
      const bh = Math.max(b.p[1] - BALL_R, 0)
      const rs = BALL_R * (1.1 + bh * 0.05)
      ballRing.position.set(b.p[0], 0.06, b.p[2])
      ballRing.scale.set(rs, 1, rs)
      ringMat.opacity = THREE.MathUtils.clamp(0.9 - bh * 0.02, 0.25, 0.9)
      ballBlob.position.set(b.p[0], 0.05, b.p[2])
      ballBlob.scale.set(rs * 2.2, 1, rs * 2.2)
      ballBlob.visible = ballRing.visible = true
    } else {
      for (const [id, e] of rigs) { freeEntry(e); rigs.delete(id) }
      ball.group.visible = false
      ballBlob.visible = ballRing.visible = false
      ballTrail.reset()
    }

    excite = Math.max(0, excite - dt / 8)
    let ex = excite
    if (state) {
      const bz = Math.abs(state.ball.p[2]) / D.hl
      ex = Math.max(ex, Math.max(0, bz - 0.6) * 0.8)
    }
    stadium.update(state, nowT, dt, ex)
    stadium.uniforms.uFlash.value = excite
    ball.halo.material.opacity = 0.5 + 0.3 * Math.sin(nowT * 3)
    updateCamera(state, myId, dt, me)
    fx.update(dt, camera, Hh)
    if (composer) composer.render(dt)
    else renderer.render(scene, camera)
  }
  const _col = new THREE.Color()

  function onEvent(ev) {
    if (!ev) return
    const st = lastState
    const find = (id) => st?.cars?.find((c) => c.id === id)
    switch (ev.type) {
      case 'goal': {
        const team = ev.team ? 1 : 0
        lastGoalSign = team === 0 ? 1 : -1
        const p = ev.p ?? [0, D.gh * 0.4, lastGoalSign * (D.hl + 2)]
        _col.setHex(TEAM_COLORS[team])
        fx.goal(p[0], Math.max(p[1], 2), p[2], team, _col.clone(), D.H, D.hw, D.hl)
        excite = 1
        break
      }
      case 'demo': {
        const p = ev.p ?? find(ev.victimId)?.p
        if (!p) break
        const v = find(ev.victimId)
        _col.setHex(TEAM_COLORS[v?.team ? 1 : 0])
        fx.demo(p[0], p[1], p[2], _col.clone())
        fx.shake(0.45 / (1 + Math.hypot(p[0] - camera.position.x, p[2] - camera.position.z) / 25))
        break
      }
      case 'hit': {
        const p = ev.p
        if (!p) break
        const s = ev.strength ?? 0.3
        fx.sparks(p[0], p[1], p[2], 6 + Math.floor(s * 34), 7 + s * 16, 1.8, 1.4, 0.8, 0, 0.3, 0, 1)
        if (s > 0.6) fx.wave(false, p[0], Math.max(p[1] - 0.5, 0.1), p[2], 3 + s * 5, 0.35, _col.set(1, 0.9, 0.7), 0.6)
        const d = Math.hypot(p[0] - camera.position.x, p[1] - camera.position.y, p[2] - camera.position.z)
        fx.shake(s * 0.22 / (1 + d / 20))
        break
      }
      case 'boostPickup': {
        const p = BOOST_PADS[ev.pad]?.p
        if (!p) break
        _col.setRGB(1, 0.75, 0.25)
        fx.burst(p[0], 1.5, p[2], ev.big ? 80 : 24, ev.big ? 14 : 8, _col, 0.7, ev.big ? 1.1 : 0.7, 5)
        if (ev.big) fx.wave(false, p[0], 0.2, p[2], 7, 0.5, _col, 0.7)
        break
      }
      case 'land': {
        const c = find(ev.carId)
        if (!c) break
        const L = c.rigL || 3
        fx.smokePuff(c.p[0], Math.max(c.p[1] - 0.8, 0.1), c.p[2], 5, 3.5, L * 0.5, 0.45, 0.5, 0.58, 0.28, 0.9)
        break
      }
      case 'bump': {
        const c = find(ev.carId)
        if (c) fx.sparks(c.p[0], c.p[1], c.p[2], 8, 8, 1.6, 1.3, 0.7, 0, 0.3, 0, 1)
        break
      }
      default:
    }
  }

  function setCameraMode(m) { cam.mode = m === 'car' ? 'car' : 'ball' }
  function toggleBallCam() { cam.mode = cam.mode === 'ball' ? 'car' : 'ball'; return cam.mode === 'ball' }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null
  ro?.observe(canvas)
  setQuality(quality)

  return {
    render, onEvent, setCameraMode, toggleBallCam, setQuality, resize, camera,
    getCameraMode: () => cam.mode,
    _debug: { renderer, scene, stadium, fx },
    /** { fov (vertical deg), distance (x), height (x), stiffness (x) } — all optional */
    /** pin the camera ([x,y,z],[lookx,y,z],fov) — null releases it (replays, screenshots) */
    setCameraOverride(pos, look, fov) { cam.override = pos ? [pos, look, fov] : null },
    setCameraSettings(s = {}) {
      if (s.fov != null) cam.fovBase = s.fov
      if (s.distance != null) cam.dist = s.distance
      if (s.height != null) cam.height = s.height
      if (s.stiffness != null) cam.stiff = s.stiffness
    },
    dispose() {
      ro?.disconnect()
      for (const [, e] of rigs) freeEntry(e)
      rigs.clear()
      kit.dispose(); stadium.dispose(); fx.dispose(); ball.dispose(); ballTrail.dispose()
      blobGeo.dispose(); blobMat.dispose(); blobTex.dispose(); env.dispose?.()
      composer?.dispose?.()
      renderer.dispose()
    },
  }
}
