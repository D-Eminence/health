import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Clinical } from '../Clinical'

/**
 * EHR's VitalMeasurementsDto (hid-system ehr/shared/clinical.dto.ts) accepts
 * whole numbers for pulse, respirations and blood pressure, at most one decimal
 * for temperature, and a range for each. The form lets the browser refuse
 * anything else before it is sent, instead of a generic 400 from the server.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn() }))
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
      permissions: ['ehr.encounter.read', 'ehr.vital.read', 'ehr.vital.write'],
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: 'e0000000-0000-4000-8000-000000000001', patientId: PATIENT, facilityId: 'facility-1',
    encounterType: 'outpatient', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
})

function valid(label: string, value: string): boolean {
  const input = screen.getByLabelText(label) as HTMLInputElement
  fireEvent.change(input, { target: { value } })
  return input.checkValidity()
}

describe('the vitals form', () => {
  it('accepts only what EHR accepts for each measurement', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByLabelText('Pulse (bpm)')

    expect(valid('Pulse (bpm)', '72')).toBe(true)
    expect(valid('Pulse (bpm)', '72.5')).toBe(false)
    expect(valid('Pulse (bpm)', '9')).toBe(false)
    expect(valid('Systolic BP (mmHg)', '120.5')).toBe(false)
    expect(valid('Diastolic BP (mmHg)', '80')).toBe(true)
    expect(valid('Respirations / min', '16.5')).toBe(false)
    expect(valid('Temperature (°C)', '36.6')).toBe(true)
    expect(valid('Temperature (°C)', '36.65')).toBe(false)
    expect(valid('Temperature (°C)', '51')).toBe(false)
    expect(valid('SpO₂ (%)', '97.25')).toBe(true)
    expect(valid('SpO₂ (%)', '101')).toBe(false)
    expect(valid('Weight (kg)', '70.125')).toBe(true)
    expect(valid('Weight (kg)', '70.1255')).toBe(false)
    expect(valid('Height (cm)', '172.55')).toBe(true)
    expect(valid('Height (cm)', '19')).toBe(false)
  })
})
