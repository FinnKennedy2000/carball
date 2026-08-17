import { initRenderer, setLocalId, draw } from './render.js'
import { connect, createRoom, joinRoom, startSendingInput, sampleState, handlers } from './net.js'
import { startInput } from './input.js'
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
  flashBanner(`${verdict}  ${blue}–${orange}`, 4)
}

handlers.onClosed = () => {
  flashBanner('DISCONNECTED', 9999)
}

el('create').addEventListener('click', async () => {
  const name = el('name').value
  lobbyError('')
  if (!(await ready())) return
  createRoom(name)
})

el('join').addEventListener('click', async () => {
  const name = el('name').value
  const code = el('code').value.trim().toUpperCase()
  lobbyError('')
  if (code.length !== 4) {
    lobbyError('Room codes are 4 letters')
    return
  }
  if (!(await ready())) return
  joinRoom(name, code)
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
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
