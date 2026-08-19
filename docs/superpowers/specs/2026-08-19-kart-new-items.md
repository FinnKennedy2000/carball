# Kart: ten original items

## Why
The roster (`ITEMS` in `shared/kart.js`) is Mario Kart Wii's set, transcribed.
Nineteen entries, all of them borrowed. These ten are original: none of them
duplicates an existing effect, and each is placed in the roll where the field
needs it rather than where the reference chart happens to have a gap.

Nothing here is spec'd as committed work. It is a menu — pick, then build.

## Design constraints
- The item index is the wire format. Append only; never reorder `ITEMS`.
- Every new per-kart timer joins the snapshot the same way `ink`/`cloud` did,
  and `hashRace` if it can change the simulation.
- The front of the field gets defence and gap-keeping, never comeback power.
  The back three rows already hold Bullet Bill, Golden and Star — a fourth
  comeback item would flatten the race, so nothing below lands there.

## The ten

### 1. Slipstream Hook — `hook`
Fires forward, latches to the nearest kart within 40m ahead, reels you to their
bumper over ~1.5s, ends in a Mushroom-sized boost. No damage either side. The
target breaks it by leaving the line you were reeling along.
Band: places 5–9. Reuses `boost` and `aheadOf()`.

### 2. Grease Drum — `grease`
A hazard laid behind you, wider than a peel. Does not spin: it drops steering
authority (a new `slick` timer, ~1s, scaling `TURN_RATE` toward nothing). Nasty
on the entry to a corner, harmless down a straight.
Band: places 1–4. Reuses the hazards array; adds `slick`.

### 3. Tow Chain — `chain`
Clamps you to the kart directly behind. Both lose ~20% of top speed for 3s. You
keep your gap; they lose their run at you. Symmetric, which is what makes it
fair as a leader's item — the only genuinely good one the front row has.
Band: places 1–3. Reuses the speed cap; adds a paired timer.

### 4. Echo — `echo`
A phantom of you drives your line for 6s. Red and spiny shells lock onto it
instead of you, and it evaporates when hit. Pure defence, no offence.
Band: places 4–8. Reuses the AI line-follow and shell targeting. The most code
of the ten — it needs a body in the state that is not a kart.

### 5. Static Field — `field`
An 8s aura that pulls in and defuses loose bananas, fake boxes and bob-ombs as
you pass. The hard counter to a peel wall, and the answer to a mid-field that
has learned to fill the racing line with junk.
Band: places 3–7. Reuses hazard collision; a `field` timer like `star`.

### 6. Rewind Beacon — `beacon`
Plant a marker; fire again within 6s to snap back to it carrying the speed you
had when you planted it. Recovers a blown corner. Wastes the slot if you never
use the second half.
Band: places 4–8. Reuses the respawn teleport. Caveat: a teleport is rough under
snapshot interpolation — it wants a short fade like the grace timer got.

### 7. Roadquake — `quake`
A wave runs 200m up the track from you. Anyone grounded in that stretch takes a
hop that cancels their drift charge and any live mini-turbo. No spin, no speed
loss — denial, not damage.
Band: places 5–8. Reuses `driftTime`/`boost` clearing and the blast-ring visual.

### 8. Flashbulb — `flash`
Instant whiteout, 1.2s, on every kart ahead of you in line of sight. Stronger
than a Blooper and far shorter, with no lingering ink.
Band: places 6–9. Reuses the `ink` render path and the Lightning flash overlay.

### 9. Spare Tyre — `tyre`
Orbits the kart and eats exactly one incoming hit — shell, peel, bomb, anything.
Or fire it forward as a bouncing wheel. The dual use is the point.
Band: places 3–8. Reuses `grace` and the shell projectile.

### 10. Toll Crate — `toll`
Dropped behind you. Whoever hits it loses their held item *to you*: it lands in
your slot if it is empty. No spin, no speed loss — the only theft in the game.
Band: places 2–5. Reuses hazards; adds an item-slot transfer.

## Roll placement, in one line
Front (1–3): Tow Chain, Grease Drum, Toll Crate. Middle (4–8): Slipstream Hook,
Echo, Static Field, Rewind Beacon, Spare Tyre. Back-of-middle (6–9): Roadquake,
Flashbulb. Nothing in rows 10–12.

## If only five ship
Slipstream Hook, Grease Drum, Tow Chain, Spare Tyre, Toll Crate — the five with
no new bodies in the state and no teleporting. Echo and Rewind Beacon are the
two to leave until the rest are proven.
