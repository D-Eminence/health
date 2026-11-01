import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Whether single sign-on hands off on this page, and what a sign-out made in it leaves behind (sso/singleSignOn.ts).
 * The setting comes from the configuration (VITE_HID_SSO, packages/config); the page's host from jsdom, set to the
 * Health ID site names #68's productSites.ts knows. Nothing reaches any host. The provider's address is fictional.
 */
const environment = vi.hoisted(() => ({ current: { ssoEnabled: false } as { ssoEnabled?: boolean } | null }))
vi.mock('../../env', () => ({
  getEnvironment: () => {
    if (environment.current === null) throw new Error('Invalid Health ID frontend environment configuration')
    return environment.current
  },
}))
const left = vi.hoisted(() => vi.fn())
vi.mock('../../sso/leave', () => ({ leavePage: left }))

const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
const onSite = (hostname: string) => jsdom.reconfigure({ url: `https://${hostname}/` })
const END = 'https://auth.example.test/session/end?client_id=web'

beforeEach(() => { left.mockClear(); environment.current = { ssoEnabled: false } })
afterEach(() => { jsdom.reconfigure({ url: servedFrom }); vi.resetModules() })

async function load() {
  return import('../../sso/singleSignOn')
}

describe('whether single sign-on hands off here', () => {
  it.each(['app.healthidentitydirectory.com', 'staging.healthidentitydirectory.com'])('hands off the patient portal on %s once the setting is on', async host => {
    environment.current = { ssoEnabled: true }
    onSite(host)
    const sso = await load()
    expect(sso.singleSignOnSite()?.key).toBe('web')
    expect(sso.portalHandsOff()).toBe(true)
    expect(sso.staffHandOffSite()).toBeNull()
  })

  it.each([['ehr', 'ehr.healthidentitydirectory.com'], ['lab', 'lab.healthidentitydirectory.com'], ['pharmacy', 'pharmacy.staging.healthidentitydirectory.com'],
    ['migrate', 'migrate.healthidentitydirectory.com'], ['outreach', 'outreach.staging.healthidentitydirectory.com']])(
    'hands off the provider workspace on the %s site', async (key, host) => {
      environment.current = { ssoEnabled: true }
      onSite(host)
      const sso = await load()
      expect(sso.singleSignOnSite()?.key).toBe(key)
      expect(sso.staffHandOffSite()).toMatchObject({ key, hostname: host })
      expect(sso.portalHandsOff()).toBe(false)
    })

  it.each([
    ['the setting off', { ssoEnabled: false }],
    ['the setting absent', {}],
    ['a configuration that cannot be read', null],
  ])('never hands off with %s', async (_label, current) => {
    environment.current = current
    for (const host of ['app.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com']) {
      onSite(host)
      const sso = await load()
      expect(sso.singleSignOnSite(), host).toBeNull()
      expect([sso.portalHandsOff(), sso.staffHandOffSite()], host).toEqual([false, null])
    }
  })

  it.each(['localhost', 'preview.example.test', 'admin.healthidentitydirectory.com', 'healthidentitydirectory.com', 'auth.healthidentitydirectory.com'])(
    'never hands off on %s, which is not a product site, even with the setting on', async host => {
      environment.current = { ssoEnabled: true }
      onSite(host)
      const sso = await load()
      expect(sso.singleSignOnSite()).toBeNull()
      expect([sso.portalHandsOff(), sso.staffHandOffSite()]).toEqual([false, null])
    })
})

describe('the page a staff sign-in would come back to', () => {
  const RECORD = '/provider/clinical/3f1c2b7a-9d4e-4c1b-8a2f-6e5d4c3b2a10'

  it('is a clinical record page once single sign-on hands off on the hospital EHR', async () => {
    environment.current = { ssoEnabled: true }
    onSite('ehr.healthidentitydirectory.com')
    const sso = await load()
    expect(sso.singleSignOnReturnPath(RECORD)).toBe(RECORD)
    expect(sso.singleSignOnReturnPath('/provider/requests/7a2b3c4d-5e6f-4a1b-9c8d-0e1f2a3b4c5d?status=pending'))
      .toBe('/provider/requests/7a2b3c4d-5e6f-4a1b-9c8d-0e1f2a3b4c5d?status=pending')
  })

  it.each(['/provider/patients/open', '/provider/clinical?patient=HID-ZDEMAAA2', '//evil.example', '/records'])('is none for %s', async path => {
    environment.current = { ssoEnabled: true }
    onSite('ehr.healthidentitydirectory.com')
    const sso = await load()
    expect(sso.singleSignOnReturnPath(path)).toBeNull()
  })

  it('is none on another site’s page, and always none while single sign-on is off', async () => {
    environment.current = { ssoEnabled: true }
    onSite('lab.healthidentitydirectory.com')
    expect((await load()).singleSignOnReturnPath(RECORD)).toBeNull()
    vi.resetModules()
    environment.current = { ssoEnabled: false }
    onSite('ehr.healthidentitydirectory.com')
    expect((await load()).singleSignOnReturnPath(RECORD)).toBeNull()
  })
})

describe('after a sign-out in this page', () => {
  it('leaves for the provider’s end-session address, and remembers it in this page only', async () => {
    environment.current = { ssoEnabled: true }
    onSite('app.healthidentitydirectory.com')
    const sso = await load()
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([false, false])
    sso.leaveAfterSignOut(END)
    expect(left).toHaveBeenCalledExactlyOnceWith(END)
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, true])
    vi.resetModules()
    const fresh = await load()
    expect([fresh.signedOutInThisPage(), fresh.leavingAfterSignOut()]).toEqual([false, false])
  })

  it('stays without an address, and the next sign-in from this page is asked for', async () => {
    environment.current = { ssoEnabled: true }
    onSite('ehr.healthidentitydirectory.com')
    const sso = await load()
    sso.leaveAfterSignOut(null)
    expect(left).not.toHaveBeenCalled()
    expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([true, false])
  })

  it('does nothing while single sign-on does not hand off here', async () => {
    for (const [current, host] of [[{ ssoEnabled: false }, 'app.healthidentitydirectory.com'], [{ ssoEnabled: true }, 'localhost']] as const) {
      environment.current = current
      onSite(host)
      const sso = await load()
      sso.leaveAfterSignOut(END)
      expect(left).not.toHaveBeenCalled()
      expect([sso.signedOutInThisPage(), sso.leavingAfterSignOut()]).toEqual([false, false])
      vi.resetModules()
    }
  })
})
