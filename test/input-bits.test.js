import test from 'node:test'
import assert from 'node:assert/strict'
import * as C from '../shared/constants.js'
import { currentBits, setExtraBits, onInputChange } from '../client/input.js'

// The touch pads and the keyboard write to the same kart through two separate
// masks. These are the cases where folding them into one variable went wrong:
// a blur clearing the keys must not lift a thumb, and a thumb must not survive
// its own release.

test('touch input reaches the kart', () => {
  setExtraBits(C.IN_FWD | C.IN_LEFT)
  assert.equal(currentBits(), C.IN_FWD | C.IN_LEFT)
})

test('releasing a pad clears only that pad', () => {
  setExtraBits(C.IN_FWD | C.IN_DRIFT)
  setExtraBits(C.IN_FWD)
  assert.equal(currentBits(), C.IN_FWD)
})

test('nothing outside the input bits gets through', () => {
  setExtraBits(0xffff)
  assert.equal(currentBits(), C.IN_ALL)
  setExtraBits(0)
  assert.equal(currentBits(), 0)
})

test('a change fires the notify once, and an unchanged write does not', () => {
  setExtraBits(0)
  let calls = 0
  onInputChange(() => calls++)
  setExtraBits(C.IN_ITEM)
  setExtraBits(C.IN_ITEM)
  assert.equal(calls, 1, 'the send is edge-triggered, not per write')
  setExtraBits(0)
  assert.equal(calls, 2)
  onInputChange(null)
})
