import { assertPublicEnvironment, resolveEnvironment } from '@hid/config'

const raw = {
  VITE_HID_ENVIRONMENT: import.meta.env.VITE_HID_ENVIRONMENT as string | undefined,
  VITE_HID_API_BASE_URL: import.meta.env.VITE_HID_API_BASE_URL as string | undefined,
  VITE_HID_APP_ORIGIN: import.meta.env.VITE_HID_APP_ORIGIN as string | undefined,
  VITE_HID_TURNSTILE_SITE_KEY: import.meta.env.VITE_HID_TURNSTILE_SITE_KEY as string | undefined,
}

export function environment() {
  assertPublicEnvironment(raw)
  return resolveEnvironment(raw, 'VITE_HID_')
}
