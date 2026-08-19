// The garage: pick which car you drive. A page of its own rather than a row in
// the lobby, because the choice is worth looking at — and because it loads
// nothing but this list, no three.js and no simulation.
//
// The choice is the only thing this page owns. It writes the same localStorage
// key the lobby and the game page read, so nothing else has to know the garage
// exists.

import { CARS } from '../shared/cars.js'
import { cleanCar } from '../shared/protocol.js'
import { carSvg, dimensions, TEAM_PAINT } from './silhouette.js'

const el = (id) => document.getElementById(id)

// Written here, read by lobby.js and game.js. localStorage, not session: a car
// is a standing preference, not a decision about this match.
const STORED_CAR = 'carball.car'
// The side, if the lobby settled on one. Only used to paint the preview honestly.
const STORED_TEAM = 'carball.team'

// The same bound the channel's claims go through, so a hand-edited key or a
// model dropped from the table lands on the default rather than an empty page.
let chosen = cleanCar(Number.parseInt(localStorage.getItem(STORED_CAR), 10))

// Compared as text, not through Number(): the lobby stores 'null' for
// auto-balance, and Number(null) is 0, which would claim you had picked blue.
// Auto leaves no side to show, so the preview wears the default paint and says
// as much rather than naming a colour the player never chose.
const storedTeam = sessionStorage.getItem(STORED_TEAM)
const team = storedTeam === '0' ? 0 : storedTeam === '1' ? 1 : null

el('garage-count').textContent = CARS.length

el('chassis').replaceChildren(
  ...CARS.map((spec, i) => {
    const row = document.createElement('button')
    row.className = 'chassis-row'
    row.dataset.car = i

    const thumb = document.createElement('span')
    thumb.className = 'thumb'
    thumb.innerHTML = carSvg(spec, team ?? 0)

    const label = document.createElement('span')
    label.className = 'chassis-label'
    const name = document.createElement('span')
    name.className = 'chassis-name'
    name.textContent = spec.name
    const dims = document.createElement('span')
    dims.className = 'chassis-dims tabular'
    dims.textContent = dimensions(spec)
    label.append(name, dims)

    const mark = document.createElement('span')
    mark.className = 'chassis-mark'

    row.append(thumb, label, mark)
    row.addEventListener('click', () => pick(i))
    return row
  }),
)

function pick(i) {
  chosen = i
  const spec = CARS[i]

  el('garage-preview').innerHTML = carSvg(spec, team ?? 0)
  el('garage-name').textContent = spec.name
  el('garage-dims').textContent = `${dimensions(spec)} — length, height, width`
  el('garage-use').textContent = `Use ${spec.name}`

  const paint = el('garage-paint')
  paint.querySelector('i').style.background = TEAM_PAINT[team ?? 0]
  paint.querySelector('span').textContent =
    team === null ? 'Paint follows your side' : team === 0 ? 'Blue paint' : 'Orange paint'

  for (const row of el('chassis').children) {
    const on = Number(row.dataset.car) === i
    row.classList.toggle('on', on)
    row.querySelector('.chassis-mark').textContent = on ? 'Driving' : 'Pick'
  }
}

// Saved on the way out rather than on every click, so a browsed-through garage
// does not change your car unless you say so.
const save = () => {
  localStorage.setItem(STORED_CAR, String(chosen))
  location.href = './'
}

el('garage-use').addEventListener('click', save)
el('garage-back').addEventListener('click', () => {
  location.href = './'
})

pick(chosen)
