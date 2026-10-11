// DOM HUD. update() is per-frame and only touches the DOM when a value changed.
const $ = (id) => document.getElementById(id)
const C = 326.7 // circumference of the boost ring (r=52)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const TEAM = ['BLUE', 'ORANGE']
// Snapshots come from an untrusted host: coerce numbers, clamp teams, escape text.
const n = (x) => Number(x) | 0
const tm = (x) => (Number(x) === 1 ? 1 : 0)

export function createHud() {
  const e = { root: $('hud'), s0: $('h-s0'), s1: $('h-s1'), clock: $('h-clock'), clockW: $('h-clock-wrap'), ot: $('h-ot'), bar: $('boost-bar'), boost: $('boost'), bn: $('boost-n'), feed: $('feed'), cd: $('countdown'), gb: $('goal-banner'), gbT: $('gb-title'), gbS: $('gb-sub'), bc: $('ballcam'), tab: $('tabboard'), fps: $('fps') }
  const last = {}
  const set = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v) } }
  let gbTimer = 0, tab = false, fpsAcc = 0, fpsN = 0
  const car = (s, id) => s?.cars.find((c) => c.id === id)
  const name = (s, id) => { const c = car(s, id); return c ? `<b class="t${tm(c.team)}">${esc(c.name)}</b>` : '' }

  function feed(html, team) {
    const d = document.createElement('div')
    d.className = `fe t${team === undefined ? '' : tm(team)}`; d.innerHTML = html
    e.feed.prepend(d); setTimeout(() => d.remove(), 5000)
    while (e.feed.children.length > 6) e.feed.lastChild.remove()
  }
  function tabHtml(s, me) {
    const row = (c) => `<tr class="t${tm(c.team)}${c.id === me ? ' me' : ''}"><td>${esc(c.name)}</td><td>${n(c.stats?.score)}</td><td>${n(c.stats?.goals)}</td><td>${n(c.stats?.assists)}</td><td>${n(c.stats?.saves)}</td><td>${n(c.stats?.shots)}</td></tr>`
    return `<table><tr><th>Player</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th></tr>${[...s.cars].sort((a, b) => tm(a.team) - tm(b.team) || n(b.stats?.score) - n(a.stats?.score)).map(row).join('')}</table>`
  }
  const api = {
    show(on) { e.root.hidden = !on },
    reset() { e.feed.replaceChildren(); e.gb.hidden = true; e.cd.hidden = true; Object.keys(last).forEach((k) => delete last[k]) },
    setTab(on) { tab = on },
    setBallCam(on, key) { set('bc', on, () => { e.bc.classList.toggle('on', on); $('bc-text').textContent = on ? 'BALL CAM' : 'CAR CAM' }); if (key) $('bc-key').textContent = key },
    showFps(on, dt) {
      e.fps.hidden = !on
      if (!on) return
      fpsAcc += dt; fpsN++
      if (fpsAcc > 0.5) { e.fps.textContent = `${Math.round(fpsN / fpsAcc)} FPS`; fpsAcc = fpsN = 0 }
    },
    update(s, me) {
      if (!s) return
      set('s0', s.score[0], (v) => (e.s0.textContent = v))
      set('s1', s.score[1], (v) => (e.s1.textContent = v))
      const c = Math.max(0, Math.ceil(s.clock))
      set('clk', `${s.overtime}${c}${s.phase}`, () => {
        const t = s.overtime ? Math.floor(s.clock) : c
        e.clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
        e.ot.hidden = !s.overtime
        e.clockW.classList.toggle('low', !s.overtime && c <= 10)
      })
      const mine = car(s, me)
      if (mine) {
        const b = Math.round(mine.boost)
        set('b', `${b}${mine.boosting}`, () => {
          e.bn.textContent = b
          e.bar.style.strokeDashoffset = C * (1 - b / 100)
          e.boost.classList.toggle('low', b < 20); e.boost.classList.toggle('active', mine.boosting)
        })
      }
      set('tab', tab, (v) => (e.tab.hidden = !v))
      if (tab) e.tab.innerHTML = tabHtml(s, me)
    },
    onEvent(ev, s) {
      switch (ev.type) {
        case 'countdown': {
          e.cd.hidden = false
          e.cd.textContent = ev.n ? ev.n : 'GO!'
          e.cd.className = ev.n ? '' : 'go'
          void e.cd.offsetWidth // restart the animation
          e.cd.classList.add('pop')
          if (!ev.n) setTimeout(() => (e.cd.hidden = true), 900)
          break
        }
        case 'goal': {
          const sc = car(s, ev.scorerId)
          const T = tm(ev.team)
          e.gb.className = `t${T}`; e.gb.hidden = false
          e.gbT.textContent = `${TEAM[T]} SCORES!`
          e.gbS.innerHTML = [sc ? esc(sc.name) : '', ev.assistId && car(s, ev.assistId) ? `<i>assist</i> ${esc(car(s, ev.assistId).name)}` : '', `${n(ev.speed)} km/h`].filter(Boolean).join(' &nbsp;·&nbsp; ')
          void e.gb.offsetWidth
          clearTimeout(gbTimer); gbTimer = setTimeout(() => (e.gb.hidden = true), 3800)
          feed(`${name(s, ev.scorerId)}<i>GOAL</i>${TEAM[T]}`, T)
          break
        }
        case 'demo': feed(`${name(s, ev.attackerId)}<i>demolished</i>${name(s, ev.victimId)}`, car(s, ev.attackerId)?.team); break
        case 'save': feed(`${name(s, ev.carId)}<i>SAVE</i>`, car(s, ev.carId)?.team); break
        case 'overtime': feed('<b>OVERTIME</b>'); break
      }
    },
  }
  return api
}
