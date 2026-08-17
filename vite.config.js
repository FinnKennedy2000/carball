import { defineConfig } from 'vite'

export default defineConfig({
  root: 'client',
  // .env lives at the repo root, which the server reads too. Without this Vite
  // would look inside client/ and silently bundle no configuration at all.
  envDir: '..',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
