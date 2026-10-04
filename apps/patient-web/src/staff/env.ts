import { assertPublicEnvironment, resolveEnvironment, type HidEnvironment } from '@hid/config'

let cached: HidEnvironment | null = null

export function getEnvironment(): HidEnvironment {
  if (cached) return cached
  const variables = Object.fromEntries(
    Object.entries(import.meta.env as Record<string, string | undefined>)
      .filter(([key]) => key.startsWith('VITE_HID_')),
  )
  assertPublicEnvironment(variables)
  cached = resolveEnvironment(variables, 'VITE_HID_')
  return cached
}
