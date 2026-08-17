// Synthesised audio — no asset files. The client does not simulate, so every
// cue is inferred from consecutive snapshots: a jump in ball speed is a hit, a
// change in score is a goal, a draining meter is a boost.
//
// An AudioContext may only start from a user gesture, so init() is called from
// the lobby buttons rather than at load.

import * as C from './../shared/constants.js'

const HIT_MIN_DV = 4 // ignore rolling contact; only real impacts
const HIT_LOUD_DV = 45 // the speed change that counts as full volume

let ctx = null
let master = null
let boostGain = null
let muted = false

let prevScore = null
let prevBallSpeed = 0
let lastHitAt = 0

export function initSound() {
  if (ctx) return
  ctx = new (window.AudioContext ?? window.webkitAudioContext)()

  master = ctx.createGain()
  master.gain.value = 0.6
  master.connect(ctx.destination)

  // A single looping noise source, opened up by a gain envelope while boosting.
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(2)
  noise.loop = true
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 700
  band.Q.value = 0.7
  boostGain = ctx.createGain()
  boostGain.gain.value = 0
  noise.connect(band).connect(boostGain).connect(master)
  noise.start()

  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM') return
    muted = !muted
    master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.02)
  })
}

/** Called once per frame with the state the renderer is drawing. */
export function updateSound(state, localId) {
  if (!ctx) return

  if (prevScore && (state.score[0] !== prevScore[0] || state.score[1] !== prevScore[1])) horn()
  prevScore = state.score.slice()

  // Ball speed jumps on any impact — car, wall, or another car's shot.
  const speed = Math.hypot(state.ball.vx, state.ball.vy)
  const dv = Math.abs(speed - prevBallSpeed)
  prevBallSpeed = speed
  if (dv > HIT_MIN_DV && ctx.currentTime - lastHitAt > 0.06) {
    lastHitAt = ctx.currentTime
    thud(Math.min(1, dv / HIT_LOUD_DV))
  }

  const me = state.cars.find((c) => c.id === localId)
  const boosting = me ? me.boost > 0 && me.boost < C.BOOST_MAX : false
  boostGain.gain.setTargetAtTime(boosting ? 0.12 : 0, ctx.currentTime, 0.05)
}

/** Low, short body impact. Pitch drops with the hit so hard shots sound heavier. */
function thud(strength) {
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(180 - 60 * strength, t)
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.12)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.25 * strength + 0.05, t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)

  osc.connect(gain).connect(master)
  osc.start(t)
  osc.stop(t + 0.2)
}

/** Two-tone goal horn. */
function horn() {
  const t = ctx.currentTime
  for (const [i, freq] of [220, 330].entries()) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const gain = ctx.createGain()
    const at = t + i * 0.18
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02)
    gain.gain.setValueAtTime(0.16, at + 0.45)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.75)
    osc.connect(gain).connect(master)
    osc.start(at)
    osc.stop(at + 0.8)
  }
}

function noiseBuffer(seconds) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}
