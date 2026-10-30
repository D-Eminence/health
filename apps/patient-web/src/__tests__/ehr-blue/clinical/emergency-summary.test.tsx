import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmergencyWorkspace } from '../../../ehr-blue/clinical/emergency/EmergencyWorkspace'
import { FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, renderPage } from './harness'

/**
 * emergency/summary: today's read-only emergency summary (staff/routes/Clinical.tsx EmergencySummary) in the design's
 * detail style. The cases follow today's EmergencySummary tests, plus the states the page draws around it.
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
  await screen.findByRole('heading', { level: 2, name: 'Completed encounters' })
}

function section(name: string) {
  return screen.getByRole('heading', { level: 2, name }).closest<HTMLElement>('section')!
}

function entry(sectionName: string, text: string) {
  return within(section(sectionName)).getByText(text).closest<HTMLElement>('li')!
}

/** The names of a section's entries, in the order shown. */
function entries(name: string) {
  return Array.from(section(name).querySelectorAll('.hid-ehr-clinical-emergency-entry > .hid-ehr-clinical-emergency-entry-head > strong'))
    .map(item => item.textContent)
}

describe('the emergency summary page', () => {
  it('re-checks access under the emergency purpose, then reads the emergency records', async () => {
    await renderSummary()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'emergency')
    expect(api.emergencyRecords).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.emergencyRecords.mock.invocationCallOrder[0]!)
    expect(api.consentStatus).not.toHaveBeenCalled()
  })

  it('has the design’s record heading, the patient header with its flags, and today’s words', async () => {
    await renderSummary()
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
    const patient = screen.getByRole('region', { name: 'Patient' })
    expect(within(patient).getByRole('heading', { level: 2, name: PATIENT_NAME })).toBeTruthy()
    expect(patient.textContent).toContain(PATIENT_HID)
    const flags = within(patient).getByRole('group', { name: 'Flags' })
    expect(Array.from(flags.children).map(flag => flag.textContent)).toEqual(['Emergency access', 'Read only'])
    expect(screen.getByRole('heading', { level: 2, name: 'Emergency record · audited access' })).toBeTruthy()
    const lede = screen.getByText(/read-only summary/)
    expect(lede.textContent).toBe('This read-only summary holds this facility’s completed encounters and signed clinical notes, and the diagnoses, '
      + 'prescriptions, lab requests and documents your role may read. The server checks the active emergency grant on each request.')
    expect(screen.getByText(/^Grant expires /)).toBeTruthy()
  })

  it('shows loading while it reads', async () => {
    let answer: (value: unknown) => void = () => {}
    api.emergencyRecords.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open()
    expect(await screen.findByText('Loading emergency summary…')).toBeTruthy()
    expect(screen.getByText('Loading emergency summary…').getAttribute('role')).toBe('status')
    await act(async () => { answer(summary()) })
    expect(screen.queryByText('Loading emergency summary…')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Completed encounters' })).toBeTruthy()
  })

  it('shows a failed read in an alert, with today’s words, and keeps the patient open', async () => {
    api.emergencyRecords.mockRejectedValue(new HidApiError(503, 'EHR is unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable')
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Patient' })).toBeTruthy()
  })

  it('falls back to today’s sentence for a failure without words', async () => {
    api.emergencyRecords.mockRejectedValue('offline')
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('Emergency records could not be loaded.')
  })

  it('shows a refused summary read as it is', async () => {
    api.emergencyRecords.mockRejectedValue(new HidApiError(403, 'Emergency access is not permitted', { code: 'FORBIDDEN' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('Emergency access is not permitted')
  })

  it.each([403, 404])('ends access when the re-check is refused with %s, and says so', async status => {
    api.lookupPatient.mockRejectedValue(new HidApiError(status, 'Patient access is not authorized'))
    open()
    const ended = await screen.findByRole('alert')
    expect(within(ended).getByText('Access to this patient ended')).toBeTruthy()
    expect(ended.textContent).toContain('Patient access has ended. Reopen the record through governed access.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.emergencyRecords).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Patient' })).toBeNull()
  })

  it('keeps the patient open when Identity cannot answer the re-check', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(503, 'Identity is unavailable'))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('Identity is unavailable')
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(api.emergencyRecords).not.toHaveBeenCalled()
  })

  it('without an emergency patient open, shows the no-patient state and reads nothing', async () => {
    staff.activePatient = null
    open()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to patient access →' })).toBeTruthy()
    await act(async () => {})
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(api.emergencyRecords).not.toHaveBeenCalled()
  })

  it('with a patient open in direct care, shows the no-patient state and reads no emergency records', async () => {
    staff.activePatient = activePatient('direct-care')
    open()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    await act(async () => {})
    expect(api.emergencyRecords).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Patient' })).toBeNull()
  })

  it('reads again on Refresh summary, which stays focused and busy while it reads', async () => {
    await renderSummary()
    let answer: (value: unknown) => void = () => {}
    api.emergencyRecords.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const refresh = screen.getByRole('button', { name: 'Refresh summary' })
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

  it('leads back to the list and to patient access', async () => {
    await renderSummary()
    fireEvent.click(screen.getByRole('link', { name: 'Change patient →' }))
    expect(screen.getByTestId('elsewhere').textContent).toBe('/provider/patients')
  })

  it('names the tab after the workspace, never the patient', async () => {
    document.title = ''
    await renderSummary()
    expect(document.title).toBe('Emergency · Health ID EHR')
    for (const value of [PATIENT_NAME, PATIENT_HID, PATIENT_ID]) expect(document.title).not.toContain(value)
  })

  it('goes back to the Emergency list from Back to list', async () => {
    await renderSummary()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency' })).toBeTruthy()
  })
})

describe('the summary is read-only', () => {
  it('offers no control that creates, changes, signs or sends anything', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read', 'ehr.note.write', 'ehr.prescription.write', 'ehr.lab-request.write']
    await renderSummary()
    const names = screen.getAllByRole('button').map(button => button.textContent)
    for (const name of names) expect(['Back to list', 'Refresh summary', 'Close my grant', 'View released results']).toContain(name)
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryAllByRole('combobox')).toEqual([])
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(document.querySelector('form')).toBeNull()
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Change patient →'])
  })
})

describe('closing my grant', () => {
  const dialog = () => screen.getByRole('alertdialog', { name: 'Close my grant?' })
  /** Presses "Close my grant" on the page; the design's dialog asks first. */
  async function askToClose() {
    const close = screen.getByRole('button', { name: 'Close my grant' })
    close.focus()
    await act(async () => { fireEvent.click(close) })
    return close
  }
  async function confirm() {
    await act(async () => { fireEvent.click(within(dialog()).getByRole('button', { name: 'Close my grant' })) })
  }

  it('asks first, in the design’s dialog, and Cancel closes nothing', async () => {
    await renderSummary()
    const close = await askToClose()
    expect(within(dialog()).getByRole('heading', { level: 2, name: 'Close my grant?' })).toBeTruthy()
    expect(api.closeGrant).not.toHaveBeenCalled()
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    await act(async () => { fireEvent.click(cancel) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.closeGrant).not.toHaveBeenCalled()
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Patient' })).toBeTruthy()
    expect(document.activeElement).toBe(close)
  })

  it('closes the grant once on confirm, with today’s reason, closes the patient and says so', async () => {
    let answer: (value: unknown) => void = () => {}
    api.closeGrant.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await renderSummary()
    await askToClose()
    const yes = within(dialog()).getByRole('button', { name: 'Close my grant' })
    await act(async () => { fireEvent.click(yes); fireEvent.click(yes) })
    expect(yes.getAttribute('aria-busy')).toBe('true')
    await act(async () => { fireEvent.click(yes) })
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(api.closeGrant).toHaveBeenCalledWith(FACILITY_ID, 'grant-1', 'Clinician closed completed patient access')
    await act(async () => { answer({ consentGrantId: 'grant-1', status: 'closed' }) })
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const said = await screen.findByText('Access was closed by the backend.')
    expect(said.closest('[role="status"]')).toBeTruthy()
    expect(document.activeElement).toBe(said)
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
  })

  it('sends nothing more from the dialog opened again while the first close runs', async () => {
    let answer: (value: unknown) => void = () => {}
    api.closeGrant.mockReturnValue(new Promise(resolve => { answer = resolve }))
    await renderSummary()
    await askToClose()
    await confirm()
    await act(async () => { fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' })) })
    await askToClose()
    await confirm()
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    await act(async () => { answer({ consentGrantId: 'grant-1', status: 'closed' }) })
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Access was closed by the backend.')).toBeTruthy()
  })

  it('shows a refused close and keeps the patient open', async () => {
    api.closeGrant.mockRejectedValue(new HidApiError(409, 'This access had already ended', { code: 'CONSENT_COMMAND_CONFLICT' }))
    await renderSummary()
    const close = await askToClose()
    await confirm()
    expect((await screen.findByRole('alert')).textContent).toBe('This access had already ended')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(close)
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Patient' })).toBeTruthy()
  })

  it('falls back to today’s sentence when a refused close has no words', async () => {
    api.closeGrant.mockRejectedValue('offline')
    await renderSummary()
    await askToClose()
    await confirm()
    expect((await screen.findByRole('alert')).textContent).toBe('Grant could not be closed.')
  })

  it('is not offered without a grant to close', async () => {
    staff.activePatient = { ...emergencyPatient(), lookup: { ...allowedLookup, authorization: { ...allowedLookup.authorization, consentGrantId: null } } }
    await renderSummary()
    expect(screen.queryByRole('button', { name: 'Close my grant' })).toBeNull()
  })

  it('is disabled, with the reason, without identity.consent.write', async () => {
    staff.permissions = EVERY_READ.filter(permission => permission !== 'identity.consent.write')
    await renderSummary()
    const close = screen.getByRole('button', { name: 'Close my grant' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    expect(document.getElementById(close.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Your role at this facility cannot close this grant: it needs identity.consent.write. Ask your organization administrator.')
  })
})

describe('the emergency summary shows every section EHR returns that the role may read', () => {
  it('shows diagnoses, prescriptions, lab requests and documents alongside encounters and notes', async () => {
    await renderSummary()
    for (const name of ['Completed encounters', 'Signed notes', 'Diagnoses', 'Prescriptions', 'Lab requests', 'Documents']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
    expect(entry('Completed encounters', 'emergency').textContent).toMatch(/Started .*Ended /)
    const signed = entry('Signed notes', 'Triage note 1')
    expect(signed.textContent).toContain('Triage · signed · revision 1')
    expect(signed.textContent).toContain('Alert and oriented.\nNo distress.')
    expect(signed.textContent).toMatch(/Signed \d/)
    expect(within(section('Diagnoses')).getByText('Severe malaria')).toBeTruthy()
    expect(entry('Diagnoses', 'Severe malaria').textContent).toContain('ICD-10 X00 · active · confirmed')
    expect(within(section('Prescriptions')).getByText('Artesunate')).toBeTruthy()
    expect(entry('Lab requests', 'Haemoglobin').textContent).toContain('LOINC 718-7 · urgent priority · Requested ')
    expect(entry('Documents', 'referral-letter.pdf').textContent).toMatch(/application\/pdf · 20 KiB · Uploaded \d/)
  })

  it.each([
    ['ehr.diagnosis.read', 'Diagnoses', 'Severe malaria'],
    ['ehr.prescription.read', 'Prescriptions', 'Artesunate'],
    ['ehr.lab-request.read', 'Lab requests', 'Haemoglobin'],
    ['ehr.document.read', 'Documents', 'referral-letter.pdf'],
  ])('without %s the role sees no %s section, though the server sent it', async (permission, name, shown) => {
    staff.permissions = EVERY_READ.filter(item => item !== permission)
    await renderSummary()
    expect(screen.queryByRole('heading', { level: 2, name })).toBeNull()
    expect(screen.queryByText(shown)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Signed notes' })).toBeTruthy()
  })

  it('puts current entries first and labels entered-in-error, refuted and cancelled ones', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ diagnoses: [
      diagnosis('diagnosis-1', 'Recorded against the wrong patient', 'active', 'entered_in_error'),
      diagnosis('diagnosis-4', 'Ruled out typhoid', 'active', 'refuted'),
      diagnosis('diagnosis-2', 'Old fracture', 'resolved', 'confirmed'),
      diagnosis('diagnosis-3', 'Severe malaria', 'active', 'confirmed'),
    ] }))
    await renderSummary()
    expect(entries('Diagnoses')).toEqual(['Severe malaria', 'Old fracture', 'Ruled out typhoid', 'Recorded against the wrong patient'])
    expect(entries('Prescriptions')).toEqual(['Artesunate', 'Paracetamol', 'Wrong drug'])
    expect(entries('Lab requests')).toEqual(['Haemoglobin', 'Malaria smear', 'Blood film'])
    const wrongDiagnosis = entry('Diagnoses', 'Recorded against the wrong patient')
    expect(wrongDiagnosis.textContent).toContain('Entered in error')
    expect(wrongDiagnosis.textContent).toContain('Recorded in error: not a diagnosis of this patient.')
    expect(entry('Diagnoses', 'Ruled out typhoid').textContent).toContain('Refuted')
    const wrongDrug = entry('Prescriptions', 'Wrong drug')
    expect(wrongDrug.textContent).toContain('Entered in error')
    expect(wrongDrug.textContent).toContain('Recorded in error: not a prescription for this patient.')
    expect(entry('Prescriptions', 'Paracetamol').textContent).toContain('Cancelled')
    expect(entry('Lab requests', 'Blood film').textContent).toContain('Cancelled')
    expect(entry('Lab requests', 'Malaria smear').textContent).toContain('Draft')
  })

  it('says a lab request entered in error is not this patient’s', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ labRequests: [labRequest('lab-9', 'Wrong test', 'entered_in_error')] }))
    await renderSummary()
    expect(entry('Lab requests', 'Wrong test').textContent).toContain('Recorded in error: not a request for this patient.')
  })

  it('shows a prescription’s dose, route, frequency and instructions, and says what was not recorded', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [
      prescription('prescription-3', 'Artesunate', 'active'),
      { ...prescription('prescription-4', 'Oral rehydration salts', 'active'), doseQuantity: null, routeCode: null },
    ] }))
    await renderSummary()
    const item = entry('Prescriptions', 'Artesunate')
    expect(item.textContent).toContain('500 mg · Route oral · Twice daily')
    expect(item.textContent).toContain('Take with food')
    expect(entry('Prescriptions', 'Oral rehydration salts').textContent).toContain('Dose not recorded · Route not recorded · Twice daily')
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
    expect(documents.textContent).toContain('Uploaded documents are listed for reference. They cannot be opened from this summary, and their virus scan result is not included.')
    expect(api.documentDownload).not.toHaveBeenCalled()
  })

  it('shows no vital signs, and says why', async () => {
    await renderSummary()
    expect(screen.queryByRole('heading', { name: /Vital/ })).toBeNull()
    for (const value of ['131', '88/52', '39.4', '91']) expect(document.body.textContent).not.toContain(value)
    expect(screen.getByText(/Vital signs are not shown in this summary/).textContent)
      .toBe('Vital signs are not shown in this summary. EHR sends them as first recorded, without later corrections, so a value here could be one a clinician has since corrected.')
  })

  it.each([
    ['encounters', 'Completed encounters', 'No completed encounters are available from this facility.'],
    ['notes', 'Signed notes', 'No signed notes are available from this facility.'],
    ['diagnoses', 'Diagnoses', 'No diagnoses are available from this facility.'],
    ['prescriptions', 'Prescriptions', 'No prescriptions are available from this facility.'],
    ['labRequests', 'Lab requests', 'No lab requests are available from this facility.'],
    ['documents', 'Documents', 'No uploaded documents are available from this facility.'],
  ])('says when %s holds nothing', async (key, title, empty) => {
    api.emergencyRecords.mockResolvedValue(summary({ [key]: [] }))
    await renderSummary()
    expect(within(section(title)).getByText(empty)).toBeTruthy()
  })
})

describe('each section says when the backend cut it short', () => {
  it('flags encounters and notes at their cap of 50, though the summary reports a limit of 100', async () => {
    api.emergencyRecords.mockResolvedValue(summary({
      encounters: Array.from({ length: 50 }, (_, n) => encounter(n)), notes: Array.from({ length: 50 }, (_, n) => note(n)),
    }))
    await renderSummary()
    expect(within(section('Completed encounters')).getByText('The backend sends only the 50 most recent; older ones are not shown.')).toBeTruthy()
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
    expect(within(section('Diagnoses')).getByText('Diagnoses are not available in this summary.')).toBeTruthy()
    expect(within(section('Diagnoses')).queryByText(/No diagnoses/)).toBeNull()
  })
})

describe('a summary that names what EHR withheld and what it cut short', () => {
  it('never calls a withheld section empty, though the role may read it here', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary(['diagnoses']))
    await renderSummary()
    expect(screen.queryByText('No diagnoses are available from this facility.')).toBeNull()
    expect(within(section('Diagnoses')).getByText('Diagnoses are not included in this summary: EHR did not release them to your role at this facility.')).toBeTruthy()
    api.emergencyRecords.mockResolvedValue(releasedSummary([], {}, { prescriptions: [] }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh summary' })) })
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
    expect(within(section('Signed notes')).getByText('Only the 50 most recent are shown; older ones exist and are not shown.')).toBeTruthy()
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
    expect(documents.textContent).toContain('Documents that passed the virus scan are listed for reference; they cannot be opened from this summary.')
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

describe('released Lab results in the emergency summary', () => {
  const released = (results: unknown[] = []) => ({ workItemId: 'work-item-1', sourceEhrOrderId: 'lab-2', sourceEhrOrderVersion: 1,
    patientId: PATIENT_ID, acceptedAt: '2026-10-01T08:15:00.000Z', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, results })

  it('reads a lab request’s released results only when asked, under the emergency purpose', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    api.labReleasedResultsForOrder.mockResolvedValue(released())
    await renderSummary()
    const request = entry('Lab requests', 'Haemoglobin')
    expect(api.labReleasedResultsForOrder).not.toHaveBeenCalled()
    const view = within(request).getByRole('button', { name: 'View released results' })
    expect(view.getAttribute('aria-expanded')).toBe('false')
    // The design's 40px secondary button, not the small one.
    expect(view.className).toContain('hid-ehr-button-secondary')
    expect(view.className).not.toContain('hid-ehr-button-sm')
    await act(async () => { fireEvent.click(view) })
    expect(await within(request).findByText('No result released yet.')).toBeTruthy()
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith(FACILITY_ID, 'lab-2', 'emergency')
    expect(within(request).getByRole('button', { name: 'Hide released results' }).getAttribute('aria-expanded')).toBe('true')
    const refresh = within(request).getByRole('button', { name: 'Refresh released results' })
    expect(refresh.className).toContain('hid-ehr-button-secondary')
    expect(refresh.className).not.toMatch(/hid-ehr-button-(sm|quiet)/)
    await act(async () => { fireEvent.click(refresh) })
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(2)
  })

  it('shows each released result and its versions, and one marked entered in error', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    const revision = (version: number) => ({ version, resultType: 'numeric', numericValue: 9.1, textValue: null, unit: 'g/dL', referenceRange: '12-16',
      abnormalFlag: 'low', entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-10-01T09:00:00.000Z',
      releasedAt: '2026-10-01T09:30:00.000Z', correctionReason: version > 1 ? 'Recalibrated analyser' : null })
    api.labReleasedResultsForOrder.mockResolvedValue(released([
      { id: 'result-1', executionId: 'execution-1', status: 'released', verificationStatus: 'verified', currentVersion: 3, currentReleasedVersion: 3, revisions: [revision(1), revision(3)] },
      { id: 'result-2', executionId: 'execution-1', status: 'entered_in_error', verificationStatus: 'entered_in_error', currentVersion: 1, currentReleasedVersion: 1, revisions: [revision(1)] },
    ]))
    await renderSummary()
    const request = entry('Lab requests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'View released results' })) })
    expect(await within(request).findByText('Result 1')).toBeTruthy()
    expect(request.textContent).toContain('Haemoglobin · LOINC 718-7 · accepted by Lab ')
    expect(request.textContent).toContain('9.1 g/dL · low')
    expect(request.textContent).toContain('Reference range: 12-16')
    expect(request.textContent).toContain('Reason: Recalibrated analyser')
    expect(request.textContent).toContain('Version numbers skip revisions that were never released; those are not shown.')
    expect(request.textContent).toContain('The latest released version was marked entered in error: do not use it.')
  })

  it('says why released results could not be read', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    api.labReleasedResultsForOrder.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'LAB_WORK_ITEM_NOT_FOUND' }))
    await renderSummary()
    const request = entry('Lab requests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'View released results' })) })
    await waitFor(() => expect(within(request).getByRole('alert').textContent).toBe('Lab has no work item for this request that you can see: Lab has not accepted it, accepted it at another facility, or your access to this patient does not cover it.'))
  })

  it('offers no released results for a draft, or without lab.result.released.read', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    const first = open()
    await screen.findByRole('heading', { level: 2, name: 'Lab requests' })
    expect(within(entry('Lab requests', 'Malaria smear')).queryByRole('button')).toBeNull()
    first.unmount()
    staff.permissions = [...EVERY_READ]
    await renderSummary()
    expect(screen.queryByRole('button', { name: 'View released results' })).toBeNull()
  })
})
