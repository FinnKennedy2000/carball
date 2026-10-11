import * as THREE from 'three'

/** A night-stadium environment map for PBR reflections (floodlights + sky gradient). */
export function makeEnvironment(renderer) {
  const s = new THREE.Scene()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 c = mix(vec3(.10,.09,.16), vec3(.01,.03,.12), smoothstep(-.1,.9,y)); c = mix(vec3(.02,.04,.05), c, smoothstep(-.6,.05,y)); gl_FragColor = vec4(c,1.); }',
  }))
  s.add(dome)
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.92).multiplyScalar(14) })
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), lamp)
    m.position.set(x * 30, 24, z * 30)
    m.lookAt(0, 0, 0)
    s.add(m)
  }
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(60, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.8, 1).multiplyScalar(4), side: THREE.DoubleSide }))
  strip.position.set(0, 40, 0)
  strip.rotation.x = Math.PI / 2
  s.add(strip)
  const pm = new THREE.PMREMGenerator(renderer)
  const rt = pm.fromScene(s, 0.03)
  pm.dispose()
  s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
  return rt.texture
}
