// Dev-only stand-in used by vite.dev.config.js while shared/arena.js doesn't exist yet.
export const ARENA = { halfWidth: 41, halfLength: 51, height: 20, cornerR: 12, wallR: 4, goal: { halfWidth: 8, height: 6.5, depth: 9 } }
const P = []
for (const z of [-48, -30, -17, 0, 17, 30, 48]) for (const x of [-26, 0, 26]) P.push({ p: [x, 0, z], big: false })
for (const [x, z] of [[-36, -44], [36, -44], [-36, 44], [36, 44], [-38, 0], [38, 0]]) P.push({ p: [x, 0, z], big: true })
export const BOOST_PADS = P
