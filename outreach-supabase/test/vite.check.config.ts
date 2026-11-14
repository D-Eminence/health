/** The local check: the Outreach build with Supabase swapped for an in-memory stand-in (fake-supabase.mjs). */
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import outreachConfig from '../vite.config'

export default defineConfig(async env => {
  const base = typeof outreachConfig === 'function' ? await outreachConfig(env) : outreachConfig
  return mergeConfig(base, {
    resolve: { alias: { '@supabase/supabase-js': fileURLToPath(new URL('./fake-supabase.mjs', import.meta.url)) } },
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://fake.supabase.test"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"fake"' },
    build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)) },
  })
})
