import * as C from '../shared/constants.js'

const el = (id) => document.getElementById(id)

let bannerOverride = ''
let bannerUntil = 0
let roster = [] // the latest roster, kept for the HUD and the full-time panel

export function showGame(code) {
  el('lobby').hidden = true
  el('hud').hidden = false
  el('room-code').textContent = code
  el('over-code').textContent = code
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

export function lobbyError(reason) {
  el('lobby-error').textContent = reason
}

export function flashBanner(text, seconds) {
  bannerOverride = text
  bannerUntil = performance.now() + seconds * 1000
}

let wasOvertime = false
let sawOver = false

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

  // The local player's own name is the one that reads at full strength.
  for (const span of el('roster').querySelectorAll('.who')) {
    span.classList.toggle('me', Number(span.dataset.id) === localId)
  }

  el('banner').textContent = bannerText(state)
  el('banner-sub').textContent = bannerSub(state)
  el('start').hidden = !(iAmHost && state.phase === 'WAITING')

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

function nameOf(id) {
  return roster.find((p) => p.id === id)?.name ?? null
}

function bannerText(state) {
  if (performance.now() < bannerUntil) return bannerOverride
  // The host gets a button instead; a peer gets told who they are waiting for.
  if (state.phase === 'WAITING') return iAmHost ? '' : 'WAITING'
  if (state.phase === 'GOAL') return 'GOAL'
  if (state.phase === 'KICKOFF') return String(Math.max(1, Math.ceil(state.phaseTimer)))
  return ''
}

/** Under a goal, who earned it — blank for an own goal, which is nobody's. */
function bannerSub(state) {
  if (performance.now() < bannerUntil) return ''
  if (state.phase === 'WAITING') return iAmHost ? '' : 'the host starts the match'
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
