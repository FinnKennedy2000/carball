// Garage / menu turntable on its own canvas.
import * as THREE from 'three'
import { createCarKit, carKeys } from './cars.js'
import { makeEnvironment } from './env.js'
import { TEAM_COLORS, radialTex } from './util.js'

export function createCarPreview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const env = makeEnvironment(renderer)
  scene.environment = env
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  const kit = createCarKit()
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(4, 7, 5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 20 })
  const rimL = new THREE.DirectionalLight(0x6fa0ff, 2.2)
  rimL.position.set(-5, 3, -5)
  scene.add(key, rimL, new THREE.HemisphereLight(0x8aa0ff, 0x101820, 0.5))
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.25, metalness: 0.8 }))
  floor.receiveShadow = true
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 2.8, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }))
  ring.position.y = 0.01
  const glowTex = radialTex()
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
  glow.position.y = 0.02
  scene.add(floor, ring, glow)
  const turn = new THREE.Group()
  scene.add(turn)

  let bodyKey = carKeys()[0]
  let team = 0
  let rig = null
  let framing = 4
  function rebuild() {
    if (rig) turn.remove(rig.root)
    rig = kit.build(bodyKey, team)
    rig.root.position.y = rig.H * 0.5 + 0.02
    turn.add(rig.root)
    const c = new THREE.Color(TEAM_COLORS[team])
    ring.material.color.copy(c).multiplyScalar(2.5)
    glow.material.color.copy(c)
    framing = Math.max(rig.L, rig.W * 1.4) * 1.25
    camera.position.set(0, framing * 0.38 + rig.H * 0.4, framing * 1.75)
    camera.lookAt(0, rig.H * 0.4, 0)
  }
  rebuild()

  function resize() {
    const w = canvas.clientWidth || 300
    const h = canvas.clientHeight || 200
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
  ro?.observe(canvas)
  let raf = 0
  let last = performance.now()
  let spin = 0
  let dead = false
  const loop = (now) => {
    if (dead) return
    raf = requestAnimationFrame(loop)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    spin += dt * 0.6
    turn.rotation.y = spin
    for (const w of rig.wheels) w.spin.rotation.x += dt * 2
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(loop)

  return {
    setBody(k) { bodyKey = String(k); rebuild() },
    setTeam(t) { team = t ? 1 : 0; rebuild() },
    resize,
    /** render one frame at a given turntable angle (screenshots, hidden tabs) */
    renderNow(angle = spin) { turn.rotation.y = angle; renderer.render(scene, camera) },
    dispose() {
      dead = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      kit.dispose()
      env.dispose?.()
      glowTex.dispose()
      renderer.dispose()
    },
  }
}
