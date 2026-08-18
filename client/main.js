import { initRenderer, setLocalId, draw } from './render.js'
import { createRoom, joinRoom, beginMatch, sampleState, handlers, enabled as netEnabled } from './net.js'
import { reportMyMatch } from './stats.js'
import { startInput } from './input.js'
import { initSound, updateSound } from './sound.js'
import * as auth from './auth.js'
import {
  showGame,
  showRoster,
  lobbyError,
  updateHud,
  flashBanner,
  showMatchOver,
  hideMatchOver,
  setHost,
} from './ui.js'

const el = (id) => document.getElementById(id)

let localId = null

initRenderer(el('view'))
startInput()

let myTeam = null

handlers.onJoined = (msg) => {
  localId = msg.id
  myTeam = msg.team
  setLocalId(msg.id)
  showGame(msg.code)
  location.hash = msg.code
}

handlers.onRoster = showRoster
handlers.onError = lobbyError

handlers.onMatchOver = (score, players, matchId) => {
  showMatchOver(score, players)
  // Each player writes their own row; see stats.js for why the host does not do
  // it for everyone.
  const me = players.find((p) => p.id === localId)
  if (me) reportMyMatch({ matchId, score, team: me.team ?? myTeam, goals: me.goals })
}

// The room resets itself to waiting, and the host starts the next one; these
// only decide what you look at meanwhile.
// It stays up until the snapshot that leaves WAITING arrives, a moment behind.
// A second press in that window is a no-op: only a waiting room can kick off.
el('start').addEventListener('click', beginMatch)

el('over-again').addEventListener('click', hideMatchOver)
el('over-copy').addEventListener('click', async () => {
  const code = el('room-code').textContent
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${code}`)
    el('over-copy').textContent = 'Link copied'
  } catch {
    // No clipboard without a secure context — the code is the shareable part.
    el('over-copy').textContent = `Room code ${code}`
  }
})
el('over-home').addEventListener('click', () => {
  location.href = location.pathname // dropping the socket leaves the room
})

handlers.onClosed = () => {
  flashBanner('DISCONNECTED', 9999)
}

// Team buttons: '' means auto-balance.
let wantedTeam = null
for (const btn of document.querySelectorAll('#teams .team')) {
  btn.addEventListener('click', () => {
    for (const other of document.querySelectorAll('#teams .team')) other.classList.remove('on')
    btn.classList.add('on')
    wantedTeam = btn.dataset.team === '' ? null : Number(btn.dataset.team)
  })
}

el('create').addEventListener('click', async () => {
  const name = el('name').value
  lobbyError('')
  initSound() // this click is the gesture the AudioContext needs
  if (!ready()) return
  try {
    await createRoom(name, wantedTeam)
    setHost(true)
  } catch (err) {
    lobbyError(err.message)
  }
})

el('join').addEventListener('click', async () => {
  const name = el('name').value
  const code = el('code').value.trim().toUpperCase()
  lobbyError('')
  if (code.length !== 4) {
    lobbyError('Room codes are 4 letters')
    return
  }
  initSound()
  if (!ready()) return
  try {
    await joinRoom(name, code, wantedTeam)
  } catch (err) {
    lobbyError(err.message)
  }
})

el('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('join').click()
})

// Accounts ------------------------------------------------------------------
// Optional throughout: with Supabase unconfigured the panel stays hidden and
// everyone plays as a guest with a typed-in name.

const accountNote = (text, ok = false) => {
  el('account-note').textContent = text
  el('account-note').classList.toggle('ok', ok)
}

if (auth.enabled) {
  el('account').hidden = false

  el('account-divider').hidden = false

  auth.watchSession(async (session) => {
    el('account-signed-out').hidden = Boolean(session)
    el('account-signed-in').hidden = !session
    el('topbar').hidden = !session
    if (session) {
      el('account-name').textContent = session.username
      // Shown and locked so a signed-in player is recognisable to others. It is
      // only a claim now — see the trust note in host.js.
      el('name').value = session.username
      el('name').disabled = true
      el('play-label').textContent = 'Playing as'
      accountNote('')
      showRecord(session.username)
    } else {
      el('name').disabled = false
      el('play-label').textContent = 'Play as a guest'
    }
    showLeaderboard()
  })

  const attempt = (fn) => async () => {
    const email = el('email').value.trim()
    const password = el('password').value
    if (!email || !password) {
      accountNote('Email and password, please')
      return
    }
    accountNote('')
    try {
      await fn(email, password)
    } catch (err) {
      accountNote(err.message)
    }
  }

  el('sign-in').addEventListener('click', attempt(auth.signIn))
  el('sign-up').addEventListener('click', attempt(async (email, password) => {
    const wanted = el('name').value.trim() || email.split('@')[0]
    const { needsConfirmation } = await auth.signUp(email, password, wanted)
    accountNote(
      needsConfirmation ? 'Check your email to confirm, then sign in.' : 'Account created.',
      true,
    )
  }))
  el('sign-out').addEventListener('click', () => auth.signOut())
  el('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('sign-in').click()
  })
}

async function showRecord(username) {
  const { goals, wins, matches } = await auth.stats(username)
  el('record-goals').textContent = goals
  el('record-wins').textContent = wins
  el('record-matches').textContent = matches
}

async function showLeaderboard() {
  const rows = await auth.leaderboard()
  el('leaderboard').hidden = rows.length === 0
  el('leaderboard-rows').replaceChildren(
    ...rows.map((r, i) => {
      const row = document.createElement('div')
      row.className = 'lb-row'
      const rank = document.createElement('span')
      rank.className = 'rank'
      rank.textContent = i + 1
      const name = document.createElement('span')
      name.textContent = r.username
      const tally = document.createElement('span')
      tally.className = 'tally'
      tally.textContent = `${r.goals} goals · ${r.wins}W/${r.matches}`
      row.append(rank, name, tally)
      return row
    }),
  )
}

// A shared link like http://host:3000/#ABCD prefills the code.
if (/^#[A-Za-z]{4}$/.test(location.hash)) el('code').value = location.hash.slice(1).toUpperCase()

/**
 * Realtime carries the game now, so an unconfigured deployment has no
 * multiplayer at all — worth saying plainly rather than timing out on a join.
 */
function ready() {
  if (netEnabled) return true
  lobbyError('Multiplayer is not configured on this deployment')
  return false
}

function frame() {
  const state = sampleState()
  if (state) {
    draw(state)
    updateHud(state, localId)
    updateSound(state, localId)
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
