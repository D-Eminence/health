import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Clinical } from '../Clinical'
import { historyFixture } from '../../../__tests__/importedHistoryFixture'

const fixture = vi.hoisted(() => ({ permissions: ['ehr.encounter.read', 'ehr.note.read'],
  patient: { authorization: { decision: 'allow' }, patient: { patientId: 'patient-a', hid: 'HID-TEST', fullName: 'Test patient' } },
  api: { lookupPatient: vi.fn(), encounters: vi.fn(), consentStatus: vi.fn(), importedRecords: vi.fn() },
}))
vi.mock('../../api', () => ({ staffApi: fixture.api,
  isAllowedPatientLookup: (value: { authorization: { decision: string } }) => value.authorization.decision === 'allow',
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local' }) }))
vi.mock('../../App', () => ({ useStaff: () => ({
  state: { status: 'ready', session: { actor: { id: 'staff-a', facility: {
    id: 'facility-a', name: 'Test facility', permissions: fixture.permissions,
  } } } },
  activePatient: { hid: 'HID-TEST', purpose: 'direct-care', lookup: fixture.patient },
  setActivePatient: vi.fn(),
}) }))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.permissions = ['ehr.encounter.read', 'ehr.note.read']
  fixture.api.lookupPatient.mockResolvedValue(fixture.patient)
  fixture.api.encounters.mockResolvedValue({ items: [], nextCursor: null })
  fixture.api.consentStatus.mockResolvedValue({ readAllowed: true, writeAllowed: false })
  fixture.api.importedRecords.mockResolvedValue({ importedRecords: historyFixture, limit: 50 })
})
describe('hospital record screen', () => {
  it('shows imported history when this facility has no encounter for the patient', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    expect(await screen.findByText('Preserved report')).toBeTruthy()
    expect(await screen.findByText('No encounters are available for this patient and facility.')).toBeTruthy()
    expect(fixture.api.importedRecords).toHaveBeenCalledWith('facility-a', 'patient-a', 'direct-care', expect.any(AbortSignal))
  })
  it('does not request or display imported history without record-read permission', async () => {
    fixture.permissions = ['ehr.encounter.read']
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText('No encounters are available for this patient and facility.')
    expect(fixture.api.importedRecords).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Imported medical history' })).toBeNull()
  })
})
