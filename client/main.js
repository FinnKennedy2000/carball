// App shell: screens, menus, and the frame loop that ties net -> render/HUD/audio.
import * as net from './net.js'
import * as input from './input.js'
import { createRenderer, createCarPreview } from './render/index.js'
import { createAudio } from './audio/index.js'
import { CARS } from '../shared/cars.js'
import { createHud } from './ui/hud.js'
import { initSettings, settings, store } from './ui/settings.js'
import { mockState } from './ui/mock.js'

const $ = (id) => document.getElementById(id)
const $$ = (sel, r = document) => [...r.querySelectorAll(sel)]
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const params = new URLSearchParams(location.search)
const mock = params.get('mock')
const TEAMS = ['BLUE', 'ORANGE']

// ---- profile -------------------------------------------------------------
const carKeys = Object.keys(CARS)
const bodyVal = (k) => (Array.isArray(CARS) ? +k : k)
const profile = {
  name: store.get('carball.name', ''),
  team: +store.get('carball.team', 0) || 0,
  body: carKeys.includes(store.get('carball.body')) ? store.get('carball.body') : carKeys[0],
  size: +store.get('carball.size', 2) || 2,
}
const saveProfile = () => ['name', 'team', 'body', 'size'].forEach((k) => store.set(`carball.${k}`, profile[k]))
const driver = () => ({ name: profile.name.trim() || 'Player', team: profile.team, body: bodyVal(profile.body) })

// ---- engine pieces -------------------------------------------------------
const canvas = $('bg')
const renderer = createRenderer(canvas, { quality: settings.quality })
const audio = createAudio()
const hud = createHud()
input.startInput()
input.setInputEnabled(false)
addEventListener('resize', () => renderer.resize())

let ballCam = settings.ballCam
renderer.setCameraMode(ballCam ? 'ball' : 'car')
const setBallCam = (on) => { ballCam = on; renderer.setCameraMode(on ? 'ball' : 'car'); hud.setBallCam(on) }

initSettings($('set-body'), (s) => {
  renderer.setQuality(s.quality)
  // Settings speak Rocket League's units (horizontal FOV, distance 270, height
  // 100, stiffness 0-100); the renderer takes vertical FOV and multipliers.
  renderer.setCameraSettings({
    fov: (2 * Math.atan(Math.tan((s.fov * Math.PI) / 360) / (16 / 9)) * 180) / Math.PI,
    distance: s.distance / 270,
    height: s.height / 100,
    stiffness: 0.4 + (s.stiffness / 100) * 1.2,
  })
  audio.setVolume({ master: s.master, sfx: s.sfx, music: s.music, crowd: s.crowd })
})

// ---- screens -------------------------------------------------------------
let screen = 'title'
let preview = null
let lastState = null
let session = { code: null, offline: false, isHost: false }
let pendingRoom = null
let matchOverAt = 0
let overInfo = null

function toast(msg) {
  const t = document.createElement('div')
  t.className = 'toast'; t.textContent = msg
  $('toasts').append(t); setTimeout(() => t.remove(), 4200)
}

function show(name) {
  screen = name
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name))
  const inMatch = name === 'match'
  document.body.classList.toggle('in-match', inMatch)
  hud.show(inMatch)
  input.setInputEnabled(inMatch && !paused())
  if (name === 'garage') openGarage()
  else if (preview) { preview.dispose(); preview = null }
  if (name === 'menu') refreshMenu()
  const first = $$('button:not(:disabled)', document.querySelector('.screen.active') ?? document.body)[0]
  if (!inMatch && first && name !== 'title') first.focus({ preventScroll: true })
}
const paused = () => !$('o-pause').hidden || !$('o-settings').hidden

function refreshMenu() {
  $('m-name').textContent = profile.name.trim() || 'Player'
  $('online-note').hidden = net.enabled
  for (const id of ['m-create', 'm-join']) $(id).disabled = !net.enabled
  $$('#size-seg button').forEach((b) => b.classList.toggle('on', +b.dataset.n === profile.size))
}

// ---- title / menu --------------------------------------------------------
let started = false
function begin() {
  if (started) return
  started = true
  audio.unlock(); audio.setMusic(true)
  if (pendingRoom) {
    if (!net.enabled) { toast('Online play is unavailable'); show('menu'); return }
    if (!profile.name.trim()) { toast('Pick a name to join the room'); return show('garage') }
    return doJoin(pendingRoom)
  }
  show('menu')
}
// preventDefault: begin() focuses the first menu button, and without it the same
// Enter would go on to press that button and drop straight into a match.
addEventListener('keydown', (e) => { if (screen === 'title' && !e.repeat && !['F5', 'F12'].includes(e.code)) { e.preventDefault(); begin() } })
$('s-title').addEventListener('pointerdown', begin)

$('m-offline').onclick = async () => {
  try { await net.playOffline({ ...driver(), teamSize: profile.size }); session = { code: null, offline: true, isHost: true }; startMatchUi() }
  catch (err) { toast(err.message ?? 'Could not start match') }
}
$$('#size-seg button').forEach((b) => (b.onclick = () => { profile.size = +b.dataset.n; saveProfile(); refreshMenu() }))
$('m-create').onclick = async () => {
  try { await net.createRoom({ ...driver(), teamSize: profile.size }) } catch (err) { toast(err.message ?? 'Could not create room') }
}
$('m-join').onclick = () => { $('o-join').hidden = false; $('join-code').value = ''; $('join-code').focus() }
$('m-garage').onclick = () => show('garage')
$('m-settings').onclick = () => { $('o-settings').hidden = false; $('o-settings').querySelector('button').focus() }
$('join-code').oninput = (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
$('join-form').onsubmit = (e) => { e.preventDefault(); const c = $('join-code').value; if (c.length >= 4) { $('o-join').hidden = true; doJoin(c) } }
async function doJoin(code) {
  toast(`Joining ${code}…`)
  try { await net.joinRoom({ ...driver(), code }) } catch (err) { toast(err.message ?? 'Could not join room'); show('menu') }
}

// ---- garage --------------------------------------------------------------
function openGarage() {
  $('g-name').value = profile.name
  const cars = $('g-cars'); cars.replaceChildren()
  for (const k of carKeys) {
    const b = document.createElement('button')
    b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = CARS[k].name ?? k
    b.classList.toggle('on', k === profile.body)
    b.onclick = () => { profile.body = k; paintGarage() }
    cars.append(b)
  }
  preview = createCarPreview($('preview'))
  paintGarage()
}
function paintGarage() {
  $$('#g-cars button').forEach((b, i) => { b.classList.toggle('on', carKeys[i] === profile.body); b.setAttribute('aria-checked', carKeys[i] === profile.body) })
  $$('#g-team button').forEach((b) => b.classList.toggle('on', +b.dataset.t === profile.team))
  document.querySelector('.gpanel').classList.toggle('orange', profile.team === 1)
  $('g-carname').textContent = CARS[profile.body]?.name ?? profile.body
  preview?.setBody(bodyVal(profile.body)); preview?.setTeam(profile.team)
}
$$('#g-team button').forEach((b) => (b.onclick = () => { profile.team = +b.dataset.t; paintGarage() }))
$('g-name').oninput = (e) => (profile.name = e.target.value)
$('g-done').onclick = () => {
  profile.name = $('g-name').value.trim().slice(0, 16)
  saveProfile()
  if (pendingRoom && started) { const c = pendingRoom; pendingRoom = null; return doJoin(c) }
  show('menu')
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) { profile.name = $('g-name').value.trim(); saveProfile(); show('menu') } })

// ---- lobby ---------------------------------------------------------------
function enterLobby({ code, isHost }) {
  session = { code, offline: false, isHost }
  $('l-code').textContent = code
  $('l-start').hidden = !isHost
  $('l-status').textContent = isHost ? 'Share the code or link. Empty slots are filled with bots.' : 'Waiting for the host to start…'
  drawRoster(net.roster?.() ?? [])
  show('lobby')
}
function drawRoster(players) {
  for (const t of [0, 1]) {
    const mine = players.filter((p) => p.team === t)
    const rows = mine.map((p) => `<li>${esc(p.name)}<em>${p.host ? 'HOST' : p.bot ? 'BOT' : ''}</em></li>`)
    while (rows.length < 3) rows.push('<li class="empty">Open slot<em>BOT</em></li>')
    $(`r-${t}`).innerHTML = rows.join('')
  }
}
$('l-copy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${session.code}`
  try { await navigator.clipboard.writeText(url); toast('Invite link copied') } catch { toast(url) }
}
$('l-start').onclick = () => { try { net.beginMatch() } catch (err) { toast(err.message ?? 'Could not start') } }
$('l-leave').onclick = leaveToMenu

// ---- match flow ----------------------------------------------------------
function startMatchUi() {
  hud.reset(); setBallCam(settings.ballCam)
  overInfo = null; matchOverAt = 0
  show('match')
}
function leaveToMenu() {
  closeOverlays()
  net.leave().catch((err) => console.warn('leave failed', err))
  lastState = null
  show('menu')
}
function closeOverlays() { ['o-pause', 'o-settings', 'o-join'].forEach((id) => ($(id).hidden = true)) }
function setPause(on) {
  $('o-pause').hidden = !on
  input.setInputEnabled(screen === 'match' && !on)
  if (on) $('pa-resume').focus()
}
$('pa-resume').onclick = () => setPause(false)
$('pa-settings').onclick = () => { $('o-settings').hidden = false; $('o-settings').querySelector('button').focus() }
$('pa-leave').onclick = leaveToMenu
$$('[data-close]').forEach((b) => (b.onclick = () => { b.closest('.modal').hidden = true; if (screen === 'match') $('pa-resume').focus() }))

function showPost(result) {
  hud.show(false)
  const s = lastState
  const score = s?.score ?? [0, 0]
  const winner = result?.winner ?? (score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1)
  const mvp = result?.mvpId ?? overInfo?.mvpId
  $('p-banner').className = `pbanner ${winner === 0 ? 'blue' : winner === 1 ? 'orange' : ''}`
  $('p-win').textContent = winner < 0 ? 'DRAW' : `${TEAMS[winner]} WINS`
  $('p-score').textContent = `${score[0]}  -  ${score[1]}`
  const me = net.myId()
  const rows = [...(s?.cars ?? [])].sort((a, b) => (a.team === 1) - (b.team === 1) || (b.stats?.score | 0) - (a.stats?.score | 0))
  $('p-board').innerHTML = `<table><tr><th>Player</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th></tr>${rows
    .map((c) => `<tr class="t${c.team === 1 ? 1 : 0}${c.id === me ? ' me' : ''}${c.id === mvp ? ' mvp' : ''}"><td>${esc(c.name)}</td>${['score', 'goals', 'assists', 'saves', 'shots'].map((k) => `<td>${Number(c.stats?.[k]) | 0}</td>`).join('')}</tr>`)
    .join('')}</table>`
  $('p-again').hidden = !session.offline
  show('post')
}
$('p-again').onclick = () => $('m-offline').click()
$('p-menu').onclick = leaveToMenu

// ---- net handlers --------------------------------------------------------
Object.assign(net.handlers, {
  onJoined: (info) => enterLobby(info),
  onRoster: (players) => { if (screen === 'lobby') drawRoster(players) },
  onError: (msg) => toast(typeof msg === 'string' ? msg : (msg?.message ?? 'Network error')),
  onMatchOver: (result) => { overInfo = { ...overInfo, ...result }; matchOverAt ||= performance.now() },
  onClosed: () => { if (screen !== 'menu' && screen !== 'title') { closeOverlays(); lastState = null; show('menu'); toast('Disconnected from room') } },
})

// ---- keyboard / gamepad navigation --------------------------------------
addEventListener('keydown', (e) => {
  if (e.repeat) return
  if (e.code === 'Escape') {
    if (!$('o-settings').hidden) { $('o-settings').hidden = true; if (screen === 'match') $('pa-resume').focus() }
    else if (!$('o-join').hidden) $('o-join').hidden = true
    else if (screen === 'match') setPause($('o-pause').hidden)
    else if (screen === 'garage') $('g-done').click()
    else if (screen === 'lobby') leaveToMenu()
    return
  }
  if (screen === 'match' && !paused()) {
    if (e.code === 'Tab') { e.preventDefault(); hud.setTab(true) }
    if (e.code === 'KeyF') setBallCam(!ballCam)
  }
  if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
    const tag = e.target.tagName
    if (tag === 'INPUT' && e.target.type !== 'range' && tag !== 'BUTTON') return
    moveFocus(e.code === 'ArrowDown' ? 1 : -1); e.preventDefault()
  }
})
addEventListener('keyup', (e) => { if (e.code === 'Tab') hud.setTab(false) })
addEventListener('blur', () => hud.setTab(false))
function moveFocus(d) {
  const scope = [...document.querySelectorAll('.modal')].find((m) => !m.hidden) ?? document.querySelector('.screen.active')
  if (!scope) return
  const list = $$('button:not(:disabled), input, select', scope).filter((x) => x.offsetParent && !x.closest('.seg:not(#size-seg)') )
  const i = list.indexOf(document.activeElement)
  list[(i + d + list.length) % list.length]?.focus()
}
// hover/click blips
document.addEventListener('pointerover', (e) => { if (e.target.closest?.('.mbtn,.btn,.seg button,.cars button') && screen !== 'title') audio.playUi('hover') })
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('button')
  if (b && screen !== 'title') audio.playUi(b.matches('[data-back],[data-close],#l-leave,#p-menu,#pa-leave') ? 'back' : b.id === 'l-start' || b.id === 'm-offline' ? 'start' : 'click')
})

const pad = { prev: [] }
function pollPad() {
  const p = [...(navigator.getGamepads?.() ?? [])].find(Boolean)
  if (!p) return
  const down = (i) => p.buttons[i]?.pressed && !pad.prev[i]
  if (down(9)) { if (screen === 'match') setPause($('o-pause').hidden) }
  if (screen === 'match' && !paused()) { if (down(3)) setBallCam(!ballCam) }
  else {
    if (down(12)) moveFocus(-1)
    if (down(13)) moveFocus(1)
    if (down(0)) (screen === 'title' ? begin() : document.activeElement?.click?.())
    if (down(1)) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))
  }
  pad.prev = p.buttons.map((b) => b.pressed)
}

// ---- frame loop ----------------------------------------------------------
let prev = performance.now()
let mockT0 = 0
function frame(now) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now
  pollPad()

  let s, me
  if (mock === 'hud') { s = mockState(now); me = 'me'; runMockEvents(now, s) }
  else { s = net.sampleState(now); me = net.myId() }
  if (s) lastState = s

  if (s && screen === 'lobby' && s.phase !== 'pregame') startMatchUi()
  if (s && screen === 'match' && session.offline && s.phase === 'pregame' && !session.begun) { session.begun = true; try { net.beginMatch() } catch (err) { console.warn(err) } }

  const live = screen === 'match' && s
  renderer.render(live ? s : null, dt, me)
  if (live) hud.update(s, me)
  audio.update(live ? s : null, me, renderer.camera)

  const events = mock === 'hud' ? [] : net.drainEvents()
  for (const ev of events) {
    if (ev.type === 'matchOver') { overInfo = { ...overInfo, ...ev }; matchOverAt ||= now }
    renderer.onEvent(ev); hud.onEvent(ev, s); audio.onEvent(ev, s, me)
  }
  if (matchOverAt && now - matchOverAt > 3500 && screen === 'match') { matchOverAt = 0; showPost(overInfo) }
  hud.showFps(settings.fps, dt)
}

// fake HUD traffic so the HUD can be checked without a sim: ?mock=hud
const mockScript = [[500, { type: 'countdown', n: 3 }], [1500, { type: 'countdown', n: 2 }], [2500, { type: 'countdown', n: 1 }], [3500, { type: 'countdown', n: 0 }], [5000, { type: 'demo', attackerId: 'bot-1', victimId: 'me' }], [5500, { type: 'save', carId: 'bot-2' }], [6000, { type: 'goal', team: 0, scorerId: 'me', assistId: 'bot-2', speed: 87 }]]
let mockI = 0
function runMockEvents(now, s) {
  mockT0 ||= now
  while (mockI < mockScript.length && now - mockT0 > mockScript[mockI][0]) hud.onEvent(mockScript[mockI++][1], s)
}

// ---- boot ----------------------------------------------------------------
const room = (params.get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
if (room) pendingRoom = room
if (mock) {
  started = true
  const fakeRoster = [{ id: 'me', name: profile.name || 'You', team: 0, host: true }, { id: 'b1', name: 'Bot-1', team: 1, bot: true }, { id: 'p2', name: 'Maverick', team: 1 }]
  if (mock === 'hud') { setPause(false); startMatchUi(); setTimeout(() => params.get('tab') && hud.setTab(true), 0) }
  else if (mock === 'lobby') { enterLobby({ code: 'K7QX', isHost: true }); drawRoster(fakeRoster) }
  else if (mock === 'post') { lastState = mockState(0); overInfo = { winner: 0, mvpId: 'me' }; session.offline = true; showPost(overInfo) }
  else if (mock === 'pause') { startMatchUi(); setPause(true) }
  else if (mock === 'settings') { show('menu'); $('o-settings').hidden = false }
  else show(['menu', 'garage'].includes(mock) ? mock : 'menu')
} else show('title')
requestAnimationFrame(frame)
if (import.meta.env.DEV) window.__carball = { net, renderer }
