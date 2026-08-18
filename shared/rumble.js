// Rumble: every player is dealt a random item on a timer and fires it with one
// key. This module owns the item table, the roll, and every effect; sim.js calls
// stepRumble once a tick and otherwise knows nothing about any of it.
//
// DETERMINISM: sim.js is pure by contract — no Math.random, no Date — and this
// must not be the thing that breaks it. The randomness is injected instead: the
// host draws one seed when it opens the room, it travels in state.seed, and a
// roll advances it here. Same starting state plus same inputs, same items.

import * as C from './constants.js'

/**
 * The five items, in roll order. The index is what travels on the wire and what
 * the HUD looks up, so appending is safe and reordering is not.
 */
export const ITEMS = [
  { key: 'haymaker', name: 'Haymaker', hint: 'punches the ball' },
  { key: 'boot', name: 'Boot', hint: 'punts the nearest opponent' },
  { key: 'freeze', name: 'Freeze', hint: 'holds the ball in place' },
  { key: 'hook', name: 'Grappling Hook', hint: 'reels you to the ball' },
  { key: 'magnet', name: 'Magnetizer', hint: 'pulls the ball to you' },
  { key: 'disruptor', name: 'Disruptor', hint: 'jams an opponent wide open' },
  { key: 'swapper', name: 'Swapper', hint: 'trades places with an opponent' },
  { key: 'spike', name: 'Spike', hint: 'sticks the ball to your car' },
  { key: 'tornado', name: 'Tornado', hint: 'drags everything around you' },
]

/** Give a car the fields the mode needs. Called only in a Rumble match. */
export function initCarItems(car) {
  car.item = null
  car.itemTimer = C.ITEM_COOLDOWN
  // Whether the item key was held on the previous tick. The item fires on the
  // rising edge, so holding the key cannot also spend whatever arrives next.
  car.itemDown = false
  car.hook = 0
  car.magnet = 0
  car.disrupt = 0
  car.spike = 0
  car.tornado = 0
  // What just went off on this car, and for how much longer it is worth
  // drawing. Cosmetic — nothing in the physics reads either of them.
  car.fx = null
  car.fxTimer = 0
}

/**
 * One tick of the item mode, run before the cars and the ball are integrated so
 * an effect's acceleration lands in the same step as the engine's.
 * `inputs` maps car id -> input bitmask, exactly as step() receives it.
 */
export function stepRumble(state, inputs, dt) {
  if (state.ball.freeze > 0) {
    state.ball.freeze = Math.max(0, state.ball.freeze - dt)
    // Held, not slowed: the ball keeps no memory of the shot it was in.
    state.ball.vx = 0
    state.ball.vy = 0
  }

  // Cars are kept id-sorted by addCar, so rolls come off the seed in a fixed
  // order however the room filled up.
  for (const car of state.cars) {
    let bits = inputs[car.id] | 0

    // A jammed throttle, before anything reads the input: the car drives itself
    // flat out and the brake does nothing. Steering is left alone, so it is a
    // car you are fighting rather than a car you have lost.
    if (car.disrupt > 0) {
      car.disrupt = Math.max(0, car.disrupt - dt)
      bits = (bits | C.IN_FWD) & ~C.IN_BACK
      inputs[car.id] = bits
    }
    deal(state, car, dt)

    if (car.fxTimer > 0) {
      car.fxTimer = Math.max(0, car.fxTimer - dt)
      if (car.fxTimer === 0) car.fx = null
    }

    const down = (bits & C.IN_ITEM) !== 0
    if (down && !car.itemDown && car.item !== null) {
      fire(state, car, car.item)
      car.item = null
      car.itemTimer = C.ITEM_COOLDOWN
    }
    car.itemDown = down

    hold(state, car, dt)
  }
}

/**
 * The parts of the mode that have to run after the bodies have moved, because
 * they set velocity or position outright and stepCar's drag and grip would eat
 * either of them if this ran first.
 */
export function afterBodies(state) {
  for (const car of state.cars) {
    if (!(car.hook > 0)) continue
    const d = toward(car, state.ball)
    // A winch, not a nudge. An accelerating hook was feeble whenever the car
    // was not already pointed at the ball, because grip damps sideways motion
    // at GRIP per second — most of the pull was spent fighting the tyres.
    car.vx = d.nx * C.HOOK_SPEED
    car.vy = d.ny * C.HOOK_SPEED
  }
  carrySpikedBall(state)
}

/**
 * Carry a spiked ball, one radius clear of the car's nose rather than on top of
 * it: at that distance the two are touching without overlapping, so the
 * ordinary car/ball collision has nothing to resolve and does not fight this.
 */
function carrySpikedBall(state) {
  if (state.ball.stuckTo === null || state.ball.stuckTo === undefined) return

  const carrier = state.cars.find((c) => c.id === state.ball.stuckTo)
  // The carrier left the match still holding it.
  if (!carrier) {
    state.ball.stuckTo = null
    return
  }

  const reach = C.CAR_R + C.BALL_R
  state.ball.x = carrier.x + Math.cos(carrier.heading) * reach
  state.ball.y = carrier.y + Math.sin(carrier.heading) * reach
  // It leaves with whatever the car was doing, so letting go is a pass.
  state.ball.vx = carrier.vx
  state.ball.vy = carrier.vy
  state.ball.freeze = 0
}

/** Count down to the next item, but only while the slot is empty. */
function deal(state, car, dt) {
  if (car.item !== null) return
  car.itemTimer -= dt
  if (car.itemTimer > 0) return
  car.itemTimer = 0
  car.item = roll(state)
}

/**
 * The next item off the seed. A plain LCG: integer-only, so it cannot drift
 * between engines the way a float-based generator can.
 */
function roll(state) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
  // The high bits of an LCG are the well-behaved ones; the low ones cycle short.
  return Math.floor((state.seed >>> 16) / 65536 * ITEMS.length) % ITEMS.length
}

/** Mark a car as having just been on one end of an item. Drawn, never simulated. */
function mark(car, item) {
  car.fx = item
  car.fxTimer = C.FX_SECONDS
}

/** Spend an item. One-shot items act here; timed ones just start their clock. */
function fire(state, car, item) {
  // Marked whether or not it connects: spending an item you then fluffed should
  // still look like something happened.
  mark(car, item)

  switch (ITEMS[item].key) {
    case 'haymaker': {
      const d = toward(car, state.ball)
      if (d.dist <= C.ITEM_RANGE) {
        state.ball.vx += d.nx * C.HAYMAKER_IMPULSE
        state.ball.vy += d.ny * C.HAYMAKER_IMPULSE
        // A punch is a touch for the purposes of goal credit, and it frees a
        // ball someone else froze — you cannot punch something and have it hang.
        state.ball.lastTouch = car.id
        state.ball.freeze = 0
      }
      break
    }
    case 'boot': {
      const target = nearestOpponent(state, car)
      if (target) {
        const d = toward(car, target)
        target.vx += d.nx * C.BOOT_IMPULSE
        target.vy += d.ny * C.BOOT_IMPULSE
        // The victim too: a boot is most legible where it lands.
        mark(target, item)
      }
      break
    }
    case 'freeze':
      // Only worth spending on a ball in play; a frozen one is already held.
      state.ball.vx = 0
      state.ball.vy = 0
      state.ball.freeze = C.FREEZE_SECONDS
      break
    case 'hook':
      car.hook = C.HOOK_SECONDS
      break
    case 'magnet':
      car.magnet = C.MAGNET_SECONDS
      break
    case 'disruptor': {
      const target = nearestOpponent(state, car, C.ITEM_RANGE)
      if (target) {
        target.disrupt = C.DISRUPT_SECONDS
        mark(target, item)
      }
      break
    }
    case 'swapper': {
      // No range: reaching across the pitch is the whole trick. Positions only —
      // arriving with the other car's momentum as well would be unreadable.
      const target = nearestOpponent(state, car, Infinity)
      if (target) {
        const x = car.x
        const y = car.y
        car.x = target.x
        car.y = target.y
        target.x = x
        target.y = y
        mark(target, item)
      }
      break
    }
    case 'spike':
      // Arms the car; the ball welds itself on the next touch — see sim.js.
      car.spike = C.SPIKE_SECONDS
      break
    case 'tornado':
      car.tornado = C.TORNADO_SECONDS
      break
  }
}

/** The timed items, for as long as their clocks run. */
function hold(state, car, dt) {
  // Only the clock here; the pull itself is in afterBodies. No range limit:
  // the hook's whole point is closing a gap you could not.
  if (car.hook > 0) car.hook = Math.max(0, car.hook - dt)

  if (car.spike > 0) {
    car.spike = Math.max(0, car.spike - dt)
    // Time up: it lets go, keeping whatever the carry gave it.
    if (car.spike === 0 && state.ball.stuckTo === car.id) state.ball.stuckTo = null
  }

  if (car.tornado > 0) {
    car.tornado = Math.max(0, car.tornado - dt)
    // Everything loose nearby, the ball included — but not team-mates, who are
    // helping. A carried ball is held by its carrier and does not answer to this.
    const caught = state.cars.filter((c) => c.team !== car.team)
    if (state.ball.stuckTo === null || state.ball.stuckTo === undefined) caught.push(state.ball)
    for (const body of caught) {
      const d = toward(car, body)
      if (d.dist > C.TORNADO_RADIUS || d.dist === 0) continue
      // Fading with distance, so the edge of the vortex is a nudge and the
      // middle is not survivable.
      const bite = 1 - d.dist / C.TORNADO_RADIUS
      // Inward, plus a push at right angles to it: together they orbit.
      body.vx += (-d.nx * C.TORNADO_PULL + -d.ny * C.TORNADO_SPIN) * bite * dt
      body.vy += (-d.ny * C.TORNADO_PULL + d.nx * C.TORNADO_SPIN) * bite * dt
    }
  }

  if (car.magnet > 0) {
    car.magnet = Math.max(0, car.magnet - dt)
    const d = toward(car, state.ball)
    // Pulled the other way — toward the car — and only from inside its reach,
    // so a magnet cannot drag the ball the length of the pitch.
    if (d.dist <= C.MAGNET_RANGE && state.ball.freeze <= 0 && !state.ball.stuckTo) {
      state.ball.vx -= d.nx * C.MAGNET_ACCEL * dt
      state.ball.vy -= d.ny * C.MAGNET_ACCEL * dt
    }
  }
}

/** The nearest car on the other side within `range`, or null. */
function nearestOpponent(state, car, range = C.ITEM_RANGE) {
  let best = null
  let bestDist = range
  for (const other of state.cars) {
    if (other.team === car.team) continue // which also rules out the car itself
    const { dist } = toward(car, other)
    if (dist <= bestDist) {
      bestDist = dist
      best = other
    }
  }
  return best
}

/** Unit vector from `from` to `to`, plus the distance. Never divides by zero. */
function toward(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  // Coincident centres have no direction. Push along +x, deterministically.
  if (dist < 1e-6) return { nx: 1, ny: 0, dist: 0 }
  return { nx: dx / dist, ny: dy / dist, dist }
}
