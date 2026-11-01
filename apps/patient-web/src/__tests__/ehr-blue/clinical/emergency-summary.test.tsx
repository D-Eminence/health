import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmergencyWorkspace } from '../../../ehr-blue/clinical/emergency/EmergencyWorkspace'
import { FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, renderPage } from './harness'

/**
 * emergency/summary: today's read-only emergency summary (staff/routes/Clinical.tsx EmergencySummary) in the redesign's
 * cards and plain words. The cases follow today's EmergencySummary tests, plus the states the page draws around it.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn(), emergencyRecords: vi.fn(),
  labReleasedResultsForOrder: vi.fn(), documentDownload: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../ehr-blue/clinical/sample/SampleWorkspace', () => ({
  SampleList: () => null, SampleCreate: () => null, SampleDetail: () => null,
}))

const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const EVERY_READ = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'ehr.note.read',
  'ehr.vital.read', 'ehr.diagnosis.read', 'ehr.prescription.read', 'ehr.lab-request.read', 'ehr.document.read']
const where = { encounterId: ENCOUNTER, facilityId: FACILITY_ID }
const encounter = (n: number) => ({ id: `encounter-${n}`, facilityId: FACILITY_ID, encounterType: 'emergency', status: 'completed',
  startedAt: '2026-10-01T08:00:00.000Z', endedAt: '2026-10-01T09:00:00.000Z' })
const note = (n: number) => ({ id: `note-${n}`, ...where, noteType: 'Triage', title: `Triage note ${n}`, status: 'signed', revisionNo: 1,
  content: 'Alert and oriented.\nNo distress.', signedAt: '2026-10-01T08:30:00.000Z' })
const diagnosis = (id: string, display: string, clinicalStatus: string, verificationStatus: string) => ({ id, ...where,
  codeSystem: 'ICD-10', code: 'X00', display, clinicalStatus, verificationStatus, onsetAt: null, abatementAt: null, notes: null })
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
    labRequests: [labRequest('lab-1', 'Blood film', 'cancelled'), labRequest('lab-2', 'Haemoglobin', 'active'), labRequest('lab-3', 'Malaria smear', 'draft')],
    documents: [documentRow('document-1', 'referral-letter.pdf')],
    limit: 100,
    ...overrides,
  }
}

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

const emergencyPatient = () => ({ ...activePatient('emergency'), lookup: { ...allowedLookup, authorization: { ...allowedLookup.authorization, breakGlass: true } } })

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [...EVERY_READ]
  staff.activePatient = emergencyPatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(emergencyPatient().lookup)
  api.emergencyRecords.mockResolvedValue(summary())
  api.consentStatus.mockResolvedValue({ writeAllowed: true })
})

afterEach(() => { vi.unstubAllEnvs() })

function open(rest = '/summary') {
  return renderPage(<EmergencyWorkspace />, 'emergency', rest)
}

async function renderSummary() {
  open()
  await screen.findByRole('heading', { level: 2, name: 'Finished visits' })
}

const banner = () => screen.queryByRole('region', { name: `Patient: ${PATIENT_NAME}` })
const LEDE = 'View only. This facility’s finished visits, signed notes, diagnoses, prescriptions, lab tests and documents that your role may see. Every view is reviewed.'
const VITALS_NOTICE = 'Vital signs aren’t shown here: a recorded value may have been corrected since.'

function section(name: string) {
  return screen.getByRole('heading', { level: 2, name }).closest<HTMLElement>('section')!
}

function entry(sectionName: string, text: string) {
  return within(section(sectionName)).getByText(text).closest<HTMLElement>('li')!
}

/** The names of a section's entries, in the order shown. */
function entries(name: string) {
  return Array.from(section(name).querySelectorAll(':scope > ul > li'))
    .map(item => item.firstElementChild?.firstChild?.textContent)
}

describe('the emergency summary page', () => {
  it('re-checks access under the emergency purpose, then reads the emergency records', async () => {
    await renderSummary()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'emergency')
    expect(api.emergencyRecords).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.emergencyRecords.mock.invocationCallOrder[0]!)
    expect(api.consentStatus).not.toHaveBeenCalled()
  })

  it('has the page heading, the patient banner with its emergency access, and today’s words', async () => {
    await renderSummary()
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
    const patient = banner()!
    expect(within(patient).getByText(PATIENT_NAME)).toBeTruthy()
    expect(patient.textContent).toContain(PATIENT_HID)
    expect(within(patient).getByText('Emergency access')).toBeTruthy()
    const lede = screen.getByText(/^View only\./)
    expect(lede.textContent).toMatch(new RegExp(`^${LEDE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Access ends at \\d\\d:\\d\\d\\.$`))
  })

  it('shows loading while it reads', async () => {
    let answer: (value: unknown) => void = () => {}
    api.emergencyRecords.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open()
    expect(await screen.findByRole('status', { name: 'Loading emergency summary' })).toBeTruthy()
    await act(async () => { answer(summary()) })
    expect(screen.queryByRole('status', { name: 'Loading emergency summary' })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Finished visits' })).toBeTruthy()
  })

  it('shows a failed read in an alert, with its words and a way to try again, and keeps the patient open', async () => {
    api.emergencyRecords.mockRejectedValue(new HidApiError(503, 'EHR is unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    open()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load the emergency summary')
    expect(alert.textContent).toContain('EHR is unavailable')
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(banner()).toBeTruthy()
    api.emergencyRecords.mockResolvedValue(summary())
    await act(async () => { fireEvent.click(within(alert).getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByRole('heading', { level: 2, name: 'Finished visits' })).toBeTruthy()
    expect(api.emergencyRecords).toHaveBeenCalledTimes(2)
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
  })

  it('falls back to a plain sentence for a failure without words', async () => {
    api.emergencyRecords.mockRejectedValue('offline')
    open()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load the emergency summary')
    expect(alert.textContent).toContain('Please try again.')
  })

  it('shows a refused summary read as it is', async () => {
    api.emergencyRecords.mockRejectedValue(new HidApiError(403, 'Emergency access is not permitted', { code: 'FORBIDDEN' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toContain('Emergency access is not permitted')
  })

  it.each([403, 404])('ends access when the re-check is refused with %s, and says so', async status => {
    api.lookupPatient.mockRejectedValue(new HidApiError(status, 'Patient access is not authorized'))
    open()
    const ended = await screen.findByRole('alert')
    expect(within(ended).getByText('Access to this patient ended')).toBeTruthy()
    expect(ended.textContent).toContain('Patient access has ended. Reopen the record through governed access.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.emergencyRecords).not.toHaveBeenCalled()
    expect(banner()).toBeNull()
  })

  it('keeps the patient open when Identity cannot answer the re-check', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(503, 'Identity is unavailable'))
    open()
    expect((await screen.findByRole('alert')).textContent).toContain('Identity is unavailable')
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(api.emergencyRecords).not.toHaveBeenCalled()
  })

  it('without an emergency patient open, shows the no-patient state and reads nothing', async () => {
    staff.activePatient = null
    open()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to patient access →' }).getAttribute('href')).toBe('/provider/patients')
    await act(async () => {})
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(api.emergencyRecords).not.toHaveBeenCalled()
  })

  it('with a patient open in direct care, says no patient is open with emergency access and reads no emergency records', async () => {
    staff.activePatient = activePatient('direct-care')
    open()
    expect(screen.getByText('No patient open with emergency access')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Emergency access' }).getAttribute('href')).toBe('/provider/emergency')
    await act(async () => {})
    expect(api.emergencyRecords).not.toHaveBeenCalled()
    expect(banner()).toBeNull()
  })

  it('reads again on Refresh, which stays focused and busy while it reads', async () => {
    await renderSummary()
    let answer: (value: unknown) => void = () => {}
    api.emergencyRecords.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    refresh.focus()
    await act(async () => { fireEvent.click(refresh) })
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(refresh)
    await act(async () => { fireEvent.click(refresh) })
    expect(api.emergencyRecords).toHaveBeenCalledTimes(2)
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
    await act(async () => { answer(summary()) })
    expect(refresh.getAttribute('aria-disabled')).toBeNull()
    expect(document.activeElement).toBe(refresh)
  })

  it('leads to Find a patient', async () => {
    await renderSummary()
    fireEvent.click(screen.getByRole('link', { name: 'Find another patient' }))
    expect(screen.getByTestId('elsewhere').textContent).toBe('/provider/patients')
  })

  it('names the tab after the workspace, never the patient', async () => {
    document.title = ''
    await renderSummary()
    expect(document.title).toBe('Emergency · Health ID EHR')
    for (const value of [PATIENT_NAME, PATIENT_HID, PATIENT_ID]) expect(document.title).not.toContain(value)
  })

  it('goes back to Emergency access from its back arrow', async () => {
    await renderSummary()
    fireEvent.click(screen.getByRole('link', { name: 'Back to emergency access' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeTruthy()
  })
})

describe('the summary is read-only', () => {
  it('offers no control that creates, changes, signs or sends anything', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read', 'ehr.note.write', 'ehr.prescription.write', 'ehr.lab-request.write']
    await renderSummary()
    const names = screen.getAllByRole('button').map(button => button.textContent)
    for (const name of names) expect(['Refresh', 'End emergency access', 'Show results']).toContain(name)
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryAllByRole('combobox')).toEqual([])
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(document.querySelector('form')).toBeNull()
    expect(screen.getAllByRole('link')).toEqual([
      screen.getByRole('link', { name: 'Back to emergency access' }), screen.getByRole('link', { name: 'Find another patient' }),
    ])
  })
})

describe('ending my emergency access', () => {
  /** Presses "End emergency access": as today, it ends at once, with no question in between. */
  async function end() {
    const button = screen.getByRole('button', { name: 'End emergency access' })
    button.focus()
    await act(async () => { fireEvent.click(button) })
    return button
  }

  it('ends the grant at once, as today: no dialog stands between the clinician and the close', async () => {
    await renderSummary()
    await end()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
  })

  it('closes the grant once, with today’s reason, closes the patient and says so', async () => {
    let answer: (value: unknown) => void = () => {}
    api.closeGrant.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await renderSummary()
    const button = screen.getByRole('button', { name: 'End emergency access' })
    await act(async () => { fireEvent.click(button); fireEvent.click(button) })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { fireEvent.click(button) })
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(api.closeGrant).toHaveBeenCalledWith(FACILITY_ID, 'grant-1', 'Clinician closed completed patient access')
    await act(async () => { answer({ consentGrantId: 'grant-1', status: 'closed' }) })
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    const said = await screen.findByText('Your access has ended.')
    expect(said.closest('[role="status"]')).toBeTruthy()
    expect(document.activeElement).toBe(said)
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
  })

  it('shows a refused close and keeps the patient open', async () => {
    api.closeGrant.mockRejectedValue(new HidApiError(409, 'This access had already ended', { code: 'CONSENT_COMMAND_CONFLICT' }))
    await renderSummary()
    const button = await end()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t end access')
    expect(alert.textContent).toContain('This access had already ended')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-disabled')).toBeNull()
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(banner()).toBeTruthy()
  })

  it('falls back to a plain sentence when a refused close has no words', async () => {
    api.closeGrant.mockRejectedValue('offline')
    await renderSummary()
    await end()
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t end your access. Please try again.')
  })

  it('is not offered without a grant to close', async () => {
    staff.activePatient = { ...emergencyPatient(), lookup: { ...allowedLookup, authorization: { ...allowedLookup.authorization, consentGrantId: null } } }
    await renderSummary()
    expect(screen.queryByRole('button', { name: 'End emergency access' })).toBeNull()
  })

  it('is disabled, with the reason, without identity.consent.write', async () => {
    staff.permissions = EVERY_READ.filter(permission => permission !== 'identity.consent.write')
    await renderSummary()
    const button = screen.getByRole('button', { name: 'End emergency access' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Your role at this facility cannot end your access: it needs identity.consent.write. Ask your organization administrator.')
    fireEvent.click(button)
    expect(api.closeGrant).not.toHaveBeenCalled()
  })
})

describe('the emergency summary shows every section EHR returns that the role may read', () => {
  it('shows diagnoses, prescriptions, lab tests and documents alongside finished visits and notes', async () => {
    await renderSummary()
    for (const name of ['Finished visits', 'Signed notes', 'Diagnoses', 'Prescriptions', 'Lab tests', 'Documents']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
    expect(entry('Finished visits', 'Emergency').textContent).toMatch(/\d{4}, \d\d:\d\d to \d/)
    const signed = entry('Signed notes', 'Triage note 1')
    expect(signed.textContent).toMatch(/Triage · version 1 · signed \d/)
    expect(signed.textContent).toContain('Alert and oriented.\nNo distress.')
    expect(within(section('Diagnoses')).getByText('Severe malaria')).toBeTruthy()
    expect(entry('Diagnoses', 'Severe malaria').textContent).toContain('Active · Confirmed · code X00')
    expect(within(section('Prescriptions')).getByText('Artesunate')).toBeTruthy()
    const lab = entry('Lab tests', 'Haemoglobin')
    expect(within(lab).getByText('Urgent')).toBeTruthy()
    expect(lab.textContent).toMatch(/Asked for \d/)
    expect(entry('Documents', 'referral-letter.pdf').textContent).toMatch(/PDF · 20 KB · added \d/)
  })

  it.each([
    ['ehr.diagnosis.read', 'Diagnoses', 'Severe malaria'],
    ['ehr.prescription.read', 'Prescriptions', 'Artesunate'],
    ['ehr.lab-request.read', 'Lab tests', 'Haemoglobin'],
    ['ehr.document.read', 'Documents', 'referral-letter.pdf'],
  ])('without %s the role sees no %s section, though the server sent it', async (permission, name, shown) => {
    staff.permissions = EVERY_READ.filter(item => item !== permission)
    await renderSummary()
    expect(screen.queryByRole('heading', { level: 2, name })).toBeNull()
    expect(screen.queryByText(shown)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Signed notes' })).toBeTruthy()
  })

  it('puts current entries first and labels entered-in-error, ruled-out and cancelled ones', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ diagnoses: [
      diagnosis('diagnosis-1', 'Recorded against the wrong patient', 'active', 'entered_in_error'),
      diagnosis('diagnosis-4', 'Ruled out typhoid', 'active', 'refuted'),
      diagnosis('diagnosis-2', 'Old fracture', 'resolved', 'confirmed'),
      diagnosis('diagnosis-3', 'Severe malaria', 'active', 'confirmed'),
    ] }))
    await renderSummary()
    expect(entries('Diagnoses')).toEqual(['Severe malaria', 'Old fracture', 'Ruled out typhoid', 'Recorded against the wrong patient'])
    expect(entries('Prescriptions')).toEqual(['Artesunate', 'Paracetamol', 'Wrong drug'])
    expect(entries('Lab tests')).toEqual(['Haemoglobin', 'Malaria smear', 'Blood film'])
    const wrongDiagnosis = entry('Diagnoses', 'Recorded against the wrong patient')
    expect(within(wrongDiagnosis).getAllByText('Entered in error').length).toBeGreaterThan(0)
    expect(wrongDiagnosis.textContent).toContain('Recorded in error: not a diagnosis of this patient.')
    expect(within(entry('Diagnoses', 'Ruled out typhoid')).getByText('Ruled out')).toBeTruthy()
    const wrongDrug = entry('Prescriptions', 'Wrong drug')
    expect(within(wrongDrug).getByText('Entered in error')).toBeTruthy()
    expect(wrongDrug.textContent).toContain('Recorded in error: not a prescription for this patient.')
    expect(within(entry('Prescriptions', 'Paracetamol')).getByText('Cancelled')).toBeTruthy()
    expect(within(entry('Lab tests', 'Blood film')).getByText('Cancelled')).toBeTruthy()
    expect(within(entry('Lab tests', 'Malaria smear')).getByText('Draft')).toBeTruthy()
  })

  it('says a lab test entered in error is not this patient’s', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ labRequests: [labRequest('lab-9', 'Wrong test', 'entered_in_error')] }))
    await renderSummary()
    expect(entry('Lab tests', 'Wrong test').textContent).toContain('Recorded in error: not a test for this patient.')
  })

  it('shows a prescription’s dose with its unit, route, frequency and instructions, and says what was not recorded', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [
      prescription('prescription-3', 'Artesunate', 'active'),
      { ...prescription('prescription-4', 'Oral rehydration salts', 'active'), doseQuantity: null, routeCode: null },
    ] }))
    await renderSummary()
    const item = entry('Prescriptions', 'Artesunate')
    expect(item.textContent).toMatch(/Dose\s*500\s*mg\s*· route oral · Twice daily/)
    expect(item.textContent).toContain('Take with food')
    expect(entry('Prescriptions', 'Oral rehydration salts').textContent).toMatch(/Dose not recorded\s*· route not recorded · Twice daily/)
  })

  it.each([
    ['in UTC', '2026-10-12T00:00:00.000Z', '2026-10-19T00:00:00.000Z'],
    ['an hour east of UTC (Africa/Lagos)', '2026-10-11T23:00:00.000Z', '2026-10-18T23:00:00.000Z'],
    ['five hours west of UTC', '2026-10-12T05:00:00.000Z', '2026-10-19T05:00:00.000Z'],
    ['as plain dates', '2026-10-12', '2026-10-19'],
  ])('shows the calendar days a prescription runs, sent from a service %s', async (_where, startsOn, endsOn) => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [{ ...prescription('prescription-3', 'Artesunate', 'active'), startsOn, endsOn }] }))
    await renderSummary()
    const item = entry('Prescriptions', 'Artesunate')
    expect(within(item).getByText(/^Starts/).textContent).toBe('Starts 12 Oct 2026 · Ends 19 Oct 2026')
    expect(item.textContent).not.toMatch(/T\d\d:\d\d|Z\b/)
  })

  it('shows a prescription with only a start date, and one with neither, without inventing the other', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [
      { ...prescription('prescription-3', 'Artesunate', 'active'), startsOn: '2026-10-12T00:00:00.000Z' },
      prescription('prescription-1', 'Paracetamol', 'active'),
    ] }))
    await renderSummary()
    expect(within(entry('Prescriptions', 'Artesunate')).getByText(/^Starts/).textContent).toBe('Starts 12 Oct 2026')
    expect(within(entry('Prescriptions', 'Paracetamol')).queryByText(/Starts|Ends/)).toBeNull()
  })

  it('lists documents without offering to open, download or extract any', async () => {
    await renderSummary()
    const documents = section('Documents')
    expect(within(documents).queryAllByRole('button')).toEqual([])
    expect(within(documents).queryAllByRole('link')).toEqual([])
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
    expect(documents.textContent).toContain('Listed only: documents can’t be opened here, and they may not have been checked for viruses.')
    expect(api.documentDownload).not.toHaveBeenCalled()
  })

  it('shows no vital signs, and says why', async () => {
    await renderSummary()
    expect(screen.queryByRole('heading', { name: /Vital/ })).toBeNull()
    for (const value of ['131', '88/52', '39.4', '91.00']) expect(document.body.textContent).not.toContain(value)
    expect(screen.getByText(VITALS_NOTICE)).toBeTruthy()
  })

  it.each([
    ['encounters', 'Finished visits', 'No finished visits at this facility.'],
    ['notes', 'Signed notes', 'No signed notes at this facility.'],
    ['diagnoses', 'Diagnoses', 'No diagnoses at this facility.'],
    ['prescriptions', 'Prescriptions', 'No prescriptions at this facility.'],
    ['labRequests', 'Lab tests', 'No lab tests at this facility.'],
    ['documents', 'Documents', 'No documents at this facility.'],
  ])('says when %s holds nothing', async (key, title, empty) => {
    api.emergencyRecords.mockResolvedValue(summary({ [key]: [] }))
    await renderSummary()
    expect(within(section(title)).getByText(empty)).toBeTruthy()
  })
})

describe('each section says when the backend cut it short', () => {
  it('flags finished visits and notes at their cap of 50, though the summary reports a limit of 100', async () => {
    api.emergencyRecords.mockResolvedValue(summary({
      encounters: Array.from({ length: 50 }, (_, n) => encounter(n)), notes: Array.from({ length: 50 }, (_, n) => note(n)),
    }))
    await renderSummary()
    expect(within(section('Finished visits')).getByText('Only the 50 most recent are shown.')).toBeTruthy()
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
  })

  it('shows a section the server left out as unavailable, not as empty', async () => {
    const older = summary()
    delete (older as Record<string, unknown>).diagnoses
    api.emergencyRecords.mockResolvedValue(older)
    await renderSummary()
    expect(within(section('Diagnoses')).getByText('Diagnoses aren’t available in this summary.')).toBeTruthy()
    expect(within(section('Diagnoses')).queryByText(/No diagnoses/)).toBeNull()
  })
})

describe('a summary that names what EHR withheld and what it cut short', () => {
  it('never calls a withheld section empty, though the role may read it here', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary(['diagnoses']))
    await renderSummary()
    expect(screen.queryByText('No diagnoses at this facility.')).toBeNull()
    expect(within(section('Diagnoses')).getByText('Diagnoses aren’t shared with your role here.')).toBeTruthy()
    api.emergencyRecords.mockResolvedValue(releasedSummary([], {}, { prescriptions: [] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    expect(await within(section('Prescriptions')).findByText('No prescriptions at this facility.')).toBeTruthy()
  })

  it('says a section was cut short only when EHR says so', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary([], { notes: true }, {
      encounters: Array.from({ length: 50 }, (_, n) => encounter(n)),
      notes: Array.from({ length: 50 }, (_, n) => note(n)),
      prescriptions: Array.from({ length: 100 }, (_, n) => prescription(`prescription-${n}`, `Medicine ${n}`, 'active')),
    }))
    await renderSummary()
    expect(within(section('Prescriptions')).queryByText(/most recent/)).toBeNull()
    expect(within(section('Finished visits')).queryByText(/most recent/)).toBeNull()
    expect(within(section('Signed notes')).getByText('Only the 50 most recent are shown.')).toBeTruthy()
  })

  it('says a section with fewer rows than its limit was cut short when EHR says so', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary([], { diagnoses: true }))
    await renderSummary()
    expect(within(section('Diagnoses')).getByText(/100 most recent/)).toBeTruthy()
  })

  it('says listed documents passed the virus check', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary())
    await renderSummary()
    const documents = section('Documents')
    expect(documents.textContent).not.toMatch(/may not have been checked for viruses/)
    expect(documents.textContent).toContain('Listed only: documents can’t be opened here. Only files that passed the virus check are listed.')
    expect(within(documents).queryAllByRole('button')).toEqual([])
  })

  it('says nothing about vital signs when EHR withheld them', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary(['vitals']))
    await renderSummary()
    expect(screen.queryByText(VITALS_NOTICE)).toBeNull()
  })

  it('still explains the vital signs it does not show when EHR released them', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary())
    await renderSummary()
    expect(screen.getByText(VITALS_NOTICE)).toBeTruthy()
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

describe('released Lab results in the emergency summary', () => {
  const released = (results: unknown[] = []) => ({ workItemId: 'work-item-1', sourceEhrOrderId: 'lab-2', sourceEhrOrderVersion: 1,
    patientId: PATIENT_ID, acceptedAt: '2026-10-01T08:15:00.000Z', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, results })

  it('reads a lab test’s released results only when asked, under the emergency purpose', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    api.labReleasedResultsForOrder.mockResolvedValue(released())
    await renderSummary()
    const request = entry('Lab tests', 'Haemoglobin')
    expect(api.labReleasedResultsForOrder).not.toHaveBeenCalled()
    const view = within(request).getByRole('button', { name: 'Show results' })
    expect(view.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { fireEvent.click(view) })
    expect(await within(request).findByText('No results released yet.')).toBeTruthy()
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith(FACILITY_ID, 'lab-2', 'emergency')
    expect(within(request).getByRole('button', { name: 'Hide results' }).getAttribute('aria-expanded')).toBe('true')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'Refresh' })) })
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(2)
  })

  it('shows each released result and its versions, with the flag in words, and one marked entered in error', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    const revision = (version: number) => ({ version, resultType: 'numeric', numericValue: 9.1, textValue: null, unit: 'g/dL', referenceRange: '12-16',
      abnormalFlag: 'low', entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-10-01T09:00:00.000Z',
      releasedAt: '2026-10-01T09:30:00.000Z', correctionReason: version > 1 ? 'Recalibrated analyser' : null })
    api.labReleasedResultsForOrder.mockResolvedValue(released([
      { id: 'result-1', executionId: 'execution-1', status: 'released', verificationStatus: 'verified', currentVersion: 3, currentReleasedVersion: 3, revisions: [revision(1), revision(3)] },
      { id: 'result-2', executionId: 'execution-1', status: 'entered_in_error', verificationStatus: 'entered_in_error', currentVersion: 1, currentReleasedVersion: 1, revisions: [revision(1)] },
    ]))
    await renderSummary()
    const request = entry('Lab tests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'Show results' })) })
    expect(await within(request).findByText('Result 1')).toBeTruthy()
    expect(request.textContent).toContain('Haemoglobin · accepted by the lab ')
    expect(request.textContent).toMatch(/9\.1\s*g\/dL\s*Low/)
    expect(request.textContent).toContain('Normal range: 12-16')
    expect(request.textContent).toContain('Why it changed: Recalibrated analyser')
    expect(request.textContent).toContain('Versions that were never released are not shown.')
    expect(request.textContent).toContain('The latest version was marked entered in error. Don’t use it.')
  })

  it('says why released results could not be read', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    api.labReleasedResultsForOrder.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'LAB_WORK_ITEM_NOT_FOUND' }))
    await renderSummary()
    const request = entry('Lab tests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'Show results' })) })
    await waitFor(() => expect(within(request).getByRole('alert').textContent).toContain('The lab hasn’t taken this test here yet, or your access doesn’t cover it.'))
  })

  it('offers no released results for a draft, or without lab.result.released.read', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    const first = open()
    await screen.findByRole('heading', { level: 2, name: 'Lab tests' })
    expect(within(entry('Lab tests', 'Malaria smear')).queryByRole('button')).toBeNull()
    first.unmount()
    staff.permissions = [...EVERY_READ]
    await renderSummary()
    expect(screen.queryByRole('button', { name: 'Show results' })).toBeNull()
  })
})
