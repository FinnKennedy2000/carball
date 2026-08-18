# Kart: the full item roster

## Why
The kart game shipped with six items and a two-row rubber band (front row, back
row, linearly interpolated). The reference is Mario Kart Wii's 12-player item
distribution table: a per-place row, with mid-field items that peak in the
middle and cannot be expressed by interpolating two endpoints.

## What changes

### Items (shared/kart.js)
Nineteen items. The first six keep their index — the index is the wire format —
and the rest are appended:

0 Mushroom (boost) · 1 Banana · 2 Green Shell · 3 Red Shell · 4 Lightning ·
5 Star · 6 Triple Mushroom · 7 Triple Banana · 8 Triple Green · 9 Triple Red ·
10 Golden Mushroom · 11 Fake Item Box · 12 Bob-omb · 13 Spiny Shell ·
14 POW Block · 15 Blooper · 16 Mega Mushroom · 17 Bullet Bill · 18 Thundercloud

Multiples are one item with a count: `{ fires: 'green', count: 3 }`. Firing
spends one; the slot holds until the count runs out. Golden is six short boosts
on the same mechanism.

New behaviours:
- Fake box, Bob-omb: hazards with a `kind`. A bomb spins everything inside a
  blast radius; a fake box spins whoever drives into it.
- Spiny Shell: a shell that homes on the leader and blasts on arrival.
- POW: spins every kart ahead of you at once (star/mega/bullet are immune).
- Blooper: inks every kart ahead — a screen smear for a person, a slower
  top end for anyone.
- Mega: bigger, faster, immune, and it squashes what it touches.
- Bullet Bill: autopilot down the racing line at bullet speed, untouchable.
- Thundercloud: rides with you, passes to the next kart you touch, and shrinks
  whoever is holding it when it goes off.

### Distribution
`ROLL_ROWS` is twelve rows keyed by item, transcribed from the reference chart.
The roll picks a row from `(place - 1) / (field - 1)`, so a six-kart field reads
rows 0, 2, 4, 7, 9, 11. `ROLL_FRONT` / `ROLL_BACK` stay exported as the first
and last rows.

### Models
`client/kart-items.js` — imported from the Claude Design project's
`Kart Items 3D.html` and extended with the spiny shell — builds the props from
THREE primitives: shells as an armour dome on a cream rim (the red one carries a
homing fin, the spiny one wings and spikes), a banana as a swept tube with a
split-skin strip, a bomb with a fuse and a spark, the item box as a caged
translucent cube around an octahedron, and its decoy in spiked violet. The race
renders shells, hazards and boxes from these instead of tinted primitives.

`client/kart-items.html` is the workbench they are looked at on — one model at a
time on a turntable, the design's own viewer page rebuilt against the repo's
three.

HUD marks are drawn per item as SVG in `client/kart.js`: a mushroom is a
mushroom, a triple is three of them with a count badge on the slot.
