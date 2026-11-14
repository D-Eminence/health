import { assertPublicEnvironment, resolveEnvironment, type HidEnvironment } from '@hid/config'
import { PUBLIC_ENVIRONMENT } from '../publicEnvironment'

let cached: HidEnvironment | null = null

export function getEnvironment(): HidEnvironment {
  if (cached) return cached
  assertPublicEnvironment(PUBLIC_ENVIRONMENT)
  cached = resolveEnvironment(PUBLIC_ENVIRONMENT, 'VITE_HID_')
  return cached
}
