// Kart: the racing game. Four circuits, six karts, item boxes, three laps.
//
// Same contract as sim.js — pure and deterministic, fixed timestep, no
// Math.random and no Date — so the same seed and the same inputs give the same
// race. Randomness comes off state.seed, exactly as Rumble's does.
//
// It shares constants.js only for the input bits and the tick rate: a kart is a
// different vehicle from a football car and wants its own numbers.

import {
  DT,
  IN_FWD,
  IN_BACK,
  IN_LEFT,
  IN_RIGHT,
  IN_BOOST,
  IN_DRIFT,
  IN_ITEM,
  IN_AIM,
  IN_SOFT,
  SOFT_STEER,
} from './constants.js'
import { TRACKS, TRACK_KEYS, DEFAULT_TRACK } from './kart-tracks.js'

export { TRACKS, TRACK_KEYS, DEFAULT_TRACK }

// Track ---------------------------------------------------------------------
// A circuit is a closed curve through a table of nodes, sampled into a polyline.
// No asset files, and the renderer builds its ribbon from the same numbers the
// physics uses, so the road you see is the road you drive on. The tables live in
// kart-tracks.js, one set per map; setTrack picks which one is loaded.
// Sampled finely enough for the hairpins: at 200 nodes the tight corners came
// out as flat spots, which project() then reads as a straight. Node count is
// tied to the radius — the density is the thing that matters, not the count.
export const TRACK_N = 512
// The tarmac across the line of the track being driven, which is the widest
// point of every one of them so that a six-kart grid always fits. Reassigned by
// setTrack, and a let rather than a const because an importer reads the live
// binding and so sees the swap.
export let HALF_WIDTH = Math.max(...TRACKS[DEFAULT_TRACK].widths.map(([, w]) => w))
export const KERB = 5 // grass past the tarmac before the wall
export const LAPS = 3
// A fall costs you this long sitting still, plus the metres you fell at.
export const RESPAWN_SECONDS = 2.5
// How far a kart may drop off the edge and still climb out of it. Going over the
// side is not instantly fatal: it keeps the speed it left with and falls, so a
// void that bites into a corner is a line you can take if you carry enough speed
// to reach tarmac again. Six metres is about three quarters of a second, twenty
// odd metres at racing speed — enough for a cut worth trying, not enough to
// cross a drop that was meant to stop you.
export const FALL_GRACE = 6
// How far back up the road you are put down, so you are not dropped straight
// back over the edge you went off.
const RECOVER_BACK = 6

// The Coupe's radius and top speed, kept under their old names because they are
// what everything not driving a particular kart scales against: the renderer's
// speed cues, the size an item box is drawn at, the grid. Per-kart numbers come
// off CHASSIS_STATS, and the test that pins these two to the Coupe's row is
// what stops the baseline drifting away from the car it describes.
export const KART_R = 2.2
export const MAX_SPEED = 38
const REVERSE = 20

// Chassis -------------------------------------------------------------------
// Six cars, and the only thing a chassis is: six constants the physics already
// had, moved off the module and onto the kart. The Coupe's row is what the race
// used before there was a choice, so a field of Coupes is the old race exactly.
//
// The spread is deliberately narrow — modelled corner by corner, a clean lap is
// within a tenth of a second across the set, so a chassis is a preference for a
// kind of corner rather than a tier list. Nothing here touches the item roll,
// the box cooldown, the drift tiers or the boost values: a chassis can never
// out-item you.
export const CHASSIS_STATS = {
  coupe: { accel: 34, top: 38, grip: 10, turn: 2.5, mass: 1, radius: 2.2 },
  wedge: { accel: 33, top: 41.5, grip: 9, turn: 2.35, mass: 1, radius: 2.2 },
  van: { accel: 31, top: 36.5, grip: 11, turn: 2.3, mass: 1.25, radius: 2.5 },
  roadster: { accel: 36, top: 37, grip: 10.6, turn: 2.8, mass: 0.9, radius: 2.1 },
  openwheel: { accel: 35, top: 36, grip: 11.4, turn: 2.7, mass: 0.95, radius: 2 },
  bike: { accel: 37, top: 40.5, grip: 9.2, turn: 2.9, mass: 0.7, radius: 1.6 },
}
export const CHASSIS_KEYS = Object.keys(CHASSIS_STATS)
export const DEFAULT_CHASSIS = 'coupe'

/**
 * What this kart is driving. A snapshot comes off a channel, so an unknown key
 * is a Coupe rather than a crash — and the sim reads stats through here only,
 * which is what keeps a missing field from being six different bugs.
 */
export function statsOf(kart) {
  return CHASSIS_STATS[kart.chassis] ?? CHASSIS_STATS[DEFAULT_CHASSIS]
}

/** How wide this kart is in a collision: its chassis, and its size right now. */
export function radiusOf(kart) {
  return statsOf(kart).radius * kartScale(kart)
}
const BOOST_ACCEL = 46
const BOOST_MAX = 56
const DRAG = 0.45
const GRIP_DRIFT = 3.2
const TURN_MIN = 0.4
const OFFROAD_MAX = 0.45 // fraction of top speed the grass allows
const OFFROAD_DRAG = 2.6
const WALL_BOUNCE = 0.3
// How fast speed above the current cap is given up, per second.
const OVERSPEED_BLEED = 6

// Slipstream. Tucked in behind another kart you are in its hole in the air: a
// cone SLIP_LEN long and SLIP_WIDE either side, strongest right on its bumper,
// worth SLIP_ACCEL on the throttle and a few percent off the speed cap. It is
// a tow, not a magnet — it pays only while you are pointed the same way as the
// kart in front and moving quickly enough for air to matter, so it cannot be
// farmed alongside someone, facing backwards, or off the line.
const SLIP_LEN = 15
const SLIP_WIDE = 3.5
const SLIP_ACCEL = 13
const SLIP_TOP = 1.06
const SLIP_MIN_SPEED = 15
const SLIP_ALIGN = 0.6 // cos of the biggest heading difference that still tows

// Drift mini-turbo. Hold a drift with the wheel over and it charges; let go
// with a charge and you are paid in the same boost a Mushroom gives, which is
// the whole reason this is a small change.
// Exported: the renderer colours the sparks off these, and a second copy of the
// thresholds would disagree with these the first time they are tuned.
export const DRIFT_TIERS = [0.9, 1.9] // seconds held for tier one and tier two
const DRIFT_BOOST = [0.55, 0.95] // what each tier is worth
const DRIFT_MIN_SPEED = 12 // below this a drift is a pirouette, not a line
// A drift is held, not steered. Once it is locked in a direction the steering
// only trims it: into the corner tightens, away from it opens the line out, and
// neither can flip it over. Turning at the full rate for a second and a half —
// which is what a drift used to do — is a ten metre circle, so the kart left
// the road long before either tier, and the mini-turbo was unreachable in
// practice. These are fractions of the chassis' turn rate.
const DRIFT_TIGHT = 1 // steering into the drift
const DRIFT_HOLD = 0.55 // no steering: the line it holds on its own
const DRIFT_OPEN = 0.15 // steering out of it

const COUNTDOWN = 3
// Coming back from a pause. Shorter than the grid countdown — everyone is
// already up to speed and pointed the right way, they just need a moment to get
// their hands back on the keys — but not nothing, or the race restarts while
// somebody is still reaching for them.
export const RESUME_COUNT = 2
const FINISH_GRACE = 45 // seconds the race runs on after the winner is home

// Items ---------------------------------------------------------------------
const BOX_RESPAWN = 5
// Item boxes at this many points around the lap, 3 abreast. Eight rows over
// 2279m puts a line of them about every 285 metres: often enough that a lap is
// never dry, far enough apart that they are a thing you drive to rather than
// scenery you cannot avoid.
let BOX_ROWS = TRACKS[DEFAULT_TRACK].boxRows
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
// The turn the road ahead has to be asking for before the AI lights a drift:
// speed times the bend of the racing line over the next 36m. The shape of the
// rule comes from DRIFT_OPEN being the slowest a drift will turn — under it the
// drift spirals in — but the number is tuned rather than derived, and sits well
// below what that argument alone gives.
const AI_DRIFT_TURN = 7.2
// How far inside its own racing line the AI will let a drift carry it, in
// metres, before letting go of it — and the road it wants before that is worth
// doing. On a narrow circuit there is nowhere better to be: dropping a drift
// three metres inside the line halfway round one of fracture's hairpins parks
// the kart mid-corner on a road nine metres to a side with gaps in it, and the
// offs got longer rather than fewer.
const AI_DRIFT_CUT = 3
const AI_DRIFT_ROOM = 10
// Racecraft. How far up the road the AI looks for something to pass, how close
// behind it notices somebody to make room for, how far off its line either is worth — as a share
// of the road it has, because three metres across is a move on a wide circuit
// and the scenery on a narrow one — and how fast it moves across, in m/s.
const AI_SEE = 25
const AI_TAIL = 10
const AI_INTENT = 0.6
const AI_INTENT_RATE = 1.5
// And how much better the better side has to look before it is worth going
// there at all, in metres of room.
const AI_WORTH = KART_R * 1.5
const GOLD_SECONDS = 0.9 // one of a Golden Mushroom's several short boosts
const BLAST_R = 9 // a bomb, or a spiny shell coming home
const HAZARD_ARM = 0.8 // how long a lobbed peel ignores the kart that threw it
const POW_R = 60 // the POW's ring is a signal, not a hit test — everyone ahead is caught
const BLAST_SHOWN = 0.7 // how long a ring is kept around for the renderer to draw
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

// The road ------------------------------------------------------------------
// The shape of the circuit is data, and there are four of them: the tables the
// physics reads are whatever setTrack last put here, and everything below —
// projection, widths, hills, jumps, pads, item boxes — is written against these
// and so needs no per-track cases of its own.
let NODES = TRACKS[DEFAULT_TRACK].nodes
let WIDTHS = TRACKS[DEFAULT_TRACK].widths
let HILLS = TRACKS[DEFAULT_TRACK].hills
let PADS = TRACKS[DEFAULT_TRACK].pads
let JUMP_RISE = 6 * TRACKS[DEFAULT_TRACK].airtime
let ACTIVE = DEFAULT_TRACK

/**
 * Drive a different map. Every table that describes the road is swapped and the
 * polyline rebuilt; the exported bindings are `let` so an importer — the
 * renderer, a test — reads the new road rather than a copy of the old one.
 *
 * The sim stays deterministic: which map a race is on lives on the state and
 * travels in the snapshot, so a peer sets the same one before it draws. An
 * unknown key is the circuit rather than a crash, since it can come off a
 * channel.
 */
export function setTrack(key) {
  const track = TRACKS[key] ? key : DEFAULT_TRACK
  // Already on it. The map screen asks six roads three questions each and every
  // question swaps the road out and back again, so without this the cheapest
  // screen in the game rebuilds the geometry thirty-six times.
  if (track === ACTIVE) return track
  const t = TRACKS[track]
  NODES = t.nodes
  WIDTHS = t.widths
  HILLS = t.hills
  PADS = t.pads
  VOIDS = t.voids
  JUMPS = t.jumps
  JUMP_AIRTIME = t.airtime
  // The arc the renderer draws over a gap, in proportion to the hop: the
  // circuit's 1.5s flight goes 9m up, and a half-second hop that went as high
  // would read as a ski jump.
  JUMP_RISE = 6 * t.airtime
  BOX_ROWS = t.boxRows
  HALF_WIDTH = Math.max(...t.widths.map(([, w]) => w))
  ACTIVE = track
  TRACK = buildTrack()
  TRACK_R = TRACK.pts.reduce((r, p) => Math.max(r, Math.hypot(p.x, p.y)), 0)
  return track
}

/** Which map is loaded. */
export function activeTrack() {
  return ACTIVE
}

/**
 * A map off a seed, so the same seed always deals the same road. Pass the map
 * just raced as `avoid` and it steps to the next one along instead: going again
 * on the road you have only this second finished reads as the button not having
 * worked, and a one-in-four chance of that is often enough to notice.
 */
export function trackFor(seed, avoid = null) {
  const i = (seed >>> 0) % TRACK_KEYS.length
  const key = TRACK_KEYS[i]
  if (key !== avoid) return key
  return TRACK_KEYS[(i + 1) % TRACK_KEYS.length]
}

/**
 * A point on the centre line, `t` being the fraction of the way round. A
 * Catmull-Rom through the nodes rather than the nodes themselves: the nodes are
 * about 14m apart on every map, and a straight join between them reads as a
 * many-sided polygon through the hairpins. The spline costs nothing, since this
 * only runs TRACK_N times per map load.
 */
export function trackPoint(t) {
  const m = NODES.length / 2
  const u = (((t % 1) + 1) % 1) * m
  const i = Math.floor(u)
  const f = u - i
  const at = (k) => {
    const j = (((i + k) % m) + m) % m
    return [NODES[j * 2], NODES[j * 2 + 1]]
  }
  const [x0, y0] = at(-1)
  const [x1, y1] = at(0)
  const [x2, y2] = at(1)
  const [x3, y3] = at(2)
  const spline = (a, b, c, d) =>
    0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f)
  return { x: spline(x0, x1, x2, x3), y: spline(y0, y1, y2, y3) }
}

/** Where `s` falls in the lap, as a fraction in [0, 1). */
function lapFraction(s) {
  const L = TRACK.length
  return (((s % L) + L) % L) / L
}


/** The tarmac's half-width at a distance around the lap, straight off WIDTHS. */
export function halfWidthAt(s) {
  const t = lapFraction(s)
  // ponytail: linear scan over a dozen entries, in the physics' inner loop.
  // Precompute per node if it ever shows up in a profile.
  let i = 0
  while (i < WIDTHS.length - 2 && WIDTHS[i + 1][0] <= t) i++
  const [t0, w0] = WIDTHS[i]
  const [t1, w1] = WIDTHS[i + 1]
  return w0 + ((w1 - w0) * (t - t0)) / (t1 - t0)
}

// Elevation -----------------------------------------------------------------
// The road climbs and drops around the lap. Height is a function of `s` alone:
// the simulation stays a plan view — a kart's x and y are where it is on the
// map — and the hills are what you see, plus a pull along the road that costs
// you on a climb and pays it back on the way down.
// How hard a gradient pulls, in m/s^2 per unit of rise-over-run. Arcade rather
// than g: at the steepest part of the circuit this is about a fifth of what
// the engine gives you, which is felt without being fought.
const GRAVITY = 22

/** The height of the road at a distance around the lap. */
export function heightAt(s) {
  const a = lapFraction(s) * Math.PI * 2
  let h = 0
  for (const w of HILLS) h += w.metres * Math.sin(w.cycles * a + w.phase)
  return h
}

/** Its gradient there — rise per metre along the road. */
export function slopeAt(s) {
  const a = lapFraction(s) * Math.PI * 2
  let d = 0
  for (const w of HILLS) d += w.metres * w.cycles * Math.cos(w.cycles * a + w.phase)
  return ((Math.PI * 2) / TRACK.length) * d
}

/**
 * The stretches with nothing beside the road, as fractions of the lap. Run wide
 * here and there is no kerb and no barrier to catch you — only the drop.
 * Exported because the renderer has to leave the same gaps in its scenery.
 */
export let VOIDS = TRACKS[DEFAULT_TRACK].voids

/**
 * The two places the road stops outright, as fractions of the lap. There is no
 * tarmac between the two edges of one of these: you leave the ground at the near
 * lip and either land on the far one or you do not. Exported so the renderer
 * breaks its ribbon in exactly the same two places.
 */
export let JUMPS = TRACKS[DEFAULT_TRACK].jumps
/**
 * How long a kart hangs in the air over a jump. The gap is a distance and this
 * is a time, so together they are a speed: 46 metres in a second and a half is
 * 31 m/s off the near lip, which is most but not all of flat out. Take one slow
 * and you land short, which is a fall.
 */
export let JUMP_AIRTIME = TRACKS[DEFAULT_TRACK].airtime

/** The gap `s` is over, as [from, to] in metres, or null. */
export function jumpAt(s) {
  const t = lapFraction(s)
  const gap = JUMPS.find(([from, to]) => t >= from && t <= to)
  return gap ? [gap[0] * TRACK.length, gap[1] * TRACK.length] : null
}

/** How far a kart that went over the edge has dropped, given how long it has been falling. */
export function fallDrop(fell) {
  return 0.5 * GRAVITY * fell * fell
}

/** How high a kart in flight sits above the road, given the air it has left. */
export function airRise(air) {
  if (air <= 0) return 0
  return JUMP_RISE * Math.sin(Math.PI * (1 - air / JUMP_AIRTIME))
}

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
    const lane = padLane(pad, s)
    return {
      x: p.x + p.nx * lane,
      y: p.y + p.ny * lane,
      s,
      lane,
      halfWidth: pad.half,
      heading: Math.atan2(p.ty, p.tx),
    }
  })
}

/**
 * A pad's lane, pulled in far enough that the whole band is on the tarmac. The
 * plan puts several of them against the edge of a wide part of the road, and the
 * narrows move underneath them — a pad hanging over the drop is a trap, not a
 * decision, so the road wins the argument.
 */
function padLane(pad, s) {
  const room = halfWidthAt(s) - pad.half
  return clamp(pad.lane, -room, room)
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
    if (Math.abs(hit.lateral - padLane(pad, s)) > pad.half) continue
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

export let TRACK = buildTrack()

/**
 * How far the circuit reaches from the origin. Measured off the road rather than
 * declared, since the shape is a table now; the renderer sizes the horizon plate
 * to it so the hills never poke through the far edge of the world.
 */
export let TRACK_R = TRACK.pts.reduce((r, p) => Math.max(r, Math.hypot(p.x, p.y)), 0)

// The racing line ------------------------------------------------------------
// The shortest way round: a taut string pulled through the corridor of the
// road. Each node slides sideways toward whatever straightens the line through
// its two neighbours, so what comes out hugs the inside of a corner all the way
// through it rather than swinging wide on entry — this is a minimum-length
// line, not a minimum-lap-time one, and the difference shows up as an entry
// that is already on the inside kerb. It only has to be right once per map, so
// a few hundred passes of the cheapest possible move beat anything cleverer:
// 600 is where every circuit has stopped moving, and one costs five to sixteen
// milliseconds.
const LINE_PASSES = 600
// How far in from the edge of the tarmac the line — and the AI aiming at it —
// may go. Wider than a kart, because the apex is where a kart is least pointed
// the way it is going: at exactly a kart's width the field clipped the inside
// of every corner it drifted through.
const LINE_EDGE = KART_R * 1.75
function lineLimit(s) {
  return Math.max(0, halfWidthAt(s) - LINE_EDGE)
}

/** Lateral offsets off the centre line, one per polyline node. */
function raceLine() {
  const lim = TRACK.pts.map((_, i) => lineLimit(TRACK.cum[i]))
  const off = new Array(TRACK_N).fill(0)
  const nx = []
  const ny = []
  for (let i = 0; i < TRACK_N; i++) {
    const a = TRACK.pts[i]
    const b = TRACK.pts[(i + 1) % TRACK_N]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    nx.push(-(b.y - a.y) / len)
    ny.push((b.x - a.x) / len)
  }
  for (let pass = 0; pass < LINE_PASSES; pass++) {
    for (let i = 0; i < TRACK_N; i++) {
      const p = (i - 1 + TRACK_N) % TRACK_N
      const q = (i + 1) % TRACK_N
      // The midpoint of the neighbours, measured back along this node's normal:
      // move there and the three of them are in a straight line.
      const mx = (TRACK.pts[p].x + off[p] * nx[p] + TRACK.pts[q].x + off[q] * nx[q]) / 2
      const my = (TRACK.pts[p].y + off[p] * ny[p] + TRACK.pts[q].y + off[q] * ny[q]) / 2
      const want = (mx - TRACK.pts[i].x) * nx[i] + (my - TRACK.pts[i].y) * ny[i]
      // In place, so a pass carries its own progress round the lap with it: a
      // long sweeper takes several times as many passes to settle if each one
      // only ever sees where the line was before it started.
      off[i] = clamp(want, -lim[i], lim[i])
    }
  }
  return off
}

// Per map, and not until something asks: the line is a property of the road,
// and the map screen loads all six roads in one synchronous frame without
// driving any of them.
const LINES = {}
function line() {
  return (LINES[ACTIVE] ??= raceLine())
}

/**
 * How far off the centre line the racing line sits at `s`, positive to the left
 * of travel — the same sign project() reports a kart's lateral in.
 */
function lineAt(s) {
  const L = TRACK.length
  let d = s % L
  if (d < 0) d += L
  let i = 0
  while (i < TRACK_N - 1 && TRACK.cum[i + 1] <= d) i++
  const seg = TRACK.cum[i + 1] - TRACK.cum[i]
  const t = seg > 0 ? (d - TRACK.cum[i]) / seg : 0
  const off = line()
  return off[i] + (off[(i + 1) % TRACK_N] - off[i]) * t
}

/** A point on the racing line, in world coordinates. */
function linePoint(s) {
  const p = pointAt(s)
  const off = lineAt(s)
  return { x: p.x + p.nx * off, y: p.y + p.ny * off }
}

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

// How far past a near lip a kart can still be in the air. It leaves at whatever
// it was doing and comes down JUMP_AIRTIME later, so the quickest thing on the
// road reaches this — and BOX_CLEAR past that before a box is worth standing up.
const BOX_CLEAR = 4

/**
 * A row of boxes moved along to somewhere it can actually be taken. Rows are
 * spaced evenly round the lap, so on some maps one lands in a gap — standing on
 * nothing — or in the landing zone past it, which a kart flies straight over: it
 * is off the ground from the near lip until it comes down, and picks nothing up
 * in the air. Either way it is a row that is not there, so it goes to the first
 * clear metre past the landing.
 */
function clearOfJumps(s) {
  const L = TRACK.length
  // Once per jump at most: each pass moves s to the end of the zone it landed
  // in, and a zone is left for good once it is cleared.
  for (let i = 0; i <= JUMPS.length; i++) {
    let moved = false
    for (const [from] of JUMPS) {
      const lip = from * L
      const end = lip + BOOST_MAX * JUMP_AIRTIME + BOX_CLEAR
      // The zone can run past the line, so compare on the near side of it.
      const ahead = s < lip ? s + L : s
      if (ahead >= lip && ahead <= end) {
        s = end % L
        moved = true
      }
    }
    if (!moved) return s
  }
  return s
}

/**
 * Where the item boxes stand: three abreast at BOX_ROWS points around the lap.
 * Exported because the renderer builds its meshes from the same list.
 */
export function boxSpots() {
  const out = []
  for (let i = 0; i < BOX_ROWS; i++) {
    const s = clearOfJumps((i + 0.5) * (TRACK.length / BOX_ROWS))
    // Three abreast, but no wider than the road is at that point: a fixed six
    // metres puts the outer pair over the edge in the narrows.
    const lane = Math.min(6, halfWidthAt(s) - 3)
    for (const off of [-lane, 0, lane]) {
      const p = pointAt(s)
      // `s` rides along so the renderer can stand the box on the road's height
      // without projecting it back onto the circuit to find out.
      out.push({ x: p.x + p.nx * off, y: p.y + p.ny * off, s })
    }
  }
  return out
}

/**
 * A race, empty or with a field already in it. `racers` is [{ id, name, ai }].
 * It starts in WAITING: in a room the karts sit on the grid until the host says
 * go, and the solo page simply calls begin() on the spot.
 *
 * `track` is the original circuit unless asked otherwise: a caller that wants a
 * different map every race passes trackFor(seed), and a test that wants a fixed
 * road gets one by saying nothing.
 */
export function createRace(racers = [], seed = 1, track = DEFAULT_TRACK) {
  const state = {
    tick: 0,
    time: 0,
    seed: seed >>> 0,
    // Which map this race is on. Set before anything is placed, because the
    // grid, the item boxes and the pads all come off the road. It rides in the
    // snapshot like every other field, so a peer knows what to draw without a
    // message of its own.
    track: setTrack(track),
    phase: 'WAITING',
    // Stopped by somebody, and by name so the screen can say who. Anyone in the
    // room may call it: this is a game played with people you know, and the
    // alternative is five players waiting on whoever happens to be hosting.
    paused: false,
    pausedBy: null,
    // Counting back in after a pause. The race is as frozen as it was while it
    // was stopped; this is the moment everyone gets to put their hands back.
    resumeIn: 0,
    timer: 0,
    laps: LAPS,
    karts: [],
    boxes: [],
    hazards: [], // dropped bananas
    shells: [],
    // One-shot bangs, for the renderer only: a ring the sim has already applied.
    // They live on state rather than in an event queue so a snapshot carries
    // them like everything else, and a peer joining mid-bang sees the tail of it
    // rather than a replay.
    blasts: [],
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
    // What it is driving. A racer arrives off a channel, so anything that is not
    // one of the six is a Coupe; the AI is dealt one out of the race's own PRNG,
    // so a field is six different cars and the same seed deals the same six.
    chassis: CHASSIS_STATS[racer.chassis] ? racer.chassis : DEFAULT_CHASSIS,
    x: p.x + p.nx * side * 4.5,
    y: p.y + p.ny * side * 4.5,
    vx: 0,
    vy: 0,
    heading: Math.atan2(p.ty, p.tx),
    item: null,
    itemCount: 0, // uses left of it, which is 3 for a triple and 1 for the rest
    itemDown: false,
    boost: 0,
    // Seconds it has been over the edge and dropping, 0 while it has road under
    // it. Counts time the way `air` does, and fallDrop turns it into metres.
    fell: 0,
    // How hard this kart is being towed right now, 0..1. Derived every tick;
    // it lives on the kart so the HUD can show it without redoing the search.
    draft: 0,
    // Mini-turbo: how long the current drift has been held. The tier it has
    // reached is driftTier(kart) — a second field for it would be the same
    // number twice, on the wire and in every reset.
    driftTime: 0,
    // Which way the current drift is locked: -1, 0 or 1.
    driftDir: 0,
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
    // Over a jump: seconds of flight left. Nothing reaches a kart in the air.
    air: 0,
    // Where it is across the road, off the last projection so nothing has to
    // repeat that search: signed, positive to the left of travel. Seeded from
    // the grid slot rather than left at zero, which is a legal reading meaning
    // dead centre and is not where anybody starts.
    lat: side * 4.5,
    // How long it has held its item, how much of the racing line it takes, and
    // how far off that line it wants to be right now because of somebody else.
    // Only the AI reads the last two, but a kart that has finished is driven by
    // the AI for the rest of the race — on the whole line, not on a share of
    // zero, which is the centre spline and looks like it has given up.
    aiHold: 0,
    offset: 1,
    intent: 0,
  }
  if (kart.ai) kart.chassis = CHASSIS_KEYS[Math.floor(rand(state) * CHASSIS_KEYS.length)]
  // Drawn from the race's own PRNG, so a field is not six karts on one rail.
  // How much of the racing line this one takes rather than how far off it it
  // sits: an early apex and a late one are what tells two drivers apart, and a
  // share stays on the line's own side of the road — the greediest of them sits
  // 2% past it, where a metre off it put a kart over the kerb on the inside.
  if (kart.ai) kart.offset = 0.72 + rand(state) * 0.3
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
  // Build this map's racing line now rather than leaving the first kart to ask
  // for it: it is a few milliseconds, and inside the first tick of the race
  // that is most of a frame gone at the green light. Here and not in setTrack,
  // because the map screen loads all six roads without driving any of them.
  line()
  state.phase = 'COUNT'
  state.timer = COUNTDOWN
}

/** Advance one tick. `inputs` maps kart id -> input bitmask. */
export function step(state, inputs) {
  const dt = DT
  // Nothing at all, not even the tick: a paused race is the same race when it
  // starts again, and the clock is part of the race. The host keeps sending
  // snapshots while it is stopped, which is how the room learns it is stopped.
  if (state.paused) return state
  // Counted back in, and still frozen while it counts: coming out of a pause
  // straight into a corner at full speed is not a pause anyone wanted.
  if (state.resumeIn > 0) {
    state.resumeIn = Math.max(0, state.resumeIn - dt)
    return state
  }
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
    if (kart.air > 0 || kart.fell > 0) continue
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
  for (const b of state.blasts) b.age += dt
  if (state.blasts.length) state.blasts = state.blasts.filter((b) => b.age < BLAST_SHOWN)
  return state
}

function stepKart(state, kart, bits, dt) {
  // A drift only charges while the kart is driving itself. Both early returns
  // below — being fished out, and flying a bullet — skip the drift block
  // entirely, so a charge left standing across one came back out the far side as
  // a free boost. One line here rather than one at each escape.
  if (kart.respawn > 0 || kart.bullet > 0 || kart.air > 0 || kart.fell > 0) {
    kart.driftTime = 0
    kart.driftDir = 0
    // And whatever it had decided to do about the traffic. aiBits runs whether
    // or not the kart can act on it, so one held off the road kept moving
    // across for the whole wait and came back down carrying a decision it made
    // somewhere else.
    kart.intent = 0
  }
  // Recomputed below for a kart that is actually driving. Cleared here so one
  // left standing across a respawn or a jump does not read as a tow that ended
  // several seconds ago.
  kart.draft = 0
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

  // Over a jump. It keeps the speed and the heading it left the near lip with —
  // there is nothing under the wheels to steer against — and comes down JUMP_AIRTIME
  // later, wherever that puts it. Short of the far lip is a fall.
  if (kart.air > 0) {
    kart.air = Math.max(0, kart.air - dt)
    kart.x += kart.vx * dt
    kart.y += kart.vy * dt
    if (kart.air === 0) {
      const hit = project(kart.x, kart.y)
      if (jumpAt(hit.s) || Math.abs(hit.lateral) > halfWidthAt(hit.s)) fall(kart, hit.s)
    }
    return
  }

  // Over the edge and dropping. It keeps the speed it went off with — there is
  // nothing under the wheels to steer against, same as a jump — and if the road
  // comes back under it inside FALL_GRACE metres it puts its wheels down and
  // races on. Past that it is too far below the tarmac to climb out of.
  if (kart.fell > 0) {
    kart.fell += dt
    kart.x += kart.vx * dt
    kart.y += kart.vy * dt
    const hit = project(kart.x, kart.y)
    // A gap is not somewhere to land: there is no tarmac in it to land on.
    if (Math.abs(hit.lateral) <= halfWidthAt(hit.s) && !jumpAt(hit.s)) kart.fell = 0
    else if (fallDrop(kart.fell) > FALL_GRACE) fall(kart, hit.s)
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

  const speed = Math.hypot(kart.vx, kart.vy)
  // Which way, and how much of it. A keyboard only ever asks for all of it; a
  // thumb dragged a short way asks for part, which is the difference between a
  // wheel you can hold a line with and one that is either straight or hard over.
  let turning = 0
  if (bits & IN_LEFT) turning -= 1
  if (bits & IN_RIGHT) turning += 1
  let steer = turning * ((bits & IN_SOFT) !== 0 ? SOFT_STEER : 1)
  // The button starts a drift, the wheel decides which way, and after that the
  // direction is locked until the button comes up or the kart drops to walking
  // pace. Holding it through a corner is the whole point. The direction is the
  // sign of the wheel, never its size: a drift is a state, not an amount.
  const held = (bits & IN_DRIFT) !== 0 && !spinning
  if (held && kart.driftDir === 0 && turning !== 0 && speed > DRIFT_MIN_SPEED) kart.driftDir = turning
  if (!held || speed <= DRIFT_MIN_SPEED) kart.driftDir = 0
  const drifting = kart.driftDir !== 0
  if (drifting) {
    kart.driftTime += dt
  } else {
    // Letting go pays out whatever tier was reached — straightening up or
    // dropping below walking pace pay out too, since the charge was earned
    // either way. Short of the first tier there is simply nothing to pay.
    const tier = driftTier(kart)
    if (tier > 0) kart.boost = Math.max(kart.boost, DRIFT_BOOST[tier - 1])
    kart.driftTime = 0
  }
  const st = statsOf(kart)
  const turnScale = TURN_MIN + (1 - TURN_MIN) * Math.min(1, speed / (st.top * 0.3))

  if (spinning) {
    // A spin-out: the kart pirouettes, the throttle does nothing, and the speed
    // bleeds away. Everything else this tick still applies.
    kart.heading = wrap(kart.heading + 9 * dt)
  } else if (drifting) {
    const trim = turning === kart.driftDir ? DRIFT_TIGHT : turning === 0 ? DRIFT_HOLD : DRIFT_OPEN
    kart.heading = wrap(kart.heading + kart.driftDir * st.turn * turnScale * trim * dt)
  } else {
    // Reversing swaps left and right, the way a real car does: the wheels turn
    // the same way and the nose swings the other. Backing off a barrier with the
    // steering still reading forwards is how you end up wedged against it.
    if (kart.vx * Math.cos(kart.heading) + kart.vy * Math.sin(kart.heading) < -0.5) steer = -steer
    kart.heading = wrap(kart.heading + steer * st.turn * turnScale * dt)
  }

  const fx = Math.cos(kart.heading)
  const fy = Math.sin(kart.heading)

  const boosting = kart.boost > 0 || ((bits & IN_BOOST) !== 0 && kart.star > 0)
  kart.draft = draftAt(state, kart, fx, fy, speed)
  let accel = 0
  if (!spinning) {
    if (bits & IN_FWD) accel += st.accel
    if (bits & IN_BACK) accel -= REVERSE
    if (boosting) accel += BOOST_ACCEL
    accel += SLIP_ACCEL * kart.draft
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
  const newLat = lat * damp(drifting || spinning ? GRIP_DRIFT : st.grip, dt)
  // A drift is meant to be fast. The scrub the tyres give up sideways is put
  // back along the nose instead of thrown away: without this, holding a drift
  // takes 30 m/s to 10 in under a second — there is nowhere on the circuit a
  // drift can be held for two seconds — and a mini-turbo you cannot reach is
  // dead code with a comment on it.
  if (drifting) newFwd += Math.abs(lat) - Math.abs(newLat)
  kart.vx = fx * newFwd - fy * newLat
  kart.vy = fy * newFwd + fx * newLat

  let max = boosting ? BOOST_MAX : st.top
  max *= 1 + (SLIP_TOP - 1) * kart.draft
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
 * How hard `kart` is being towed: the strongest slipstream it sits in among the
 * karts in front of it, 0 for none. A star, a mega and a bullet are already
 * past the point where a tow means anything, and a pirouette is not tucked in
 * behind anyone even when the geometry says it is.
 */
function draftAt(state, kart, fx, fy, speed) {
  if (speed < SLIP_MIN_SPEED || kart.spin > 0 || kart.star > 0 || kart.mega > 0) return 0
  let best = 0
  for (const other of state.karts) {
    if (other === kart || other.respawn > 0 || other.air > 0) continue
    const ahead = (other.x - kart.x) * fx + (other.y - kart.y) * fy
    if (ahead <= 0 || ahead > SLIP_LEN) continue
    const side = Math.abs((other.x - kart.x) * -fy + (other.y - kart.y) * fx)
    if (side > SLIP_WIDE) continue
    if (Math.cos(other.heading - kart.heading) < SLIP_ALIGN) continue
    best = Math.max(best, (1 - ahead / SLIP_LEN) * (1 - side / SLIP_WIDE))
  }
  return best
}

/**
 * The edge of the world. Over most of the lap that is a barrier past the grass
 * and nothing leaves the circuit; over a void section there is no grass and no
 * barrier, and going past the tarmac is a fall.
 */
function confine(kart) {
  const hit = project(kart.x, kart.y)
  const half = halfWidthAt(hit.s)
  if (jumpAt(hit.s)) {
    // The road has stopped. A bullet is already flying the line and crosses on
    // its own; anything else leaves the ground at the lip it just crossed.
    if (kart.bullet === 0) kart.air = JUMP_AIRTIME
    return
  }
  if (overVoid(hit.s)) {
    // No barrier here, so past the tarmac it goes over the side — but it is not
    // gone yet. It starts falling, and has FALL_GRACE metres to find road again.
    if (Math.abs(hit.lateral) > half) kart.fell = DT
    return
  }
  const limit = half + KERB - statsOf(kart).radius
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
  kart.lat = hit.lateral
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
    if (Math.hypot(box.x - kart.x, box.y - kart.y) > statsOf(kart).radius + 1.8) continue
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
    down && !kart.itemDown && kart.item !== null && kart.finished === null && kart.respawn === 0 && kart.air === 0 && kart.fell === 0
  kart.itemDown = down
  if (!fire) return

  const held = ITEMS[kart.item]
  // A triple is one item spent three times: the slot only empties on the last.
  kart.itemCount = (kart.itemCount || 1) - 1
  if (kart.itemCount <= 0) kart.item = null
  const item = held.fires ?? held.key
  // Hold Q as you fire and the throw turns round: shells go out the back, and a
  // peel or a bomb is lobbed up the road instead of dropped behind. Its own key,
  // not the brake — aiming behind you should not cost you speed.
  const aim = (bits & IN_AIM) !== 0 ? -1 : 1
  const fx = Math.cos(kart.heading) * aim
  const fy = Math.sin(kart.heading) * aim
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
      x: kart.x - fx * (statsOf(kart).radius + 2),
      y: kart.y - fy * (statsOf(kart).radius + 2),
      owner: kart.id,
      kind: item,
      fuse: item === 'bomb' ? BOMB_FUSE : 0,
      // A lob lands up the road, which is road you are about to drive over: a
      // peel needs a moment before it will catch the kart that threw it. A bomb
      // does not get one — lob a live bomb ahead of yourself and that is on you.
      arm: aim < 0 && item !== 'bomb' ? HAZARD_ARM : 0,
    })
  } else if (item === 'green' || item === 'red' || item === 'blue') {
    state.shells.push({
      x: kart.x + fx * (statsOf(kart).radius + 1.5),
      y: kart.y + fy * (statsOf(kart).radius + 1.5),
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
    // Up the road only, the same reach the POW and the Blooper have: from the
    // back it is still the whole field, and from the middle it no longer takes
    // the lap off people you have already passed.
    for (const other of state.karts) {
      if (other.id === kart.id || other.prog <= kart.prog) continue
      if (other.star > 0 || other.mega > 0 || other.bullet > 0) continue
      other.shrink = SHRINK_SECONDS
      other.item = null
      other.itemCount = 0
    }
  } else if (item === 'pow') {
    state.blasts.push({ x: kart.x, y: kart.y, r: POW_R, age: 0, kind: 'pow' })
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
      if (kart.respawn > 0 || kart.air > 0 || kart.fell > 0) continue
      if (Math.hypot(kart.x - shell.x, kart.y - shell.y) > statsOf(kart).radius + SHELL_R) continue
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
    if (hazard.arm > 0) hazard.arm -= dt
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
    if (hazard.arm > 0 && hazard.owner === kart.id) continue
    const reach = hazard.kind === 'bomb' ? BOMB_TRIGGER : statsOf(kart).radius + HAZARD_R
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
  state.blasts.push({ x, y, r: BLAST_R, age: 0, kind: 'blast' })
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
  kart.air = 0
  kart.fell = 0
  kart.recoverAt = s - RECOVER_BACK
  // Dropped into a gap, you are put down on the far side of it. The near lip is
  // no use: that is a standing start a few metres from a gap that wants thirty
  // metres a second, so a kart put there goes straight back in and keeps doing
  // it — one fall every four seconds until the flag. The far side is where the
  // jump was going to put it anyway, and missing already costs the wait and
  // every metre per second it had. `s` as well as the recovery point, because a
  // crawl off the lip lands only a metre or two in and would otherwise be
  // measured from behind the gap it just fell into.
  const gap = jumpAt(s) ?? jumpAt(kart.recoverAt)
  if (gap) kart.recoverAt = gap[1] + RECOVER_BACK
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
  if (kart.finished !== null || kart.respawn > 0 || kart.air > 0) return
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
  if (a.respawn > 0 || b.respawn > 0 || a.air > 0 || b.air > 0) return
  const dx = b.x - a.x
  const dy = b.y - a.y
  const r = radiusOf(a) + radiusOf(b)
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
  if (ma < 1) clampSpeed(a, statsOf(a).top)
  if (mb < 1) clampSpeed(b, statsOf(b).top)
}

/**
 * How much a kart weighs in a shove. Size squared, because a Mega that is 1.7
 * times as wide should not merely be 1.7 times as hard to move; and a fraction
 * of that while it is spinning, which is the whole of the roadblock fix. The
 * chassis' own mass is on top of that: the Van wins every shove it starts, the
 * Bike loses every one it is in.
 */
function massOf(kart, loose) {
  const scale = kartScale(kart)
  return statsOf(kart).mass * scale * scale * (loose ? LOOSE : 1)
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
 * Drive the racing line: aim at a point up the road on it, nudged onto this
 * kart's own line, and hold the throttle down. It drifts where the corner is
 * tight enough to pay a mini-turbo, and fires whatever it picks up after a
 * moment — enough to make the field dangerous without making it smart.
 */
function aiBits(state, kart, dt) {
  let bits = IN_FWD
  const speed = Math.hypot(kart.vx, kart.vy)
  // How far the line bends over the next stretch of road, as the angle between
  // two chords along it. A corner is something the AI can see coming rather
  // than something it discovers as steering error, which is what lets it have
  // the drift already lit on the way in and hold it long enough to be paid.
  const b0 = linePoint(kart.s + 4)
  const b1 = linePoint(kart.s + 22)
  const b2 = linePoint(kart.s + 40)
  const bend = wrap(Math.atan2(b2.y - b1.y, b2.x - b1.x) - Math.atan2(b1.y - b0.y, b1.x - b0.x))
  const aim = kart.s + 10 + speed * 0.35
  const p = pointAt(aim)
  const room = lineLimit(aim)
  // Racecraft. The nearest kart up the road worth going round, and the nearest
  // one close enough behind to be worth making room for. Between them they are
  // what makes this a race rather than six laps driven in parallel.
  let ahead = null
  let chaser = false
  for (const other of state.karts) {
    // Whatever bump treats as solid, which a kart that has finished still is:
    // it is driven round the circuit until the flag and can be run into.
    if (other === kart || other.respawn > 0 || other.air > 0) continue
    let ds = other.s - kart.s
    if (ds > TRACK.length / 2) ds -= TRACK.length
    else if (ds < -TRACK.length / 2) ds += TRACK.length
    // Something to go round has to be something it is actually catching: a kart
    // pulling away up the road is not a move, and coming off the line for one
    // anyway is how the whole field ends up chasing nothing. A chaser counts
    // whether or not it is catching — ten metres back is close enough to be
    // worth not sitting on the kerb in front of.
    const closing = Math.hypot(other.vx, other.vy) < speed
    if (closing && ds > 0 && ds < AI_SEE && (ahead === null || ds < ahead.ds)) ahead = { kart: other, ds }
    if (ds < 0 && ds > -AI_TAIL) chaser = true
  }
  // Which side, and whether either is worth it. A candidate is this kart's own
  // line moved a share of the corridor across, scored on the room it leaves —
  // clearance past the kart being passed, or plain road when there is only
  // somebody behind — plus what the detour is worth round the bend ahead, the
  // inside being the short way. Scored off the clamped lane, so a move the road
  // would truncate scores as no move at all, and under AI_WORTH neither side is
  // worth leaving the line for. With only a chaser the kart yields rather than
  // defends: `room - |lane|` peaks in the middle of the road, so it comes off
  // the kerb instead of onto the inside. Turning that into a block was tried
  // three ways and every one cost more in lap time and off-road than the places
  // it saved.
  const across = AI_INTENT * room
  const base = lineAt(aim) * kart.offset
  const score = (dir) => {
    const lane = base + dir * across
    if (Math.abs(lane) > room) return -Infinity
    return (ahead ? Math.abs(lane - ahead.kart.lat) : room - Math.abs(lane)) + dir * across * bend
  }
  const dir = ahead || chaser ? (score(1) >= score(-1) ? 1 : -1) : 0
  const off = dir !== 0 && score(dir) >= AI_WORTH ? dir * across : 0
  // Nobody worth moving for, and it goes back to its own line over about a
  // second rather than snapping onto it.
  if (off === 0) kart.intent *= damp(1, dt)
  else kart.intent += clamp(off - kart.intent, -AI_INTENT_RATE * dt, AI_INTENT_RATE * dt)
  // clamp() passes a NaN straight through — both of its comparisons are false —
  // and this one accumulates, so a single bad value off a snapshot would leave
  // the kart with no steering bit set at all and drive it off the map, quietly,
  // with a finite x and y the whole way.
  if (!Number.isFinite(kart.intent)) kart.intent = 0
  // Off the road already: steer at the middle of it, not at a line that sits a
  // couple of metres inside the far kerb. Shoved onto the grass with only that
  // to aim at, a kart ground along outside the tarmac for whole corners rather
  // than coming back onto it. A drop coming up pulls it in as well — they still
  // go over when they are shoved, it just is not their default line.
  const shy = Math.abs(kart.lat) > halfWidthAt(kart.s) ? 0 : overVoid(aim) || overVoid(kart.s) ? 0.4 : 1
  // This kart's share of the racing line, and whatever it currently wants to be
  // doing about the traffic. The clamp is what keeps either from putting a kart
  // somewhere there is no road.
  const lane = clamp(base + kart.intent, -room, room) * shy
  const tx = p.x + p.nx * lane
  const ty = p.y + p.ny * lane
  const want = Math.atan2(ty - kart.y, tx - kart.x)
  const err = wrap(want - kart.heading)
  // Mid-drift the wheel is a trim, not a steering input, and leaving it centred
  // is a slower turn than the corner asked for — so there is no deadband while
  // one is lit: it is either tightening the line or opening it out.
  const dead = kart.driftDir === 0 ? 0.05 : 0
  if (err > dead) bits |= IN_RIGHT
  else if (err < -dead) bits |= IN_LEFT
  // Mini-turbos, but only where a drift can actually hold the line. A drift
  // always turns — DRIFT_OPEN is the slowest it will go and it is still a turn
  // — so held through anything gentler than that it spirals in and ends on the
  // inside grass, which is where nearly every off it ever had came from. Speed
  // times bend is the turn rate the corner is asking for; drift when the corner
  // wants more than the open trim gives, and let go when it does not. And only
  // while there is still road on the inside to spend, on a road with somewhere
  // better to put the kart: a drift only ever turns one way, so one held by a
  // kart already inside its line keeps tightening until it runs out of tarmac,
  // but dropping it mid-hairpin where the tarmac is nine metres to a side just
  // parks the kart somewhere worse.
  const cut = Math.sign(bend) * (kart.lat - lineAt(kart.s))
  if (
    speed * Math.abs(bend) > AI_DRIFT_TURN &&
    speed > DRIFT_MIN_SPEED + 4 &&
    (cut < AI_DRIFT_CUT || halfWidthAt(kart.s) < AI_DRIFT_ROOM)
  ) {
    bits |= IN_DRIFT
    // The direction is locked off the wheel on the tick the button goes down,
    // so on that tick the wheel has to be over the way the corner goes — the
    // steering error can easily be pointing the other way on the approach.
    if (kart.driftDir === 0) {
      bits &= ~(IN_LEFT | IN_RIGHT)
      bits |= bend > 0 ? IN_RIGHT : IN_LEFT
    }
  }

  if (kart.item !== null) {
    kart.aiHold += dt
    // On the clock, deliberately. Holding a shell until there was a target and
    // a peel until there was a chaser read as the smarter thing and measured as
    // the worse one: a kart sitting on an item cannot pick a box up, so the
    // whole field cycled fewer of them and landed fewer hits.
    if (kart.aiHold > AI_ITEM_DELAY) {
      bits |= IN_ITEM
      kart.aiHold = 0
    }
  } else {
    kart.aiHold = 0
  }
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
    nums.push(k.x, k.y, k.vx, k.vy, k.heading, k.prog, k.place, k.item ?? -1, k.itemCount, k.spin, k.grace, k.driftTime, k.driftDir, k.boost, k.star, k.shrink, k.respawn, k.air, k.mega, k.bullet, k.ink, k.cloud, k.lat, k.offset, k.intent)
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
