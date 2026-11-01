import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Each product page's Sign in goes to that product's own site (owner, 2026-11-01: each product its own sign-in), in
 * production and on staging; locally, the portal's own staff sign-in. Only the links change: the pages' design and words
 * stay as they are.
 */
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

async function signInWith(portal: string) {
  vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', portal.startsWith('http://localhost') ? 'local' : 'production')
  vi.stubEnv('NEXT_PUBLIC_HID_PORTAL_ORIGIN', portal)
  return (await import('@/content/site')).productSignInHref
}

describe('a product page’s Sign in', () => {
  it.each([
    ['ehr', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['laboratory', 'https://lab.healthidentitydirectory.com/provider/sign-in'],
    ['pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/sign-in'],
    ['migrate', 'https://migrate.healthidentitydirectory.com/provider/sign-in'],
    ['outreach', 'https://outreach.healthidentitydirectory.com/provider/sign-in'],
  ])('on %s opens %s in production', async (slug, href) => {
    expect((await signInWith('https://app.healthidentitydirectory.com'))(slug)).toBe(href)
  })

  it('opens the staging product site on staging', async () => {
    expect((await signInWith('https://staging.healthidentitydirectory.com'))('laboratory')).toBe('https://lab.staging.healthidentitydirectory.com/provider/sign-in')
  })

  it.each(['api', 'identity', 'toString', ''])('keeps the portal’s staff sign-in for %s, which has no product site', async slug => {
    expect((await signInWith('https://app.healthidentitydirectory.com'))(slug)).toBe('https://app.healthidentitydirectory.com/provider/sign-in')
  })

  it('keeps the portal’s staff sign-in locally', async () => {
    expect((await signInWith('http://localhost:3200'))('laboratory')).toBe('http://localhost:3200/provider/sign-in')
  })
})
