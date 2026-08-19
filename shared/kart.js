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
// out as flat spots, which project() then reads as a straight. Node count is
// tied to the radius — the density is the thing that matters, not the count.
export const TRACK_N = 400
export const TRACK_R = 215
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
// How fast speed above the current cap is given up, per second.
const OVERSPEED_BLEED = 6

// Drift mini-turbo. Hold a drift with the wheel over and it charges; let go
// with a charge and you are paid in the same boost a Mushroom gives, which is
// the whole reason this is a small change.
// Exported: the renderer colours the sparks off these, and a second copy of the
// thresholds would disagree with these the first time they are tuned.
export const DRIFT_TIERS = [0.9, 1.9] // seconds held for tier one and tier two
const DRIFT_BOOST = [0.55, 0.95] // what each tier is worth
const DRIFT_MIN_SPEED = 12 // below this a drift is a pirouette, not a line

const COUNTDOWN = 3
const FINISH_GRACE = 45 // seconds the race runs on after the winner is home

// Items ---------------------------------------------------------------------
const BOX_RESPAWN = 5
// Item boxes at this many points around the lap, 3 abreast. Ten rows over 1292m
// puts a line of them about every 130 metres: often enough that a lap is never
// dry, far enough apart that they are a thing you drive to rather than scenery
// you cannot avoid.
const BOX_ROWS = 10
const BOOST_SECONDS = 1.6
const STAR_SECONDS = 6
const STAR_SPEED = 1.25
const SHRINK_SECONDS = 4
const SHRINK_SPEED = 0.55
export const SPIN_SECONDS = 1.3
// A spinning kart has no purchase on the road: it neither holds its line nor
// keeps the speed it is given, which is what lets a shove carry it clear.
const SPIN_DRAG = 1.2
// Its share of a shove, as a fraction of an ordinary kart's. Low enough that
// driving into a pirouette moves the pirouette rather than stopping you.
const LOOSE = 0.3
// The speed advantage at which a kart in front stops being a wall and starts
// being something you go through. A spin is over in 1.3s but the kart it happened
// to is still crawling, and at full mass that is the same roadblock wearing a
// different flag — which is most of what "stuck behind people spinning out"
// actually is.
const PLOUGH = 14
// How firm kart-on-kart contact is. Contact should be something you feel.
const RESTITUTION = 2.2
// What a kart on the receiving end of a shove gives back while it is spinning.
const SHRUG = 0.15
// Seconds of immunity after a hit, on top of the spin itself. Unannounced by
// design: it exists so one bad moment is not three.
const GRACE_AFTER = 1.5
const SHELL_SPEED = 55
const SHELL_LIFE = 7
const SHELL_R = 1.2
const SHELL_TURN = 3.2 // rad/s a red shell can steer
const HAZARD_R = 1.6
const AI_ITEM_DELAY = 1.5
const GOLD_SECONDS = 0.9 // one of a Golden Mushroom's several short boosts
const BLAST_R = 9 // a bomb, or a spiny shell coming home
const BOMB_FUSE = 3 // it waits, and then it goes off whether or not it was found
const BOMB_TRIGGER = 4.5 // how near you have to be for it to go off early
const INK_SECONDS = 5
const INK_MAX = 0.9 // what a screenful of ink costs you off the top end
const MEGA_SECONDS = 7
const MEGA_SPEED = 1.12
const MEGA_SCALE = 1.7
const BULLET_SECONDS = 5
const BULLET_SPEED = 78
const CLOUD_SECONDS = 8
const CLOUD_SPEED = 1.06
const CLOUD_LOCK = 0.8

/**
 * The item table. The index travels in the state and the HUD looks it up, so
 * appending is safe and reordering is not.
 *
 * `fires` is the effect an item actually performs, so the triples are one item
 * with a count rather than four copies of the same code; `count` is how many
 * times it can be spent before the slot empties.
 */
export const ITEMS = [
  { key: 'boost', name: 'Mushroom', hint: 'a burst of speed' },
  { key: 'banana', name: 'Banana', hint: 'drops behind you' },
  { key: 'green', name: 'Green Shell', hint: 'fires straight ahead' },
  { key: 'red', name: 'Red Shell', hint: 'homes on the kart ahead' },
  { key: 'bolt', name: 'Lightning', hint: 'shrinks everyone else' },
  { key: 'star', name: 'Star', hint: 'untouchable, and quick' },
  { key: 'boost3', name: 'Triple Mushrooms', hint: 'three bursts of speed', fires: 'boost', count: 3 },
  { key: 'banana3', name: 'Triple Bananas', hint: 'three peels to lay', fires: 'banana', count: 3 },
  { key: 'green3', name: 'Triple Green Shells', hint: 'three straight shots', fires: 'green', count: 3 },
  { key: 'red3', name: 'Triple Red Shells', hint: 'three that chase', fires: 'red', count: 3 },
  { key: 'gold', name: 'Golden Mushroom', hint: 'boost after boost', fires: 'gold', count: 6 },
  { key: 'fake', name: 'Fake Item Box', hint: 'a box that is a trap' },
  { key: 'bomb', name: 'Bob-omb', hint: 'a blast, not a bump' },
  { key: 'blue', name: 'Spiny Shell', hint: 'goes for the leader' },
  { key: 'pow', name: 'POW Block', hint: 'spins out everyone ahead' },
  { key: 'blooper', name: 'Blooper', hint: 'inks the karts ahead' },
  { key: 'mega', name: 'Mega Mushroom', hint: 'huge, and it squashes' },
  { key: 'bullet', name: 'Bullet Bill', hint: 'flies the line for you' },
  { key: 'cloud', name: 'Thundercloud', hint: 'quick — pass it on, fast' },
]

/**
 * The roll, one row per place in a twelve-kart field, after Mario Kart Wii's
 * own distribution chart. Two interpolated endpoints could not express this:
 * the middle of the field is where the bombs, the POW and the spiny shell live,
 * and a hump in the middle is not something a straight line between front and
 * back can make. Leading, the pool is deliberately weak — things to throw
 * behind you — and the back of the field is where the race is given back to
 * you. Exported so the way-in screen draws the numbers the roll actually reads.
 */
export const ROLL_ROWS = [
  { green: 3, fake: 2, banana: 3, banana3: 2 },
  { red: 2, banana: 3, green: 3, boost: 1, green3: 1, banana3: 2, fake: 2 },
  { red: 3, boost: 2, green: 2, green3: 2, banana3: 1, banana: 2, red3: 1, fake: 1, cloud: 1 },
  { fake: 1, red: 3, boost: 2, green: 2, green3: 2, banana3: 1, bomb: 2, cloud: 1, blue: 1, red3: 1 },
  { red: 3, boost: 2, green: 1, bomb: 2, pow: 1, gold: 1, blooper: 1, green3: 1, red3: 2, cloud: 1, boost3: 1 },
  { boost3: 2, gold: 2, boost: 2, bomb: 2, blue: 1, red3: 2, cloud: 1, green3: 1, pow: 1, mega: 1 },
  { boost3: 2, gold: 3, blooper: 2, pow: 2, red3: 2, blue: 1, boost: 1, green3: 1, red: 1, mega: 1 },
  { boost3: 2, gold: 3, star: 2, blue: 1, blooper: 2, pow: 2, red3: 1, cloud: 1, mega: 1 },
  { boost3: 2, gold: 3, star: 3, blooper: 2, pow: 1, blue: 1, bullet: 1, mega: 1 },
  { gold: 3, boost3: 2, star: 4, bullet: 2, bolt: 1 },
  { gold: 3, star: 4, bullet: 3, boost3: 1, bolt: 2 },
  { bullet: 4, gold: 3, bolt: 3, star: 4, boost3: 1 },
]

/** The rows as weight arrays lined up with ITEMS, which is what roll() reads. */
export const ROLL_TABLE = ROLL_ROWS.map((row) => ITEMS.map((item) => row[item.key] ?? 0))
export const ROLL_FRONT = ROLL_TABLE[0]
export const ROLL_BACK = ROLL_TABLE[ROLL_TABLE.length - 1]

export function trackPoint(t) {
  const a = t * Math.PI * 2
  // Three harmonics rather than two, and the 5th is what makes the corners
  // uneven: a couple of sweepers you can carry speed through, a hairpin you
  // cannot, and a kink between them that punishes a lazy line.
  const r =
    TRACK_R *
    (1 +
      0.2 * Math.sin(3 * a) -
      0.13 * Math.cos(2 * a) +
      0.07 * Math.sin(5 * a + 1.1) +
      // The 7th: the circuit was made half again as long, and a longer lap that
      // is only a longer straight is a worse lap. This is what the extra metres
      // are spent on.
      0.05 * Math.cos(7 * a + 0.4))
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

// Elevation -----------------------------------------------------------------
// The road climbs and drops around the lap. Height is a function of `s` alone:
// the simulation stays a plan view — a kart's x and y are where it is on the
// map — and the hills are what you see, plus a pull along the road that costs
// you on a climb and pays it back on the way down.
const HILL = 23 // metres from the mean to a crest
// How hard a gradient pulls, in m/s^2 per unit of rise-over-run. Arcade rather
// than g: at the steepest part of the circuit this is about an eighth of what
// the engine gives you, which is felt without being fought.
const GRAVITY = 22
// The two waves the profile is made of: a long rise and fall, and a shorter one
// laid across it so the crests are not evenly spaced. Whole numbers of cycles
// per lap, or the road would not meet itself at the line.
const HILLS = [
  { cycles: 2, weight: 0.62, phase: 0 },
  { cycles: 3, weight: 0.38, phase: 1.9 },
]

/** The height of the road at a distance around the lap. */
export function heightAt(s) {
  const a = lapFraction(s) * Math.PI * 2
  let h = 0
  for (const w of HILLS) h += w.weight * Math.sin(w.cycles * a + w.phase)
  return HILL * h
}

/** Its gradient there — rise per metre along the road. */
export function slopeAt(s) {
  const a = lapFraction(s) * Math.PI * 2
  let d = 0
  for (const w of HILLS) d += w.weight * w.cycles * Math.cos(w.cycles * a + w.phase)
  return ((HILL * Math.PI * 2) / TRACK.length) * d
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

/**
 * Boost pads, as lap fractions with a lane and a half-width in metres. Placed
 * on corner exits and the bottom of the two long drops — somewhere the extra
 * speed is worth carrying — and never inside a VOIDS stretch, where the reward
 * for a wide line would be a fall rather than a choice.
 *
 * Off the centre line on purpose: a pad you have to go and take is a decision,
 * and one laid down the middle of the road is a tax on not driving over it.
 */
const PADS = [
  { t: 0.06, lane: -5, half: 3.5 },
  { t: 0.12, lane: 5, half: 3.5 },
  { t: 0.29, lane: 0, half: 4 },
  { t: 0.37, lane: -6, half: 3.5 },
  { t: 0.44, lane: 6, half: 3.5 },
  { t: 0.5, lane: -4, half: 3.5 },
  { t: 0.66, lane: 5, half: 3.5 },
  { t: 0.72, lane: 0, half: 4 },
  { t: 0.9, lane: -5, half: 3.5 },
  { t: 0.95, lane: 5, half: 3.5 },
]
/**
 * A pad's length along the road. Long enough that a kart at full speed cannot
 * step over one between two ticks — flat out covers about a metre a tick — and
 * long enough to be something you see and aim at rather than a smudge. Exported
 * in one unit, so the paint and the trigger cannot come to disagree.
 */
export const PAD_LENGTH = 14
const PAD_SECONDS = 1.1

/**
 * Where the pads sit on the map. Same shape as boxSpots: the renderer paints
 * its chevrons from this rather than working the geometry out a second time.
 */
export function padSpots() {
  return PADS.map((pad) => {
    const s = pad.t * TRACK.length
    const p = pointAt(s)
    return {
      x: p.x + p.nx * pad.lane,
      y: p.y + p.ny * pad.lane,
      s,
      lane: pad.lane,
      halfWidth: pad.half,
      heading: Math.atan2(p.ty, p.tx),
    }
  })
}

/**
 * Standing on a pad tops the boost timer up. Deliberately stateless — no
 * cooldown and nothing in the snapshot, because a pad is a pure test of where a
 * kart is this tick. It sets the same field a Mushroom does, so it inherits the
 * cap, the bleed-off, the camera and the immunity to grass for free.
 */
function hitPads(kart) {
  if (kart.respawn > 0 || kart.finished !== null) return
  // Not while it is spinning. A banana taken on a pad had spinOut zero the boost
  // and the pad hand 1.1s of it straight back, every tick the kart slid across
  // it — so a spun-out kart kept its raised cap, kept its immunity to grass, and
  // sat there with its jets lit.
  if (kart.spin > 0) return
  const hit = project(kart.x, kart.y)
  for (const pad of PADS) {
    const s = pad.t * TRACK.length
    let along = hit.s - s
    // Wrap, so a pad near the line is not missed by a kart just short of it.
    if (along > TRACK.length / 2) along -= TRACK.length
    if (along < -TRACK.length / 2) along += TRACK.length
    if (Math.abs(along) > PAD_LENGTH / 2) continue
    if (Math.abs(hit.lateral - pad.lane) > pad.half) continue
    kart.boost = Math.max(kart.boost, PAD_SECONDS)
    return
  }
}

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
  // ponytail: linear scan over TRACK_N nodes, called a handful of times a tick.
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
      // `s` rides along so the renderer can stand the box on the road's height
      // without projecting it back onto the circuit to find out.
      out.push({ x: p.x + p.nx * lane, y: p.y + p.ny * lane, s })
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
    itemCount: 0, // uses left of it, which is 3 for a triple and 1 for the rest
    itemDown: false,
    boost: 0,
    // Mini-turbo: how long the current drift has been held. The tier it has
    // reached is driftTier(kart) — a second field for it would be the same
    // number twice, on the wire and in every reset.
    driftTime: 0,
    star: 0,
    shrink: 0,
    spin: 0,
    grace: 0, // seconds of immunity after a hit — silent, no HUD
    mega: 0,
    bullet: 0,
    ink: 0,
    cloud: 0,
    cloudLock: 0, // a moment after taking the cloud where it cannot be handed back
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
    // A kart that is home drives itself down the road on the AI's line. Left on
    // the player's input it either parks on the racing line or, with the
    // throttle pinned as it used to be, ploughs straight into the barrier —
    // neither of which reads as having finished.
    const driven = kart.ai || kart.finished !== null
    const bits = driven ? aiBits(state, kart, dt) : inputs[kart.id] | 0
    useItem(state, kart, bits)
    stepKart(state, kart, bits, dt)
  }

  stepShells(state, dt)
  stepBombs(state, dt)
  for (const kart of state.karts) {
    collectBox(state, kart)
    hitHazards(state, kart)
    hitPads(kart)
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
  // A drift only charges while the kart is driving itself. Both early returns
  // below — being fished out, and flying a bullet — skip the drift block
  // entirely, so a charge left standing across one came back out the far side as
  // a free boost. One line here rather than one at each escape.
  if (kart.respawn > 0 || kart.bullet > 0) kart.driftTime = 0
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

  const spinning = kart.spin > 0
  if (spinning) {
    kart.spin = Math.max(0, kart.spin - dt)
    // Out of it, and pointing down the road. Left where the last frame of the
    // pirouette happened to stop, half of these end facing the barrier.
    if (kart.spin === 0) {
      const p = pointAt(kart.s)
      kart.heading = Math.atan2(p.ty, p.tx)
    }
  }
  if (kart.grace > 0) kart.grace = Math.max(0, kart.grace - dt)
  if (kart.boost > 0) kart.boost = Math.max(0, kart.boost - dt)
  if (kart.star > 0) kart.star = Math.max(0, kart.star - dt)
  if (kart.shrink > 0) kart.shrink = Math.max(0, kart.shrink - dt)
  if (kart.mega > 0) kart.mega = Math.max(0, kart.mega - dt)
  // Ink clears on its own, and faster while you are on the throttle: boosting
  // out of it is the way out, as it is in the game this is a clone of.
  if (kart.ink > 0) kart.ink = Math.max(0, kart.ink - dt * (kart.boost > 0 ? 3 : 1))
  if (kart.cloudLock > 0) kart.cloudLock = Math.max(0, kart.cloudLock - dt)
  if (kart.cloud > 0) {
    kart.cloud = Math.max(0, kart.cloud - dt)
    // Hot potato, and you lost: it goes off over whoever is still holding it.
    if (kart.cloud === 0) {
      kart.shrink = SHRINK_SECONDS
      kart.boost = 0
    }
  }
  if (kart.bullet > 0) {
    kart.bullet = Math.max(0, kart.bullet - dt)
    flyBullet(kart, dt)
    return
  }

  const drifting = (bits & IN_DRIFT) !== 0 && !spinning
  const speed = Math.hypot(kart.vx, kart.vy)
  const steering = (bits & (IN_LEFT | IN_RIGHT)) !== 0
  if (drifting && steering && speed > DRIFT_MIN_SPEED) {
    kart.driftTime += dt
  } else {
    // Letting go pays out whatever tier was reached — straightening up or
    // dropping below walking pace pay out too, since the charge was earned
    // either way. Short of the first tier there is simply nothing to pay.
    const tier = driftTier(kart)
    if (tier > 0) kart.boost = Math.max(kart.boost, DRIFT_BOOST[tier - 1])
    kart.driftTime = 0
  }
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
    // Reversing swaps left and right, the way a real car does: the wheels turn
    // the same way and the nose swings the other. Backing off a barrier with the
    // steering still reading forwards is how you end up wedged against it.
    if (kart.vx * Math.cos(kart.heading) + kart.vy * Math.sin(kart.heading) < -0.5) steer = -steer
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
  // The hill: gravity down the road rather than down the kart's nose, so a
  // climb takes the same off you whichever way you are pointing.
  const slope = slopeAt(hit.s)
  kart.vx -= hit.tx * GRAVITY * slope * dt
  kart.vy -= hit.ty * GRAVITY * slope * dt

  const offroad = Math.abs(hit.lateral) > halfWidthAt(hit.s)
  const fwd = kart.vx * fx + kart.vy * fy
  const lat = kart.vx * -fy + kart.vy * fx
  const skims = boosting || kart.star > 0 || kart.mega > 0
  const drag = spinning ? SPIN_DRAG : offroad && !skims ? OFFROAD_DRAG : DRAG
  let newFwd = fwd * damp(drag, dt)
  const newLat = lat * damp(drifting || spinning ? GRIP_DRIFT : GRIP, dt)
  // A drift is meant to be fast. The scrub the tyres give up sideways is put
  // back along the nose instead of thrown away: without this, holding a drift
  // takes 30 m/s to 10 in under a second — there is nowhere on the circuit a
  // drift can be held for two seconds — and a mini-turbo you cannot reach is
  // dead code with a comment on it.
  if (drifting) newFwd += Math.abs(lat) - Math.abs(newLat)
  kart.vx = fx * newFwd - fy * newLat
  kart.vy = fy * newFwd + fx * newLat

  let max = boosting ? BOOST_MAX : MAX_SPEED
  if (kart.star > 0) max *= STAR_SPEED
  if (kart.shrink > 0) max *= SHRINK_SPEED
  if (kart.mega > 0) max *= MEGA_SPEED
  // The cloud pays before it charges: quicker while it is over you, and a
  // shrink when it goes off.
  if (kart.cloud > 0) max *= CLOUD_SPEED
  // Driving half-blind costs you a little as well as showing you less.
  if (kart.ink > 0) max *= 1 - INK_MAX * 0.1 * (kart.ink / INK_SECONDS)
  // A mushroom is a shortcut item: while it is running, the grass does not
  // slow you the way it otherwise would.
  if (offroad) max *= boosting || kart.star > 0 || kart.mega > 0 ? 1 : OFFROAD_MAX
  // Two halves of the same rule: the cap is a hard ceiling on speed you can
  // gain, and a soft one on speed you already had. Without the first the engine
  // simply pushes through the cap; without the second the end of a Turbo cuts
  // 56 m/s to 38 in one tick, which reads as driving into a wall.
  clampSpeed(kart, Math.max(max, speed))
  bleedTo(kart, max, dt)

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
    kart.itemCount = ITEMS[kart.item].count ?? 1
  }
}

/**
 * Weighted by where you are running: the field is mapped onto the twelve rows
 * of ROLL_TABLE, so a six-kart race reads rows 0, 2, 4, 7, 9 and 11 rather than
 * only its two ends.
 */
function roll(state, kart) {
  const frac = state.karts.length > 1 ? (kart.place - 1) / (state.karts.length - 1) : 0
  const weights = ROLL_TABLE[Math.round(frac * (ROLL_TABLE.length - 1))]
  const total = weights.reduce((a, b) => a + b, 0)
  let pick = rand(state) * total
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i]
    if (pick <= 0) return i
  }
  return 0
}

function useItem(state, kart, bits) {
  // Space fires as well as E — on a kart IN_BOOST has nothing else to do but
  // help a star along, and the HUD has always said "space to fire". Here rather
  // than in the client: the solo loop patched its own input and the room path
  // did not, so space fired in a solo race and did nothing in a room.
  const down = (bits & (IN_ITEM | IN_BOOST)) !== 0
  const fire =
    down && !kart.itemDown && kart.item !== null && kart.finished === null && kart.respawn === 0
  kart.itemDown = down
  if (!fire) return

  const held = ITEMS[kart.item]
  // A triple is one item spent three times: the slot only empties on the last.
  kart.itemCount = (kart.itemCount || 1) - 1
  if (kart.itemCount <= 0) kart.item = null
  const item = held.fires ?? held.key
  const fx = Math.cos(kart.heading)
  const fy = Math.sin(kart.heading)
  // A shell leaves at its own speed plus whatever the kart was already doing.
  // Flat SHELL_SPEED is slower than a boosting kart, which then drives into the
  // shell it just fired the moment its own immunity lapses — fire while your
  // Turbo is running and you spin yourself out.
  const launchSpeed = SHELL_SPEED + Math.max(0, kart.vx * fx + kart.vy * fy)

  if (item === 'boost') kart.boost = BOOST_SECONDS
  else if (item === 'gold') kart.boost = Math.max(kart.boost, GOLD_SECONDS)
  else if (item === 'star') kart.star = STAR_SECONDS
  else if (item === 'mega') kart.mega = MEGA_SECONDS
  else if (item === 'bullet') {
    kart.bullet = BULLET_SECONDS
    kart.spin = 0
    kart.ink = 0
  } else if (item === 'cloud') kart.cloud = CLOUD_SECONDS
  else if (item === 'banana' || item === 'fake' || item === 'bomb') {
    state.hazards.push({
      x: kart.x - fx * (KART_R + 2),
      y: kart.y - fy * (KART_R + 2),
      owner: kart.id,
      kind: item,
      fuse: item === 'bomb' ? BOMB_FUSE : 0,
    })
  } else if (item === 'green' || item === 'red' || item === 'blue') {
    state.shells.push({
      x: kart.x + fx * (KART_R + 1.5),
      y: kart.y + fy * (KART_R + 1.5),
      vx: fx * launchSpeed,
      vy: fy * launchSpeed,
      speed: item === 'blue' ? launchSpeed * 1.3 : launchSpeed,
      life: SHELL_LIFE,
      owner: kart.id,
      // A red shell chases whoever is one place ahead; a spiny one goes for
      // whoever is winning, however far up the road that is. Nobody ahead means
      // it simply runs on as a green one does.
      target: item === 'red' ? aheadOf(state, kart) : item === 'blue' ? leaderOf(state, kart) : null,
      red: item !== 'green',
      kind: item,
    })
  } else if (item === 'bolt') {
    for (const other of state.karts) {
      if (other.id === kart.id || other.star > 0 || other.mega > 0 || other.bullet > 0) continue
      other.shrink = SHRINK_SECONDS
      other.item = null
      other.itemCount = 0
    }
  } else if (item === 'pow') {
    // A shockwave up the road: everyone in front of you loses the lap they were
    // having, and whatever they were holding with it.
    for (const other of state.karts) {
      if (other.id === kart.id || other.prog <= kart.prog) continue
      spinOut(other)
      if (other.spin > 0) {
        other.item = null
        other.itemCount = 0
      }
    }
  } else if (item === 'blooper') {
    for (const other of state.karts) {
      if (other.id === kart.id || other.prog <= kart.prog || other.star > 0) continue
      other.ink = INK_SECONDS
    }
  }
}

/** Whoever is winning, which is what a spiny shell is for. */
function leaderOf(state, kart) {
  let best = null
  for (const other of state.karts) {
    if (other.id === kart.id) continue
    if (best === null || other.prog > best.prog) best = other
  }
  return best ? best.id : null
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
        shell.vx = Math.cos(a) * shell.speed
        shell.vy = Math.sin(a) * shell.speed
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
      // A spiny shell arriving is an explosion, and whoever is running with the
      // leader goes up with them.
      if (shell.kind === 'blue') blast(state, shell.x, shell.y)
      else spinOut(kart)
      break
    }
  }
  state.shells = state.shells.filter((s) => s.life > 0)
}

/** A bob-omb waits on its fuse, and then goes off wherever it is lying. */
function stepBombs(state, dt) {
  for (const hazard of state.hazards) {
    if (hazard.kind !== 'bomb' || hazard.dead) continue
    hazard.fuse -= dt
    if (hazard.fuse > 0) continue
    hazard.dead = true
    blast(state, hazard.x, hazard.y)
  }
  state.hazards = state.hazards.filter((h) => !h.dead)
}

function hitHazards(state, kart) {
  if (kart.respawn > 0) return
  for (const hazard of state.hazards) {
    if (hazard.dead) continue
    // A bomb does not wait to be run over — driving near it is enough, once it
    // has had a moment to arm. Without that it goes off in the hand that set
    // it: it is dropped a kart's length behind, which is inside its own reach.
    if (hazard.kind === 'bomb' && hazard.fuse > BOMB_FUSE - 0.6) continue
    const reach = hazard.kind === 'bomb' ? BOMB_TRIGGER : KART_R + HAZARD_R
    if (Math.hypot(hazard.x - kart.x, hazard.y - kart.y) > reach) continue
    hazard.dead = true
    // A peel or a fake box catches whoever drove into it; a bomb catches
    // everything standing near it, the kart that set it off included.
    if (hazard.kind === 'bomb') blast(state, hazard.x, hazard.y)
    else spinOut(kart)
  }
  state.hazards = state.hazards.filter((h) => !h.dead)
}

/** Everything close enough to a bang, star and mega excepted. */
function blast(state, x, y) {
  for (const kart of state.karts) {
    if (Math.hypot(kart.x - x, kart.y - y) > BLAST_R) continue
    spinOut(kart)
  }
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

/**
 * A bullet flies the racing line for you: it holds the middle of the road, at a
 * speed nothing else on the circuit has, and nothing touches it on the way.
 */
function flyBullet(kart, dt) {
  const hit = project(kart.x, kart.y)
  const p = pointAt(hit.s + 16)
  const want = Math.atan2(p.y - kart.y, p.x - kart.x)
  kart.heading = wrap(kart.heading + clamp(wrap(want - kart.heading), -7 * dt, 7 * dt))
  kart.vx = Math.cos(kart.heading) * BULLET_SPEED
  kart.vy = Math.sin(kart.heading) * BULLET_SPEED
  kart.x += kart.vx * dt
  kart.y += kart.vy * dt
  confine(kart)
}

function spinOut(kart) {
  if (kart.star > 0 || kart.mega > 0 || kart.bullet > 0) return
  if (kart.finished !== null || kart.respawn > 0) return
  // Just been hit: you get a moment to drive out of it before anything else
  // lands. Nothing shows this — it is felt, not read.
  if (kart.grace > 0) return
  kart.grace = SPIN_SECONDS + GRACE_AFTER
  kart.spin = SPIN_SECONDS
  kart.driftTime = 0 // whatever was being charged is lost with everything else
  kart.boost = 0
  kart.vx *= 0.3
  kart.vy *= 0.3
}

/** Kart on kart: a shove, not a crash. Nobody is stopped by being leant on. */
function bump(a, b) {
  if (a.respawn > 0 || b.respawn > 0) return
  const dx = b.x - a.x
  const dy = b.y - a.y
  const r = KART_R * (kartScale(a) + kartScale(b))
  const d = Math.hypot(dx, dy)
  if (d >= r || d < 1e-6) return
  const nx = dx / d
  const ny = dy / d

  // What contact does happens first, so the shove is then worked out against one
  // state of the world. Read the masses before this and the hit that starts a
  // spin uses the pre-spin mass for the overlap and the post-spin one for
  // everything after it.
  //
  // Contact is contact: what a star, a mega, a bullet or a cloud does happens
  // whether or not the two are closing, or a kart caught from behind at the
  // moment it is already being pushed away gets away with it.
  if (a.star > 0 || a.mega > 0 || a.bullet > 0) spinOut(b)
  if (b.star > 0 || b.mega > 0 || b.bullet > 0) spinOut(a)
  // Hot potato: touch someone and the cloud is theirs, which is the only way
  // out from under it.
  if (a.cloud > 0 && a.cloudLock === 0 && b.cloud === 0 && b.star === 0) handCloud(a, b)
  else if (b.cloud > 0 && b.cloudLock === 0 && a.cloud === 0 && a.star === 0) handCloud(b, a)

  // Split the overlap and the impulse by inverse mass, not down the middle: a
  // Mega should barrel through, and a kart that is in no position to argue —
  // spinning, or simply crawling while you arrive at speed — should be swept
  // aside rather than stopping you dead.
  const aLoose = givesWay(a, b)
  const bLoose = givesWay(b, a)
  const ma = massOf(a, aLoose)
  const mb = massOf(b, bLoose)
  const share = mb / (ma + mb) // how much of it a takes
  const push = r - d
  a.x -= nx * push * share
  a.y -= ny * push * share
  b.x += nx * push * (1 - share)
  b.y += ny * push * (1 - share)

  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn > 0) return
  const j = (-RESTITUTION * vn) / (1 / ma + 1 / mb)
  // A kart mid-spin has nothing to push back with: it takes the shove, and
  // whoever put it there hardly feels it. Straight two-body physics would hand
  // a third of your speed to a kart you drove through, which is the sensation
  // being fixed here rather than a detail of it.
  a.vx -= ((j * nx) / ma) * (bLoose ? SHRUG : 1)
  a.vy -= ((j * ny) / ma) * (bLoose ? SHRUG : 1)
  b.vx += ((j * nx) / mb) * (aLoose ? SHRUG : 1)
  b.vy += ((j * ny) / mb) * (aLoose ? SHRUG : 1)
  // Being light is not a licence to be fired off the circuit — and light is
  // shrunk as much as it is spinning. A shrunk kart tops out at 21 m/s of its
  // own, and a shove was sending it to fifty. Its own cap reasserts itself on
  // the way down, the way the end of a Turbo does.
  if (ma < 1) clampSpeed(a, MAX_SPEED)
  if (mb < 1) clampSpeed(b, MAX_SPEED)
}

/**
 * How much a kart weighs in a shove. Size squared, because a Mega that is 1.7
 * times as wide should not merely be 1.7 times as hard to move; and a fraction
 * of that while it is spinning, which is the whole of the roadblock fix.
 */
function massOf(kart, loose) {
  const scale = kartScale(kart)
  return scale * scale * (loose ? LOOSE : 1)
}

/**
 * Whether `victim` gives way to `hitter` instead of standing its ground: it is
 * spinning, or it is being caught at PLOUGH m/s more than it is doing. The second
 * half is what stops the aftermath of a spin — a kart at walking pace in the
 * middle of the road, no longer spinning — from being a wall.
 */
function givesWay(victim, hitter) {
  if (victim.spin > 0) return true
  if (victim.mega > 0 || victim.star > 0) return false
  return Math.hypot(hitter.vx, hitter.vy) - Math.hypot(victim.vx, victim.vy) > PLOUGH
}

/** Pass the cloud on, and hold it there a moment so it does not flip back. */
function handCloud(from, to) {
  to.cloud = from.cloud
  to.cloudLock = CLOUD_LOCK
  from.cloud = 0
  from.cloudLock = 0
}

/** Which mini-turbo tier the current drift has reached: 0, 1 or 2. */
export function driftTier(kart) {
  return DRIFT_TIERS.filter((t) => kart.driftTime >= t).length
}

/** How big a kart is right now: mega is a real size, and so is a shrink. */
export function kartScale(kart) {
  if (kart.mega > 0) return MEGA_SCALE
  if (kart.shrink > 0) return 0.55
  return 1
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

/**
 * Give up speed above the cap rather than cutting to it. A hard clamp is what
 * made the end of a Turbo feel like driving into a wall: 56 m/s to 38 in a
 * single tick, with none of the momentum carried out of it.
 */
function bleedTo(body, max, dt) {
  const s = Math.hypot(body.vx, body.vy)
  if (s <= max) return
  const next = max + (s - max) * damp(OVERSPEED_BLEED, dt)
  body.vx *= next / s
  body.vy *= next / s
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
    nums.push(k.x, k.y, k.vx, k.vy, k.heading, k.prog, k.place, k.item ?? -1, k.itemCount, k.spin, k.grace, k.driftTime, k.boost, k.star, k.shrink, k.respawn, k.mega, k.bullet, k.ink, k.cloud)
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
