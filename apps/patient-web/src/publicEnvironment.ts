/**
 * The portal's public configuration, shared by its patient, staff and admin
 * areas. Each variable is read by name, so Vite inlines only these. Reading the
 * env object whole would inline every VITE_HID_ variable set at build time.
 */
export const PUBLIC_ENVIRONMENT = {
  VITE_HID_ENVIRONMENT: import.meta.env.VITE_HID_ENVIRONMENT as string | undefined,
  VITE_HID_API_BASE_URL: import.meta.env.VITE_HID_API_BASE_URL as string | undefined,
  VITE_HID_APP_ORIGIN: import.meta.env.VITE_HID_APP_ORIGIN as string | undefined,
  VITE_HID_TURNSTILE_SITE_KEY: import.meta.env.VITE_HID_TURNSTILE_SITE_KEY as string | undefined,
  VITE_HID_SENTRY_DSN: import.meta.env.VITE_HID_SENTRY_DSN as string | undefined,
}
