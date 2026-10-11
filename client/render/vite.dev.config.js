import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
const real = fileURLToPath(new URL('../../shared/arena.js', import.meta.url))
const stub = fileURLToPath(new URL('./dev-arena-stub.js', import.meta.url))
const saver = {
  name: 'save-shot',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', async () => {
        const { writeFileSync, mkdirSync } = await import('node:fs')
        const name = new URL(req.url, 'http://x').searchParams.get('name').replace(/[^\w-]/g, '')
        const dir = fileURLToPath(new URL('../../.shots/', import.meta.url))
        mkdirSync(dir, { recursive: true })
        writeFileSync(dir + name + '.png', Buffer.from(b.split(',')[1], 'base64'))
        res.end('saved ' + name)
      })
    })
  },
}
export default defineConfig({
  plugins: [saver],
  root: fileURLToPath(new URL('..', import.meta.url)),
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias: existsSync(real) ? {} : [{ find: /^(\.\.\/)+shared\/arena\.js$/, replacement: stub }] },
  server: { fs: { allow: ['../..'] } },
})
