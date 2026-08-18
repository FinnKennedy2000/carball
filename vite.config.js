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
    // The lobby, the match an invite link opens, the garage, the kart race, and
    // the workbench its item models are looked at on.
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('client/index.html', import.meta.url)),
        game: fileURLToPath(new URL('client/game.html', import.meta.url)),
        garage: fileURLToPath(new URL('client/garage.html', import.meta.url)),
        kart: fileURLToPath(new URL('client/kart.html', import.meta.url)),
        kartItems: fileURLToPath(new URL('client/kart-items.html', import.meta.url)),
      },
    },
  },
})
