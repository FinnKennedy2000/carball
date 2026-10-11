// Procedural WebAudio for the whole game. No asset files.
// Graph: buses (sfx/music/crowd) -> [dry + reverb send] -> master -> compressor -> out.
import {
  DEFAULT_ARENA, clamp, fin, engineParams, estimateThrottle, crowdIntensity,
  quatAxes, pullToward, ballBounce, hitShape, hypot3,
} from './helpers.js'
import { createMusic } from './music.js'

let ARENA = DEFAULT_ARENA
// Optional: arena dims come from shared/arena.js once the sim provides it.
const arenaPath = '../../shared/arena.js'
import(/* @vite-ignore */ arenaPath).then((m) => { if (m?.ARENA) ARENA = m.ARENA }).catch(() => {})

const MAX_VOICES = 6
const AXES = { f: [0, 0, -1], u: [0, 1, 0] }
const CAM = [0, 0, 0]
const TMP = [0, 0, 0]
const EP = {}

export function createAudio() {
  let ctx = null
  let g = null // graph nodes, built on unlock
  const vol = { master: 0.8, sfx: 1, music: 0.6, crowd: 0.8 }
  let wantMusic = false
  const voices = new Map() // car id -> voice
  let prevBall = null
  let lastBounceAt = 0
  let nextMurmur = 0
  let crowdLevel = 0
  let lastTime = 0

  const live = () => ctx && ctx.state === 'running' && g

  // ---------- building blocks ----------
  function noiseBuffer(sec, pink) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec | 0, ctx.sampleRate)
    const d = b.getChannelData(0)
    let l = 0
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1
      l = pink ? l * 0.97 + w * 0.2 : w
      d[i] = l * (pink ? 1.6 : 1)
    }
    return b
  }
  function impulse(sec, decay) {
    const n = ctx.sampleRate * sec | 0
    const b = ctx.createBuffer(2, n, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c)
      let lp = 0
      for (let i = 0; i < n; i++) {
        const t = i / n
        lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.8 * t) // darker as it decays
        d[i] = lp * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1)
      }
    }
    return b
  }
  function bus(send) {
    const inp = ctx.createGain()
    const dry = ctx.createGain()
    const snd = ctx.createGain()
    snd.gain.value = send
    inp.connect(dry).connect(g.master)
    inp.connect(snd).connect(g.verb)
    return inp
  }
  function build() {
    g = {}
    g.master = ctx.createGain()
    g.master.gain.value = vol.master
    g.comp = ctx.createDynamicsCompressor()
    g.comp.threshold.value = -14
    g.comp.knee.value = 12
    g.comp.ratio.value = 6
    g.comp.attack.value = 0.004
    g.comp.release.value = 0.2
    const lim = ctx.createDynamicsCompressor() // brickwall-ish limiter
    lim.threshold.value = -2
    lim.knee.value = 0
    lim.ratio.value = 20
    lim.attack.value = 0.001
    lim.release.value = 0.08
    g.master.connect(g.comp).connect(lim).connect(ctx.destination)
    g.verb = ctx.createConvolver()
    g.verb.buffer = impulse(2.6, 3)
    const vr = ctx.createGain()
    vr.gain.value = 0.5
    g.verb.connect(vr).connect(g.master)
    g.sfx = bus(0.18);
    g.music = bus(0.12)
    g.crowd = bus(0.3)
    // gain wrappers so setVolume can trim each bus independently
    for (const k of ['sfx', 'music', 'crowd']) g[k].gain.value = vol[k]
    g.noise = noiseBuffer(3, false)
    g.pink = noiseBuffer(4, true)
    g.curve = (() => {
      const c = new Float32Array(1024)
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 3.2) }
      return c
    })()
    g.dist = (() => {
      const c = new Float32Array(1024)
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.4) }
      return c
    })()
    buildCrowd()
    g.musicPlayer = createMusic(ctx, g.music)
    if (wantMusic) g.musicPlayer.start()
  }

  const T = () => ctx.currentTime
  const setP = (p, v, tc = 0.05) => p.setTargetAtTime(fin(v), T(), tc)

  // One-shot oscillator with pitch glide + gain envelope.
  function tone(dest, { type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.3, attack = 0.003, delay = 0, detune = 0 }) {
    const t = T() + delay
    const o = ctx.createOscillator()
    const e = ctx.createGain()
    o.type = type
    o.detune.value = detune
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    e.gain.setValueAtTime(0.0001, t)
    e.gain.linearRampToValueAtTime(gain, t + attack)
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(e).connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
    o.onended = () => e.disconnect()
    return e
  }
  // One-shot filtered noise burst.
  function burst(dest, { dur = 0.2, f0 = 1000, f1 = f0, q = 1, type = 'bandpass', gain = 0.3, attack = 0.005, delay = 0, pink = false, shape = null }) {
    const t = T() + delay
    const s = ctx.createBufferSource()
    s.buffer = pink ? g.pink : g.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const e = ctx.createGain()
    e.gain.setValueAtTime(0.0001, t)
    e.gain.linearRampToValueAtTime(gain, t + attack)
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f)
    let last = f
    if (shape) { const w = ctx.createWaveShaper(); w.curve = shape; f.connect(w); last = w }
    last.connect(e).connect(dest)
    s.start(t, Math.random() * 2)
    s.stop(t + dur + 0.05)
    s.onended = () => e.disconnect()
  }
  // A destination at a world position (disposable panner), or the bus itself.
  function at(p, own) {
    if (!p) return g.sfx
    const pn = makePanner(ctx.createPanner())
    if (own) pullToward(p, CAM, 0.3, TMP); else { TMP[0] = p[0]; TMP[1] = p[1]; TMP[2] = p[2] }
    setPos(pn, TMP)
    pn.connect(g.sfx)
    setTimeout(() => pn.disconnect(), 4000)
    return pn
  }
  function makePanner(pn) {
    pn.panningModel = 'HRTF'
    pn.distanceModel = 'inverse'
    pn.refDistance = 8
    pn.rolloffFactor = 1.1
    pn.maxDistance = 400
    return pn
  }
  function setPos(pn, p) {
    if (pn.positionX) { pn.positionX.value = fin(p[0]); pn.positionY.value = fin(p[1]); pn.positionZ.value = fin(p[2]) }
    else pn.setPosition(fin(p[0]), fin(p[1]), fin(p[2]))
  }

  // ---------- crowd ----------
  function buildCrowd() {
    const c = (buf, type, f, q, gain) => {
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.loop = true
      const fl = ctx.createBiquadFilter()
      fl.type = type; fl.frequency.value = f; fl.Q.value = q
      const gn = ctx.createGain()
      gn.gain.value = gain
      s.connect(fl).connect(gn).connect(g.crowd)
      s.start(0, Math.random() * 3)
      return { gn, fl }
    }
    g.bed = c(g.pink, 'lowpass', 700, 0.5, 0.0)
    g.mid = c(g.noise, 'bandpass', 1100, 0.6, 0.0)
    g.hiss = c(g.noise, 'highpass', 4500, 0.4, 0.0)
    // lone-voice "murmur" layer, wobbled from update()
    g.mur = c(g.pink, 'bandpass', 480, 2.5, 0.0)
  }
  function crowdUpdate(state, dt) {
    const now = T()
    const target = state.ball ? crowdIntensity(state.ball.p, state.ball.v, ARENA) : 0.15
    crowdLevel += (target - crowdLevel) * clamp(dt * 1.5)
    const ot = state.overtime ? 0.1 : 0
    const lv = crowdLevel + ot
    const play = state.phase === 'pregame' ? 0.5 : 1
    setP(g.bed.gn.gain, (0.12 + 0.35 * lv) * play, 0.3)
    setP(g.mid.gn.gain, (0.02 + 0.22 * lv * lv) * play, 0.3)
    setP(g.mid.fl.frequency, 800 + 900 * lv, 0.3)
    setP(g.hiss.gn.gain, 0.012 + 0.07 * lv * lv, 0.3)
    if (now > nextMurmur) {
      nextMurmur = now + 0.4 + Math.random() * 1.4
      setP(g.mur.gn.gain, Math.random() * 0.14 * (0.4 + lv), 0.25)
      setP(g.mur.fl.frequency, 350 + Math.random() * 500, 0.25)
    }
  }
  function swell(peak, dur, f0, f1, rise = 0.25) {
    // crowd roar/ohh: noise through a moving bandpass with a slow attack and long tail
    burst(g.crowd, { dur, f0, f1, q: 0.7, gain: peak, attack: rise, pink: true })
    burst(g.crowd, { dur: dur * 0.9, f0: f0 * 1.9, f1: f1 * 1.6, q: 1, gain: peak * 0.5, attack: rise * 1.2 })
  }

  // ---------- voices ----------
  function newVoice(id) {
    const v = {
      id, boostOn: false, prevSpeed: 0, throttle: 0.3, seen: 0, fade: 1, pn: makePanner(ctx.createPanner()),
      oscs: [], pg: ctx.createGain(),
    }
    v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.Q.value = 3
    v.ws = ctx.createWaveShaper(); v.ws.curve = g.curve
    v.out = ctx.createGain(); v.out.gain.value = 0
    const mk = (type, mul, gain) => {
      const o = ctx.createOscillator(); o.type = type
      const gn = ctx.createGain(); gn.gain.value = gain
      o.connect(gn).connect(v.lp); o.start()
      v.oscs.push({ o, mul })
    }
    mk('sawtooth', 1, 0.5); mk('sawtooth', 1.007, 0.4); mk('square', 0.5, 0.45); mk('sawtooth', 2.01, 0.12)
    v.lp.connect(v.ws).connect(v.out).connect(v.pn)
    v.pn.connect(g.sfx)
    // boost burner
    v.bs = ctx.createBufferSource(); v.bs.buffer = g.pink; v.bs.loop = true
    v.bf = ctx.createBiquadFilter(); v.bf.type = 'bandpass'; v.bf.Q.value = 0.8; v.bf.frequency.value = 600
    v.bg = ctx.createGain(); v.bg.gain.value = 0
    v.bs.connect(v.bf).connect(v.bg).connect(v.pn)
    v.bs.start(0, Math.random() * 3)
    return v
  }
  function killVoice(v) {
    for (const x of v.oscs) { try { x.o.stop() } catch { /* already stopped */ } }
    try { v.bs.stop() } catch { /* already stopped */ }
    v.pn.disconnect(); v.out.disconnect()
  }
  function updateVoice(v, car, own, dt, nowT) {
    const speed = hypot3(car.v)
    const thr = estimateThrottle(v.prevSpeed, speed, dt, car.boosting)
    v.throttle += (thr - v.throttle) * clamp(dt * 6)
    v.prevSpeed = speed
    const air = !car.onGround && !car.onWall
    engineParams(speed, air ? v.throttle * 0.4 : v.throttle, car.boosting, EP)
    for (const x of v.oscs) setP(x.o.frequency, EP.freq * x.mul, 0.04)
    setP(v.lp.frequency, EP.cutoff, 0.05)
    const dead = car.demolished > 0
    v.fade += ((dead ? 0 : 1) - v.fade) * clamp(dt * 8)
    setP(v.out.gain, EP.gain * v.fade * (own ? 1.25 : 0.9), 0.05)
    // boost burner
    const b = !!car.boosting && !dead
    if (b && !v.boostOn) boostIgnite(car.p, own)
    v.boostOn = b
    setP(v.bg.gain, b ? 0.5 : 0, b ? 0.04 : 0.12)
    setP(v.bf.frequency, 500 + speed * 18, 0.1)
    // position (own car pulled toward the listener)
    if (own) pullToward(car.p, CAM, 0.3, TMP); else { TMP[0] = car.p[0]; TMP[1] = car.p[1]; TMP[2] = car.p[2] }
    setPos(v.pn, TMP)
  }
  function boostIgnite(p, own) {
    const d = at(p, own)
    burst(d, { dur: 0.45, f0: 400, f1: 3200, q: 0.9, gain: 0.35, attack: 0.02, pink: true })
    tone(d, { type: 'sawtooth', f0: 90, f1: 220, dur: 0.3, gain: 0.12 })
  }

  // ---------- update ----------
  function update(state, myId, camera) {
    if (!live() || !state) return
    const now = T()
    const dt = clamp(now - lastTime, 0.001, 0.1)
    lastTime = now
    // listener = camera
    const L = ctx.listener
    if (camera?.position && camera.quaternion) {
      CAM[0] = camera.position.x; CAM[1] = camera.position.y; CAM[2] = camera.position.z
      const q = camera.quaternion
      quatAxes([q.x, q.y, q.z, q.w], AXES)
      if (L.positionX) {
        L.positionX.value = CAM[0]; L.positionY.value = CAM[1]; L.positionZ.value = CAM[2]
        L.forwardX.value = AXES.f[0]; L.forwardY.value = AXES.f[1]; L.forwardZ.value = AXES.f[2]
        L.upX.value = AXES.u[0]; L.upY.value = AXES.u[1]; L.upZ.value = AXES.u[2]
      } else {
        L.setPosition(CAM[0], CAM[1], CAM[2])
        L.setOrientation(AXES.f[0], AXES.f[1], AXES.f[2], AXES.u[0], AXES.u[1], AXES.u[2])
      }
    }
    const cars = state.cars || []
    const active = state.phase === 'play' || state.phase === 'countdown' || state.phase === 'goal'
    // engines: cap at MAX_VOICES, own car first, then nearest
    for (const v of voices.values()) v.seen = 0
    let n = 0
    const own = cars.find((c) => c.id === myId)
    if (own) { n += touch(own, true, dt, now, active) }
    for (let i = 0; i < cars.length && n < MAX_VOICES; i++) {
      if (cars[i] !== own) n += touch(cars[i], false, dt, now, active)
    }
    for (const [id, v] of voices) {
      if (!v.seen) { killVoice(v); voices.delete(id) }
    }
    crowdUpdate(state, dt)
    ballTrack(state)
  }
  function touch(car, isOwn, dt, now, active) {
    let v = voices.get(car.id)
    if (!v) { v = newVoice(car.id); voices.set(car.id, v) }
    v.seen = 1
    if (!active) { setP(v.out.gain, 0, 0.1); setP(v.bg.gain, 0, 0.1); return 1 }
    updateVoice(v, car, isOwn, dt, now)
    return 1
  }
  function ballTrack(state) {
    const b = state.ball
    if (!b) { prevBall = null; return }
    if (prevBall) {
      const s = ballBounce(b.p, prevBall.v, b.v, ARENA)
      const now = T()
      if (s > 0.12 && now - lastBounceAt > 0.12) {
        lastBounceAt = now
        const sh = hitShape(s * 0.6)
        const d = at(b.p)
        tone(d, { f0: 150 * sh.pitch, f1: 55, dur: 0.18, gain: 0.35 * sh.gain })
        burst(d, { dur: 0.05, f0: 2500, q: 0.8, gain: 0.12 * sh.gain })
      }
    } else prevBall = { v: [0, 0, 0] }
    prevBall.v[0] = b.v[0]; prevBall.v[1] = b.v[1]; prevBall.v[2] = b.v[2]
  }

  // ---------- events ----------
  function carPos(state, id) {
    const c = state?.cars?.find((x) => x.id === id)
    return c ? c.p : null
  }
  function onEvent(e, state, myId) {
    if (!live() || !e) return
    try { handle(e, state, myId) } catch (err) { console.warn('[audio]', e.type, err) }
  }
  function handle(e, state, myId) {
    const own = e.carId === myId
    switch (e.type) {
      case 'countdown':
        if (e.n > 0) tone(g.sfx, { type: 'square', f0: 440, dur: 0.16, gain: 0.18 })
        else {
          tone(g.sfx, { type: 'square', f0: 880, dur: 0.6, gain: 0.2 })
          tone(g.sfx, { type: 'sawtooth', f0: 1320, dur: 0.6, gain: 0.08, detune: 6 })
        }
        break
      case 'kickoff': whistle(); break
      case 'hit': {
        const sh = hitShape(e.strength)
        const d = at(e.p || carPos(state, e.carId), false)
        tone(d, { f0: 190 * sh.pitch, f1: 45, dur: 0.22 + 0.15 * e.strength, gain: 0.55 * sh.gain })
        tone(d, { type: 'triangle', f0: 420 * sh.pitch, f1: 120, dur: 0.1, gain: 0.2 * sh.gain })
        burst(d, { dur: 0.06, f0: 2200 + Math.random() * 1200, q: 0.7, gain: 0.35 * sh.gain })
        if (e.strength > 0.6) burst(g.crowd, { dur: 0.9, f0: 900, f1: 500, gain: 0.12 * e.strength, attack: 0.1, pink: true })
        break
      }
      case 'jump': {
        const d = at(carPos(state, e.carId), own)
        burst(d, { dur: 0.14, f0: 1800, f1: 600, q: 1.2, gain: 0.3 })
        tone(d, { f0: 200, f1: 90, dur: 0.1, gain: 0.15 })
        break
      }
      case 'dodge': {
        const d = at(carPos(state, e.carId), own)
        burst(d, { dur: 0.35, f0: 500, f1: 4000, q: 1.5, gain: 0.35, attack: 0.08, pink: true })
        burst(d, { dur: 0.2, f0: 3500, f1: 800, q: 1, gain: 0.15, delay: 0.1 })
        break
      }
      case 'land': {
        const d = at(carPos(state, e.carId), own)
        tone(d, { f0: 110, f1: 40, dur: 0.18, gain: 0.45 })
        burst(d, { dur: 0.1, f0: 400, type: 'lowpass', q: 0.5, gain: 0.3 })
        break
      }
      case 'bump': {
        const s = clamp(e.strength)
        const d = at(carPos(state, e.carId), own)
        burst(d, { dur: 0.18, f0: 1500, f1: 400, q: 4, gain: 0.3 * (0.4 + s), shape: g.dist })
        tone(d, { type: 'square', f0: 260, f1: 90, dur: 0.12, gain: 0.15 * (0.4 + s) })
        tone(d, { type: 'square', f0: 1700, f1: 1300, dur: 0.07, gain: 0.05 * s, delay: 0.03 })
        break
      }
      case 'demo': demo(e.p || carPos(state, e.victimId)); break
      case 'boostPickup': {
        const d = at(carPos(state, e.carId), own)
        const big = e.big
        const base = big ? 523.25 : 880
        const notes = big ? [1, 1.25, 1.5, 2] : [1, 1.5]
        notes.forEach((m, i) => {
          tone(d, { type: 'sine', f0: base * m, dur: big ? 0.5 : 0.22, gain: big ? 0.2 : 0.14, delay: i * (big ? 0.06 : 0.05) })
          tone(d, { type: 'triangle', f0: base * m * 2, dur: 0.18, gain: 0.05, delay: i * 0.05 })
        })
        if (big) burst(d, { dur: 0.4, f0: 1000, f1: 5000, q: 1, gain: 0.12, pink: true })
        break
      }
      case 'supersonic': {
        const d = at(carPos(state, e.carId), own)
        for (let i = 0; i < 5; i++) tone(d, { f0: 1500 * Math.pow(1.26, i), f1: 2200 * Math.pow(1.26, i), dur: 0.9, gain: 0.04, attack: 0.15, detune: i * 7 })
        burst(d, { dur: 0.9, f0: 3000, f1: 9000, q: 3, gain: 0.1, attack: 0.2 })
        break
      }
      case 'shot': burst(g.crowd, { dur: 0.7, f0: 700, f1: 1100, gain: 0.1, attack: 0.1, pink: true }); break
      case 'save':
        swell(0.3, 2.0, 500, 330, 0.45)
        tone(g.crowd, { type: 'sine', f0: 330, f1: 280, dur: 1.2, gain: 0.02, attack: 0.4 })
        break
      case 'goal': goal(e); break
      case 'overtime': overtime(); break
      case 'matchOver':
        swell(0.4, 4, 700, 400, 0.4)
        ;[0, 0.18, 0.36, 0.6].forEach((t, i) => tone(g.sfx, { type: 'sawtooth', f0: 261.6 * [1, 1.25, 1.5, 2][i], dur: i === 3 ? 1.6 : 0.4, gain: 0.12, delay: t }))
        break
    }
  }
  function whistle() {
    const t = T()
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2950
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 3010
    const trem = ctx.createOscillator(); trem.frequency.value = 38
    const tg = ctx.createGain(); tg.gain.value = 0.35
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t)
    e.gain.linearRampToValueAtTime(0.28, t + 0.03)
    e.gain.setValueAtTime(0.28, t + 0.5)
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.62)
    const am = ctx.createGain(); am.gain.value = 0.65
    trem.connect(tg).connect(am.gain)
    o.connect(am); o2.connect(am); am.connect(e).connect(g.sfx)
    ;[o, o2, trem].forEach((n) => { n.start(t); n.stop(t + 0.7) })
    burst(g.sfx, { dur: 0.6, f0: 3200, q: 4, gain: 0.05, pink: false })
  }
  function demo(p) {
    const d = at(p)
    tone(d, { f0: 90, f1: 28, dur: 1.2, gain: 0.9 })
    burst(d, { dur: 0.9, f0: 1800, f1: 120, q: 0.6, gain: 0.7, attack: 0.004, shape: g.dist, type: 'lowpass' })
    burst(d, { dur: 0.25, f0: 5000, q: 0.5, gain: 0.35, type: 'highpass' })
    for (let i = 0; i < 9; i++) {
      burst(d, { dur: 0.05 + Math.random() * 0.05, f0: 1500 + Math.random() * 4000, q: 6, gain: 0.12, delay: 0.15 + i * 0.07 + Math.random() * 0.05 })
    }
    burst(g.crowd, { dur: 1.2, f0: 800, f1: 500, gain: 0.12, attack: 0.1, pink: true })
  }
  function goal(e) {
    // brass-ish horn: detuned saw stack through a swelling lowpass, two blasts
    const base = [196, 246.9, 293.7]
    for (const [i, delay] of [[0, 0], [1, 0.95]]) {
      const t = T() + delay + 0.05
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2
      lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2400, t + 0.18)
      const e2 = ctx.createGain()
      const len = i === 0 ? 0.85 : 1.9
      e2.gain.setValueAtTime(0.0001, t); e2.gain.linearRampToValueAtTime(0.16, t + 0.06)
      e2.gain.setValueAtTime(0.16, t + len - 0.2); e2.gain.exponentialRampToValueAtTime(0.0001, t + len)
      lp.connect(e2).connect(g.sfx)
      for (const f of base) for (const dt of [-9, 0, 11]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (i ? 1.0 : 1); o.detune.value = dt
        o.connect(lp); o.start(t); o.stop(t + len + 0.05)
      }
      setTimeout(() => e2.disconnect(), (delay + len + 0.3) * 1000)
    }
    swell(0.8, 4.2, 600, 450, 0.3)
    burst(g.crowd, { dur: 3.6, f0: 2500, f1: 1800, q: 0.5, gain: 0.3, attack: 0.35 })
    crowdLevel = 1
  }
  function overtime() {
    // low rising drone + heartbeat pulses
    tone(g.sfx, { type: 'sawtooth', f0: 55, f1: 110, dur: 3, gain: 0.12, attack: 1.2 })
    for (let i = 0; i < 4; i++) { tone(g.sfx, { f0: 70, f1: 40, dur: 0.25, gain: 0.5, delay: i * 0.6 }); tone(g.sfx, { f0: 70, f1: 40, dur: 0.2, gain: 0.3, delay: i * 0.6 + 0.2 }) }
    swell(0.25, 3, 400, 700, 1.2)
  }

  // ---------- UI ----------
  function playUi(kind) {
    if (!live()) return
    switch (kind) {
      case 'hover': tone(g.sfx, { type: 'triangle', f0: 1800, dur: 0.04, gain: 0.05, attack: 0.001 }); break
      case 'click':
        tone(g.sfx, { type: 'square', f0: 700, f1: 500, dur: 0.07, gain: 0.07, attack: 0.001 })
        tone(g.sfx, { type: 'sine', f0: 1400, dur: 0.1, gain: 0.08, delay: 0.02 })
        break
      case 'back':
        tone(g.sfx, { type: 'triangle', f0: 600, f1: 330, dur: 0.12, gain: 0.1 })
        break
      case 'start':
        ;[0, 0.07, 0.14].forEach((t, i) => tone(g.sfx, { type: 'sawtooth', f0: 330 * [1, 1.5, 2][i], dur: 0.35, gain: 0.08, delay: t }))
        burst(g.sfx, { dur: 0.5, f0: 500, f1: 5000, q: 1, gain: 0.12, attack: 0.1, pink: true })
        break
    }
  }

  // ---------- public ----------
  function unlock() {
    try {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext
        if (!AC) return
        ctx = new AC({ latencyHint: 'interactive' })
        build()
      }
      if (ctx.state !== 'running') ctx.resume().catch(() => {})
    } catch (err) { console.warn('[audio] unlock failed', err) }
  }
  function setVolume(v = {}) {
    for (const k of ['master', 'sfx', 'music', 'crowd']) if (Number.isFinite(v[k])) vol[k] = clamp(v[k])
    if (!g) return
    setP(g.master.gain, vol.master, 0.03)
    for (const k of ['sfx', 'music', 'crowd']) setP(g[k].gain, vol[k], 0.03)
  }
  function setMusic(on) {
    wantMusic = !!on
    if (g?.musicPlayer) wantMusic ? g.musicPlayer.start() : g.musicPlayer.stop()
  }

  return { unlock, update, onEvent, playUi, setVolume, setMusic }
}
