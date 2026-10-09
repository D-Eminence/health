import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { AccessRequests } from '../AccessRequests'
import { Clinical } from '../Clinical'
import { Patients } from '../Patients'

/**
 * The governed-access loop: the clinician's own request list, closing the
 * grant that opened a record, and record changes only where the grant allows
 * them (POST /identity/consent-status).
 */
const api = vi.hoisted(() => ({
  listAccessRequests: vi.fn(),
  closeGrant: vi.fn(),
  lookupPatient: vi.fn(),
  consentStatus: vi.fn(),
  encounters: vi.fn(),
  records: vi.fn(),
}))
const staff = vi.hoisted(() => ({
  activePatient: null as unknown,
  setActivePatient: vi.fn(),
  permissions: [] as string[],
}))

vi.mock('../../api', () => ({
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: staff.permissions,
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: staff.setActivePatient,
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const request = (status: string, n = 1) => ({
  accessRequestId: `b0000000-0000-4000-8000-00000000000${n}`, patientId: PATIENT, scope: 'read_records',
  purposeOfUse: 'direct-care', reason: 'Follow-up consultation', status, requestedDurationMinutes: 60,
  requestedAt: '2026-10-09T08:00:00.000Z',
})
const allowedLookup = (consentGrantId: string | null) => ({
  patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId, expiresAt: '2026-10-09T09:00:00.000Z', breakGlass: false },
})

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = null
  staff.permissions = ['identity.consent.write', 'identity.consent.read', 'identity.patient.read',
    'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write']
  api.encounters.mockResolvedValue({ items: [], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
})

describe('the clinician’s access requests', () => {
  it('filters by status through the backend', async () => {
    api.listAccessRequests.mockResolvedValue([request('pending')])
    render(<AccessRequests />)
    expect(await screen.findByText('Follow-up consultation')).toBeTruthy()
    expect(api.listAccessRequests).toHaveBeenLastCalledWith('facility-1', undefined)

    api.listAccessRequests.mockResolvedValue([])
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } })
    expect(await screen.findByText('No approved access requests')).toBeTruthy()
    expect(api.listAccessRequests).toHaveBeenLastCalledWith('facility-1', 'approved')
  })

  it('explains a refusal instead of showing the raw error', async () => {
    api.listAccessRequests.mockRejectedValue(new HidApiError(403, 'The consent command is not authorized',
      { code: 'CONSENT_COMMAND_DENIED' }))
    render(<AccessRequests />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot list access requests/)
  })
})

describe('what became of each approval (hid-system 0074)', () => {
  const outcome = (n: number, effectiveStatus: string, extra: Record<string, unknown> = {}) => ({
    ...request('approved', n), effectiveStatus, consentGrantId: `c0000000-0000-4000-8000-00000000000${n}`,
    grantExpiresAt: '2026-10-09T09:00:00.000Z', authorizationMethod: 'patient_approval', ...extra,
  })

  it('reports each outcome and how access was given', async () => {
    api.listAccessRequests.mockResolvedValue([
      outcome(1, 'active'), outcome(2, 'expired'), outcome(3, 'closed'), outcome(4, 'revoked'),
      outcome(5, 'active', { authorizationMethod: 'patient_access_pin' }),
    ])
    render(<AccessRequests />)
    expect((await screen.findAllByText('Access active')).length).toBe(2)
    for (const label of ['Access expired', 'Closed by you', 'Access revoked', 'Patient PIN']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // Only an active grant can be closed.
    expect(screen.getAllByRole('button', { name: 'Close access' })).toHaveLength(2)
  })

  it('closes an active grant and reloads the list', async () => {
    api.listAccessRequests.mockResolvedValueOnce([outcome(1, 'active')]).mockResolvedValue([outcome(1, 'closed')])
    api.closeGrant.mockResolvedValue({})
    render(<AccessRequests />)
    fireEvent.click(await screen.findByRole('button', { name: 'Close access' }))
    await waitFor(() => expect(api.closeGrant).toHaveBeenCalledWith('facility-1', 'c0000000-0000-4000-8000-000000000001',
      'Clinician closed completed patient access'))
    expect(await screen.findByText('Closed by you')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close access' })).toBeNull()
  })

  it('falls back to the request status from an Identity build without outcomes', async () => {
    api.listAccessRequests.mockResolvedValue([request('approved')])
    render(<AccessRequests />)
    expect(await screen.findByText('Approved')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close access' })).toBeNull()
  })
})

describe('closing the grant that opened a record', () => {
  it('offers it for a record opened from an approved request, and closes that grant', async () => {
    staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup: allowedLookup('c0000000-0000-4000-8000-000000000001') }
    api.closeGrant.mockResolvedValue({})
    render(<MemoryRouter><Patients /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Close my grant' }))
    await waitFor(() => expect(api.closeGrant).toHaveBeenCalledWith('facility-1', 'c0000000-0000-4000-8000-000000000001',
      'Clinician closed completed patient access'))
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
  })

  it('does not offer it when the lookup names no grant', () => {
    staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup: allowedLookup(null) }
    render(<MemoryRouter><Patients /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Close my grant' })).toBeNull()
  })
})

describe('record changes follow the grant', () => {
  beforeEach(() => {
    staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup: allowedLookup('c0000000-0000-4000-8000-000000000001') }
    api.lookupPatient.mockResolvedValue(allowedLookup('c0000000-0000-4000-8000-000000000001'))
  })

  it('hides changes under a read-only grant (a patient PIN or a read request)', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care',
      readAllowed: true, writeAllowed: false })
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    expect((await screen.findByText(/Read-only access/)).textContent).toMatch(/does not include changes/)
    expect(screen.queryByRole('button', { name: 'Start encounter' })).toBeNull()
    expect(api.consentStatus).toHaveBeenCalledWith('facility-1', PATIENT)
  })

  it('offers changes when the grant allows writing', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care',
      readAllowed: true, writeAllowed: true })
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Start encounter' })).toBeTruthy()
    expect(screen.queryByText(/Read-only access/)).toBeNull()
  })

  it('fails closed when write access cannot be confirmed', async () => {
    api.consentStatus.mockRejectedValue(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    expect(await screen.findByText(/could not be confirmed/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start encounter' })).toBeNull()
  })
})
