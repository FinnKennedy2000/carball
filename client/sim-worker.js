// The host's simulation, off the main thread: on the main thread a slow render
// frame is a slow tick, which stretches the match clock for everyone. The worker
// owns the state; the channel stays on the main thread, which forwards peer
// messages in and broadcasts what comes out. Offline play is the same worker with
// no channel: the main thread just handles 'send' locally.

import { startHost } from './host.js'

let host = null

onmessage = (m) => {
  try {
    handle(m.data)
  } catch (err) {
    postMessage({ type: 'fatal', message: String(err?.message ?? err) })
    host?.stop()
    host = null
  }
}

function handle(data) {
  switch (data.type) {
    case 'start':
      host?.stop()
      host = startHost({
        code: data.code,
        hostCid: data.hostCid,
        name: data.name,
        team: data.team,
        body: data.body,
        teamSize: data.teamSize,
        onFatal: (err) => postMessage({ type: 'fatal', message: String(err?.message ?? err) }),
        send: (event, payload) => postMessage({ type: 'send', event, payload }),
        // Every tick, in order. `events` is just this tick's, so the main thread
        // can queue them without diffing.
        live: (s, events) => postMessage({ type: 'live', s, events }),
      })
      postMessage({ type: 'started', hostId: host.hostId, hostTeam: host.hostTeam, roster: host.roster() })
      break
    case 'peer':
      host?.onPeerMessage(data.payload)
      break
    case 'begin':
      host?.begin()
      break
    case 'input':
      host?.setLocalInput(data.input)
      break
    case 'dropPeer':
      host?.dropPeer(data.cid)
      break
    case 'stop':
      host?.stop()
      host = null
      break
  }
}
