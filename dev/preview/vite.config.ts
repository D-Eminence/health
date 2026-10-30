/**
 * Static preview build of the portal with the mock gateway running in the page
 * (dev/mock-gateway/browser-shim.mjs), so it can be opened anywhere with no
 * backend and no dev server. UI review only: sample data, never deployed.
 *
 *   npm run build:preview   →   dev/preview/dist
 */
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import portalConfig from '../../apps/patient-web/vite.config'

const SHIM = fileURLToPath(new URL('../mock-gateway/browser-shim.mjs', import.meta.url))
const SHIM_ID = '/__mock-gateway-shim.mjs'

function mockGatewayShim(): Plugin {
  return {
    name: 'hid-preview-mock-gateway',
    resolveId: id => (id === SHIM_ID ? SHIM : null),
    // Before Vite processes the page, so the shim is bundled and runs ahead of the portal's own entry.
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace(/<head>/i, `<head>\n    <script type="module" src="${SHIM_ID}"></script>`),
    },
  }
}

export default defineConfig(env => {
  const base = typeof portalConfig === 'function' ? portalConfig(env) : portalConfig
  return mergeConfig(base, {
    root: fileURLToPath(new URL('../../apps/patient-web', import.meta.url)),
    base: './',
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [mockGatewayShim()],
    build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
  })
})
