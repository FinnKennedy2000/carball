import * as C from '../shared/constants.js'

const KEYS = {
  KeyW: C.IN_FWD,
  ArrowUp: C.IN_FWD,
  KeyS: C.IN_BACK,
  ArrowDown: C.IN_BACK,
  KeyA: C.IN_LEFT,
  ArrowLeft: C.IN_LEFT,
  KeyD: C.IN_RIGHT,
  ArrowRight: C.IN_RIGHT,
  Space: C.IN_BOOST,
  ShiftLeft: C.IN_DRIFT,
  ShiftRight: C.IN_DRIFT,
  // Rumble's one action. Bound in every mode: a normal match simply ignores it,
  // which is cheaper than rebinding the keyboard when the mode changes.
  KeyE: C.IN_ITEM,
  // Aim behind: hold it and the next shot goes out the back.
  KeyQ: C.IN_AIM,
}

let bits = 0
let notify = () => {}

/**
 * Called whenever the pressed keys change, so the send can go at once instead of
 * waiting up to a poll interval. The poll stays: it is what catches a key held
 * across a tab switch, which produces no event here at all.
 */
export function onInputChange(fn) {
  notify = fn ?? (() => {})
}

function setBits(next) {
  if (next === bits) return
  bits = next
  notify()
}

/**
 * Whether a key belongs to a field rather than to the car. The driving keys are
 * bound on the window and swallowed with preventDefault, which is exactly wrong
 * while someone is typing a name: W, A, S, D and space are letters first. Every
 * window-level key handler asks this before acting.
 */
export function isTyping(target) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function startInput() {
  addEventListener('keydown', (e) => {
    const bit = KEYS[e.code]
    if (bit === undefined || isTyping(e.target)) return
    e.preventDefault()
    setBits(bits | bit)
  })
  addEventListener('keyup', (e) => {
    const bit = KEYS[e.code]
    if (bit === undefined || isTyping(e.target)) return
    e.preventDefault()
    setBits(bits & ~bit)
  })
  // A field taking focus mid-drive must not leave a held key stuck down: the
  // keyup lands on the field and is ignored above.
  addEventListener('focusin', (e) => {
    if (isTyping(e.target)) setBits(0)
  })
  // Releasing keys while unfocused would otherwise leave the car driving itself.
  addEventListener('blur', () => {
    setBits(0)
  })
}

export function currentBits() {
  return bits
}
