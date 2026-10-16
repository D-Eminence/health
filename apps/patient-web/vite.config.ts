import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// By path rather than through @hid/config: Vite loads this file with Node and
// leaves package imports to Node, which cannot load that package's TypeScript.
import { assertPublicEnvironment } from '../../packages/config/src/guards'
import { PORTAL_HOSTNAMES } from './src/productHostname'

/**
 * Refuses to build (or serve) when a VITE_HID_ variable is named like a secret
 * or holds a credential. Everything under that prefix can reach the bundle, so
 * the check runs before anything is written: the one in env.ts runs in the
 * browser, after the value has shipped.
 */
function publicEnvironmentGuard(): Plugin {
  return {
    name: 'hid-public-environment-guard',
    configResolved(config) {
      assertPublicEnvironment(Object.fromEntries(Object.entries(config.env)
        .filter(([key, value]) => key.startsWith('VITE_HID_') && typeof value === 'string')))
    },
  }
}

/**
 * The authenticated Health ID portal.
 *
 * Vite rather than Next.js, deliberately. Every screen here renders data that
 * belongs to a signed-in patient, provider, or administrator. There is nothing
 * to pre-render or cache at the edge. The browser uses a same-origin gateway
 * route for cookie sessions, while server rendering would add a PHI-handling hop.
 */
export default defineConfig(({ mode }) => {
  const localGateway = loadEnv(mode, process.cwd(), '').HID_LOCAL_GATEWAY_ORIGIN ?? 'http://localhost:3000'
  const target = new URL(localGateway)
  if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('HID_LOCAL_GATEWAY_ORIGIN must be an HTTP origin.')
  }
  return {
    // Only VITE_HID_ variables reach the bundle. Anything else stays server-side.
    envPrefix: 'VITE_HID_',
    plugins: [publicEnvironmentGuard(), react(), tailwindcss()],
    server: {
      port: 3200,
      strictPort: true,
      // The hosts the portal opens a workspace on; the preview server takes this list too.
      allowedHosts: [...PORTAL_HOSTNAMES],
      proxy: { '/api/v1': { target: target.origin, changeOrigin: true } },
    },
    preview: { port: 3200, strictPort: true },
    build: {
      // The portal's source, comments included, is not published beside it.
      sourcemap: false,
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
  }
})
