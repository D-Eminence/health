import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { FacilityStaff, FacilityStaffInvitation, FacilityStaffMember } from '../../api'
import { normalizePersonName, personNameProblem, StaffPage } from '../Staff'

/**
 * The Staff page of a facility that signed itself up (Novu, P4b SPEC 8.1). Before Health ID support's check it shows
 * the administrator alone and their own-licence card; after it the administrator invites staff, vouching for their
 * licences, and manages members and invitations. Identity decides everything; the page never says whether an email has
 * a Health ID account.
 */
const api = vi.hoisted(() => ({ read: vi.fn(), recordAdministratorLicence: vi.fn(), invite: vi.fn(), resend: vi.fn(),
  revoke: vi.fn(), end: vi.fn(), changeRole: vi.fn() }))
const workspace = vi.hoisted(() => ({
  facility: { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Ikeja Care', roles: ['org_admin'],
    permissions: ['workforce.manage'], isPrimary: true, selfService: { review: 'reviewed', organizationType: 'hospital' } } as Record<string, unknown>,
}))
vi.mock('../../api', () => ({ facilityStaffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { id: 'account-1', email: 'bola@ikejacare.example',
    displayName: 'Bola Adewale', roles: [], permissions: [], facilities: [workspace.facility], facility: workspace.facility } } },
  lock: null }),
}))

const ATTESTATION = 'I confirm that {name} works at {facility} and, for a clinical role, that I have seen their current '
  + 'practising licence with the number entered above. Health ID records this confirmation with my name, and Health ID '
  + 'support may check it.'

const administrator = (overrides: Partial<FacilityStaffMember> = {}): FacilityStaffMember => ({ membershipId: 'member-1', version: 2,
  accountId: 'account-1', name: 'Bola Adewale', email: 'bola@ikejacare.example', roles: ['org_admin', 'doctor'],
  isAdministrator: true, isSelf: true, joinedAt: '2026-10-20T09:00:00.000Z',
  licence: { body: 'MDCN', numberHint: '2345', vouchedBy: null, vouchedAt: '2026-10-24T12:00:00.000Z', method: 'platform_review' },
  ...overrides })
const nurse = (overrides: Partial<FacilityStaffMember> = {}): FacilityStaffMember => ({ membershipId: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d',
  version: 3, accountId: 'account-2', name: 'Ngozi Okafor', email: 'ngozi@ikejacare.example', roles: ['nurse'],
  isAdministrator: false, isSelf: false, joinedAt: '2026-10-25T09:00:00.000Z',
  licence: { body: 'NMCN', numberHint: '8765', vouchedBy: 'Bola Adewale', vouchedAt: '2026-10-25T08:00:00.000Z',
    method: 'facility_attestation' }, ...overrides })
const invitation = (overrides: Partial<FacilityStaffInvitation> = {}): FacilityStaffInvitation => ({
  invitationId: '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a', version: 1, reference: '0F2B6D0E', name: 'Emeka Obi',
  email: 'emeka@ikejacare.example', roleCode: 'doctor', licence: { body: 'MDCN', numberHint: '0777' }, status: 'pending',
  invitedBy: 'Bola Adewale', createdAt: '2026-10-25T09:30:00.000Z', lastSentAt: '2026-10-25T09:30:00.000Z',
  expiresAt: '2026-11-01T09:30:00.000Z', sendCount: 1, deliveryOutcome: 'accepted', resendAvailableAt: '2026-10-25T09:31:00.000Z',
  ...overrides })
const staff = (overrides: Partial<FacilityStaff> = {}, facility: Partial<FacilityStaff['facility']> = {}): FacilityStaff => ({
  facility: { id: 'facility-1', name: 'Ikeja Care', organizationType: 'hospital', reviewState: 'reviewed', firstThirtyDaysEndAt: null,
    invitationsOpen: true, deliveryPaused: false, ...facility },
  canInvite: true,
  limits: { pendingInvitations: 1, pendingLimit: 100, invitationsToday: 2, invitationsPerDay: 30, emailsToday: 3, emailsPerDay: 60 },
  inviteOptions: { roles: [{ code: 'doctor', licenceBody: 'MDCN' }, { code: 'nurse', licenceBody: 'NMCN' },
    { code: 'lab', licenceBody: 'MLSCN' }, { code: 'pharmacist', licenceBody: 'PCN' }, { code: 'receptionist', licenceBody: null }],
    attestation: { version: 'facility-staff-attestation-v1', text: ATTESTATION } },
  administratorLicence: null, administratorLicenceBodies: ['MDCN', 'NMCN'],
  members: [administrator(), nurse()], invitations: [invitation()], ...overrides })
const pending = (overrides: Partial<FacilityStaff> = {}) => staff({ canInvite: false, members: [administrator({
  roles: ['org_admin_awaiting_review'], licence: null })], invitations: [], ...overrides }, { reviewState: 'pending' })

function open() {
  render(<MemoryRouter><StaffPage /></MemoryRouter>)
}

function setFacility(selfService: unknown, permissions = ['workforce.manage']) {
  workspace.facility = { ...workspace.facility, selfService, permissions }
}

beforeEach(() => {
  vi.clearAllMocks()
  setFacility({ review: 'reviewed', organizationType: 'hospital' })
})

const memberRow = async (name: string) => (await screen.findByText(name, { selector: 'strong' })).closest('.staff-list-item') as HTMLElement

describe('before Health ID support’s check', () => {
  beforeEach(() => setFacility({ review: 'pending', organizationType: 'hospital' }))

  it('shows the administrator alone, says staff come after the check, and offers no invitation', async () => {
    api.read.mockResolvedValue(pending())
    open()
    expect(await screen.findByText('You can add staff once Health ID support has checked Ikeja Care.')).toBeTruthy()
    expect(api.read).toHaveBeenCalledWith('facility-1')
    const self = await memberRow('Bola Adewale')
    expect(within(self).getByText('Facility administrator')).toBeTruthy()
    expect(within(self).getByText('Licence: None')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite a member of staff' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull()
    expect(within(self).queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('lets the administrator record their own licence for support’s check, from the licences their type allows', async () => {
    api.read.mockResolvedValueOnce(pending()).mockResolvedValue(pending({ administratorLicence: { body: 'NMCN', numberHint: '4321',
      recordedAt: '2026-10-25T10:00:00.000Z' } }))
    api.recordAdministratorLicence.mockResolvedValueOnce({ licenceBody: 'NMCN', numberHint: '4321', recordedAt: '2026-10-25T10:00:00.000Z' })
    open()
    const card = (await screen.findByRole('heading', { name: 'Your own clinical access' })).closest('form')!
    expect(within(card).getByText(/^If you are a licensed/).textContent).toBe('If you are a licensed doctor or nurse and will treat '
      + 'patients yourself, enter your licence. Health ID support checks it when it reviews Ikeja Care. If you leave it empty, '
      + 'you’ll manage the facility and its staff without clinical access yourself.')
    const body = within(card).getByLabelText('Licence') as HTMLSelectElement
    expect([...body.options].map(option => option.textContent)).toEqual(['MDCN (doctor)', 'NMCN (nurse)'])
    fireEvent.change(body, { target: { value: 'NMCN' } })
    const number = within(card).getByLabelText(/^Licence number/)
    fireEvent.change(number, { target: { value: 'rn/' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    expect(await within(card).findByText(/^Enter your licence number\./)).toBeTruthy()
    expect(api.recordAdministratorLicence).not.toHaveBeenCalled()
    fireEvent.change(number, { target: { value: ' rn  4321 ' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    expect(await screen.findByText('Saved: NMCN ending 4321. Health ID support checks it when it reviews Ikeja Care.')).toBeTruthy()
    expect(api.recordAdministratorLicence).toHaveBeenCalledWith('facility-1', 'NMCN', 'RN 4321')
    expect(await screen.findByText('Saved: NMCN ending 4321. You can change it until Health ID support’s check.')).toBeTruthy()
    expect(api.read).toHaveBeenCalledTimes(2)
  })

  it('offers no own-licence card when support can give the type no clinical role', async () => {
    api.read.mockResolvedValue(pending({ administratorLicenceBodies: [] }))
    open()
    await screen.findByText('You can add staff once Health ID support has checked Ikeja Care.')
    expect(screen.queryByRole('heading', { name: 'Your own clinical access' })).toBeNull()
  })

  it('reads the page again when support’s check happened meanwhile', async () => {
    api.read.mockResolvedValueOnce(pending()).mockResolvedValue(staff())
    api.recordAdministratorLicence.mockRejectedValueOnce(new HidApiError(409, 'Reviewed', { code: 'FACILITY_ALREADY_REVIEWED' }))
    open()
    const card = (await screen.findByRole('heading', { name: 'Your own clinical access' })).closest('form')!
    fireEvent.change(within(card).getByLabelText(/^Licence number/), { target: { value: 'MDCN/12345' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    expect((await screen.findAllByText('Health ID support has already checked Ikeja Care. To change your own clinical access '
      + 'now, contact Health ID support.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
  })
})

describe('inviting staff', () => {
  async function openInvite(answer = staff()) {
    api.read.mockResolvedValue(answer)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Invite a member of staff' }))
    return (await screen.findByRole('heading', { name: 'Invite a member of staff', level: 3 })).closest('form')!
  }

  function fill(form: HTMLElement, { name = 'Emeka Obi', email = ' Emeka@IkejaCare.example ', role = 'doctor', number = 'mdcn/777',
    attest = true, password = 'my password' } = {}) {
    fireEvent.change(within(form).getByLabelText(/^Full name/), { target: { value: name } })
    fireEvent.change(within(form).getByLabelText(/^Work email/), { target: { value: email } })
    fireEvent.change(within(form).getByLabelText(/^Role/), { target: { value: role } })
    if (role !== 'receptionist' && role) fireEvent.change(within(form).getByLabelText(/^Licence number/), { target: { value: number } })
    if (attest) fireEvent.click(within(form).getByRole('checkbox'))
    fireEvent.change(within(form).getByLabelText(/^Your password, to confirm/), { target: { value: password } })
  }

  it('says what the facility may send today, and its first 30 days', async () => {
    api.read.mockResolvedValue(staff({}, { firstThirtyDaysEndAt: '2026-11-23T12:00:00.000Z' }))
    open()
    expect(await screen.findByText('In its first 30 days on Health ID, Ikeja Care can send 30 invitations a day. Ask Health ID '
      + 'support if you need more.')).toBeTruthy()
    expect(screen.getByText(/^Today:/).textContent).toBe('Today: 2 of 30 invitations and 3 of 60 invitation emails. Waiting: 1 of 100.')
  })

  it('offers the type’s roles, fixes the licence to the role, fills the confirmation, and sends one invitation', async () => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: '2026-11-01T09:30:00.000Z',
      deliveryOutcome: 'accepted', replayed: false })
    const form = await openInvite()
    expect([...(within(form).getByLabelText(/^Role/) as HTMLSelectElement).options].map(option => option.textContent))
      .toEqual(['Choose a role', 'Doctor', 'Nurse', 'Laboratory scientist', 'Pharmacist', 'Receptionist'])
    fill(form)
    expect(within(form).getByText('Licence: MDCN (Medical and Dental Council of Nigeria)')).toBeTruthy()
    expect(within(form).getByRole('checkbox').closest('label')?.textContent?.trim()).toBe('I confirm that Emeka Obi works at Ikeja '
      + 'Care and, for a clinical role, that I have seen their current practising licence with the number entered above. Health '
      + 'ID records this confirmation with my name, and Health ID support may check it.')
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Invitation sent to emeka@ikejacare.example.')).toBeTruthy()
    expect(api.invite).toHaveBeenCalledTimes(1)
    const [facilityId, input, key] = api.invite.mock.calls[0]!
    expect(facilityId).toBe('facility-1')
    expect(input).toEqual({ name: 'Emeka Obi', email: 'emeka@ikejacare.example', role: 'doctor', licenceBody: 'MDCN',
      licenceNumber: 'MDCN/777', currentPassword: 'my password' })
    expect(key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/)
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: 'Invite a member of staff', level: 3 })).toBeNull()
  })

  it('sends no licence for a receptionist', async () => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: 'accepted', replayed: false })
    const form = await openInvite()
    fill(form, { role: 'receptionist', name: 'Tunde Bello', email: 'tunde@ikejacare.example' })
    expect(within(form).queryByLabelText(/^Licence number/)).toBeNull()
    expect(within(form).getByText('A receptionist needs no licence.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    await screen.findByText('Invitation sent to tunde@ikejacare.example.')
    expect(api.invite.mock.calls[0]![1]).toEqual({ name: 'Tunde Bello', email: 'tunde@ikejacare.example', role: 'receptionist',
      currentPassword: 'my password' })
  })

  it.each([
    [{ name: 'Dr. Emeka Obi' }, 'Enter the person’s first name and surname, as on their licence: letters only, with no title, digits '
      + 'or punctuation other than an apostrophe or hyphen.'],
    [{ name: 'Emeka' }, 'Enter the person’s first name and surname, as on their licence: letters only, with no title, digits or '
      + 'punctuation other than an apostrophe or hyphen.'],
    [{ name: 'Health ID Support' }, 'A name can’t include the words Health ID, HID, support, admin, administrator or ministry.'],
    [{ email: 'emeka@' }, 'Enter the person’s work email address.'],
    [{ number: 'MDCN/' }, 'Enter the MDCN licence number. Letters, digits, spaces, slashes, dots and hyphens, as on the licence.'],
    [{ attest: false }, 'Tick the box to confirm.'],
    [{ password: '' }, 'Enter your password.'],
  ])('refuses %o before sending', async (change, text) => {
    const form = await openInvite()
    fill(form, change)
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    expect(await within(form).findByText(text)).toBeTruthy()
    expect(api.invite).not.toHaveBeenCalled()
  })

  it('sends a name as Identity takes it: one space, a plain apostrophe', () => {
    expect(normalizePersonName('  Ọlá   O’Brien-Adébáyọ̀ ')).toBe('Ọlá O\'Brien-Adébáyọ̀')
    expect(personNameProblem('  Ọlá   O’Brien-Adébáyọ̀ ')).toBeNull()
    expect(personNameProblem('Ada Obi 2')).not.toBeNull()
    expect(personNameProblem('ada@obi.com')).not.toBeNull()
  })

  it.each([
    ['definitive_failure', 'The invitation to emeka@ikejacare.example couldn’t be delivered. Check the address: if it’s wrong, '
      + 'revoke this invitation and invite the right one.'],
    ['unknown', 'The invitation was created, but we couldn’t confirm that the email to emeka@ikejacare.example was delivered. If '
      + 'it doesn’t arrive, send it again in a minute.'],
  ])('says when the email was %s', async (outcome, text) => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: outcome, replayed: false })
    const form = await openInvite()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText(text)).toBeTruthy()
  })

  it('says a replayed invitation was already sent', async () => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: 'unknown', replayed: true })
    const form = await openInvite()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('This invitation was already sent to emeka@ikejacare.example.')).toBeTruthy()
  })

  it('keeps the form’s key for a retry after a fault, and takes a new one only when Identity says the key is used', async () => {
    api.invite.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))
      .mockRejectedValueOnce(new HidApiError(409, 'Reused', { code: 'IDEMPOTENCY_KEY_REUSED' }))
      .mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: 'accepted', replayed: false })
    const form = await openInvite()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    expect(await within(form).findByText('Staff management is temporarily unavailable. Please try again in a few minutes.')).toBeTruthy()
    // The password is not kept after a refusal.
    expect((within(form).getByLabelText(/^Your password, to confirm/) as HTMLInputElement).value).toBe('')
    fireEvent.change(within(form).getByLabelText(/^Your password, to confirm/), { target: { value: 'my password' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    expect(await within(form).findByText('This invitation changed while it was being sent. Check the details and send it again.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText(/^Your password, to confirm/), { target: { value: 'my password' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    await screen.findByText('Invitation sent to emeka@ikejacare.example.')
    const keys = api.invite.mock.calls.map(call => call[2])
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
  })

  it.each([
    ['STAFF_REAUTHENTICATION_FAILED', 403, 'That password isn’t right.', false],
    ['STAFF_RECENT_RECOVERY_HOLD', 403, 'Your account was recovered with a code in the last 24 hours. You can add staff and change '
      + 'roles again once 24 hours have passed.', false],
    ['STAFF_INVITATION_RECIPIENT_LIMIT', 429, 'This person has been invited too often recently. Try again later.', false],
    ['STAFF_INVITATION_DAILY_LIMIT', 429, 'Ikeja Care can send 30 invitations and 60 invitation emails a day, and has reached that '
      + 'limit. Try again later.', false],
    ['STAFF_INVITATION_PENDING_LIMIT', 409, 'Ikeja Care already has 100 invitations waiting. Revoke the ones no longer needed, then '
      + 'try again.', false],
    ['STAFF_INVITATION_ALREADY_MEMBER', 409, 'This person already works at Ikeja Care.', false],
    ['STAFF_INVITATION_SELF', 409, 'You can’t invite yourself.', false],
    ['STAFF_INVITATION_DELIVERY_PAUSED', 429, 'Too many invitations from Ikeja Care could not be delivered in the last day. Check '
      + 'the addresses; you can send again later.', true],
    ['STAFF_INVITATIONS_UNAVAILABLE', 423, 'Adding staff is paused by Health ID. Try again later.', true],
    ['FACILITY_REVIEW_PENDING', 409, 'You can add staff once Health ID support has checked Ikeja Care.', true],
  ])('says %s in its own words', async (code, status, text, refreshes) => {
    api.invite.mockRejectedValueOnce(new HidApiError(status, 'Identity’s detail', { code }))
    const form = await openInvite()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }))
    expect(await within(form).findByText(text)).toBeTruthy()
    if (refreshes) await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    else expect(api.read).toHaveBeenCalledTimes(1)
    // Never whether the email has a Health ID account.
    expect(document.body.textContent).not.toMatch(/has an account|already has a Health ID/)
  })

  it.each([
    [{ invitationsOpen: false }, {}, 'Adding staff is paused by Health ID. Try again later.'],
    [{ deliveryPaused: true }, {}, 'Too many invitations from Ikeja Care could not be delivered in the last day. Check the '
      + 'addresses; you can send again later.'],
    [{}, { pendingInvitations: 100 }, 'Ikeja Care already has 100 invitations waiting. Revoke the ones no longer needed before you '
      + 'invite anyone else.'],
    [{}, { invitationsToday: 30 }, 'Ikeja Care has sent as many invitations as it can for now (30 invitations and 60 invitation '
      + 'emails a day). Try again later.'],
  ])('says why it can’t invite now (%o, %o)', async (facility, limits, text) => {
    api.read.mockResolvedValue(staff({ canInvite: false, limits: { ...staff().limits, ...limits } }, facility))
    open()
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite a member of staff' })).toBeNull()
  })
})

describe('members', () => {
  it('lists each with role words and the licence vouched for, and manages neither the administrator nor oneself', async () => {
    api.read.mockResolvedValue(staff())
    open()
    const self = await memberRow('Bola Adewale')
    expect(within(self).getByText('Facility administrator, Doctor')).toBeTruthy()
    expect(within(self).getByText(/^Licence: MDCN ending 2345, checked by Health ID support on /)).toBeTruthy()
    expect(within(self).queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(within(self).queryByRole('button', { name: 'Change role' })).toBeNull()
    const other = await memberRow('Ngozi Okafor')
    expect(within(other).getByText('Nurse')).toBeTruthy()
    expect(within(other).getByText(/^Licence: NMCN ending 8765, vouched by Bola Adewale on /)).toBeTruthy()
    expect(within(other).getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('removes a member with a reason and the password, after saying what removing does', async () => {
    api.read.mockResolvedValue(staff())
    api.end.mockResolvedValueOnce({ version: 4, endedAt: '2026-10-25T11:00:00.000Z', grantsRevoked: 2 })
    open()
    const row = await memberRow('Ngozi Okafor')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(within(row).getByText(/will lose access/).textContent).toBe('Ngozi Okafor will lose access to Ikeja Care at once. Their '
      + 'patients’ consents to this facility end, and Lab or Pharmacy work they accepted stays assigned to them.')
    fireEvent.change(within(row).getByLabelText(/^Reason for removing them/), { target: { value: 'Left the facility in October.' } })
    fireEvent.change(within(row).getByLabelText(/^Your password, to confirm/), { target: { value: 'my password' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Remove from facility' }))
    expect(await within(row).findByText('Tick the box to confirm.')).toBeTruthy()
    expect(api.end).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByLabelText('Remove Ngozi Okafor from Ikeja Care'))
    fireEvent.click(within(row).getByRole('button', { name: 'Remove from facility' }))
    expect(await screen.findByText('Ngozi Okafor no longer has access to Ikeja Care. 2 patient consents to them ended.')).toBeTruthy()
    expect(api.end).toHaveBeenCalledWith('facility-1', expect.objectContaining({ membershipId: nurse().membershipId, version: 3 }),
      'Left the facility in October.', 'my password')
  })

  it('changes a member’s role with the new licence, the confirmation, a reason and the password', async () => {
    api.read.mockResolvedValue(staff())
    api.changeRole.mockResolvedValueOnce({ version: 4, roleCode: 'doctor' })
    open()
    const row = await memberRow('Ngozi Okafor')
    fireEvent.click(within(row).getByRole('button', { name: 'Change role' }))
    fireEvent.change(within(row).getByLabelText(/^Role/), { target: { value: 'doctor' } })
    fireEvent.change(within(row).getByLabelText(/^Licence number/), { target: { value: 'mdcn 555' } })
    fireEvent.click(within(row).getByRole('checkbox'))
    fireEvent.change(within(row).getByLabelText(/^Reason for the change/), { target: { value: 'Qualified as a doctor.' } })
    fireEvent.change(within(row).getByLabelText(/^Your password, to confirm/), { target: { value: 'my password' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Change role' }))
    expect(await screen.findByText('Ngozi Okafor is now a doctor at Ikeja Care.')).toBeTruthy()
    expect(api.changeRole).toHaveBeenCalledWith('facility-1', expect.objectContaining({ version: 3 }), { role: 'doctor',
      licenceBody: 'MDCN', licenceNumber: 'MDCN 555', reason: 'Qualified as a doctor.', currentPassword: 'my password' })
  })

  it('reads the list again when the member changed meanwhile', async () => {
    api.read.mockResolvedValue(staff())
    api.end.mockRejectedValueOnce(new HidApiError(409, 'Conflict', { code: 'VERSION_CONFLICT' }))
    open()
    const row = await memberRow('Ngozi Okafor')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    fireEvent.change(within(row).getByLabelText(/^Reason for removing them/), { target: { value: 'Left the facility in October.' } })
    fireEvent.change(within(row).getByLabelText(/^Your password, to confirm/), { target: { value: 'my password' } })
    fireEvent.click(within(row).getByLabelText('Remove Ngozi Okafor from Ikeja Care'))
    fireEvent.click(within(row).getByRole('button', { name: 'Remove from facility' }))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect((await screen.findAllByText('This changed while you were working on it. The list has been refreshed: check it and try again.'))
      .length).toBeGreaterThan(0)
  })
})

describe('invitations', () => {
  it('shows each with its reference, expiry and delivery, and sends one again only once Identity allows', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-25T09:30:30.000Z') })
    try {
      api.read.mockResolvedValue(staff({ invitations: [invitation(), invitation({ invitationId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
        name: 'Ada Eze', email: 'ada@x.example', deliveryOutcome: 'definitive_failure', resendAvailableAt: '2026-10-25T09:00:00.000Z' }),
      invitation({ invitationId: '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f', name: 'Ola Ade', email: 'ola@x.example',
        deliveryOutcome: 'unknown', resendAvailableAt: null })] }))
      api.resend.mockResolvedValueOnce({ version: 2, expiresAt: '2026-11-01T09:00:00.000Z', deliveryOutcome: 'accepted' })
      open()
      const first = await memberRow('Emeka Obi')
      expect(within(first).getByText(/^Reference 0F2B6D0E · Sent .+ · Expires .+$/)).toBeTruthy()
      expect(within(first).getByText('Delivery: Sent')).toBeTruthy()
      expect((within(first).getByRole('button', { name: 'Send again' }) as HTMLButtonElement).disabled).toBe(true)
      expect(within(first).getByText(/^You can send it again at /)).toBeTruthy()
      expect(within(await memberRow('Ada Eze')).getByText('Delivery: Not delivered: check the address')).toBeTruthy()
      expect(within(await memberRow('Ola Ade')).getByText('Delivery: Delivery not confirmed')).toBeTruthy()
      const failed = await memberRow('Ada Eze')
      fireEvent.click(within(failed).getByRole('button', { name: 'Send again' }))
      expect(await screen.findByText('Invitation sent again to ada@x.example.')).toBeTruthy()
      expect(api.resend).toHaveBeenCalledWith('facility-1', expect.objectContaining({ version: 1, invitationId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e' }))
    } finally { vi.useRealTimers() }
  })

  it('revokes only after asking', async () => {
    api.read.mockResolvedValue(staff())
    api.revoke.mockResolvedValueOnce({ version: 2, revokedAt: '2026-10-25T10:00:00.000Z' })
    open()
    const row = await memberRow('Emeka Obi')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
    expect(within(row).getByText(/^Revoke the invitation/).textContent).toBe('Revoke the invitation to emeka@ikejacare.example? The '
      + 'link and code in the email will stop working.')
    expect(api.revoke).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke invitation' }))
    expect(await screen.findByText('The invitation to emeka@ikejacare.example was revoked. Its link and code no longer work.')).toBeTruthy()
    expect(api.revoke).toHaveBeenCalledWith('facility-1', expect.objectContaining({ version: 1 }))
  })

  it('reads the list again when the invitation is no longer waiting', async () => {
    api.read.mockResolvedValue(staff())
    api.revoke.mockRejectedValueOnce(new HidApiError(409, 'Not pending', { code: 'STAFF_INVITATION_NOT_PENDING' }))
    open()
    const row = await memberRow('Emeka Obi')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke invitation' }))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
  })
})

describe('where the Staff page does not apply', () => {
  it('says support manages a governed facility’s staff, without asking Identity', async () => {
    setFacility(undefined)
    open()
    expect(screen.getByText('Health ID support manages who works at Ikeja Care. Contact Health ID support to add or remove staff.')).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
  })

  it('says only the administrator manages staff', async () => {
    setFacility({ review: 'reviewed', organizationType: 'hospital' }, ['ehr.encounter.read'])
    open()
    expect(screen.getByText('Only Ikeja Care’s administrator can manage its staff.')).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
  })

  it.each([
    [new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }), 'Adding staff isn’t set up for your facility. Contact support.'],
    [new HidApiError(403, 'Not available', { code: 'STAFF_MANAGEMENT_NOT_AVAILABLE' }), 'Health ID support manages who works at '
      + 'Ikeja Care. Contact Health ID support to add or remove staff.'],
    [new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }), 'Staff management is temporarily unavailable. Please try '
      + 'again in a few minutes.'],
  ])('answers a refused read: %s', async (refusal, text) => {
    api.read.mockRejectedValue(refusal)
    open()
    expect(await screen.findByText(text)).toBeTruthy()
    cleanup()
  })
})
