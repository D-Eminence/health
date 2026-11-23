import { fireEvent, screen, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dropOfferedHealthId } from '../../../ehr-blue/clinical/consent/access'
import { PatientsWorkspace } from '../../../ehr-blue/clinical/patients/PatientsWorkspace'
import { FACILITY_ID, allowedLookup, labelled, renderPage } from './harness'

/**
 * Check in from a Search by name card (hid-system 0132 and 0135): a member the waiting list is open to (encounter read
 * and write) gets Check in on each card, which sends the card's matchRef, never a Health ID. Every patient and
 * reference here is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), closeGrant: vi.fn(), encounters: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(),
  sharedWithMe: vi.fn(), staffShareInvitations: vi.fn(), acceptShareInvitation: vi.fn(), reportedHealthProfile: vi.fn(),
  searchPatients: vi.fn(), openOwnFacilityPatient: vi.fn(),
}))
const queue = vi.hoisted(() => ({ list: vi.fn(), checkIn: vi.fn(), update: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined, roles: undefined as string[] | undefined }))
const session = vi.hoisted(() => ({
  staffSessionGeneration: vi.fn(() => 5), untilStaffSessionReady: vi.fn(async (_sentIn: number) => {}),
  staffSessionSignal: vi.fn(() => new AbortController().signal),
}))

vi.mock('../../../staff/api', async () => ({
  staffApi: api,
  visitQueueApi: queue,
  isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup,
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => session)

const FRONT_DESK = ['identity.patient.read', 'identity.consent.write', 'identity.consent.read', 'identity.registration.write',
  'ehr.encounter.read', 'ehr.encounter.write']
const MATCH_REF = `psr_${'C'.repeat(43)}`
const CARD = {
  matchRef: MATCH_REF, matchRefExpiresAt: '2099-01-01T00:10:00.000Z', fullName: 'Testa Queueperson', sex: 'female',
  dateOfBirth: '1990-01-02', healthIdLast4: 'ZZ22', ninStatus: 'not_verified' as const,
}
const NOT_FOUND = new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })

beforeEach(() => {
  vi.clearAllMocks()
  dropOfferedHealthId()
  staff.permissions = [...FRONT_DESK]
  staff.activePatient = null
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.sharedWithMe.mockRejectedValue(NOT_FOUND)
  api.staffShareInvitations.mockRejectedValue(NOT_FOUND)
  api.searchPatients.mockResolvedValue({ mode: 'standard', outcome: 'found', reach: 'everywhere', message: null, patients: [CARD] })
})

const nameSearch = () => screen.getByRole('heading', { name: 'Search by name' }).closest('section') as HTMLElement

function search() {
  renderPage(<PatientsWorkspace />, 'patients')
  fireEvent.change(within(nameSearch()).getByLabelText(labelled('First name'), { exact: false }), { target: { value: 'Testa' } })
  fireEvent.change(within(nameSearch()).getByLabelText(labelled('Last name'), { exact: false }), { target: { value: 'Queueperson' } })
  fireEvent.change(within(nameSearch()).getByLabelText(labelled('Date of birth'), { exact: false }), { target: { value: '1990-01-02' } })
  fireEvent.click(within(nameSearch()).getByRole('button', { name: 'Search' }))
}

describe('Check in from Search by name', () => {
  it('checks the patient in by the card’s matchRef and says so beside the card', async () => {
    queue.checkIn.mockResolvedValue({ outcome: 'checked_in', entry: { fullName: 'Testa Queueperson' } })
    search()
    const list = await screen.findByRole('list', { name: 'Patients found' })
    fireEvent.click(within(list).getByRole('button', { name: 'Check in Testa Queueperson' }))
    expect(await within(list).findByText('Testa Queueperson is checked in and waiting. See the Waiting list.')).toBeTruthy()
    expect(queue.checkIn).toHaveBeenCalledWith(FACILITY_ID, { matchRef: MATCH_REF })
    expect(nameSearch().textContent).not.toMatch(/psr_|unverified/i)
  })

  it('says a refused check-in in the waiting list’s words', async () => {
    queue.checkIn.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CHECK_IN_NEEDS_SEARCH' }))
    search()
    const list = await screen.findByRole('list', { name: 'Patients found' })
    fireEvent.click(within(list).getByRole('button', { name: 'Check in Testa Queueperson' }))
    expect(await within(list).findByText('Search for the patient first, then check them in. A search result can be used for 10 minutes.')).toBeTruthy()
  })

  it('says a check-in ehr-api’s checks refused, or a backend without the waiting list, in plain words', async () => {
    queue.checkIn.mockRejectedValueOnce(new HidApiError(400, 'Bad Request', { code: 'VALIDATION_FAILED' }))
    search()
    const list = await screen.findByRole('list', { name: 'Patients found' })
    fireEvent.click(within(list).getByRole('button', { name: 'Check in Testa Queueperson' }))
    expect(await within(list).findByText('Search for the patient again, then select Check in on their card.')).toBeTruthy()
    queue.checkIn.mockRejectedValueOnce(new HidApiError(404, 'Cannot POST', { code: 'NOT_FOUND' }))
    fireEvent.click(within(list).getByRole('button', { name: 'Check in Testa Queueperson' }))
    expect(await within(list).findByText('The waiting list is not available yet. Try again later.')).toBeTruthy()
  })

  it('is not offered to a role the waiting list is closed to', async () => {
    staff.permissions = FRONT_DESK.filter(permission => permission !== 'ehr.encounter.write')
    search()
    const list = await screen.findByRole('list', { name: 'Patients found' })
    expect(within(list).queryByRole('button', { name: /^Check in/ })).toBeNull()
    expect(queue.checkIn).not.toHaveBeenCalled()
  })
})
