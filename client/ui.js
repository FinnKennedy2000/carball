import * as C from '../shared/constants.js'
import { ITEMS } from '../shared/rumble.js'

const el = (id) => document.getElementById(id)

let bannerOverride = ''
let bannerUntil = 0
let roster = [] // the latest roster, kept for the HUD and the full-time panel

export function showGame(code) {
  el('gate').hidden = true
  el('hud').hidden = false
  el('room-code').textContent = code
  el('waiting-code').textContent = code
  el('over-code').textContent = code
}

/** Why we are not in a room yet. Blank clears it. */
export function gateNote(reason) {
  el('gate-note').textContent = reason
}

/** Ask for a name and a press: the only way in, and the only way to retry. */
export function gatePrompt(label, reason = '') {
  el('gate-title').textContent = 'Join the match'
  el('gate-name-field').hidden = false
  el('gate-go').hidden = false
  el('gate-go').textContent = label
  gateNote(reason)
  el('gate-name').focus()
}

let iAmHost = false

export function setHost(isHost) {
  iAmHost = isHost
}

export function showRoster(players) {
  roster = players
  el('roster').replaceChildren(
    ...occupiedSides(players).map(({ label, team }) => teamBlock(label, team, players)),
  )
}

/** The sides someone is actually on — an empty one gets no heading at all. */
function occupiedSides(players) {
  return [
    { label: 'Blue', team: C.TEAM_BLUE },
    { label: 'Orange', team: C.TEAM_ORANGE },
  ].filter(({ team }) => players.some((p) => p.team === team))
}

/** One side's names, headed by the side's own colour. */
function teamBlock(label, team, players) {
  const block = document.createElement('div')
  block.className = `team-block ${team === C.TEAM_BLUE ? 'blue' : 'orange'}`
  const name = document.createElement('span')
  name.className = 'team-name'
  name.textContent = label
  block.append(
    name,
    ...players
      .filter((p) => p.team === team)
      .map((p) => {
        const span = document.createElement('span')
        span.className = 'who'
        span.dataset.id = p.id
        span.textContent = p.name
        return span
      }),
  )
  return block
}

export function flashBanner(text, seconds) {
  bannerOverride = text
  bannerUntil = performance.now() + seconds * 1000
}

let wasOvertime = false
let sawOver = false
// Read by the waiting strip, which is drawn from the roster rather than the
// snapshot and so has no state of its own to ask.
let waitingMode = false

export function updateHud(state, localId) {
  // Announce sudden death once rather than parking it over the pitch.
  if (state.overtime && !wasOvertime) flashBanner('SUDDEN DEATH', 3)
  wasOvertime = state.overtime

  el('score-blue').textContent = state.score[C.TEAM_BLUE]
  el('score-orange').textContent = state.score[C.TEAM_ORANGE]
  el('clock').textContent = state.overtime ? 'OT' : formatClock(state.clock)
  el('clock-label').textContent = state.overtime ? 'sudden death' : ''

  const me = state.cars.find((c) => c.id === localId)
  const boost = me ? me.boost / C.BOOST_MAX : 0
  el('boost').style.width = `${boost * 100}%`
  el('boost-pct').textContent = Math.round(boost * 100)
  showItem(state, me)

  // The local player's own name is the one that reads at full strength.
  for (const span of el('roster').querySelectorAll('.who')) {
    span.classList.toggle('me', Number(span.dataset.id) === localId)
  }

  el('banner').textContent = bannerText(state)
  el('banner-sub').textContent = bannerSub(state)
  // Before kickoff the strip is the HUD: it carries the code, who is in, and the
  // only two things worth pressing. Boost and the top-right code chip are noise
  // until the cars move.
  const waiting = state.phase === 'WAITING'
  waitingMode = state.mode === 'rumble'
  el('controls-line').textContent =
    state.mode === 'rumble'
      ? 'WASD drive · space boost · shift drift · E item · M mute'
      : 'WASD drive · space boost · shift drift · M mute'
  el('waiting').hidden = !waiting
  el('footer').hidden = waiting
  el('room').hidden = waiting
  el('start').hidden = !(iAmHost && waiting)
  // Anyone in a waiting room can pull someone else in, host or not.
  el('invite').hidden = !waiting
  if (waiting) showWaiting()

  // The panel belongs to the OVER phase, but the announcement arrives ahead of
  // the snapshot that carries the phase (the view runs INTERP_DELAY_MS behind).
  // So it is cleared on the way *out* of OVER rather than whenever we are not
  // in it, which would hide the panel again the instant it was shown.
  if (state.phase === 'OVER') sawOver = true
  else if (sawOver) {
    sawOver = false
    hideMatchOver()
  }
}

/**
 * The item slot. The mode comes from the snapshot rather than from what this
 * tab picked in the lobby, so a joiner on someone else's link is told the truth
 * about the room they landed in.
 */
function showItem(state, me) {
  const rumble = state.mode === 'rumble'
  el('item-chip').hidden = !rumble
  if (!rumble || !me) return

  const item = me.item === null || me.item === undefined ? null : ITEMS[me.item]
  el('item-chip').classList.toggle('armed', item !== null)
  el('item-name').textContent = item ? item.name : `${Math.ceil(me.itemTimer ?? 0)}s`
  el('item-hint').textContent = item ? `E · ${item.hint}` : 'waiting'
}

/** The strip's tallies and its one line of guidance, which differ by role. */
function showWaiting() {
  const blue = roster.filter((p) => p.team === C.TEAM_BLUE).length
  el('count-blue').textContent = blue
  el('count-orange').textContent = roster.length - blue
  el('count-total').textContent = `${roster.length} of ${C.MAX_PLAYERS}`
  el('waiting-mode').textContent = waitingMode ? 'Rumble' : ''
  el('waiting-hint').textContent = iAmHost
    ? 'Anyone with the link drops straight into this room · WASD drive · space boost'
    : 'The host starts the match · WASD drive · space boost'
}

/** A car's player name, or null — the labels over the cars and the goal credit. */
export function nameOf(id) {
  return roster.find((p) => p.id === id)?.name ?? null
}

/** A car's chosen model, or null while the roster is unknown — see render.js. */
export function carOf(id) {
  return roster.find((p) => p.id === id)?.car ?? null
}

function bannerText(state) {
  if (performance.now() < bannerUntil) return bannerOverride
  // The waiting strip carries this now, so the pitch stays clear.
  if (state.phase === 'WAITING') return ''
  if (state.phase === 'GOAL') return 'GOAL'
  if (state.phase === 'KICKOFF') return String(Math.max(1, Math.ceil(state.phaseTimer)))
  return ''
}

/** Under a goal, who earned it — blank for an own goal, which is nobody's. */
function bannerSub(state) {
  if (performance.now() < bannerUntil) return ''
  if (state.phase === 'WAITING') return ''
  if (state.phase !== 'GOAL') return ''
  return nameOf(state.lastScorer) ?? ''
}

/** The full-time panel: the verdict, the score, and who scored what. */
export function showMatchOver([blue, orange], players) {
  el('over-verdict').textContent =
    blue === orange ? 'Draw' : blue > orange ? 'Blue wins' : 'Orange wins'
  el('over-blue').textContent = blue
  el('over-orange').textContent = orange
  el('over-teams').replaceChildren(
    ...occupiedSides(players).map(({ label, team }) => scorerBlock(label, team, players)),
  )
  el('over').hidden = false
}

export function hideMatchOver() {
  el('over').hidden = true
}

function scorerBlock(label, team, players) {
  const block = document.createElement('div')
  block.className = `team-block ${team === C.TEAM_BLUE ? 'blue' : 'orange'}`
  const name = document.createElement('span')
  name.className = 'team-name'
  name.textContent = label
  block.append(
    name,
    ...players
      .filter((p) => p.team === team)
      .sort((a, b) => b.goals - a.goals)
      .map((p) => {
        const line = document.createElement('div')
        line.className = 'line'
        const who = document.createElement('span')
        who.textContent = p.name
        const tally = document.createElement('span')
        tally.className = 'tally'
        tally.textContent = `${p.goals} ${p.goals === 1 ? 'goal' : 'goals'}`
        line.append(who, tally)
        return line
      }),
  )
  return block
}

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
