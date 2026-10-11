# Carball rebuild — shared contract

A from-scratch rebuild of the car football game (Rocket League–style, full 3D: jumps,
dodges, aerials, boost pads, demolitions, curved walls) with a AAA presentation.
Kart is gone from this repo; ignore anything kart-related you find in git history.

Five agents build in parallel. **Only edit files you own.** If you need something from
another agent's module, code against the API below; do not edit their file. If the
contract is missing something you truly need, add it in your own module and note it in
your final report.

Stack: plain ES modules, Vite 6 (root `client/`, outDir `dist/`), three@0.171 (use
`three/addons/...` for EffectComposer etc.), Supabase Realtime for multiplayer
(`client/auth.js` exports `supabase`, `enabled`). Tests: `node --test 'test/*.test.js'`.
Package manager pnpm. No new runtime dependencies without strong reason.

## World

- Units: metres, seconds. **Y is up.** Field length along **Z**, width along X.
- Blue (team 0) defends the goal at **-Z** and attacks +Z. Orange (team 1) the reverse.
- All dimensions live in `shared/constants.js` and `shared/arena.js` — the renderer and
  audio read them, never hardcode.

## Input (one per player per tick)

```js
{ thr, steer, pitch, yaw, roll,   // floats in [-1, 1]
  jump, boost, handbrake }        // booleans
```
- `thr` +1 = forward. `steer` +1 = right. `pitch` +1 = nose UP. `yaw` +1 = nose right.
  `roll` +1 = roll right. On the ground only thr/steer/handbrake/jump/boost matter.
- Keyboard default (input.js): W/S throttle, A/D steer; in air W/S pitch (W = nose down,
  like a stick), A/D yaw, Q/E roll (or handbrake+A/D = air roll); Space jump; Shift or
  mouse-left boost; Ctrl/C handbrake. Gamepad: RT/LT throttle, left stick steer/pitch/yaw,
  A jump, B boost, X handbrake/air-roll. Remappable.
- `shared/sim.js` exports `NEUTRAL_INPUT`.

## State (what the sim owns, what snapshots carry, what render/HUD/audio read)

```js
state = {
  tick,                         // int
  phase,                        // 'pregame'|'countdown'|'play'|'goal'|'over'
  phaseT,                       // seconds left in phase (countdown 3..0, goal replay 4..0)
  clock,                        // seconds left in regulation (counts down only in 'play')
  overtime,                     // bool; in overtime clock counts UP
  score: [blue, orange],
  teamSize,                     // 1..3, bots fill empty slots
  ball: { p:[x,y,z], v:[x,y,z], q:[x,y,z,w], w:[x,y,z] },
  cars: [{
    id,                         // string (client id or 'bot-N')
    name, team, body,           // body = key from shared/cars.js
    bot,                        // bool
    p:[3], v:[3], q:[4], w:[3], // position, velocity, orientation quat, angular vel
    boost,                      // 0..100
    onGround, onWall,           // bools (onWall = wheels on a non-floor surface)
    boosting, supersonic, dodging, jumped, doubleJumped,
    demolished,                 // 0 when alive, else seconds until respawn
    stats: { score, goals, assists, saves, shots, demos }
  }],
  pads: [bool, ...],            // active state per BOOST_PADS index (shared/arena.js)
  lastTouch: carId|null,
  events: [ ...this tick's events ]  // sim clears at start of each step()
}
```

### Events

Every event: `{ id, type, tick, ...fields }`. `id` is a monotonically increasing int
issued by the sim (`state.nextEventId`). The net layer accumulates events between
snapshots and every client fires each event exactly once (dedupe by id).

| type | fields |
|---|---|
| `countdown` | `n` (3,2,1,0 — 0 = GO) |
| `kickoff` | — |
| `hit` | `carId`, `strength` (0..1), `p` |
| `shot` | `carId` |
| `save` | `carId` |
| `goal` | `team` (team that scored), `scorerId`, `assistId`, `speed` (km/h), `p` |
| `demo` | `attackerId`, `victimId`, `p` |
| `jump` / `dodge` / `land` | `carId` |
| `boostPickup` | `carId`, `pad` (index), `big` |
| `supersonic` | `carId` |
| `overtime` | — |
| `matchOver` | `winner` (team), `mvpId` |
| `bump` | `carId`, `otherId`, `strength` |

## Module APIs

### shared/ — Agent SIM
- `shared/constants.js` — tuning (TICK_HZ=60, DT, SNAPSHOT_HZ, MATCH_SECONDS=300,
  car/ball/boost physics constants, MAX_PLAYERS=6). Rewrite freely.
- `shared/arena.js` — `ARENA = { halfWidth, halfLength, height, cornerR, wallR, goal:{halfWidth,height,depth} }`,
  `BOOST_PADS = [{ p:[x,y,z], big }]`, `arenaDistance(p) -> {d, n}` (signed distance
  inside the arena, d>0 inside, n = inward normal), `inGoal(p, r) -> concedingTeam|-1` (the team whose goal the ball is in, not the scorer).
- `shared/cars.js` — `CARS = { octane:{name, hitbox:[w,h,l], offset, color...}, ... }`
  at least 4 bodies, `DEFAULT_CAR`.
- `shared/sim.js` — `createMatch({teamSize, seed})`, `addPlayer(state,{id,name,team,body,bot})`,
  `removePlayer(state,id)`, `setInput(state,id,input)`, `step(state)` (one DT tick,
  advances phases, fills `state.events`), `startMatch(state)` (pregame → countdown),
  `fillBots(state)`, `stepCar(car, input, dt, state)` (pure-ish, used for client
  prediction), `NEUTRAL_INPUT`, `snapshot(state)` → plain JSON-safe copy.
- `shared/bot.js` — `botInput(state, car) -> input`. Bots must be competent: rotate,
  shadow defend, take kickoffs, collect boost, hit the ball toward the enemy goal.

### Networking — Agent NET
Owns `client/net.js`, `client/host.js`, `client/sim-worker.js`, `shared/protocol.js`,
`client/input.js`, `client/predict.js`, related tests.
- The tab that creates a room is the authoritative host; its sim runs in a Web Worker.
  Peers send inputs, host broadcasts quantized snapshots at SNAPSHOT_HZ over a Supabase
  Realtime channel `room:<CODE>`. Respect the Realtime free-tier budget (≈100 msg/s
  project-wide): snapshots ~15 Hz, inputs only on change and capped ~20 Hz.
- Offline practice (vs bots) must work with **no** Supabase config at all.
- Exports:
  ```js
  enabled                                // multiplayer available
  handlers = { onJoined({code,myId,isHost}), onRoster(players), onError(msg),
               onMatchOver(result), onClosed() }   // UI assigns these
  createRoom({name, team, body, teamSize}) -> Promise<{code}>
  joinRoom({name, code, team, body}) -> Promise<void>
  playOffline({name, team, body, teamSize}) -> Promise<void>
  beginMatch()                           // host only
  leave()
  myId()
  isHost()
  sampleState(nowMs) -> state|null       // interpolated, own car predicted
  drainEvents() -> [event]               // new events since last call, each once
  roster() -> [{id,name,team,body,bot,host}]
  ```
- `client/input.js`: `startInput()`, `currentInput()` → Input, `setInputEnabled(bool)`,
  `getBindings()`, `setBinding(action, code)`, gamepad support via Gamepad API.

### Rendering — Agent RENDER
Owns `client/render/` (create it). Entry `client/render/index.js`:
```js
createRenderer(canvas, { quality }) -> {
  render(state, dtSeconds, myId),   // draw a frame from a state
  onEvent(event),                   // goal explosions, demo blasts, hit sparks, shake
  setCameraMode('ball'|'car'), toggleBallCam(),
  setQuality('low'|'medium'|'high'), resize(), dispose(),
  camera                            // the THREE.PerspectiveCamera (audio listener)
}
createCarPreview(canvas) -> { setBody(key), setTeam(t), dispose() }  // garage/menu turntable
```
Stadium with stands, floodlights, glass walls, glowing field lines, goal frames, boost
pads (glow when active), PBR cars from code (no external model files), ball with
hexagon panel look, boost trails, supersonic streaks, dodge flips visible, goal
explosion, demolition explosion, camera shake, chase camera with ball-cam, nameplates,
post-processing (bloom, tone mapping, FXAA/SMAA) scaled by quality, menu background
scene (`createRenderer` with state=null renders an orbiting showcase).

### UI / app shell — Agent UI
Owns `client/index.html`, `client/main.js`, `client/ui/` (create), `client/style.css`,
`vite.config.js`, `vercel.json`, `client/public/*`, and deletes obsolete client files
(`game.html`, `garage.html`, `game.js`, `garage.js`, `lobby.js`, `ui.js`, `render.js`,
`model-viewer.js`, `silhouette.js`, `nocturne.css`, `sound.js`, `stats.js`, `host.js` is
NET's). Single page: title screen → play menu (Offline vs bots / Create room / Join by
code / quick settings) → garage (car + team preview) → lobby (roster, share code/link
`?room=CODE`, host Start) → match (HUD) → post-match scoreboard with MVP → back.
Owns the main loop: rAF → `net.sampleState(now)` → `renderer.render` →
`hud.update(state)` → `audio.update(...)`, and dispatches `net.drainEvents()` to
renderer, HUD and audio. HUD: top scoreboard + clock (+OT), circular boost meter,
goal/demo/save feed, "BLUE SCORES!" banner with scorer + speed, 3-2-1-GO countdown,
ball-cam indicator, pause/settings overlay (camera FOV/distance, sensitivity, volumes,
graphics quality, key bindings), Tab scoreboard. Bold sports-broadcast look.
Accounts optional: may keep `client/auth.js`/`api/record-match.js`/`client/stats.js`
or drop them; `client/auth.js` must keep exporting `supabase` and `enabled`.

### Audio — Agent AUDIO
Owns `client/audio/` (create). All procedural WebAudio, no asset files required.
```js
createAudio() -> {
  unlock(),                          // call from a user gesture
  update(state, myId, camera),       // per frame: engines, boost loops, crowd bed
  onEvent(event, state, myId),
  playUi('hover'|'click'|'back'|'start'),
  setVolume({ master, sfx, music, crowd }),   // 0..1
  setMusic(on)                       // menu music
}
```
Engine per car (pitch/load from speed + throttle, spatialized with PannerNode against
the camera), boost burner, supersonic whoosh, jump/land, ball hits scaled by strength,
crowd bed that swells when the ball nears a goal, goal horn + crowd roar, demolition
boom, countdown beeps, UI sounds, synth menu music loop. Also owns
`test/` sanity tests only for its own pure helpers if any.
