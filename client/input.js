// Keyboard + gamepad (+ optional mouse) -> one analog Input per call.
//   { thr, steer, pitch, yaw, roll, jump, boost, handbrake }, axes in [-1, 1].
// The sim reads one input object and picks what applies (thr on the ground,
// pitch/yaw/roll in the air), so W maps into BOTH thr=+1 and pitch=-1 (nose down,
// like a stick) and A/D into BOTH steer and yaw. Handbrake+A/D is air roll: in
// that case A/D drives roll instead of yaw (the ground still sees steer+handbrake,
// i.e. a powerslide).

export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'boost', 'handbrake', 'rollLeft', 'rollRight']

export const DEFAULT_BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', boost: 'ShiftLeft', handbrake: 'KeyC', rollLeft: 'KeyQ', rollRight: 'KeyE',
}

// Always-on extras so arrows, right shift, ctrl and the mouse work without binding.
const ALT = {
  forward: ['ArrowUp'], back: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  jump: [], boost: ['ShiftRight', 'Mouse0'], handbrake: ['ControlLeft', 'ControlRight'],
  rollLeft: [], rollRight: [],
}

const STORAGE_KEY = 'carball.bindings'
const DEAD_ZONE = 0.12
const TRIGGER_DEAD = 0.05

export const NEUTRAL = Object.freeze({ thr: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false })

// ---------- pure mapping (unit-tested) ----------

/** held: Set of action names currently down. */
export function keyboardInput(held) {
  const h = (a) => (held.has(a) ? 1 : 0)
  const thr = h('forward') - h('back')
  const steer = h('right') - h('left')
  const handbrake = held.has('handbrake')
  const roll = h('rollRight') - h('rollLeft') + (handbrake ? steer : 0)
  return {
    thr,
    steer,
    pitch: -thr, // W = nose down
    yaw: handbrake ? 0 : steer,
    roll: Math.max(-1, Math.min(1, roll)),
    jump: held.has('jump'),
    boost: held.has('boost'),
    handbrake,
  }
}

/** Radial dead zone with the live range rescaled to 0..1, so there is no jump at the edge. */
export function deadZone(x, y, dz = DEAD_ZONE) {
  const m = Math.hypot(x, y)
  if (m <= dz) return [0, 0]
  const k = Math.min(1, (m - dz) / (1 - dz)) / m
  return [x * k, y * k]
}

/** pad: { axes:[], buttons:[{value,pressed}] } in standard mapping. */
export function gamepadInput(pad) {
  const b = (i) => pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5
  const trig = (i) => {
    const v = pad.buttons[i]?.value ?? 0
    return v < TRIGGER_DEAD ? 0 : v
  }
  const [sx, sy] = deadZone(pad.axes[0] ?? 0, pad.axes[1] ?? 0)
  const handbrake = b(2)
  const roll = (b(5) ? 1 : 0) - (b(4) ? 1 : 0) + (handbrake ? sx : 0)
  return {
    thr: trig(7) - trig(6),
    steer: sx,
    pitch: sy, // stick forward (y = -1) = nose down
    yaw: handbrake ? 0 : sx,
    roll: Math.max(-1, Math.min(1, roll)),
    jump: b(0),
    boost: b(1),
    handbrake,
  }
}

/** Per axis, whichever device is pushing harder wins; buttons OR together. */
export function mergeInput(a, b) {
  const big = (x, y) => (Math.abs(x) >= Math.abs(y) ? x : y)
  return {
    thr: big(a.thr, b.thr), steer: big(a.steer, b.steer), pitch: big(a.pitch, b.pitch),
    yaw: big(a.yaw, b.yaw), roll: big(a.roll, b.roll),
    jump: a.jump || b.jump, boost: a.boost || b.boost, handbrake: a.handbrake || b.handbrake,
  }
}

// ---------- bindings ----------

let bindings = { ...DEFAULT_BINDINGS }
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  if (saved && typeof saved === 'object') {
    for (const a of ACTIONS) if (typeof saved[a] === 'string') bindings[a] = saved[a]
  }
} catch {
  // no storage (private window, node): defaults it is
}

export const getBindings = () => ({ ...bindings })

/** Bind a KeyboardEvent.code to an action; whatever held that code swaps to the old one. */
export function setBinding(action, code) {
  if (!ACTIONS.includes(action) || typeof code !== 'string') return
  const other = ACTIONS.find((a) => a !== action && bindings[a] === code)
  if (other) bindings[other] = bindings[action]
  bindings[action] = code
  save()
}

export function resetBindings() {
  bindings = { ...DEFAULT_BINDINGS }
  save()
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // not persisted; still applies for this session
  }
}

function actionsFor(code) {
  return ACTIONS.filter((a) => bindings[a] === code || ALT[a].includes(code))
}

// ---------- live state ----------

const held = new Set() // actions
let enabled = true
let started = false

/** Whether a key belongs to a field rather than the car (typing a name, etc). */
export function isTyping(target) {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Off during menus: clears anything held so the car does not drive itself on return. */
export function setInputEnabled(on) {
  enabled = !!on
  if (!enabled) held.clear()
}

export function startInput() {
  if (started || typeof addEventListener === 'undefined') return
  started = true
  const press = (e, down) => {
    const acts = actionsFor(e.code)
    if (!acts.length || isTyping(e.target)) return
    if (!enabled) return
    e.preventDefault()
    for (const a of acts) down ? held.add(a) : held.delete(a)
  }
  addEventListener('keydown', (e) => press(e, true))
  addEventListener('keyup', (e) => press(e, false))
  addEventListener('mousedown', (e) => {
    if (enabled && e.target instanceof HTMLCanvasElement) for (const a of actionsFor(`Mouse${e.button}`)) held.add(a)
  })
  addEventListener('mouseup', (e) => {
    for (const a of actionsFor(`Mouse${e.button}`)) held.delete(a)
  })
  addEventListener('focusin', (e) => {
    if (isTyping(e.target)) held.clear()
  })
  // Keys released while unfocused would leave the car driving itself.
  addEventListener('blur', () => held.clear())
}

function firstPad() {
  try {
    for (const p of navigator.getGamepads?.() ?? []) if (p?.connected) return p
  } catch {
    // some embeds throw on getGamepads
  }
  return null
}

/** The current input, freshly built (gamepads must be polled). */
export function currentInput() {
  if (!enabled) return { ...NEUTRAL }
  const kb = keyboardInput(held)
  const pad = firstPad()
  return pad ? mergeInput(kb, gamepadInput(pad)) : kb
}
