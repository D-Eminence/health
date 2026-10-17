import { afterEach, describe, expect, it, vi } from 'vitest'

/** The portal reads its public variables by name, so only these are inlined into a build. */
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('the portal public environment', () => {
  it('reads the patient chat switch, off unless it is exactly "true"', async () => {
    vi.stubEnv('VITE_HID_PATIENT_CHAT_ENABLED', 'true')
    expect((await import('../publicEnvironment')).PUBLIC_ENVIRONMENT.VITE_HID_PATIENT_CHAT_ENABLED).toBe('true')
    vi.resetModules()
    vi.stubEnv('VITE_HID_PATIENT_CHAT_ENABLED', '')
    expect((await import('../publicEnvironment')).PUBLIC_ENVIRONMENT.VITE_HID_PATIENT_CHAT_ENABLED).toBe('')
  })
  it('does not read the support chat or staff switches', async () => {
    vi.stubEnv('VITE_HID_SUPPORT_CHAT_ENABLED', 'true')
    const names = Object.keys((await import('../publicEnvironment')).PUBLIC_ENVIRONMENT)
    expect(names).not.toContain('VITE_HID_SUPPORT_CHAT_ENABLED')
    expect(names).toContain('VITE_HID_PATIENT_CHAT_ENABLED')
  })
})
