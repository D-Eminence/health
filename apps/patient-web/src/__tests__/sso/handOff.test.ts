import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  endSessionHref, hasSafeReturnShape, isSafeReturnPath, PORTAL_RETURN_PATHS, RETURN_PATH_MAX_LENGTH, ssoStartHref,
} from '../../sso/handOff'
import { STAFF_RETURN_PATHS } from '../../staff/session'

/**
 * Single sign-on's hand-off rules (sso/handOff.ts, contract v2). The product hosts are the Health ID sites #68's
 * productSites.ts knows by name; nothing here reaches them, or any host: these are pure functions of a string. Record
 * ids are fictional, and the provider's address is under example.test.
 */
const chat = vi.hoisted(() => ({ enabled: false }))
vi.mock('../../chatFeatures', () => ({ patientChatEnabled: () => chat.enabled }))
afterEach(() => { chat.enabled = false; vi.unstubAllEnvs() })

const APP = 'app.healthidentitydirectory.com'
const APP_STAGING = 'staging.healthidentitydirectory.com'
const EHR = 'ehr.healthidentitydirectory.com'
const EHR_STAGING = 'ehr.staging.healthidentitydirectory.com'
const LAB = 'lab.healthidentitydirectory.com'
const ENCOUNTER = '3f1c2b7a-9d4e-4c1b-8a2f-6e5d4c3b2a10'
const REQUEST = '7a2b3c4d-5e6f-4a1b-9c8d-0e1f2a3b4c5d'

describe('the shared shape of a return path', () => {
  it.each(['/', '/provider', '/provider/clinical', `/provider/requests/${REQUEST}?status=pending`, '/records', '/access/share',
    '/provider/staff/join', `/${'a'.repeat(RETURN_PATH_MAX_LENGTH - 1)}`])('takes %s', path => {
    expect(hasSafeReturnShape(path)).toBe(true)
  })

  it.each([undefined, null, 42, ['/provider'], { path: '/provider' }])('refuses %j, which is not a path', value => {
    expect(hasSafeReturnShape(value)).toBe(false)
  })

  it('refuses an empty path, and one over 512 characters', () => {
    expect(hasSafeReturnShape('')).toBe(false)
    expect(hasSafeReturnShape(`/${'a'.repeat(RETURN_PATH_MAX_LENGTH)}`)).toBe(false)
  })

  it.each(['provider', 'javascript:alert(1)', 'https:evil.example', 'data:text/html,hello', '?returnTo=/provider', 'mailto:a@example.test'])(
    'refuses %s: a page path begins with exactly one /, so no scheme and nothing relative', path => {
      expect(hasSafeReturnShape(path)).toBe(false)
    })

  it.each(['//evil.example', '//evil.example/provider', '/provider//clinical', '/records?next=//evil.example'])(
    'refuses %s: no // anywhere, so no other host and no empty segment', path => {
      expect(hasSafeReturnShape(path)).toBe(false)
    })

  it.each(['/\\evil.example', '/provider\\clinical', '/provider\\..\\admin'])('refuses %s: no backslash, which browsers read as /', path => {
    expect(hasSafeReturnShape(path)).toBe(false)
  })

  it.each(['/provider\n', '/provider\r/x', '/pro\tvider', '/provider\u0000', '/provider\u001f', '/provider\u007f', '/provider\u0085', '/provider\u009f'])(
    'refuses %j: no control character', path => {
      expect(hasSafeReturnShape(path)).toBe(false)
    })

  it.each(['/provider%2fclinical', '/provider%2Fclinical', '/%5cevil.example', '/provider%5Cadmin', '/provider/%2e%2e/admin',
    '/provider/%2E%2E/admin', '/provider%2eclinical'])('refuses %s: no encoded /, \\ or .', path => {
    expect(hasSafeReturnShape(path)).toBe(false)
  })

  it.each(['/provider#x', '/records#', '/provider/clinical#/admin'])('refuses %s: no fragment', path => {
    expect(hasSafeReturnShape(path)).toBe(false)
  })

  it.each(['/provider/../admin', '/provider/./clinical', '/..', '/.', '/provider/clinical/..', '/provider/..?status=pending'])(
    'refuses %s: no dot segment', path => {
      expect(hasSafeReturnShape(path)).toBe(false)
    })
})

describe('a return path on a staff site', () => {
  it.each([EHR, EHR_STAGING])('takes every provider workspace page of staff/session.ts on %s, the hospital EHR', host => {
    for (const path of STAFF_RETURN_PATHS) expect(isSafeReturnPath(path, host), path).toBe(true)
  })

  it.each([
    `/provider/clinical/${ENCOUNTER}`,
    `/provider/clinical/${ENCOUNTER}/orders/laboratory/${REQUEST}`,
    `/provider/triage/${ENCOUNTER}~${REQUEST}`,
    `/provider/requests/${REQUEST}`,
    `/provider/requests/${REQUEST}?status=approved`,
    '/provider/appointments',
  ])('takes the clinical page %s on the hospital EHR (ehr-blue/clinical/returnPaths.ts)', path => {
    expect(isSafeReturnPath(path, EHR)).toBe(true)
  })

  it.each([
    '/', '/records', '/sign-in', '/provider/sign-in', '/provider/sign-in?returnTo=%2Fprovider', '/provider/patients/open',
    '/provider/clinical?patient=HID-ZDEMAAA2', '/provider/patients?q=HID-ZDEMAAA2', `/provider/requests/${REQUEST}?status=other`,
    '/provider/emergency/summary', '/provider/Patients', '/provider/patients/', '/admin/overview', '/api/v1/auth/session',
  ])('refuses %s on the hospital EHR: not one of its pages a sign-in may return to', path => {
    expect(isSafeReturnPath(path, EHR)).toBe(false)
  })

  it('takes the Laboratory’s own pages and the pages every staff site serves', () => {
    for (const path of ['/provider/laboratory', '/provider', '/provider/audit']) expect(isSafeReturnPath(path, LAB), path).toBe(true)
  })

  it.each(['/provider/patients', '/provider/requests', '/provider/clinical', `/provider/clinical/${ENCOUNTER}`, '/provider/pharmacy', '/provider/ocr'])(
    'refuses %s on the Laboratory: another site serves it (#68 siteServing), so it never comes back here', path => {
      expect(isSafeReturnPath(path, LAB)).toBe(false)
    })
})

describe('a return path on app.', () => {
  it.each([APP, APP_STAGING])('takes every page of the patient portal on %s', host => {
    for (const path of PORTAL_RETURN_PATHS) expect(isSafeReturnPath(path, host), path).toBe(true)
  })

  it.each(['/provider', '/provider/patients', `/provider/clinical/${ENCOUNTER}`, '/records?view=all', '/records/', '/Records', '/settings',
    '/sign-in', '/enroll', '/recover', '/card/fictional-token', '/verify', '/provider/recover'])(
    'refuses %s: not a portal page a sign-in may return to', path => {
      expect(isSafeReturnPath(path, APP)).toBe(false)
    })

  it('takes the record chat only where it is served', () => {
    expect(isSafeReturnPath('/chat', APP)).toBe(false)
    chat.enabled = true
    expect(isSafeReturnPath('/chat', APP)).toBe(true)
  })
})

describe('a return path on any other host', () => {
  it.each(['localhost', '127.0.0.1', 'preview.example.test', 'admin.healthidentitydirectory.com', 'healthidentitydirectory.com',
    'auth.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com.evil.example'])('refuses every page on %s, which never hands off', host => {
    for (const path of ['/', '/provider', '/provider/clinical', '/records']) expect(isSafeReturnPath(path, host), path).toBe(false)
  })
})

describe('the start address', () => {
  it('is this host’s own start route, with the page to come back to encoded', () => {
    expect(ssoStartHref('/provider/clinical')).toBe('/api/v1/auth/sso/start?return_to=%2Fprovider%2Fclinical')
    expect(ssoStartHref(`/provider/requests/${REQUEST}?status=pending`))
      .toBe(`/api/v1/auth/sso/start?return_to=%2Fprovider%2Frequests%2F${REQUEST}%3Fstatus%3Dpending`)
    const href = ssoStartHref('/records')
    expect(new URL(href, 'https://product.example.test').origin).toBe('https://product.example.test')
  })

  it('asks for a quiet check or a new sign-in only when told, and nothing else', () => {
    expect(ssoStartHref('/', { prompt: 'none' })).toBe('/api/v1/auth/sso/start?return_to=%2F&prompt=none')
    expect(ssoStartHref('/', { prompt: 'login' })).toBe('/api/v1/auth/sso/start?return_to=%2F&prompt=login')
    expect(ssoStartHref('/', {})).toBe('/api/v1/auth/sso/start?return_to=%2F')
    expect(ssoStartHref('/', { prompt: 'consent' as 'none' })).toBe('/api/v1/auth/sso/start?return_to=%2F')
  })

  it('never lets a path add a parameter of its own', () => {
    const href = ssoStartHref('/records?x=1&prompt=none&return_to=/provider')
    const query = new URL(href, 'https://product.example.test').searchParams
    expect([...query.keys()]).toEqual(['return_to'])
    expect(query.get('return_to')).toBe('/records?x=1&prompt=none&return_to=/provider')
  })

  it.each(['//evil.example', 'https://evil.example/provider', 'javascript:alert(1)', '/provider/../admin', '/provider#x', '/\\evil.example', ''])(
    'asks for / in place of %j, never a repaired path', path => {
      expect(ssoStartHref(path)).toBe('/api/v1/auth/sso/start?return_to=%2F')
    })
})

describe('the end-session address in the sign-out answer', () => {
  const END = 'https://auth.example.test/session/end?client_id=web&post_logout_redirect_uri=https%3A%2F%2Fproduct.example.test%2F'

  it('is the provider’s https address', () => {
    expect(endSessionHref({ endSessionUrl: END })).toBe(END)
  })

  it.each([
    ['no answer', undefined], ['null', null], ['a bare string', END], ['an answer without it', {}], ['a number', { endSessionUrl: 42 }],
    ['not an address', { endSessionUrl: 'not an address' }], ['a relative address', { endSessionUrl: '/session/end' }],
  ])('is none for %s', (_label, answer) => {
    expect(endSessionHref(answer)).toBeNull()
  })

  it('is none for a value that only turns into an address', () => {
    expect(endSessionHref({ endSessionUrl: { toString: () => END } })).toBeNull()
  })

  it.each(['http://auth.example.test/session/end', 'javascript:alert(1)', 'data:text/html,hello', 'ftp://auth.example.test/end'])(
    'is none for %s: https only', value => {
      expect(endSessionHref({ endSessionUrl: value })).toBeNull()
    })

  it.each(['https://someone@auth.example.test/session/end', 'https://:secret@auth.example.test/session/end'])(
    'is none for %s: no credentials in the address', value => {
      expect(endSessionHref({ endSessionUrl: value })).toBeNull()
    })

  it('is none with a fragment', () => {
    expect(endSessionHref({ endSessionUrl: `${END}#state` })).toBeNull()
  })
})
