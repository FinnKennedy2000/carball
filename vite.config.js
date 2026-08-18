import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'client',
  // .env lives at the repo root, which the server reads too. Without this Vite
  // would look inside client/ and silently bundle no configuration at all.
  envDir: '..',
  // NEXT_PUBLIC_ is not a Next thing here: it is the prefix the Supabase Vercel
  // integration uses for the variables it means to be public, and without it
  // listed those never reach the bundle. See client/auth.js.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Two pages: the lobby, and the match the invite link opens.
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('client/index.html', import.meta.url)),
        game: fileURLToPath(new URL('client/game.html', import.meta.url)),
        garage: fileURLToPath(new URL('client/garage.html', import.meta.url)),
      },
    },
  },
})
