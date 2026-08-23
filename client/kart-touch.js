import * as C from '../shared/constants.js'
import { setExtraBits } from './input.js'

/**
 * Whether this is a machine driven with thumbs. A trackpad reports no touch
 * points and a touchscreen laptop reports a fine pointer, so both halves have to
 * agree before the keyboard HUD is replaced with pads.
 */
export function isTouch() {
  return navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches
}

// The wheel has three bands, because two is what made it unholdable: any drag
// at all meant full lock, so the kart was either dead straight or scything, and
// a thumb resting a few pixels off centre was steering the whole time.
//
// Straight until the thumb has moved this far. A held thumb wanders more than a
// dozen pixels on its own, which is what a 12px neutral band could not tell from
// a deliberate turn.
const STEER_DEADZONE = 22
// Past this, all of it. Between the two, the soft wheel — part lock, which is
// the band a corner is actually held in.
const STEER_FULL = 58
// Where the nub stops travelling. A little past STEER_FULL so that hard over
// looks like the end of the arc rather than the middle of it.
const STEER_THROW = 72

const HELD = {
  'tc-drift': C.IN_DRIFT,
  'tc-brake': C.IN_BACK,
  'item-slot': C.IN_ITEM,
}

let bits = 0
// IN_FWD is not a button. A phone racer holds the throttle down the whole race,
// so holding it is the game's job and the thumbs are freed for the two things
// that need timing: the drift and the item.
let autoThrottle = false
let aimBehind = false
// Which pointer owns the steering. Module-level so releaseTouch can drop it.
let steerId = null
// Each pad's own "let go of the pointer you were holding", collected at bind
// time because the owner is a per-pad local.
const releasers = []
let warnedCapture = false

function push() {
  setExtraBits(bits | (autoThrottle ? C.IN_FWD : 0) | (aimBehind ? C.IN_AIM : 0))
}

/**
 * Whether the throttle should be held right now. Its own function because it is a
 * string compare against a sim phase, and written inline it was compared against
 * 'RACING' — a phase this sim does not have. That reads as a working feature and
 * a kart that will not move, with nothing in the console, so there is a test that
 * runs a real sim into the racing phase and asserts this returns true.
 */
export function autoThrottleWanted(race, me) {
  return (
    race.phase === 'RACE' &&
    !race.paused &&
    race.resumeIn === 0 &&
    // Seated out of this race is not the same as not having finished it: without
    // the null check the missing kart reads as a kart still going round.
    me != null &&
    me.finished === null
  )
}

/**
 * Whether the throttle is being held for the driver. Off outside a live race, so
 * a kart does not sit on the grid revving or drive itself through the results
 * card. Called from the frame loop, so it must stay cheap and idempotent.
 */
export function setAutoThrottle(on) {
  if (on === autoThrottle) return
  autoThrottle = on
  push()
}

/**
 * Drops the aim-behind latch. Its button is only on screen while there is an
 * item to throw, so a latch that outlived the throw would sit set with nothing
 * showing it — and the next item picked up would go out backwards unasked.
 */
export function clearAimBehind() {
  if (!aimBehind) return
  aimBehind = false
  document.getElementById('tc-aim')?.classList.remove('on')
  push()
}

/**
 * Everything down comes up: used when the race ends or the page is hidden. The
 * throttle goes with it — a hidden tab still sends its input on a timer, so a
 * phone that takes a call mid-race would otherwise hand the host a kart pinned
 * flat out. The next visible frame puts it back if the race is still on.
 *
 * The steering pointer is cleared here too, which is why it is not a closure
 * local: this function is called in exactly the cases where no pointerup ever
 * arrives, and a steer id left pinned to a dead pointer makes the zone refuse
 * every touch for the rest of the session.
 */
export function releaseTouch() {
  bits = 0
  aimBehind = false
  autoThrottle = false
  steerId = null
  for (const letGo of releasers) letGo()
  for (const el of document.querySelectorAll('.tc.down, .tc.on')) el.classList.remove('down', 'on')
  const nub = document.getElementById('tc-nub')
  if (nub) nub.style.transform = 'translate(-50%, -50%)'
  document.getElementById('tc-steer')?.classList.remove('down', 'soft', 'hard')
  push()
}

/**
 * Capture keeps a thumb that slides off a pad mid-corner counted as still down.
 * It throws for a pointer the element never saw, and a throw here would take the
 * rest of the press handler with it — the input matters more than the capture.
 */
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId)
  } catch (err) {
    // Not fatal — the press still counts — but the pad will now drop its input
    // if the thumb slides off it, which mid-corner reads as the game losing the
    // drift for no reason. Worth a line rather than nothing, and once rather
    // than sixty times a race.
    if (!warnedCapture) {
      warnedCapture = true
      console.warn(`kart: no pointer capture on ${el.id} for pointer ${pointerId}`, err)
    }
  }
}

/**
 * Binds one pad as a held button. Pointer capture is what makes a thumb that
 * slides off the pad mid-corner keep the input down: without it the pad gets a
 * pointerleave and the drift drops at the worst moment.
 */
function bindHeld(el, bit) {
  // One pad, one pointer, same as the steering zone: two thumbs on the same pad
  // meant the first one lifting cleared a bit the second was still holding down.
  let owner = null
  el.addEventListener('pointerdown', (e) => {
    if (owner !== null) return
    e.preventDefault()
    owner = e.pointerId
    capture(el, e.pointerId)
    el.classList.add('down')
    bits |= bit
    push()
  })
  const up = (e) => {
    if (e.pointerId !== owner) return
    e.preventDefault()
    owner = null
    el.classList.remove('down')
    bits &= ~bit
    push()
  }
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  // releaseTouch clears the bits without any pointer event reaching the pad, so
  // the owner has to let go too or the pad refuses every press after a blur.
  releasers.push(() => {
    owner = null
  })
}

function bindSteer(zone, nub) {
  let originX = 0

  zone.addEventListener('pointerdown', (e) => {
    // A second finger landing in the zone must not move the wheel the first one
    // is holding.
    if (steerId !== null) return
    e.preventDefault()
    steerId = e.pointerId
    originX = e.clientX
    capture(zone, e.pointerId)
    zone.classList.add('down')
    // The wheel appears where the thumb landed rather than in a fixed spot, so
    // it never asks the hand to move to it.
    nub.parentElement.style.left = `${e.clientX}px`
    nub.parentElement.style.top = `${e.clientY}px`
  })

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== steerId) return
    const dx = e.clientX - originX
    const clamped = Math.max(-STEER_THROW, Math.min(STEER_THROW, dx))
    nub.style.transform = `translate(calc(-50% + ${clamped}px), -50%)`
    const throw_ = Math.abs(dx)
    const dir = dx > 0 ? C.IN_RIGHT : C.IN_LEFT
    const next =
      throw_ <= STEER_DEADZONE ? 0 : throw_ < STEER_FULL ? dir | C.IN_SOFT : dir
    const now = (bits & ~(C.IN_LEFT | C.IN_RIGHT | C.IN_SOFT)) | next
    if (now === bits) return
    bits = now
    // The wheel says which band it is in, so the hand can feel the step rather
    // than discovering it in the corner.
    zone.classList.toggle('soft', (next & C.IN_SOFT) !== 0)
    zone.classList.toggle('hard', next !== 0 && (next & C.IN_SOFT) === 0)
    push()
  })

  const end = (e) => {
    if (e.pointerId !== steerId) return
    e.preventDefault()
    steerId = null
    zone.classList.remove('down', 'soft', 'hard')
    nub.style.transform = 'translate(-50%, -50%)'
    bits &= ~(C.IN_LEFT | C.IN_RIGHT | C.IN_SOFT)
    push()
  }
  zone.addEventListener('pointerup', end)
  zone.addEventListener('pointercancel', end)
}

/**
 * Turns the touch layer on. Safe to call on a desktop — it does nothing there,
 * which keeps the caller free of the branch.
 */
export function startTouch() {
  if (!isTouch()) return false
  document.documentElement.classList.add('touch')

  // Every pad that failed to bind, so the return value can mean "the controls
  // are live" rather than "this is a phone". Silently skipping a renamed element
  // would leave the camera moved in and the throttle handed over for a game with
  // no steering, and a clean console.
  const missing = []
  for (const [id, bit] of Object.entries(HELD)) {
    const el = document.getElementById(id)
    if (el) bindHeld(el, bit)
    else missing.push(`#${id}`)
  }

  const zone = document.getElementById('tc-steer')
  const nub = document.getElementById('tc-nub')
  if (zone && nub) bindSteer(zone, nub)
  else missing.push('#tc-steer/#tc-nub')

  // Aim behind latches rather than being held: one thumb cannot hold a modifier
  // and press the item button at the same time.
  const aim = document.getElementById('tc-aim')
  if (!aim) missing.push('#tc-aim')
  aim?.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    aimBehind = !aimBehind
    aim.classList.toggle('on', aimBehind)
    push()
  })

  // A thumb lifted outside the window, an incoming call, a tab switch: all of
  // them end the gesture without a pointerup on the pad.
  addEventListener('blur', releaseTouch)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseTouch()
  })
  // Double-tap zoom fires on the second tap of a fast item press, which zooms
  // the whole HUD mid-race. Nothing on this page wants a browser gesture.
  document.addEventListener('gesturestart', (e) => e.preventDefault())
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tc, #tc-steer')) e.preventDefault()
  })

  if (missing.length) {
    console.error(`kart: touch controls missing ${missing.join(', ')} — the phone HUD is not driveable`)
    return false
  }
  return true
}

/**
 * Full screen hides the browser's own chrome, which on a phone is a third of the
 * height. Has to run inside a tap, and is allowed to fail: an iPhone refuses it
 * outright and the game is still playable, only shorter.
 */
export function goFullscreen() {
  const el = document.documentElement
  if (document.fullscreenElement || !el.requestFullscreen) return
  el.requestFullscreen({ navigationUI: 'hide' })
    // The lock only takes once the document is actually fullscreen — fired
    // alongside the request it rejects on the very platform that supports it,
    // and the player is left bouncing off the "turn your phone" card.
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch((err) => {
      // Refusal is a platform decision, not a defect: an iPhone says no to both
      // and the game is still playable, only shorter. Said once, not swallowed.
      console.info('kart: no fullscreen or orientation lock', err?.name ?? err)
    })
}
