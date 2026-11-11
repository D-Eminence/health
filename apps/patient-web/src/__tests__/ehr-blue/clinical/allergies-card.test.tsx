import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AllergiesCard } from '../../../ehr-blue/clinical/patients/AllergiesCard'
import type { Chart } from '../../../ehr-blue/clinical/parts/chart'
import { parseAllergyCheck, parseAllergyList, warningMessages } from '../../../staff/allergies'

/** The chart's Allergies card (hid-system 0124) and its parsers. Everything is fictional. */

const api = vi.hoisted(() => ({
  allergies: vi.fn(), reportedHealthProfile: vi.fn(), addAllergy: vi.fn(), markAllergyEnteredInError: vi.fn(),
}))
vi.mock('../../../staff/api', () => ({ staffApi: api }))

const FACILITY_ID = 'f0000000-0000-4000-8000-000000000001'
const PATIENT_ID = 'p0000000-0000-4000-8000-000000000001'

function chartWith(permissions: string[], canWrite = true): Chart {
  return {
    facilityId: FACILITY_ID, facilityName: 'Demo Hospital', patientId: PATIENT_ID, purpose: 'direct-care', canWrite,
    writeNotice: null, can: (...wanted: string[]) => wanted.every(permission => permissions.includes(permission)),
    verify: vi.fn(async () => undefined), endAccess: vi.fn(), patient: {} as never, facts: { name: 'Ada Example' } as never,
  }
}

const here = { id: 'a0000000-0000-4000-8000-000000000001', substance: 'Penicillin', reaction: 'Hives', severity: 'severe',
  status: 'active', rowVersion: 1, createdAt: '2026-11-01T09:00:00.000Z', enteredInErrorReason: null, recordedHere: true }
const elsewhere = { ...here, id: 'a0000000-0000-4000-8000-000000000002', substance: 'Sulfa drugs', reaction: 'Rash', severity: 'mild', recordedHere: false }

beforeEach(() => {
  vi.clearAllMocks()
  api.allergies.mockResolvedValue({ recorded: [here, elsewhere], patientReported: { allergies: 'Peanuts', updatedAt: null } })
  api.reportedHealthProfile.mockResolvedValue({ allergies: 'Peanuts', updatedAt: null })
})

describe('Allergies card', () => {
  it('shows recorded and patient-reported allergies apart, each labelled, and who may mark which', async () => {
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    expect(await screen.findByText('Recorded by clinicians')).toBeTruthy()
    expect(screen.getByText('Penicillin')).toBeTruthy()
    expect(screen.getByText('Reaction: Hives')).toBeTruthy()
    expect(screen.getByText('Severe')).toBeTruthy()
    expect(screen.getByText('Sulfa drugs')).toBeTruthy()
    expect(screen.getByText(/^Recorded at another facility/)).toBeTruthy()
    expect(screen.getByText('Reported by the patient')).toBeTruthy()
    expect(screen.getByText('Peanuts')).toBeTruthy()
    // Only the allergy recorded here can be marked here.
    expect(screen.getAllByRole('button', { name: 'Mark as entered in error' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Add allergy' })).toBeTruthy()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('before 0124 (404) shows what the patient reported only, with no add button', async () => {
    api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    expect(await screen.findByText('Reported by the patient')).toBeTruthy()
    expect(screen.getByText('Peanuts')).toBeTruthy()
    expect(screen.queryByText('Recorded by clinicians')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add allergy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
  })

  it('offers no add or mark without ehr.note.write, or under read-only access, and nothing without ehr.note.read', async () => {
    const { unmount } = render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    expect(await screen.findByText('Penicillin')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add allergy' })).toBeNull()
    unmount()
    const second = render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'], false)} />)
    expect(await screen.findByText('Penicillin')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add allergy' })).toBeNull()
    second.unmount()
    api.allergies.mockClear()
    render(<AllergiesCard chart={chartWith([])} />)
    expect(screen.queryByText('Allergies')).toBeNull()
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it('records an allergy with an idempotency key, then reads the list again', async () => {
    api.addAllergy.mockResolvedValue(here)
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add allergy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
    expect(await screen.findByText('Enter the medicine or substance.')).toBeTruthy()
    expect(api.addAllergy).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Medicine or substance'), { target: { value: ' Latex ' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'moderate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record allergy' }))
    await waitFor(() => expect(api.addAllergy).toHaveBeenCalledTimes(1))
    expect(api.addAllergy).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { substance: 'Latex', severity: 'moderate' }, expect.any(String))
    expect(await screen.findByText('Allergy to Latex recorded.')).toBeTruthy()
    await waitFor(() => expect(api.allergies).toHaveBeenCalledTimes(2))
  })

  it('marks an allergy entered in error with a reason and its version', async () => {
    api.markAllergyEnteredInError.mockResolvedValue({ ...here, status: 'entered_in_error' })
    render(<AllergiesCard chart={chartWith(['ehr.note.read', 'ehr.note.write'])} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as entered in error' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as entered in error' })[0]!)
    expect(await screen.findByText('Say why this allergy was recorded in error.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Why was this recorded in error?'), { target: { value: 'Recorded for the wrong patient' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as entered in error' })[0]!)
    await waitFor(() => expect(api.markAllergyEnteredInError).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, here.id,
      { expectedRowVersion: 1, reason: 'Recorded for the wrong patient' }))
  })

  it('says a failed read plainly, with a retry', async () => {
    api.allergies.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' }))
    render(<AllergiesCard chart={chartWith(['ehr.note.read'])} />)
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Penicillin')).toBeTruthy()
  })
})

describe('allergy parsers', () => {
  it('reads the list, dropping a row that is not one', () => {
    const list = parseAllergyList({ recorded: [here, { id: 'x' }, { ...here, id: 'y', severity: 'odd' }], patientReported: { allergies: '  ', updatedAt: 'nope' } })
    expect(list.recorded.map(item => item.id)).toEqual([here.id, 'y'])
    expect(list.recorded[1]!.severity).toBe('unknown')
    expect(list.patientReported).toEqual({ allergies: null, updatedAt: null })
    expect(() => parseAllergyList({})).toThrow()
  })

  it('reads the check and a refusal’s warning messages; a line it cannot read fails the whole answer', () => {
    const token = 'c'.repeat(64)
    const reported = { source: 'patient_reported', substance: 'penicillin', reaction: null, severity: null, matchKind: 'same_medicine', message: 'M' }
    expect(parseAllergyCheck({ matches: [reported], acknowledgementRequired: true, warningToken: token }).matches)
      .toEqual([{ source: 'patient_reported', substance: 'penicillin', reaction: null, severity: null, matchKind: 'same_medicine', message: 'M' }])
    expect(() => parseAllergyCheck({ matches: [reported, { message: '' }], acknowledgementRequired: true, warningToken: token })).toThrow()
    expect(warningMessages([{ field: 'allergyAcknowledgement', messages: ['One', 2, ''] }, { field: 'other', messages: ['x'] },
      { field: 'allergyAcknowledgement.warningToken', messages: [token] }])).toEqual(['One'])
    expect(warningMessages(null)).toEqual([])
  })
})
