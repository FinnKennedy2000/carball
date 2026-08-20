// The kart page. Two ways in from the same screen:
//
//   Solo   — the simulation runs right here against five AI. No account, no
//            Realtime, nothing to reach.
//   Room   — the same simulation, owned by one player's browser and broadcast,
//            over the transport in net.js that the football game already uses.
//            Finish order is the result: first across the line wins.
//
// Sim x maps to world x and sim y to world z, as in render.js, so a positive
// heading is a negated rotation.y.

import * as THREE from 'three'
import * as K from '../shared/kart.js'
import { buildItem } from './kart-items.js'
import { CHASSIS, buildChassis, statList, STAT_LABELS } from './kart-chassis.js'
import { cleanCode } from '../shared/protocol.js'
import { startInput, currentBits, isTyping } from './input.js'
import { resyncPrediction, withPrediction } from './kart-predict.js'
import {
  configure,
  createRoom,
  joinRoom,
  beginMatch,
  sampleState,
  newestSnapshot,
  viewDelay,
  handlers,
  enabled as netEnabled,
} from './net.js'

const el = (id) => document.getElementById(id)

// One palette for both the bodywork and the dot beside a name in the HUD, so a
// kart is the same colour wherever it appears. THREE takes a CSS string.
const COLORS = ['#3b82f6', '#f97316', '#22c55e', '#ef4444', '#a855f7', '#eab308']
const kartColor = (id) => COLORS[(id - 1) % COLORS.length]

/**
 * The item marks. Each is drawn rather than lettered — a mushroom is a
 * mushroom, a shell is a shell — because the slot is read at a glance at speed,
 * and a coloured blob tells you nothing about what pressing space will do.
 * Keyed by ITEMS' key rather than its index, which is a wire format.
 */
const DARK = 'rgba(0,0,0,0.32)'

/** A cap, its spots and a stem: mushroom, golden and mega all come from here. */
const mushroom = (cap, spot = '#fff6e8') => `
  <path d="M5 22 A15 13 0 0 1 35 22 Z" fill="${cap}"/>
  <circle cx="13" cy="16" r="3.1" fill="${spot}"/>
  <circle cx="24" cy="13.5" r="3.8" fill="${spot}"/>
  <circle cx="30" cy="19" r="2.4" fill="${spot}"/>
  <path d="M14 22 H26 V28 A6 5 0 0 1 14 28 Z" fill="#ffeccc"/>
  <path d="M5 22 H35" stroke="${DARK}" stroke-width="1.4" fill="none"/>`

/** A shell: dome, seams and a belly. Green, red and — with wings — spiny. */
const shell = (main, wings = false) => `
  ${wings ? '<path d="M9 17 L1 11 L4 21 Z" fill="#dbe6ff"/><path d="M31 17 L39 11 L36 21 Z" fill="#dbe6ff"/>' : ''}
  <path d="M6 25 A14 13 0 0 1 34 25 Z" fill="${main}"/>
  <path d="M20 12 V25 M10 20 L30 20 M12.5 15.5 L27.5 15.5" stroke="${DARK}" stroke-width="1.5" fill="none"/>
  <path d="M5 25 H35 A4 4 0 0 1 31 30 H9 A4 4 0 0 1 5 25 Z" fill="#fff1cf"/>`

/** Three of something, laid out so the count reads before the shape does. */
const trio = (art) =>
  [[-8, -5, 0.52], [8, -5, 0.52], [0, 8, 0.52]]
    .map(([dx, dy, k]) => `<g transform="translate(${20 + dx} ${20 + dy}) scale(${k}) translate(-20 -20)">${art}</g>`)
    .join('')

const ITEM_ART = {
  boost: { color: '#ef4444', svg: mushroom('#ef4444') },
  banana: {
    color: '#eab308',
    svg: '<path d="M9 9 C10 24 17 31 32 31 C30 23 25 16 18 13 C15 11.5 12 10 9 9 Z" fill="#eab308"/><path d="M9 9 C11 22 18 29 32 31" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.6"/>',
  },
  green: { color: '#22c55e', svg: shell('#22c55e') },
  red: { color: '#ef4444', svg: shell('#ef4444') },
  bolt: {
    color: '#facc15',
    svg: '<path d="M23 5 L10 22 L18 22 L14 35 L30 16 L21.5 16 Z" fill="#facc15"/>',
  },
  star: {
    color: '#ffd166',
    svg: '<path d="M20 6 L24.2 15.6 L34.6 16.7 L26.8 23.6 L29 33.8 L20 28.4 L11 33.8 L13.2 23.6 L5.4 16.7 L15.8 15.6 Z" fill="#ffd166"/><ellipse cx="16.6" cy="19.5" rx="1.7" ry="2.4" fill="#1b1f2a"/><ellipse cx="23.4" cy="19.5" rx="1.7" ry="2.4" fill="#1b1f2a"/>',
  },
  boost3: { color: '#ef4444', svg: trio(mushroom('#ef4444')) },
  banana3: {
    color: '#eab308',
    svg: trio('<path d="M9 9 C10 24 17 31 32 31 C30 23 25 16 18 13 C15 11.5 12 10 9 9 Z" fill="#eab308"/>'),
  },
  green3: { color: '#22c55e', svg: trio(shell('#22c55e')) },
  red3: { color: '#ef4444', svg: trio(shell('#ef4444')) },
  gold: { color: '#f0b429', svg: mushroom('#f0b429', '#fff8dc') },
  fake: {
    color: '#b45309',
    svg: `<path d="M20 5 L34 12.5 V27.5 L20 35 L6 27.5 V12.5 Z" fill="#3b2412" stroke="#b45309" stroke-width="2"/>
      <path d="M15.5 15.5 A4.5 4.5 0 1 1 20 21 V23.5" stroke="#ef4444" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <circle cx="20" cy="28" r="1.7" fill="#ef4444"/>`,
  },
  bomb: {
    color: '#94a3b8',
    svg: `<path d="M22 11 C28 8 33 6 34 4" stroke="#a16207" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <circle cx="35" cy="4" r="2.6" fill="#f59e0b"/>
      <circle cx="18" cy="24" r="11" fill="#1b1f2a"/>
      <circle cx="14" cy="20" r="3" fill="rgba(255,255,255,0.25)"/>`,
  },
  blue: { color: '#3b82f6', svg: shell('#3b82f6', true) },
  pow: {
    color: '#38bdf8',
    svg: `<path d="M6 12 L20 5 L34 12 V28 L20 35 L6 28 Z" fill="#0f2740" stroke="#38bdf8" stroke-width="2"/>
      <text x="20" y="24.5" text-anchor="middle" font-family="Verdana,sans-serif" font-size="10" font-weight="700" fill="#7dd3fc">POW</text>`,
  },
  blooper: {
    color: '#e2e8f0',
    svg: `<path d="M20 6 C27 6 31 11 31 18 V23 H9 V18 C9 11 13 6 20 6 Z" fill="#f1f5f9"/>
      <path d="M11 23 C11 30 9 32 8 35 M16 23 C16 31 15 33 14 36 M24 23 C24 31 25 33 26 36 M29 23 C29 30 31 32 32 35" stroke="#f1f5f9" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <ellipse cx="16" cy="16" rx="2.2" ry="3" fill="#111827"/><ellipse cx="24" cy="16" rx="2.2" ry="3" fill="#111827"/>`,
  },
  mega: {
    color: '#f97316',
    svg: `${mushroom('#f97316')}<path d="M33 15 L37 9 L29 9 Z" fill="#fde68a"/>`,
  },
  bullet: {
    color: '#94a3b8',
    svg: `<path d="M8 13 H24 A9 7 0 0 1 24 27 H8 Z" fill="#334155"/>
      <path d="M8 13 L2 16 V24 L8 27 Z" fill="#1e293b"/>
      <circle cx="22" cy="17.5" r="2" fill="#f8fafc"/><circle cx="22" cy="17.5" r="1" fill="#0f172a"/>
      <path d="M14 22 H26" stroke="#0f172a" stroke-width="1.8" stroke-linecap="round"/>`,
  },
  cloud: {
    color: '#93c5fd',
    svg: `<path d="M12 22 A6 6 0 0 1 14 11 A8 8 0 0 1 29 13 A5.5 5.5 0 0 1 29 22 Z" fill="#bfdbfe"/>
      <path d="M22 21 L14 33 L20 33 L17 39 L27 27 L21 27 Z" fill="#facc15"/>`,
  },
}
/** The stat rows, in STAT_LABELS order: what each is called, and its unit. */
const STAT_NAMES = ['Accel', 'Top speed', 'Grip', 'Turn rate', 'Mass', 'Radius']
const STAT_UNITS = ['m/s²', 'm/s', '', 'rad/s', '×', 'm']

/**
 * The six chassis in profile, for the cards along the bottom of the pick screen.
 * A silhouette at 190×72 is not a job for a WebGL context each — the turntable
 * above the cards shows the real model, and these say which one is which.
 * `--sil` is the paintwork, so the selected card is accented by CSS alone.
 */
const SILHOUETTE = {
  coupe: `<svg viewBox="0 0 190 72" xmlns="http://www.w3.org/2000/svg"><path d="M7.6 61.92 L182.4 61.92" stroke="rgba(233,233,237,0.14)" stroke-width="1"/><circle cx="70.0" cy="50.9" r="11.0" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="70.0" cy="50.9" r="3.3" fill="#8e9ab5" opacity="0.7"/><circle cx="120.0" cy="50.9" r="11.0" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="120.0" cy="50.9" r="3.3" fill="#8e9ab5" opacity="0.7"/><polygon points="55.0,50.9 57.0,33.9 73.0,30.9 85.0,19.9 109.0,18.9 125.0,30.9 135.0,34.9 135.0,50.9" fill="var(--sil)" opacity="0.92"/><polygon points="86.0,21.9 108.0,20.9 121.0,30.5 75.0,31.3" fill="#0b0e14" opacity="0.6"/></svg>`,
  wedge: `<svg viewBox="0 0 190 72" xmlns="http://www.w3.org/2000/svg"><path d="M7.6 61.92 L182.4 61.92" stroke="rgba(233,233,237,0.14)" stroke-width="1"/><circle cx="65.0" cy="51.9" r="10.0" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="65.0" cy="51.9" r="3.0" fill="#8e9ab5" opacity="0.7"/><circle cx="123.0" cy="51.9" r="10.0" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="123.0" cy="51.9" r="3.0" fill="#8e9ab5" opacity="0.7"/><polygon points="51.0,53.9 53.0,35.9 87.0,30.9 119.0,36.9 139.0,44.9 139.0,53.9" fill="var(--sil)" opacity="0.92"/><polygon points="75.0,33.5 99.0,32.3 115.0,37.5 87.0,37.9" fill="#0b0e14" opacity="0.6"/></svg>`,
  van: `<svg viewBox="0 0 190 72" xmlns="http://www.w3.org/2000/svg"><path d="M7.6 61.92 L182.4 61.92" stroke="rgba(233,233,237,0.14)" stroke-width="1"/><circle cx="73.0" cy="49.9" r="12.0" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="73.0" cy="49.9" r="3.6" fill="#8e9ab5" opacity="0.7"/><circle cx="119.0" cy="49.9" r="12.0" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="119.0" cy="49.9" r="3.6" fill="#8e9ab5" opacity="0.7"/><polygon points="59.0,49.9 59.0,14.9 121.0,13.9 131.0,27.9 131.0,49.9" fill="var(--sil)" opacity="0.92"/><polygon points="65.0,17.9 115.0,17.5 125.0,27.5 65.0,27.9" fill="#0b0e14" opacity="0.6"/></svg>`,
  roadster: `<svg viewBox="0 0 190 72" xmlns="http://www.w3.org/2000/svg"><path d="M7.6 61.92 L182.4 61.92" stroke="rgba(233,233,237,0.14)" stroke-width="1"/><circle cx="69.0" cy="51.5" r="10.4" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="69.0" cy="51.5" r="3.1" fill="#8e9ab5" opacity="0.7"/><circle cx="121.0" cy="51.5" r="10.4" fill="#10131c" stroke="#8e9ab5" stroke-width="1.54"/><circle cx="121.0" cy="51.5" r="3.1" fill="#8e9ab5" opacity="0.7"/><polygon points="57.0,52.9 58.0,33.9 79.0,29.9 107.0,28.9 127.0,34.9 133.0,40.9 133.0,52.9" fill="var(--sil)" opacity="0.92"/><polygon points="81.0,31.9 105.0,30.9 119.0,35.9 80.0,35.9" fill="#0b0e14" opacity="0.6"/></svg>`,
  openwheel: `<svg viewBox="0 0 190 72" xmlns="http://www.w3.org/2000/svg"><path d="M7.6 61.92 L182.4 61.92" stroke="rgba(233,233,237,0.14)" stroke-width="1"/><circle cx="72.0" cy="50.3" r="11.6" fill="#10131c" stroke="#cbb98a" stroke-width="1.54"/><circle cx="72.0" cy="50.3" r="3.5" fill="#cbb98a" opacity="0.7"/><circle cx="118.0" cy="50.3" r="11.6" fill="#10131c" stroke="#cbb98a" stroke-width="1.54"/><circle cx="118.0" cy="50.3" r="3.5" fill="#cbb98a" opacity="0.7"/><polygon points="63.0,55.9 65.0,45.9 85.0,44.9 91.0,36.9 105.0,36.9 111.0,45.9 127.0,47.5 127.0,55.9" fill="var(--sil)" opacity="0.92"/><polygon points="92.0,38.3 104.0,38.3 102.0,43.9 93.0,43.9" fill="#0b0e14" opacity="0.6"/></svg>`,
  bike: `<svg viewBox="0 0 190 72" xmlns="http://www.w3.org/2000/svg"><path d="M7.6 61.92 L182.4 61.92" stroke="rgba(233,233,237,0.14)" stroke-width="1"/><circle cx="76.0" cy="49.5" r="12.4" fill="#10131c" stroke="#cbb98a" stroke-width="1.54"/><circle cx="76.0" cy="49.5" r="3.7" fill="#cbb98a" opacity="0.7"/><circle cx="114.0" cy="49.5" r="12.4" fill="#10131c" stroke="#cbb98a" stroke-width="1.54"/><circle cx="114.0" cy="49.5" r="3.7" fill="#cbb98a" opacity="0.7"/><polygon points="73.0,49.9 80.0,37.9 93.0,36.9 106.0,42.9 116.0,45.9 116.0,50.9 99.0,51.9 83.0,50.9" fill="var(--sil)" opacity="0.92"/><polygon points="85.0,35.9 96.0,34.9 101.0,40.9 88.0,40.9" fill="#0b0e14" opacity="0.6"/></svg>`,
}

const SHELL_KINDS = ['green', 'red', 'blue']
const HAZARD_KINDS = ['banana', 'trap', 'bomb']
const ITEM_SCALE = 2.6 // models are about 1.2 across; a kart is KART_R 2.2
const BOX_HALF = 0.43 * ITEM_SCALE // half an item box, which is what it spins about

const AI_NAMES = ['Bolt', 'Ripsaw', 'Comet', 'Nitro', 'Sledge']
const SOLO_ID = 1
const MAX_CATCHUP = 5
const STORED_NAME = 'carball.name'
const STORED_CHASSIS = 'carball.chassis'
const STORED_MAP = 'carball.map'
// The host's map. RANDOM_MAP rather than a key means deal one, which is the
// default and what every race did before there was anything to pick.
const RANDOM_MAP = 'random'

let scene
let camera
let renderer
const kartMeshes = new Map()
const boxMeshes = []
// Everything that is the road rather than the race, in one group: a map change
// throws the group away and builds the next one.
let world = null
let shownTrack = null
let pred = null // the peer's local sim, resynced from every snapshot
let predFrom = -1 // the snapshot tick it was last resynced from
let predicting = true // off makes a peer render the host's word for everything
let mapChoice = RANDOM_MAP // the host's road for the next race

// Two knobs for judging feel in a real room rather than by argument: how far in
// the past the view runs (and whether the host takes the same delay), and
// whether a peer predicts its own kart at all. Both are questions you answer by
// driving, so they are reachable from the console rather than being rebuilt.
globalThis.kartTuning = {
  viewDelay,
  predict(on) {
    if (on !== undefined) predicting = Boolean(on)
    return predicting
  },
}
// Set when the map changes: the camera eases after the kart, and easing it
// across two circuits is a second of flying over scenery nobody is racing on.
let snapCam = false
const shellPool = []
const hazardPool = []
const blastPool = []
const camPos = new THREE.Vector3()
const camAim = new THREE.Vector3()

let race = null // the live state: our own in solo, the sampled snapshot in a room
let myId = SOLO_ID
let solo = true
let isHost = false
let roomCode = null
let roster = []
let results = null // the finishing order, once a room's race is over
let lastFrame = 0
let accumulator = 0
// What the item slot and the effect chips are currently showing, so neither is
// rebuilt on a frame where nothing about them changed.
let shownItem
let shownCount
let shownEffects = ''
// The slot reels through every item before settling on the one you actually
// picked up: which is which matters, and a mark that simply appears is missed
// at the speed the rest of the screen is moving.
const REEL_MS = 900
let heldItem // what the sim says is in the slot, reel or no reel
let reelUntil = 0
let reelAt = 0 // when the reel takes its next step
let reelIndex = 0
// The lap the banner last called, and when the final-lap flash started: a lap
// turning over is a moment, and the banner has to be told to stop showing it.
let calledLap = -1
let flashUntil = 0
// A bolt landing on us: the shrink timer going up is the only signal the sim
// sends, and it is enough — nobody shrinks twice in a frame.
let lastShrink = 0
let boltAt = -9

// Which of the six we are driving, and what pressing Race does once it is
// chosen: the way-in screen defers starting until the pick screen is done with.
let myChassis = K.DEFAULT_CHASSIS
let onPicked = null
let preview = null // the turntable on the pick screen, built the first time it shows

/**
 * The three thirds of the field, and what the box is for in each. The roll table
 * is twelve rows deep, so a third is four of them added up — a band rather than
 * one row, because half the roster only shows up in part of a third and a single
 * row would call those items impossible.
 */
const BANDS = [
  {
    label: 'Front',
    blurb:
      'Out in front the box is deliberately thin: peels, a trap box and a shell or two — things to leave behind you. Nothing in the front third is going to win you the race, only keep it.',
  },
  {
    label: 'Mid',
    blurb:
      'Running mid-field, this is what the box gives you — sorted by how often, straight off the roll table. Fall back and the gold, the star and the bullet take over; lead and you are down to things you throw behind.',
  },
  {
    label: 'Back',
    blurb:
      'Down the back the race is handed to you: the golden mushroom, the star and Bullet Bill, and the lightning that shrinks everyone in front of you at once.',
  },
]

/** What each item is worth in one third of the field, added over its rows. */
function bandWeights(band) {
  const per = K.ROLL_TABLE.length / BANDS.length
  const rows = K.ROLL_TABLE.slice(band * per, (band + 1) * per)
  return K.ITEMS.map((_, i) => rows.reduce((sum, row) => sum + row[i], 0))
}

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)')

configure({
  makeWorker: () => new Worker(new URL('./kart-sim-worker.js', import.meta.url), { type: 'module' }),
  blend: blendKart,
})

initRenderer()
startInput()
wireGate()
showItemSet()
requestAnimationFrame(frame)

// Getting in ----------------------------------------------------------------

function wireGate() {
  const name = el('name')
  name.value = localStorage.getItem(STORED_NAME) || ''
  // An invite link is this page's own URL with the room in the hash, so a code
  // there means someone sent us to a room rather than to the way-in screen.
  const invited = netEnabled ? cleanCode(location.hash.slice(1)) : null
  if (invited) el('code').value = invited
  if (!netEnabled) {
    el('room-side').hidden = true
    el('gate-note').textContent = 'Rooms need a Supabase project configured. Solo works either way.'
  }

  // Nothing starts from this screen any more: every way in goes through the
  // chassis pick, which is where the car is chosen and Race is pressed.
  el('solo').addEventListener('click', () => showPick(startSolo))
  el('create').addEventListener('click', () => showPick(() => enterRoom(null)))
  el('join').addEventListener('click', () => pickThenJoin(el('code').value))
  el('code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pickThenJoin(el('code').value)
  })
  wireMapPick()
  el('pick-race').addEventListener('click', startPicked)
  el('pick-back').addEventListener('click', hidePick)
  // The pick screen is driven from the keyboard as much as from the mouse: the
  // arrows walk the six, Enter takes the one showing, Escape goes back.
  addEventListener('keydown', (e) => {
    if (el('pick').hidden || isTyping()) return
    if (e.key === 'ArrowLeft') stepChassis(-1)
    else if (e.key === 'ArrowRight') stepChassis(1)
    else if (e.key === 'Enter') startPicked()
    else if (e.key === 'Escape') hidePick()
    else return
    e.preventDefault()
  })

  el('start').addEventListener('click', () => beginMatch(pickedMap()))
  el('restart').addEventListener('click', () => {
    if (solo) {
      el('results').hidden = true
      startSolo()
    } else if (isHost) {
      beginMatch(pickedMap())
    }
  })
  el('copy').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#${roomCode}`
    try {
      await navigator.clipboard.writeText(link)
      el('copy').textContent = 'Link copied'
    } catch {
      // No clipboard outside a secure context — the code is the shareable part.
      el('copy').textContent = `Room code ${roomCode}`
    }
  })

  handlers.onJoined = (msg) => {
    myId = msg.id
    roomCode = msg.code
    solo = false
    el('gate').hidden = true
    el('room-strip').hidden = false
    el('room-code').textContent = msg.code
    el('start').hidden = !isHost
    el('map-pick').hidden = !isHost
    location.hash = msg.code // a refresh rejoins rather than opening a room
  }
  handlers.onRoster = (players) => {
    roster = players
  }
  handlers.onError = (reason) => {
    el('gate-note').textContent = reason
    el('gate').hidden = false
  }
  handlers.onMatchOver = (_score, players) => {
    results = players.map((p) => ({ ...p, me: p.id === myId }))
  }

  // Arriving on someone's link goes straight into their room, exactly as the
  // football page does it. Without a name to send there is nothing to do but
  // ask for one — the code is already in the box, so Join is one press away.
  if (invited) join(invited)

  // A link pasted into a tab that is already on this page changes the hash
  // without reloading anything, so the load-time check above never runs — the
  // link would look broken. onJoined sets the hash itself, hence the guard.
  addEventListener('hashchange', () => {
    const code = netEnabled ? cleanCode(location.hash.slice(1)) : null
    if (code && code !== roomCode) {
      el('code').value = code
      join(code)
    }
  })

  /** Straight in if we have a name to send, otherwise ask for one. */
  function join(code) {
    if (name.value) pickThenJoin(code)
    else {
      el('gate').hidden = false
      el('gate-note').textContent = `Room ${code} — your name, then Join.`
      name.focus()
    }
  }
}

/**
 * The item set on the way-in screen: each mark, what it does, and how often the
 * box hands it to you where you are running. Drawn from the sim's own weight
 * table rather than a copy of it.
 */
function showItemSet(band = 1) {
  el('band-switch').innerHTML = BANDS.map(
    (b, i) =>
      `<button role="tab" data-band="${i}" aria-selected="${i === band}">${b.label}</button>`
  ).join('')
  for (const button of el('band-switch').children) {
    button.addEventListener('click', () => showItemSet(Number(button.dataset.band)))
  }
  el('items-blurb').textContent = BANDS[band].blurb

  const weights = bandWeights(band)
  const max = Math.max(...weights)
  // Commonest first, so the list reads as what to expect rather than as the
  // order the table happens to be written in. The ones that never come up sort
  // to the bottom on their own.
  const order = K.ITEMS.map((item, i) => ({ item, weight: weights[i] })).sort(
    (a, b) => b.weight - a.weight
  )
  const row = ({ item, weight }) => {
    const art = ITEM_ART[item.key]
    const count = item.count ?? 1
    return `<div class="item-row${weight > 0 ? '' : ' off'}" style="--item:${art.color}">
      <span class="mark"><svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">${art.svg}</svg></span>
      <span class="what">
        <span class="name">${item.name}${count > 1 ? ` <em>×${count}</em>` : ''}</span>
        <span class="hint">${item.hint}</span>
      </span>
      <span class="bar">${weight > 0 ? `<i style="width:${(weight / max) * 100}%"></i>` : ''}</span>
    </div>`
  }
  const half = Math.ceil(order.length / 2)
  el('items-grid').innerHTML = [order.slice(0, half), order.slice(half)]
    .map((column) => `<div class="col">${column.map(row).join('')}</div>`)
    .join('')
}

function saveName() {
  const value = el('name').value.trim().slice(0, 16) || 'You'
  localStorage.setItem(STORED_NAME, value)
  return value
}

// Picking a chassis ---------------------------------------------------------
// The screen between the name and the grid. It is the same six cars the sim
// races and the same numbers it races them on: everything below reads
// CHASSIS_STATS rather than a copy of it, so a chassis tuned in the sim is a
// chassis tuned here.

/** The room code, checked before we spend a screen choosing a car for it. */
function pickThenJoin(code) {
  const clean = cleanCode(code || '')
  if (!clean) {
    el('gate-note').textContent = 'A room code is four letters.'
    return
  }
  showPick(() => enterRoom(clean))
}

/**
 * The host's map list: Random first, then the roads. Only the host ever sees it
 * — a joiner has no say — and the choice is remembered, so a host who always
 * wants the same road says so once rather than every race.
 */
function wireMapPick() {
  const stored = localStorage.getItem(STORED_MAP)
  mapChoice = stored === RANDOM_MAP || K.TRACKS[stored] ? stored : RANDOM_MAP
  const map = el('map')
  map.innerHTML =
    `<option value="${RANDOM_MAP}">Random</option>` +
    K.TRACK_KEYS.map((key) => `<option value="${key}">${escapeHtml(K.TRACKS[key].name)}</option>`).join('')
  map.value = mapChoice
  map.addEventListener('change', () => {
    mapChoice = map.value
    localStorage.setItem(STORED_MAP, mapChoice)
  })
}

/** The road the next race should be on, or nothing at all for a random one. */
function pickedMap() {
  return mapChoice === RANDOM_MAP ? null : mapChoice
}

/** Show the pick screen; `race` is what pressing Race finally does. */
function showPick(race) {
  onPicked = race
  const stored = localStorage.getItem(STORED_CHASSIS)
  myChassis = K.CHASSIS_STATS[stored] ? stored : K.DEFAULT_CHASSIS
  el('gate').hidden = true
  el('pick').hidden = false
  el('pick-list').innerHTML = K.CHASSIS_KEYS.map(
    (key) => `<button type="button" class="chassis" data-key="${key}">
      <span class="top"><b>${CHASSIS[key].name}</b><em>${CHASSIS[key].note}</em></span>
      ${SILHOUETTE[key]}
    </button>`
  ).join('')
  for (const button of el('pick-list').children) {
    button.addEventListener('click', () => choose(button.dataset.key))
  }
  showChassis()
  el('pick-race').focus()
}

/** Race, in whichever of the two ways brought us to this screen. */
function startPicked() {
  const race = onPicked
  onPicked = null
  el('pick').hidden = true
  race?.()
}

function hidePick() {
  onPicked = null
  el('pick').hidden = true
  el('gate').hidden = false
}

function choose(key) {
  myChassis = key
  localStorage.setItem(STORED_CHASSIS, key)
  showChassis()
}

/** Step through the six, which is what the arrow keys do. */
function stepChassis(by) {
  const i = K.CHASSIS_KEYS.indexOf(myChassis)
  choose(K.CHASSIS_KEYS[(i + by + K.CHASSIS_KEYS.length) % K.CHASSIS_KEYS.length])
}

/** The selected car: its model on the turntable, and its numbers beside it. */
function showChassis() {
  const entry = CHASSIS[myChassis]
  for (const button of el('pick-list').children) {
    button.setAttribute('aria-pressed', String(button.dataset.key === myChassis))
  }
  el('pick-name').textContent = entry.name
  el('pick-tag').textContent = entry.note
  el('pick-blurb').textContent = entry.blurb
  el('pick-lap-time').innerHTML = `${entry.lap.toFixed(2)}<i>s</i>`

  // Six bars, each against the Coupe: the fill is where this chassis sits in the
  // spread of all six, the notch is where the Coupe sits, and the number on the
  // right is the difference. Accel, top speed, grip and turn are gains; mass and
  // radius are a trade, and are drawn in the trim colour rather than the accent.
  const stats = statList(myChassis)
  const base = statList('coupe')
  el('pick-bars').innerHTML = STAT_LABELS.map((label, i) => {
    const all = K.CHASSIS_KEYS.map((key) => K.CHASSIS_STATS[key][label])
    const lo = Math.min(...all)
    const span = Math.max(...all) - lo || 1
    const at = (v) => 12 + ((v - lo) / span) * 80
    const delta = stats[i] - base[i]
    const gain = i < 4
    return `<div class="stat-row${gain ? ' good' : ''}" style="--stat:${gain ? 'var(--color-accent)' : 'var(--color-trim, #cbb98a)'}">
      <span class="label">${STAT_NAMES[i]}</span>
      <span class="bar"><i style="width:${at(stats[i]).toFixed(1)}%"></i><u style="left:${at(base[i]).toFixed(1)}%"></u></span>
      <span class="value">${stats[i]}${STAT_UNITS[i] ? `<span> ${STAT_UNITS[i]}</span>` : ''}</span>
      <span class="delta">${delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${Number(delta.toFixed(2))}`}</span>
    </div>`
  }).join('')

  showPreview()
}

/**
 * The car on the turntable: the model the race itself will put on the grid,
 * built by the same buildChassis the workbench uses. Its own small renderer —
 * the race's canvas is behind this screen, and the race has not started.
 */
function showPreview() {
  const view = el('pick-view')
  if (!preview) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    view.append(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x141824, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(4, 7, 5)
    scene.add(key)
    // A fill from below and behind, or the wheels and the underside are one
    // black mass against a dark panel and the car reads as a floating box.
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.6)
    fill.position.set(-5, 1.5, -4)
    scene.add(fill)
    // A long lens: the panel is wide and shallow, and at a wider angle the car
    // sits in the middle of it looking further away than it is.
    const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 100)
    preview = { renderer, scene, camera, car: null, turn: 0 }
  }
  if (preview.car) preview.scene.remove(preview.car)
  preview.car = buildChassis(myChassis)
  // Painted the colour this kart will be on the track, so the pick and the car
  // that comes out of it are recognisably the same thing.
  preview.car.traverse((part) => {
    if (part.isMesh && part.material.name === 'paint') part.material.color.set(kartColor(myId))
  })
  preview.scene.add(preview.car)
  const size = new THREE.Box3().setFromObject(preview.car).getSize(new THREE.Vector3())
  // Far enough back that the longest car is inside the frame with room to
  // spare, so the six do not jump about as they are stepped through.
  preview.reach = Math.max(size.x, size.z) * 1.7
  preview.lift = size.y * 0.55
  el('pick-size').textContent = `${size.x.toFixed(1)}m × ${size.z.toFixed(1)}m`
}

/** One frame of the turntable. Called from the render loop while it is up. */
function drawPreview(dt) {
  const view = el('pick-view')
  const w = view.clientWidth
  const h = view.clientHeight
  if (!w || !h) return
  const { renderer, scene, camera } = preview
  if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false)
    camera.aspect = w / h
  }
  preview.turn += dt * 0.5
  camera.position.set(
    Math.cos(preview.turn) * preview.reach,
    preview.reach * 0.28,
    Math.sin(preview.turn) * preview.reach
  )
  camera.lookAt(0, preview.lift, 0)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
}

function startSolo() {
  const name = saveName()
  solo = true
  myId = SOLO_ID
  results = null
  shownItem = undefined
  heldItem = undefined
  reelUntil = 0
  calledLap = -1
  flashUntil = 0
  el('gate').hidden = true
  el('room-strip').hidden = true
  const racers = [{ id: SOLO_ID, name, ai: false, chassis: myChassis }]
  AI_NAMES.forEach((n, i) => racers.push({ id: i + 2, name: n, ai: true }))
  const seed = (Math.random() * 2 ** 32) >>> 0
  race = K.createRace(racers, seed, K.trackFor(seed, race?.track ?? null))
  K.begin(race)
  clearKarts()
  accumulator = 0
  lastFrame = performance.now()
}

async function enterRoom(code) {
  const name = saveName()
  const clean = cleanCode(code || '')
  if (code && !clean) {
    el('gate-note').textContent = 'A room code is four letters.'
    return
  }
  el('gate-note').textContent = clean ? 'Joining…' : 'Opening a room…'
  results = null
  clearKarts()
  try {
    isHost = !clean
    // Team and car mean nothing in a race; the channel's hello carries them
    // because it is the football game's message, and they are simply ignored.
    if (clean) await joinRoom(name, clean, null, 0, myChassis)
    else await createRoom(name, null, 0, 'kart', myChassis)
  } catch (err) {
    isHost = false
    el('gate-note').textContent = err?.message ?? 'Could not reach the room.'
  }
}

function clearKarts() {
  for (const [, mesh] of kartMeshes) scene.remove(mesh)
  kartMeshes.clear()
}

/** Two snapshots straddling the render moment. Bodies move; the rest is discrete. */
function blendKart(a, b, t) {
  const prev = new Map(a.karts.map((k) => [k.id, k]))
  return {
    ...b,
    phase: a.phase,
    timer: a.timer,
    time: a.time,
    karts: b.karts.map((kb) => {
      const ka = prev.get(kb.id)
      if (!ka) return kb // joined between snapshots
      return {
        ...kb,
        x: lerp(ka.x, kb.x, t),
        y: lerp(ka.y, kb.y, t),
        heading: lerpAngle(ka.heading, kb.heading, t),
      }
    }),
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// Frame ---------------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame)
  const dt = 1 / 60
  accumulator += Math.min(0.25, (now - lastFrame) / 1000)
  lastFrame = now

  if (solo && race) {
    let steps = 0
    while (accumulator >= dt && steps < MAX_CATCHUP) {
      K.step(race, { [myId]: currentBits() })
      accumulator -= dt
      steps++
    }
    if (accumulator >= dt) accumulator = 0
  } else if (!solo) {
    // In a room the input goes over the channel on its own timer, and the state
    // is whatever the host last said it was.
    race = sampleState() ?? race
    // ...except our own kart, which we can work out sooner than the host can
    // tell us. The host itself is already looking at its own live sim.
    if (predicting && !isHost && race) {
      const snap = newestSnapshot()
      // Not across a change of map: the sim reads the loaded track, so a
      // snapshot from the next one has to wait for buildWorld below.
      if (snap && snap.track === shownTrack && snap.tick !== predFrom) {
        pred = resyncPrediction(pred, snap, myId)
        predFrom = snap.tick
      }
      if (pred) {
        let steps = 0
        while (accumulator >= dt && steps < MAX_CATCHUP) {
          K.step(pred, { [myId]: currentBits() })
          accumulator -= dt
          steps++
        }
        if (accumulator >= dt) accumulator = 0
        race = withPrediction(race, pred, myId)
      }
    }
  }

  if (race) {
    // The map is on the state, which covers both a solo race that has just dealt
    // itself one and a room whose host has moved on to the next track.
    if (race.track && race.track !== shownTrack) {
      shownTrack = K.setTrack(race.track)
      pred = null
      predFrom = -1
      buildWorld()
      clearKarts()
      snapCam = true
    }
    draw()
    updateHud()
  }
  renderer.render(scene, camera)
  // The turntable on the pick screen turns on the same clock, and only while
  // that screen is up: there is nothing else on it that moves.
  if (preview && !el('pick').hidden) drawPreview(Math.min(0.25, (now - lastFrame) / 1000) || 1 / 60)
}

// Scene ---------------------------------------------------------------------

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: el('view'), antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0e14)
  scene.fog = new THREE.Fog(0x0b0e14, 120, 320)

  camera = new THREE.PerspectiveCamera(60, 1, 1, 900)
  camera.position.set(0, 40, 90)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x1a2b1c, 1.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-60, 120, 40)
  scene.add(sun)

  buildWorld()
  resize()
  addEventListener('resize', resize)
}

function buildWorld() {
  // The old road, gone with its buffers. A race lasts minutes, but the ribbons
  // and the boxes are the biggest geometry on the page and leaving a dozen laps'
  // worth of them on the GPU is a leak you would feel.
  if (world) {
    scene.remove(world)
    world.traverse((o) => o.geometry?.dispose())
    boxMeshes.length = 0
  }
  world = new THREE.Group()
  scene.add(world)

  // Far below the lowest dip, so the hills never poke through it: at this
  // distance it is a horizon rather than ground you look at.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(K.TRACK_R * 2.2, 64),
    new THREE.MeshStandardMaterial({ color: 0x16301f, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -34
  world.add(ground)

  // The road's width varies around the lap, so every strip is built from
  // halfWidthAt rather than one number — the tarmac you see is the tarmac the
  // physics grips. The kerb stops where the drops are; the road does not.
  const half = (i) => K.halfWidthAt(K.TRACK.cum[i])
  const gone = (i) => K.overVoid(K.TRACK.cum[i]) || K.jumpAt(K.TRACK.cum[i]) !== null
  const solid = (i) => !gone(i) && !gone((i + 1) % K.TRACK_N)
  // The jumps take the tarmac with them, which the voids do not: over one of
  // those two the road simply is not there, and neither is anything under it.
  const gap = (i) => K.jumpAt(K.TRACK.cum[i]) !== null
  const road = (i) => !gap(i) && !gap((i + 1) % K.TRACK_N)

  // Grass that climbs with the road, so the tarmac is laid on a hillside rather
  // than floating over a flat green plate. Kept in close: pushed much further
  // out, the inside of the hairpin folds over itself.
  world.add(ribbon((i) => half(i) + 22, -0.35, 0x1c3a26, 1, solid))
  // Only where the ground gives out: the drop. No wider than the grass it
  // replaces, or it wedges out past the hillside as a black shard, and far
  // enough down to read as somewhere you would not want to be.
  world.add(ribbon((i) => half(i) + 22, -14, 0x05070c, 1, (i) => !solid(i)))
  world.add(ribbon((i) => half(i) + K.KERB, 0.01, 0x6b4a22, 1, solid)) // the kerb, then
  world.add(ribbon(half, 0.03, 0x49536b, 1, road)) // the tarmac on top of it
  // The racing line, in dashes rather than one continuous stripe: a solid line
  // gives the eye nothing to track, and the dashes flicking past the nose are
  // most of what tells you how fast you are actually going.
  world.add(dashes(0.4, 0.05, 0xffffff, 0.4, road))

  // The barrier, as a wall either side — with the void stretches left open,
  // which is what makes them look like somewhere you can go off.
  for (const side of [1, -1]) {
    world.add(wall((i) => side * (half(i) + K.KERB), 2.4, solid))
  }

  buildFinish()
  buildPads()

  // Item boxes: one model per spot, hidden while that box is on its cooldown.
  for (const box of K.boxSpots()) {
    // Hung inside a pivot with the cube's own centre on the origin: the model
    // is built standing on its base, and spinning that about the base is what
    // buried half of every box in the road.
    const model = buildItem('box')
    model.scale.setScalar(ITEM_SCALE)
    model.position.y = -BOX_HALF
    const mesh = new THREE.Group()
    mesh.add(model)
    mesh.position.set(box.x, K.heightAt(box.s) + BOX_HALF + 0.6, box.y)
    world.add(mesh)
    boxMeshes.push(mesh)
  }
}

/**
 * The boost pads: a painted band with chevrons pointing the way you are going.
 * One texture between all of them, and one plane each. Turned to the road's
 * heading and pitched to its gradient, or a flat panel laid on a hillside cuts
 * into the tarmac at one end and floats off it at the other.
 */
function buildPads() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const g = canvas.getContext('2d')
  g.fillStyle = '#241f3d'
  g.fillRect(0, 0, 128, 64)
  g.strokeStyle = '#8bffe4'
  g.lineWidth = 11
  g.lineCap = 'butt'
  // Three chevrons pointing along +x, which the plane below lines up with the
  // direction of travel.
  for (const x of [14, 54, 94]) {
    g.beginPath()
    g.moveTo(x, 6)
    g.lineTo(x + 26, 32)
    g.lineTo(x, 58)
    g.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.MeshBasicMaterial({ map: texture })

  for (const pad of K.padSpots()) {
    // Length along the road first, width across it second: the geometry is laid
    // flat here so the mesh's own axes match a kart's, and the same rotation
    // order then works for both.
    const geo = new THREE.PlaneGeometry(K.PAD_LENGTH, pad.halfWidth * 2)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(pad.x, K.heightAt(pad.s) + 0.06, pad.y)
    mesh.rotation.set(0, -pad.heading, Math.atan(K.slopeAt(pad.s)), 'YZX')
    world.add(mesh)
  }
}

/**
 * The line, as something you can see coming: a chequered band across the road
 * under a gantry over it. A painted stripe is invisible until you are on top of
 * it, which is no way to know where a race ends.
 */
function buildFinish() {
  const p = K.pointAt(0)
  const half = K.halfWidthAt(0)
  const base = K.heightAt(0)
  // Along the road, and across it. Everything below is placed in those two.
  const ax = p.tx
  const az = p.ty
  const bx = -p.ty
  const bz = p.tx

  const squares = 14
  const size = (half * 2) / squares
  const light = new THREE.MeshBasicMaterial({ color: 0xf3f5fe })
  const dark = new THREE.MeshBasicMaterial({ color: 0x11151d })
  const tile = new THREE.PlaneGeometry(size, size)
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < squares; col++) {
      const mesh = new THREE.Mesh(tile, (row + col) % 2 === 0 ? light : dark)
      const across = -half + size * (col + 0.5)
      const along = size * (row - 0.5)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(p.x + bx * across + ax * along, base + 0.07, p.y + bz * across + az * along)
      world.add(mesh)
    }
  }

  // The gantry: a post either side of the road and a beam across the top, so
  // the finish is a thing on the horizon rather than a mark on the floor.
  const postH = 9
  const postGeo = new THREE.BoxGeometry(1.2, postH, 1.2)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x596b8c, flatShading: true })
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(postGeo, postMat)
    const across = side * (half + 1.6)
    post.position.set(p.x + bx * across, base + postH / 2, p.y + bz * across)
    world.add(post)
  }
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry((half + 2.2) * 2, 2.2, 1),
    new THREE.MeshStandardMaterial({ color: 0x9184d9, emissive: 0x2b2741, flatShading: true }),
  )
  beam.position.set(p.x, base + postH - 1, p.y)
  // Its length runs across the road, not along it: a turn about y maps the
  // box's own +x onto the across vector.
  beam.rotation.y = Math.atan2(-bz, bx)
  world.add(beam)
}

/**
 * A flat strip following the centre line. `halfWidth` is a function of the node
 * index, and `keep` decides which segments are drawn at all.
 */
function ribbon(halfWidth, y, color, opacity = 1, keep) {
  // `y` is a height above the road now, not a height above the world.
  const geo = strip(halfWidth, (x, z, i) => [x, nodeY(i) + y, z], keep)
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
  )
}

/** Every other segment of the centre line, as a flat dash. */
function dashes(halfWidth, y, color, opacity, keep = () => true) {
  const pts = K.TRACK.pts
  const verts = []
  const idx = []
  for (let i = 0; i < pts.length; i += 2) {
    if (!keep(i)) continue
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / len) * halfWidth
    const nz = ((b.x - a.x) / len) * halfWidth
    const v = verts.length / 3
    const ay = nodeY(i) + y
    const by = nodeY((i + 1) % pts.length) + y
    verts.push(a.x + nx, ay, a.y + nz, a.x - nx, ay, a.y - nz, b.x + nx, by, b.y + nz, b.x - nx, by, b.y - nz)
    idx.push(v, v + 2, v + 1, v + 2, v + 3, v + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }),
  )
}

/** A vertical band standing on the polyline, offset sideways by `offset(i)`. */
function wall(offset, height, keep) {
  const n = K.TRACK.pts.length
  const verts = []
  for (let i = 0; i < n; i++) {
    const [ox, oz] = offsetPoint(i, offset(i))
    verts.push(ox, nodeY(i), oz, ox, nodeY(i) + height, oz)
  }
  return new THREE.Mesh(
    geometryFrom(verts, n, keep),
    new THREE.MeshStandardMaterial({ color: 0x596b8c, roughness: 0.8, side: THREE.DoubleSide }),
  )
}

function strip(halfWidth, place, keep) {
  const n = K.TRACK.pts.length
  const verts = []
  for (let i = 0; i < n; i++) {
    const [lx, lz] = offsetPoint(i, halfWidth(i))
    const [rx, rz] = offsetPoint(i, -halfWidth(i))
    verts.push(...place(lx, lz, i), ...place(rx, rz, i))
  }
  return geometryFrom(verts, n, keep)
}

/** How high the road stands at polyline node `i`. */
function nodeY(i) {
  return K.heightAt(K.TRACK.cum[i])
}

/** The road's height under any point on the map, for the things that move. */
function groundY(x, z) {
  return K.heightAt(K.project(x, z).s)
}

/** Node `i` of the centre line, pushed sideways onto its own normal. */
function offsetPoint(i, offset) {
  const pts = K.TRACK.pts
  const a = pts[i]
  const b = pts[(i + 1) % pts.length]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return [a.x - ((b.y - a.y) / len) * offset, a.y + ((b.x - a.x) / len) * offset]
}

/**
 * Two vertices per node, closed back onto the first: a ring of quads. `keep`
 * drops the segment that starts at a node, which is how the scenery is left out
 * over a drop without building a separate mesh per run of road.
 */
function geometryFrom(verts, n, keep = () => true) {
  const idx = []
  for (let i = 0; i < n; i++) {
    if (!keep(i)) continue
    const a = i * 2
    const b = ((i + 1) % n) * 2
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function makeKart(color, claimed) {
  const group = new THREE.Group()
  // The car is the chassis the driver picked — the same model the workbench
  // shows, at its real length in metres — painted the side's colour by way of
  // the material every builder names `paint`. The key arrives in a snapshot off
  // the channel, so an unrecognised one is a Coupe: buildChassis throws on a
  // name it does not know, and it is called every frame a kart is on screen.
  const key = K.CHASSIS_STATS[claimed] ? claimed : K.DEFAULT_CHASSIS
  const car = buildChassis(key)
  const parts = []
  car.traverse((part) => {
    if (!part.isMesh) return
    parts.push(part)
    if (part.material.name === 'paint') part.material.color.set(color)
  })
  group.add(car)
  // How big it turned out, so everything hung off it below is placed against
  // the car rather than against the one box this used to be: a Bike is 2.5m of
  // kart and a Van is 4.1m, and jets sized for a Coupe read as neither.
  const size = new THREE.Box3().setFromObject(car).getSize(new THREE.Vector3())
  const k = size.x / 4 // against the Coupe, which is what the numbers below fitted
  const wide = K.CHASSIS_STATS[key].radius / K.KART_R

  // Each wheel group turns twice: about y for the steering it is doing and about
  // z for the roll — one Euler, in that order, so the steering is applied to a
  // rolling wheel rather than the roll landing on an axis the steering moved.
  // The rolling radius comes off the tyre itself, or small wheels visibly slip.
  const wheels = car.children
    .filter((child) => child.name.startsWith('wheel'))
    .map((wheel) => ({
      wheel,
      front: wheel.position.x > 0,
      r: wheel.children[0]?.geometry.parameters.radiusTop ?? 0.35,
    }))

  // Everything below is built once, hidden, and switched on by dressKart. A
  // kart under an item has to read at a glance from behind at 70 m/s, and a
  // tint on the paintwork does not survive that. parts[0] is the bodywork,
  // which is the piece an emissive goes on.
  const body = parts.find((part) => part.material.name === 'paint') ?? parts[0]
  parts.sort((a, b) => (a === body ? -1 : b === body ? 1 : 0))

  // Bullet Bill: the kart does not carry the bullet, the kart becomes it. The
  // model is the same one the item roster shows, built at about 1.5 units and
  // scaled up to a kart — one bullet in the codebase, not two that drift apart.
  const bullet = buildItem('bullet')
  bullet.scale.setScalar(3.1)
  bullet.position.y = 0.3
  bullet.visible = false
  group.add(bullet)

  // Twin jets out of the back, for a Mushroom, a pad or a mini-turbo alike.
  const flames = []
  for (const side of [1, -1]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.5 * k, 3 * k, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0.85 }),
    )
    flame.rotation.z = Math.PI / 2 // pointing backwards, out of the tail
    flame.position.set(-size.x / 2 - 1.2 * k, size.y * 0.4, side * size.z * 0.28)
    flame.visible = false
    group.add(flame)
    flames.push(flame)
  }

  // Drift sparks off the rear wheels: this is how you know when to let go.
  const sparks = []
  for (const side of [1, -1]) {
    const spark = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55 * k, 0),
      new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0.9 }),
    )
    spark.position.set(-size.x * 0.35, size.y * 0.25, side * (size.z / 2 + 0.2))
    spark.visible = false
    group.add(spark)
    sparks.push(spark)
  }

  // A star does not tint the paint, it lights the road: a ring on the tarmac
  // that other karts drive through, pulsing at 800ms and twice as fast over the
  // last second, which is the warning.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(2.6 * wide, 3.4 * wide, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = 0.12
  halo.visible = false
  group.add(halo)

  // The thundercloud sits over the roof and lights the top surfaces only, so a
  // carrier is obvious from any angle — which is the whole point of a hot
  // potato. Three lumps and a ring that closes as the eight seconds run down.
  const cloud = new THREE.Group()
  for (const [cx, cy, cz, r] of [[0, 0, 0, 1.5], [1.1, -0.2, 0.5, 1.1], [-1.1, -0.15, -0.4, 1.2]]) {
    const puff = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      new THREE.MeshStandardMaterial({ color: 0x3b4256, flatShading: true, emissive: 0x000000 }),
    )
    puff.position.set(cx, cy, cz)
    cloud.add(puff)
  }
  const fuseRing = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 2.2, 24),
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  )
  fuseRing.rotation.x = -Math.PI / 2
  fuseRing.position.y = -1.4
  cloud.add(fuseRing)
  // Over the roof, whatever the roof is: a Bike's storm should not float a metre
  // above it. dressKart bobs it about this, so the height travels with it.
  cloud.position.y = size.y + 2.9
  cloud.userData.base = cloud.position.y
  cloud.visible = false
  group.add(cloud)

  // Ink on the bonnet, as well as over the victim's own camera: being inked is
  // public, and the kart in front should be able to see that it happened.
  const splat = new THREE.Mesh(
    new THREE.CircleGeometry(0.85 * k, 12),
    new THREE.MeshBasicMaterial({ color: 0x0a0c12, transparent: true, opacity: 0.9 }),
  )
  splat.rotation.x = -Math.PI / 2
  splat.position.set(size.x * 0.22, size.y * 0.92, 0.2)
  splat.visible = false
  group.add(splat)

  // Everything the grace-period fade touches. The bullet is a group, so its own
  // pieces go in the list rather than the group.
  const fade = [...parts, ...bullet.children]
  // What the last frame saw, so a spend, a boost or a turn can be animated from
  // state alone: the sim sends no events, and it should not have to.
  const anim = { item: null, count: 0, boost: 0, spentAt: -9, boostAt: -9, heading: null, steer: 0 }
  group.userData = { parts, bullet, flames, sparks, fade, wheels, halo, cloud, fuseRing, splat, anim }
  return group
}

/**
 * What an item looks like from the driving seat. The sim already carries every
 * timer this reads; nothing here is allocated per frame — each part was built
 * with the kart and is only shown or hidden.
 */
function dressKart(mesh, kart, t) {
  const { parts, bullet, flames, sparks, fade, wheels, halo, cloud, fuseRing, splat, anim } =
    mesh.userData
  const [body] = parts
  const flying = kart.bullet > 0
  for (const part of parts) part.visible = !flying
  bullet.visible = flying

  // Boost, from a Mushroom, a pad or a mini-turbo. The jets shorten as it runs
  // out, and flicker, so the tail of a boost is visible before it ends.
  // Not while flying: the bullet model carries its own exhaust, and the kart's
  // two jets stick out either side of it like ears.
  const jet = flying ? 0 : Math.min(1, kart.boost / 0.6)
  for (const flame of flames) {
    flame.visible = jet > 0
    if (!flame.visible) continue
    const flicker = 0.75 + 0.25 * Math.sin(t * 40 + flame.position.z)
    flame.scale.set(1, jet * flicker, 1)
  }

  // The drift charge, in the colour the game this clones uses: orange first,
  // blue when it is worth holding on for.
  const tier = K.driftTier(kart)
  for (const spark of sparks) {
    spark.visible = tier > 0
    if (!spark.visible) continue
    spark.material.color.setHex(tier > 1 ? 0x7ec8ff : 0xffa63d)
    spark.scale.setScalar(0.7 + 0.3 * Math.sin(t * 30 + spark.position.z))
  }

  // A star cycles rather than sitting on one yellow, a mega glows and breathes,
  // and everything else leaves the paint alone.
  if (kart.star > 0) body.material.emissive.setHSL((t * 0.7) % 1, 0.85, 0.5)
  else if (kart.mega > 0) body.material.emissive.setHex(0x8a3d00)
  else body.material.emissive.setHex(0x000000)

  // Immune after a hit: the kart fades in and out for as long as the grace
  // period runs. It reads on other karts as much as on your own — a blinking
  // kart is one there is no point throwing anything at. Every part fades, or a
  // ghosted body drives past on four solid wheels.
  const fading = kart.grace > 0 && kart.respawn === 0
  for (const part of fade) {
    part.material.transparent = fading
    part.material.opacity = fading ? 0.55 + 0.45 * Math.sin(t * 16) : 1
  }

  // A star lights the road under it rather than tinting the paint. The pulse
  // halves over the last second: that is the only warning the item ends, and it
  // needs no HUD text.
  halo.visible = kart.star > 0
  if (halo.visible) {
    const period = kart.star < 1 ? 0.4 : 0.8
    const beat = 0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2)
    halo.scale.setScalar(0.9 + beat * 0.35)
    halo.material.opacity = 0.25 + beat * 0.5
  }

  // Carrying the storm: the cloud drifts over the roof, flickers on the top
  // surfaces only, and its ring closes as the seconds go.
  cloud.visible = kart.cloud > 0
  if (cloud.visible) {
    cloud.position.y = cloud.userData.base + Math.sin(t * 1.6) * 0.3
    cloud.rotation.y = Math.sin(t * 0.7) * 0.4
    // A strike is a flicker, not a steady lamp — brief, and irregular enough
    // that it does not read as a running animation.
    const strike = Math.sin(t * 21) > 0.86 ? 1 : 0
    for (const puff of cloud.children) {
      if (puff.material.emissive) puff.material.emissive.setHex(strike ? 0x9fd0ff : 0x000000)
    }
    fuseRing.scale.setScalar(Math.max(0.15, kart.cloud / 8))
    fuseRing.material.opacity = kart.cloud < 2 ? 0.4 + 0.5 * Math.abs(Math.sin(t * 8)) : 0.8
  }

  // Inked, and everyone can see it: the splat sits on the bonnet and thins with
  // the timer the way the screenful over the victim's own camera does.
  splat.visible = kart.ink > 0
  if (splat.visible) splat.material.opacity = Math.min(0.9, kart.ink / 2)

  // Wheels. The roll comes off distance covered rather than an accumulator, so
  // it is the same on every peer and survives a dropped frame — and it divides
  // by the kart's size, which is what makes a Mega's wheels turn slowly.
  const scale = K.kartScale(kart)
  const roll = -kart.prog / scale
  // Steering off the turn actually being taken. There is no steer angle on the
  // wire and there need not be: how fast the heading is moving is the same
  // information, and it reads on a kart you do not control too.
  if (anim.heading !== null) {
    const want = clampTo(wrapAngle(kart.heading - anim.heading) * 9, -0.5, 0.5)
    anim.steer += (want - anim.steer) * 0.3
  }
  anim.heading = kart.heading
  // Locked mid-spin: wheels that keep steering through a spin-out make it look
  // driven, and the point of a spin is that it is not.
  const locked = kart.spin > 0
  for (const { wheel, front, r } of wheels) {
    wheel.rotation.z = locked ? 0 : roll / r
    wheel.rotation.y = front && !locked ? anim.steer : 0
  }

  // Weight transfer, which is the whole of the throw and the launch: no arm, no
  // rig, just the springs. A spend dips the nose, a boost lifts it.
  const spending =
    anim.item !== null &&
    (kart.item === null || (kart.item === anim.item && (kart.itemCount ?? 1) < anim.count))
  if (spending) anim.spentAt = t
  if (kart.boost > anim.boost + 0.01) anim.boostAt = t
  anim.item = kart.item ?? null
  anim.count = kart.itemCount ?? 0
  anim.boost = kart.boost
  // 300ms out on the spend, 260ms of lift on the surge, both eased out.
  const pitch =
    -0.07 * decay(t - anim.spentAt, 0.3) + 0.07 * decay(t - anim.boostAt, 0.26)

  // A kart mid-spin rolls over onto one side and comes back level, and takes a
  // full turn with it. It is what tells you from a distance that the kart ahead
  // is spinning — and therefore that you can go straight through it.
  const spun = kart.spin > 0 ? 1 - kart.spin / K.SPIN_SECONDS : 0
  const rolled = kart.spin > 0 ? Math.sin(spun * Math.PI) * 0.5 : 0
  mesh.rotation.x = rolled
  mesh.rotation.y -= spun * Math.PI * 2
  mesh.rotation.z += pitch
  // Mega bobs, so 1.7 times the size reads as weight rather than as a big kart.
  if (kart.mega > 0) mesh.position.y += Math.sin(t * 4) * 0.35
}

/** 1 at the moment it happened, 0 once `over` seconds have passed. Eased out. */
function decay(since, over) {
  if (!(since >= 0) || since > over) return 0
  const left = 1 - since / over
  return left * left
}

function clampTo(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function draw() {
  const seen = new Set()
  for (const kart of race.karts) {
    seen.add(kart.id)
    let mesh = kartMeshes.get(kart.id)
    if (!mesh) {
      mesh = makeKart(kartColor(kart.id), kart.chassis)
      kartMeshes.set(kart.id, mesh)
      scene.add(mesh)
    }
    if (kart.respawn > 0) {
      // Fished out: it drops out of the world where it went over, is carried
      // back up the road, and is set down on the spot the sim will resume it.
      const t = 1 - kart.respawn / K.RESPAWN_SECONDS
      const home = K.pointAt(kart.recoverAt)
      mesh.position.set(
        kart.x + (home.x - kart.x) * t,
        K.heightAt(kart.recoverAt) - 26 * Math.sin(Math.PI * t),
        kart.y + (home.y - kart.y) * t,
      )
      mesh.rotation.set(0, -kart.heading - t * 6, 0)
    } else {
      // A bullet flies rather than drives, so it is lifted clear of the tarmac,
      // and so does anything that has just left a jump — over one of those the
      // road is not there to be lifted off, and airRise is the whole arc. A kart
      // over the edge goes the other way: it sinks below the road it left until
      // it either finds tarmac again or is far enough down to be fished out.
      const lift =
        kart.air > 0 ? K.airRise(kart.air) : kart.fell > 0 ? -K.fallDrop(kart.fell) : kart.bullet > 0 ? 1.4 : 0
      mesh.position.set(kart.x, K.heightAt(kart.s) + lift, kart.y)
      // Nose up the climb and down the drop. 'YZX' so the pitch is taken about
      // the kart's own lateral axis, after it has been turned to its heading.
      mesh.rotation.set(0, -kart.heading, Math.atan(K.slopeAt(kart.s)), 'YZX')
    }
    // Shrunk by a Bolt, or lit up by a star: both have to be readable at a
    // glance from behind, so they change the shape rather than only a number.
    mesh.scale.setScalar(K.kartScale(kart))
    dressKart(mesh, kart, race.time)
  }
  for (const [id, mesh] of kartMeshes) {
    if (seen.has(id)) continue
    scene.remove(mesh)
    kartMeshes.delete(id)
  }

  race.boxes.forEach((box, i) => {
    const mesh = boxMeshes[i]
    if (!mesh) return
    // The host holds boxes as objects; a snapshot carries only the cooldown,
    // since a box never moves.
    mesh.visible = (typeof box === 'number' ? box : box.cooldown) === 0
    // Turning on its own axis only. A tumble on x swung the corners through the
    // tarmac, which is the one thing a floating pickup must never do.
    mesh.rotation.y += 0.03
  })

  syncPool(shellPool, race.shells, makeShell, (mesh, shell) => {
    mesh.position.set(shell.x, groundY(shell.x, shell.y) + 0.4, shell.y)
    mesh.rotation.y = Math.atan2(-shell.vy, shell.vx)
    dress(mesh, SHELL_KINDS, shell.kind ?? (shell.red ? 'red' : 'green'))
  })
  syncPool(hazardPool, race.hazards, makeHazard, (mesh, hazard) => {
    // Just clear of the tarmac: the banana's curve dips below its own origin,
    // and laid flat on the road the underside of it disappears into the road.
    mesh.position.set(hazard.x, groundY(hazard.x, hazard.y) + 0.3, hazard.y)
    // A fake box spins like the real thing: that is the whole trick of it.
    if (hazard.kind === 'fake') mesh.rotation.y += 0.03
    // A bob-omb's fuse is the design: it gives whoever finds it a decision, so
    // it has to be visible, and it has to get faster as the decision runs out.
    if (hazard.kind === 'bomb' && hazard.fuse > 0) {
      const urgency = 6 + 14 * (1 - hazard.fuse / 3)
      mesh.scale.setScalar(1 + 0.16 * Math.max(0, Math.sin(race.time * urgency)))
    } else mesh.scale.setScalar(1)
    dress(mesh, HAZARD_KINDS, hazard.kind === 'fake' ? 'trap' : (hazard.kind ?? 'banana'))
  })

  // The bangs. Each one is a ring the sim has already applied — a bomb, a spiny
  // shell coming home, or a POW, which gets all three of its beats because the
  // beat is its counterplay.
  syncPool(blastPool, race.blasts ?? [], makeBlast, (group, blast) => {
    group.position.set(blast.x, groundY(blast.x, blast.y) + 0.5, blast.y)
    const pow = blast.kind === 'pow'
    group.children.forEach((ring, i) => {
      if (i > 0 && !pow) {
        ring.visible = false
        return
      }
      // 260ms out for a blast, 450ms for the POW's slower wave, and the POW's
      // rings are 300ms apart so they read as three and not as one thick one.
      const phase = (blast.age - (pow ? i * 0.3 : 0)) / (pow ? 0.45 : 0.26)
      ring.visible = phase >= 0 && phase < 1.9
      if (!ring.visible) return
      const out = Math.min(1, phase)
      ring.scale.setScalar(Math.max(0.001, blast.r * (1 - (1 - out) * (1 - out))))
      ring.material.color.setHex(pow ? 0x7dd3fc : 0xff7a45)
      ring.material.opacity = 0.75 * Math.max(0, 1 - Math.max(0, phase - 1) / 0.9)
    })
  })

  const me = race.karts.find((k) => k.id === myId) ?? race.karts[0]
  if (me) {
    const fx = Math.cos(me.heading)
    const fy = Math.sin(me.heading)
    // How fast this feels, as a fraction of flat out. Everything below hangs
    // off it: the eye reads speed from the view widening and the camera
    // dropping back far more than from a number in the corner.
    const rush = Math.min(1.4, Math.hypot(me.vx, me.vy) / K.MAX_SPEED)
    // The camera rides the road too, or a crest throws it underground and the
    // next dip leaves it looking at the sky.
    const here = K.heightAt(me.s)
    // Normally the camera backs off with speed. On a Bullet Bill it does not:
    // the whole point of the kart turning into a rocket is being able to see it.
    // It also swings out to one side — dead astern you see nothing but the
    // exhaust, and the bullet's whole shape is its profile.
    const back = me.bullet > 0 ? 17 : 20 + rush * 6
    const side = me.bullet > 0 ? 9 : 0
    camPos.set(
      me.x - fx * back - fy * side,
      here + 10.5 - rush * 2 + (me.bullet > 0 ? 1.5 : 0),
      me.y - fy * back + fx * side,
    )
    // Eased rather than pinned, so a spin-out does not whip the camera round —
    // but the easing has to tighten with speed. At a Bullet Bill's 78 m/s a
    // fixed 0.12 leaves the camera 65 metres adrift, which is to say your own
    // kart is off the front of the screen for the whole item.
    camera.position.lerp(camPos, snapCam ? 1 : Math.min(0.6, 0.12 + rush * 0.3))
    snapCam = false
    const aimX = me.x + fx * 16
    const aimZ = me.y + fy * 16
    camAim.set(aimX, groundY(aimX, aimZ) + 2.5, aimZ)
    camera.lookAt(camAim)

    const wantFov = 60 + rush * 14 + (me.boost > 0 ? 6 : 0)
    camera.fov += (wantFov - camera.fov) * 0.08
    camera.updateProjectionMatrix()

    // Streaks down the edges of the screen, in from nothing at about half of
    // top speed so ordinary running is not permanently smeared.
    el('speed-lines').style.opacity = Math.max(0, Math.min(1, (rush - 0.5) * 2.2))
  }
}

/** Grow a mesh pool to fit a list of bodies, hide the rest. */
function syncPool(pool, bodies, make, place) {
  while (pool.length < bodies.length) {
    const mesh = make()
    scene.add(mesh)
    pool.push(mesh)
  }
  pool.forEach((mesh, i) => {
    mesh.visible = i < bodies.length
    if (mesh.visible) place(mesh, bodies[i])
  })
}

/**
 * A shell, as one of the models in kart-items.js rather than a tinted primitive:
 * a green shell, a red one with its homing fin, and the spiny shell that goes
 * for the leader. All three are built once per pool slot and the one this shell
 * actually is, is the one left visible.
 */
function makeVariants(keys) {
  const group = new THREE.Group()
  for (const key of keys) {
    const model = buildItem(key)
    model.scale.setScalar(ITEM_SCALE)
    group.add(model)
  }
  return group
}

const makeShell = () => makeVariants(SHELL_KINDS)
const makeHazard = () => makeVariants(HAZARD_KINDS)

/** Three flat rings on the tarmac, built at radius 1 and scaled to the blast. */
function makeBlast() {
  const group = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff7a45,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    group.add(ring)
  }
  return group
}

/** Show the one variant this body actually is. */
function dress(group, keys, kind) {
  const want = keys.indexOf(kind)
  group.children.forEach((child, i) => {
    child.visible = i === (want === -1 ? 0 : want)
  })
}

// HUD -----------------------------------------------------------------------

function updateHud() {
  const me = race.karts.find((k) => k.id === myId)
  const waiting = race.phase === 'WAITING'
  el('hud').hidden = waiting
  // The grid card comes down the moment the lights do, whoever started it.
  el('waiting').hidden = !waiting
  if (waiting) {
    showWaitingRoom()
    return
  }
  // Seated after the lights went out: there is no kart to follow yet, and the
  // grid card is not up either, so the banner is the only place to say so.
  if (!me) {
    const banner = el('banner')
    banner.textContent = 'IN THE NEXT RACE'
    banner.hidden = race.phase === 'OVER'
    return
  }

  el('lap').textContent = String(Math.min(me.lap + 1, race.laps))
  el('lap-total').textContent = `/${race.laps}`
  el('place').textContent = String(me.place)
  el('place-suffix').textContent = ordinalSuffix(me.place)
  el('speed').textContent = Math.round(Math.hypot(me.vx, me.vy) * 3.6)
  el('time').textContent = clock(race.time)
  el('track-name').textContent = K.TRACKS[race.track]?.name ?? ''

  showItem(me.item === undefined ? null : me.item, me.itemCount ?? 1)
  // Ink over the screen, thinning as it clears. A person can drive out of it
  // on the throttle, which is what the sim's own fade does.
  el('ink').style.opacity = me.ink > 0 ? Math.min(0.92, me.ink / 2) : 0

  // Struck by Lightning. Two white frames 50ms apart, then the world is small:
  // the flash is what says the shrink was done to you rather than by the road.
  if (me.shrink > lastShrink + 0.01) boltAt = performance.now()
  lastShrink = me.shrink
  const since = performance.now() - boltAt
  el('flash').style.opacity =
    since < 0 || since > 260
      ? 0
      : REDUCED_MOTION.matches
        ? 0.5 * (1 - since / 260)
        : since < 50 || (since > 100 && since < 150)
          ? 0.85
          : 0

  showEffects(me)

  // The last lap is worth calling, and so is crossing the line: both are
  // moments rather than states, so they are flashed for a couple of seconds.
  if (me.lap !== calledLap) {
    if (calledLap !== -1 && me.lap === race.laps - 1) flashUntil = performance.now() + 2500
    calledLap = me.lap
  }
  const flashing = performance.now() < flashUntil

  const banner = el('banner')
  const sub = el('banner-sub')
  let sublabel = ''
  if (race.phase === 'COUNT') {
    const n = Math.ceil(race.timer)
    banner.textContent = n > 0 ? String(n) : 'GO'
    banner.hidden = false
  } else if (me.finished !== null) {
    // Home, with the rest of the field still out there. The card comes up when
    // the flag falls; until then this is the only thing saying you are done.
    banner.textContent = 'FINISHED'
    banner.hidden = false
    sublabel = `${ordinal(me.place)} · ${clock(me.finished)} · waiting for the flag`
  } else if (me.respawn > 0) {
    banner.textContent = `RESCUE ${me.respawn.toFixed(1)}`
    banner.hidden = false
  } else if (me.spin > 0) {
    banner.textContent = 'SPUN OUT'
    banner.hidden = false
  } else if (flashing) {
    banner.textContent = 'FINAL LAP'
    banner.hidden = false
  } else if (race.time < 1.5) {
    banner.textContent = 'GO'
    banner.hidden = false
  } else {
    banner.hidden = true
  }
  // The card covers the screen at the flag; nothing belongs under it.
  if (race.phase === 'OVER') {
    banner.hidden = true
    sublabel = ''
  }
  sub.hidden = sublabel === ''
  if (sublabel) sub.textContent = sublabel

  el('standings').innerHTML = [...race.karts]
    .sort((a, b) => a.place - b.place)
    .map(
      (k) => `<li class="${k.id === myId ? 'me' : ''}"><span>${k.place}</span>${dot(k.id)}<span>${escapeHtml(k.name)}</span></li>`,
    )
    .join('')

  if (race.phase === 'OVER') {
    if (el('results').hidden) showResults()
  } else if (!el('results').hidden) {
    // The host started the next one: everyone's card comes down with it.
    el('results').hidden = true
    results = null
  }
}

function dot(id) {
  return `<span class="dot" style="background:${kartColor(id)}"></span>`
}

/**
 * What is in the slot. The icon is only rebuilt when the item changes: this
 * runs every frame, and re-parsing an SVG sixty times a second for a mark that
 * has not moved is work for nothing.
 */
function showItem(index, count) {
  const now = performance.now()
  if (index !== heldItem) {
    // Only a pickup reels. Spending one empties the slot on the spot, and so
    // does firing mid-reel — the slot never shows something you cannot use.
    reelUntil = index !== null && (heldItem === null || heldItem === undefined) ? now + REEL_MS : 0
    heldItem = index
  }

  const reeling = now < reelUntil
  if (reeling && now >= reelAt) {
    reelIndex = (reelIndex + 1) % K.ITEMS.length
    // Slowing as it runs down, so it lands on the last one rather than stopping
    // mid-blur: ~40ms a step at the start, ~190ms at the end.
    const done = 1 - (reelUntil - now) / REEL_MS
    reelAt = now + 40 + 150 * done * done
  }
  paintItem(reeling ? reelIndex : index, reeling, reeling ? 1 : count)
}

/** The slot, showing one item — the one you have, or one the reel is passing. */
function paintItem(index, reeling, count = 1) {
  const item = index === null || index === undefined ? null : K.ITEMS[index]
  const slot = el('item-slot')
  slot.classList.toggle('full', Boolean(item))
  el('item-name').textContent = item ? item.name : 'No item'
  const aimable = item && ['green', 'red', 'blue', 'banana', 'fake', 'bomb'].includes(item.fires ?? item.key)
  el('item-hint').textContent = reeling
    ? 'rolling…'
    : item
      ? aimable
        ? 'space or E to fire · Q aims behind'
        : 'space or E to fire'
      : 'drive through a box'
  if (index === shownItem && count === shownCount) return
  shownItem = index
  shownCount = count
  const art = item ? ITEM_ART[item.key] : null
  slot.style.setProperty('--item', art?.color ?? 'transparent')
  el('item-icon').innerHTML = art
    ? `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">${art.svg}</svg>` +
      // How many are left of it, for the triples and the golden mushroom.
      (count > 1 ? `<b class="count">${count}</b>` : '')
    : '<span class="blank"></span>'
}

/** The effects running on your own kart, as chips over the slot. */
function showEffects(me) {
  const chips = []
  if (me.boost > 0) chips.push(['tag-accent', `Boost ${me.boost.toFixed(1)}s`])
  // The tow. A number would be noise; what you need to know is whether you are
  // in it, so it shows from the point where it is worth staying there.
  if (me.draft > 0.2) chips.push(['tag-accent', 'Slipstream'])
  if (me.star > 0) chips.push(['tag-accent', `Star ${me.star.toFixed(1)}s`])
  if (me.mega > 0) chips.push(['tag-accent', `Mega ${me.mega.toFixed(1)}s`])
  if (me.bullet > 0) chips.push(['tag-accent', `Bullet ${me.bullet.toFixed(1)}s`])
  if (me.shrink > 0) chips.push(['tag-neutral', `Shrunk ${me.shrink.toFixed(1)}s`])
  if (me.ink > 0) chips.push(['tag-neutral', `Inked ${me.ink.toFixed(1)}s`])
  // The cloud is a countdown to being shrunk: hand it on before it runs out.
  if (me.cloud > 0) chips.push(['tag-outline', `Cloud ${me.cloud.toFixed(1)}s`])
  // A spiny shell goes for whoever is winning, and the drama of it is the wait:
  // the leader is told it is coming, and gets the time to do something about it.
  if (race.shells.some((sh) => sh.kind === 'blue' && sh.target === me.id)) {
    chips.push(['tag-danger', 'Incoming'])
  }
  const html = chips.map(([kind, text]) => `<span class="tag ${kind}">${text}</span>`).join('')
  if (html !== shownEffects) {
    shownEffects = html
    el('effects').innerHTML = html
  }
}

/** Before the lights, in a room: who is in, and the host's start button. */
function showWaitingRoom() {
  el('results').hidden = true
  // Which road the next race is on. The host deals it with the seed, so it is
  // already on the state everyone on the grid is looking at.
  const track = K.TRACKS[race.track]
  el('waiting-track').textContent = track ? ` · ${track.name}` : ''
  el('start').hidden = !isHost
  el('map-pick').hidden = !isHost
  el('waiting-list').innerHTML = roster
    .map((p) => `<li class="${p.id === myId ? 'me' : ''}">${dot(p.id)} ${escapeHtml(p.name)}</li>`)
    .join('')
  el('waiting-hint').textContent = isHost
    ? 'Start when everyone is in. Empty seats are filled with AI.'
    : 'Waiting for the host to start the race.'
}

function showResults() {
  el('waiting').hidden = true
  el('results').hidden = false
  // In a room the host's message is the record; solo, the state is right here.
  const rows =
    results ??
    [...race.karts]
      .sort((a, b) => a.place - b.place)
      .map((k) => ({ id: k.id, name: k.name, place: k.place, time: k.finished, me: k.id === myId }))

  el('verdict').textContent = verdict(rows)
  el('result-rows').innerHTML = rows
    .map((r) => {
      const time = r.time === null || r.time === undefined ? 'DNF' : clock(r.time)
      return `<div class="result-row${r.me ? ' me' : ''}"><span>${r.place}</span>${dot(r.id)}<span>${escapeHtml(r.name)}</span><span class="time">${time}</span></div>`
    })
    .join('')
  // Only the host can put a room back on the grid; solo can always go again.
  el('restart').hidden = !solo && !isHost
}

const PLACINGS = ['Race won', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']

/**
 * How it went, in the design's words: the placing and the gap that decided it —
 * to the kart ahead, or for a winner to the one that came next.
 */
function verdict(rows) {
  const mine = rows.find((r) => r.me)
  if (!mine) return 'Race over'
  const placing = PLACINGS[mine.place - 1] ?? ordinal(mine.place)
  if (mine.time === null || mine.time === undefined) return `${placing} — did not finish`
  const rival = rows.find((r) => r.place === (mine.place === 1 ? 2 : mine.place - 1))
  if (!rival || rival.time === null || rival.time === undefined) return placing
  return `${placing}, by ${Math.abs(mine.time - rival.time).toFixed(1)}s`
}

function ordinalSuffix(n) {
  return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
}

function ordinal(n) {
  return `${n}${ordinalSuffix(n)}`
}

function clock(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds * 100) % 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}

// Enter in the name field is the same as pressing whatever is in front of you:
// the room whose link brought you here, or a solo race.
el('name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !isTyping(e.target)) return
  if (cleanCode(el('code').value)) el('join').click()
  else el('solo').click()
})
