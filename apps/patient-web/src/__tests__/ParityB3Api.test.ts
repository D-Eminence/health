import { describe, expect, it, vi } from 'vitest'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi } from '../api'
import {
  bloodGroupOf, genotypeOf, maskEmail, maskPhone, multiLine, oneLine, parseHealthProfile, parseProfileDetails,
  parseReportedHealthProfile, sentText,
} from '../profileParity'

/**
 * The patient routes of hid-1.0 parity B3 as the portal calls them (hid-system 0094 on staging-novu-ci-20261005: the
 * coverage details, the photo, the contact changes and the health information), through the registered browser client.
 */
interface Call { url: URL; method: string; headers: Headers; body: unknown }
function client(answer: (url: URL, init: RequestInit) => Response) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) as unknown : null })
    return answer(url, init ?? {})
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl, getCsrfToken: () => 'csrf-1',
    refreshSession: async () => undefined, sleep: async () => undefined,
  }), 'patient-web'))
  return { api, calls }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const problem = (status: number, code: string) => json({ status, code, detail: code }, status)
const sentAs = (calls: Call[]) => calls.map(call => [call.method, call.url.pathname, call.body])

describe('coverage details', () => {
  it('reads and saves them at /identity/me/profile-details, the save with CSRF and the version read', async () => {
    const { api, calls } = client((_url, init) => json(init.method === 'PUT'
      ? { hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: null, rowVersion: 4 }
      : { hospitalCurrentlyUsing: null, hmoName: 'Hygeia HMO', rowVersion: 3 }))
    await expect(api.profileDetails()).resolves.toEqual({ hospitalCurrentlyUsing: null, hmoName: 'Hygeia HMO', rowVersion: 3 })
    await expect(api.saveProfileDetails({ hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: null, expectedVersion: 3 }))
      .resolves.toEqual({ hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: null, rowVersion: 4 })
    expect(sentAs(calls)).toEqual([
      ['GET', '/api/v1/identity/me/profile-details', null],
      ['PUT', '/api/v1/identity/me/profile-details', { hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: null, expectedVersion: 3 }],
    ])
    expect(calls[1]?.headers.get('X-CSRF-Token')).toBe('csrf-1')
  })

  it('passes a stale version\'s 409 on, and refuses an answer it cannot save against', async () => {
    await expect(client(() => problem(409, 'VERSION_CONFLICT')).api.saveProfileDetails({ hospitalCurrentlyUsing: null, hmoName: null, expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    for (const odd of [{}, { rowVersion: -1 }, { rowVersion: '2' }, [], null]) expect(() => parseProfileDetails(odd)).toThrow()
    expect(parseProfileDetails({ hospitalCurrentlyUsing: '  ', hmoName: 7, rowVersion: 0 })).toEqual({ hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 0 })
  })
})

describe('the photo', () => {
  it('reads the bytes as a download, never as JSON, and keeps only a JPEG or PNG', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const { api, calls } = client(() => new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' } }))
    const photo = await api.photo()
    expect(photo.type).toBe('image/jpeg')
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(bytes)
    expect(calls[0]?.url.pathname).toBe('/api/v1/identity/me/photo')
    expect(calls[0]?.headers.get('Accept')).toBe('*/*')

    const html = client(() => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
    await expect(html.api.photo()).rejects.toThrow('Your photo could not be shown.')
    await expect(client(() => problem(404, 'PHOTO_NOT_FOUND')).api.photo()).rejects.toMatchObject({ status: 404 })
  })

  it('saves the JPEG it is given as base64 with PUT, and removes the photo with DELETE, each with CSRF', async () => {
    const { api, calls } = client((_url, init) => json({ hasPhoto: init.method === 'PUT' }))
    await expect(api.savePhoto('/9j/4AAQ')).resolves.toEqual({ hasPhoto: true })
    await expect(api.removePhoto()).resolves.toEqual({ hasPhoto: false })
    expect(sentAs(calls)).toEqual([
      ['PUT', '/api/v1/identity/me/photo', { mediaType: 'image/jpeg', data: '/9j/4AAQ' }],
      ['DELETE', '/api/v1/identity/me/photo', null],
    ])
    expect(calls.map(call => call.headers.get('X-CSRF-Token'))).toEqual(['csrf-1', 'csrf-1'])
  })
})

describe('contact changes', () => {
  it('starts an email change with the current password and confirms it with the code', async () => {
    const { api, calls } = client(url => json(url.pathname.endsWith('/verify') ? { email: 'new@example.com' }
      : { changeId: 'change-1', maskedContact: 'n•••@example.com', expiresInSeconds: 600, resendAfterSeconds: 60 }))
    await expect(api.startEmailChange('new@example.com', 'Secret-pass-1')).resolves.toEqual({
      changeId: 'change-1', maskedContact: 'n•••@example.com', expiresInSeconds: 600, resendAfterSeconds: 60 })
    await expect(api.verifyEmailChange('change-1', '123456')).resolves.toEqual({ email: 'new@example.com' })
    expect(sentAs(calls)).toEqual([
      ['POST', '/api/v1/identity/me/contact-changes', { channel: 'email', email: 'new@example.com', currentPassword: 'Secret-pass-1' }],
      ['POST', '/api/v1/identity/me/contact-changes/change-1/verify', { code: '123456' }],
    ])
    // A change id that would leave its segment is refused before anything is sent.
    await expect(api.verifyEmailChange('../photo', '123456')).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })

  it('changes a phone at once with the current password, which then reads as not verified', async () => {
    const { api, calls } = client(() => json({ phone: '+2348031234567', phoneVerified: false }))
    await expect(api.changePhone('+2348031234567', 'Secret-pass-1')).resolves.toEqual({ phone: '+2348031234567', phoneVerified: false })
    expect(sentAs(calls)).toEqual([['POST', '/api/v1/identity/me/contact-changes', { channel: 'phone', phone: '+2348031234567', currentPassword: 'Secret-pass-1' }]])
    // An answer without the number keeps the one sent; anything but true is not verified.
    await expect(client(() => json({})).api.changePhone('+2348031234567', 'x')).resolves.toEqual({ phone: '+2348031234567', phoneVerified: false })
  })

  it('passes Identity\'s refusals on with their codes', async () => {
    for (const [status, code] of [[403, 'PASSWORD_INCORRECT'], [409, 'CONTACT_UNAVAILABLE'], [409, 'PASSWORD_REQUIRED']] as const) {
      await expect(client(() => problem(status, code)).api.startEmailChange('new@example.com', 'x')).rejects.toMatchObject({ status, code })
    }
    await expect(client(() => problem(400, 'OTP_INVALID_OR_EXPIRED')).api.verifyEmailChange('change-1', '000000'))
      .rejects.toMatchObject({ status: 400, code: 'OTP_INVALID_OR_EXPIRED' })
    await expect(client(() => json({ maskedContact: 'x' })).api.startEmailChange('new@example.com', 'x')).rejects.toThrow()
  })
})

describe('health information', () => {
  const saved = { bloodGroup: 'O+', genotype: 'AS', allergies: 'Penicillin', currentMedications: null, chronicConditions: null,
    medicalNotes: 'Line one\nLine two', rowVersion: 2, updatedAt: '2026-10-28T09:00:00.000Z' }

  it('reads and saves it at /ehr/me/health-profile, the save with the six fields and the version read', async () => {
    const { api, calls } = client(() => json(saved))
    await expect(api.healthProfile()).resolves.toEqual(saved)
    const { rowVersion: _version, updatedAt: _at, ...fields } = saved
    await api.saveHealthProfile({ ...fields, bloodGroup: 'O+', genotype: 'AS', expectedVersion: 2 })
    expect(sentAs(calls)).toEqual([
      ['GET', '/api/v1/ehr/me/health-profile', null],
      ['PUT', '/api/v1/ehr/me/health-profile', { ...fields, expectedVersion: 2 }],
    ])
    expect(calls[1]?.headers.get('X-CSRF-Token')).toBe('csrf-1')
  })

  it('reads a value it has no choice for as not stated, and refuses an answer without a version', () => {
    expect(parseHealthProfile({ ...saved, bloodGroup: 'Unknown', genotype: 'ZZ', updatedAt: 'later' }))
      .toMatchObject({ bloodGroup: null, genotype: null, updatedAt: null })
    expect(() => parseHealthProfile({ bloodGroup: 'O+' })).toThrow()
    expect(parseHealthProfile({ rowVersion: 0 })).toEqual({ bloodGroup: null, genotype: null, allergies: null, currentMedications: null,
      chronicConditions: null, medicalNotes: null, rowVersion: 0, updatedAt: null })
  })

  it('gives a clinician nothing when the patient stated nothing', () => {
    expect(parseReportedHealthProfile({ bloodGroup: null, genotype: null, updatedAt: null })).toBeNull()
    expect(parseReportedHealthProfile('O+')).toBeNull()
    expect(parseReportedHealthProfile({ genotype: 'SS', updatedAt: '2026-10-28T09:00:00.000Z' })).toMatchObject({ genotype: 'SS', bloodGroup: null })
  })
})

describe('what is typed and shown', () => {
  it('keeps profile text free of control characters, newlines only in text areas', () => {
    expect(oneLine('Lagos\tUniversity\r\nTeaching\u0007 Hospital')).toBe('Lagos University Teaching Hospital')
    expect(multiLine('Peanuts\r\nShellfish\ttoo\u0000\u009b')).toBe('Peanuts\nShellfish too')
    expect(sentText('   ')).toBeNull()
    expect(sentText('  Hygeia  ')).toBe('Hygeia')
  })

  it('takes hid-1.0\'s free-text blood groups and genotypes as a choice only when they are one', () => {
    expect(['O+', 'o positive', 'AB -ve', 'B neg', 'A Rh+'].map(bloodGroupOf)).toEqual(['O+', 'O+', 'AB-', 'B-', 'A+'])
    expect([undefined, 'Unknown', 'O'].map(bloodGroupOf)).toEqual([null, null, null])
    expect(['as', 'A S', 'S/C', 'cc', 'AO'].map(genotypeOf)).toEqual(['AS', 'AS', 'SC', 'CC', null])
  })

  it('masks an email and a phone number, keeping a known country code', () => {
    expect(maskEmail('ada.example@example.com')).toBe('a•••@example.com')
    expect(maskEmail('not-an-email')).toBe('•••')
    expect(maskPhone('+2348031234567')).toBe('+234 •••• 4567')
    expect(maskPhone('+14155550123')).toBe('+1 •••• 0123')
    expect(maskPhone('08031234567')).toBe('•••• 4567')
    expect(maskPhone('123')).toBe('••••')
  })
})
