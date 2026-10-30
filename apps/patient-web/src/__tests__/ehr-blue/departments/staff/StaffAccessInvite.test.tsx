import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { expectGenericToasts, hospital, openPage, pageNotice, staff, watchToasts } from './staffFixtures'

/**
 * "Invite staff" (admin/staff.png, its prototype's "Invite a staff member" card): the target's name, email and
 * assigned role, with the licence, confirmation and password Identity asks for, and every refusal said in the card.
 */
const session = vi.hoisted(() => ({ facility: undefined as unknown, novu: true }))
const api = vi.hoisted(() => ({ read: vi.fn(), recordAdministratorLicence: vi.fn(), invite: vi.fn(), resend: vi.fn(),
  revoke: vi.fn(), end: vi.fn(), changeRole: vi.fn() }))
const stray = vi.hoisted(() => ({ touched: [] as string[] }))
vi.mock('../../../../staff/api', () => ({
  facilityStaffApi: api,
  staffApi: new Proxy({}, { get: (_target, key) => { if (typeof key === 'string' && key !== 'then') stray.touched.push(key); return undefined } }),
}))
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility as never) }
})
vi.mock('../../../../backendContract', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usesNovuBackend: () => session.novu,
}))

const HOSPITAL = '98d00002-0000-4000-8000-000000000001'

let toasts: ReturnType<typeof watchToasts>
beforeEach(() => {
  vi.resetAllMocks()
  session.facility = hospital()
  session.novu = true
  stray.touched = []
  toasts = watchToasts()
})
afterEach(() => expectGenericToasts(toasts))

async function openInvite(answer = staff()) {
  api.read.mockResolvedValue(answer)
  openPage()
  const toggle = await screen.findByRole('button', { name: 'Invite staff' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  const card = screen.getByRole('heading', { name: 'Invite a staff member', level: 2 }).closest('section')!
  expect(toggle.getAttribute('aria-controls')).toBe(card.id)
  return card
}

function fill(card: HTMLElement, { name = 'Demo Doctor', email = ' Demo.Doctor@Example.test ', role = 'doctor', number = 'mdcn/777',
  attest = true, password = 'demo password' } = {}) {
  fireEvent.change(within(card).getByLabelText(/^Name/), { target: { value: name } })
  fireEvent.change(within(card).getByLabelText(/^Email/), { target: { value: email } })
  fireEvent.change(within(card).getByLabelText(/^Assigned role/), { target: { value: role } })
  if (role && role !== 'receptionist') fireEvent.change(within(card).getByLabelText(/^Licence number/), { target: { value: number } })
  if (attest) fireEvent.click(within(card).getByRole('checkbox'))
  fireEvent.change(within(card).getByLabelText(/^Current password/), { target: { value: password } })
}

const send = (card: HTMLElement) => fireEvent.click(within(card).getByRole('button', { name: 'Create invitation' }))

describe('what the facility may send', () => {
  it('says its first 30 days and today’s counts', async () => {
    const card = await openInvite(staff({}, { firstThirtyDaysEndAt: '2026-11-23T12:00:00.000Z' }))
    expect(screen.getByText('In its first 30 days on Health ID, Demo Hospital can send 30 invitations a day. Ask Health ID '
      + 'support if you need more.')).toBeTruthy()
    expect(within(card).getByText(/^They get an email/).textContent).toBe('They get an email with a link to join Demo Hospital. '
      + 'The invitation lasts 7 days. Today: 2 of 30 invitations and 3 of 60 emails. Waiting: 1 of 100.')
  })

  it.each([
    [{ invitationsOpen: false }, {}, 'Adding staff is paused by Health ID. Try again later.'],
    [{ deliveryPaused: true }, {}, 'Too many invitations from Demo Hospital couldn’t be delivered in the last day. Check the '
      + 'addresses; you can invite again later.'],
    [{}, { pendingInvitations: 100 }, 'Demo Hospital already has 100 invitations waiting. Revoke the ones no longer needed before '
      + 'you invite anyone else.'],
    [{}, { invitationsToday: 30 }, 'Demo Hospital has sent as many invitations as it can for now (30 invitations and 60 '
      + 'invitation emails a day). Try again later.'],
  ])('says why it can’t invite now (%o, %o) and keeps the button unavailable', async (facility, limits, text) => {
    api.read.mockResolvedValue(staff({ canInvite: false, limits: { ...staff().limits, ...limits } }, facility))
    openPage()
    const reason = await screen.findByText(text)
    const toggle = screen.getByRole('button', { name: 'Invite staff' }) as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute('aria-describedby')).toBe(reason.closest('[id]')!.id)
    expect(screen.queryByRole('heading', { name: 'Invite a staff member' })).toBeNull()
  })
})

describe('inviting', () => {
  it('shows the target fields, fixes the licence to the role, fills the confirmation, and sends one invitation', async () => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: '2026-11-06T09:30:00.000Z',
      deliveryOutcome: 'accepted', replayed: false })
    const card = await openInvite()
    const role = within(card).getByLabelText(/^Assigned role/) as HTMLSelectElement
    expect([...role.options].map(option => option.textContent))
      .toEqual(['Select…', 'Doctor', 'Nurse', 'Laboratory scientist', 'Pharmacist', 'Receptionist'])
    expect(within(card).queryByLabelText(/^Licence number/)).toBeNull()
    fill(card)
    const licence = within(card).getByLabelText(/^Licence number/)
    expect(document.getElementById(licence.getAttribute('aria-describedby')!)?.textContent).toBe('MDCN: Medical and Dental Council of Nigeria')
    expect(within(card).getByRole('checkbox').closest('label')?.textContent).toBe('I confirm that Demo Doctor works at Demo Hospital '
      + 'and, for a clinical role, that I have seen their current practising licence with the number entered above. Health ID '
      + 'records this confirmation with my name, and Health ID support may check it. *')
    send(card)
    await waitFor(() => expect(api.invite).toHaveBeenCalledTimes(1))
    const [facilityId, input, key] = api.invite.mock.calls[0]!
    expect(facilityId).toBe(HOSPITAL)
    expect(input).toEqual({ name: 'Demo Doctor', email: 'demo.doctor@example.test', role: 'doctor', licenceBody: 'MDCN',
      licenceNumber: 'MDCN/777', currentPassword: 'demo password' })
    expect(key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/)
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Invitation created'))
    expect(pageNotice()).toBe('')
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    // The card closes, as on the target, and focus goes back to the button that opened it.
    expect(screen.queryByRole('heading', { name: 'Invite a staff member' })).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Invite staff' })
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    for (const name of ['recordAdministratorLicence', 'resend', 'revoke', 'end', 'changeRole'] as const) expect(api[name]).not.toHaveBeenCalled()
    expect(stray.touched).toEqual([])
  })

  it('closes and opens again from its button, as the target toggles it', async () => {
    const card = await openInvite()
    expect(card).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }))
    expect(screen.queryByRole('heading', { name: 'Invite a staff member' })).toBeNull()
  })

  it('sends no licence for a receptionist', async () => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: 'accepted', replayed: false })
    const card = await openInvite()
    fill(card, { role: 'receptionist', name: 'Demo Receptionist', email: 'demo.reception@example.test' })
    expect(within(card).queryByLabelText(/^Licence number/)).toBeNull()
    send(card)
    await waitFor(() => expect(api.invite).toHaveBeenCalledTimes(1))
    expect(api.invite.mock.calls[0]![1]).toEqual({ name: 'Demo Receptionist', email: 'demo.reception@example.test', role: 'receptionist',
      currentPassword: 'demo password' })
  })

  it.each([
    [{ name: '' }, 'Name', 'Complete this field.'],
    [{ name: 'Dr. Demo Doctor' }, 'Name', 'Enter the person’s first name and surname, as on their licence: letters only, with no '
      + 'title, digits or punctuation other than an apostrophe or hyphen.'],
    [{ name: 'Demo' }, 'Name', 'Enter the person’s first name and surname, as on their licence: letters only, with no title, digits '
      + 'or punctuation other than an apostrophe or hyphen.'],
    [{ name: 'Health ID Support' }, 'Name', 'A name can’t include the words Health ID, HID, support, admin, administrator or ministry.'],
    [{ email: '' }, 'Email', 'Complete this field.'],
    [{ email: 'demo@' }, 'Email', 'Enter a valid email address.'],
    [{ role: '' }, 'Assigned role', 'Complete this field.'],
    [{ number: '' }, 'Licence number', 'Complete this field.'],
    [{ number: 'MDCN/' }, 'Licence number', 'Enter the MDCN licence number as it is on the licence: letters, digits, spaces, slashes, '
      + 'dots and hyphens.'],
    [{ attest: false }, 'I confirm', 'Complete this field.'],
    [{ password: '' }, 'Current password', 'Complete this field.'],
  ])('refuses %o before sending, and puts focus on the field', async (change, label, text) => {
    const card = await openInvite()
    fill(card, change)
    send(card)
    expect(within(card).getByText(text)).toBeTruthy()
    const field = label === 'I confirm' ? within(card).getByRole('checkbox') : within(card).getByLabelText(new RegExp(`^${label}`))
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toBe(text)
    expect(api.invite).not.toHaveBeenCalled()
  })

  it('clears a field’s problem as it is changed', async () => {
    const card = await openInvite()
    send(card)
    expect(within(card).getAllByText('Complete this field.').length).toBe(5)
    fireEvent.change(within(card).getByLabelText(/^Name/), { target: { value: 'Demo Doctor' } })
    expect(within(card).getAllByText('Complete this field.').length).toBe(4)
  })

  it.each([
    ['definitive_failure', 'The invitation to demo.doctor@example.test couldn’t be delivered. Check the address: if it’s wrong, revoke '
      + 'this invitation and invite the right one.'],
    ['unknown', 'The invitation was created, but we couldn’t confirm that the email to demo.doctor@example.test was delivered. If it '
      + 'doesn’t arrive, resend it in a minute.'],
  ])('says in a caution banner, with no toast, when the email was %s', async (outcome, text) => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: outcome, replayed: false })
    const card = await openInvite()
    fill(card)
    send(card)
    await waitFor(() => expect(pageNotice()).toBe(text))
    const banner = document.getElementById('ehr-staff-notice')!
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.querySelector('.hid-ehr-dept-notice-caution')).toBeTruthy()
    for (const spy of Object.values(toasts)) expect(spy).not.toHaveBeenCalled()
  })

  it('says a replayed invitation was already sent in a banner, with no toast', async () => {
    api.invite.mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: 'unknown', replayed: true })
    const card = await openInvite()
    fill(card)
    send(card)
    await waitFor(() => expect(pageNotice()).toBe('This invitation was already sent to demo.doctor@example.test.'))
    for (const spy of Object.values(toasts)) expect(spy).not.toHaveBeenCalled()
  })

  it('keeps the form’s key for a retry after a fault, and takes a new one only when Identity says the key is used', async () => {
    api.invite.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))
      .mockRejectedValueOnce(new HidApiError(409, 'Reused', { code: 'IDEMPOTENCY_KEY_REUSED' }))
      .mockResolvedValueOnce({ invitationId: 'i-2', version: 1, expiresAt: null, deliveryOutcome: 'accepted', replayed: false })
    const card = await openInvite()
    fill(card)
    send(card)
    expect((await within(card).findByRole('alert')).textContent).toBe('Staff management is temporarily unavailable. Please try again '
      + 'in a few minutes.')
    expect(within(card).getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeTruthy()
    // The password is not kept after a refusal.
    const password = within(card).getByLabelText(/^Current password/) as HTMLInputElement
    expect(password.value).toBe('')
    fireEvent.change(password, { target: { value: 'demo password' } })
    send(card)
    await within(card).findByText('This invitation changed while it was being sent. Check the details and send it again.')
    fireEvent.change(password, { target: { value: 'demo password' } })
    send(card)
    await waitFor(() => expect(api.invite).toHaveBeenCalledTimes(3))
    const keys = api.invite.mock.calls.map(call => call[2])
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
  })

  it.each([
    ['STAFF_REAUTHENTICATION_FAILED', 403, 'That password isn’t right.', false],
    ['STAFF_RECENT_RECOVERY_HOLD', 403, 'Your account was recovered with a code in the last 24 hours. You can add staff and change '
      + 'roles again once 24 hours have passed.', false],
    ['STAFF_INVITATION_RECIPIENT_LIMIT', 429, 'This person has been invited too often recently. Try again later.', false],
    ['STAFF_INVITATION_DAILY_LIMIT', 429, 'Demo Hospital can send 30 invitations and 60 invitation emails a day, and has reached that '
      + 'limit. Try again later.', false],
    ['STAFF_INVITATION_PENDING_LIMIT', 409, 'Demo Hospital already has 100 invitations waiting. Revoke the ones no longer needed, then '
      + 'try again.', false],
    ['STAFF_INVITATION_ALREADY_MEMBER', 409, 'This person already works at Demo Hospital.', false],
    ['STAFF_INVITATION_SELF', 409, 'You can’t invite yourself.', false],
    ['STAFF_INVITATION_ROLE_NOT_ALLOWED', 409, 'Demo Hospital can’t invite someone in this role.', false],
    ['VALIDATION_FAILED', 400, 'Some details weren’t accepted. Check the name, email address and licence number, then try again.', false],
    ['STAFF_INVITATION_ALREADY_PENDING', 409, 'An invitation to this email address is already waiting. Send that one again instead.', true],
    ['STAFF_INVITATION_DELIVERY_PAUSED', 429, 'Too many invitations from Demo Hospital could not be delivered in the last day. Check '
      + 'the addresses; you can send again later.', true],
    ['STAFF_INVITATIONS_UNAVAILABLE', 423, 'Adding staff is paused by Health ID. Try again later.', true],
    ['FACILITY_REVIEW_PENDING', 409, 'You can add staff once Health ID support has checked Demo Hospital.', true],
  ])('says %s in the card, and reads the list again when it was out of date', async (code, status, text, refreshes) => {
    api.invite.mockRejectedValueOnce(new HidApiError(status, 'Identity’s detail', { code }))
    const card = await openInvite()
    fill(card)
    send(card)
    expect((await within(card).findByRole('alert')).textContent).toBe(text)
    if (refreshes) {
      await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
      expect(document.getElementById('ehr-staff-problem')?.textContent).toBe(text)
    } else {
      expect(api.read).toHaveBeenCalledTimes(1)
      expect(document.getElementById('ehr-staff-problem')).toBeNull()
    }
    // Never whether the email has a Health ID account.
    expect(document.body.textContent).not.toMatch(/has an account|already has a Health ID/)
  })
})

describe('the password field', () => {
  it('shows the password with the eye inside it, and masks it again as the form is sent', async () => {
    api.invite.mockRejectedValue(new HidApiError(403, 'Wrong', { code: 'STAFF_REAUTHENTICATION_FAILED' }))
    const card = await openInvite()
    const password = within(card).getByLabelText(/^Current password/) as HTMLInputElement
    expect(password.type).toBe('password')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
    expect((card.querySelector('input[autocomplete="username"]') as HTMLInputElement).value).toBe('demo.scientist@example.test')
    const eye = within(card).getByRole('button', { name: 'Show current password' })
    expect(eye.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(eye)
    expect(password.type).toBe('text')
    expect(within(card).getByRole('button', { name: 'Hide current password' }).getAttribute('aria-pressed')).toBe('true')
    fill(card, { attest: true })
    fireEvent.submit(password.form!)
    await waitFor(() => expect(password.type).toBe('password'))
  })
})
