import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS } from '../index'

/**
 * Migrate learning, phase 1: Session B's OCR quality summary is on a hid-system branch, per facility, read by Migrate's
 * staff-side "Reading quality" view. It is recorded as proposed. Its readers are either-or (hid-system #236): a platform
 * administrator (both platform permissions) or the facility's own manager (workforce.manage there). Permissions here are
 * all-required, so it records none and its note names both. The platform-wide admin read comes with phase 2, so no
 * admin route is recorded.
 */
describe('Migrate learning routes', () => {
  it('records Session B’s per-facility summary as proposed, for platform administrators or the facility’s manager', () => {
    const entry = HID_ENDPOINTS.find(endpoint => endpoint.name === 'ocr.qualitySummary')
    expect(entry).toMatchObject({ path: '/api/v1/ocr/quality/summary', service: 'ocr', methods: ['GET'], status: 'proposed',
      auth: { kind: 'authenticated' } })
    // Either-or: no all-required list, which would wrongly ask a manager for the platform permissions.
    expect(entry?.permissions).toBeUndefined()
    for (const words of ['platform.admin.access and platform.operations.read', 'workforce.manage at the X-Facility-ID facility',
      'not awaiting support review', 'too_few_reviewers']) expect(entry?.note).toContain(words)
    expect(entry?.requiredQuery).toBeUndefined()
  })

  it('records no admin reading-quality route in phase 1', () => {
    expect(HID_ENDPOINTS.find(endpoint => endpoint.name === 'admin.readingQuality')).toBeUndefined()
    expect(HID_ENDPOINTS.some(endpoint => endpoint.path === '/api/v1/admin/ocr/quality/summary')).toBe(false)
  })
})
