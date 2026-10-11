// Menu music: 120 bpm, A minor, Am - F - C - G, 4 bars (32 eighth steps) looped on a
// lookahead clock so it never drifts or clicks. Everything routes through one fade gain.
const BPM = 120
const STEP = 60 / BPM / 2 // eighth note
const STEPS = 32
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)
// chord roots (MIDI) and triad intervals per bar
const BARS = [
  { root: 45, tri: [0, 3, 7] }, // Am
  { root: 41, tri: [0, 4, 7] }, // F
  { root: 48, tri: [0, 4, 7] }, // C
  { root: 43, tri: [0, 4, 7] }, // G
]
const ARP = [0, 2, 1, 2, 0, 2, 1, 2] // triad indices per bar-step, an octave up

export function createMusic(ctx, dest) {
  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(dest)
  const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const nd = nb.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  let timer = null
  let stopTimer = null
  let step = 0
  let next = 0

  const note = (type, f, t, dur, gain, cutoff, atk = 0.01) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff
    const e = ctx.createGain()
    e.gain.setValueAtTime(0.0001, t)
    e.gain.linearRampToValueAtTime(gain, t + atk)
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(lp).connect(e).connect(out)
    o.start(t); o.stop(t + dur + 0.05)
    o.onended = () => e.disconnect()
  }
  const kick = (t) => {
    const o = ctx.createOscillator(); const e = ctx.createGain()
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    e.gain.setValueAtTime(0.5, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    o.connect(e).connect(out); o.start(t); o.stop(t + 0.3)
    o.onended = () => e.disconnect()
  }
  const hat = (t, open, g) => {
    const s = ctx.createBufferSource(); s.buffer = nb
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500
    const e = ctx.createGain(); const d = open ? 0.12 : 0.035
    e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0001, t + d)
    s.connect(hp).connect(e).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02)
    s.onended = () => e.disconnect()
  }
  const snare = (t) => {
    const s = ctx.createBufferSource(); s.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8
    const e = ctx.createGain(); e.gain.setValueAtTime(0.16, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    s.connect(bp).connect(e).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + 0.2)
    s.onended = () => e.disconnect()
    note('triangle', 190, t, 0.08, 0.1, 2000)
  }

  function schedule(s, t) {
    const bar = BARS[(s >> 3) & 3]
    const k = s & 7
    if (k === 0) { // pad swell, whole bar, slightly detuned stacks
      for (const iv of bar.tri) for (const dt of [-0.1, 0.1]) {
        const f = mtof(bar.root + 12 + iv) * (1 + dt * 0.01)
        note('sawtooth', f, t, STEP * 8 + 0.4, 0.035, 900, 0.5)
      }
    }
    // bass: root on the beat, octave pop on the "and" of 2 and 4
    if (k % 2 === 0) note('sawtooth', mtof(bar.root - 12 + (k === 6 ? 12 : 0)), t, STEP * 1.6, 0.16, 420)
    // arp
    if (s >= 8) note('triangle', mtof(bar.root + 24 + bar.tri[ARP[k] % 3]), t, STEP * 1.5, 0.05, 3000, 0.005)
    // drums (light): kick on beats, hats on offbeats, snare on 2 & 4 from bar 2
    if (k % 2 === 0) kick(t)
    else hat(t, k === 7, 0.05)
    if (s >= 8 && (k === 2 || k === 6)) snare(t)
  }
  function tick() {
    while (next < ctx.currentTime + 0.25) {
      schedule(step, next)
      next += STEP
      step = (step + 1) % STEPS
    }
  }
  return {
    start() {
      clearTimeout(stopTimer)
      out.gain.cancelScheduledValues(ctx.currentTime)
      out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6)
      if (timer) return
      step = 0
      next = ctx.currentTime + 0.1
      timer = setInterval(tick, 25)
    },
    stop() {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
      clearTimeout(stopTimer)
      stopTimer = setTimeout(() => { clearInterval(timer); timer = null }, 2500)
    },
  }
}
