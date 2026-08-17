import * as C from '../shared/constants.js'
import { initRenderer, setLocalId, draw } from './render.js'
import { connect, createRoom, joinRoom, startSendingInput, sampleState, handlers } from './net.js'
import { startInput } from './input.js'
import { initSound, updateSound } from './sound.js'
import { showGame, showRoster, lobbyError, updateHud, flashBanner } from './ui.js'

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

handlers.onMatchOver = ([blue, orange]) => {
  const verdict = blue === orange ? 'DRAW' : blue > orange ? 'BLUE WINS' : 'ORANGE WINS'
  flashBanner(`${verdict}  ${blue}\u2013${orange}`, C.OVER_SECONDS)
}

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
  createRoom(name, wantedTeam)
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
  joinRoom(name, code, wantedTeam)
})

el('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('join').click()
})

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
