import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Dev only: while a sibling module is still being written, stand in for it so
// the UI can be worked on. Never applies to `vite build`.
const at = (p) => fileURLToPath(new URL(p, import.meta.url))
function devStubs() {
  const want = [
    ['client/render/index.js', 'render', () => true],
    ['client/audio/index.js', 'audio', () => true],
    ['client/net.js', 'net', (s) => s.includes('playOffline')],
    ['client/input.js', 'input', (s) => s.includes('getBindings')],
  ]
  const alias = {}
  // note: keyed by absolute path of the missing/outdated module
  for (const [file, stub, ok] of want) {
    if (!existsSync(at(file)) || !ok(readFileSync(at(file), 'utf8'))) alias[at(file)] = at(`client/ui/stubs/${stub}.js`)
  }
  return {
    name: 'carball:dev-stubs',
    enforce: 'pre',
    async resolveId(src, importer, opts) {
      if (!importer || !src.startsWith('.')) return null
      const r = await this.resolve(src, importer, { ...opts, skipSelf: true })
      const hit = alias[r?.id ?? fileURLToPath(new URL(src, 'file://' + importer))]
      return hit ?? null
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: command === 'serve' ? [devStubs()] : [],
  root: 'client',
  // .env lives at the repo root; without this Vite would look inside client/.
  envDir: '..',
  // NEXT_PUBLIC_ is the prefix the Supabase Vercel integration writes. See client/auth.js.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: { outDir: '../dist', emptyOutDir: true },
}))
