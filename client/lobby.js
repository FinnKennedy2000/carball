// The home page: a name, a side, an optional account, and the two ways into a
// match. The match itself lives on game.html, which this page hands off to with
// the room in the hash — see game.js.

import { cleanCode, cleanCar } from '../shared/protocol.js'
import { CARS } from '../shared/cars.js'
import { carSvg, dimensions } from './silhouette.js'
import * as auth from './auth.js'

const el = (id) => document.getElementById(id)

// Read back by game.js. sessionStorage rather than the URL: a name has no
// business in a link people paste to each other.
const STORED_NAME = 'carball.name'
const STORED_TEAM = 'carball.team'
// The car outlives the tab, unlike the side and the name: it is a preference
// rather than a decision about this match, so localStorage.
const STORED_CAR = 'carball.car'
// A decision about this match rather than a standing preference, so it sits
// beside the side rather than with the car.
const STORED_MODE = 'carball.mode'

// Invite links used to point here. Keep the old ones working.
if (/^#[A-Za-z]{4}$/.test(location.hash)) location.replace(`./game${location.hash}`)

const lobbyError = (reason) => {
  el('lobby-error').textContent = reason
}

// Team buttons: '' means auto-balance.
let wantedTeam = null
for (const btn of document.querySelectorAll('#teams .team')) {
  btn.addEventListener('click', () => {
    for (const other of document.querySelectorAll('#teams .team')) other.classList.remove('on')
    btn.classList.add('on')
    wantedTeam = btn.dataset.team === '' ? null : Number(btn.dataset.team)
    paintCar() // the car below wears the side you just picked
  })
}

// Mode buttons. Only the room's creator is asked: joining a code takes the mode
// the host already chose, which arrives in the snapshot.
let wantedMode = 'normal'
for (const btn of document.querySelectorAll('#modes .mode')) {
  btn.addEventListener('click', () => {
    for (const other of document.querySelectorAll('#modes .mode')) other.classList.remove('on')
    btn.classList.add('on')
    wantedMode = btn.dataset.mode
    el('mode-hint').textContent =
      wantedMode === 'rumble'
        ? 'Random powerups every ten seconds · E to fire · joining a code uses that room\u2019s mode'
        : 'Football, plainly.'
  })
}

// The car you are in, and the way through to the garage that changes it. Five
// models did not fit a row here, and picking one is worth a page of its own.
const wantedCar = cleanCar(Number.parseInt(localStorage.getItem(STORED_CAR), 10))
el('car-name').textContent = CARS[wantedCar].name
el('car-dims').textContent = dimensions(CARS[wantedCar])

function paintCar() {
  el('car-thumb').innerHTML = carSvg(CARS[wantedCar], wantedTeam ?? 0)
}
paintCar()
el('garage-link').addEventListener('click', () => {
  // The side goes with us: the garage paints the preview in it.
  sessionStorage.setItem(STORED_TEAM, String(wantedTeam))
  location.href = './garage'
})

/** Hand the choice to the game page. A room is only ever opened there. */
function play(hash) {
  const name = el('name').value.trim()
  if (name) sessionStorage.setItem(STORED_NAME, name)
  sessionStorage.setItem(STORED_TEAM, String(wantedTeam))
  sessionStorage.setItem(STORED_MODE, wantedMode)
  localStorage.setItem(STORED_CAR, String(wantedCar))
  location.href = `./game#${hash}`
}

el('create').addEventListener('click', () => {
  lobbyError('')
  if (!ready()) return
  play('NEW')
})

el('join').addEventListener('click', () => {
  lobbyError('')
  const code = cleanCode(el('code').value)
  if (!code) {
    lobbyError('Room codes are 4 letters')
    return
  }
  if (!ready()) return
  play(code)
})

el('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('join').click()
})

// Accounts ------------------------------------------------------------------
// Optional throughout: with Supabase unconfigured the panel stays hidden and
// everyone plays as a guest with a typed-in name.

const renameNote = (text, ok = false) => {
  el('rename-note').textContent = text
  el('rename-note').classList.toggle('ok', ok)
}

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
      el('rename').value = session.username
      renameNote('')
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
  el('rename-go').addEventListener('click', async () => {
    const wanted = el('rename').value.trim()
    if (!wanted) {
      renameNote('A name, please')
      return
    }
    renameNote('')
    try {
      const username = await auth.rename(wanted)
      // A profile update is not an auth change, so watchSession never fires for
      // it and nothing repaints on its own. Everything showing the old name is
      // brought up to date here.
      el('account-name').textContent = username
      el('name').value = username
      renameNote('Saved.', true)
      showRecord(username)
      showLeaderboard()
    } catch (err) {
      renameNote(err.message)
    }
  })

  el('rename').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('rename-go').click()
  })

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

/**
 * Realtime carries the game now, so an unconfigured deployment has no
 * multiplayer at all — worth saying plainly here rather than on the way in.
 */
function ready() {
  // Realtime is the transport, so the same flag governs the game and accounts.
  if (auth.enabled) return true
  lobbyError('Multiplayer is not configured on this deployment')
  return false
}
