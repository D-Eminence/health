import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS } from '../index'

/**
 * Migrate learning, phase 1: Session B's OCR quality summary is on a hid-system branch, per facility; the admin
 * "Reading quality" page reads a platform-wide admin read of the same summary, which no branch serves yet. Both are
 * recorded as proposed, for Session B's two platform permissions.
 */
describe('Migrate learning routes', () => {
  it('records the admin reading-quality read as proposed, for Session B’s permissions', () => {
    const entry = HID_ENDPOINTS.find(endpoint => endpoint.name === 'admin.readingQuality')
    expect(entry).toMatchObject({ path: '/api/v1/admin/ocr/quality/summary', service: 'admin', methods: ['GET'], status: 'proposed',
      permissions: { GET: ['platform.admin.access', 'platform.operations.read'] } })
    expect(entry?.requiredQuery).toBeUndefined()
  })

  it('records Session B’s per-facility summary as proposed', () => {
    expect(HID_ENDPOINTS.find(endpoint => endpoint.name === 'ocr.qualitySummary')).toMatchObject({ path: '/api/v1/ocr/quality/summary',
      service: 'ocr', methods: ['GET'], status: 'proposed', permissions: { GET: ['platform.admin.access', 'platform.operations.read'] } })
  })
})
