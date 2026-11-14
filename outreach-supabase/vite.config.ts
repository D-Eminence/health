/**
 * Health ID Outreach on Vercel + Supabase (temporary): the portal built as Outreach on its own, its /api/v1 calls
 * answered from Supabase in the page (shim.mjs). Build: npm run build:outreach → outreach-supabase/dist.
 * Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the public "anon" key; never the service key).
 */
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import portalConfig from '../apps/patient-web/vite.config'

const SHIM = fileURLToPath(new URL('./shim.mjs', import.meta.url))
const SHIM_ID = '/__outreach-supabase-shim.mjs'

function supabaseShim(): Plugin {
  return {
    name: 'hid-outreach-supabase',
    resolveId: id => (id === SHIM_ID ? SHIM : null),
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace(/<head>/i, `<head>\n    <script type="module" src="${SHIM_ID}"></script>`)
        .replace(/<title>[^<]*<\/title>/i, '<title>Health ID Outreach</title>'),
    },
  }
}

// The portal's public settings for this copy (values from the host's environment win). The API address is never
// reached: the shim answers every /api/v1 call.
const PUBLIC_DEFAULTS: Record<string, string> = {
  VITE_HID_ENVIRONMENT: 'local',
  VITE_HID_API_BASE_URL: 'http://localhost:3200',
  VITE_HID_APP_ORIGIN: 'http://localhost:3200',
  VITE_HID_SUPPORT_CHAT_ENABLED: 'false',
  VITE_HID_PATIENT_CHAT_ENABLED: 'false',
  VITE_HID_STAFF_PATIENT_CHAT_ENABLED: 'false',
  VITE_HID_SUPPORT_CONTACT: 'mailto:support@healthidentitydirectory.com',
}
for (const [key, value] of Object.entries(PUBLIC_DEFAULTS)) process.env[key] ??= value

export default defineConfig(env => {
  const base = typeof portalConfig === 'function' ? portalConfig(env) : portalConfig
  const merged = mergeConfig(base, {
    root: fileURLToPath(new URL('../apps/patient-web', import.meta.url)),
    base: '/',
    envDir: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [supabaseShim()],
    build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
  })
  // The Supabase values are public by design (the anon key works only through the database's row rules).
  merged.envPrefix = ['VITE_HID_', 'VITE_SUPABASE_']
  return merged
})
