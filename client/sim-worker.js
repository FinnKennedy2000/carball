// The host's simulation, run off the main thread.
//
// It has to be off it. The host renders the same match it is simulating, and on
// the main thread a slow frame is a slow tick — measured at 5 ticks/sec instead
// of 60 while three.js was busy, which stretches the clock for every player in
// the room, not just the host. A worker keeps the tick loop at real speed no
// matter what the host's GPU is doing.
//
// The worker owns the state and nothing else: the channel stays on the main
// thread, which forwards peer messages in and broadcasts what comes out.

import { startHost } from './host.js'

let host = null

onmessage = ({ data }) => {
  switch (data.type) {
    case 'start':
      host = startHost({
        code: data.code,
        send: (event, payload) => postMessage({ type: 'send', event, payload }),
        hostName: data.hostName,
        hostTeam: data.hostTeam,
      })
      postMessage({ type: 'started', hostId: host.hostId, hostTeam: host.hostTeam, roster: host.roster() })
      break
    case 'peer':
      host?.onPeerMessage(data.payload)
      break
    case 'begin':
      host?.begin()
      break
    case 'localBits':
      host?.setLocalBits(data.bits)
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
