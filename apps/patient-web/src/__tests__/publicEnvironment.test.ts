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
  it('reads the approved support configuration by name without unrelated or staff variables', async () => {
    vi.stubEnv('VITE_HID_SUPPORT_CHAT_ENABLED', 'true')
    vi.stubEnv('VITE_HID_SUPPORT_CONTACT', 'mailto:support@healthidentitydirectory.com')
    vi.stubEnv('VITE_HID_UNRELATED_VALUE', 'unrelated')
    const environment = (await import('../publicEnvironment')).PUBLIC_ENVIRONMENT
    const names = Object.keys(environment)
    expect(environment.VITE_HID_SUPPORT_CHAT_ENABLED).toBe('true')
    expect(environment.VITE_HID_SUPPORT_CONTACT).toBe('mailto:support@healthidentitydirectory.com')
    expect(names).toContain('VITE_HID_PATIENT_CHAT_ENABLED')
    expect(names).not.toContain('VITE_HID_UNRELATED_VALUE')
    expect(names).not.toContain('VITE_HID_STAFF_PATIENT_CHAT_ENABLED')
  })
})
