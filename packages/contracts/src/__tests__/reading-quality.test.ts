import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS } from '../index'

/**
 * Migrate learning, phase 1: the admin "Reading quality" read is built before any hid-system branch serves it
 * (Session B will share the field names), so the registry records it as proposed, super admin only, with its period.
 */
describe('Migrate learning routes', () => {
  it('records the reading-quality read as proposed, for platform.dashboard.read, with days required', () => {
    const entry = HID_ENDPOINTS.find(endpoint => endpoint.name === 'admin.readingQuality')
    expect(entry).toMatchObject({ path: '/api/v1/admin/ocr/reading-quality', service: 'admin', methods: ['GET'], status: 'proposed',
      permissions: { GET: ['platform.dashboard.read'] }, requiredQuery: { GET: ['days'] } })
  })
})
