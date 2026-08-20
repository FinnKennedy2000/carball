// A peer predicting its own kart. The point of the exercise is a number: how
// far from the truth the kart you are steering appears to be, with prediction
// against without. Everything here drives the real sim, so a change to the
// physics that breaks prediction shows up as this test failing.

import test from 'node:test'
import assert from 'node:assert/strict'
import { IN_FWD, IN_LEFT, TICK_HZ, SNAPSHOT_HZ } from '../shared/constants.js'
import { createRace, begin, step, setTrack, DEFAULT_TRACK } from '../shared/kart.js'
import { resyncPrediction, withPrediction, PREDICT_SNAP } from '../client/kart-predict.js'

const ME = 1
// One way over Realtime. 60ms each way is a poor-but-real connection.
const LAG_TICKS = Math.round(0.06 * TICK_HZ)
const PER_SNAP = TICK_HZ / SNAPSHOT_HZ // ticks between snapshots

const snapshotOf = (state) => JSON.parse(JSON.stringify({ ...state, boxes: state.boxes.map((b) => b.cooldown) }))
const mine = (state) => state.karts.find((k) => k.id === ME)
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Run a room for `ticks`, with the peer's keys arriving at the host LAG_TICKS
 * late and the host's snapshots arriving back LAG_TICKS after they are sent.
 * `keysAt` is what the player is holding on a given tick.
 */
function room(ticks, keysAt) {
  setTrack(DEFAULT_TRACK)
  const racers = [
    { id: ME, name: 'me', ai: false },
    ...[2, 3, 4, 5, 6].map((id) => ({ id, name: `ai${id}`, ai: true })),
  ]
  const host = createRace(racers, 11)
  begin(host)

  let pred = null
  const inFlight = [] // snapshots on their way to the peer
  let landed = null // the newest snapshot the peer has
  const held = [] // the peer's keys, as the host will eventually see them
  const worst = { predicted: 0, raw: 0 }

  for (let tick = 0; tick < ticks; tick++) {
    const keys = keysAt(tick)
    held.push(keys)

    // The host applies what has reached it, which is LAG_TICKS behind.
    const arrived = held[Math.max(0, tick - LAG_TICKS)]
    step(host, { [ME]: arrived })

    if (tick % PER_SNAP === 0) inFlight.push({ at: tick + LAG_TICKS, s: snapshotOf(host) })
    while (inFlight.length && inFlight[0].at <= tick) landed = inFlight.shift().s

    if (!landed) continue

    // The peer: resync off each new snapshot, then run its own keys forward.
    if (!pred || pred.tick !== landed.tick) {
      pred = resyncPrediction(pred, landed, ME)
      // Catch up the age of the snapshot in hand before this frame's own step.
      for (let i = 0; i < LAG_TICKS; i++) step(pred, { [ME]: keys })
    }
    step(pred, { [ME]: keys })

    // What the player would see with prediction, and what they see without it.
    const shown = withPrediction({ ...landed, karts: landed.karts.map((k) => ({ ...k })) }, pred, ME)
    worst.predicted = Math.max(worst.predicted, apart(mine(shown), mine(host)))
    worst.raw = Math.max(worst.raw, apart(landed.karts.find((k) => k.id === ME), mine(host)))
  }
  return worst
}

test('a peer predicting its own kart sees it closer to the truth than the host can tell it', () => {
  // Flat out in a straight line, which is most of a lap and the case where the
  // gap between "where I am" and "where I was told I am" is widest.
  const flat = room(360, () => IN_FWD)
  assert.ok(
    flat.predicted < flat.raw / 2,
    `prediction was worth little: ${flat.predicted.toFixed(2)}m vs ${flat.raw.toFixed(2)}m unpredicted`,
  )

  // Turning in and out, which is where a prediction is most likely to wander:
  // the heading compounds, so an error does not just sit there.
  const weaving = room(360, (t) => (Math.floor(t / 30) % 2 ? IN_FWD | IN_LEFT : IN_FWD))
  assert.ok(
    weaving.predicted < weaving.raw,
    `weaving lost the prediction: ${weaving.predicted.toFixed(2)}m vs ${weaving.raw.toFixed(2)}m`,
  )
  // And it stays a correction rather than becoming a divergence.
  assert.ok(weaving.predicted < PREDICT_SNAP, `prediction ran away: ${weaving.predicted.toFixed(2)}m`)
})

test('prediction never touches a kart the host is fishing out', () => {
  setTrack(DEFAULT_TRACK)
  const host = createRace([{ id: ME, name: 'me', ai: false }], 3)
  begin(host)
  const snap = snapshotOf(host)
  const pred = resyncPrediction(null, snap, ME)
  // Mid-rescue: the renderer flies it back on its own, so prediction stands off.
  pred.karts[0].respawn = 1.5
  pred.karts[0].x = 9999
  const view = { ...snap, karts: snap.karts.map((k) => ({ ...k })) }
  assert.equal(withPrediction(view, pred, ME).karts[0].x, view.karts[0].x)
})
