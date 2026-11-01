import { defineConfig } from 'vite'

// Static, fully client-side app. No backend, no env injection.
export default defineConfig({
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5180 },
})
