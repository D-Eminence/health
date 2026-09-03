import { describe, expect, it } from 'vitest'
import { assertPublicEnvironment, findPublicEnvironmentViolations } from '../guards'

describe('findPublicEnvironmentViolations', () => {
  it('accepts a public-only configuration', () => {
    expect(
      findPublicEnvironmentViolations({
        VITE_HID_ENVIRONMENT: 'staging',
        VITE_HID_API_BASE_URL: 'https://gateway.staging.example',
        VITE_HID_TURNSTILE_SITE_KEY: '0x4AAAAAAA_public_site_key',
      }),
    ).toEqual([])
  })

  it.each([
    ['VITE_HID_API_SECRET', 'value'],
    ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'value'],
    ['VITE_AWS_REGION', 'eu-west-1'],
    ['VITE_DATABASE_URL', 'postgres://user@host/db'],
    ['VITE_CLOUDFLARE_API_TOKEN', 'value'],
  ])('flags %s by key name', (key, value) => {
    expect(findPublicEnvironmentViolations({ [key]: value })).toHaveLength(1)
  })

  it('flags credential-shaped values whatever the key is called', () => {
    const violations = findPublicEnvironmentViolations({
      VITE_HID_HARMLESS_NAME: 'AKIAIOSFODNN7EXAMPLE',
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]?.reason).toMatch(/AWS access key id/)
  })

  it('flags a JWT pasted into public configuration', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlX3ZhbHVl'
    expect(findPublicEnvironmentViolations({ VITE_HID_TOKEN_VALUE: jwt })).toHaveLength(1)
  })

  it('does not double-report a single key', () => {
    expect(findPublicEnvironmentViolations({ VITE_AWS_SECRET_ACCESS_KEY: 'x' })).toHaveLength(1)
  })

  it('assertPublicEnvironment names every offending key', () => {
    expect(() =>
      assertPublicEnvironment({ VITE_HID_API_SECRET: 'a', VITE_POSTGRES_HOST: 'b' }),
    ).toThrow(/VITE_HID_API_SECRET[\s\S]*VITE_POSTGRES_HOST/)
  })
})
