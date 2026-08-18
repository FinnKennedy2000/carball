// Kart: the racing game. A closed circuit, six karts, item boxes, three laps.
//
// Same contract as sim.js — pure and deterministic, fixed timestep, no
// Math.random and no Date — so the same seed and the same inputs give the same
// race. Randomness comes off state.seed, exactly as Rumble's does.
//
// It shares constants.js only for the input bits and the tick rate: a kart is a
// different vehicle from a football car and wants its own numbers.

import { DT, IN_FWD, IN_BACK, IN_LEFT, IN_RIGHT, IN_BOOST, IN_DRIFT, IN_ITEM } from './constants.js'

// Track ---------------------------------------------------------------------
// The circuit is a closed parametric curve sampled into a polyline. No asset
// files, and the renderer builds its ribbon from the same numbers the physics
// uses, so the road you see is the road you drive on.
// Sampled finely enough for the hairpin: at 200 nodes the tight corners came
// out as flat spots, which project() then reads as a straight.
export const TRACK_N = 280
export const TRACK_R = 150
export const HALF_WIDTH = 14 // the tarmac at its widest — see halfWidthAt
const NARROWING = 6 // how much of that width the narrows take away
export const KERB = 5 // grass past the tarmac before the wall
export const LAPS = 3
// A fall costs you this long sitting still, plus the metres you fell at.
export const RESPAWN_SECONDS = 2.5
// How far back up the road you are put down, so you are not dropped straight
// back over the edge you went off.
const RECOVER_BACK = 6

export const KART_R = 2.2
const ACCEL = 34
const REVERSE = 20
// Exported: the renderer scales its speed cues against flat out, and a second
// copy of the number would drift the first time this is tuned.
export const MAX_SPEED = 38
const BOOST_ACCEL = 46
const BOOST_MAX = 56
const DRAG = 0.45
const GRIP = 10
const GRIP_DRIFT = 3.2
const TURN_RATE = 2.5
const TURN_DRIFT = 1.5
const TURN_MIN = 0.4
const OFFROAD_MAX = 0.45 // fraction of top speed the grass allows
const OFFROAD_DRAG = 2.6
const WALL_BOUNCE = 0.3

const COUNTDOWN = 3
const FINISH_GRACE = 45 // seconds the race runs on after the winner is home

// Items ---------------------------------------------------------------------
const BOX_RESPAWN = 5
const BOX_ROWS = 14 // item boxes at this many points around the lap, 3 abreast
const BOOST_SECONDS = 1.6
const STAR_SECONDS = 6
const STAR_SPEED = 1.25
const SHRINK_SECONDS = 4
const SHRINK_SPEED = 0.55
const SPIN_SECONDS = 1.3
const SHELL_SPEED = 55
const SHELL_LIFE = 7
const SHELL_R = 1.2
const SHELL_TURN = 3.2 // rad/s a red shell can steer
const HAZARD_R = 1.6
const AI_ITEM_DELAY = 1.5

/**
 * The item table. The index travels in the state and the HUD looks it up, so
 * appending is safe and reordering is not.
 */
export const ITEMS = [
  { key: 'boost', name: 'Turbo', hint: 'a burst of speed' },
  { key: 'banana', name: 'Banana', hint: 'drops behind you' },
  { key: 'green', name: 'Green Shell', hint: 'fires straight ahead' },
  { key: 'red', name: 'Red Shell', hint: 'homes on the kart ahead' },
  { key: 'bolt', name: 'Bolt', hint: 'shrinks everyone else' },
  { key: 'star', name: 'Star', hint: 'untouchable, and quick' },
]
/**
 * Roll weights for the leader and for the tail of the field, interpolated by
 * where you actually are. This is the rubber band: the front gets things to
 * throw behind it, the back gets things that close a gap. Exported so the way-in
 * screen can draw the same numbers the roll uses rather than a copy of them.
 */
export const ROLL_FRONT = [1, 5, 4, 0.6, 0.15, 0.25]
export const ROLL_BACK = [4, 1, 1, 4, 2.5, 2]

export function trackPoint(t) {
  const a = t * Math.PI * 2
  // Three harmonics rather than two, and the 5th is what makes the corners
  // uneven: a couple of sweepers you can carry speed through, a hairpin you
  // cannot, and a kink between them that punishes a lazy line.
  const r =
    TRACK_R * (1 + 0.2 * Math.sin(3 * a) - 0.13 * Math.cos(2 * a) + 0.07 * Math.sin(5 * a + 1.1))
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.66 }
}

/** Where `s` falls in the lap, as a fraction in [0, 1). */
function lapFraction(s) {
  const L = TRACK.length
  return (((s % L) + L) % L) / L
}

/**
 * The tarmac's half-width at a distance around the lap. Width is part of the
 * corner rather than a constant the corners sit in: two sections pinch to a
 * little over three kart-widths, and the line through them is the whole job.
 * Widest across the start line, so a six-kart grid still fits.
 */
export function halfWidthAt(s) {
  return HALF_WIDTH - NARROWING * (0.5 - 0.5 * Math.cos(lapFraction(s) * Math.PI * 4))
}

/**
 * The stretches with nothing beside the road, as fractions of the lap. Run wide
 * here and there is no kerb and no barrier to catch you — only the drop.
 * Exported because the renderer has to leave the same gaps in its scenery.
 */
export const VOIDS = [
  [0.17, 0.23],
  [0.54, 0.6],
  [0.79, 0.84],
]

export function overVoid(s) {
  const t = lapFraction(s)
  return VOIDS.some(([from, to]) => t >= from && t <= to)
}

/** The polyline, with cumulative arc length. Built once and never mutated. */
export function buildTrack() {
  const pts = []
  for (let i = 0; i < TRACK_N; i++) pts.push(trackPoint(i / TRACK_N))
  const cum = [0]
  for (let i = 0; i < TRACK_N; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % TRACK_N]
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  return { pts, cum, length: cum[TRACK_N] }
}

export const TRACK = buildTrack()

/** Centre line, tangent and normal at a distance `s` around the lap. */
export function pointAt(s) {
  const L = TRACK.length
  let d = s % L
  if (d < 0) d += L
  // ponytail: linear scan over 200 nodes, called a handful of times a tick.
  // Binary search if the field ever grows by an order of magnitude.
  let i = 0
  while (i < TRACK_N - 1 && TRACK.cum[i + 1] <= d) i++
  const a = TRACK.pts[i]
  const b = TRACK.pts[(i + 1) % TRACK_N]
  const segLen = TRACK.cum[i + 1] - TRACK.cum[i]
  const t = segLen > 0 ? (d - TRACK.cum[i]) / segLen : 0
  const tx = (b.x - a.x) / (segLen || 1)
  const ty = (b.y - a.y) / (segLen || 1)
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    tx,
    ty,
    nx: -ty,
    ny: tx,
  }
}

/**
 * Where a point sits on the circuit: distance around the lap, and how far off
 * the centre line it is (signed, positive to the left of travel).
 */
export function project(x, y) {
  let best = null
  for (let i = 0; i < TRACK_N; i++) {
    const a = TRACK.pts[i]
    const b = TRACK.pts[(i + 1) % TRACK_N]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const segLen2 = ex * ex + ey * ey
    let t = ((x - a.x) * ex + (y - a.y) * ey) / segLen2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = a.x + ex * t
    const py = a.y + ey * t
    const d2 = (x - px) * (x - px) + (y - py) * (y - py)
    if (best === null || d2 < best.d2) {
      const len = Math.sqrt(segLen2) || 1
      const tx = ex / len
      const ty = ey / len
      best = {
        d2,
        s: TRACK.cum[i] + len * t,
        // Left of the direction of travel is positive.
        lateral: (x - px) * -ty + (y - py) * tx,
        tx,
        ty,
      }
    }
  }
  return best
}

// Race ----------------------------------------------------------------------

function rand(state) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
  return state.seed / 2 ** 32
}

/**
 * Where the item boxes stand: three abreast at BOX_ROWS points around the lap.
 * Exported because the renderer builds its meshes from the same list.
 */
export function boxSpots() {
  const out = []
  for (let i = 0; i < BOX_ROWS; i++) {
    const s = (i + 0.5) * (TRACK.length / BOX_ROWS)
    for (const lane of [-6, 0, 6]) {
      const p = pointAt(s)
      out.push({ x: p.x + p.nx * lane, y: p.y + p.ny * lane })
    }
  }
  return out
}

/**
 * A race, empty or with a field already in it. `racers` is [{ id, name, ai }].
 * It starts in WAITING: in a room the karts sit on the grid until the host says
 * go, and the solo page simply calls begin() on the spot.
 */
export function createRace(racers = [], seed = 1) {
  const state = {
    tick: 0,
    time: 0,
    seed: seed >>> 0,
    phase: 'WAITING',
    timer: 0,
    laps: LAPS,
    karts: [],
    boxes: [],
    hazards: [], // dropped bananas
    shells: [],
    finishers: [], // ids in the order they crossed
  }
  for (const spot of boxSpots()) state.boxes.push({ x: spot.x, y: spot.y, cooldown: 0 })
  for (const racer of racers) addKart(state, racer)
  return state
}

/**
 * Seat one more kart, on the next grid slot. A kart added after the lights go
 * out starts on the grid too, which is to say a long way last — a room is meant
 * to fill up before the host starts it.
 */
export function addKart(state, racer) {
  const i = state.karts.length
  const row = Math.floor(i / 2)
  const side = i % 2 === 0 ? -1 : 1
  const s = -8 - row * 9
  const p = pointAt(s)
  const kart = {
    id: racer.id,
    name: racer.name,
    ai: Boolean(racer.ai),
    x: p.x + p.nx * side * 4.5,
    y: p.y + p.ny * side * 4.5,
    vx: 0,
    vy: 0,
    heading: Math.atan2(p.ty, p.tx),
    item: null,
    itemDown: false,
    boost: 0,
    star: 0,
    shrink: 0,
    spin: 0,
    lap: 0,
    s: (s + TRACK.length) % TRACK.length,
    prog: s, // total distance covered, the thing places are ranked on
    place: state.karts.length + 1,
    finished: null, // race time when it crossed, or null
    // Off the edge: seconds until it is put back, and where it is put back to.
    respawn: 0,
    recoverAt: 0,
    // AI only: how long it has held its item, and its line's offset.
    aiHold: 0,
    offset: 0,
  }
  // Drawn from the race's own PRNG, so a field is not six karts on one rail.
  if (kart.ai) kart.offset = (rand(state) - 0.5) * (HALF_WIDTH - 4)
  state.karts.push(kart)
  return kart
}

export function removeKart(state, id) {
  const i = state.karts.findIndex((k) => k.id === id)
  if (i !== -1) state.karts.splice(i, 1)
}

/** Leave WAITING and run the lights. The host's call in a room. */
export function begin(state) {
  if (state.phase !== 'WAITING') return
  state.phase = 'COUNT'
  state.timer = COUNTDOWN
}

/** Advance one tick. `inputs` maps kart id -> input bitmask. */
export function step(state, inputs) {
  const dt = DT
  state.tick++

  if (state.phase === 'OVER' || state.phase === 'WAITING') return state

  if (state.phase === 'COUNT') {
    state.timer -= dt
    if (state.timer <= 0) {
      state.phase = 'RACE'
      state.timer = 0
    }
    return state
  }

  state.time += dt
  // The race ends a little after the player is home, so the placings settle
  // without anyone watching the AI finish in real time.
  if (state.timer > 0) {
    state.timer -= dt
    if (state.timer <= 0) {
      state.phase = 'OVER'
      return state
    }
  }

  for (const kart of state.karts) {
    const bits = kart.ai ? aiBits(state, kart, dt) : inputs[kart.id] | 0
    useItem(state, kart, bits)
    stepKart(state, kart, bits, dt)
  }

  stepShells(state, dt)
  for (const kart of state.karts) {
    collectBox(state, kart)
    hitHazards(state, kart)
  }
  for (let i = 0; i < state.karts.length; i++) {
    for (let j = i + 1; j < state.karts.length; j++) bump(state.karts[i], state.karts[j])
  }
  for (const kart of state.karts) trackProgress(state, kart)
  rank(state)
  for (const box of state.boxes) if (box.cooldown > 0) box.cooldown = Math.max(0, box.cooldown - dt)
  return state
}

function stepKart(state, kart, bits, dt) {
  // Being fished out. Nothing it does counts, nothing reaches it, and its other
  // timers are held rather than burnt off while it waits.
  if (kart.respawn > 0) {
    kart.respawn = Math.max(0, kart.respawn - dt)
    kart.vx = 0
    kart.vy = 0
    if (kart.respawn === 0) {
      const p = pointAt(kart.recoverAt)
      kart.x = p.x
      kart.y = p.y
      kart.heading = Math.atan2(p.ty, p.tx)
    }
    return
  }

  // Home already: it drives itself off the throttle so it does not park on the
  // line, and nothing it does counts any more.
  if (kart.finished !== null) bits = IN_FWD

  const spinning = kart.spin > 0
  if (spinning) kart.spin = Math.max(0, kart.spin - dt)
  if (kart.boost > 0) kart.boost = Math.max(0, kart.boost - dt)
  if (kart.star > 0) kart.star = Math.max(0, kart.star - dt)
  if (kart.shrink > 0) kart.shrink = Math.max(0, kart.shrink - dt)

  const drifting = (bits & IN_DRIFT) !== 0 && !spinning
  const speed = Math.hypot(kart.vx, kart.vy)
  const turnScale =
    (TURN_MIN + (1 - TURN_MIN) * Math.min(1, speed / (MAX_SPEED * 0.3))) * (drifting ? TURN_DRIFT : 1)

  if (spinning) {
    // A spin-out: the kart pirouettes, the throttle does nothing, and the speed
    // bleeds away. Everything else this tick still applies.
    kart.heading = wrap(kart.heading + 9 * dt)
  } else {
    let steer = 0
    if (bits & IN_LEFT) steer -= 1
    if (bits & IN_RIGHT) steer += 1
    kart.heading = wrap(kart.heading + steer * TURN_RATE * turnScale * dt)
  }

  const fx = Math.cos(kart.heading)
  const fy = Math.sin(kart.heading)

  const boosting = kart.boost > 0 || ((bits & IN_BOOST) !== 0 && kart.star > 0)
  let accel = 0
  if (!spinning) {
    if (bits & IN_FWD) accel += ACCEL
    if (bits & IN_BACK) accel -= REVERSE
    if (boosting) accel += BOOST_ACCEL
  }
  kart.vx += fx * accel * dt
  kart.vy += fy * accel * dt

  const hit = project(kart.x, kart.y)
  const offroad = Math.abs(hit.lateral) > halfWidthAt(hit.s)
  const fwd = kart.vx * fx + kart.vy * fy
  const lat = kart.vx * -fy + kart.vy * fx
  const drag = spinning ? 3.5 : offroad ? OFFROAD_DRAG : DRAG
  const newFwd = fwd * damp(drag, dt)
  const newLat = lat * damp(drifting ? GRIP_DRIFT : GRIP, dt)
  kart.vx = fx * newFwd - fy * newLat
  kart.vy = fy * newFwd + fx * newLat

  let max = boosting ? BOOST_MAX : MAX_SPEED
  if (kart.star > 0) max *= STAR_SPEED
  if (kart.shrink > 0) max *= SHRINK_SPEED
  if (offroad) max *= OFFROAD_MAX
  clampSpeed(kart, max)

  kart.x += kart.vx * dt
  kart.y += kart.vy * dt
  confine(kart)
}

/**
 * The edge of the world. Over most of the lap that is a barrier past the grass
 * and nothing leaves the circuit; over a void section there is no grass and no
 * barrier, and going past the tarmac is a fall.
 */
function confine(kart) {
  const hit = project(kart.x, kart.y)
  const half = halfWidthAt(hit.s)
  if (overVoid(hit.s)) {
    if (Math.abs(hit.lateral) > half) fall(kart, hit.s)
    return
  }
  const limit = half + KERB - KART_R
  if (Math.abs(hit.lateral) <= limit) return
  const side = hit.lateral > 0 ? 1 : -1
  const nx = -hit.ty
  const ny = hit.tx
  // Put it back on the barrier and keep only the speed running along it.
  const push = Math.abs(hit.lateral) - limit
  kart.x -= nx * side * push
  kart.y -= ny * side * push
  const into = kart.vx * nx * side + kart.vy * ny * side
  if (into > 0) {
    kart.vx -= (1 + WALL_BOUNCE) * into * nx * side
    kart.vy -= (1 + WALL_BOUNCE) * into * ny * side
  }
}

/** Lap and total progress. A lap turns over when `s` wraps past the line. */
function trackProgress(state, kart) {
  const L = TRACK.length
  const hit = project(kart.x, kart.y)
  const prev = kart.s
  kart.s = hit.s
  let delta = hit.s - prev
  // A jump of more than half the lap is the line, not a teleport.
  if (delta > L / 2) delta -= L
  else if (delta < -L / 2) delta += L
  kart.prog += delta
  kart.lap = Math.max(0, Math.floor(kart.prog / L))

  if (kart.finished === null && kart.prog >= state.laps * L) {
    kart.finished = state.time
    state.finishers.push(kart.id)
    // The flag falls when there is nobody left worth waiting for: everyone home,
    // or every person home — an AI still out on the circuit is placed on how far
    // it got rather than watched in. Failing both, the first kart home starts a
    // long clock on the rest, which is also what ends a race nobody can finish.
    if (state.timer <= 0) state.timer = FINISH_GRACE
    const waitingOn = state.karts.some((k) => !k.ai && k.finished === null)
    if (!waitingOn || state.finishers.length === state.karts.length) state.phase = 'OVER'
  }
}

function rank(state) {
  const order = [...state.karts].sort((a, b) => {
    if (a.finished !== null || b.finished !== null) {
      if (a.finished === null) return 1
      if (b.finished === null) return -1
      return a.finished - b.finished
    }
    return b.prog - a.prog
  })
  order.forEach((k, i) => {
    k.place = i + 1
  })
}

// Items ---------------------------------------------------------------------

function collectBox(state, kart) {
  if (kart.respawn > 0) return
  for (const box of state.boxes) {
    // A full hand drives straight through: a box you cannot use is a box you
    // have not taken, as in the game this is a clone of.
    if (box.cooldown > 0 || kart.item !== null) continue
    if (Math.hypot(box.x - kart.x, box.y - kart.y) > KART_R + 1.8) continue
    box.cooldown = BOX_RESPAWN
    kart.item = roll(state, kart)
  }
}

/** Weighted by where you are running: see ROLL_FRONT and ROLL_BACK. */
function roll(state, kart) {
  const frac = state.karts.length > 1 ? (kart.place - 1) / (state.karts.length - 1) : 0
  const weights = ROLL_FRONT.map((f, i) => f + (ROLL_BACK[i] - f) * frac)
  const total = weights.reduce((a, b) => a + b, 0)
  let pick = rand(state) * total
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i]
    if (pick <= 0) return i
  }
  return 0
}

function useItem(state, kart, bits) {
  const down = (bits & IN_ITEM) !== 0
  const fire =
    down && !kart.itemDown && kart.item !== null && kart.finished === null && kart.respawn === 0
  kart.itemDown = down
  if (!fire) return

  const item = ITEMS[kart.item].key
  kart.item = null
  const fx = Math.cos(kart.heading)
  const fy = Math.sin(kart.heading)

  if (item === 'boost') kart.boost = BOOST_SECONDS
  else if (item === 'star') kart.star = STAR_SECONDS
  else if (item === 'banana') {
    state.hazards.push({ x: kart.x - fx * (KART_R + 2), y: kart.y - fy * (KART_R + 2), owner: kart.id })
  } else if (item === 'green' || item === 'red') {
    state.shells.push({
      x: kart.x + fx * (KART_R + 1.5),
      y: kart.y + fy * (KART_R + 1.5),
      vx: fx * SHELL_SPEED,
      vy: fy * SHELL_SPEED,
      life: SHELL_LIFE,
      owner: kart.id,
      // A red shell chases whoever is one place ahead. Nobody ahead means it
      // simply runs on as a green one does.
      target: item === 'red' ? aheadOf(state, kart) : null,
      red: item === 'red',
    })
  } else if (item === 'bolt') {
    for (const other of state.karts) {
      if (other.id === kart.id || other.star > 0) continue
      other.shrink = SHRINK_SECONDS
      other.item = null
    }
  }
}

function aheadOf(state, kart) {
  let best = null
  for (const other of state.karts) {
    if (other.id === kart.id || other.prog <= kart.prog) continue
    if (best === null || other.prog < best.prog) best = other
  }
  return best ? best.id : null
}

function stepShells(state, dt) {
  for (const shell of state.shells) {
    shell.life -= dt
    if (shell.red && shell.target !== null) {
      const target = state.karts.find((k) => k.id === shell.target)
      if (target) {
        // Steer the velocity toward the target rather than snapping to it, so a
        // red shell can still be dodged with a late turn.
        const want = Math.atan2(target.y - shell.y, target.x - shell.x)
        const have = Math.atan2(shell.vy, shell.vx)
        const turn = clamp(wrap(want - have), -SHELL_TURN * dt, SHELL_TURN * dt)
        const a = have + turn
        shell.vx = Math.cos(a) * SHELL_SPEED
        shell.vy = Math.sin(a) * SHELL_SPEED
      }
    }
    shell.x += shell.vx * dt
    shell.y += shell.vy * dt

    // The barrier turns a shell rather than eating it — a green shell bouncing
    // back down the road is half the point of firing one.
    const hit = project(shell.x, shell.y)
    const limit = halfWidthAt(hit.s) + KERB
    if (Math.abs(hit.lateral) > limit && !overVoid(hit.s)) {
      const side = hit.lateral > 0 ? 1 : -1
      const nx = -hit.ty * side
      const ny = hit.tx * side
      const push = Math.abs(hit.lateral) - limit
      shell.x -= nx * push
      shell.y -= ny * push
      const into = shell.vx * nx + shell.vy * ny
      if (into > 0) {
        shell.vx -= 2 * into * nx
        shell.vy -= 2 * into * ny
      }
    }

    for (const kart of state.karts) {
      // Its own shell cannot hit it in the first moments, or firing one while
      // turning is a self-inflicted spin.
      if (kart.id === shell.owner && shell.life > SHELL_LIFE - 0.4) continue
      if (kart.respawn > 0) continue
      if (Math.hypot(kart.x - shell.x, kart.y - shell.y) > KART_R + SHELL_R) continue
      shell.life = 0
      spinOut(kart)
      break
    }
  }
  state.shells = state.shells.filter((s) => s.life > 0)
}

function hitHazards(state, kart) {
  if (kart.respawn > 0) return
  for (const hazard of state.hazards) {
    if (hazard.dead) continue
    if (Math.hypot(hazard.x - kart.x, hazard.y - kart.y) > KART_R + HAZARD_R) continue
    hazard.dead = true
    spinOut(kart)
  }
  state.hazards = state.hazards.filter((h) => !h.dead)
}

/**
 * Off the edge. The kart stops where it went over — the renderer drops it out of
 * sight from there — and is put back up the road once its time is served.
 */
function fall(kart, s) {
  if (kart.respawn > 0 || kart.finished !== null) return
  kart.respawn = RESPAWN_SECONDS
  kart.recoverAt = s - RECOVER_BACK
  kart.vx = 0
  kart.vy = 0
  kart.boost = 0
  kart.spin = 0
  // A star does not save you from a hole, and it does not survive the wait.
  kart.star = 0
}

function spinOut(kart) {
  if (kart.star > 0 || kart.finished !== null || kart.respawn > 0) return
  kart.spin = SPIN_SECONDS
  kart.boost = 0
  kart.vx *= 0.3
  kart.vy *= 0.3
}

/** Kart on kart: a shove, not a crash. Nobody is stopped by being leant on. */
function bump(a, b) {
  if (a.respawn > 0 || b.respawn > 0) return
  const dx = b.x - a.x
  const dy = b.y - a.y
  const r = KART_R * 2
  const d = Math.hypot(dx, dy)
  if (d >= r || d < 1e-6) return
  const nx = dx / d
  const ny = dy / d
  const push = (r - d) / 2
  a.x -= nx * push
  a.y -= ny * push
  b.x += nx * push
  b.y += ny * push
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn > 0) return
  const j = -1.4 * vn * 0.5
  a.vx -= j * nx
  a.vy -= j * ny
  b.vx += j * nx
  b.vy += j * ny
  // A star run through the field scatters it.
  if (a.star > 0) spinOut(b)
  if (b.star > 0) spinOut(a)
}

// AI ------------------------------------------------------------------------

/**
 * Follow the racing line: aim at a point up the road, offset onto this kart's
 * own line, and hold the throttle down. It fires whatever it picks up after a
 * moment, which is enough to make the field dangerous without making it smart.
 */
function aiBits(state, kart, dt) {
  let bits = IN_FWD
  const lookahead = 10 + Math.hypot(kart.vx, kart.vy) * 0.35
  const p = pointAt(kart.s + lookahead)
  const tx = p.x + p.nx * kart.offset
  const ty = p.y + p.ny * kart.offset
  const want = Math.atan2(ty - kart.y, tx - kart.x)
  const err = wrap(want - kart.heading)
  if (err > 0.05) bits |= IN_RIGHT
  else if (err < -0.05) bits |= IN_LEFT
  // Hard corner: let the back end come round rather than understeering wide.
  if (Math.abs(err) > 0.55) bits |= IN_DRIFT

  if (kart.item !== null) {
    kart.aiHold += dt
    if (kart.aiHold > AI_ITEM_DELAY) {
      bits |= IN_ITEM
      kart.aiHold = 0
    }
  } else {
    kart.aiHold = 0
    // Nothing in hand: drift toward the nearest box lane, so the field actually
    // picks items up instead of driving the same line past every one of them.
    kart.offset = kart.offset * 0.995
  }
  // A drop coming up: come back toward the middle. They still go over when they
  // are shoved, which is the point — it just is not their default line.
  if (overVoid(kart.s + 20) || overVoid(kart.s)) kart.offset *= 0.92
  // The bit has to fall on the next tick or the rising edge never comes.
  if (kart.itemDown) bits &= ~IN_ITEM
  return bits
}

// Helpers -------------------------------------------------------------------

function damp(rate, dt) {
  return Math.max(0, 1 - rate * dt)
}

function clampSpeed(body, max) {
  const s = Math.hypot(body.vx, body.vy)
  if (s > max) {
    body.vx *= max / s
    body.vy *= max / s
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function wrap(a) {
  const twoPi = Math.PI * 2
  a %= twoPi
  if (a > Math.PI) a -= twoPi
  else if (a < -Math.PI) a += twoPi
  return a
}

/** Structural hash, for the determinism test. */
export function hashRace(state) {
  const nums = [state.tick, state.phase.length, state.shells.length, state.hazards.length]
  for (const k of state.karts) {
    nums.push(k.x, k.y, k.vx, k.vy, k.heading, k.prog, k.place, k.item ?? -1, k.spin, k.boost, k.star, k.shrink, k.respawn)
  }
  let h = 2166136261
  for (const n of nums) {
    const s = String(Math.round(n * 1e6))
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return h >>> 0
}
