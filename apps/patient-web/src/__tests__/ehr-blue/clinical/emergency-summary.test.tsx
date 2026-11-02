import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmergencyWorkspace } from '../../../ehr-blue/clinical/emergency/EmergencyWorkspace'
import { TONE_OUTLINE } from '../../../kasuwa/ui'
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
  await screen.findByRole('heading', { level: 2, name: 'Completed encounters' })
}

const banner = () => screen.queryByRole('region', { name: `Patient: ${PATIENT_NAME}` })
const LEDE = 'This read-only summary holds this facility’s completed encounters and signed clinical notes, and the diagnoses, prescriptions, lab requests and documents your role may read. The server checks the active emergency grant on each request.'
const VITALS_NOTICE = 'Vital signs are not shown in this summary. EHR sends them as first recorded, without later corrections, so a value here could be one a clinician has since corrected.'

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

  it('has the page heading, the patient banner with its emergency access, and today’s words (Clinical.tsx:1109-1110)', async () => {
    await renderSummary()
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
    const patient = banner()!
    expect(within(patient).getByText(PATIENT_NAME)).toBeTruthy()
    expect(patient.textContent).toContain(PATIENT_HID)
    expect(within(patient).getByText('Emergency access')).toBeTruthy()
    expect(screen.getByText('Emergency record · audited access')).toBeTruthy()
    const lede = screen.getByText(/^This read-only summary/)
    expect(lede.textContent).toMatch(new RegExp(`^${LEDE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Access ends at \\d\\d:\\d\\d\\.$`))
  })

  it('shows loading while it reads', async () => {
    let answer: (value: unknown) => void = () => {}
    api.emergencyRecords.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open()
    expect(await screen.findByRole('status', { name: 'Loading emergency summary' })).toBeTruthy()
    await act(async () => { answer(summary()) })
    expect(screen.queryByRole('status', { name: 'Loading emergency summary' })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Completed encounters' })).toBeTruthy()
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
    expect(await screen.findByRole('heading', { level: 2, name: 'Completed encounters' })).toBeTruthy()
    expect(api.emergencyRecords).toHaveBeenCalledTimes(2)
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
  })

  it('falls back to a plain sentence for a failure without words', async () => {
    api.emergencyRecords.mockRejectedValue('offline')
    open()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load the emergency summary')
    expect(alert.textContent).toContain('Emergency records could not be loaded.')
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
    expect(ended.textContent).toContain('Open the patient again to keep working.')
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
    expect(screen.getByRole('link', { name: 'Find a patient' }).getAttribute('href')).toBe('/provider/patients')
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

  it('leads to Find a patient', async () => {
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
    for (const name of names) expect(['Refresh summary', 'Close my grant', 'View released results']).toContain(name)
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryAllByRole('combobox')).toEqual([])
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(document.querySelector('form')).toBeNull()
    expect(screen.getAllByRole('link')).toEqual([
      screen.getByRole('link', { name: 'Back to emergency access' }), screen.getByRole('link', { name: 'Change patient →' }),
    ])
  })
})

describe('ending my emergency access', () => {
  /** Presses "Close my grant": as today, it ends at once, with no question in between. */
  async function end() {
    const button = screen.getByRole('button', { name: 'Close my grant' })
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
    const button = screen.getByRole('button', { name: 'Close my grant' })
    await act(async () => { fireEvent.click(button); fireEvent.click(button) })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { fireEvent.click(button) })
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(api.closeGrant).toHaveBeenCalledWith(FACILITY_ID, 'grant-1', 'Clinician closed completed patient access')
    await act(async () => { answer({ consentGrantId: 'grant-1', status: 'closed' }) })
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    const said = await screen.findByText('Access was closed.')
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
    expect((await screen.findByRole('alert')).textContent).toContain('Grant could not be closed.')
  })

  it('is not offered without a grant to close', async () => {
    staff.activePatient = { ...emergencyPatient(), lookup: { ...allowedLookup, authorization: { ...allowedLookup.authorization, consentGrantId: null } } }
    await renderSummary()
    expect(screen.queryByRole('button', { name: 'Close my grant' })).toBeNull()
  })

  it('is disabled, with the reason, without identity.consent.write', async () => {
    staff.permissions = EVERY_READ.filter(permission => permission !== 'identity.consent.write')
    await renderSummary()
    const button = screen.getByRole('button', { name: 'Close my grant' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Your role at this facility cannot close this grant: it needs identity.consent.write. Ask your organization administrator.')
    fireEvent.click(button)
    expect(api.closeGrant).not.toHaveBeenCalled()
  })
})

describe('the emergency summary shows every section EHR returns that the role may read', () => {
  it('shows diagnoses, prescriptions, lab requests and documents alongside completed encounters and notes', async () => {
    await renderSummary()
    for (const name of ['Completed encounters', 'Signed notes', 'Diagnoses', 'Prescriptions', 'Lab requests', 'Documents']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
    expect(entry('Completed encounters', 'Emergency').textContent).toMatch(/Started \d.*\d{4}, \d\d:\d\dEnded \d/)
    const signed = entry('Signed notes', 'Triage note 1')
    expect(signed.textContent).toContain('Triage · signed · revision 1')
    expect(within(signed).getByText(/^Signed \d/)).toBeTruthy()
    expect(signed.textContent).toContain('Alert and oriented.\nNo distress.')
    expect(within(section('Diagnoses')).getByText('Severe malaria')).toBeTruthy()
    expect(entry('Diagnoses', 'Severe malaria').textContent).toContain('ICD-10 X00 · active · confirmed')
    expect(within(section('Prescriptions')).getByText('Artesunate')).toBeTruthy()
    const lab = entry('Lab requests', 'Haemoglobin')
    expect(within(lab).getByText('Urgent')).toBeTruthy()
    expect(lab.textContent).toMatch(/LOINC 718-7 · urgent priority · Requested \d/)
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
      diagnosis('diagnosis-4', 'Typhoid fever', 'active', 'refuted'),
      diagnosis('diagnosis-2', 'Old fracture', 'resolved', 'confirmed'),
      diagnosis('diagnosis-3', 'Severe malaria', 'active', 'confirmed'),
    ] }))
    await renderSummary()
    expect(entries('Diagnoses')).toEqual(['Severe malaria', 'Old fracture', 'Typhoid fever', 'Recorded against the wrong patient'])
    expect(entries('Prescriptions')).toEqual(['Artesunate', 'Paracetamol', 'Wrong drug'])
    expect(entries('Lab requests')).toEqual(['Haemoglobin', 'Malaria smear', 'Blood film'])
    const wrongDiagnosis = entry('Diagnoses', 'Recorded against the wrong patient')
    expect(within(wrongDiagnosis).getAllByText('Entered in error').length).toBeGreaterThan(0)
    expect(wrongDiagnosis.textContent).toContain('Recorded in error: not a diagnosis of this patient.')
    expect(within(entry('Diagnoses', 'Typhoid fever')).getByText('Refuted')).toBeTruthy()
    const wrongDrug = entry('Prescriptions', 'Wrong drug')
    expect(within(wrongDrug).getByText('Entered in error')).toBeTruthy()
    expect(wrongDrug.textContent).toContain('Recorded in error: not a prescription for this patient.')
    expect(within(entry('Prescriptions', 'Paracetamol')).getByText('Cancelled')).toBeTruthy()
    expect(within(entry('Lab requests', 'Blood film')).getByText('Cancelled')).toBeTruthy()
    expect(within(entry('Lab requests', 'Malaria smear')).getByText('Draft')).toBeTruthy()
  })

  it('gives each order status today’s tone: active success, on hold a warning, draft information (Clinical.tsx:1006-1013)', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [
      prescription('prescription-3', 'Artesunate', 'active'),
      prescription('prescription-5', 'Ceftriaxone', 'on_hold'),
      prescription('prescription-1', 'Paracetamol', 'cancelled'),
    ] }))
    await renderSummary()
    const badge = (sectionName: string, name: string, status: string) => within(entry(sectionName, name)).getByText(status)
    expect(badge('Prescriptions', 'Artesunate', 'Active').className).toContain(TONE_OUTLINE.success)
    expect(badge('Prescriptions', 'Ceftriaxone', 'On hold').className).toContain(TONE_OUTLINE.warn)
    expect(badge('Prescriptions', 'Paracetamol', 'Cancelled').className).toContain(TONE_OUTLINE.neutral)
    expect(badge('Lab requests', 'Malaria smear', 'Draft').className).toContain(TONE_OUTLINE.info)
  })

  it('says a note was amended, a diagnosis’s code system, and a lab test’s code and priority, routine too (Clinical.tsx:1130,1141,1158)', async () => {
    api.emergencyRecords.mockResolvedValue(summary({
      notes: [{ ...note(2), status: 'amended', revisionNo: 2 }],
      diagnoses: [{ ...diagnosis('diagnosis-5', 'Sepsis', 'active', 'provisional'), codeSystem: 'SNOMED', code: '91302008' }],
      labRequests: [{ ...labRequest('lab-4', 'Blood culture', 'active'), testCodeSystem: 'LOINC', testCode: '600-7', priority: 'routine' }],
    }))
    await renderSummary()
    expect(entry('Signed notes', 'Triage note 2').textContent).toContain('Triage · amended · revision 2')
    expect(entry('Diagnoses', 'Sepsis').textContent).toContain('SNOMED 91302008 · active · provisional')
    const lab = entry('Lab requests', 'Blood culture')
    expect(lab.textContent).toMatch(/LOINC 600-7 · routine priority · Requested \d/)
    expect(within(lab).queryByText('Routine')).toBeNull()
  })

  it('says a lab request entered in error is not this patient’s', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ labRequests: [labRequest('lab-9', 'Wrong test', 'entered_in_error')] }))
    await renderSummary()
    expect(entry('Lab requests', 'Wrong test').textContent).toContain('Recorded in error: not a request for this patient.')
  })

  it('shows a prescription’s dose with its unit, route, frequency and instructions, and says what was not recorded', async () => {
    api.emergencyRecords.mockResolvedValue(summary({ prescriptions: [
      prescription('prescription-3', 'Artesunate', 'active'),
      { ...prescription('prescription-4', 'Oral rehydration salts', 'active'), doseQuantity: null, routeCode: null },
    ] }))
    await renderSummary()
    const item = entry('Prescriptions', 'Artesunate')
    expect(item.textContent).toMatch(/Dose\s*500\s*mg\s*· Route oral · Twice daily/)
    expect(item.textContent).toContain('Take with food')
    expect(entry('Prescriptions', 'Oral rehydration salts').textContent).toMatch(/Dose not recorded\s*· Route not recorded · Twice daily/)
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
    for (const value of ['131', '88/52', '39.4', '91.00']) expect(document.body.textContent).not.toContain(value)
    expect(screen.getByText(VITALS_NOTICE)).toBeTruthy()
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
  it('flags finished visits and notes at their cap of 50, though the summary reports a limit of 100', async () => {
    api.emergencyRecords.mockResolvedValue(summary({
      encounters: Array.from({ length: 50 }, (_, n) => encounter(n)), notes: Array.from({ length: 50 }, (_, n) => note(n)),
    }))
    await renderSummary()
    expect(within(section('Completed encounters')).getByText('Only the 50 most recent are shown.')).toBeTruthy()
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

  it('says older entries exist only when EHR reports the section cut short (Clinical.tsx:1070-1072)', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary([], { diagnoses: true }))
    await renderSummary()
    expect(within(section('Diagnoses')).getByText('Only the 100 most recent are shown; older ones exist and are not shown.')).toBeTruthy()
    api.emergencyRecords.mockResolvedValue(summary({ encounters: Array.from({ length: 50 }, (_, n) => encounter(n)) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh summary' })) })
    expect(await within(section('Completed encounters')).findByText('Only the 50 most recent are shown.')).toBeTruthy()
    expect(screen.queryByText(/older ones exist/)).toBeNull()
  })

  it('says listed documents passed the virus check', async () => {
    api.emergencyRecords.mockResolvedValue(releasedSummary())
    await renderSummary()
    const documents = section('Documents')
    expect(documents.textContent).not.toMatch(/may not have been checked for viruses/)
    expect(documents.textContent).toContain('Documents that passed the virus scan are listed for reference; they cannot be opened from this summary.')
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
    const request = entry('Lab requests', 'Haemoglobin')
    expect(api.labReleasedResultsForOrder).not.toHaveBeenCalled()
    const view = within(request).getByRole('button', { name: 'View released results' })
    expect(view.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { fireEvent.click(view) })
    expect(await within(request).findByText('No result released yet.')).toBeTruthy()
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith(FACILITY_ID, 'lab-2', 'emergency')
    expect(within(request).getByRole('button', { name: 'Hide released results' }).getAttribute('aria-expanded')).toBe('true')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'Refresh released results' })) })
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(2)
  })

  it('keeps Refresh focusable while the results are read again, says it is busy, and a press then reads nothing (Clinical.tsx:930-931)', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    api.labReleasedResultsForOrder.mockResolvedValue(released())
    await renderSummary()
    const request = entry('Lab requests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'View released results' })) })
    await within(request).findByText('No result released yet.')
    let answer: (value: unknown) => void = () => {}
    api.labReleasedResultsForOrder.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    const refresh = within(request).getByRole('button', { name: 'Refresh released results' }) as HTMLButtonElement
    refresh.focus()
    await act(async () => { fireEvent.click(refresh) })
    await waitFor(() => expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(2))
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    expect(refresh.disabled).toBe(false)
    expect(document.activeElement).toBe(refresh)
    await act(async () => { fireEvent.click(refresh) })
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(2)
    await act(async () => { answer(released()) })
    expect(await within(request).findByText('No result released yet.')).toBeTruthy()
    expect(refresh.getAttribute('aria-disabled')).toBeNull()
    expect(document.activeElement).toBe(refresh)
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
    const request = entry('Lab requests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'View released results' })) })
    expect(await within(request).findByText('Result 1')).toBeTruthy()
    expect(request.textContent).toContain('Haemoglobin · LOINC 718-7 · accepted by Lab ')
    expect(request.textContent).toMatch(/9\.1\s*g\/dL\s*Low/)
    expect(request.textContent).toContain('Reference range: 12-16')
    expect(request.textContent).toContain('Reason: Recalibrated analyser')
    expect(request.textContent).toContain('Version numbers skip revisions that were never released; those are not shown.')
    expect(request.textContent).toContain('The latest released version was marked entered in error: do not use it.')
  })

  it('says what Lab sent: the test’s code, Released on each released result, every flag in words and each version’s verification (Clinical.tsx:935,938, labRevisions.tsx:34-35)', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    const revision = (version: number, abnormalFlag: string, verificationStatus: string) => ({ version, resultType: 'numeric', numericValue: 9.1 + version,
      textValue: null, unit: 'g/dL', referenceRange: '12-16', abnormalFlag, entrySource: 'manual', verificationStatus, releaseStatus: 'released',
      enteredAt: '2026-10-01T09:00:00.000Z', releasedAt: '2026-10-01T09:30:00.000Z', correctionReason: null })
    api.labReleasedResultsForOrder.mockResolvedValue(released([
      { id: 'result-1', executionId: 'execution-1', status: 'released', verificationStatus: 'verified', currentVersion: 3, currentReleasedVersion: 3,
        revisions: [revision(1, 'normal', 'unverified'), revision(2, 'unknown', 'verified'), revision(3, 'critical_candidate', 'verified')] },
    ]))
    await renderSummary()
    const request = entry('Lab requests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'View released results' })) })
    expect(await within(request).findByText('Result 1')).toBeTruthy()
    expect(request.textContent).toContain('Haemoglobin · LOINC 718-7 · accepted by Lab ')
    const result = within(request).getByText('Result 1').closest('li')!
    expect(within(result).getByText('Result 1').parentElement!.textContent).toBe('Result 1Released')
    expect(result.textContent).toMatch(/10\.1\s*g\/dL\s*· normal/)
    expect(result.textContent).toMatch(/11\.1\s*g\/dL\s*· unknown/)
    // A critical candidate is not a confirmed critical value: it is said as Lab says it.
    expect(result.textContent).toMatch(/12\.1\s*g\/dL\s*· critical candidate/)
    expect(within(result).queryByText('Critical')).toBeNull()
    expect(result.textContent).toMatch(/Entered [^·]+ · unverified/)
    expect(result.textContent).toMatch(/Entered [^·]+ · verified/)
  })

  it('says why released results could not be read', async () => {
    staff.permissions = [...EVERY_READ, 'lab.result.released.read']
    api.labReleasedResultsForOrder.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'LAB_WORK_ITEM_NOT_FOUND' }))
    await renderSummary()
    const request = entry('Lab requests', 'Haemoglobin')
    await act(async () => { fireEvent.click(within(request).getByRole('button', { name: 'View released results' })) })
    await waitFor(() => expect(within(request).getByRole('alert').textContent).toContain('Lab has no work item for this request that you can see: Lab has not accepted it, accepted it at another facility, or your access to this patient does not cover it.'))
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
