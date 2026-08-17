import { initRenderer, setLocalId, draw } from './render.js'
import { connect, createRoom, joinRoom, startSendingInput, sampleState, handlers } from './net.js'
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
} from './ui.js'

const el = (id) => document.getElementById(id)

let localId = null

initRenderer(el('view'))
startInput()

handlers.onJoined = (msg) => {
  localId = msg.id
  setLocalId(msg.id)
  showGame(msg.code)
  startSendingInput()
  location.hash = msg.code
}

handlers.onRoster = showRoster
handlers.onError = lobbyError

handlers.onMatchOver = showMatchOver

// The room restarts on its own; these only decide what you look at meanwhile.
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
  if (!(await ready())) return
  createRoom(name, wantedTeam, await auth.accessToken())
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
  if (!(await ready())) return
  joinRoom(name, code, wantedTeam, await auth.accessToken())
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
      // The server takes the name from the account, so show it and lock it.
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

let connected = null
async function ready() {
  if (!connected) connected = connect()
  try {
    await connected
    return true
  } catch (err) {
    connected = null
    lobbyError(err.message)
    return false
  }
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
