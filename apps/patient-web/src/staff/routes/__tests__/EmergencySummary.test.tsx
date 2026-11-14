import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Clinical } from '../Clinical'

/**
 * The emergency (break-glass) summary. Since hid-system a486a23 the emergency
 * route (GET /ehr/patients/:id/emergency-records, which itself requires only
 * ehr.encounter.read and ehr.note.read) answers with seven sections: completed
 * encounters and signed notes (50 each), and vitals, diagnoses, prescriptions,
 * lab requests and documents (100 each), every status included. The summary
 * shows each further section only when the facility role holds that record's
 * own read permission, puts what is current first and says plainly what is not
 * valid. It shows no vitals: EHR returns them as first recorded, without later
 * corrections. It lists documents without opening any.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), emergencyRecords: vi.fn(), encounters: vi.fn(), records: vi.fn(),
  consentStatus: vi.fn(), documentDownload: vi.fn(), labReleasedResultsForOrder: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['nurse'], permissions: staff.permissions,
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'emergency', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: 'grant-1', breakGlass: true } }
const EVERY_READ = ['ehr.encounter.read', 'ehr.note.read', 'ehr.vital.read', 'ehr.diagnosis.read', 'ehr.prescription.read',
  'ehr.lab-request.read', 'ehr.document.read']
const where = { encounterId: ENCOUNTER, facilityId: 'facility-1' }
const encounter = (n: number) => ({ id: `encounter-${n}`, facilityId: 'facility-1', encounterType: 'emergency', status: 'completed',
  startedAt: '2026-10-01T08:00:00.000Z', endedAt: '2026-10-01T09:00:00.000Z' })
const note = (n: number) => ({ id: `note-${n}`, ...where, noteType: 'Triage', title: `Triage note ${n}`, status: 'signed', revisionNo: 1,
  content: 'Alert and oriented.', signedAt: '2026-10-01T08:30:00.000Z' })
const diagnosis = (id: string, display: string, clinicalStatus: string, verificationStatus: string) => ({ id, ...where,
  codeSystem: 'ICD-10', code: 'X00', display, clinicalStatus, verificationStatus, onsetAt: null, abatementAt: null, notes: null })
// Prescriptions as pg returns them: numeric dose_quantity arrives as a string.
const prescription = (id: string, medicationDisplay: string, status: string) => ({ id, ...where, medicationCodeSystem: null,
  medicationCode: null, medicationDisplay, doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral', frequency: 'Twice daily',
  instructions: 'Take with food', startsOn: null, endsOn: null, status })
const labRequest = (id: string, testDisplay: string, status: string) => ({ id, ...where, testCodeSystem: 'LOINC', testCode: '718-7',
  testDisplay, priority: 'urgent', status, specimenTypeCode: null, clinicalInformation: null, externalOrderReference: null,
  createdAt: '2026-10-01T08:10:00.000Z' })
const documentRow = (id: string, fileName: string) => ({ id, ...where, fileName, mediaType: 'application/pdf', sizeBytes: '20480',
  classification: 'phi', status: 'uploaded', createdAt: '2026-10-01T08:20:00.000Z' })
// A vital as EHR's summary returns it: the values first recorded, whatever was corrected since.
const vital = { id: 'vital-1', ...where, recordedAt: '2026-10-01T08:05:00.000Z', heightCm: null, weightKg: null, temperatureC: '39.4',
  pulseBpm: 131, respiratoryRate: 24, systolicMmhg: 88, diastolicMmhg: 52, oxygenSaturationPercent: '91.00', source: 'manual' }

function summary(overrides: Record<string, unknown> = {}) {
  return {
    encounters: [encounter(1)], notes: [note(1)], vitals: [vital],
    diagnoses: [
      diagnosis('diagnosis-1', 'Recorded against the wrong patient', 'active', 'entered_in_error'),
      diagnosis('diagnosis-2', 'Old fracture', 'resolved', 'confirmed'),
      diagnosis('diagnosis-3', 'Severe malaria', 'active', 'confirmed'),
    ],
    prescriptions: [
      prescription('prescription-1', 'Paracetamol', 'cancelled'),
      prescription('prescription-2', 'Wrong drug', 'entered_in_error'),
      prescription('prescription-3', 'Artesunate', 'active'),
    ],
    labRequests: [labRequest('lab-1', 'Blood film', 'cancelled'), labRequest('lab-2', 'Haemoglobin', 'active')],
    documents: [documentRow('document-1', 'referral-letter.pdf')],
    limit: 100,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = EVERY_READ
  api.lookupPatient.mockResolvedValue(lookup)
  api.emergencyRecords.mockResolvedValue(summary())
})

async function renderSummary() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Completed encounters' })
}

function section(name: string) {
  return screen.getByRole('heading', { level: 2, name }).closest<HTMLElement>('.staff-card')!
}

/** The names of a section's entries, in the order shown. */
function entries(name: string) {
  return Array.from(section(name).querySelectorAll('.staff-list-item strong')).map(item => item.textContent)
}

describe('the emergency summary shows every section EHR returns that the role may read', () => {
  it('shows diagnoses, prescriptions, lab requests and documents alongside encounters and notes', async () => {
    await renderSummary()
    expect(api.emergencyRecords).toHaveBeenCalledWith('facility-1', PATIENT)
    for (const name of ['Completed encounters', 'Signed notes', 'Diagnoses', 'Prescriptions', 'Lab requests', 'Documents']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
    expect(within(section('Diagnoses')).getByText('Severe malaria')).toBeTruthy()
    expect(within(section('Prescriptions')).getByText('Artesunate')).toBeTruthy()
    expect(within(section('Lab requests')).getByText('Haemoglobin')).toBeTruthy()
    expect(within(section('Documents')).getByText('referral-letter.pdf')).toBeTruthy()
  })

  it.each([
    ['ehr.diagnosis.read', 'Diagnoses', 'Severe malaria'],
    ['ehr.prescription.read', 'Prescriptions', 'Artesunate'],
    ['ehr.lab-request.read', 'Lab requests', 'Haemoglobin'],
    ['ehr.document.read', 'Documents', 'referral-letter.pdf'],
  ])('without %s the role sees no %s section, though the server sent it', async (permission, name, entry) => {
    staff.permissions = EVERY_READ.filter(item => item !== permission)
    await renderSummary()
    expect(screen.queryByRole('heading', { level: 2, name })).toBeNull()
    expect(screen.queryByText(entry)).toBeNull()
    // The other sections are still shown.
    expect(screen.getByRole('heading', { level: 2, name: 'Signed notes' })).toBeTruthy()
  })

  it('puts current entries first and labels entered-in-error and cancelled ones', async () => {
    await renderSummary()
    expect(entries('Diagnoses')).toEqual(['Severe malaria', 'Old fracture', 'Recorded against the wrong patient'])
    expect(entries('Prescriptions')).toEqual(['Artesunate', 'Paracetamol', 'Wrong drug'])
    expect(entries('Lab requests')).toEqual(['Haemoglobin', 'Blood film'])

    const wrongDiagnosis = within(section('Diagnoses')).getByText('Recorded against the wrong patient').closest<HTMLElement>('.staff-list-item')!
    expect(wrongDiagnosis.textContent).toContain('Entered in error')
    const wrongDrug = within(section('Prescriptions')).getByText('Wrong drug').closest<HTMLElement>('.staff-list-item')!
    expect(wrongDrug.textContent).toContain('Entered in error')
    const cancelled = within(section('Prescriptions')).getByText('Paracetamol').closest<HTMLElement>('.staff-list-item')!
    expect(cancelled.textContent).toContain('Cancelled')
    const cancelledTest = within(section('Lab requests')).getByText('Blood film').closest<HTMLElement>('.staff-list-item')!
    expect(cancelledTest.textContent).toContain('Cancelled')
  })

  it('shows a prescription’s dose, route, frequency and instructions', async () => {
    await renderSummary()
    const item = within(section('Prescriptions')).getByText('Artesunate').closest<HTMLElement>('.staff-list-item')!
    expect(item.textContent).toContain('500 mg')
    expect(item.textContent).toContain('oral')
    expect(item.textContent).toContain('Twice daily')
    expect(item.textContent).toContain('Take with food')
  })

  // ehr.prescriptions.starts_on and ends_on are pg date columns, and hid-system sets no
  // type parser: node-pg makes each midnight where the service runs, which is sent as an
  // instant. A clinician sees the calendar day, never a timestamp or the day before.
  it.each([
    ['in UTC', '2026-10-12T00:00:00.000Z', '2026-10-19T00:00:00.000Z'],
    ['an hour east of UTC (Africa/Lagos)', '2026-10-11T23:00:00.000Z', '2026-10-18T23:00:00.000Z'],
    ['five hours west of UTC', '2026-10-12T05:00:00.000Z', '2026-10-19T05:00:00.000Z'],
    ['as plain dates', '2026-10-12', '2026-10-19'],
  ])('shows the calendar days a prescription runs, sent from a service %s', async (_where, startsOn, endsOn) => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [{ ...prescription('prescription-3', 'Artesunate', 'active'), startsOn, endsOn }] }))
    await renderSummary()
    const item = within(section('Prescriptions')).getByText('Artesunate').closest<HTMLElement>('.staff-list-item')!
    expect(within(item).getByText(/^Starts/).textContent).toBe('Starts 12 Oct 2026 · Ends 19 Oct 2026')
    expect(item.textContent).not.toMatch(/T\d\d:\d\d|Z\b/)
  })

  it('shows a prescription with only a start date, and one with neither, without inventing the other', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [
      { ...prescription('prescription-3', 'Artesunate', 'active'), startsOn: '2026-10-12T00:00:00.000Z' },
      prescription('prescription-1', 'Paracetamol', 'active'),
    ] }))
    await renderSummary()
    const started = within(section('Prescriptions')).getByText('Artesunate').closest<HTMLElement>('.staff-list-item')!
    expect(within(started).getByText(/^Starts/).textContent).toBe('Starts 12 Oct 2026')
    const undated = within(section('Prescriptions')).getByText('Paracetamol').closest<HTMLElement>('.staff-list-item')!
    expect(within(undated).queryByText(/Starts|Ends/)).toBeNull()
  })

  it('lists documents without offering to open, download or extract any', async () => {
    await renderSummary()
    const documents = section('Documents')
    expect(within(documents).queryAllByRole('button')).toEqual([])
    expect(within(documents).queryAllByRole('link')).toEqual([])
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
    expect(documents.textContent).toMatch(/cannot be opened from this summary/)
    expect(api.documentDownload).not.toHaveBeenCalled()
  })

  it('shows no vital signs, and says why', async () => {
    await renderSummary()
    expect(screen.queryByRole('heading', { name: /Vital/ })).toBeNull()
    for (const value of ['131', '88/52', '39.4', '91']) expect(document.body.textContent).not.toContain(value)
    expect(screen.getByText(/Vital signs are not shown in this summary/).textContent).toMatch(/corrections/)
  })

  it('describes what the summary holds', async () => {
    await renderSummary()
    const lede = screen.getByText(/read-only summary/)
    expect(lede.textContent).not.toMatch(/contains completed encounters and signed clinical notes from this facility\./)
    expect(lede.textContent).toMatch(/diagnoses, prescriptions, lab requests and documents/)
  })
})

describe('each section says when the backend cut it short', () => {
  it('flags encounters and notes at their cap of 50, though the summary reports a limit of 100', async () => {
    api.emergencyRecords.mockResolvedValue(summary({
      encounters: Array.from({ length: 50 }, (_, n) => encounter(n)), notes: Array.from({ length: 50 }, (_, n) => note(n)),
    }))
    await renderSummary()
    expect(within(section('Completed encounters')).getByText(/50 most recent/)).toBeTruthy()
    expect(within(section('Signed notes')).getByText(/50 most recent/)).toBeTruthy()
    expect(within(section('Diagnoses')).queryByText(/most recent/)).toBeNull()
  })

  it('flags the other sections at their cap of 100, and none below it', async () => {
    api.emergencyRecords.mockResolvedValue(summary({
      diagnoses: Array.from({ length: 100 }, (_, n) => diagnosis(`diagnosis-${n}`, `Diagnosis ${n}`, 'active', 'confirmed')),
      prescriptions: Array.from({ length: 99 }, (_, n) => prescription(`prescription-${n}`, `Medicine ${n}`, 'active')),
    }))
    await renderSummary()
    expect(within(section('Diagnoses')).getByText(/100 most recent/)).toBeTruthy()
    expect(within(section('Prescriptions')).queryByText(/most recent/)).toBeNull()
    expect(within(section('Completed encounters')).queryByText(/most recent/)).toBeNull()
  })

  it('shows a section the server left out as unavailable, not as empty', async () => {
    const older = summary()
    delete (older as Record<string, unknown>).diagnoses
    api.emergencyRecords.mockResolvedValue(older)
    await renderSummary()
    await waitFor(() => expect(within(section('Diagnoses')).getByText(/not available/)).toBeTruthy())
    expect(within(section('Diagnoses')).queryByText(/No diagnoses/)).toBeNull()
  })
})

/**
 * Since hid-system #52 (patient-records.service.ts readEmergency) the summary
 * reads only the sections the reader holds the read permission for: `released`
 * names them and `withheld` the others, whose arrays are then empty and mean
 * "not released to this caller", never "no records". `limits` and `truncated`
 * say, per released section, the most rows it shows and whether more exist, so
 * a section is cut short only when EHR says so. Documents are those whose
 * latest scan is clean (documents_effective, status 'available').
 */
const SECTIONS = ['encounters', 'notes', 'vitals', 'diagnoses', 'prescriptions', 'labRequests', 'documents'] as const
const LIMITS: Record<string, number> = { encounters: 50, notes: 50, vitals: 100, diagnoses: 100, prescriptions: 100, labRequests: 100, documents: 100 }
const cleanDocument = (id: string, fileName: string) => ({ ...documentRow(id, fileName), status: 'available', scanStatus: 'clean' })

function releasedSummary(withheld: readonly string[] = [], truncated: Record<string, boolean> = {}, overrides: Record<string, unknown> = {}) {
  const shown = SECTIONS.filter(name => !withheld.includes(name))
  return summary({
    documents: [cleanDocument('document-1', 'referral-letter.pdf')],
    ...Object.fromEntries(withheld.map(name => [name, []])),
    released: shown, withheld: [...withheld],
    limits: Object.fromEntries(shown.map(name => [name, LIMITS[name]])),
    truncated: Object.fromEntries(shown.map(name => [name, truncated[name] ?? false])),
    limit: 50,
    ...overrides,
  })
}

describe('a summary that names what EHR withheld and what it cut short', () => {
  it('never calls a withheld section empty, though the role may read it here', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary(['diagnoses']))
    await renderSummary()
    expect(screen.queryByText('No diagnoses are available from this facility.')).toBeNull()
    expect(within(section('Diagnoses')).getByText(/not included in this summary/)).toBeTruthy()
    // A section EHR released and that holds nothing is still empty.
    api.emergencyRecords.mockResolvedValue(releasedSummary([], {}, { prescriptions: [] }))
    screen.getByRole('button', { name: 'Refresh summary' }).click()
    expect(await within(section('Prescriptions')).findByText('No prescriptions are available from this facility.')).toBeTruthy()
  })

  it('says a section was cut short only when EHR says so', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary([], { notes: true }, {
      encounters: Array.from({ length: 50 }, (_, n) => encounter(n)),
      notes: Array.from({ length: 50 }, (_, n) => note(n)),
      prescriptions: Array.from({ length: 100 }, (_, n) => prescription(`prescription-${n}`, `Medicine ${n}`, 'active')),
    }))
    await renderSummary()
    expect(within(section('Prescriptions')).queryByText(/most recent/)).toBeNull()
    expect(within(section('Completed encounters')).queryByText(/most recent/)).toBeNull()
    expect(within(section('Signed notes')).getByText(/50 most recent/)).toBeTruthy()
  })

  it('says a section with fewer rows than its limit was cut short when EHR says so', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary([], { diagnoses: true }))
    await renderSummary()
    expect(within(section('Diagnoses')).getByText(/100 most recent/)).toBeTruthy()
  })

  it('says listed documents passed the virus scan', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary())
    await renderSummary()
    const documents = section('Documents')
    expect(documents.textContent).not.toMatch(/virus scan result is not included/)
    expect(documents.textContent).toMatch(/passed the virus scan/)
    expect(documents.textContent).toMatch(/cannot be opened from this summary/)
    expect(within(documents).queryAllByRole('button')).toEqual([])
  })

  it('says nothing about vital signs when EHR withheld them', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary(['vitals']))
    await renderSummary()
    expect(screen.queryByText(/Vital signs are not shown in this summary/)).toBeNull()
  })

  it('still explains the vital signs it does not show when EHR released them', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary())
    await renderSummary()
    expect(screen.getByText(/Vital signs are not shown in this summary/)).toBeTruthy()
    for (const value of ['131', '88/52', '39.4']) expect(document.body.textContent).not.toContain(value)
  })

  it('keeps a section the role may not read hidden, whatever EHR released', async () => {
    staff.permissions = EVERY_READ.filter(item => item !== 'ehr.document.read')
    api.emergencyRecords.mockResolvedValue(releasedSummary())
    await renderSummary()
    expect(screen.queryByRole('heading', { level: 2, name: 'Documents' })).toBeNull()
    expect(screen.queryByText('referral-letter.pdf')).toBeNull()
  })
})

/**
 * hid-system #51: a lab request's released Lab results, which Lab also serves
 * under an active emergency grant. Each read is audited, so it is made only when
 * asked for, and under the emergency purpose.
 */
describe('released Lab results in the emergency summary', () => {
  it('reads a lab request’s released results only when asked, under the emergency purpose', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    api.labReleasedResultsForOrder.mockResolvedValue({ workItemId: 'work-item-1', sourceEhrOrderId: 'lab-2', sourceEhrOrderVersion: 1,
      patientId: PATIENT, acceptedAt: '2026-10-01T08:15:00.000Z', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, results: [] })
    await renderSummary()
    const request = within(section('Lab requests')).getByText('Haemoglobin').closest<HTMLElement>('.staff-list-item')!
    expect(api.labReleasedResultsForOrder).not.toHaveBeenCalled()
    within(request).getByRole('button', { name: 'View released results' }).click()
    expect(await within(request).findByText('No result released yet.')).toBeTruthy()
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith('facility-1', 'lab-2', 'emergency')
  })

  it('offers no released results without lab.result.released.read', async () => {
    await renderSummary()
    expect(screen.queryByRole('button', { name: 'View released results' })).toBeNull()
  })
})
