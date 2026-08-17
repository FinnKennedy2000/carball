import * as C from '../shared/constants.js'

const el = (id) => document.getElementById(id)

let bannerOverride = ''
let bannerUntil = 0

export function showGame(code) {
  el('lobby').hidden = true
  el('hud').hidden = false
  el('room-code').textContent = code
}

export function showRoster(players) {
  el('players').replaceChildren(
    ...players.map((p) => {
      const span = document.createElement('span')
      span.className = p.team === C.TEAM_BLUE ? 'who blue' : 'who orange'
      span.textContent = p.name
      return span
    }),
  )
}

export function lobbyError(reason) {
  el('lobby-error').textContent = reason
}

export function flashBanner(text, seconds) {
  bannerOverride = text
  bannerUntil = performance.now() + seconds * 1000
}

export function updateHud(state, localId) {
  el('score-blue').textContent = state.score[C.TEAM_BLUE]
  el('score-orange').textContent = state.score[C.TEAM_ORANGE]
  el('clock').textContent = formatClock(state.clock)

  const me = state.cars.find((c) => c.id === localId)
  el('boost').style.width = `${me ? (me.boost / C.BOOST_MAX) * 100 : 0}%`

  el('banner').textContent = bannerText(state)
}

function bannerText(state) {
  if (performance.now() < bannerUntil) return bannerOverride
  if (state.phase === 'GOAL') return 'GOAL'
  if (state.phase === 'KICKOFF') return String(Math.max(1, Math.ceil(state.phaseTimer)))
  return ''
}

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
