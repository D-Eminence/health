import { describe, expect, it } from 'vitest'
import {
  isPlatformAdminHostname,
  isPlatformAdminRoute,
  isStaffProductRoute,
  resolveStaffProductHostname,
  STAFF_RECOVERY_PATH,
  staffLoginAction,
  staffRecoveryHref,
  staffSignInHref,
  CLINICIAN_SIGNUP_PATH,
  CLINICIAN_STATUS_PATH,
  clinicianMainSiteHref,
  clinicianPageHref,
} from './productHostname'

describe('resolveStaffProductHostname', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', '/provider/clinical'],
    ['lab.healthidentitydirectory.com', '/provider/laboratory'],
    ['pharmacy.healthidentitydirectory.com', '/provider/pharmacy'],
    ['migrate.healthidentitydirectory.com', '/provider/ocr'],
    ['outreach.healthidentitydirectory.com', '/provider/outreach'],
  ])('maps %s to %s', (hostname, route) => {
    expect(resolveStaffProductHostname(hostname)?.route).toBe(route)
  })

  // hid-system infra/cloudflare/src/frontend-worker.mjs (DEPLOYMENT_PROFILES.staging).
  it.each([
    ['ehr.staging.healthidentitydirectory.com', '/provider/clinical'],
    ['lab.staging.healthidentitydirectory.com', '/provider/laboratory'],
    ['pharmacy.staging.healthidentitydirectory.com', '/provider/pharmacy'],
    ['migrate.staging.healthidentitydirectory.com', '/provider/ocr'],
    ['outreach.staging.healthidentitydirectory.com', '/provider/outreach'],
  ])('maps the staging host %s to %s', (hostname, route) => {
    expect(resolveStaffProductHostname(hostname)?.route).toBe(route)
  })

  it.each([
    'staging.healthidentitydirectory.com',
    'www.healthidentitydirectory.com',
    'admin.staging.healthidentitydirectory.com',
    'ocr.staging.healthidentitydirectory.com',
    'lab.staging.staging.healthidentitydirectory.com',
    'lab.preview.healthidentitydirectory.com',
    'evil-lab.staging.healthidentitydirectory.com',
    'lab.staging.healthidentitydirectory.com.evil.test',
    'constructor',
    '__proto__',
  ])('maps no other host to a workspace (%s)', hostname => {
    expect(resolveStaffProductHostname(hostname)).toBeNull()
  })

  it('normalizes hostname casing and a trailing dot', () => {
    expect(resolveStaffProductHostname('EHR.HEALTHIDENTITYDIRECTORY.COM.')).toMatchObject({
      key: 'ehr',
      route: '/provider/clinical',
    })
  })

  it('does not treat the root domain as a product hostname', () => {
    expect(resolveStaffProductHostname('healthidentitydirectory.com')).toBeNull()
  })

  it('returns null for an unknown hostname', () => {
    expect(resolveStaffProductHostname('example.com')).toBeNull()
  })
})

describe('isStaffProductRoute', () => {
  it('recognizes only the supported product routes', () => {
    expect(isStaffProductRoute('/provider/clinical')).toBe(true)
    expect(isStaffProductRoute('/provider/laboratory')).toBe(true)
    expect(isStaffProductRoute('/provider/pharmacy')).toBe(true)
    expect(isStaffProductRoute('/provider/ocr')).toBe(true)
    expect(isStaffProductRoute('/provider/outreach')).toBe(true)
    expect(isStaffProductRoute('/provider')).toBe(false)
    expect(isStaffProductRoute('/provider/patients')).toBe(false)
  })
})

describe('platform admin hostname', () => {
  it('recognizes the admin hostname', () => {
    expect(isPlatformAdminHostname('admin.healthidentitydirectory.com')).toBe(true)
    expect(isPlatformAdminHostname('ADMIN.HEALTHIDENTITYDIRECTORY.COM.')).toBe(true)
    expect(isPlatformAdminHostname('healthidentitydirectory.com')).toBe(false)
  })

  it('recognizes the staging admin hostname and no other', () => {
    expect(isPlatformAdminHostname('admin.staging.healthidentitydirectory.com')).toBe(true)
    expect(isPlatformAdminHostname('Admin.Staging.HealthIdentityDirectory.com.')).toBe(true)
    for (const hostname of ['staging.healthidentitydirectory.com', 'admin.staging.staging.healthidentitydirectory.com',
      'admin.preview.healthidentitydirectory.com', 'admin.staging.healthidentitydirectory.com.evil.test',
      'evil-admin.staging.healthidentitydirectory.com']) {
      expect(isPlatformAdminHostname(hostname), hostname).toBe(false)
    }
  })

  it('recognizes the admin routes', () => {
    expect(isPlatformAdminRoute('/admin')).toBe(true)
    expect(isPlatformAdminRoute('/admin/overview')).toBe(true)
    expect(isPlatformAdminRoute('/admin/facilities')).toBe(true)
    expect(isPlatformAdminRoute('/provider/clinical')).toBe(false)
  })
})

/** hid-system's Turnstile allowlist accepts only these actions on each staff product host. */
describe('staffLoginAction', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', 'staff-login'],
    ['lab.healthidentitydirectory.com', 'lab-login'],
    ['pharmacy.healthidentitydirectory.com', 'pharmacy-login'],
    ['migrate.healthidentitydirectory.com', 'ocr-login'],
    ['outreach.healthidentitydirectory.com', 'outreach-login'],
    ['ehr.staging.healthidentitydirectory.com', 'staff-login'],
    ['lab.staging.healthidentitydirectory.com', 'lab-login'],
    ['pharmacy.staging.healthidentitydirectory.com', 'pharmacy-login'],
    ['migrate.staging.healthidentitydirectory.com', 'ocr-login'],
    ['outreach.staging.healthidentitydirectory.com', 'outreach-login'],
    ['MIGRATE.HEALTHIDENTITYDIRECTORY.COM.', 'ocr-login'],
  ])('signs in on %s with %s', (hostname, action) => {
    expect(staffLoginAction(hostname)).toBe(action)
  })

  it.each(['www.healthidentitydirectory.com', 'staging.healthidentitydirectory.com', 'localhost',
    'migrate.example.com', 'evil-migrate.healthidentitydirectory.com', 'migrate.healthidentitydirectory.com.evil.test'])(
    'uses the general staff action on %s', hostname => {
      expect(staffLoginAction(hostname)).toBe('staff-login')
    })
})

/**
 * hid-system accepts the staff password-reset check ('staff-reset') only on the
 * main site: www in production, staging on staging (turnstile.service.ts). A
 * staff product host therefore sends staff to the main site's recovery page.
 */
describe('staffRecoveryHref', () => {
  const APP = 'https://app.healthidentitydirectory.com/provider/recover'
  const STAGING = 'https://staging.healthidentitydirectory.com/provider/recover'

  it.each([
    ['lab.healthidentitydirectory.com', APP],
    ['pharmacy.healthidentitydirectory.com', APP],
    ['migrate.healthidentitydirectory.com', APP],
    ['outreach.healthidentitydirectory.com', APP],
    ['ehr.healthidentitydirectory.com', APP],
    ['lab.staging.healthidentitydirectory.com', STAGING],
    ['pharmacy.staging.healthidentitydirectory.com', STAGING],
    ['migrate.staging.healthidentitydirectory.com', STAGING],
    ['outreach.staging.healthidentitydirectory.com', STAGING],
    ['ehr.staging.healthidentitydirectory.com', STAGING],
    ['LAB.HEALTHIDENTITYDIRECTORY.COM.', APP],
    // The admin site accepts only admin-login and admin-reset, so a staff reset is refused there too.
    ['admin.healthidentitydirectory.com', APP],
    ['admin.staging.healthidentitydirectory.com', STAGING],
  ])('sends staff on %s to the main site recovery page', (hostname, href) => {
    expect(staffRecoveryHref(hostname)).toBe(href)
  })

  it.each([
    'www.healthidentitydirectory.com',
    'staging.healthidentitydirectory.com',
    'localhost',
    '127.0.0.1',
  ])('keeps recovery on %s, the main site or a local build', hostname => {
    expect(staffRecoveryHref(hostname)).toBe(STAFF_RECOVERY_PATH)
  })

  it.each([
    'lab.healthidentitydirectory.com.evil.example',
    'evil-lab.healthidentitydirectory.com',
    'lab.evil.healthidentitydirectory.com',
    'lab.healthidentitydirectory.co',
    'lab.staging.staging.healthidentitydirectory.com',
    'https://lab.healthidentitydirectory.com',
    'lab.healthidentitydirectory.com/provider/recover?next=https://evil.example',
    '',
  ])('never builds an address from an unrecognised host (%s)', hostname => {
    // Only three fixed destinations exist; nothing in the hostname is copied into the link.
    expect(staffRecoveryHref(hostname)).toBe(STAFF_RECOVERY_PATH)
  })
})

/**
 * Clinician self sign-up (hid-system ADR-066) is checked by Turnstile actions
 * hid-system accepts only on the main site, as the staff password reset is.
 */
describe('clinicianMainSiteHref', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com'],
    ['lab.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com'],
    ['admin.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com'],
    ['pharmacy.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com'],
    ['admin.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com'],
  ])('sends %s to the main site', (hostname, origin) => {
    expect(clinicianMainSiteHref(hostname, CLINICIAN_SIGNUP_PATH)).toBe(`${origin}/provider/join`)
    expect(clinicianMainSiteHref(hostname, CLINICIAN_STATUS_PATH)).toBe(`${origin}/provider/join/status`)
    expect(clinicianPageHref(hostname, CLINICIAN_SIGNUP_PATH)).toBe(`${origin}/provider/join`)
  })

  it.each(['www.healthidentitydirectory.com', 'staging.healthidentitydirectory.com', 'localhost',
    'lab.healthidentitydirectory.com.evil.example', 'evil-lab.healthidentitydirectory.com'])('keeps the page on %s', hostname => {
    expect(clinicianMainSiteHref(hostname, CLINICIAN_SIGNUP_PATH)).toBeNull()
    expect(clinicianPageHref(hostname, CLINICIAN_STATUS_PATH)).toBe('/provider/join/status')
  })
})

describe('staffSignInHref', () => {
  it.each(['app.healthidentitydirectory.com', 'APP.HEALTHIDENTITYDIRECTORY.COM.'])(
    'sends staff on the production portal %s to the EHR site', hostname => {
      expect(staffSignInHref(hostname)).toBe('https://ehr.healthidentitydirectory.com/provider/sign-in')
    })

  it.each(['staging.healthidentitydirectory.com', 'ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com',
    'www.healthidentitydirectory.com', 'app.healthidentitydirectory.com.evil.example', 'localhost'])(
    'keeps staff sign-in on %s itself', hostname => {
      expect(staffSignInHref(hostname)).toBeNull()
    })
})
