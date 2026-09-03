/**
 * Environment for the patient application.
 *
 * Vite exposes only variables matching `envPrefix` (`VITE_HID_`), so nothing
 * outside that prefix can reach the bundle even by accident. The same
 * validation the public site uses runs here, against the same rules, so the two
 * frameworks cannot drift into two notions of "configured".
 */

import { assertPublicEnvironment, resolveEnvironment, type HidEnvironment } from '@hid/config'

const RAW_ENVIRONMENT = import.meta.env as unknown as Record<string, string | undefined>

let cached: HidEnvironment | null = null

export function getEnvironment(): HidEnvironment {
  if (cached) return cached

  // Vite injects its own keys (MODE, DEV, BASE_URL...). Only the Health ID ones
  // are audited and resolved.
  const hidVariables = Object.fromEntries(
    Object.entries(RAW_ENVIRONMENT).filter(([key]) => key.startsWith('VITE_HID_')),
  )

  assertPublicEnvironment(hidVariables)
  cached = resolveEnvironment(hidVariables, 'VITE_HID_')
  return cached
}
