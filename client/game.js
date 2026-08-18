// The game page. It is reached with a room in the hash — #NEW to open one,
// #ABCD to join that code — which is what makes an invite link a link straight
// into the match rather than into the lobby with the code typed out for you.
//
// Nothing here asks for a side or an account: the lobby settles that and leaves
// it in sessionStorage. All this page needs is a name, and it prompts for one
// when a guest arrives on somebody else's link with nothing stored.

import { initRenderer, setLocalId, draw } from './render.js'
import { createRoom, joinRoom, beginMatch, sampleState, handlers, enabled as netEnabled } from './net.js'
import { cleanCode, cleanTeam } from '../shared/protocol.js'
import { reportMyMatch } from './stats.js'
import { startInput } from './input.js'
import { initSound, updateSound } from './sound.js'
import * as auth from './auth.js'
import {
  showGame,
  showRoster,
  gateNote,
  gatePrompt,
  nameOf,
  updateHud,
  flashBanner,
  showMatchOver,
  hideMatchOver,
  setHost,
} from './ui.js'

const el = (id) => document.getElementById(id)

// The lobby leaves these behind on its way here; an invite link has neither.
const STORED_NAME = 'carball.name'
const STORED_TEAM = 'carball.team'

let localId = null
let myTeam = null

initRenderer(el('view'))
startInput()

handlers.onJoined = (msg) => {
  localId = msg.id
  myTeam = msg.team
  setLocalId(msg.id)
  showGame(msg.code)
  location.hash = msg.code // so a refresh rejoins rather than opening a room
}

handlers.onRoster = showRoster
handlers.onError = (reason) => gatePrompt('Try again', reason)

handlers.onMatchOver = (score, players, matchId) => {
  showMatchOver(score, players)
  // Each player writes their own row; see stats.js for why the host does not do
  // it for everyone.
  const me = players.find((p) => p.id === localId)
  if (me) reportMyMatch({ matchId, score, team: me.team ?? myTeam, goals: me.goals })
}

handlers.onClosed = () => {
  flashBanner('DISCONNECTED', 9999)
}

// The room resets itself to waiting, and the host starts the next one; these
// only decide what you look at meanwhile.
// It stays up until the snapshot that leaves WAITING arrives, a moment behind.
// A second press in that window is a no-op: only a waiting room can kick off.
el('start').addEventListener('click', beginMatch)

el('over-again').addEventListener('click', hideMatchOver)

/** This page is what the link opens, so its own URL plus the code is the link. */
async function copyInvite(btn) {
  const code = el('room-code').textContent
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${code}`)
    btn.textContent = 'Link copied'
  } catch {
    // No clipboard without a secure context — the code is the shareable part.
    btn.textContent = `Room code ${code}`
  }
}

el('over-copy').addEventListener('click', () => copyInvite(el('over-copy')))
el('invite').addEventListener('click', () => copyInvite(el('invite')))
el('over-home').addEventListener('click', () => {
  location.href = './index.html' // dropping the socket leaves the room
})

// Joining -------------------------------------------------------------------

const wanted = location.hash.slice(1)
const code = cleanCode(wanted)
const opening = wanted.toUpperCase() === 'NEW'
const team = cleanTeam(Number.parseInt(sessionStorage.getItem(STORED_TEAM), 10))

if (!code && !opening) location.replace('./index.html') // nothing to join
else if (!netEnabled) gateNote('Multiplayer is not configured on this deployment')
else start()

async function start() {
  el('gate-kicker').textContent = opening ? 'Opening a room' : `Room ${code}`
  const session = await firstSession()
  // A signed-in name is the one others see; a guest's own typed name is kept for
  // the tab so a rejoin or a rematch does not ask again.
  const name = session?.username || sessionStorage.getItem(STORED_NAME) || ''
  if (name) join(name)
  else gatePrompt('Join')
}

el('gate-go').addEventListener('click', () => {
  const typed = el('gate-name').value.trim()
  const name = typed || sessionStorage.getItem(STORED_NAME) || ''
  if (!name) {
    gateNote('A name, please')
    return
  }
  if (typed) sessionStorage.setItem(STORED_NAME, typed)
  join(name)
})

el('gate-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('gate-go').click()
})

/**
 * A failed join reports through handlers.onError rather than throwing, so the
 * gate stays up either way and onJoined is what takes it down.
 */
async function join(name) {
  initSound() // no gesture on an auto-join; see the fallback below
  gateNote('')
  el('gate-title').textContent = opening ? 'Opening the room…' : `Joining ${code}…`
  el('gate-go').hidden = true
  el('gate-name-field').hidden = true
  // Set before the await: onJoined fires from inside createRoom, so waiting for
  // it to resolve would leave the first frames thinking they are not the host.
  setHost(opening)
  try {
    if (opening) await createRoom(name, team)
    else await joinRoom(name, code, team)
  } catch (err) {
    gatePrompt('Try again', err.message)
  }
}

/**
 * An AudioContext may only start from a gesture in this document, and arriving
 * on a link is not one — so the first key pressed opens it if the gate did not.
 */
addEventListener('keydown', initSound, { once: true })

/** The session as it first resolves, or null with accounts unconfigured. */
function firstSession() {
  if (!auth.enabled) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    auth.watchSession((session) => {
      if (settled) return
      settled = true
      resolve(session)
    })
  })
}

function frame() {
  const state = sampleState()
  if (state) {
    draw(state, nameOf)
    updateHud(state, localId)
    updateSound(state, localId)
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
