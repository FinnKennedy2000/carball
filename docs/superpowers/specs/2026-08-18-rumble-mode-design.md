# Rumble mode

A second game mode, after Rocket League's Rumble: every player is dealt a random
powerup on a timer and fires it with one key.

## Decisions

- **Five items**, chosen because each is either a one-off impulse or a short
  timer over bodies that already exist. No new collision shapes, no new geometry.
- **One slot, timed roll, no aiming.** A new item lands only when the slot is
  empty. Targets are implied: the ball for Haymaker, Hook and Magnetizer, the
  nearest opponent for Boot.
- **The host picks the mode in the lobby**, next to Create room. Joiners never
  choose: the mode rides down in the snapshot, so an invite link inherits it.
- **Stats are untouched.** A Rumble match records exactly as a normal one.

## Determinism

`shared/sim.js` is pure by contract — fixed timestep, fixed iteration order, no
`Math.random`, no `Date`. Item rolls must not break that, so the randomness is
*injected*: the host draws one seed at room creation, it lives in `state.seed`,
and every roll advances it with an LCG inside the sim. Replaying the same inputs
against the same starting state therefore deals the same items, and the existing
determinism test covers Rumble once `hashState` includes the seed and each car's
item.

## Modules

`shared/rumble.js` is new and owns the item table, the PRNG, the roll, and every
effect. `shared/sim.js` gains one guarded call. The split is not ceremony: sim.js
is already 422 lines of physics, and the item logic is worth testing on its own.

## State

Per car, only in Rumble: `item` (index or null), `itemTimer` (seconds to the next
roll), `itemDown` (for edge detection), `hook`, `magnet` (effect timers).
On the ball: `freeze`. On the state: `mode`, `seed`.

## Items

| Item | Effect |
|---|---|
| Haymaker | One impulse on the ball away from the car, within range. A punch, not a touch. |
| Boot | One impulse on the nearest opponent within range, away from you. |
| Freeze | The ball is held in place for a few seconds. Any car touching it breaks the hold. |
| Grappling Hook | Constant acceleration toward the ball for a couple of seconds. |
| Magnetizer | Pulls the ball toward the car for a few seconds. |

`BALL_MAX_SPEED` and the existing post-collision clamps already bound all of it.
Every knob goes in `constants.js` with the rest of the tuning.

## Input

`IN_ITEM = 64`, so `IN_ALL` becomes 127 and `parse()`'s bounds check needs no
change. Bound to **E**. Fired on the rising edge inside the sim, so holding the
key cannot burn the item that arrives next.

## Network

`blend()` in `net.js` drops top-level fields it does not name, so `mode` and
`ball.freeze` are added there. Car fields already survive its spread.

## Not building

Pickup pads, a second inventory slot, per-mode leaderboards, item art beyond a
HUD chip.
