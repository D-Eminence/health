import { describe, expect, it } from 'vitest'
import {
  isPlatformAdminHostname,
  isPlatformAdminRoute,
  isStaffProductRoute,
  resolveStaffProductHostname,
  resolveStaffLoginAction,
  resolveStaffRecoveryUrl,
  resolveRecoverySignInUrl,
} from './productHostname'

describe('resolveStaffProductHostname', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', '/provider/clinical'],
    ['lab.healthidentitydirectory.com', '/provider/laboratory'],
    ['pharmacy.healthidentitydirectory.com', '/provider/pharmacy'],
    ['migrate.healthidentitydirectory.com', '/provider/ocr'],
    ['outreach.healthidentitydirectory.com', '/provider/outreach'],
    ['ehr.staging.healthidentitydirectory.com', '/provider/clinical'],
    ['lab.staging.healthidentitydirectory.com', '/provider/laboratory'],
    ['pharmacy.staging.healthidentitydirectory.com', '/provider/pharmacy'],
    ['migrate.staging.healthidentitydirectory.com', '/provider/ocr'],
    ['outreach.staging.healthidentitydirectory.com', '/provider/outreach'],
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
    expect(isPlatformAdminHostname('admin.staging.healthidentitydirectory.com')).toBe(true)
    expect(isPlatformAdminHostname('healthidentitydirectory.com')).toBe(false)
  })

  it('recognizes the admin routes', () => {
    expect(isPlatformAdminRoute('/admin')).toBe(true)
    expect(isPlatformAdminRoute('/admin/overview')).toBe(true)
    expect(isPlatformAdminRoute('/admin/facilities')).toBe(true)
    expect(isPlatformAdminRoute('/provider/clinical')).toBe(false)
  })
})

describe('staging provider authentication context', () => {
  it.each([
    ['ehr', 'ehr-login'], ['lab', 'lab-login'], ['pharmacy', 'pharmacy-login'],
    ['migrate', 'ocr-login'], ['outreach', 'outreach-login'],
  ])('selects the backend action for %s', (product, action) => {
    expect(resolveStaffLoginAction(`${product}.staging.healthidentitydirectory.com`)).toBe(action)
  })

  it('uses staff-login on the canonical portal', () => {
    expect(resolveStaffLoginAction('staging.healthidentitydirectory.com')).toBe('staff-login')
  })

  it('keeps product recovery on the permitted root and returns to that product', () => {
    expect(resolveStaffRecoveryUrl('lab.staging.healthidentitydirectory.com')).toBe(
      'https://staging.healthidentitydirectory.com/provider/recover?returnTo=lab')
    expect(resolveRecoverySignInUrl('staging.healthidentitydirectory.com', '?returnTo=lab')).toBe(
      'https://lab.staging.healthidentitydirectory.com/provider/sign-in')
    expect(resolveStaffRecoveryUrl('lab.healthidentitydirectory.com')).toBe(
      'https://www.healthidentitydirectory.com/provider/recover?returnTo=lab')
  })

  it('rejects unknown recovery return destinations and deceptive hosts', () => {
    expect(resolveRecoverySignInUrl('staging.healthidentitydirectory.com', '?returnTo=https://evil.example')).toBe('/provider/sign-in')
    expect(resolveRecoverySignInUrl('evil.example', '?returnTo=lab')).toBe('/provider/sign-in')
    expect(resolveStaffProductHostname('lab.staging.healthidentitydirectory.com.evil.example')).toBeNull()
    expect(isPlatformAdminHostname('admin.staging.healthidentitydirectory.com.evil.example')).toBe(false)
  })
})
