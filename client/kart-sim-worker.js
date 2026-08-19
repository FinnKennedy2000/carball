// The race host's simulation, off the main thread — for the same reason the
// football one is: the host renders what it simulates, and a slow frame on the
// main thread would slow the tick for everyone in the room.

import { startKartHost } from './kart-host.js'

let host = null

onmessage = ({ data }) => {
  switch (data.type) {
    case 'start':
      host = startKartHost({
        send: (event, payload) => postMessage({ type: 'send', event, payload }),
        live: (state) => postMessage({ type: 'live', s: state }),
        hostName: data.hostName,
        hostChassis: data.hostChassis,
      })
      postMessage({ type: 'started', hostId: host.hostId, hostTeam: 0, roster: host.roster() })
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
