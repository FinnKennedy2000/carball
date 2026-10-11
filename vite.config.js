import { defineConfig } from 'vite'

export default defineConfig({
  root: 'client',
  // .env lives at the repo root; without this Vite would look inside client/.
  envDir: '..',
  // NEXT_PUBLIC_ is the prefix the Supabase Vercel integration writes. See client/auth.js.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: { outDir: '../dist', emptyOutDir: true },
})
