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
  // The patient's record chat screen, off unless a build sets it to exactly "true" (config/staging.json does for
  // the staging patient host). It was not read here before, so no portal build could turn it on. hid-system keeps
  // the chat itself off (ADR-068), and the screen says so when availability answers { available: false }.
  VITE_HID_PATIENT_CHAT_ENABLED: import.meta.env.VITE_HID_PATIENT_CHAT_ENABLED as string | undefined,
  VITE_HID_SUPPORT_CHAT_ENABLED: import.meta.env.VITE_HID_SUPPORT_CHAT_ENABLED as string | undefined,
  VITE_HID_SUPPORT_CONTACT: import.meta.env.VITE_HID_SUPPORT_CONTACT as string | undefined,
  // Single sign-on on auth. (contract v2), off unless a build sets it to 1 (or true): unset, the product sign-in pages are today's.
  VITE_HID_SSO: import.meta.env.VITE_HID_SSO as string | undefined,
  // Sending the card by email (step 8, hid-system 0118), off unless a build sets it to exactly "true": config/*.json set it
  // true since legal approved and the owner switched it on (4 Nov 2026).
  VITE_HID_CARD_SHARES: import.meta.env.VITE_HID_CARD_SHARES as string | undefined,
}
