// Bodies. hitbox = [width, height, length]; the car's `p` is the hitbox centre.
// Local space: forward = +Z, up = +Y, +X is the car's left.
export const CARS = {
  octane: { name: 'Octane', hitbox: [2.2, 1.1, 3.4], offset: [0, 0.1, 0.2] },
  dominus: { name: 'Dominus', hitbox: [2.3, 1.0, 3.7], offset: [0, 0.1, 0.3] },
  breakout: { name: 'Breakout', hitbox: [2.3, 0.95, 3.8], offset: [0, 0.1, 0.3] },
  merc: { name: 'Merc', hitbox: [2.5, 1.5, 3.9], offset: [0, 0.2, 0.2] },
  hotshot: { name: 'Hotshot', hitbox: [2.2, 1.05, 3.4], offset: [0, 0.1, 0.2] },
  venom: { name: 'Venom', hitbox: [2.2, 1.0, 3.5], offset: [0, 0.1, 0.25] },
}
export const DEFAULT_CAR = 'octane'
