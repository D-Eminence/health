import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS } from '../index'

/**
 * Routes the frontend is built against that hid-system main (41542fc) does not
 * serve: support chat, hospital chat, the patient chat source read and
 * `/imported-records` are served by hid-system's staging branches, which
 * Health-id #61 was built against. On main each is answered 404 (by ehr-api, or
 * by the gateway for support chat), so the registry must not record them as
 * served. Patient record chat and imported history are served by main (#94,
 * #95), under the entries `ehr.patientChat*`, `ehr.myImportedHistory`,
 * `ehr.importedHistory` and `identity.importedHistorySharing`.
 */
const NOT_ON_MAIN = [
  'support.chat',
  'ehr.patientChatSource',
  'ehr.staffPatientChat', 'ehr.staffPatientChatHistory', 'ehr.staffPatientChatSource',
  'ehr.myImportedAttachment', 'ehr.importedRecords', 'ehr.importedAttachment',
] as const

describe('routes hid-system main does not serve', () => {
  it.each(NOT_ON_MAIN)('%s is recorded as proposed, with a note saying where it is served', name => {
    const endpoint = HID_ENDPOINTS.find(item => item.name === name)
    expect(endpoint).toBeDefined()
    expect(endpoint?.status).toBe('proposed')
    expect(endpoint?.note).toMatch(/not served by hid-system main/)
  })
})
