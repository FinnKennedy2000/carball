// The ball: a truncated-icosahedron look done as a spherical Voronoi in the
// fragment shader (12 pentagon + 20 hexagon seeds), glowing seams, halo.
import * as THREE from 'three'
import { radialTex } from './util.js'

function seeds() {
  const t = (1 + Math.sqrt(5)) / 2
  const v = []
  for (const [a, b] of [[1, t], [-1, t], [1, -t], [-1, -t]]) v.push([0, a, b], [a, b, 0], [b, 0, a])
  const V = v.map((p) => new THREE.Vector3(...p).normalize())
  // icosahedron faces -> centres
  const faces = []
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
    const e = V[i].distanceTo(V[j]), f = V[j].distanceTo(V[k]), g = V[i].distanceTo(V[k])
    if (Math.abs(e - f) < 1e-3 && Math.abs(f - g) < 1e-3 && e < 1.1) faces.push(new THREE.Vector3().add(V[i]).add(V[j]).add(V[k]).normalize())
  }
  return [...V, ...faces]
}

export function createBall(radius) {
  const S = seeds() // 12 + 20
  const lit = S.map((s) => `vec3(${s.x.toFixed(5)},${s.y.toFixed(5)},${s.z.toFixed(5)})`).join(',')
  const uniforms = { uGlow: { value: 1 }, uSeam: { value: new THREE.Color(0.2, 0.85, 1) } }
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObj; uniform float uGlow; uniform vec3 uSeam;
      const vec3 SEEDS[${S.length}] = vec3[${S.length}](${lit});`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 bn = normalize(vObj); float d1=-2., d2=-2.; int i1=0;
      for(int i=0;i<${S.length};i++){ float d = dot(bn, SEEDS[i]); if(d>d1){ d2=d1; d1=d; i1=i; } else if(d>d2){ d2=d; } }
      float seam = 1. - smoothstep(0., 0.05, d1-d2);
      vec3 panel = i1 < 12 ? vec3(0.015,0.025,0.06) : vec3(0.82,0.88,0.96);
      diffuseColor.rgb = mix(panel, vec3(0.02), seam);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += uSeam * seam * uGlow * 2.6 + (i1<12 ? uSeam*0.06*uGlow : vec3(0.));`)
  }
  const geo = new THREE.SphereGeometry(radius, 48, 32)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  const haloTex = radialTex([[0, 'rgba(255,255,255,0.0)'], [0.55, 'rgba(255,255,255,0.0)'], [0.72, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], 128)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: new THREE.Color(0.2, 0.7, 1).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }))
  halo.scale.setScalar(radius * 3.6)
  group.add(halo)
  return {
    group, mesh, uniforms, halo,
    dispose() { geo.dispose(); mat.dispose(); haloTex.dispose(); halo.material.dispose() },
  }
}
