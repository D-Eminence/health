import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { findEndpoint } from '../registry'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'

/**
 * "Add a record" (BACKEND-NEEDS.md §1; hid-system 0116, PR #163): the entry, its list a page at a time, the removal, and
 * the staff chart's read of them; each photo or file's upload link and confirm stay proposed (step 7). For the patient
 * portal only, apart from the staff read: the registered browser client refuses a path that is not here.
 */
describe('a record the patient adds themselves', () => {
  const entryId = '7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
  const documentId = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
  const routes = [
    ['ehr.myPatientEntries', 'POST', '/api/v1/ehr/me/patient-entries'],
    ['ehr.myPatientEntries', 'GET', '/api/v1/ehr/me/patient-entries'],
    ['ehr.myPatientEntryUploadIntent', 'POST', `/api/v1/ehr/me/patient-entries/${entryId}/documents/upload-intents`],
    ['ehr.myPatientEntryDocumentComplete', 'POST', `/api/v1/ehr/me/patient-entries/${entryId}/documents/${documentId}/complete`],
    ['ehr.myPatientEntryWithdraw', 'POST', `/api/v1/ehr/me/patient-entries/${entryId}/withdraw`],
  ] as const

  it.each(routes)('%s %s is proposed, for a signed-in patient, and matched by its path', (name, method, path) => {
    expect(findEndpoint(name)).toMatchObject({ service: 'ehr', status: 'proposed', auth: { kind: 'authenticated' } })
    expect(findEndpoint(name)?.permissions).toBeUndefined()
    expect(findEndpoint(name)?.note).toContain('BACKEND-NEEDS.md §1')
    expect(assertRegisteredBrowserRequest(method, path).name).toBe(name)
  })

  it('is the patient portal\'s alone', () => {
    for (const name of new Set(routes.map(([name]) => name))) {
      expect(() => assertEndpointAllowed('patient-web', name), name).not.toThrow()
      for (const app of ['staff-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
  })

  it('takes only the methods the contract names', () => {
    for (const name of ['ehr.myPatientEntryUploadIntent', 'ehr.myPatientEntryDocumentComplete', 'ehr.myPatientEntryWithdraw']) {
      expect(findEndpoint(name)?.methods, name).toEqual(['POST'])
    }
    // The list read (0116): the first page comes in the records answer, the pages after it from here with `before`.
    expect(findEndpoint('ehr.myPatientEntries')?.methods).toEqual(['GET', 'POST'])
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/me/patient-entries', { before: 'abcdefghijklmnop' }).name).toBe('ehr.myPatientEntries')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/me/records').name).toBe('ehr.myRecords')
    expect(findEndpoint('ehr.myPatientEntries')?.note).toContain('ehr.myRecords lists the first page under patientEntries')
    expect(findEndpoint('ehr.myPatientEntries')?.note).toContain('patientEntriesNextBefore')
    // No delete anywhere: nothing is erased, an entry is withdrawn. No document is read back through these routes.
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/ehr/me/patient-entries/${entryId}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', `/api/v1/ehr/me/patient-entries/${entryId}/documents/upload-intents`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', `/api/v1/ehr/me/patient-entries/${entryId}/documents/${documentId}/download`)).toThrow(BrowserRouteError)
  })

  it('no longer describes file bytes in the Save', () => {
    expect(findEndpoint('ehr.myPatientEntries')?.note).not.toMatch(/contentBase64|attachments/)
    expect(findEndpoint('ehr.myPatientEntries')?.note).toContain('8000 bytes')
  })

  it('names the replayed upload link’s answer once its file is confirmed', () => {
    expect(findEndpoint('ehr.myPatientEntryUploadIntent')?.note).toContain('409 PATIENT_DOCUMENT_ALREADY_UPLOADED')
  })

  it('names the day’s limit, what counts, its refusal and Retry-After, and says the photos arrive without their metadata but are not to be relied on for it', () => {
    const note = findEndpoint('ehr.myPatientEntryUploadIntent')?.note
    expect(note).toContain('429 PATIENT_DOCUMENT_DAILY_LIMIT')
    // That code alone, under no other name.
    expect(note?.match(/[A-Z_]*DAILY_LIMIT[A-Z_]*/g)).toEqual(['PATIENT_DOCUMENT_DAILY_LIMIT'])
    expect(note).toContain('At most 10 files per patient per Lagos calendar day')
    expect(note).toContain('each new key answered 201 counts once, confirmed or not, and a removed entry\'s files still count')
    expect(note).toContain('a replayed key is never refused')
    expect(note).toContain('Retry-After (the seconds until the next Lagos midnight; the portal does not depend on it)')
    expect(note).toContain('1 to 10485760 bytes')
    expect(note).toContain('must not rely on that')
  })

  it('names the confirm’s check of the stored object’s leading bytes against mediaType, and its refusal', () => {
    const note = findEndpoint('ehr.myPatientEntryDocumentComplete')?.note
    expect(note).toContain('its leading bytes against mediaType')
    expect(note).toContain('not the request\'s Content-Type')
    expect(note).toContain('409 PATIENT_DOCUMENT_TYPE_MISMATCH')
    expect(note).toContain('409 PATIENT_DOCUMENT_UPLOAD_INCOMPLETE')
  })

  it('names the removal’s refusal for an entry that is not there', () => {
    expect(findEndpoint('ehr.myPatientEntryWithdraw')?.note).toContain('404 PATIENT_ENTRY_NOT_FOUND')
  })

  it('says where it is served, that it is on by default, and that switched off looks exactly as not built', () => {
    const note = findEndpoint('ehr.myPatientEntries')?.note
    expect(note).toContain('hid-system 0116 (PR #163, claude/patient-entries-0116)')
    expect(note).toContain('on by default')
    expect(note).toContain('PATIENT_ENTRIES_ENABLED=false')
    expect(note).toContain('every patient-entry route answers 404 NOT_FOUND')
    expect(note).not.toMatch(/must not send patientEntries until uploads/)
    // Text only: photos and files are a later step, so patientEntries no longer says uploads are served.
    expect(note).toContain('photos and files are not served yet')
  })

  it('names the Save’s refusals the portal says in its own words', () => {
    const note = findEndpoint('ehr.myPatientEntries')?.note
    for (const code of ['429 PATIENT_ENTRY_LIMITED', '422 PATIENT_ENTRY_FILES_NOT_READY', '409 IDEMPOTENCY_KEY_REUSED', '400 VALIDATION_FAILED',
      '400 INVALID_CURSOR', 'notes at most 1000']) expect(note, code).toContain(code)
  })
})

/** The staff chart's read of the records the patient added (0116): read-only, direct care, ehr.note.read. */
describe('the staff chart’s read of what the patient added', () => {
  const patientId = '11111111-1111-4111-8111-111111111111'
  it('is registered as a GET with ehr.note.read, for staff and the EHR only', () => {
    expect(findEndpoint('ehr.patientEntries')).toMatchObject({ service: 'ehr', status: 'proposed', methods: ['GET'],
      path: '/api/v1/ehr/patients/:patientId/patient-entries', permissions: { GET: ['ehr.note.read'] } })
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/patients/${patientId}/patient-entries`).name).toBe('ehr.patientEntries')
    expect(() => assertRegisteredBrowserRequest('POST', `/api/v1/ehr/patients/${patientId}/patient-entries`)).toThrow(BrowserRouteError)
    for (const app of ['staff-web', 'ehr-web'] as const) expect(() => assertEndpointAllowed(app, 'ehr.patientEntries')).not.toThrow()
    for (const app of ['patient-web', 'admin-web', 'public-web'] as const) {
      expect(() => assertEndpointAllowed(app, 'ehr.patientEntries'), app).toThrow(BoundaryViolationError)
    }
    expect(findEndpoint('ehr.patientEntries')?.note).toContain('X-Purpose-Of-Use: direct-care')
    expect(findEndpoint('ehr.patientEntries')?.note).toContain('{ items, more, nextBefore }')
  })
})
