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

export function startInput() {
  addEventListener('keydown', (e) => {
    const bit = KEYS[e.code]
    if (bit === undefined) return
    e.preventDefault()
    bits |= bit
  })
  addEventListener('keyup', (e) => {
    const bit = KEYS[e.code]
    if (bit === undefined) return
    e.preventDefault()
    bits &= ~bit
  })
  // Releasing keys while unfocused would otherwise leave the car driving itself.
  addEventListener('blur', () => {
    bits = 0
  })
}

export function currentBits() {
  return bits
}
