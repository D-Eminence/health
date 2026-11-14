import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Clinical } from '../Clinical'

/**
 * EHR-FORMS-01. The record forms let the browser refuse what EHR's DTOs would
 * (hid-system ehr/shared/clinical.dto.ts): CreateDiagnosisDto (code system
 * 1-255, code 1-100, display 1-500, notes up to 4000) and CreateLabRequestDto
 * (test code system 1-255, test code 1-100, test display 1-500, specimen type
 * up to 100, clinical information up to 4000). New vitals with only one blood
 * pressure reading are refused before sending, as EHR refuses them with
 * 400 BLOOD_PRESSURE_INCOMPLETE (vitals.service.ts).
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn() }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ehr.encounter.read', 'ehr.note.read', 'ehr.vital.read', 'ehr.vital.write', 'ehr.diagnosis.read', 'ehr.diagnosis.write',
        'ehr.lab-request.read', 'ehr.lab-request.write'],
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }

beforeEach(() => {
  vi.clearAllMocks()
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: 'e0000000-0000-4000-8000-000000000001', patientId: PATIENT, facilityId: 'facility-1',
    encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.createRecord.mockResolvedValue({ id: 'record-1' })
})

function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }

async function addForm(tab: string, submit: string) {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: tab }))
  return (await screen.findByRole('button', { name: submit })).closest('form')!
}

function maxLength(form: HTMLElement, label: string) {
  return (within(form).getByLabelText(labelled(label)) as HTMLInputElement | HTMLTextAreaElement).maxLength
}

describe('record forms mirror EHR’s limits', () => {
  it('diagnosis', async () => {
    const form = await addForm('Diagnoses', 'Save record')
    expect(maxLength(form, 'Code system')).toBe(255)
    expect(maxLength(form, 'Code')).toBe(100)
    expect(maxLength(form, 'Display')).toBe(500)
    expect(maxLength(form, 'Notes')).toBe(4000)
  })

  it('lab request', async () => {
    const form = await addForm('Lab requests', 'Create lab request')
    expect(maxLength(form, 'Test code system')).toBe(255)
    expect(maxLength(form, 'Test code')).toBe(100)
    expect(maxLength(form, 'Test display')).toBe(500)
    expect(maxLength(form, 'Specimen type code')).toBe(100)
    expect(maxLength(form, 'Clinical information')).toBe(4000)
  })
})

describe('new vitals', () => {
  it('refuses one blood pressure reading without the other, and sends nothing', async () => {
    const form = await addForm('Vitals', 'Save record')
    fireEvent.change(within(form).getByLabelText('Systolic BP (mmHg)'), { target: { value: '120' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    expect(await within(form).findByText('Enter both systolic and diastolic blood pressure, or leave both blank.')).toBeTruthy()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('sends both readings together', async () => {
    const form = await addForm('Vitals', 'Save record')
    fireEvent.change(within(form).getByLabelText('Systolic BP (mmHg)'), { target: { value: '120' } })
    fireEvent.change(within(form).getByLabelText('Diastolic BP (mmHg)'), { target: { value: '80' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledWith('facility-1', PATIENT, 'e0000000-0000-4000-8000-000000000001', 'vitals',
      expect.objectContaining({ systolicMmhg: 120, diastolicMmhg: 80, source: 'manual' }), expect.any(String)))
  })
})
