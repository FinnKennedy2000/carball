import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CHASSIS, STAT_LABELS, buildChassis } from '../client/kart-chassis.js'
import { KART_R, MAX_SPEED } from '../shared/kart.js'

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

test('the stat table is complete and the Coupe is the numbers we race on', () => {
  for (const [key, entry] of Object.entries(CHASSIS)) {
    assert.equal(entry.stats.length, STAT_LABELS.length, `${key} has a stat per label`)
    assert.ok(entry.name && entry.note, `${key} is captioned`)
  }
  const [, top, , , mass, radius] = CHASSIS.coupe.stats
  assert.equal(top, MAX_SPEED)
  assert.equal(radius, KART_R)
  assert.equal(mass, 1)
})

test('an unknown chassis is an error, not an empty scene', () => {
  assert.throws(() => buildChassis('hovercraft'), /unknown chassis/)
})
