import { assertPublicEnvironment, resolveEnvironment, type HidEnvironment } from '@hid/config'

// Read by name, so Vite inlines only these (see ../env.ts).
const variables = {
  VITE_HID_ENVIRONMENT: import.meta.env.VITE_HID_ENVIRONMENT as string | undefined,
  VITE_HID_API_BASE_URL: import.meta.env.VITE_HID_API_BASE_URL as string | undefined,
  VITE_HID_APP_ORIGIN: import.meta.env.VITE_HID_APP_ORIGIN as string | undefined,
  VITE_HID_TURNSTILE_SITE_KEY: import.meta.env.VITE_HID_TURNSTILE_SITE_KEY as string | undefined,
  VITE_HID_SENTRY_DSN: import.meta.env.VITE_HID_SENTRY_DSN as string | undefined,
}

let cached: HidEnvironment | null = null

export function getEnvironment(): HidEnvironment {
  if (cached) return cached
  assertPublicEnvironment(variables)
  cached = resolveEnvironment(variables, 'VITE_HID_')
  return cached
}
