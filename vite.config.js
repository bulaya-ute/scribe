import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// Static, fully client-side app. No backend, no env injection.
// The version is baked in so the deployed build can state what it is (PRIN-2, NFR-version).
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5180 },
})
