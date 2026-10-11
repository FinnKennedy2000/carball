// The channel is a trust boundary, in both directions: the host is a player's
// browser receiving from peers, and peers receive from a host they do not control.
// Everything off the wire is parsed here and returns a known-good value or null.
// Nothing in here throws. No imports on purpose: it must load in node tests and
// must not depend on the sim's tuning file.
//
// WIRE FORMAT
//   peer -> host  event 'peer':
//     {t:'hello', cid, name, team, body}
//     {t:'input', cid, seq, a:[thr,steer,pitch,yaw,roll] int8 -127..127, b:bitmask}
//         b: 1 jump, 2 boost, 4 handbrake
//     {t:'bye', cid}
//   host -> all   events:
//     'snap'    {s: [...]}  see encodeSnapshot (arrays of ints, cm / cm/s / int16 quats)
//     'roster'  {players:[{id,name,team,body,bot,host}], teamSize}
//     'welcome' {cid, id, code, team}   'reject' {cid, reason}
//     'matchover' {result}              'closed' {}

export const PHASES = ['pregame', 'countdown', 'play', 'goal', 'over']
export const WIRE_VERSION = 1
export const MAX_PLAYERS_WIRE = 6

const CODE_RE = /^[A-Z]{4}$/
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/
const BODY_RE = /^[A-Za-z0-9_-]{1,24}$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/g
const MAX_NAME = 16
const MAX_CID = 64

export const BTN_JUMP = 1
export const BTN_BOOST = 2
export const BTN_HANDBRAKE = 4

// ---------- cleaners ----------

export function cleanCid(cid) {
  return typeof cid === 'string' && cid.length > 0 && cid.length <= MAX_CID ? cid : null
}

/** A side request. Anything that is not a valid team means "put me anywhere". */
export function cleanTeam(team) {
  return team === 0 || team === 1 ? team : null
}

/** Cosmetic: the host cannot know the car list, so it only bounds the shape. */
export function cleanBody(body) {
  return typeof body === 'string' && BODY_RE.test(body) ? body : null
}

export function cleanCode(code) {
  if (typeof code !== 'string') return null
  const up = code.trim().toUpperCase()
  return CODE_RE.test(up) ? up : null
}

export function cleanName(name) {
  if (typeof name !== 'string') return null
  const clean = name.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  return clean.length > 0 ? clean : 'player'
}

// ---------- input quantisation ----------

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
const q8 = (x) => (Number.isFinite(x) ? Math.round(clamp(x, -1, 1) * 127) : 0)

/** Analog input -> {a:[5 int8], b:bitmask}. */
export function quantizeInput(i) {
  return {
    a: [q8(i.thr), q8(i.steer), q8(i.pitch), q8(i.yaw), q8(i.roll)],
    b: (i.jump ? BTN_JUMP : 0) | (i.boost ? BTN_BOOST : 0) | (i.handbrake ? BTN_HANDBRAKE : 0),
  }
}

export function dequantizeInput({ a, b }) {
  return {
    thr: a[0] / 127,
    steer: a[1] / 127,
    pitch: a[2] / 127,
    yaw: a[3] / 127,
    roll: a[4] / 127,
    jump: (b & BTN_JUMP) !== 0,
    boost: (b & BTN_BOOST) !== 0,
    handbrake: (b & BTN_HANDBRAKE) !== 0,
  }
}

/** Has the input moved enough to be worth a message? Buttons are exact, axes get a small deadband. */
export function inputChanged(prev, next, axisTol = 3) {
  if (!prev || prev.b !== next.b) return true
  for (let k = 0; k < 5; k++) if (Math.abs(prev.a[k] - next.a[k]) >= axisTol) return true
  // Returning exactly to rest must always go out, whatever the tolerance.
  for (let k = 0; k < 5; k++) if (next.a[k] === 0 && prev.a[k] !== 0) return true
  return false
}

// ---------- peer messages ----------

/** Validate a payload a peer put on the 'peer' event. Returns a clean message or null. */
export function parse(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return null
  const cid = cleanCid(msg.cid)
  if (cid === null) return null

  switch (msg.t) {
    case 'hello': {
      const name = cleanName(msg.name)
      if (name === null) return null
      return { t: 'hello', cid, name, team: cleanTeam(msg.team), body: cleanBody(msg.body) }
    }
    case 'input': {
      if (!Number.isInteger(msg.seq) || msg.seq < 0) return null
      if (!Array.isArray(msg.a) || msg.a.length !== 5) return null
      for (const v of msg.a) if (!Number.isInteger(v) || v < -127 || v > 127) return null
      if (!Number.isInteger(msg.b) || msg.b < 0 || msg.b > 7) return null
      return { t: 'input', cid, seq: msg.seq, a: msg.a.slice(), b: msg.b }
    }
    case 'bye':
      return { t: 'bye', cid }
    default:
      return null
  }
}

// ---------- roster / welcome / result (host -> peers) ----------

export function parseRoster(payload) {
  if (!payload || !Array.isArray(payload.players) || payload.players.length > MAX_PLAYERS_WIRE) return null
  const players = []
  for (const p of payload.players) {
    if (!p || typeof p.id !== 'string' || !ID_RE.test(p.id)) return null
    const name = cleanName(p.name)
    if (name === null) return null
    players.push({
      id: p.id,
      name,
      team: p.team === 1 ? 1 : 0,
      body: cleanBody(p.body) ?? 'octane',
      bot: p.bot === true,
      host: p.host === true,
    })
  }
  return players
}

export function parseWelcome(p) {
  if (!p || typeof p.id !== 'string' || !ID_RE.test(p.id)) return null
  return { id: p.id, team: p.team === 1 ? 1 : 0 }
}

const num = (x) => (Number.isFinite(x) ? x : 0)

export function parseResult(r) {
  if (!r || typeof r !== 'object') return null
  const score = Array.isArray(r.score) ? [num(r.score[0]) | 0, num(r.score[1]) | 0] : [0, 0]
  const players = Array.isArray(r.players)
    ? r.players.slice(0, MAX_PLAYERS_WIRE).map((p) => ({
        id: String(p?.id ?? '').slice(0, 24),
        name: cleanName(p?.name) ?? 'player',
        team: p?.team === 1 ? 1 : 0,
        bot: p?.bot === true,
        stats: cleanStats(p?.stats),
      }))
    : []
  return {
    score,
    winner: r.winner === 0 || r.winner === 1 ? r.winner : null,
    mvpId: typeof r.mvpId === 'string' ? r.mvpId.slice(0, 24) : null,
    players,
  }
}

const STAT_KEYS = ['score', 'goals', 'assists', 'saves', 'shots', 'demos']
function cleanStats(s) {
  const out = {}
  for (const k of STAT_KEYS) out[k] = Math.max(0, num(s?.[k]) | 0)
  return out
}

// ---------- snapshots ----------
//
// [ver, tick, phaseIdx, phaseT*100, clock*100, overtime, scoreB, scoreO, teamSize,
//  ball[13], pads('0'/'1' string), lastTouch|null, cars[], events[]]
// ball  = [px,py,pz cm, vx,vy,vz cm/s, qx,qy,qz,qw int16, wx,wy,wz centi-rad/s]
// car   = [id, ...13 as ball, boost, flags, demolished*10, ack, 6 stats]

const POS = 100
const Q16 = 32767
const FLAGS = ['onGround', 'onWall', 'boosting', 'supersonic', 'dodging', 'jumped', 'doubleJumped']

const r = Math.round

function pushBody(out, o) {
  out.push(
    r(o.p[0] * POS), r(o.p[1] * POS), r(o.p[2] * POS),
    r(o.v[0] * POS), r(o.v[1] * POS), r(o.v[2] * POS),
    r(o.q[0] * Q16), r(o.q[1] * Q16), r(o.q[2] * Q16), r(o.q[3] * Q16),
    r(o.w[0] * POS), r(o.w[1] * POS), r(o.w[2] * POS),
  )
  return out
}

/** Read 13 numbers starting at a[i] into {p,v,q,w}. */
function readBody(a, i) {
  let qx = a[i + 6] / Q16, qy = a[i + 7] / Q16, qz = a[i + 8] / Q16, qw = a[i + 9] / Q16
  const n = Math.hypot(qx, qy, qz, qw) || 1
  return {
    p: [a[i] / POS, a[i + 1] / POS, a[i + 2] / POS],
    v: [a[i + 3] / POS, a[i + 4] / POS, a[i + 5] / POS],
    q: [qx / n, qy / n, qz / n, qw / n],
    w: [a[i + 10] / POS, a[i + 11] / POS, a[i + 12] / POS],
  }
}

function roundEvent(e) {
  const out = {}
  for (const k in e) {
    const v = e[k]
    out[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x)) : v
  }
  return out
}

/**
 * state: a sim state (or snapshot of one). acks: {carId: lastInputSeq}.
 * events: the events accumulated since the previous snapshot.
 */
export function encodeSnapshot(state, acks = {}, events = []) {
  const flagsOf = (c) => FLAGS.reduce((m, f, i) => m | (c[f] ? 1 << i : 0), 0)
  return [
    WIRE_VERSION,
    state.tick,
    Math.max(0, PHASES.indexOf(state.phase)),
    r(state.phaseT * 100),
    r(state.clock * 100),
    state.overtime ? 1 : 0,
    state.score[0],
    state.score[1],
    state.teamSize,
    pushBody([], state.ball),
    state.pads.map((p) => (p ? '1' : '0')).join(''),
    state.lastTouch ?? null,
    state.cars.map((c) => {
      const a = [c.id]
      pushBody(a, c)
      a.push(
        r(c.boost), flagsOf(c), r((c.demolished || 0) * 10), acks[c.id] ?? 0,
        ...STAT_KEYS.map((k) => c.stats?.[k] ?? 0),
      )
      return a
    }),
    events.map(roundEvent),
  ]
}

export const EVENT_TYPES = new Set([
  'countdown', 'kickoff', 'hit', 'shot', 'save', 'goal', 'demo', 'jump', 'dodge', 'land',
  'boostPickup', 'supersonic', 'overtime', 'matchOver', 'bump',
])

/**
 * Events come from the host and some are rendered into HTML, so: known type,
 * integer id, finite tick, and only primitive fields survive. Strings must look
 * like ids (no markup); number arrays are vectors of at most 3 finite numbers.
 */
export function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !EVENT_TYPES.has(e.type)) return null
  if (!Number.isInteger(e.id) || e.id < 0 || !Number.isFinite(e.tick)) return null
  const out = { id: e.id, type: e.type, tick: e.tick }
  for (const k of Object.keys(e)) {
    if (k in out || !/^[A-Za-z]{1,16}$/.test(k)) continue
    const v = e[k]
    if (Number.isFinite(v) || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string' && ID_RE.test(v)) out[k] = v
    else if (Array.isArray(v) && v.length <= 3 && v.every(Number.isFinite)) out[k] = v
  }
  return out
}

const isInts = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite)

/**
 * Inverse of encodeSnapshot. Returns {state, acks, events} or null if malformed.
 * Car identity fields the snapshot does not carry (name, team, body, bot) are
 * left for the caller to fill from the roster.
 */
export function decodeSnapshot(s) {
  if (!Array.isArray(s) || s.length !== 14 || s[0] !== WIRE_VERSION) return null
  if (!s.slice(1, 9).every(Number.isFinite) || !isInts(s[9], 13) || typeof s[10] !== 'string') return null
  if (!Array.isArray(s[12]) || s[12].length > MAX_PLAYERS_WIRE || !Array.isArray(s[13]) || s[13].length > 64) return null

  const acks = {}
  const cars = []
  for (const a of s[12]) {
    if (!Array.isArray(a) || a.length !== 1 + 13 + 4 + 6 || typeof a[0] !== 'string' || !ID_RE.test(a[0])) return null
    if (!isInts(a.slice(1), a.length - 1)) return null
    const stats = {}
    STAT_KEYS.forEach((k, j) => (stats[k] = Math.max(0, Math.trunc(a[18 + j]))))
    const car = {
      id: a[0],
      ...readBody(a, 1),
      boost: a[14],
      demolished: a[16] / 10,
      stats,
    }
    FLAGS.forEach((name, i) => (car[name] = (a[15] & (1 << i)) !== 0))
    acks[car.id] = a[17]
    cars.push(car)
  }

  const events = []
  for (const e of s[13]) {
    const clean = cleanEvent(e)
    if (clean) events.push(clean)
  }

  return {
    state: {
      tick: s[1],
      phase: PHASES[s[2]] ?? 'pregame',
      phaseT: s[3] / 100,
      clock: s[4] / 100,
      overtime: s[5] === 1,
      score: [s[6], s[7]],
      teamSize: s[8],
      ball: readBody(s[9], 0),
      cars,
      pads: [...s[10]].map((c) => c === '1'),
      lastTouch: typeof s[11] === 'string' ? s[11] : null,
      events: [],
    },
    acks,
    events,
  }
}
