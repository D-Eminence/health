import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS } from '../index'

/**
 * Routes the frontend is built against that hid-system main (51047e2, and
 * 585ef8d) does not serve: record chat, support chat and imported records came
 * from hid-system's staging branches with Health-id #61. On main, ehr-api and
 * identity-api answer each with 404 NOT_FOUND, so the registry must not record
 * them as served.
 */
const NOT_ON_MAIN = [
  'support.chat',
  'ehr.patientChat', 'ehr.patientChatHistory', 'ehr.patientChatSource',
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
