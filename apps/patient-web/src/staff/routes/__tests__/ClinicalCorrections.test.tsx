import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Clinical } from '../Clinical'

/**
 * Corrections follow hid-system EHR (ehr/shared/clinical.dto.ts and the
 * diagnoses, vitals and lab-requests services): a diagnosis PATCH names only
 * clinicalStatus, verificationStatus, abatementAt and notes; a vital is never
 * edited, it gets an appended correction whose values the list must show as
 * current; and a lab request's status change is not passed to Lab, so only a
 * draft that Lab never received can be cancelled or marked entered in error.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), updateDiagnosis: vi.fn(), vitalCorrections: vi.fn(), correctVital: vi.fn(),
}))
const staff = vi.hoisted(() => ({ activePatient: null as unknown }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ehr.encounter.read', 'ehr.vital.read', 'ehr.vital.write', 'ehr.diagnosis.read',
        'ehr.diagnosis.write', 'ehr.lab-request.read', 'ehr.lab-request.write'],
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const base = { patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z' }
const diagnosis = { ...base, id: 'diagnosis-1', codeSystem: 'ICD-10', code: 'B54', display: 'Malaria',
  clinicalStatus: 'active', verificationStatus: 'provisional', notes: 'Fever for three days', rowVersion: '2' }
const vital = { ...base, id: 'vital-1', recordedAt: '2026-10-10T08:05:00.000Z', systolicMmhg: 120, diastolicMmhg: 80,
  pulseBpm: 72, temperatureC: '36.6', respiratoryRate: null, oxygenSaturationPercent: null, weightKg: null, heightCm: null,
  source: 'manual', currentCorrectionNo: 0, rowVersion: '1' }
const labRequest = { ...base, id: 'lab-1', testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin',
  priority: 'routine', status: 'draft', clinicalInformation: null, rowVersion: '1' }

let records: Record<string, unknown[]>

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  records = { vitals: [vital], diagnoses: [diagnosis], 'lab-requests': [labRequest] }
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1',
    encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async (_facility: string, _patient: string, _encounter: string, kind: string) =>
    ({ items: records[kind] ?? [], nextCursor: null }))
  api.updateDiagnosis.mockResolvedValue({ ...diagnosis, rowVersion: '3' })
  api.updateRecord.mockResolvedValue({ ...labRequest, rowVersion: '2' })
  api.correctVital.mockResolvedValue({ id: 'correction-1', vitalId: 'vital-1', correctionNo: 1 })
  api.vitalCorrections.mockResolvedValue([])
})

async function openTab(name: string) {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name }))
}

// A required field's label ends in a marker the reader does not hear.
function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }

function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

async function correctionForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Correct these vitals' }))
  return screen.getByRole('button', { name: 'Save correction' }).closest('form')!
}

function value(scope: HTMLElement, label: string) {
  return (within(scope).getByLabelText(labelled(label)) as HTMLInputElement).value
}

describe('changing a diagnosis', () => {
  async function diagnosisForm() {
    await openTab('Diagnoses')
    return (await screen.findByRole('button', { name: 'Update diagnosis' })).closest('form')!
  }

  it('sends only the changed fields with the loaded version and the reason, after rechecking access', async () => {
    const form = await diagnosisForm()
    expect(value(form, 'Verification')).toBe('provisional')
    expect(value(form, 'Clinical status')).toBe('active')

    type(form, 'Verification', 'confirmed')
    type(form, 'Reason for change', 'Confirmed by blood film')
    api.lookupPatient.mockClear(); api.records.mockClear()
    fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))

    await waitFor(() => expect(api.updateDiagnosis).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'diagnosis-1',
      { expectedRowVersion: 2, changeReason: 'Confirmed by blood film', verificationStatus: 'confirmed' }))
    expect(api.lookupPatient.mock.invocationCallOrder[0]).toBeLessThan(api.updateDiagnosis.mock.invocationCallOrder[0]!)
    expect(api.updateRecord).not.toHaveBeenCalled()
    expect(await screen.findByText('Diagnosis updated.')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'diagnoses')
  })

  it('sends changed notes and clinical status together', async () => {
    const form = await diagnosisForm()
    expect(value(form, 'Notes')).toBe('Fever for three days')

    type(form, 'Clinical status', 'resolved')
    type(form, 'Notes', 'Fever settled after treatment')
    type(form, 'Reason for change', 'Treatment complete')
    fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))

    await waitFor(() => expect(api.updateDiagnosis).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'diagnosis-1',
      { expectedRowVersion: 2, changeReason: 'Treatment complete', clinicalStatus: 'resolved', notes: 'Fever settled after treatment' }))
  })

  it('refuses a submission that changes nothing', async () => {
    const form = await diagnosisForm()
    type(form, 'Reason for change', 'No real change')
    fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))

    expect((await within(form).findByRole('alert')).textContent).toContain('Change the clinical status, verification or notes')
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
  })

  it('can mark a diagnosis entered in error, after which it offers no further change', async () => {
    const form = await diagnosisForm()
    type(form, 'Verification', 'entered_in_error')
    type(form, 'Reason for change', 'Recorded against the wrong patient')
    records.diagnoses = [{ ...diagnosis, verificationStatus: 'entered_in_error', rowVersion: '3' }]
    fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))

    await waitFor(() => expect(api.updateDiagnosis).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'diagnosis-1',
      { expectedRowVersion: 2, changeReason: 'Recorded against the wrong patient', verificationStatus: 'entered_in_error' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Update diagnosis' })).toBeNull())
    expect(screen.getByText('Entered in error')).toBeTruthy()
  })

  it('shows the server refusal and keeps the form', async () => {
    api.updateDiagnosis.mockRejectedValueOnce(new Error('Diagnosis changed since it was loaded'))
    const form = await diagnosisForm()
    type(form, 'Verification', 'confirmed')
    type(form, 'Reason for change', 'Confirmed by blood film')
    fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))

    expect((await within(form).findByRole('alert')).textContent).toContain('Diagnosis changed since it was loaded')
  })

  it('is not offered when the access is read-only', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openTab('Diagnoses')
    expect(await screen.findByText('Malaria')).toBeTruthy()
    expect(await screen.findByText(/Read-only access/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update diagnosis' })).toBeNull()
  })
})

describe('correcting vitals', () => {
  it('appends a correction with the full replacement values, the loaded version and a reason', async () => {
    await openTab('Vitals')
    const form = await correctionForm()
    expect(value(form, 'Pulse (bpm)')).toBe('72')
    expect(value(form, 'Temperature (°C)')).toBe('36.6')

    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Pulse misread from the monitor')
    api.lookupPatient.mockClear()
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))

    await waitFor(() => expect(api.correctVital).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'vital-1', {
      expectedRowVersion: 1, changeReason: 'Pulse misread from the monitor',
      replacementValues: { systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 78, temperatureC: 36.6 },
    }, expect.any(String)))
    expect(api.lookupPatient.mock.invocationCallOrder[0]).toBeLessThan(api.correctVital.mock.invocationCallOrder[0]!)
    expect(await screen.findByText('Vital correction saved.')).toBeTruthy()
  })

  it('reuses the submission key when the same correction is retried', async () => {
    api.correctVital.mockRejectedValueOnce(new Error('Network error'))
    await openTab('Vitals')
    const form = await correctionForm()
    type(form, 'Pulse (bpm)', '78')
    type(form, 'Reason for correction', 'Pulse misread from the monitor')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('Network error')

    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(api.correctVital).toHaveBeenCalledTimes(2))
    expect(api.correctVital.mock.calls[1]![5]).toBe(api.correctVital.mock.calls[0]![5])
  })

  it('refuses blood pressure without both readings, and a correction that changes nothing', async () => {
    await openTab('Vitals')
    const form = await correctionForm()
    type(form, 'Reason for correction', 'Checking the reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('Change at least one value')

    type(form, 'Diastolic BP (mmHg)', '')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect((await within(form).findByRole('alert')).textContent).toContain('Enter both systolic and diastolic')
    expect(api.correctVital).not.toHaveBeenCalled()
  })

  it('shows the latest correction as the current values and the original as superseded', async () => {
    records.vitals = [{ ...vital, currentCorrectionNo: 2, rowVersion: '3' }]
    api.vitalCorrections.mockResolvedValue([
      { id: 'c2', vitalId: 'vital-1', correctionNo: 2, replacementValues: { systolicMmhg: 118, diastolicMmhg: 76, pulseBpm: 80 },
        reason: 'Second reading confirmed', createdAt: '2026-10-10T09:00:00.000Z' },
      { id: 'c1', vitalId: 'vital-1', correctionNo: 1, replacementValues: { pulseBpm: 78 },
        reason: 'Pulse misread', createdAt: '2026-10-10T08:30:00.000Z' },
    ])
    await openTab('Vitals')

    const current = await screen.findByText(/Corrected \(correction 2\)/)
    expect(current.closest('div')?.textContent).toContain('BP 118/76 mmHg · 80 bpm')
    expect(screen.getByText(/Originally recorded/).closest('div')?.textContent).toContain('BP 120/80 mmHg · 36.6 °C · 72 bpm')
    expect(screen.getByText(/Second reading confirmed/)).toBeTruthy()
    expect(api.vitalCorrections).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'vital-1')

    const form = await correctionForm()
    expect(value(form, 'Pulse (bpm)')).toBe('80')
    expect(value(form, 'Temperature (°C)')).toBe('')
    type(form, 'Pulse (bpm)', '82')
    type(form, 'Reason for correction', 'Third reading')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    await waitFor(() => expect(api.correctVital).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'vital-1', {
      expectedRowVersion: 3, changeReason: 'Third reading', replacementValues: { systolicMmhg: 118, diastolicMmhg: 76, pulseBpm: 82 },
    }, expect.any(String)))
  })

  it('never presents the original values as current when the corrections cannot be read', async () => {
    records.vitals = [{ ...vital, currentCorrectionNo: 1, rowVersion: '2' }]
    api.vitalCorrections.mockRejectedValue(new Error('Service unavailable'))
    await openTab('Vitals')

    expect(await screen.findByText(/These vitals were corrected, but the correction could not be loaded/)).toBeTruthy()
    expect(screen.getByText(/Originally recorded/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save correction' })).toBeNull()
  })
})

describe('changing a lab request status', () => {
  it('lets a draft be cancelled or marked entered in error, but not activated, since that does not reach Lab', async () => {
    await openTab('Lab requests')
    const select = await screen.findByLabelText(labelled('New status'))
    const options = within(select).getAllByRole('option').map(option => (option as HTMLOptionElement).value)
    expect(options).toEqual(['cancelled', 'entered_in_error'])

    const form = select.closest('form')!
    type(form, 'Reason for change', 'Ordered twice')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab-requests', 'lab-1',
      { expectedRowVersion: 1, changeReason: 'Ordered twice', status: 'cancelled' }))
    expect(await screen.findByText('Lab request status updated.')).toBeTruthy()
  })

  it('offers no status change for a request Lab may already be working on', async () => {
    records['lab-requests'] = [{ ...labRequest, status: 'active' }]
    await openTab('Lab requests')
    expect(await screen.findByText(/Status changes made here are not passed to Lab/)).toBeTruthy()
    expect(screen.queryByLabelText(labelled('New status'))).toBeNull()
  })
})
