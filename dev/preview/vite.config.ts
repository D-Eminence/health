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

// PREVIEW_SINGLE=1 inlines every script, style and font into one index.html, so a
// hosted preview updates with a single file (the live redesign preview does this).
const single = process.env.PREVIEW_SINGLE === '1'

export default defineConfig(async env => {
  const base = typeof portalConfig === 'function' ? portalConfig(env) : portalConfig
  const merged = mergeConfig(base, {
    root: fileURLToPath(new URL('../../apps/patient-web', import.meta.url)),
    base: './',
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [mockGatewayShim()],
    build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
  })
  if (!single) return merged
  const { viteSingleFile } = await import('vite-plugin-singlefile')
  // One file means one chunk: the portal's vendor split has to go.
  const output = merged.build?.rollupOptions?.output
  if (output && !Array.isArray(output)) delete output.manualChunks
  merged.plugins = [...(merged.plugins ?? []), viteSingleFile({ removeViteModuleLoader: true })]
  merged.build = { ...merged.build, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 100_000 }
  return merged
})
