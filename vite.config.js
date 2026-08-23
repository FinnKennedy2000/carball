import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    {
      // Vite stamps crossorigin on every script and stylesheet tag it emits.
      // Every one of these files is served from the same origin as the page, so
      // the attribute buys nothing — and it costs: a crossorigin stylesheet
      // answered out of a service worker cache is treated as tainted, so the
      // sheet loads, its rules are unreadable, every custom property resolves to
      // nothing, and the installed game comes up unstyled with no error to find.
      name: 'carball:no-crossorigin',
      enforce: 'post',
      transformIndexHtml: (html) => html.replace(/\s+crossorigin(?:="[^"]*")?/g, ''),
    },
  ],
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
    // the workbenches its item and chassis models are looked at on.
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('client/index.html', import.meta.url)),
        game: fileURLToPath(new URL('client/game.html', import.meta.url)),
        garage: fileURLToPath(new URL('client/garage.html', import.meta.url)),
        kart: fileURLToPath(new URL('client/kart.html', import.meta.url)),
        kartItems: fileURLToPath(new URL('client/kart-items.html', import.meta.url)),
        kartChassis: fileURLToPath(new URL('client/kart-chassis.html', import.meta.url)),
      },
    },
  },
})
