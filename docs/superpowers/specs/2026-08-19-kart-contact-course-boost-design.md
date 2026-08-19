# Kart: contact, a longer course, boost pads, drift turbo, item animation

Five changes to the kart game, from one session's feedback. Four of them are
sim work in `shared/kart.js`; one is renderer work in `client/kart.js`. Nothing
new travels between host and peer that the existing whole-state snapshot does
not already carry.

## 1. Contact that actually moves people

**The complaint:** you get beached behind a kart that is spinning out.

**Why it happens.** `bump()` treats every kart as the same object. The overlap
is split evenly (`push = (r - d) / 2`), the impulse is halved and scaled by
`1.4`, and a spinning kart is then held in place by two other things: a drag of
`3.5` that kills whatever speed it is given, and full lateral grip (`GRIP`,
10/s) that refuses to let it be shoved sideways at all. So you push into a
pirouetting roadblock, it absorbs half the correction, and neither of you goes
anywhere.

Patching only the spin case would leave the sibling bug intact: a Mega Mushroom
kart currently shoves exactly as hard as a shrunk one, because there is no
notion of mass anywhere.

**The fix — one notion of mass, used everywhere.**

```
massOf(kart) = kartScale(kart)^2  ×  (kart.spin > 0 ? LOOSE : 1)
```

`kartScale` already encodes mega (1.7) and shrink (0.55); squaring it makes a
Mega an order of magnitude heavier than a shrunk kart, which is what it looks
like. `LOOSE = 0.3`: a kart that has lost the plot has no purchase on the road,
so it takes the shove.

`bump()` then splits both the positional correction and the impulse by inverse
mass instead of in half — the standard two-body split. A normal pair behaves
exactly as before; every asymmetric pair now behaves the way it looks.

Restitution goes from `1.4 × 0.5` to `2.2 × 0.5`: ordinary door-to-door
contact should be a shove you feel, per the request for stronger collision.

And a spinning kart stops being anchored: while `spin > 0` its drag drops to
`SPIN_DRAG = 1.2` and its lateral grip to `GRIP_DRIFT`, so once it is hit it
slides. This is the half of the fix that matters most — mass alone would still
have it grinding to a halt in the middle of the road.

## 2. Spinning out leaves you pointing down the road

Today `spin` runs out mid-pirouette and drops you facing wherever the last
frame left you — often into the barrier. When `spin` reaches 0, set `heading`
to the road's tangent at the kart's own `s`. The kart is already projected
every tick, so the tangent is free. Pointing backwards after a hit is a second
punishment nobody asked for.

## 3. A longer course

`TRACK_R` 150 → 215, `TRACK_N` 280 → 400 so the node density (and therefore
the fidelity of the hairpin) is unchanged. A fourth harmonic is added to
`trackPoint` — `+0.05·cos(7a)` — so the extra distance is extra corners rather
than a longer straight.

Everything that positions itself around the lap is already expressed as a lap
fraction or a division of `TRACK.length`: the hills, the voids, the finish, the
item boxes. They scale for free. `BOX_ROWS` goes 14 → 20 to hold the boxes at
roughly the same spacing on the ground, and the renderer's ground disc, fog and
camera are all derived from `TRACK_R`, so they follow.

Three laps of the new circuit is about half again the old race. That is the
point.

## 4. Boost pads on the road

A fixed set of painted bands, defined once as an exported table of lap
fractions with a lane offset and a half-width:

```js
export const PADS = [{ t, lane, half }, ...]
```

Crossing one grants `boost = PAD_SECONDS` (1.1s) — the same field a Mushroom
sets, so it inherits the whole boost path: the acceleration, the raised cap,
the bleed-off, the FOV kick, offroad immunity.

**Deliberately stateless.** No cooldown, no per-kart bookkeeping, nothing in
the snapshot: a pad is a pure test of where the kart is this tick. Refreshing
the timer while you sit on one is correct — that is what a pad does.

Pads go on corner exits and the bottom of the two long drops, and never inside
a `VOIDS` stretch, where the reward for a wide line is a fall rather than a
choice. The renderer draws chevrons from the same table.

## 5. Drift mini-turbo

Mario Kart's core loop, and the game is missing it. Two new kart fields:

- `driftTime` — seconds the current drift has been held with the wheel turned
  and above `DRIFT_MIN_SPEED`. Reset the moment drift is released or those
  conditions break.
- `driftCharge` — 0, 1 or 2, derived from `driftTime` crossing 0.9s and 1.9s.
  Kept as its own field so the renderer can colour the sparks without
  re-deriving the thresholds, and so the HUD has something discrete to show.

Release drift with a charge and you get `boost = 0.55` (tier 1) or `0.95`
(tier 2). Charge is spent on release, and lost entirely by spinning out.

Reusing `boost` rather than adding a mini-turbo timer is the whole reason this
is small: the speed cap, the bleed, the camera and the flame all already exist.

## 6. Item animations that read at a glance

Renderer only — the sim already carries every timer this needs.

`makeKart` gains three hidden children, and one new function `dressKart(mesh,
kart)` in `draw()` decides what is shown:

- **Bullet Bill → the kart becomes the rocket.** The body, driver and wheels
  hide; a black bullet-shaped hull with a flame tail shows, lifted clear of the
  road. This was the specific ask, and it is also the clearest of the set: at
  78 m/s a kart with a tint is unreadable.
- **Boost / pad / mini-turbo →** twin flame cones out of the back, sized off
  the remaining `boost`.
- **Drift charge →** sparks at the rear wheels, orange at tier 1 and blue at
  tier 2, so you know when to let go without looking at the HUD.
- **Star →** emissive cycles through hues rather than sitting on one yellow.
- **Mega →** an emissive ramp and a slow vertical bob, so 1.7× reads as heavy
  rather than merely large.
- **Spin-out →** the body rolls over onto one side through the pirouette and
  comes back level, which is what tells you at a distance that the kart ahead
  is spinning and can be shoved through.

One pool of children per kart mesh, toggled by visibility. No per-frame
allocation, no new pools, no particle system.

## 7. A grace period after being hit

Being spun out, shoved out of the way while you spin, and then spun again by the
next thing arriving is how a single bad moment turns into a lost race.

One new field, `grace`: seconds of immunity, counted down like every other
timer. `spinOut()` and the blast path both return early while it is above zero,
and `spinOut()` sets it to `SPIN_SECONDS + GRACE_AFTER` (1.3 + 1.5 = 2.8s) — so
it covers the pirouette itself plus about a second and a half of driving out of
it.

**Shown by a fade, not by a chip.** The kart fades in and out for as long as the
grace runs — every part of it, so a ghosted body does not drive past on four
solid wheels. It reads on the field as much as on your own kart: a blinking kart
is one there is no point throwing anything at. No HUD timer and no tint. The rule
applies to the AI as well as to the player, which keeps the race readable and the
simulation deterministic.

It gates damage only. A star, a mega or a bullet still shoves you aside on
contact, a cloud can still be handed to you, and the pads and boxes still work
— none of those are hits.

It gates spin-outs specifically, which is every path that ends in `spinOut()`:
peels, fake boxes, shells of all three colours, bombs, the POW, a star or a mega
running you over. A Lightning bolt's shrink and a Thundercloud's are left
ungated: the bolt hits the whole field at once, and making it randomly miss
whoever was recently unlucky would be a worse race than the one being fixed.

## Testing

New tests in `test/kart.test.js`, in the style of the existing ones:

- driving into a spinning kart moves the spinning kart, and the driver keeps
  most of its speed
- a Mega shoves a normal kart further than it is shoved
- a spin-out ends with the kart pointing along the road
- the lap is meaningfully longer than it was, and still closes on itself
- crossing a boost pad grants boost; missing it laterally does not
- a held drift charges, and releasing it at each tier gives the matching boost
- a spin-out throws away a charged drift
- a kart just spun out cannot be spun out again until its grace runs down
- determinism still holds with all of the above in the state

## Out of scope

Pad cooldowns, drift-charge visual on other karts' HUDs, per-kart mass tuning
knobs, and any change to the item roster or the roll table.
