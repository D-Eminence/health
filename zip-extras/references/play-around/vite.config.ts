import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync } from 'node:fs'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-settings-dashboard',
      closeBundle() {
        cpSync('settings-dashboard', 'dist/settings-dashboard', { recursive: true })
      },
    },
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    // The first test in a file pays the jsdom boot + module transform cost, so
    // the default 5s budget flakes on a loaded machine. 20s for the test body
    // and 20s for each hook keeps a slow cold start from looking like a bug.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
