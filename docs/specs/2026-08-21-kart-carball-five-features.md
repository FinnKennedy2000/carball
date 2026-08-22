# Kart & Carball — five feature additions

**Status:** spec, awaiting sign-off. Nothing here is built.
**Source:** the LLM Council verdict of 2026-08-21. Every code reference below was
verified against the tree at `d374015`.

## Goal

Give Kart a reason to be opened tomorrow, give a good race somewhere to go, and
pay off the two debts that any persistence feature would otherwise inherit —
without adding a single message per second to the Realtime budget.

## Why these five

Kart is not short of content: 19 items, 6 tracks, 6 chassis, a 12-row roll
table. It is short of *memory* — nothing survives the tab — and short of a way
for a race to leave the browser it happened in. Both gaps are fixable inside the
existing architecture, because a Kart race is already fully described by a seed
plus one byte per player per tick.

## Global constraints

Copied verbatim from the code; every feature below is bound by all of them.

- **No game server.** `api/record-match.js` is the only server-side code and is
  request/response only. The authoritative sim runs in the host player's browser
  (`client/kart-host.js`).
- **Message rate is the binding budget.** Supabase Realtime allows 100 msg/sec
  *project-wide* on Free. `SNAPSHOT_HZ = 12` (`shared/constants.js:11`) was a
  budget decision. **No feature in this spec may add a new per-tick broadcast.**
- **`TICK_HZ = 60`, `DT = 1/60`**, deterministic `step()`, structural hash via
  `hashRace()` (`shared/kart.js:1610`).
- **A solo race is reproducible from `(seed, track, chassis, bits[])`** —
  `startSolo()` at `client/kart.js:646` picks `seed = (Math.random() * 2**32) >>> 0`
  and derives the track with `K.trackFor(seed, …)`.
- **Existing storage keys:** `carball.name`, `carball.chassis`, `carball.map`
  (`client/kart.js:163-165`). New keys follow the `carball.kart.*` prefix.
- **Tests:** `node --test 'test/*.test.js'`, ~115 passing. Every behavioural
  change lands with one test in the existing files. No new frameworks.
- **Tuning knobs live in `shared/constants.js`** with a prose comment saying why
  the number is the number. New constants follow that convention.

---

## Feature 0 — Determinism gate (precondition, not a shipped feature)

Features 2 and 3 were both proposed on the assumption that a recorded race
replays identically anywhere. That assumption is unverified: `shared/kart.js`
calls `Math.sin`/`Math.cos`/`Math.atan2`/`Math.pow` throughout, ECMAScript leaves
their precision implementation-defined, and all ~115 tests run under V8 only.

**Deliverable:** a throwaway page, `client/kart-determinism.html`, that runs a
fixed script and prints hashes.

- Fixed seed (`99`), fixed field (6 karts, 5 AI), a scripted `bits[]` sequence
  generated from a seeded PRNG so it is identical on every engine.
- Steps 5400 ticks (90 s, roughly a three-lap race).
- Prints `hashRace(state)` at ticks 60, 600, 1800, 3600, 5400, plus the player
  kart's `x`, `y`, `prog` at full precision.

**Run it in Chrome, Firefox and Safari (including iOS Safari if reachable) and
compare.** Note that `hashRace` rounds through `Math.round(n * 1e6)`, so it
already absorbs divergence below 1e-6.

Two thresholds matter, and they are different:

| Purpose | Tolerance needed |
|---|---|
| A ghost that looks right | ~0.1 m of drift over a lap is invisible |
| A record verified by re-simulation | bit-exact |

**Outcome A — hashes match on all engines.** Feature 3 ships as designed
(seed + input log in a URL). Server-side re-simulation becomes available as a
future option for records.

**Outcome B — hashes diverge.** Feature 2 is unaffected (it never depended on
this — see below). Feature 3 falls back to its pose-track form: the link carries
the recorded poses of the sharer's kart only, which is watchable and shareable
but is not a re-runnable race. Server-side verification is off the table
permanently, which is why Feature 4 does not rely on it.

**Acceptance:** the three hash tables are recorded in this document as a table
of results, and Feature 3's form is chosen on the evidence rather than assumed.

---

## Feature 1 — Lap splits and personal bests (Kart)

Kart times the race (`#time`, `client/kart.html:1252`) and records a finish time
(`kart.finished = state.time`, `shared/kart.js:1099`). It does not time
individual laps and it remembers nothing.

### Design

**Sim (`shared/kart.js`).**

- `addKart()` gains `splits: []` on the kart, beside `finished: null`.
- `trackProgress()` currently computes `kart.lap` from `kart.prog`. Capture the
  previous lap before that line; when `kart.lap` increases, push `state.time`
  onto `kart.splits`. A lap time is then `splits[i] - (splits[i-1] ?? 0)`.
- Nothing else reads `splits`. It rides in the snapshot like every other field,
  so a peer sees its own splits with no new message — this is the whole reason
  the field lives on the kart rather than in the client.
- `hashRace()` is **not** extended to cover `splits`. It is a derived quantity;
  including it would make the hash sensitive to a purely cosmetic addition.

**Version stamp (`shared/constants.js`).**

```js
// Stamped onto every stored time, ghost and replay link. Bump it whenever a
// tuning change alters how the same inputs drive, which invalidates every
// stored time that came before: a personal best set on different physics is
// not a personal best, and a ghost recorded on it drives through walls.
export const SIM_VERSION = 1
```

**Client (`client/kart.js`).**

- HUD: below the existing lap readout, show the current lap's running time and,
  once a PB exists for this track and chassis, a signed delta against the same
  lap of the best race (`+1.24` / `-0.31`), coloured green when ahead.
- Storage key `carball.kart.pb`, one JSON object:

```json
{
  "circuit:coupe:1": { "lap": 24.183, "race": 78.402, "at": "2026-08-21" }
}
```

  Key is `${track}:${chassis}:${SIM_VERSION}`. Entries whose version does not
  match the current `SIM_VERSION` are ignored on read and dropped on write.
- Written when the local kart's `finished` goes non-null: `race` if the time
  beats the stored one, `lap` if the best of `splits` deltas does.
- Recorded from **any** race, solo or room. Items and traffic make a room lap
  noisier, but a best is a best and the alternative — a purity filter on
  "clean" laps — is a rule nobody asked for. The UI says "your best", not
  "clean lap".
- Results panel gains a "best lap" row for the local player, and marks a new PB
  with a one-line "new personal best" note.

### Acceptance criteria

- A three-lap race produces exactly three entries in `splits`, ascending.
- A lateral wobble across the line does not add a split (the existing test at
  `test/kart.test.js:652` covers the lap-turnover rule; extend it to splits).
- `splits[2] === kart.finished` for a kart that finishes.
- A kart that never finishes has `splits.length < 3` and writes no PB.
- Reloading the page and racing the same track/chassis shows the delta.
- Bumping `SIM_VERSION` makes every stored PB disappear from the UI.

### Cost

~4 lines in `shared/kart.js`, ~70 in `client/kart.js`, one constant, two tests.

---

## Feature 2 — Ghost of your best lap (Kart, solo and room)

Race against a translucent kart driving your best recorded race on this track.

### Design decision: poses, not inputs

The obvious implementation is to replay the recorded input log through a second
`createRace()`. Rejected, for two reasons:

1. A faithful input replay needs the *whole field* re-simulated — the AI, the
   item boxes, the bumps — because a kart's line depends on what happened around
   it. That is a second full sim stepping every frame.
2. It would make the retention feature depend on Feature 0's outcome.

Instead a ghost is a **recorded pose track**: the local kart's
`{x, y, heading}` sampled at `SNAPSHOT_HZ` (12/sec) and linearly interpolated at
render time. Engine-independent, no second sim, ~15 KB of JSON for a 90-second
race, and it looks exactly as right as an input replay would.

### Design

**Recording (`client/kart.js`).** In the solo branch of `frame()` (line 738) and
in the local-kart path for rooms, accumulate a sample every
`TICK_HZ / SNAPSHOT_HZ` ticks while `phase === 'RACE'`:

```js
ghostRec.push(round2(kart.x), round2(kart.y), round3(kart.heading))
```

A flat array of numbers, not objects — smaller in `localStorage` and cheaper to
walk. Recording is discarded unless the race becomes a new PB.

**Storage.** Key `carball.kart.ghost`, one entry per `track:chassis:SIM_VERSION`,
holding `{ v: SIM_VERSION, hz: 12, poses: [...], race: 78.402 }`. Cap the store
at 6 entries (one per track), evicting the oldest — `localStorage` is 5 MB and a
ghost is 15 KB, so this is a tidiness rule rather than a real limit.

**Playback.** The ghost is drawn, never simulated: a kart mesh at 35 % opacity,
no wheels-turning detail, no collision, no HUD presence, not in the placings.
Sample by `state.time * hz`, interpolate between the two straddling poses —
the same shape as the existing snapshot interpolation in `blendKart()`.

**Controls.** A "Ghost" toggle on the pick screen, defaulting on when one exists
for the chosen track and chassis. Off when no ghost exists — no empty checkbox.

### Acceptance criteria

- A solo race that beats the stored PB writes a ghost; one that does not leaves
  the stored ghost alone.
- With a ghost present, the ghost kart is visible from the lights and reaches
  the line at exactly its recorded `race` time.
- The ghost never appears in the results table, the placings, or `state.karts`.
- Changing chassis loads a different ghost or none.
- A ghost stored under a stale `SIM_VERSION` is ignored and evicted.
- Zero new Realtime messages in a room race with a ghost showing (verify by
  counting `send()` calls, which Feature 4's test harness already needs).

### Cost

~120 lines in `client/kart.js`, one new render path, no sim change, no netcode.

---

## Feature 3 — Shareable race links (Kart)

A finished race becomes a URL. Opening it watches the race back; a "beat this"
button starts a solo race on the same seed and track.

### Design

**Form A — full race (requires Feature 0, outcome A).**

Payload, base64url in the hash as `#r=<payload>`:

| Field | Bytes | Notes |
|---|---|---|
| `v` | 1 | payload format |
| `sim` | 1 | `SIM_VERSION` — a mismatched link refuses to play rather than lying |
| `seed` | 4 | uint32 |
| `track` | 1 | index into `TRACK_KEYS` |
| `chassis` | 1 | index into `CHASSIS_KEYS` |
| `ticks` | 3 | uint24 |
| `bits` | ~2×N | run-length pairs `(bits, runLen)`, `runLen` capped at 255 |

Input bits change a few hundred times in a race, not 5400, so RLE takes the log
from ~5.4 KB to well under 1 KB — roughly a 1.3 KB URL after base64. RLE is
about ten lines each way and it is what makes this a link rather than a file.

Playback recreates `createRace(racers, seed, track)` with the same AI field —
which is deterministic given the seed — and steps it with the decoded bits.
The player's name travels in the payload only as a display string, cleaned
through `cleanName()` from `shared/protocol.js` before it is shown.

**Form B — pose track (Feature 0, outcome B).** Same envelope, `bits` replaced
by the Feature 2 pose array quantised to int16 (2 cm resolution), sharer's kart
only, drawn against an empty track. Roughly 4 KB base64, which is still a
usable link. Watchable, not re-runnable.

**Either form:** a "Race this track" button that calls `startSolo()` with the
link's seed and track instead of a random one. That is the challenge, and it is
the only reason a link is worth sending to someone.

### Trust

A link is untrusted input from a stranger. It is decoded, bounds-checked, and
**never** written to `carball.kart.pb` or `carball.kart.ghost`. A time watched
from a link is not a time you set. Malformed payloads show "that link did not
decode" and drop to the normal gate — no throw, no blank page.

### Acceptance criteria

- A race recorded and immediately replayed from its own link produces the same
  finishing time to within 0.05 s (form A) or exactly (form B, by construction).
- A link with a mismatched `sim` byte refuses to play and says why.
- A truncated, over-long, or garbage payload shows the error and never throws.
- The generated URL for a 90-second race is under 2 000 characters.
- Nothing in a link can write to local storage.

### Cost

~180 lines, one new file (`client/kart-replay.js`) for encode/decode plus a
`test/kart-replay.test.js` round-trip test. Gated on Feature 0.

---

## Feature 4 — Cap the wire, and make the board mean something

Two debts that every feature above would otherwise inherit. Both verified.

### 4a — Peer input rate cap

`flushInput()` (`client/net.js:227`) is edge-triggered on every bitmask change,
with a 60 Hz `setInterval` backstop and **no cap**. The comment says "only a
change costs a message", which is true and is precisely the problem: a peer
drifting through a corner while tapping an item changes bits many times a
second, and the ceiling is 60 msg/sec per peer. The careful 6× cut that produced
`SNAPSHOT_HZ = 12` budgeted only the host's side of the wire.

**Design.** A minimum interval between sends, with a trailing flush so the last
state always arrives:

```js
// shared/constants.js
// The other half of the snapshot budget. Peer input is edge-triggered, so
// without a floor on the interval a busy corner can cost 60 messages a second
// per player — five times what the host spends on the whole room. 20 is above
// the rate a human actually changes direction at and well inside the budget.
export const INPUT_HZ = 20
```

`flushInput` sends immediately if `INPUT_MS` has passed since the last send;
otherwise it marks dirty and a single trailing timer sends the latest bits at
the window's end. Coalescing, not dropping: the *last* value always goes out,
which is the only one that matters.

**Acceptance:** a test drives 200 bitmask changes through a fake clock across
one second and asserts (a) at most 20 sends, (b) the final `bits` value was
sent, (c) a single isolated change still goes out within `INPUT_MS`.

### 4b — Graceful "the rooms are full" path

There is no way to read project-wide Realtime usage from a browser, and a room
registry table is more machinery than the current traffic justifies. Instead,
handle the failure honestly: when `channel.subscribe()` returns `CHANNEL_ERROR`
or times out, say "the rooms are busy right now — solo is always open" and put
the solo button under it. Roughly 15 lines in `client/net.js` and the two gate
screens.

*Escalation path, deliberately not built:* if this message is ever actually
seen, add a `rooms` table with a host heartbeat and refuse room creation above a
budget. Not before.

### 4c — A leaderboard that is not a fiction

`buildRow()` (`api/record-match.js:66`) takes `score` from the request body and
validates only `goals >= 0 && goals <= score[team]`, with `score` entries capped
at 999. A signed-in user can POST `{matchId: <fresh uuid>, score: [999, 0],
team: 0, goals: 999}` and write a legitimate-looking winning row, repeatedly.
The per-player-writes-own-row design is right; the missing piece is that a
player can currently lie *arbitrarily* about themselves rather than merely
plausibly.

Server re-simulation is the textbook fix and it is not available here — it needs
bit-exact cross-engine determinism (Feature 0 may rule it out) and full input
logs on the wire (which the message budget rules out).

**Design: corroboration.** A match counts toward the leaderboard only when two
or more distinct users report it with a consistent score.

- Store the reported score on the row: `score_blue`, `score_orange` smallint.
- Tighten the bounds: a score above 30 is not a football result. `goals <= 30`,
  each score entry `<= 30`.
- Change the `leaderboard` view to count only rows whose `match_id` has at least
  two reporting users agreeing on `(score_blue, score_orange)`.

```sql
alter table public.match_players
  add column if not exists score_blue smallint not null default 0
    check (score_blue between 0 and 30),
  add column if not exists score_orange smallint not null default 0
    check (score_orange between 0 and 30);

create or replace view public.corroborated_matches
with (security_invoker = true) as
select match_id
from public.match_players
group by match_id, score_blue, score_orange
having count(distinct user_id) >= 2;
```

The `leaderboard` view then joins `match_players` against
`corroborated_matches`. Everything else about it is unchanged.

**The trade this makes, stated plainly:** a match with only one signed-in human
stops counting. That is the intended effect — a result nobody else witnessed is
not a competitive record — but it does mean a signed-in player racing bots, or
playing with guests, builds no career. If that is not acceptable, the
alternative is to keep counting single-reporter matches in a separate
"unranked" total, which is more UI than it is worth today.

**Acceptance:** the crafted 999-goal POST still writes its row and that row
never appears in the leaderboard; a genuine 3v3 match with three signed-in
players does appear; existing rows (no score columns) default to 0-0 and are
excluded until re-reported, which is correct — they are the untrusted history.

### Cost

~40 lines in `client/net.js` + one constant + one test (4a), ~15 lines (4b),
~30 lines of JS and ~25 of SQL plus a `buildRow` test (4c). `buildRow` is
already exported and unit-testable.

---

## Feature 5 — The front door

The scope here is smaller than the council thought, because two of its
complaints are already handled:

- **Guest-first invite links already work.** `client/lobby.js:24` sends a
  `#ABCD` hash straight to `./game#ABCD`, and `client/game.js` prompts for a
  name when a guest arrives on someone's link with nothing stored. Kart does the
  same via its `invited` path. No password wall exists. **No work needed.**
- Kart's gate screen already lists the controls.

What is actually missing:

### 5a — The lobby does not say what either game is

`client/index.html` offers "Car Football — Four letters. Six cars. One ball."
and "Kart — three laps, items, solo or in a room". Both names are opaque until
you have clicked one.

**Design.** Two captured stills (WebP, ~40 KB each, `client/img/`), one per
game, each with a single line of copy naming the genre in words a stranger
already knows:

- Car Football — *"Football, but everyone is driving. 3v3, five minutes."*
- Kart — *"Kart racing with items. Three laps. Race five AI right now, alone."*

Kart's card leads with its solo CTA, because that is the only door a lone
visitor can walk through. Stills rather than video or a live canvas: a looping
render of either game on the landing page costs a three.js bundle on a page that
currently ships none.

### 5b — Controls are invisible once the race starts

A fading overlay over the first race of a session: the four keys, drift, and
item, bottom-centre, full opacity for 6 s then fading over 3 s. Suppressed
after the first race via `carball.kart.seen`. Also flash "drift for a boost" the
first time a drift charges to tier one — the mechanic is the whole skill ceiling
and it is currently undiscoverable.

### 5c — Touch controls

`client/input.js` is keyboard-only: `KEYS`, `keydown`, `keyup`, `blur`. Every
link shared under Feature 3 will be opened on a phone, and today it opens a game
that cannot be played.

**Design.** Touch feeds the same `setBits()` path, so nothing downstream
changes:

- Throttle held automatically while any touch is down — a phone player should
  not have to hold accelerate.
- Left thumb zone: horizontal drag steers, `IN_LEFT` / `IN_RIGHT` past a small
  dead zone.
- Right side: two buttons, drift (`IN_DRIFT`) and item. Kart's `useItem()` fires
  on `IN_ITEM | IN_BOOST` (`shared/kart.js:1162`), so either bit works; send
  `IN_ITEM`. A long press on the item button adds `IN_AIM`, which reverses the
  shot (`shared/kart.js:1176`).
- Shown only when `matchMedia('(pointer: coarse)')` matches.
- `touchcancel` and `visibilitychange` clear bits, the same reason `blur` does.

This is the largest single piece of work in the spec and the only piece that
touches a file both games share. It is scoped to Kart's page first; Carball
inherits `input.js` and gets the same controls for free, but its HUD placement
is not in scope here.

### Acceptance criteria

- A first-time visitor on the lobby can tell which game is which without
  clicking.
- The controls overlay appears once and never again in the same session.
- On a phone, a Kart race is completable: the kart accelerates, steers both
  ways, drifts, and fires an item.
- On a desktop with a mouse, no touch UI is rendered at all.
- `currentBits()` returns 0 after a `touchcancel`.

### Cost

Two images and ~20 lines of HTML/CSS (5a), ~50 lines (5b), ~150 lines across
`client/input.js` and `client/kart.html` (5c).

---

## Explicitly out of scope

- **Carball bots.** Two advisors wanted them and the reasoning is sound — a lone
  visitor to Carball bounces. But `shared/sim.js` contains no AI at all, and
  Kart's `aiBits` is a racing-line follower that does not transfer to chasing a
  ball toward a goal. It is the most expensive item anyone proposed, it splits
  focus back across both games, and it cannot ride on any of the work above.
  Revisit once Features 1–3 show whether the async thesis holds.
- **Track of the day** and a **track editor.** Both strong; both need a
  trustworthy server-side board, which Feature 4c deliberately does not build.
- **Kart results in the database.** Feature 1 is `localStorage` only. A Kart
  board needs a new table and inherits every question in 4c. Deferred on
  purpose.
- **Sound in Kart.** `client/sound.js` is imported only by `client/game.js`;
  Kart is silent. Real, cheap, and not one of the five.
- Host migration, more than 6 players, and any increase to `SNAPSHOT_HZ`. Each
  fights the one constraint that can take both games down at once.

## Sequencing

| # | Feature | Depends on | Rough size |
|---|---|---|---|
| 0 | Determinism gate | — | 1 evening, decides F3's form |
| 4a | Input rate cap | — | small, do it first, it is a live risk |
| 1 | Splits + PBs | `SIM_VERSION` | small |
| 2 | Ghosts | F1 | medium |
| 4c | Corroborated board | — | small, one migration |
| 5b | Controls overlay | — | small |
| 3 | Replay links | F0, F1, F2 | medium |
| 5c | Touch controls | — | medium, the biggest single piece |
| 5a | Lobby stills | two screenshots | small |
| 4b | Busy path | — | small |

Features 4a and 0 come first for different reasons: 4a because it is a live
risk that gets worse the moment anything here succeeds, and 0 because it decides
the shape of F3 before any of F3 is written.

## Open questions for sign-off

1. **PBs from room races, or solo only?** This spec says any race. Items and
   traffic make a room lap noisy; the counter-argument is that a best is a best.
2. **Feature 4c's trade:** a signed-in player racing bots or playing with guests
   builds no career. Acceptable, or is an "unranked" total needed?
3. **Touch scope:** Kart only, or Carball's HUD too? Carball inherits the input
   layer for free either way.
