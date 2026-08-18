// The channel is a trust boundary. Everything from another client is parsed here
// and either returns a known-good message or null. Nothing in here throws.
//
// This lives in shared/ because the host is now a player's browser: it receives
// messages from peers it has no reason to trust, exactly as the old server did.

import { IN_ALL, TEAM_BLUE, TEAM_ORANGE } from './constants.js'
import { CARS, DEFAULT_CAR } from './cars.js'

const CODE_RE = /^[A-Z]{4}$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/g
const MAX_NAME = 16
const MAX_CID = 64

/**
 * Validate a payload a peer broadcast into the room channel. Realtime hands the
 * payload over already decoded, so this takes an object rather than a string.
 * Returns a known-good message, or null for anything unrecognised.
 */
export function parse(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return null

  const cid = cleanCid(msg.cid)
  if (cid === null) return null

  switch (msg.t) {
    case 'hello': {
      const name = cleanName(msg.name)
      if (name === null) return null
      return { t: 'hello', cid, name, team: cleanTeam(msg.team), car: cleanCar(msg.car) }
    }
    case 'input': {
      if (!Number.isInteger(msg.seq) || msg.seq < 0) return null
      if (!Number.isInteger(msg.bits) || msg.bits < 0 || msg.bits > IN_ALL) return null
      return { t: 'input', cid, seq: msg.seq, bits: msg.bits }
    }
    case 'bye':
      return { t: 'bye', cid }
    default:
      return null
  }
}

/** A sender's id for one tab. Opaque to the host; only used to address replies. */
export function cleanCid(cid) {
  return typeof cid === 'string' && cid.length > 0 && cid.length <= MAX_CID ? cid : null
}

/**
 * There is deliberately no token handling here. The old server verified a
 * player's access token; the host is another player's browser, so a token put on
 * the channel would hand that player your session. Names are therefore claimed
 * by the client and cannot be trusted — see the note in host.js.
 */

/** A side request. Anything that is not a valid team means "put me anywhere". */
export function cleanTeam(team) {
  return team === TEAM_BLUE || team === TEAM_ORANGE ? team : null
}

/**
 * A chosen car model. Cosmetic, so anything unrecognised is the default rather
 * than a rejected message: a peer with a stale build should still get a seat.
 */
export function cleanCar(car) {
  return Number.isInteger(car) && car >= 0 && car < CARS.length ? car : DEFAULT_CAR
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
