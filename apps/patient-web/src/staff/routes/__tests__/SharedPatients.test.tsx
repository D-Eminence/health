import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Patients } from '../Patients'

/**
 * The clinician's side of patient sharing on the Patients page (hid-1.0 parity B4, hid-system 0095; contract S1 to S3,
 * §2.7): "Shared with you" opens a patient through the Health ID lookup, and "Invitations" accepts an invitation sent to
 * the clinician's email, after which the patient confirms. Each card is hidden where the backend does not serve it (404),
 * as today's backend does not.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn(),
  sharedWithMe: vi.fn(), staffShareInvitations: vi.fn(), acceptShareInvitation: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], setActivePatient: vi.fn(() => true) }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: null,
    setActivePatient: staff.setActivePatient,
  }),
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

const notServed = () => new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })
const refused = (status: number, code: string, message: string) => new HidApiError(status, message, { code })

const SHARED = { consentGrantId: 'grant-1', patientId: 'patient-1', hid: 'HID-ABC234', fullName: 'Amaka Eze', level: 'clinical_review',
  duration: '7d', scope: 'read_records', startsAt: '2026-10-28T10:00:00Z', expiresAt: '2026-11-04T10:00:00Z' }
const INVITATION = { invitationId: 'inv-1', reference: 'ABCD2345', inviteeName: 'Dr Obi', level: 'view_only', duration: '30d',
  createdAt: '2026-10-27T09:00:00Z', expiresAt: '2026-11-26T09:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = ['identity.patient.read', 'identity.consent.write']
  api.sharedWithMe.mockResolvedValue([SHARED])
  api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
})

async function renderPatients() {
  render(<MemoryRouter><Patients /></MemoryRouter>)
  await act(async () => {})
}

const card = (title: string) => screen.getByRole('heading', { name: title }).parentElement!

describe('the Patients page on a backend that does not serve sharing', () => {
  it('shows neither card, and no error, when both lists answer 404', async () => {
    api.sharedWithMe.mockRejectedValue(notServed())
    api.staffShareInvitations.mockRejectedValue(notServed())
    await renderPatients()
    expect(screen.queryByRole('heading', { name: 'Shared with you' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
  })

  it('does not ask for either list for a role without identity.consent.write, which the routes require', async () => {
    staff.permissions = ['identity.patient.read']
    await renderPatients()
    expect(api.sharedWithMe).not.toHaveBeenCalled()
    expect(api.staffShareInvitations).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Shared with you' })).toBeNull()
  })
})

describe('Shared with you', () => {
  it('lists the patients who shared with this clinician, and opens one through the Health ID lookup', async () => {
    api.lookupPatient.mockResolvedValue({ authorization: { decision: 'allow', consentGrantId: 'grant-1' }, patient: { patientId: 'patient-1' } })
    await renderPatients()
    expect(api.sharedWithMe).toHaveBeenCalledWith('facility-1', expect.any(AbortSignal))
    const shared = card('Shared with you')
    expect(within(shared).getByText('Amaka Eze')).toBeTruthy()
    expect(within(shared).getByText('HID-ABC234')).toBeTruthy()
    expect(within(shared).getByText('Clinical Review')).toBeTruthy()
    await act(async () => { fireEvent.click(within(shared).getByRole('button', { name: 'Open Amaka Eze’s record' })) })
    expect(api.lookupPatient).toHaveBeenCalledWith('facility-1', 'HID-ABC234', 'direct-care')
    expect(staff.setActivePatient).toHaveBeenCalledWith(expect.objectContaining({ hid: 'HID-ABC234', purpose: 'direct-care' }))
  })

  it('says so when no patient has shared, and keeps Open unavailable to a role that cannot look a patient up', async () => {
    api.sharedWithMe.mockResolvedValueOnce([])
    await renderPatients()
    expect(within(card('Shared with you')).getByText('No patient has shared their record with you here.')).toBeTruthy()
    staff.permissions = ['identity.consent.write']
    api.sharedWithMe.mockResolvedValue([SHARED])
    cleanup()
    await renderPatients()
    const open = within(card('Shared with you')).getByRole('button', { name: 'Open Amaka Eze’s record' }) as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(document.getElementById(open.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/identity\.patient\.read/)
  })
})

describe('Invitations', () => {
  it('shows the invitation without naming any patient, accepts it, and moves focus to what happens next', async () => {
    api.acceptShareInvitation.mockResolvedValue({ invitationId: 'inv-1', status: 'accepted', acceptedAt: '2026-10-28T11:00:00Z', replayed: false })
    await renderPatients()
    const invitations = card('Invitations')
    expect(within(invitations).getByText('Invitation ABCD2345')).toBeTruthy()
    expect(within(invitations).getByText('View Only')).toBeTruthy()
    const accept = within(invitations).getByRole('button', { name: 'Accept invitation ABCD2345' })
    accept.focus()
    await act(async () => { fireEvent.click(accept) })
    expect(api.acceptShareInvitation).toHaveBeenCalledWith('facility-1', 'inv-1')
    const result = await screen.findByText(/You accepted invitation ABCD2345\. The patient must now confirm/)
    expect(document.activeElement).toBe(result)
    expect(within(invitations).queryByRole('button', { name: /Accept/ })).toBeNull()
    expect(within(invitations).getByText('No invitations are waiting for your sign-in email.')).toBeTruthy()
  })

  it('moves focus to the refusal of an invitation no longer waiting, and takes it off the list', async () => {
    api.acceptShareInvitation.mockRejectedValue(refused(409, 'SHARE_INVITATION_NOT_PENDING', 'Not pending'))
    await renderPatients()
    const accept = within(card('Invitations')).getByRole('button', { name: 'Accept invitation ABCD2345' })
    accept.focus()
    await act(async () => { fireEvent.click(accept) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('This invitation has already been accepted, cancelled or has ended.')
    expect(document.activeElement).toBe(alert)
    expect(screen.queryByRole('button', { name: 'Accept invitation ABCD2345' })).toBeNull()
  })

  it('keeps the invitation, and says why, when the role here may not receive records', async () => {
    api.acceptShareInvitation.mockRejectedValue(refused(403, 'SHARE_PROVIDER_NOT_ELIGIBLE', 'Not eligible'))
    await renderPatients()
    const accept = within(card('Invitations')).getByRole('button', { name: 'Accept invitation ABCD2345' })
    accept.focus()
    await act(async () => { fireEvent.click(accept) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Your role at this facility cannot receive patient records through Health ID.')
    expect(document.activeElement).toBe(alert)
    expect(screen.getByRole('button', { name: 'Accept invitation ABCD2345' })).toBeTruthy()
  })

  it('explains, with no list, when the membership here may not receive shares', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: false, items: [] })
    await renderPatients()
    const invitations = card('Invitations')
    expect(within(invitations).getByText(/Only a doctor, clinician or nurse at a facility Health ID has checked/)).toBeTruthy()
    expect(within(invitations).queryByRole('button')).toBeNull()
  })

  it('hides only the card whose list is not served', async () => {
    api.staffShareInvitations.mockRejectedValue(notServed())
    await renderPatients()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Shared with you' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull()
  })
})
