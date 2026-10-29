import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
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

const SHELL_PLACEHOLDER = 'self.__HID_SHELL__ = null'
// What the shell keeps besides index.html: the build's own files under assets/, its web app manifest and its icons.
const SHELL_FILE = /^(?:assets\/[A-Za-z0-9][A-Za-z0-9_.-]*|health-id\.webmanifest|icons\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png)$/

function builtFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? builtFiles(join(directory, entry.name))
    : [join(directory, entry.name)])
}

/**
 * Writes the app shell's file list into the built sw.js (docs/OFFLINE-CONTRACT.md 2.12, amendment A5), replacing
 * `self.__HID_SHELL__ = null`. Only a build whose offline mode is pilot or on gets one: scripts/build-staging.py
 * builds every other host with mode off, and there the worker stays a push-only worker that handles no request.
 * The list is the build's own files and nothing else; the build name is a digest of them, so a new build is a new
 * cache generation. A production build with the offline debug panel on is refused here, before anything ships.
 */
function hidShellManifest(): Plugin {
  let outDir = ''
  let env: Record<string, string> = {}
  return {
    name: 'hid-shell-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      env = config.env as Record<string, string>
      const mode = env.VITE_HID_OFFLINE_MODE ?? 'off'
      if (!['off', 'pilot', 'on'].includes(mode)) throw new Error('VITE_HID_OFFLINE_MODE must be off, pilot or on.')
      if (env.VITE_HID_OFFLINE_DEBUG === 'true' && env.VITE_HID_ENVIRONMENT === 'production') {
        throw new Error('The offline debug panel cannot be built for production.')
      }
    },
    closeBundle() {
      const workerPath = join(outDir, 'sw.js')
      const worker = readFileSync(workerPath, 'utf8')
      if (worker.split(SHELL_PLACEHOLDER).length !== 2) throw new Error(`sw.js must contain ${SHELL_PLACEHOLDER} exactly once.`)
      const mode = env.VITE_HID_OFFLINE_MODE ?? 'off'
      if (mode === 'off') return
      const assets = builtFiles(outDir).map(path => relative(outDir, path).split(sep).join('/'))
        .filter(path => SHELL_FILE.test(path)).sort()
      const digest = createHash('sha256')
      for (const path of ['index.html', ...assets]) digest.update(path).update('\0').update(readFileSync(join(outDir, path))).update('\0')
      const shell = {
        build: digest.digest('hex').slice(0, 16),
        environment: env.VITE_HID_ENVIRONMENT ?? 'local',
        debug: env.VITE_HID_OFFLINE_DEBUG === 'true',
        assets: assets.map(path => `/${path}`),
      }
      writeFileSync(workerPath, worker.replace(SHELL_PLACEHOLDER, `self.__HID_SHELL__ = ${JSON.stringify(shell)}`))
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
    plugins: [publicEnvironmentGuard(), react(), tailwindcss(), hidShellManifest()],
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
            // The app shell's registration gets a chunk of its own, the one besides pushDevice's that the launch build
            // check lets use the service worker API (scripts/check-launch-build.mjs).
            if (id.endsWith('/src/offline/shell.ts')) return 'shell'
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
