import { describe, expect, it } from 'vitest'
import { EnvironmentConfigError, normalizeBaseUrl, resolveEnvironment } from '../environment'

const PREFIX = 'VITE_HID_'

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    VITE_HID_ENVIRONMENT: 'staging',
    VITE_HID_API_BASE_URL: 'https://gateway.staging.example/api',
    VITE_HID_APP_ORIGIN: 'https://patient.staging.example',
    ...overrides,
  }
}

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes so paths join predictably', () => {
    expect(normalizeBaseUrl('https://gateway.example/api/')).toBe('https://gateway.example/api')
    expect(normalizeBaseUrl('https://gateway.example///')).toBe('https://gateway.example')
  })

  it('rejects values that are not usable as an API base', () => {
    expect(normalizeBaseUrl('gateway.example')).toBeNull()
    expect(normalizeBaseUrl('ftp://gateway.example')).toBeNull()
    expect(normalizeBaseUrl('https://gateway.example/api?token=abc')).toBeNull()
  })
})

describe('resolveEnvironment', () => {
  it('defaults chat off and rejects non-boolean public flags', () => {
    expect(resolveEnvironment(env(), PREFIX).patientChatEnabled).toBe(false)
    expect(resolveEnvironment(env(), PREFIX).supportChatEnabled).toBe(false)
    expect(() => resolveEnvironment(env({ VITE_HID_PATIENT_CHAT_ENABLED: 'yes' }), PREFIX)).toThrow()
    expect(() => resolveEnvironment(env({ VITE_HID_SUPPORT_CHAT_ENABLED: 'true' }), PREFIX)).toThrow()
    expect(resolveEnvironment(env({ VITE_HID_SUPPORT_CHAT_ENABLED: 'true',
      VITE_HID_SUPPORT_CONTACT: 'mailto:support@healthidentitydirectory.com' }), PREFIX).supportChatEnabled).toBe(true)
  })
  it('resolves a complete staging configuration', () => {
    const resolved = resolveEnvironment(env(), PREFIX)
    expect(resolved.name).toBe('staging')
    expect(resolved.apiBaseUrl).toBe('https://gateway.staging.example/api')
    expect(resolved.handlesRealData).toBe(true)
    expect(resolved.turnstileSiteKey).toBeNull()
  })

  it('treats local as the only tier that does not handle real data', () => {
    const resolved = resolveEnvironment(
      env({ VITE_HID_ENVIRONMENT: 'local', VITE_HID_API_BASE_URL: 'http://127.0.0.1:54321' }),
      PREFIX,
    )
    expect(resolved.handlesRealData).toBe(false)
  })

  it('fails closed when no gateway address is configured', () => {
    expect(() => resolveEnvironment(env({ VITE_HID_API_BASE_URL: undefined }), PREFIX)).toThrow(
      EnvironmentConfigError,
    )
  })

  it('refuses plaintext http outside local development', () => {
    expect(() =>
      resolveEnvironment(env({ VITE_HID_API_BASE_URL: 'http://gateway.staging.example' }), PREFIX),
    ).toThrow(/must use https/)
  })

  it('rejects an unknown environment name rather than assuming one', () => {
    expect(() => resolveEnvironment(env({ VITE_HID_ENVIRONMENT: 'prod' }), PREFIX)).toThrow(
      /must be one of/,
    )
  })

  it('reports every problem at once so a deployment is fixed in one pass', () => {
    try {
      resolveEnvironment({}, PREFIX)
      expect.unreachable('expected resolveEnvironment to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigError)
      expect((error as EnvironmentConfigError).issues).toHaveLength(3)
    }
  })

  it('returns a frozen object so configuration cannot drift at runtime', () => {
    const resolved = resolveEnvironment(env(), PREFIX)
    expect(Object.isFrozen(resolved)).toBe(true)
  })
})
