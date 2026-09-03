/**
 * Environment for the public site.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, but only when the
 * property is accessed statically — `process.env[key]` is not substituted. So
 * the variables are enumerated by hand here, which has the useful side effect
 * of making the complete public surface of this application readable in one
 * place.
 *
 * Everything below is public. Anything that must not be is not a
 * `NEXT_PUBLIC_` variable, and `assertPublicEnvironment` fails the build if one
 * slips through.
 */

import { assertPublicEnvironment, resolveEnvironment, type HidEnvironment } from '@hid/config'

const RAW_ENVIRONMENT = {
  NEXT_PUBLIC_HID_ENVIRONMENT: process.env.NEXT_PUBLIC_HID_ENVIRONMENT,
  NEXT_PUBLIC_HID_API_BASE_URL: process.env.NEXT_PUBLIC_HID_API_BASE_URL,
  NEXT_PUBLIC_HID_APP_ORIGIN: process.env.NEXT_PUBLIC_HID_APP_ORIGIN,
  NEXT_PUBLIC_HID_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_HID_TURNSTILE_SITE_KEY,
  NEXT_PUBLIC_HID_SENTRY_DSN: process.env.NEXT_PUBLIC_HID_SENTRY_DSN,
} as const

let cached: HidEnvironment | null = null

export function getEnvironment(): HidEnvironment {
  if (cached) return cached

  assertPublicEnvironment(RAW_ENVIRONMENT)
  cached = resolveEnvironment(RAW_ENVIRONMENT, 'NEXT_PUBLIC_HID_')
  return cached
}
