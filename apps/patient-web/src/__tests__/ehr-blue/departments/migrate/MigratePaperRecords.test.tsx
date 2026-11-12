import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type * as HidApi from '@hid/api'
import { Migrate } from '../../../../ehr-blue/departments/migrate/Migrate'
import { NO_PAPER_RECORDS, LAB_REFUSED, LAB_FAILED, MEDICINES_REFUSED } from '../../../../ehr-blue/departments/migrate/PaperRecords'
import { forgetPaperListsServed, paperRecordsApi } from '../../../../ehr-blue/departments/migrate/paperRecordsApi'
import { IMPORTED_LISTED, IMPORTED_NOT_IN_CHART, IMPORTED_WHERE, ReviewPublication } from '../../../../ehr-blue/departments/migrate/ocrSteps'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'

/**
 * "From paper records" on Migrate's Patient documents: the open patient's lab results and medicines added from paper,
 * as Lab and Pharmacy list them (GET /api/v1/lab/imports and /api/v1/pharmacy/imports, hid-system Session B), and
 * nothing at all while a backend does not serve them. Requests go through the real contract registry and app boundary,
 * to a fake transport. Fictional data only: Patient One, HID-ZDEMAAA2, Demo Hospital, Example Diagnostics.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), documents: vi.fn(), uploadDocument: vi.fn(), documentDownload: vi.fn(),
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), createOcrJob: vi.fn(), ocrPublications: vi.fn(), encounter: vi.fn(),
}))
const transport = vi.hoisted(() => ({ request: vi.fn() }))
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const session = vi.hoisted(() => ({
  permissions: [] as string[],
  activePatient: null as null | { hid: string; purpose: 'direct-care' | 'emergency'; lookup: { patient: { patientId: string; fullName: string } } },
  setActivePatient: vi.fn(),
}))

vi.mock('../../../../staff/api', () => ({
  staffApi: api,
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
}))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => ({ ...staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital' })),
      activePatient: session.activePatient, setActivePatient: session.setActivePatient }),
  }
})
vi.mock('../../../../staff/session', () => ({
  staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {}, staffSessionSignal: () => new AbortController().signal,
  endsStaffSession: () => false, reportStaffSessionEnded: () => {},
}))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The real registered client (contract registry and app boundary), over a fake transport.
vi.mock('@hid/api', async importOriginal => {
  const actual = await importOriginal<typeof HidApi>()
  return {
    ...actual,
    createRegisteredBrowserClient: (_inner: unknown, app: Parameters<typeof actual.createRegisteredBrowserClient>[1]) =>
      actual.createRegisteredBrowserClient({ baseUrl: 'https://gateway.example.test', request: transport.request,
        get: () => Promise.reject(new Error('unused')), post: () => Promise.reject(new Error('unused')) }, app),
  }
})

const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, encounterType: 'outpatient', status: 'in_progress',
  startedAt: '2026-10-12T09:00:00.000Z', chiefComplaint: null, rowVersion: 1 }
const allowed = { authorization: { decision: 'allow' }, patient: { patientId: PATIENT, fullName: 'Patient One' } }
const READS = ['ocr.job.read', 'ehr.document.read', 'lab.import.read', 'pharmacy.import.read']

const LAB_IMPORT = 'f1000000-0000-4000-8000-000000000001'
const OLDER_LAB_IMPORT = 'f1000000-0000-4000-8000-000000000002'
const MEDICINE = 'f2000000-0000-4000-8000-000000000001'
const OLDER_MEDICINE = 'f2000000-0000-4000-8000-000000000002'
const labImport = {
  id: LAB_IMPORT, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, sourceType: 'IMPORTED_EXTERNAL', status: 'accepted',
  externalLabName: 'Example Diagnostics', externalReference: null, collectedAt: null, reportedAt: '2024-02-14T00:00:00.000Z',
  receivedAt: '2026-11-10T09:00:00.000Z', sourceDocumentId: 'd0000000-0000-4000-8000-000000000001', ocrJobId: 'j0000000-0000-4000-8000-000000000001',
  extractionId: null, validationId: null, validationVersion: 1, publicationId: null, version: 1, createdAt: '2026-11-10T09:00:00.000Z',
  observations: [
    { id: 'o1', ordinal: 2, testCode: null, testName: 'Platelets', value: '250', valueText: null, unit: 'x10^9/L', referenceRange: null,
      abnormalFlag: 'normal', reportedAt: null, status: 'reported', createdAt: '2026-11-10T09:00:00.000Z' },
    { id: 'o0', ordinal: 1, testCode: null, testName: 'Haemoglobin', value: '11.2', valueText: null, unit: 'g/dL', referenceRange: '12-16',
      abnormalFlag: 'low', reportedAt: null, status: 'reported', createdAt: '2026-11-10T09:00:00.000Z' },
  ],
}
const undatedImport = { ...labImport, id: OLDER_LAB_IMPORT, externalLabName: null, reportedAt: null,
  observations: [{ ...labImport.observations[1], id: 'o9', testName: 'Malaria parasites', value: null, unit: null, valueText: 'Not seen',
    referenceRange: null, abnormalFlag: 'unknown' }] }
const medicine = {
  id: MEDICINE, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, sourceType: 'IMPORTED_OCR', activityStatus: 'unknown',
  medicationText: 'Metformin', strengthText: '500 mg', doseText: null, frequencyText: 'twice a day',
  historicalContext: 'From a paper record, page 2. Read as: Metformin 500mg bd', sourceDocumentId: 'd0000000-0000-4000-8000-000000000001',
  ocrJobId: null, extractionId: null, validationId: null, validationVersion: 1, publicationId: null, version: 1, createdAt: '2026-11-10T09:00:00.000Z',
}
const olderMedicine = { ...medicine, id: OLDER_MEDICINE, medicationText: 'Amlodipine 5 mg once a day', strengthText: null, frequencyText: null,
  historicalContext: 'Typed from a paper record' }

/** What the fake gateway answers, by path and cursor. */
let answers: Record<string, () => Promise<unknown>> = {}
const key = (path: string, cursor?: string) => cursor ? `${path}?${cursor}` : path
const LAB = '/api/v1/lab/imports'
const PHARMACY = '/api/v1/pharmacy/imports'
const notServed = (code: string) => () => Promise.reject(new HidApiError(404, 'Not found', { code }))

beforeEach(() => {
  vi.clearAllMocks()
  forgetPaperListsServed()
  session.permissions = [...READS]
  session.activePatient = { hid: 'HID-ZDEMAAA2', purpose: 'direct-care', lookup: { patient: { patientId: PATIENT, fullName: 'Patient One' } } }
  api.lookupPatient.mockResolvedValue(allowed)
  api.consentStatus.mockResolvedValue({ writeAllowed: false })
  api.encounters.mockResolvedValue({ items: [encounter], nextCursor: null })
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  answers = {
    [LAB]: async () => ({ records: [labImport], nextCursor: null }),
    [PHARMACY]: async () => ({ items: [medicine], nextCursor: null }),
  }
  transport.request.mockImplementation((spec: { path: string; query?: { cursor?: string } }) => {
    const answer = answers[key(spec.path, spec.query?.cursor)]
    return answer ? answer() : Promise.reject(new Error(`unexpected ${spec.path}`))
  })
})

const listCalls = () => transport.request.mock.calls.map(([spec]) => spec as { path: string; query: Record<string, string>; headers: Record<string, string>; method: string })
const section = () => screen.queryByRole('region', { name: 'From paper records' })
async function settled() {
  renderDept(<Migrate />)
  await waitFor(() => expect(api.encounters).toHaveBeenCalled())
  await waitFor(() => expect(transport.request).toHaveBeenCalledTimes(session.permissions.filter(p => p.endsWith('.import.read')).length))
  await act(async () => {})
}

describe('From paper records: what was added from paper, for the patient open', () => {
  it('lists lab results and medicines in words, newest first, reading each list once for this patient, for direct care here', async () => {
    await settled()
    const shown = section()!
    expect(within(shown).getByRole('heading', { name: 'From paper records', level: 3 })).toBeTruthy()
    const lab = within(shown).getByRole('group', { name: 'Lab results' })
    expect(within(lab).getByText('Report date: 14 Feb 2024')).toBeTruthy()
    expect(within(lab).getByText('Reported by Example Diagnostics')).toBeTruthy()
    // In the order on the paper, the flag in words; a normal flag calls nothing out.
    expect(within(lab).getAllByRole('listitem').slice(1).map(item => item.textContent))
      .toEqual(['Haemoglobin: 11.2 g/dL · Low · reference 12-16', 'Platelets: 250 x10^9/L'])
    const medicines = within(shown).getByRole('group', { name: 'Medicines' })
    expect(within(medicines).getByText('Metformin')).toBeTruthy()
    expect(within(medicines).getByText('500 mg · twice a day')).toBeTruthy()
    expect(within(medicines).getByText('From a paper record, page 2')).toBeTruthy()
    // No record, document or patient id, and no code, on screen.
    expect(shown.textContent).not.toMatch(/[0-9a-f]{8}-|IMPORTED_|accepted|LAB_|PHARMACY_/)
    expect(listCalls()).toEqual([
      { method: 'GET', path: LAB, query: { patientId: PATIENT, limit: '20' }, headers: { 'X-Facility-ID': DEMO_HOSPITAL_ID, 'X-Purpose-Of-Use': 'direct-care' },
        signal: expect.any(AbortSignal), beforeAttempt: expect.any(Function), dedupe: false },
      { method: 'GET', path: PHARMACY, query: { patientId: PATIENT, limit: '20' }, headers: { 'X-Facility-ID': DEMO_HOSPITAL_ID, 'X-Purpose-Of-Use': 'direct-care' },
        signal: expect.any(AbortSignal), beforeAttempt: expect.any(Function), dedupe: false },
    ])
  })

  it('says the report date is not recorded when Lab has none (none on the paper, or one Lab could not read as a date), and a medicine with no page as from a paper record', async () => {
    answers[LAB] = async () => ({ records: [undatedImport], nextCursor: null })
    answers[PHARMACY] = async () => ({ items: [olderMedicine], nextCursor: null })
    await settled()
    expect(within(section()!).getByText('Report date not recorded')).toBeTruthy()
    // Lab sends no date both when the paper had none and when what was typed was not a date, so never claim the paper had none.
    expect(section()!.textContent).not.toMatch(/no report date/i)
    expect(within(section()!).getByText('Malaria parasites: Not seen')).toBeTruthy()
    expect(within(section()!).getByText('From a paper record')).toBeTruthy()
  })

  it('says plainly when nothing has been added from paper', async () => {
    answers[LAB] = async () => ({ records: [], nextCursor: null })
    answers[PHARMACY] = async () => ({ items: [], nextCursor: null })
    await settled()
    expect(within(section()!).getByText(NO_PAPER_RECORDS)).toBeTruthy()
    expect(within(section()!).queryByRole('group')).toBeNull()
  })

  it('shows only the list that has records when the other is empty', async () => {
    answers[PHARMACY] = async () => ({ items: [], nextCursor: null })
    await settled()
    expect(within(section()!).getByRole('group', { name: 'Lab results' })).toBeTruthy()
    expect(within(section()!).queryByRole('group', { name: 'Medicines' })).toBeNull()
    expect(within(section()!).queryByText(NO_PAPER_RECORDS)).toBeNull()
  })
})

describe('From paper records: dormant until Lab and Pharmacy serve the lists', () => {
  it.each(['API_ROUTE_NOT_FOUND', 'NOT_FOUND'])('is not there at all while both lists answer 404 %s', async code => {
    answers[LAB] = notServed(code)
    answers[PHARMACY] = notServed(code)
    await settled()
    expect(section()).toBeNull()
    expect(screen.queryByText(/paper records/i)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the list that is served, and nothing of the one that is not', async () => {
    answers[PHARMACY] = notServed('API_ROUTE_NOT_FOUND')
    await settled()
    expect(within(section()!).getByRole('group', { name: 'Lab results' })).toBeTruthy()
    expect(within(section()!).queryByRole('group', { name: 'Medicines' })).toBeNull()
  })

  it('reads no list the role cannot read, and shows nothing without either', async () => {
    session.permissions = ['ocr.job.read', 'ehr.document.read']
    renderDept(<Migrate />)
    await waitFor(() => expect(api.encounters).toHaveBeenCalled())
    await act(async () => {})
    expect(transport.request).not.toHaveBeenCalled()
    expect(section()).toBeNull()
  })

  it('reads only the list the role can read', async () => {
    session.permissions = ['ocr.job.read', 'ehr.document.read', 'pharmacy.import.read']
    await settled()
    expect(listCalls().map(call => call.path)).toEqual([PHARMACY])
    expect(within(section()!).getByRole('group', { name: 'Medicines' })).toBeTruthy()
  })

  it('is not read under emergency access, where Patient documents is read-only and shows no documents', async () => {
    session.activePatient = { ...session.activePatient!, purpose: 'emergency' }
    renderDept(<Migrate />)
    await act(async () => {})
    expect(transport.request).not.toHaveBeenCalled()
    expect(section()).toBeNull()
  })
})

describe('From paper records: refusals and failures', () => {
  it('a 403 says plainly that the role can’t see them', async () => {
    answers[LAB] = () => Promise.reject(new HidApiError(403, 'Forbidden', { code: 'LAB_IMPORT_ACCESS_DENIED' }))
    answers[PHARMACY] = () => Promise.reject(new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }))
    await settled()
    expect(within(section()!).getByText(LAB_REFUSED)).toBeTruthy()
    expect(within(section()!).getByText(MEDICINES_REFUSED)).toBeTruthy()
    expect(section()!.textContent).not.toMatch(/LAB_IMPORT_ACCESS_DENIED|FORBIDDEN|403/)
  })

  it('a failure says so plainly, and Try again reads the list again', async () => {
    answers[LAB] = () => Promise.reject(new HidApiError(503, 'Upstream unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    await settled()
    const alert = within(section()!).getByRole('alert')
    expect(alert.textContent).toBe(`${LAB_FAILED} Try again`)
    answers[LAB] = async () => ({ records: [labImport], nextCursor: null })
    await act(async () => { fireEvent.click(within(alert).getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(within(section()!).getByText('Report date: 14 Feb 2024')).toBeTruthy())
    expect(within(section()!).queryByRole('alert')).toBeNull()
    expect(listCalls().filter(call => call.path === LAB)).toHaveLength(2)
  })

  it('an answer for another patient is never shown', async () => {
    answers[PHARMACY] = async () => ({ items: [{ ...medicine, patientId: 'a0000000-0000-4000-8000-000000000009' }], nextCursor: null })
    await settled()
    expect(within(section()!).queryByText('Metformin')).toBeNull()
    expect(within(section()!).getByText('Medicines from paper records couldn’t be loaded.')).toBeTruthy()
  })
})

describe('From paper records: a page at a time', () => {
  it('Show more reads the next page by its cursor, adds it below, and takes focus to the first record it added', async () => {
    answers[LAB] = async () => ({ records: [labImport], nextCursor: LAB_IMPORT })
    answers[key(LAB, LAB_IMPORT)] = async () => ({ records: [undatedImport], nextCursor: null })
    await settled()
    const lab = within(section()!).getByRole('group', { name: 'Lab results' })
    await act(async () => { fireEvent.click(within(lab).getByRole('button', { name: 'Show more' })) })
    await waitFor(() => expect(within(lab).getByText('Report date not recorded')).toBeTruthy())
    expect(listCalls().at(-1)).toMatchObject({ path: LAB, query: { patientId: PATIENT, limit: '20', cursor: LAB_IMPORT } })
    const records = within(lab).getAllByText(/^(Report date: 14 Feb 2024|Report date not recorded)$/)
    expect(records.map(record => record.textContent)).toEqual(['Report date: 14 Feb 2024', 'Report date not recorded'])
    expect(document.activeElement).toBe(records[1]!.closest('li'))
    expect(within(lab).queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('a next page that fails says so and offers Try again, keeping what was shown', async () => {
    answers[PHARMACY] = async () => ({ items: [medicine], nextCursor: MEDICINE })
    answers[key(PHARMACY, MEDICINE)] = () => Promise.reject(new HidApiError(500, 'Internal error', { code: 'INTERNAL_ERROR' }))
    await settled()
    const medicines = within(section()!).getByRole('group', { name: 'Medicines' })
    await act(async () => { fireEvent.click(within(medicines).getByRole('button', { name: 'Show more' })) })
    await waitFor(() => expect(within(medicines).getByRole('alert').textContent).toBe('More couldn’t be loaded.'))
    expect(within(medicines).getByText('Metformin')).toBeTruthy()
    answers[key(PHARMACY, MEDICINE)] = async () => ({ items: [olderMedicine], nextCursor: null })
    await act(async () => { fireEvent.click(within(medicines).getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(within(medicines).getByText('Amlodipine 5 mg once a day')).toBeTruthy())
    expect(within(medicines).queryByRole('alert')).toBeNull()
  })
})

describe('A Lab or Pharmacy publication points to From paper records once its list is served', () => {
  const IMPORT = 'b0000000-0000-4000-8000-0000000000aa'
  const validation = { id: 'validation-1', jobId: 'j0000000-0000-4000-8000-000000000001', extractionId: 'extraction-1', version: 1,
    disposition: 'validated', targetDomain: 'LAB', candidateType: 'lab_document', acceptedFields: {}, rejectedFields: [], corrections: [],
    reason: 'Matches the source document', reviewedAt: '2026-10-12T09:30:00.000Z' }
  const publication = (targetDomain: 'LAB' | 'PHARMACY') => ({ id: 'publication-1', validationId: validation.id, validationVersion: 1, targetDomain,
    targetOperation: targetDomain === 'LAB' ? 'create_imported_lab_evidence' : 'create_imported_medication_evidence', status: 'published',
    attemptCount: 1, maxAttempts: 3, targetResourceId: IMPORT,
    targetResourceType: targetDomain === 'LAB' ? 'lab-imported-evidence' : 'pharmacy-imported-medication-evidence' })
  async function published(targetDomain: 'LAB' | 'PHARMACY') {
    api.ocrPublications.mockResolvedValue({ items: [publication(targetDomain)] })
    renderDept(<ReviewPublication actorId="staff-demo-1" facilityId={DEMO_HOSPITAL_ID} patientId={PATIENT}
      validation={{ ...validation, targetDomain } as never} confirmationId="confirmation-1" permissions={session.permissions}
      publicationAttempts={new Map()} onChanged={async () => {}} />)
    await screen.findByText(/added as imported records from this paper/)
  }

  it('before any list has answered, says to see them on this publication, as before', async () => {
    await published('LAB')
    expect(screen.getByText(IMPORTED_WHERE)).toBeTruthy()
    expect(screen.queryByText(IMPORTED_LISTED)).toBeNull()
  })

  it('once Lab\'s list answered, points a lab publication to From paper records', async () => {
    await act(async () => { await paperRecordsApi.labImports(DEMO_HOSPITAL_ID, PATIENT) })
    await published('LAB')
    expect(screen.getByText(IMPORTED_LISTED)).toBeTruthy()
    expect(screen.queryByText(IMPORTED_WHERE)).toBeNull()
  })

  it('a medicines publication waits for Pharmacy\'s list', async () => {
    await act(async () => { await paperRecordsApi.labImports(DEMO_HOSPITAL_ID, PATIENT) })
    await published('PHARMACY')
    expect(screen.getByText(IMPORTED_WHERE)).toBeTruthy()
    await act(async () => { await paperRecordsApi.medicines(DEMO_HOSPITAL_ID, PATIENT) })
    expect(screen.getByText(IMPORTED_LISTED)).toBeTruthy()
  })

  it('not while the list answers 404', async () => {
    answers[LAB] = notServed('API_ROUTE_NOT_FOUND')
    await act(async () => { await paperRecordsApi.labImports(DEMO_HOSPITAL_ID, PATIENT) })
    await published('LAB')
    expect(screen.getByText(IMPORTED_WHERE)).toBeTruthy()
  })

  it('not for another patient open on Patient documents', async () => {
    await act(async () => { await paperRecordsApi.labImports(DEMO_HOSPITAL_ID, PATIENT) })
    session.activePatient = { ...session.activePatient!, lookup: { patient: { patientId: 'a0000000-0000-4000-8000-000000000009', fullName: 'Patient Two' } } }
    await published('LAB')
    expect(screen.getByText(IMPORTED_WHERE)).toBeTruthy()
  })

  it('not for a role that can\'t read the list', async () => {
    await act(async () => { await paperRecordsApi.labImports(DEMO_HOSPITAL_ID, PATIENT) })
    session.permissions = ['ocr.job.read', 'ehr.document.read']
    await published('LAB')
    expect(screen.getByText(IMPORTED_NOT_IN_CHART)).toBeTruthy()
  })
})
