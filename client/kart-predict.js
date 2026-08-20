// Own-kart prediction for a peer in a room.
//
// A peer renders the world INTERP_DELAY in the past and lerps between snapshots,
// which is invisible for the five karts it does not control and unplayable for
// the one it does. The fix is not more messages: the simulation is deterministic
// and was already shipped to every peer, so a peer can run it locally from its
// own keys and draw its own kart from that with no delay at all. The other karts
// stay on the interpolated view — nobody can feel a rival being a tenth of a
// second out of date.
//
// Lives apart from kart.js so it can be tested against the real sim without a
// browser: everything here is a pure function of a state and a snapshot.

import { boxSpots } from '../shared/kart.js'

// How far the local sim may disagree with the host before the disagreement is
// taken all at once. Under this it is eased over, so ordinary drift reads as
// drift; over it, something happened the peer could not have known about — a
// shove, a shell, a pad someone else set off — and easing only makes the kart
// wrong for longer.
export const PREDICT_SNAP = 2
// How much of a smaller disagreement is taken per snapshot, so a correction is
// spread across a few of them rather than landing as a twitch.
export const PREDICT_PULL = 0.25

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * Point the local sim back at the host's latest word. Everything except our own
 * kart is taken as read, since none of it is ever drawn from here. Our own kart
 * is eased towards the host's version rather than replaced, so a disagreement
 * inside PREDICT_SNAP reads as a drift instead of a twitch.
 *
 * `pred` is the previous local sim, or null on the first snapshot.
 */
export function resyncPrediction(pred, snap, myId) {
  // Boxes travel as bare cooldowns — the positions never move, so they are
  // worked out from the track rather than sent — and the sim wants them whole.
  const spots = boxSpots()
  const fresh = {
    ...snap,
    boxes: snap.boxes.map((cooldown, i) => ({ ...spots[i], cooldown })),
    karts: snap.karts.map((k) => ({ ...k })),
  }
  const mine = pred?.karts.find((k) => k.id === myId)
  const truth = fresh.karts.find((k) => k.id === myId)
  // Being fished out is the host's call, and a respawn is not a disagreement to
  // be eased over: it is a fact about where the kart now is.
  if (mine && truth && truth.respawn === 0 && mine.respawn === 0) {
    const gap = Math.hypot(mine.x - truth.x, mine.y - truth.y)
    if (gap <= PREDICT_SNAP) {
      truth.x = lerp(mine.x, truth.x, PREDICT_PULL)
      truth.y = lerp(mine.y, truth.y, PREDICT_PULL)
      truth.heading = lerpAngle(mine.heading, truth.heading, PREDICT_PULL)
    }
  }
  return fresh
}

/**
 * The interpolated view, with our own kart moved to where the local sim says it
 * has got to by now. Only the fields that carry motion: everything discrete —
 * the item in hand, the boost left, the place — stays the host's word for it.
 */
export function withPrediction(view, pred, myId) {
  const mine = pred?.karts.find((k) => k.id === myId)
  // A kart mid-rescue is being flown back to the road by an animation of its
  // own, so it is left exactly where it was put.
  if (!mine || mine.respawn > 0) return view
  return {
    ...view,
    karts: view.karts.map((k) =>
      k.id === myId
        ? { ...k, x: mine.x, y: mine.y, heading: mine.heading, vx: mine.vx, vy: mine.vy, s: mine.s }
        : k,
    ),
  }
}
