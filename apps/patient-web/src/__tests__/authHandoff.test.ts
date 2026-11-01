import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterCentralSignInHref, authDeploymentOf, authorizationRequest, centralSignInEnabled, safeReturnPath, signInStartHref } from '../authHandoff'

/**
 * One sign-in for every staff site (authHandoff.ts, a draft): OpenID Connect, each product its own client behind its own
 * server. The page only ever names a page of its own site to come back to, and on the auth. site an opaque request id:
 * these tests write both as an attacker would. Nothing is requested from any Health ID host.
 */
afterEach(() => { vi.unstubAllEnvs() })

const AUTH = 'auth.healthidentitydirectory.com'
const AUTH_STAGING = 'auth.staging.healthidentitydirectory.com'
const LAB = 'lab.healthidentitydirectory.com'
const REQUEST = 'Zq3x9K0bW2mN7pR4tV6yA8cE1gH5jL'
const returnTo = (href: string) => new URLSearchParams(href.split('?')[1]).get('return_to')

describe('the switch', () => {
  it('is off unless the build turns it on', () => {
    expect(centralSignInEnabled()).toBe(false)
    vi.stubEnv('VITE_HID_CENTRAL_SIGN_IN', 'true')
    expect(centralSignInEnabled()).toBe(true)
    vi.stubEnv('VITE_HID_CENTRAL_SIGN_IN', 'yes')
    expect(centralSignInEnabled()).toBe(false)
  })
})

describe('a staff site’s way to sign-in', () => {
  it.each([
    [LAB, '/provider/laboratory', '/provider/laboratory'],
    [LAB, '/provider/audit', '/provider/audit'],
    ['ehr.healthidentitydirectory.com', '/provider/patients', '/provider/patients'],
    ['pharmacy.staging.healthidentitydirectory.com', '/provider/pharmacy/', '/provider/pharmacy'],
    // Written as a browser may give it: capitals and the root's dot.
    ['LAB.healthidentitydirectory.com.', '/provider/laboratory', '/provider/laboratory'],
  ])('on %s at %s starts at its own server, back to %s', (host, path, page) => {
    const href = signInStartHref(path, host)!
    // Its own origin: no host in it at all.
    expect(href.startsWith('/api/v1/auth/oidc/start?')).toBe(true)
    expect(returnTo(href)).toBe(page)
  })

  it.each([
    // A record below a page, a page outside the exact return list, another site's page: the site's own page, as today.
    ['/provider/laboratory/5a020001', '/provider/laboratory'],
    ['/provider/whats-left', '/provider/laboratory'],
    ['/provider/patients', '/provider/laboratory'],
    ['/', '/provider/laboratory'],
  ])('keeps nothing of %s but a page lab. may return to', (path, page) => {
    expect(returnTo(signInStartHref(path, LAB)!)).toBe(page)
  })

  it.each(['app.healthidentitydirectory.com', 'staging.healthidentitydirectory.com', 'admin.healthidentitydirectory.com',
    AUTH, 'localhost', 'health-id-preview.pages.dev', 'lab.healthidentitydirectory.com.example'])(
    'is not taken on %s, which keeps its own sign-in', host => {
      expect(signInStartHref('/provider/laboratory', host)).toBeNull()
    })
})

describe('the page to come back to', () => {
  it.each([
    ['another host, by scheme', 'https://example.com/provider/laboratory'],
    ['another host, scheme-relative', '//example.com/provider/laboratory'],
    ['another host, by backslash', '/\\example.com/provider/laboratory'],
    ['a script', 'javascript:alert(document.domain)'],
    ['no leading slash', 'provider/laboratory'],
    ['a query', '/provider/laboratory?item=5a020001'],
    ['a fragment', '/provider/laboratory#item'],
    ['an escape', '/provider/%6caboratory'],
    ['an encoded line break', '/provider/laboratory%0d%0aSet-Cookie:%20x=1'],
    ['a line break', '/provider/laboratory\r\nSet-Cookie: x=1'],
    ['a space', ' /provider/laboratory'],
    ['a way up', '/provider/audit/../laboratory'],
    ['a record below a page', '/provider/laboratory/5a020001'],
    ['a page lab. does not serve', '/provider/patients'],
    ['a page outside the return list', '/provider/whats-left'],
    ['nothing', ''],
  ])('is refused when it is %s', (_, value) => {
    expect(safeReturnPath(value, LAB)).toBeNull()
  })

  it('is refused on a host that is not a staff site', () => {
    expect(safeReturnPath('/provider/laboratory', 'app.healthidentitydirectory.com')).toBeNull()
    expect(safeReturnPath('/provider/laboratory', AUTH)).toBeNull()
  })

  it('is a page as the return list writes it', () => {
    expect(safeReturnPath('/Provider/Laboratory/', LAB)).toBe('/provider/laboratory')
  })
})

describe('the auth. site', () => {
  it('knows its hosts, as a browser may write them', () => {
    expect(authDeploymentOf('Auth.HealthIdentityDirectory.com.')).toBe('production')
    expect(authDeploymentOf(AUTH_STAGING)).toBe('staging')
    expect(authDeploymentOf('auth.healthidentitydirectory.com.example')).toBeNull()
    expect(authDeploymentOf(LAB)).toBeNull()
  })

  it('continues the authorization request it signed in for, on its own server', () => {
    expect(afterCentralSignInHref(`?request=${REQUEST}`, AUTH)).toBe(`/api/v1/auth/oidc/authorize/continue?request=${REQUEST}`)
  })

  it.each([
    ['no request', ''],
    ['an address', `?request=${encodeURIComponent('https://example.com/callback')}`],
    ['a short id', '?request=abc123'],
    ['other characters', `?request=${REQUEST}%3Cscript%3E`],
    ['two requests', `?request=${REQUEST}&request=${REQUEST}x`],
    ['an address beside it', `?request=${REQUEST}&redirect_uri=${encodeURIComponent('https://example.com/')}`],
  ])('with %s, goes to the Hospital EHR or the request alone', (_, search) => {
    const next = afterCentralSignInHref(search, AUTH)
    const request = authorizationRequest(search)
    expect(next).toBe(request ? `/api/v1/auth/oidc/authorize/continue?request=${request}` : 'https://ehr.healthidentitydirectory.com/provider')
    // Never anywhere a query names.
    expect(next).not.toContain('example.com')
  })

  it('goes to its own deployment’s Hospital EHR when opened directly', () => {
    expect(afterCentralSignInHref('', AUTH_STAGING)).toBe('https://ehr.staging.healthidentitydirectory.com/provider')
    expect(afterCentralSignInHref('', LAB)).toBeNull()
  })
})
