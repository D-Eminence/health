import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS } from '../index'

/**
 * Migrate learning, phase 1: Session B's OCR quality summary is on a hid-system branch, per facility, read by Migrate's
 * staff-side "Reading quality" view. It is recorded as proposed, for Session B's two platform permissions. The
 * platform-wide admin read comes with phase 2, so no admin route is recorded.
 */
describe('Migrate learning routes', () => {
  it('records Session B’s per-facility summary as proposed', () => {
    const entry = HID_ENDPOINTS.find(endpoint => endpoint.name === 'ocr.qualitySummary')
    expect(entry).toMatchObject({ path: '/api/v1/ocr/quality/summary',
      service: 'ocr', methods: ['GET'], status: 'proposed', permissions: { GET: ['platform.admin.access', 'platform.operations.read'] } })
    expect(entry?.requiredQuery).toBeUndefined()
  })

  it('records no admin reading-quality route in phase 1', () => {
    expect(HID_ENDPOINTS.find(endpoint => endpoint.name === 'admin.readingQuality')).toBeUndefined()
    expect(HID_ENDPOINTS.some(endpoint => endpoint.path === '/api/v1/admin/ocr/quality/summary')).toBe(false)
  })
})
