import { describe, expect, it } from 'vitest'
import { isStaffProductRoute, resolveStaffProductHostname } from './productHostname'

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
