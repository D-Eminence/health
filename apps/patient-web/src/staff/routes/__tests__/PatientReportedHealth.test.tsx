import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { PatientReportedHealth } from '../PatientReportedHealth'

/**
 * "Reported by the patient" on the chart (hid-1.0 parity B3): what the patient entered about their health, read as the
 * chart's other reads are, at the selected facility for direct care, shown when the route answers and hidden on 404
 * and 403.
 */
const fixture = vi.hoisted(() => ({ permissions: ['ehr.encounter.read', 'ehr.note.read'], purpose: 'direct-care',
  patient: { authorization: { decision: 'allow' }, patient: { patientId: 'patient-a', hid: 'HID-TEST', fullName: 'Test patient' } },
  api: { lookupPatient: vi.fn(), encounters: vi.fn(), consentStatus: vi.fn(), importedRecords: vi.fn(), reportedHealthProfile: vi.fn() },
}))
vi.mock('../../api', () => ({ staffApi: fixture.api,
  isAllowedPatientLookup: (value: { authorization: { decision: string } }) => value.authorization.decision === 'allow',
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local' }) }))
vi.mock('../../App', () => ({ useStaff: () => ({
  state: { status: 'ready', session: { actor: { id: 'staff-a', facility: { id: 'facility-a', name: 'Test facility', permissions: fixture.permissions } } } },
  activePatient: { hid: 'HID-TEST', purpose: fixture.purpose, lookup: fixture.patient },
  setActivePatient: vi.fn(),
}) }))

const reported = { bloodGroup: 'O+', genotype: 'AS', allergies: 'Penicillin\nShellfish', currentMedications: null,
  chronicConditions: 'Hypertension', medicalNotes: 'Prefers a female doctor', updatedAt: '2026-10-28T09:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  fixture.permissions = ['ehr.encounter.read', 'ehr.note.read']
  fixture.purpose = 'direct-care'
  fixture.api.lookupPatient.mockResolvedValue(fixture.patient)
  fixture.api.encounters.mockResolvedValue({ items: [], nextCursor: null })
  fixture.api.consentStatus.mockResolvedValue({ readAllowed: true, writeAllowed: false })
  fixture.api.reportedHealthProfile.mockResolvedValue(reported)
})
afterEach(() => { vi.unstubAllEnvs() })

const card = async () => within((await screen.findByRole('heading', { name: 'Reported by the patient' })).closest('section') as HTMLElement)

describe('Reported by the patient, on the chart', () => {
  it('shows the six things the patient entered, labelled as theirs and not clinically verified', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    const shown = await card()
    expect(shown.getByText('Patient-reported')).toBeTruthy()
    expect(shown.getByText(/Entered by the patient in their Health ID portal, not clinically verified/)).toBeTruthy()
    const rows = shown.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent])
    expect(rows).toEqual([['Blood group', 'O+'], ['Genotype', 'AS'], ['Allergies', 'Penicillin\nShellfish'],
      ['Current medications', 'Not stated'], ['Chronic conditions', 'Hypertension'], ['Medical notes for the care team', 'Prefers a female doctor']])
    expect(fixture.api.reportedHealthProfile).toHaveBeenCalledWith('facility-a', 'patient-a', expect.any(AbortSignal))
  })

  it.each([404, 403])('is hidden when the route answers %i', async status => {
    fixture.api.reportedHealthProfile.mockRejectedValue(new HidApiError(status, 'Refused'))
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText('No encounters are available for this patient and facility.')
    await waitFor(() => expect(fixture.api.reportedHealthProfile).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Reported by the patient' })).toBeNull()
    expect(screen.queryByText(/could not be loaded/)).toBeNull()
  })

  it('is hidden when the patient stated nothing', async () => {
    fixture.api.reportedHealthProfile.mockResolvedValue(null)
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText('No encounters are available for this patient and facility.')
    await waitFor(() => expect(fixture.api.reportedHealthProfile).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Reported by the patient' })).toBeNull()
  })

  it('is not asked for without record-read permission, or in emergency access', async () => {
    fixture.permissions = ['ehr.encounter.read']
    const { unmount } = render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText('No encounters are available for this patient and facility.')
    unmount()
    fixture.permissions = ['ehr.encounter.read', 'ehr.note.read']
    fixture.purpose = 'emergency'
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Test patient' })
    expect(fixture.api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('says so when EHR could not answer, and reads again on Retry', async () => {
    fixture.api.reportedHealthProfile.mockRejectedValueOnce(new HidApiError(503, 'Unavailable'))
    render(<PatientReportedHealth facilityId="facility-a" patientId="patient-a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry patient-reported health information' }))
    expect(await screen.findByText('Patient-reported')).toBeTruthy()
    expect(fixture.api.reportedHealthProfile).toHaveBeenCalledTimes(2)
  })
})
