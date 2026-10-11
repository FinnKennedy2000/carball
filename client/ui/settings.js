// Persisted settings + the settings panel. Applies itself through `apply`.
import * as input from '../input.js'

const KEY = 'carball.settings'
export const DEFAULTS = { fov: 100, distance: 270, height: 100, stiffness: 50, ballCam: true, quality: 'high', master: 0.8, sfx: 1, music: 0.5, crowd: 0.8, fps: false }
export const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* private mode: setting just won't persist */ } },
}
export const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(store.get(KEY, '{}')) } } catch { return { ...DEFAULTS } }
})()

const SLIDERS = [
  ['Camera', [['fov', 'Field of view', 60, 120, 1], ['distance', 'Distance', 100, 400, 5], ['height', 'Height', 40, 200, 5], ['stiffness', 'Stiffness', 0, 100, 1]]],
  ['Audio', [['master', 'Master', 0, 1, 0.05], ['sfx', 'Effects', 0, 1, 0.05], ['music', 'Music', 0, 1, 0.05], ['crowd', 'Crowd', 0, 1, 0.05]]],
]

export function initSettings(root, apply) {
  const save = () => { store.set(KEY, JSON.stringify(settings)); apply(settings) }
  const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild }
  for (const [title, rows] of SLIDERS) {
    root.append(el(`<h4>${title}</h4>`))
    for (const [k, label, min, max, step] of rows) {
      const row = el(`<label class="srow"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${settings[k]}"><output></output></label>`)
      const [inp, out] = [row.querySelector('input'), row.querySelector('output')]
      const show = () => (out.textContent = max <= 1 ? Math.round(settings[k] * 100) : settings[k])
      inp.oninput = () => { settings[k] = +inp.value; show(); save() }
      show(); root.append(row)
    }
  }
  root.append(el('<h4>Graphics</h4>'))
  const q = el(`<label class="srow"><span>Quality</span><select>${['low', 'medium', 'high'].map((o) => `<option ${o === settings.quality ? 'selected' : ''}>${o}</option>`).join('')}</select><span></span></label>`)
  q.querySelector('select').onchange = (e) => { settings.quality = e.target.value; save() }
  root.append(q)
  for (const [k, label] of [['ballCam', 'Ball cam by default'], ['fps', 'Show FPS']]) {
    const c = el(`<label class="srow"><span>${label}</span><input type="checkbox" ${settings[k] ? 'checked' : ''}><span></span></label>`)
    c.querySelector('input').onchange = (e) => { settings[k] = e.target.checked; save() }
    root.append(c)
  }
  root.append(el('<h4>Key bindings</h4>'))
  const binds = el('<div></div>'); root.append(binds)
  const drawBinds = () => {
    binds.replaceChildren()
    for (const [action, code] of Object.entries(input.getBindings?.() ?? {})) {
      const row = el(`<div class="srow kb"><span>${action.replace(/([A-Z])/g, ' $1').toLowerCase()}</span><button type="button" class="kbtn"></button></div>`)
      const b = row.querySelector('button')
      b.textContent = String(code).replace(/^Key|^Digit/, '')
      b.onclick = () => {
        b.textContent = 'press a key…'; b.classList.add('listening')
        const on = (e) => {
          e.preventDefault(); e.stopPropagation(); removeEventListener('keydown', on, true)
          if (e.code !== 'Escape') input.setBinding(action, e.code)
          drawBinds()
        }
        addEventListener('keydown', on, true)
      }
      binds.append(row)
    }
  }
  drawBinds()
  apply(settings)
}
