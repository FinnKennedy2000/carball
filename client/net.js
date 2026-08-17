// Transport plus the snapshot buffer. The client does not simulate: it renders a
// short way in the past and interpolates between the two snapshots that straddle
// that moment. INTERP_DELAY_MS is the knob to raise if someone's link is rough.

import * as C from '../shared/constants.js'
import { currentBits } from './input.js'

const INTERP_DELAY_MS = 100
const BUFFER_MAX = 24

const buffer = [] // [{ recvAt, s }], oldest first
let socket = null
let seq = 0
let inputTimer = null

export const handlers = {
  onJoined: () => {},
  onRoster: () => {},
  onError: () => {},
  onMatchOver: () => {},
  onClosed: () => {},
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(`${proto}//${location.host}/ws`)

  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    switch (msg.t) {
      case 'snap':
        buffer.push({ recvAt: performance.now(), s: msg.s })
        while (buffer.length > BUFFER_MAX) buffer.shift()
        break
      case 'joined':
        handlers.onJoined(msg)
        break
      case 'roster':
        handlers.onRoster(msg.players)
        break
      case 'matchover':
        handlers.onMatchOver(msg.score, msg.players)
        break
      case 'error':
        handlers.onError(msg.reason)
        break
    }
  })

  socket.addEventListener('close', () => {
    stopSendingInput()
    handlers.onClosed()
  })

  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('could not reach the server')), {
      once: true,
    })
  })
}

export function createRoom(name, team, token) {
  send({ t: 'create', name, team, token })
}

export function joinRoom(name, code, team, token) {
  send({ t: 'join', name, code, team, token })
}

export function startSendingInput() {
  if (inputTimer) return
  inputTimer = setInterval(() => send({ t: 'input', seq: seq++, bits: currentBits() }), 1000 / C.TICK_HZ)
}

function stopSendingInput() {
  clearInterval(inputTimer)
  inputTimer = null
}

function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

/** Interpolated view of the world, or null until two snapshots have arrived. */
export function sampleState() {
  if (buffer.length === 0) return null
  const renderAt = performance.now() - INTERP_DELAY_MS

  let older = null
  let newer = null
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].recvAt <= renderAt) {
      older = buffer[i]
      newer = buffer[i + 1] ?? null
      break
    }
  }
  // Not enough history yet, or we have fallen behind the buffer: show the newest.
  if (!older) return buffer[0].s
  if (!newer) return older.s

  const span = newer.recvAt - older.recvAt
  const t = span > 0 ? (renderAt - older.recvAt) / span : 0
  return blend(older.s, newer.s, t)
}

function blend(a, b, t) {
  const carsA = new Map(a.cars.map((c) => [c.id, c]))
  return {
    // Discrete fields come from the older snapshot so the banner and the score
    // change at the same moment the bodies do.
    tick: a.tick,
    phase: a.phase,
    phaseTimer: a.phaseTimer,
    clock: a.clock,
    overtime: a.overtime,
    score: a.score,
    ball: {
      x: lerp(a.ball.x, b.ball.x, t),
      y: lerp(a.ball.y, b.ball.y, t),
      vx: b.ball.vx,
      vy: b.ball.vy,
    },
    cars: b.cars.map((cb) => {
      const ca = carsA.get(cb.id)
      if (!ca) return cb // joined between snapshots
      return {
        ...cb,
        x: lerp(ca.x, cb.x, t),
        y: lerp(ca.y, cb.y, t),
        heading: lerpAngle(ca.heading, cb.heading, t),
        boost: lerp(ca.boost, cb.boost, t),
      }
    }),
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}
