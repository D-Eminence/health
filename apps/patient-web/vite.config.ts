import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The patient application.
 *
 * Vite rather than Next.js, deliberately. Every screen here renders data that
 * belongs to one signed-in person: there is nothing to pre-render, nothing to
 * cache at the edge, and no crawler to serve. Adding a server rendering tier
 * would add a hop that handles PHI without adding anything a patient benefits
 * from. The existing operational application is already built this way, so this
 * is also the path that does not require rewriting what works.
 */
export default defineConfig({
  // Only `VITE_HID_` variables reach the bundle. Anything else stays server-side.
  envPrefix: 'VITE_HID_',
  plugins: [react(), tailwindcss()],
  server: { port: 3200, strictPort: true },
  preview: { port: 3200, strictPort: true },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/react-router')) return 'vendor-router'
          if (id.includes('/react-dom/') || id.includes('/react/')) return 'vendor-react'
          return undefined
        },
      },
    },
  },
})
