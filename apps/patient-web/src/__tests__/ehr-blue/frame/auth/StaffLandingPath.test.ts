import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StaffSession } from '../../../../staff/api'
import { getStaffLandingPath } from '../../../../ehr-blue/frame/auth/signInParts'
import { PROVIDER_NAVIGATION, staffLandingPath } from '../../../../staff/navigation'

/**
 * Where the blue sign-in lands on each product's own site. Health ID Migrate's Scan paper records opens to everyone who
 * follows readings, the front desk's own included (ocr.job.read-own since hid-system 0136), so the front desk signs in
 * to it as before, not to Home (owner, 24 November 2026: "Migrate works as before"). Classic's own sidebar rule is not
 * changed. Every account and facility here is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
afterEach(() => { jsdom.reconfigure({ url: servedFrom }) })

function sessionWith(permissions: readonly string[], roles: readonly string[]): StaffSession {
  const here = { id: 'f0000000-0000-4000-8000-000000000001', membershipId: 'member-1', organizationId: 'org-1',
    name: 'Fictional Records Office', roles: [...roles], permissions: [...permissions], isPrimary: true }
  return { actor: { id: 'staff-1', email: 'front.desk@example.test', displayName: 'Fictional Front Desk', roles: [], permissions: [],
    facilities: [here], facility: here }, expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

const RECEPTIONIST = ['ocr.job.read-own', 'ocr.job.write', 'ocr.job.start', 'ehr.document.read-own', 'ehr.document.write']
const NURSE = ['ocr.job.read', 'ocr.job.write', 'ocr.job.start', 'ehr.document.read', 'ehr.document.write']

describe('getStaffLandingPath on migrate.', () => {
  it.each([
    ['the front desk (its own readings)', '/provider/ocr', RECEPTIONIST, ['receptionist']],
    ['a nurse (every reading)', '/provider/ocr', NURSE, ['nurse']],
    ['a role that follows no readings', '/provider', ['audit.read'], ['org_admin']],
  ])('lands %s on %s', (_who, landing, permissions, roles) => {
    jsdom.reconfigure({ url: 'https://migrate.healthidentitydirectory.com/provider/sign-in' })
    expect(getStaffLandingPath('', sessionWith(permissions, roles))).toBe(landing)
  })

  it('keeps an explicit return address', () => {
    jsdom.reconfigure({ url: 'https://migrate.healthidentitydirectory.com/provider/sign-in' })
    expect(getStaffLandingPath(`?returnTo=${encodeURIComponent('/provider/audit')}`, sessionWith(RECEPTIONIST, ['receptionist']))).toBe('/provider/audit')
  })
})

describe('the other sites are unchanged', () => {
  it('lands a nurse without the clinical record on the EHR site on Home, as before', () => {
    jsdom.reconfigure({ url: 'https://ehr.healthidentitydirectory.com/provider/sign-in' })
    expect(getStaffLandingPath('', sessionWith(NURSE, ['nurse']))).toBe('/provider')
  })

  it('keeps classic\'s own rule: its sidebar lists Document OCR under ocr.job.read alone', () => {
    expect(PROVIDER_NAVIGATION.find(item => item.to === '/provider/ocr')?.permission).toBe('ocr.job.read')
    expect(staffLandingPath('/provider/ocr', sessionWith(RECEPTIONIST, ['receptionist']))).toBe('/provider')
  })
})
