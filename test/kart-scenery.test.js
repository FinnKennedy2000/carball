// The scenery. Three.js runs happily in node as long as nothing asks for a
// canvas, and buildScenery never does — it makes geometry and materials and
// nothing else — so the properties that matter can be checked on every map here
// rather than by squinting at a screenshot.
//
// The one that matters most is the last test in this file: nothing may stand
// where a kart drives. Scenery that has drifted onto the road is not a cosmetic
// bug, it is a wall you cannot see coming.

import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import * as K from '../shared/kart.js'
import { buildScenery, SCENERY_COUNTS, rng } from '../client/kart-scenery.js'
import { themeFor } from '../client/kart-themes.js'

/** Run `body` with `key` loaded, and put the default track back afterwards. */
function onTrack(key, body) {
  try {
    K.setTrack(key)
    return body()
  } finally {
    K.setTrack(K.DEFAULT_TRACK)
  }
}

/** Everything the build placed, as numbers, for comparing two builds. */
function snapshot(group) {
  return group.children.map((child) => {
    if (child.isInstancedMesh) {
      return `${child.name}:${Array.from(child.instanceMatrix.array, (v) => v.toFixed(4)).join(',')}`
    }
    const pos = child.geometry.getAttribute('position').array
    return `${child.name}:${Array.from(pos, (v) => v.toFixed(4)).join(',')}`
  })
}

test('every track builds its scenery', () => {
  for (const key of K.TRACK_KEYS) {
    onTrack(key, () => {
      const group = buildScenery(key, themeFor(key))
      assert.ok(group.children.length > 0, `${key} built no scenery at all`)
    })
  }
})

test('every mesh and every material is named, so a theme can swap one', () => {
  for (const key of K.TRACK_KEYS) {
    onTrack(key, () => {
      buildScenery(key, themeFor(key)).traverse((o) => {
        if (!o.isMesh) return
        assert.ok(o.name, `${key}: a mesh with no name`)
        assert.ok(o.material.name, `${key}: ${o.name} has an unnamed material`)
      })
    })
  }
})

test('the same track builds the same world twice — the RNG is seeded', () => {
  for (const key of K.TRACK_KEYS) {
    onTrack(key, () => {
      const first = snapshot(buildScenery(key, themeFor(key)))
      const second = snapshot(buildScenery(key, themeFor(key)))
      assert.deepEqual(second, first, `${key} built two different worlds`)
    })
  }
})

test('different tracks stand their props in different places', () => {
  const seen = new Map()
  for (const key of K.TRACK_KEYS) {
    onTrack(key, () => {
      const group = buildScenery(key, themeFor(key))
      const first = group.children.find((c) => c.isInstancedMesh)
      const m = new THREE.Matrix4()
      first.getMatrixAt(0, m)
      const at = `${m.elements[12].toFixed(2)},${m.elements[14].toFixed(2)}`
      assert.ok(!seen.has(at), `${key} put its first prop where ${seen.get(at)} did`)
      seen.set(at, key)
    })
  }
})

test('the seed is the only thing driving the scatter', () => {
  const a = rng(7)
  const b = rng(7)
  const c = rng(8)
  const draw = (r) => [r(), r(), r()]
  assert.deepEqual(draw(b), draw(a))
  assert.notDeepEqual(draw(c), draw(rng(7)))
})

test('every theme stands up the props it says it does', () => {
  for (const key of K.TRACK_KEYS) {
    onTrack(key, () => {
      const got = {}
      for (const child of buildScenery(key, themeFor(key)).children) {
        if (child.isInstancedMesh) got[child.name] = child.count
      }
      assert.deepEqual(got, SCENERY_COUNTS[key], `${key} did not place what it declares`)
    })
  }
})

/**
 * Every corner of every prop, in world space. Instanced props are checked
 * instance by instance — the bounding box of fifty-four trees scattered round a
 * lap contains the whole road, so a box over the lot would prove nothing — and
 * the bands are checked vertex by vertex, which is the only way to catch one
 * edge of a strip having wandered inwards on a hairpin.
 */
function* points(group) {
  const v = new THREE.Vector3()
  const m = new THREE.Matrix4()
  for (const child of group.children) {
    if (child.isInstancedMesh) {
      child.geometry.computeBoundingBox()
      const box = child.geometry.boundingBox
      for (let k = 0; k < child.count; k++) {
        child.getMatrixAt(k, m)
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              yield { name: child.name, p: v.set(x, y, z).applyMatrix4(m).clone() }
            }
          }
        }
      }
      continue
    }
    const pos = child.geometry.getAttribute('position')
    for (let k = 0; k < pos.count; k++) {
      yield { name: child.name, p: v.fromBufferAttribute(pos, k).clone() }
    }
  }
}

test('nothing stands where a kart drives, on any map', () => {
  // A jumping kart rises JUMP_RISE = 6 x airtime above the road, which reaches
  // 9m on the circuit; anything spanning a gap has to be higher than that, and
  // not merely higher than a kart on the ground.
  const OVER_ROAD = 6
  const OVER_JUMP = 12
  for (const key of K.TRACK_KEYS) {
    onTrack(key, () => {
      const depth = themeFor(key).deckDepth
      for (const { name, p } of points(buildScenery(key, themeFor(key)))) {
        const near = K.project(p.x, p.z)
        const half = K.halfWidthAt(near.s)
        const road = K.heightAt(near.s)
        const clearance = K.jumpAt(near.s) === null ? OVER_ROAD : OVER_JUMP
        const beside = Math.abs(near.lateral) > half
        const under = p.y < road - depth
        const over = p.y > road + clearance
        assert.ok(
          beside || under || over,
          `${key}: ${name} reaches ${Math.abs(near.lateral).toFixed(1)}m off the centre line ` +
            `at y=${p.y.toFixed(1)} where the road is ${half.toFixed(1)}m wide at y=${road.toFixed(1)}`,
        )
      }
    })
  }
})
