/**
 * Environment for the patient application.
 *
 * Vite exposes only variables matching `envPrefix` (`VITE_HID_`), so nothing
 * outside that prefix can reach the bundle even by accident. The same
 * validation the public site uses runs here, against the same rules, so the two
 * frameworks cannot drift into two notions of "configured".
 */

import { assertPublicEnvironment, resolveEnvironment, type HidEnvironment } from '@hid/config'
import { PUBLIC_ENVIRONMENT } from './publicEnvironment'

let cached: HidEnvironment | null = null

export function getEnvironment(): HidEnvironment {
  if (cached) return cached

  assertPublicEnvironment(PUBLIC_ENVIRONMENT)
  cached = resolveEnvironment(PUBLIC_ENVIRONMENT, 'VITE_HID_')
  return cached
}
