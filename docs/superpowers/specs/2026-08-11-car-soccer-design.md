# Car Soccer — Design

Date: 2026-08-11
Status: approved

## Purpose

A real-time browser game to play with friends over a local network. Top-down 2D
car soccer: drive a car, knock a large ball into the opponents' goal. Rendered in
low-poly 3D with a fixed tilted camera.

Success criteria: 2–6 people open a URL, enter a 4-letter room code, and play a
5-minute match that feels immediate and is fun without explanation.

## Constraints

- **Zero budget.** No paid hosting, no managed services, no database, no accounts.
- **Local only.** The server runs on the developer's machine. Friends connect to
  the LAN IP. A public link is possible via `cloudflared tunnel` but is out of
  scope for this spec.
- **Sub-10ms latency assumed** (same house / LAN). This is what makes the netcode
  design below viable.
- Three dependencies total: `vite`, `three`, `ws`.

## Architecture

One Node process serves the built client over HTTP and upgrades to a WebSocket
for gameplay. There is exactly one authoritative simulation, and it runs on the
server.

```
carsoccer/
  shared/
    constants.js     all tuning knobs, imported by both sides
    sim.js           step(state, inputs) -> state. Pure, deterministic, no I/O.
  server/
    index.js         http server, static files, ws upgrade, room routing
    room.js          one room: players, 60Hz tick loop, 30Hz snapshot broadcast
    protocol.js      message parsing and validation (the trust boundary)
  client/
    index.html
    main.js          boot, lobby -> game state machine
    net.js           websocket, snapshot buffer, interpolation
    render.js        three.js scene, draw(interpolatedState)
    input.js         keyboard -> input bitmask
    sound.js         synthesised cues inferred from snapshots, no assets
    ui.js            plain DOM: room code, score, clock, messages
  test/
    sim.test.js      node:test, no framework
```

`shared/sim.js` is imported by both server and client. The client does **not**
run it in v1 — it is shared so that adding client-side prediction later is an
additive change rather than a restructuring. The client does import
`shared/constants.js` for arena dimensions.

### Why hand-rolled physics

Arcade car handling requires custom force code regardless of the physics library
used, and a generic rigid-body solver (Box2D/planck, matter.js) makes the tuning
harder rather than easier. The required primitives — circle/circle impulse,
circle/AABB reflection — are a small amount of code with full control over feel
and guaranteed determinism.

## The simulation

Fixed timestep, `dt = 1/60`, never variable. Variable dt causes both
non-determinism and tunnelling. Bodies are iterated in a fixed order by player id
so results are reproducible.

### State shape

```js
{
  tick: int,
  phase: 'KICKOFF' | 'PLAY' | 'GOAL' | 'OVER',
  phaseTimer: float,      // seconds remaining in the current phase
  clock: float,           // seconds remaining in the match
  overtime: bool,         // the clock ran out level; next goal wins
  score: [blue, orange],
  ball: { x, y, vx, vy },
  cars: [ { id, team, x, y, vx, vy, heading, boost } ]
}
```

### Car model

- Throttle applies force along `heading`.
- Steering rotates `heading` at a rate that scales with speed, with a floor so
  the car can still turn slowly from a near stop.
- **Lateral velocity is damped hard each tick.** This single term is what makes
  the car feel like a car rather than a hovercraft, and is the primary feel knob.
- Speed is clamped to a maximum.
- **Boost** (space) applies additional force while held, draining a meter that
  refills on a timer. No pickup pads.
- **Drift** (shift) slackens the lateral damping and raises the turn rate while
  held, so the car slides through a corner instead of railing round it. It
  replaces the dash of the original design: two modifier keys are enough, and
  boost already supplies the car-on-car bumping.

### Ball model

Circle with linear drag and restitution against walls. No spin, no curve, no
vertical axis.

### Collisions

- Car/ball and car/car: elastic impulse along the contact normal using a mass
  ratio (car heavy, ball light), followed by positional separation so resting
  overlaps do not jitter.
- Car/wall and ball/wall: axis-aligned reflection with restitution.
- Goal mouths are openings in the end walls; the ball passes through them.

### Match flow

Phases are fields in the state, not separate events:

- `KICKOFF` — cars and ball at spawn positions, countdown, no input applied to
  movement.
- `PLAY` — normal simulation, match clock counts down.
- `GOAL` — brief pause after a goal, then back to `KICKOFF`.
- `OVER` — the match is decided. Bodies are frozen and the final score sits on
  screen for `OVER_SECONDS` before the room resets for a rematch. Sides are
  preserved across the reset.

A goal fires once when the ball centre crosses the goal line, guarded by the
phase transition so it cannot re-trigger while the ball sits in the net. A goal
on the final tick counts.

**Overtime.** A level score at full time sets `overtime` rather than ending in a
draw: play continues with the clock at zero and the next goal wins. This is the
only place the match can end outside the clock reaching zero.

### Determinism

Not strictly required in v1 because the client does not simulate. It is
maintained anyway because it costs only a fixed dt and a fixed iteration order,
it is a prerequisite for prediction later, and it makes the simulation testable
in isolation.

## Data flow and netcode

**Model: server-authoritative with a non-simulating client.** Considered and
rejected: client prediction with reconciliation (necessary above ~100ms,
unhelpful at 8ms, and the source of the hardest bugs in this class of game) and
deterministic lockstep with rollback (right for 1v1 fighting games, wrong for
6-player physics — every client pays the slowest peer's latency and one float
divergence desyncs the room).

### Client to server

`{ t: 'create' | 'join', name, code?, team? }` to enter a room — `team` is an
optional side request, and anything that is not a valid team means "anywhere".

`{ t: 'input', seq, bits }` at 60Hz. `bits` is a single byte: throttle forward,
throttle back, steer left, steer right, boost, drift.

The server keeps only the **most recent** input per player and applies it on each
tick. No queue and no buffering: on a LAN a late packet is rarer than the
complexity of handling it, and the scheme self-corrects on the next packet.
`seq` is carried so prediction can be added later without a protocol change.

### Server to client

Snapshots at 30Hz containing the full state described above. JSON on the wire; at
six players this is a few KB/s, and a binary encoder would be optimising a
problem that does not exist.

Because phase and score are part of the state rather than separate reliable
events, a client that joins or reconnects mid-match is immediately correct with
no extra code.

### Rendering

The client buffers the last few snapshots and renders at roughly 100ms behind the
newest one, interpolating positions linearly and headings along the shortest arc.
This interpolation delay is the single knob to increase if a player's connection
is poor.

## Rooms

- Codes are 4 characters from an alphabet with ambiguous glyphs removed (no
  `O`/`0`, no `I`/`1`). Collisions are retried.
- A room is created on demand, its tick loop starts when the first player joins,
  and the interval is cleared and the room deleted when the last player leaves.
- Maximum 6 players, at most 3 a side. A player may request a side on join; the
  request is honoured unless that side is full, otherwise teams are
  auto-balanced. A chosen side survives a rematch.
- All room state is in memory. Nothing is persisted.

## Error handling

The WebSocket is a trust boundary and is validated properly:

- `bits` must be an integer in 0–255.
- Room codes must match `^[A-Z]{4}$`.
- Names are length-clamped and stripped of control characters.
- Any malformed or unrecognised message is dropped, never thrown. The server must
  not be crashable by client input.

Other cases:

- Socket close or error removes the player from the room. The match continues;
  their car simply disappears. No pause, no vote.
- A reconnecting client rejoins as a fresh car. Session resume is out of scope.
- Room full or unknown code returns `{ t: 'error', reason }` and the client
  displays it in the lobby.
- The tick loop caps catch-up at 3 steps before discarding elapsed time, so a
  stalled process cannot enter a death spiral trying to catch up.

## Testing

One file, `node:test`, no framework. Five checks aimed at where defects actually
occur:

1. **Determinism** — the same initial state and input sequence run twice for 600
   ticks produces an identical state hash.
2. **No tunnelling** — a ball driven at maximum speed into walls for 600 ticks
   never leaves the arena bounds.
3. **Goal counting** — a ball crossing the goal line scores exactly once, not on
   every tick it remains in the net.
4. **Energy conservation** — two cars colliding repeatedly for 1000 ticks do not
   gain speed without bound.
5. **Protocol validation** — malformed messages are rejected without throwing.

## Sound

Synthesised in the client with WebAudio, no asset files: a pitched thud on ball
impacts (volume from the change in ball speed), a looping filtered-noise whoosh
while the local car boosts, and a two-tone goal horn. The client does not
simulate, so every cue is inferred by diffing consecutive snapshots rather than
from events on the wire. `M` mutes. The `AudioContext` is created from the lobby
button click, since a browser will not start one without a user gesture.

## Out of scope for v1

Recorded so it does not creep in: client prediction, rollback, WebRTC transport,
binary wire format, a vertical axis for the ball (aerials), boost pads, car
customisation, persistent stats, spectators, matchmaking, mobile controls,
public deployment.

## Running

- `pnpm dev` — Vite dev server with hot reload for the client, `node --watch` for
  the server, Vite proxying the WebSocket.
- `pnpm build && pnpm start` — a single process serving `dist/` and the
  WebSocket on one port. Friends connect to the machine's LAN IP.
