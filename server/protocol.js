// The socket is a trust boundary. Everything from a client is parsed here and
// either returns a known-good message or null. Nothing in here throws.

import { IN_ALL, TEAM_BLUE, TEAM_ORANGE } from '../shared/constants.js'

const CODE_RE = /^[A-Z]{4}$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/g
const MAX_NAME = 16

export function parse(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null

  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return null

  switch (msg.t) {
    case 'create': {
      const name = cleanName(msg.name)
      return name === null ? null : { t: 'create', name, team: cleanTeam(msg.team) }
    }
    case 'join': {
      const name = cleanName(msg.name)
      const code = cleanCode(msg.code)
      if (name === null || code === null) return null
      return { t: 'join', name, code, team: cleanTeam(msg.team) }
    }
    case 'input': {
      if (!Number.isInteger(msg.seq) || msg.seq < 0) return null
      if (!Number.isInteger(msg.bits) || msg.bits < 0 || msg.bits > IN_ALL) return null
      return { t: 'input', seq: msg.seq, bits: msg.bits }
    }
    default:
      return null
  }
}

/** A side request. Anything that is not a valid team means "put me anywhere". */
export function cleanTeam(team) {
  return team === TEAM_BLUE || team === TEAM_ORANGE ? team : null
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
