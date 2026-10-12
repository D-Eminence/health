import { describe, expect, it } from 'vitest'
import {
  isPlatformAdminHostname,
  isPlatformAdminRoute,
  isStaffProductRoute,
  resolveStaffProductHostname,
  STAFF_RECOVERY_PATH,
  staffLoginAction,
  staffRecoveryHref,
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
  const WWW = 'https://www.healthidentitydirectory.com/provider/recover'
  const STAGING = 'https://staging.healthidentitydirectory.com/provider/recover'

  it.each([
    ['lab.healthidentitydirectory.com', WWW],
    ['pharmacy.healthidentitydirectory.com', WWW],
    ['migrate.healthidentitydirectory.com', WWW],
    ['outreach.healthidentitydirectory.com', WWW],
    ['ehr.healthidentitydirectory.com', WWW],
    ['lab.staging.healthidentitydirectory.com', STAGING],
    ['pharmacy.staging.healthidentitydirectory.com', STAGING],
    ['migrate.staging.healthidentitydirectory.com', STAGING],
    ['outreach.staging.healthidentitydirectory.com', STAGING],
    ['ehr.staging.healthidentitydirectory.com', STAGING],
    ['LAB.HEALTHIDENTITYDIRECTORY.COM.', WWW],
    // The admin site accepts only admin-login and admin-reset, so a staff reset is refused there too.
    ['admin.healthidentitydirectory.com', WWW],
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
