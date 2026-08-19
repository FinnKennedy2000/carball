// The race room: seating peers off the channel, and the result it broadcasts.
// The host's tick loop runs on a timer, so the clock is mocked and wound on.

import test from 'node:test'
import assert from 'node:assert/strict'
import { startKartHost } from '../client/kart-host.js'
import { IN_FWD } from '../shared/constants.js'

/**
 * Wind the host's tick loop on. One small step at a time, because the mock
 * clock jumps straight to the end of a tick() — a single big step would arrive
 * as one enormous frame, and the loop caps its catch-up rather than spiralling.
 */
function advance(t, seconds) {
  for (let i = 0; i < Math.round((seconds * 1000) / 17); i++) t.mock.timers.tick(17)
}

function room(t) {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  const sent = []
  const host = startKartHost({ send: (event, payload) => sent.push({ event, payload }), hostName: 'host' })
  t.after(() => host.stop())
  return { host, sent, last: (event) => [...sent].reverse().find((m) => m.event === event) }
}

test('a joiner races the chassis it said it was driving', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  let state = null
  const host = startKartHost({
    send: () => {},
    live: (s) => (state = s),
    hostName: 'host',
    hostChassis: 'bike',
  })
  t.after(() => host.stop())
  host.onPeerMessage({ t: 'hello', cid: 'peer-1', name: 'joiner', chassis: 'van' })
  host.onPeerMessage({ t: 'hello', cid: 'peer-2', name: 'other', chassis: 'hovercraft' })
  host.begin()
  advance(t, 0.1)
  const grid = state.karts
  assert.equal(grid.find((k) => k.name === 'host').chassis, 'bike')
  assert.equal(grid.find((k) => k.name === 'joiner').chassis, 'van')
  // Anything that is not one of the six is a Coupe, and the field the room fills
  // out with AI is dealt its own cars.
  assert.equal(grid.find((k) => k.name === 'other').chassis, 'coupe')
  assert.ok(grid.filter((k) => k.ai).every((k) => k.chassis))
})

test('a peer is seated once, however often it says hello', (t) => {
  const { host, sent, last } = room(t)
  host.onPeerMessage({ t: 'hello', cid: 'peer-1', name: 'joiner' })
  host.onPeerMessage({ t: 'hello', cid: 'peer-1', name: 'joiner' })
  assert.equal(last('roster').payload.players.length, 2)
  const welcomes = sent.filter((m) => m.event === 'welcome')
  assert.equal(welcomes.length, 2)
  assert.equal(welcomes[0].payload.id, welcomes[1].payload.id)

  host.onPeerMessage({ t: 'bye', cid: 'peer-1' })
  assert.equal(last('roster').payload.players.length, 1)
})

test('rubbish off the channel is ignored rather than seated', (t) => {
  const { host, sent } = room(t)
  host.onPeerMessage(null)
  host.onPeerMessage({ t: 'hello' })
  host.onPeerMessage({ t: 'input', cid: 'x', seq: -1, bits: 999 })
  assert.equal(sent.filter((m) => m.event === 'welcome').length, 0)
})

test('the field is filled with AI, and the result is the finishing order', (t) => {
  const { host, sent, last } = room(t)
  host.onPeerMessage({ t: 'hello', cid: 'peer-1', name: 'joiner' })
  host.begin()
  // The joiner holds the throttle down and steers nowhere; the AI race properly.
  host.onPeerMessage({ t: 'input', cid: 'peer-1', seq: 1, bits: IN_FWD })

  advance(t, 1)
  const snap = last('snap')
  assert.equal(snap.payload.s.karts.length, 6, 'the grid is filled out with AI')
  // A box never moves, so only its cooldown is on the wire.
  assert.ok(snap.payload.s.boxes.every((b) => typeof b === 'number'))

  // Wind the clock through a whole race.
  advance(t, 300)

  const over = last('matchover')
  assert.ok(over, 'no result was broadcast')
  const places = over.payload.players
  assert.equal(places.length, 6)
  places.forEach((p, i) => assert.equal(p.place, i + 1))
  // First across the line is first in the list, and won.
  const finished = places.filter((p) => p.time !== null)
  assert.ok(finished.length >= 1)
  assert.equal(finished[0].place, 1)
  finished.slice(1).forEach((p, i) => assert.ok(p.time >= finished[i].time))

  // One result per race, not one a tick.
  assert.equal(sent.filter((m) => m.event === 'matchover').length, 1)
})

test('a race that is over can be put back on the grid', (t) => {
  const { host, last } = room(t)
  host.begin()
  advance(t, 300)
  assert.equal(last('snap').payload.s.phase, 'OVER')
  host.begin()
  advance(t, 0.2)
  const s = last('snap').payload.s
  assert.ok(s.phase === 'COUNT' || s.phase === 'RACE')
  assert.equal(s.time < 1, true)
})
