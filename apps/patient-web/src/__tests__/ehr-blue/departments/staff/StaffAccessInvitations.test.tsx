import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { expectGenericToasts, hospital, invitation, openPage, pageNotice, staff, watchToasts } from './staffFixtures'

/**
 * "Invitation lifecycle" (admin/staff.png): rows with Invitation details, Resend and Revoke, the target's bulk bar, and
 * the details drawer, on today's resend and revoke calls with their waits and refusals.
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
const second = (overrides = {}) => invitation({ invitationId: 'invitation-demo-2', reference: 'DEMO0002', name: 'Demo Pharmacist',
  email: 'demo.pharmacist@example.test', roleCode: 'pharmacist', licence: { body: 'PCN', numberHint: '1234' }, ...overrides })

let toasts: ReturnType<typeof watchToasts>
beforeEach(() => {
  vi.resetAllMocks()
  session.facility = hospital()
  session.novu = true
  stray.touched = []
  toasts = watchToasts()
})
afterEach(() => expectGenericToasts(toasts))

async function row(name: string) {
  return (await screen.findByText(name, { selector: 'strong' })).closest('li') as HTMLElement
}

const onlyInvitationCalls = () => {
  for (const name of ['recordAdministratorLicence', 'invite', 'end', 'changeRole'] as const) expect(api[name]).not.toHaveBeenCalled()
  expect(stray.touched).toEqual([])
}

describe('the invitation rows', () => {
  it('shows each with “email · role · status” and offers Resend and Revoke only while it can be used', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation({ status: 'accepted' }), second(),
      invitation({ invitationId: 'invitation-demo-3', name: 'Demo Scientist', email: 'demo.lab@example.test', roleCode: 'lab',
        status: 'revoked' }), invitation({ invitationId: 'invitation-demo-4', name: 'Demo Midwife', email: 'demo.midwife@example.test',
        roleCode: 'nurse', status: 'expired' })] }))
    openPage()
    // Waiting invitations come first.
    const names = [...(await screen.findByRole('heading', { name: 'Invitation lifecycle' })).closest('section')!.querySelectorAll('li strong')]
      .map(name => name.textContent)
    expect(names).toEqual(['Demo Pharmacist', 'Demo Doctor', 'Demo Scientist', 'Demo Midwife'])
    const waiting = await row('Demo Pharmacist')
    expect(within(waiting).getByText('demo.pharmacist@example.test · Pharmacist · pending')).toBeTruthy()
    expect(within(waiting).getByRole('button', { name: 'Invitation details' })).toBeTruthy()
    expect(within(waiting).getByRole('button', { name: 'Resend' })).toBeTruthy()
    expect(within(waiting).getByRole('button', { name: 'Revoke' })).toBeTruthy()
    expect(within(waiting).getByRole('checkbox', { name: 'Select invitation for demo.pharmacist@example.test' })).toBeTruthy()
    for (const done of ['Demo Doctor', 'Demo Scientist']) {
      const item = await row(done)
      expect(within(item).getByRole('button', { name: 'Invitation details' })).toBeTruthy()
      expect(within(item).queryByRole('button', { name: 'Resend' })).toBeNull()
      expect(within(item).queryByRole('button', { name: 'Revoke' })).toBeNull()
      expect(within(item).queryByRole('checkbox')).toBeNull()
    }
    expect(within(await row('Demo Doctor')).getByText('demo.doctor@example.test · Doctor · accepted')).toBeTruthy()
    const expired = await row('Demo Midwife')
    expect(within(expired).getByText('demo.midwife@example.test · Nurse · expired')).toBeTruthy()
    expect(within(expired).getByRole('button', { name: 'Resend' })).toBeTruthy()
  })

  it('says when there are none yet', async () => {
    api.read.mockResolvedValue(staff({ invitations: [] }))
    openPage()
    expect(await screen.findByText('No invitations yet')).toBeTruthy()
    expect(screen.getByText('Invite staff to give them access to this facility.')).toBeTruthy()
  })

  // Role names, never role codes (parity report 3.1 #16): a role Health ID has no name for reads "Staff".
  it('reads "Staff" for a role Health ID has no name for, in the row and the drawer, never its code', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation({ roleCode: 'records_officer', licence: null })] }))
    openPage()
    const item = await row('Demo Doctor')
    expect(within(item).getByText('demo.doctor@example.test · Staff · pending')).toBeTruthy()
    fireEvent.click(within(item).getByRole('button', { name: 'Invitation details' }))
    const drawer = screen.getByRole('dialog', { name: 'Invitation details' })
    expect(within(drawer).getByText('demo.doctor@example.test / Staff / pending')).toBeTruthy()
    expect(document.body.textContent).not.toContain('records_officer')
  })

  it('opens the details drawer with what Identity knows of the invitation', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation({ deliveryOutcome: 'definitive_failure', sendCount: 2 })] }))
    openPage()
    const details = within(await row('Demo Doctor')).getByRole('button', { name: 'Invitation details' })
    details.focus()
    fireEvent.click(details)
    const drawer = screen.getByRole('dialog', { name: 'Invitation details' })
    expect(within(drawer).getByRole('heading', { name: 'Demo Doctor', level: 3 })).toBeTruthy()
    expect(within(drawer).getByText('demo.doctor@example.test / Doctor / pending')).toBeTruthy()
    expect(within(drawer).getByText(/^Expires /)).toBeTruthy()
    const facts = Object.fromEntries([...drawer.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(facts).toMatchObject({ Reference: 'DEMO0001', Licence: 'MDCN ending 0777', 'Invited by': 'Demo Administrator', 'Times sent': '2',
      Delivery: 'not delivered: check the address' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(details)
  })
})

describe('sending again', () => {
  it('waits for the time Identity gives, then sends again with the invitation’s version', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation({ resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }),
      second()] }))
    api.resend.mockResolvedValueOnce({ version: 2, expiresAt: '2026-11-06T09:00:00.000Z', deliveryOutcome: 'accepted' })
    openPage()
    const first = await row('Demo Doctor')
    const wait = within(first).getByRole('button', { name: 'Resend' }) as HTMLButtonElement
    expect(wait.disabled).toBe(true)
    expect(within(first).getByText(/^You can resend it at /)).toBeTruthy()
    expect(wait.getAttribute('aria-describedby')).toContain('ehr-staff-invitation-invitation-demo-1-wait')
    const other = await row('Demo Pharmacist')
    const resend = within(other).getByRole('button', { name: 'Resend' })
    resend.focus()
    fireEvent.click(resend)
    await waitFor(() => expect(api.resend).toHaveBeenCalledWith(HOSPITAL, expect.objectContaining({ invitationId: 'invitation-demo-2', version: 1 })))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Invitation sent again'))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    onlyInvitationCalls()
  })

  it('says a refusal in the row, and reads the list again when it was out of date', async () => {
    api.read.mockResolvedValue(staff())
    api.resend.mockRejectedValueOnce(new HidApiError(409, 'Too often', { code: 'STAFF_INVITATION_SEND_LIMIT' }))
      .mockRejectedValueOnce(new HidApiError(409, 'Gone', { code: 'STAFF_INVITATION_NOT_FOUND' }))
    openPage()
    const item = await row('Demo Doctor')
    fireEvent.click(within(item).getByRole('button', { name: 'Resend' }))
    expect((await within(item).findByRole('alert')).textContent).toBe('This invitation has been sent 5 times, the most it can be. Revoke '
      + 'it, then invite the person again.')
    expect(api.read).toHaveBeenCalledTimes(1)
    fireEvent.click(within(item).getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect(document.getElementById('ehr-staff-problem')?.textContent).toBe('This invitation is no longer in the list. The list has '
      + 'been refreshed.')
  })

  it.each([
    ['definitive_failure', 'The invitation to demo.doctor@example.test couldn’t be delivered. Check the address: if it’s wrong, revoke '
      + 'this invitation and invite the right one.'],
    ['unknown', 'The invitation was renewed, but we couldn’t confirm that the email to demo.doctor@example.test was delivered. If it '
      + 'doesn’t arrive, resend it in a minute.'],
  ])('says in a caution banner, with no toast, when the email was %s', async (outcome, text) => {
    api.read.mockResolvedValue(staff())
    api.resend.mockResolvedValueOnce({ version: 2, expiresAt: null, deliveryOutcome: outcome })
    openPage()
    fireEvent.click(within(await row('Demo Doctor')).getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(pageNotice()).toBe(text))
    expect(document.querySelector('#ehr-staff-notice .hid-ehr-dept-notice-caution')).toBeTruthy()
    for (const spy of Object.values(toasts)) expect(spy).not.toHaveBeenCalled()
  })
})

describe('revoking', () => {
  it('asks first, and revokes with the invitation’s version', async () => {
    api.read.mockResolvedValueOnce(staff()).mockResolvedValue(staff({ invitations: [invitation({ status: 'revoked', version: 2 })] }))
    api.revoke.mockResolvedValueOnce({ version: 2, revokedAt: '2026-10-25T10:00:00.000Z' })
    openPage()
    const item = await row('Demo Doctor')
    const revoke = within(item).getByRole('button', { name: 'Revoke' })
    revoke.focus()
    fireEvent.click(revoke)
    const decision = screen.getByRole('alertdialog', { name: 'Revoke this invitation?' })
    expect(decision.textContent).toContain('The invitation link and code sent to demo.doctor@example.test will stop working.')
    expect(api.revoke).not.toHaveBeenCalled()
    fireEvent.click(within(decision).getByRole('button', { name: 'Revoke invitation' }))
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith(HOSPITAL, expect.objectContaining({ invitationId: 'invitation-demo-1', version: 1 })))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Invitation revoked'))
    expect(await within(item).findByText('demo.doctor@example.test · Doctor · revoked')).toBeTruthy()
    // Revoke has gone with the read: focus goes to the row's details.
    await waitFor(() => expect(document.activeElement).toBe(within(item).getByRole('button', { name: 'Invitation details' })))
    onlyInvitationCalls()
  })

  it('keeps the invitation when the decision is cancelled', async () => {
    api.read.mockResolvedValue(staff())
    openPage()
    const revoke = within(await row('Demo Doctor')).getByRole('button', { name: 'Revoke' })
    revoke.focus()
    fireEvent.click(revoke)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(revoke)
    expect(api.revoke).not.toHaveBeenCalled()
  })

  it('reads the list again when the invitation is no longer waiting', async () => {
    api.read.mockResolvedValue(staff())
    api.revoke.mockRejectedValueOnce(new HidApiError(409, 'Not pending', { code: 'STAFF_INVITATION_NOT_PENDING' }))
    openPage()
    const item = await row('Demo Doctor')
    fireEvent.click(within(item).getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke invitation' }))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect(within(item).getByRole('alert').textContent).toBe('This invitation has already been accepted, revoked or has expired. The '
      + 'list has been refreshed.')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('the bulk bar', () => {
  it('appears for selected rows and resends each, in turn', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation(), second()] }))
    api.resend.mockResolvedValue({ version: 2, expiresAt: null, deliveryOutcome: 'accepted' })
    openPage()
    expect(screen.queryByRole('region', { name: 'Selected invitation actions' })).toBeNull()
    fireEvent.click(within(await row('Demo Doctor')).getByRole('checkbox'))
    fireEvent.click(within(await row('Demo Pharmacist')).getByRole('checkbox'))
    const bar = screen.getByRole('region', { name: 'Selected invitation actions' })
    expect(within(bar).getByText('2 selected')).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Resend selected' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('2 invitations sent again'))
    expect(api.resend.mock.calls.map(call => call[1].invitationId)).toEqual(['invitation-demo-1', 'invitation-demo-2'])
    expect(screen.queryByRole('region', { name: 'Selected invitation actions' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Invitation lifecycle' })))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
  })

  it('counts only the delivered ones in the toast, and keeps an address whose email went wrong in the banner', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation(), second()] }))
    api.resend.mockResolvedValueOnce({ version: 2, expiresAt: null, deliveryOutcome: 'accepted' })
      .mockResolvedValueOnce({ version: 2, expiresAt: null, deliveryOutcome: 'definitive_failure' })
    openPage()
    fireEvent.click(within(await row('Demo Doctor')).getByRole('checkbox'))
    fireEvent.click(within(await row('Demo Pharmacist')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Resend selected' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('1 invitation sent again'))
    expect(pageNotice()).toBe('The invitation to demo.pharmacist@example.test couldn’t be delivered. Check the address: if it’s wrong, '
      + 'revoke this invitation and invite the right one.')
    expect(toasts.warning).not.toHaveBeenCalled()
  })

  it('stops at an invitation that must wait, and says so', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation({ resendAvailableAt: new Date(Date.now() + 60_000).toISOString() })] }))
    openPage()
    fireEvent.click(within(await row('Demo Doctor')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Resend selected' }))
    expect((await screen.findByText(/^You can resend the invitation to demo.doctor@example.test at /, { selector: '[role="alert"]' }))).toBeTruthy()
    expect(api.resend).not.toHaveBeenCalled()
  })

  it('revokes the selected after the target’s typed REVOKE decision, and stops at a refusal', async () => {
    api.read.mockResolvedValue(staff({ invitations: [invitation(), second()] }))
    api.revoke.mockResolvedValueOnce({ version: 2, revokedAt: null })
      .mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))
    openPage()
    fireEvent.click(within(await row('Demo Doctor')).getByRole('checkbox'))
    fireEvent.click(within(await row('Demo Pharmacist')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke selected' }))
    const decision = screen.getByRole('alertdialog', { name: 'Revoke selected invitations?' })
    expect(decision.textContent).toContain('These invitation links will stop working.')
    const confirm = within(decision).getByRole('button', { name: 'Revoke invitations' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(decision).getByLabelText('Type REVOKE to confirm'), { target: { value: 'REVOKE' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(api.revoke).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('1 invitation revoked'))
    expect(await screen.findByText('Staff management is temporarily unavailable. Please try again in a few minutes.')).toBeTruthy()
    // The one not revoked stays selected.
    expect(within(screen.getByRole('region', { name: 'Selected invitation actions' })).getByText('1 selected')).toBeTruthy()
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
  })

  it('clears the selection', async () => {
    api.read.mockResolvedValue(staff())
    openPage()
    fireEvent.click(within(await row('Demo Doctor')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Selected invitation actions' })).toBeNull()
    expect((within(await row('Demo Doctor')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Invitation lifecycle' })))
    expect(api.resend).not.toHaveBeenCalled()
    expect(api.revoke).not.toHaveBeenCalled()
  })
})
