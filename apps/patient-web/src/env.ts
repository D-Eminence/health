/**
 * Environment for the patient application.
 *
 * Vite exposes only variables matching `envPrefix` (`VITE_HID_`), so nothing
 * outside that prefix can reach the bundle even by accident. The same
 * validation the public site uses runs here, against the same rules, so the two
 * frameworks cannot drift into two notions of "configured".
 */

import { assertPublicEnvironment, resolveEnvironment, type HidEnvironment } from '@hid/config'

// Each variable is read by name, so Vite inlines only these. Reading the env
// object whole would inline every VITE_HID_ variable set at build time.
const RAW_ENVIRONMENT = {
  VITE_HID_ENVIRONMENT: import.meta.env.VITE_HID_ENVIRONMENT as string | undefined,
  VITE_HID_API_BASE_URL: import.meta.env.VITE_HID_API_BASE_URL as string | undefined,
  VITE_HID_APP_ORIGIN: import.meta.env.VITE_HID_APP_ORIGIN as string | undefined,
  VITE_HID_TURNSTILE_SITE_KEY: import.meta.env.VITE_HID_TURNSTILE_SITE_KEY as string | undefined,
  VITE_HID_SENTRY_DSN: import.meta.env.VITE_HID_SENTRY_DSN as string | undefined,
}

let cached: HidEnvironment | null = null

export function getEnvironment(): HidEnvironment {
  if (cached) return cached

  assertPublicEnvironment(RAW_ENVIRONMENT)
  cached = resolveEnvironment(RAW_ENVIRONMENT, 'VITE_HID_')
  return cached
}
