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
}

let bits = 0

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
    bits |= bit
  })
  addEventListener('keyup', (e) => {
    const bit = KEYS[e.code]
    if (bit === undefined || isTyping(e.target)) return
    e.preventDefault()
    bits &= ~bit
  })
  // A field taking focus mid-drive must not leave a held key stuck down: the
  // keyup lands on the field and is ignored above.
  addEventListener('focusin', (e) => {
    if (isTyping(e.target)) bits = 0
  })
  // Releasing keys while unfocused would otherwise leave the car driving itself.
  addEventListener('blur', () => {
    bits = 0
  })
}

export function currentBits() {
  return bits
}
