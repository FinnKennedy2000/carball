import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

import { Rooms } from './room.js'
import { parse } from './protocol.js'
import { identify, authEnabled, statsEnabled } from './accounts.js'

const PORT = Number(process.env.PORT ?? 3000)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }

  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  // Resolve then verify the result is still inside dist — this is what stops
  // ../../etc/passwd, not the string check.
  let file = path.resolve(DIST, '.' + urlPath)
  if (!file.startsWith(DIST + path.sep) && file !== DIST) {
    res.writeHead(403).end()
    return
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')

  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Run `pnpm build` first.')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

const rooms = new Rooms()
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (socket) => {
  // A socket belongs to no room until it creates or joins one. `entering` guards
  // the await while a token is verified: without it, two quick join messages
  // would both pass the room check and the socket would occupy two cars.
  let room = null
  let playerId = null
  let entering = false

  socket.on('message', async (data) => {
    const msg = parse(data.toString())
    if (!msg) return // malformed input is dropped, never thrown

    if (msg.t === 'create' || msg.t === 'join') {
      if (room || entering) return
      entering = true
      try {
        // An unverifiable token is not an error: that player is simply a guest.
        const identity = await identify(msg.token)

        let target
        if (msg.t === 'create') {
          target = rooms.create()
        } else {
          target = rooms.get(msg.code)
          if (!target) {
            send(socket, { t: 'error', reason: 'No room with that code' })
            return
          }
          if (target.full) {
            send(socket, { t: 'error', reason: 'Room is full' })
            return
          }
        }

        // The socket may have gone away while the token was being checked.
        if (socket.readyState !== socket.OPEN) return

        room = target
        playerId = room.join(socket, msg.name, msg.team, identity).id
      } finally {
        entering = false
      }
      return
    }

    if (msg.t === 'input' && room) room.setInput(playerId, msg.bits)
  })

  const drop = () => {
    if (room && playerId !== null) room.leave(playerId)
    room = null
    playerId = null
  }
  socket.on('close', drop)
  socket.on('error', drop)
})

server.listen(PORT, () => {
  for (const addr of localAddresses()) console.log(`  http://${addr}:${PORT}`)
  console.log(
    `  accounts: ${authEnabled ? 'on' : 'off (guest play only)'}` +
      `, stats: ${statsEnabled ? 'on' : 'off'}`,
  )
})

function send(socket, msg) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
}

function localAddresses() {
  const out = ['localhost']
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
  }
  return out
}
