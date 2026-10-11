// Fake match state for developing the HUD without a sim (`?mock`).
import { CARS } from '../../shared/cars.js'
const key = (i) => (Array.isArray(CARS) ? i % CARS.length : Object.keys(CARS)[i % Object.keys(CARS).length])
const stats = (n) => ({ score: n * 100, goals: n, assists: n % 2, saves: n % 3, shots: n + 2, demos: n % 2 })
export function mockState(nowMs, name = 'You') {
  const t = nowMs / 1000
  const names = [name, 'Bot-1', 'Bot-2', 'Bot-3', 'Bot-4', 'Bot-5']
  return {
    tick: Math.floor(t * 60), phase: 'play', phaseT: 0, clock: 187, overtime: false, score: [2, 1], teamSize: 3,
    ball: { p: [0, 1, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0] },
    cars: names.map((n, i) => ({
      id: i ? `bot-${i}` : 'me', name: n, team: i % 2, body: key(i), bot: !!i, p: [i * 4 - 10, 0.5, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0],
      boost: i ? 50 : 50 + 50 * Math.sin(t), onGround: true, onWall: false, boosting: !i && Math.sin(t) > 0.5, supersonic: false,
      dodging: false, jumped: false, doubleJumped: false, demolished: 0, stats: stats(5 - i),
    })),
    pads: [], lastTouch: null, events: [],
  }
}
