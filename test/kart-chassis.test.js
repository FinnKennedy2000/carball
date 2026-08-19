import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CHASSIS, STAT_LABELS, buildChassis, statList } from '../client/kart-chassis.js'
import { CHASSIS_STATS, KART_R, MAX_SPEED } from '../shared/kart.js'

test('every chassis builds a named group of named meshes', () => {
  for (const key of Object.keys(CHASSIS)) {
    const model = buildChassis(key)
    assert.ok(model.isGroup, `${key} is a group`)
    assert.ok(model.name, `${key} is named`)
    let meshes = 0
    model.traverse((part) => {
      if (!part.isMesh) return
      meshes += 1
      assert.ok(part.name, `${key}: every mesh is named`)
      assert.ok(part.material.name, `${key}: every material is named`)
    })
    assert.ok(meshes >= 6, `${key} has ${meshes} meshes`)
  }
})

test('every chassis sits on the ground plane, +x forward', () => {
  for (const key of Object.keys(CHASSIS)) {
    const box = new THREE.Box3().setFromObject(buildChassis(key))
    assert.ok(box.min.y > -0.01, `${key} does not sink: min.y ${box.min.y}`)
    assert.ok(box.min.y < 0.01, `${key} touches the ground: min.y ${box.min.y}`)
    const size = box.getSize(new THREE.Vector3())
    assert.ok(size.x > size.z, `${key} is longer than it is wide`)
  }
})

test('every chassis the sim races has a model, a caption and a lap', () => {
  assert.deepEqual(Object.keys(CHASSIS), Object.keys(CHASSIS_STATS))
  for (const [key, entry] of Object.entries(CHASSIS)) {
    assert.equal(statList(key).length, STAT_LABELS.length, `${key} has a stat per label`)
    assert.ok(
      statList(key).every((v) => typeof v === 'number'),
      `${key}: every stat is a number`
    )
    assert.ok(entry.name && entry.note && entry.blurb, `${key} is captioned`)
    assert.ok(entry.lap > 60 && entry.lap < 80, `${key} laps in ${entry.lap}s`)
  }
  // The baseline the renderer and the grid scale against is the Coupe's own row,
  // or the two drift apart the first time either is tuned.
  assert.equal(CHASSIS_STATS.coupe.top, MAX_SPEED)
  assert.equal(CHASSIS_STATS.coupe.radius, KART_R)
  assert.equal(CHASSIS_STATS.coupe.mass, 1)
})

test('an unknown chassis is an error, not an empty scene', () => {
  assert.throws(() => buildChassis('hovercraft'), /unknown chassis/)
})
