import { assertPublicEnvironment, resolveEnvironment } from '@hid/config'
import { PUBLIC_ENVIRONMENT } from '../publicEnvironment'

export function environment() {
  assertPublicEnvironment(PUBLIC_ENVIRONMENT)
  return resolveEnvironment(PUBLIC_ENVIRONMENT, 'VITE_HID_')
}
