// The numbers the map screen puts on a card. Everything but CORNERS is
// measured off the loaded track at call time rather than typed in beside the
// geometry, because a number that is not derived from the road it describes
// drifts away from it — see docs/specs/2026-08-22-kart-themes-and-scenery.md.

import { TRACKS, setTrack, activeTrack, TRACK, halfWidthAt, heightAt, boxSpots, padSpots } from '../shared/kart.js'

/**
 * Corner count and tightest radius, one row per track. Read off the drawn
 * centreline in the design: what counts as a corner is a judgement call, and
 * the tightest radius comes from the design file, not from the sampled
 * spline — there is no way to recover either by measuring the road as built.
 * Everything else in a stats card is derived; these two numbers are carried
 * as data because they cannot be.
 */
export const CORNERS = {
  circuit: { corners: 11, tight: 33 },
  bayside: { corners: 6, tight: 85 },
  grove: { corners: 4, tight: 56 },
  foundry: { corners: 9, tight: 38 },
  cliff: { corners: 9, tight: 26 },
  fracture: { corners: 14, tight: 19 },
}

/**
 * Run `fn` with `key` loaded as the sim's active track, then put back whatever
 * was loaded before. The sim keeps its track in module state, so this is the
 * honest way to ask about a road that is not the one a race is currently on;
 * it runs synchronously and restores in a `finally` so no frame — and no
 * thrown error — can leave the wrong track loaded behind it.
 */
export function withTrack(key, fn) {
  const prev = activeTrack()
  setTrack(key)
  try {
    return fn()
  } finally {
    setTrack(prev)
  }
}

/** The stats a map card shows for one track, measured off the loaded geometry. */
export function statsFor(key) {
  return withTrack(key, () => {
    const t = TRACKS[key]
    const widths = Array.from({ length: TRACK.pts.length }, (_, i) => halfWidthAt((i / TRACK.pts.length) * TRACK.length))
    const heights = Array.from({ length: TRACK.pts.length }, (_, i) => heightAt((i / TRACK.pts.length) * TRACK.length))
    return {
      // Rounded. The comments beside each track's nodes carry the design's own
      // length (2279/1380/1680/2020/2380/2720m), measured off the drawn
      // centreline; the spline through the nodes today lands up to 1.2m short
      // of that on five of the six tracks — 0.05% of a lap, not worth chasing,
      // but this is the measured number rather than the typed one.
      length: Math.round(TRACK.length),
      ...CORNERS[key],
      wmax: 2 * Math.max(...widths),
      wmin: 2 * Math.min(...widths),
      rise: Math.max(...heights) - Math.min(...heights),
      jumps: t.jumps.length,
      boxes: boxSpots().length,
      pads: padSpots().length,
      voids: t.voids.length,
    }
  })
}
