// The car models, as proportions rather than assets. Every shape is built from
// the same three boxes the original car was — body, roof, nose flash — so this
// stays a data table and the project keeps its "no asset files" property.
//
// It lives in shared/ because protocol.js validates a peer's chosen index
// against it: a claim from the channel has to be checked, and the only honest
// bound is the list itself.
//
// Team colour is deliberately not customisable. You have to be able to tell blue
// from orange in a scrap, so a player picks a silhouette, and the side picks the
// paint.

export const CARS = [
  {
    name: 'Coupe',
    body: [4, 1.5, 2.6],
    roof: [2, 0.8, 2.1],
    roofAt: [-0.35, 1.9],
    nose: [0.5, 1.1, 2.2],
  },
  {
    name: 'Wedge',
    body: [4.4, 1.1, 2.4],
    roof: [1.6, 0.7, 1.9],
    roofAt: [-0.9, 1.5],
    nose: [0.7, 0.8, 2.1],
  },
  {
    name: 'Van',
    body: [3.6, 1.7, 2.8],
    roof: [2.6, 1.4, 2.6],
    roofAt: [-0.4, 2.4],
    nose: [0.4, 1.2, 2.4],
  },
  {
    name: 'Roadster',
    body: [3.8, 1.2, 2.2],
    roof: [1.2, 0.6, 1.8],
    roofAt: [-1, 1.5],
    nose: [0.6, 0.9, 1.9],
  },
  {
    name: 'Tank',
    body: [3.4, 1.9, 3],
    roof: [1.4, 1, 1.6],
    roofAt: [0, 2.7],
    nose: [0.5, 1.4, 2.6],
  },
]

/**
 * Cosmetic only: the simulation uses CAR_R for every car whatever it looks like.
 * A model that changed the hitbox would make the choice a competitive one, and
 * would have to be validated as part of the sim rather than as a claim.
 */
export const DEFAULT_CAR = 0
