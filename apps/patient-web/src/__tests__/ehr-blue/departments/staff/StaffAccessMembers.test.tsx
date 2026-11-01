import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { administrator, expectGenericToasts, hospital, memberRow, nurse, openPage, pageNotice, staff, watchToasts } from './staffFixtures'

/**
 * "Memberships" and its "Edit access" drawer (admin/staff.png, prototype "Staff details and access"): the role change
 * and the removal ("Account access: ended", after the typed DEACTIVATE decision), each with Identity's reason and
 * password.
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

async function openAccess(answer = staff()) {
  api.read.mockResolvedValue(answer)
  openPage()
  const row = await memberRow('Demo Nurse')
  const edit = within(row).getByRole('button', { name: 'Edit access' })
  edit.focus()
  fireEvent.click(edit)
  const drawer = screen.getByRole('dialog', { name: 'Staff details and access' })
  return { row, edit, drawer }
}

function fillRole(drawer: HTMLElement, { role = 'doctor', number = 'mdcn 555', attest = true, reason = 'Qualified as a doctor.',
  password = 'demo password' } = {}) {
  fireEvent.change(within(drawer).getByLabelText(/^Role/), { target: { value: role } })
  if (role && role !== 'receptionist') fireEvent.change(within(drawer).getByLabelText(/^Licence number/), { target: { value: number } })
  if (attest) fireEvent.click(within(drawer).getByRole('checkbox'))
  fireEvent.change(within(drawer).getByLabelText(/^Reason/), { target: { value: reason } })
  fireEvent.change(within(drawer).getByLabelText(/^Current password/), { target: { value: password } })
}

function fillEnd(drawer: HTMLElement, { reason = 'Left the facility in October.', password = 'demo password' } = {}) {
  fireEvent.change(within(drawer).getByLabelText(/^Account access/), { target: { value: 'ended' } })
  fireEvent.change(within(drawer).getByLabelText(/^Reason/), { target: { value: reason } })
  fireEvent.change(within(drawer).getByLabelText(/^Current password/), { target: { value: password } })
}

/** Saves as a pointer or Enter would: the button takes focus, then is pressed. */
function save(drawer: HTMLElement) {
  const button = within(drawer).getByRole('button', { name: 'Save' })
  button.focus()
  fireEvent.click(button)
}

describe('the memberships list', () => {
  it('shows each member with initials, name and “Role · active”, and Edit access only where Identity allows it', async () => {
    api.read.mockResolvedValue(staff())
    openPage()
    const self = await memberRow('Demo Administrator')
    expect(within(self).getByText('DA').getAttribute('aria-hidden')).toBe('true')
    expect(within(self).getByText('Facility administrator, Doctor · active')).toBeTruthy()
    expect(within(self).queryByRole('button', { name: 'Edit access' })).toBeNull()
    const other = await memberRow('Demo Nurse')
    expect(within(other).getByText('DN')).toBeTruthy()
    expect(within(other).getByText('Nurse · active')).toBeTruthy()
    const edit = within(other).getByRole('button', { name: 'Edit access' })
    expect(edit.getAttribute('type')).toBe('button')
    expect(edit.getAttribute('aria-haspopup')).toBe('dialog')
    expect(document.getElementById(edit.getAttribute('aria-describedby')!)?.textContent).toBe('Demo Nurse')
  })

  // Role names, never role codes (parity report 3.1 #16): a role Health ID has no name for reads "Staff".
  it('reads "Staff" for a role Health ID has no name for, in the list and the drawer, never its code', async () => {
    const { row, drawer } = await openAccess(staff({ members: [administrator(), nurse({ roles: ['records_officer'], licence: null })] }))
    expect(within(row).getByText('Staff · active')).toBeTruthy()
    expect(within(drawer).getByText('Staff / demo.nurse@example.test')).toBeTruthy()
    expect(document.body.textContent).not.toContain('records_officer')
  })

  // The administrator decides this member's access, so a second role with no name is counted, not hidden.
  it('counts a role Health ID has no name for beside a named one, in the list and the drawer, never its code', async () => {
    const { row, drawer } = await openAccess(staff({ members: [administrator(), nurse({ roles: ['nurse', 'records_officer'] })] }))
    expect(within(row).getByText('Nurse and another role · active')).toBeTruthy()
    expect(within(drawer).getByText('Nurse and another role / demo.nurse@example.test')).toBeTruthy()
    expect(document.body.textContent).not.toContain('records_officer')
  })

  // Only roles Health ID names are offered: two unnamed roles would read the same, and none says what it grants. A
  // member's own unnamed role stays, as "Current role", so saving keeps it.
  it('offers only named roles to change to, keeping the member’s own unnamed role as “Current role”', async () => {
    const roles = [...staff().inviteOptions.roles, { code: 'records_officer', licenceBody: null }, { code: 'billing', licenceBody: null }]
    const answer = staff({ members: [administrator(), nurse({ roles: ['records_officer'], licence: null })],
      inviteOptions: { ...staff().inviteOptions, roles } })
    const { drawer } = await openAccess(answer)
    const role = within(drawer).getByLabelText(/^Role/) as HTMLSelectElement
    expect([...role.options].map(option => option.textContent))
      .toEqual(['Select…', 'Doctor', 'Nurse', 'Laboratory scientist', 'Pharmacist', 'Receptionist', 'Current role'])
    expect(role.value).toBe('records_officer')
    expect(role.selectedOptions[0]?.textContent).toBe('Current role')
    expect([...role.options].map(option => option.value)).not.toContain('billing')
    expect(document.body.textContent).not.toMatch(/records_officer|billing/)
  })

  it('opens the drawer with the member’s record, and Escape closes it back to Edit access', async () => {
    const { edit, drawer } = await openAccess()
    expect(within(drawer).getByRole('heading', { name: 'Demo Nurse', level: 3 })).toBeTruthy()
    expect(within(drawer).getByText('Nurse / demo.nurse@example.test')).toBeTruthy()
    const facts = [...drawer.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent])
    expect(facts[0]).toEqual(['Licence', 'NMCN ending 8765'])
    expect(facts[1]![0]).toBe('Details')
    expect(facts[1]![1]).toMatch(/^Vouched for by Demo Administrator on /)
    expect(facts[2]![0]).toBe('Joined')
    // The form starts at the member's role and active access.
    expect((within(drawer).getByLabelText(/^Role/) as HTMLSelectElement).value).toBe('nurse')
    expect((within(drawer).getByLabelText(/^Account access/) as HTMLSelectElement).value).toBe('active')
    expect([...(within(drawer).getByLabelText(/^Account access/) as HTMLSelectElement).options].map(option => option.textContent))
      .toEqual(['active', 'ended'])
    // Focus is inside the drawer, on its Close button.
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(edit)
  })

  it('asks before closing a drawer with unsaved changes', async () => {
    const { drawer } = await openAccess()
    fireEvent.change(within(drawer).getByLabelText(/^Reason/), { target: { value: 'Moving to the laboratory.' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(within(drawer).getByRole('heading', { name: 'Discard unsaved changes?' })).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Keep editing' }))
    expect((within(drawer).getByLabelText(/^Reason/) as HTMLTextAreaElement).value).toBe('Moving to the laboratory.')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('changing a role', () => {
  it('sends the new role with its licence, the confirmation, the reason and the password', async () => {
    api.changeRole.mockResolvedValueOnce({ version: 4, roleCode: 'doctor' })
    const { edit, drawer } = await openAccess()
    fillRole(drawer)
    expect(within(drawer).getByRole('checkbox').closest('label')?.textContent).toMatch(/^I confirm that Demo Nurse works at Demo Hospital/)
    save(drawer)
    await waitFor(() => expect(api.changeRole).toHaveBeenCalledWith(HOSPITAL, expect.objectContaining({ membershipId: 'membership-demo-nurse',
      version: 3 }), { role: 'doctor', licenceBody: 'MDCN', licenceNumber: 'MDCN 555', reason: 'Qualified as a doctor.',
      currentPassword: 'demo password' }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Access updated'))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect(document.activeElement).toBe(edit)
    for (const name of ['recordAdministratorLicence', 'invite', 'resend', 'revoke', 'end'] as const) expect(api[name]).not.toHaveBeenCalled()
    expect(stray.touched).toEqual([])
  })

  it('sends no licence for a receptionist', async () => {
    api.changeRole.mockResolvedValueOnce({ version: 4, roleCode: 'receptionist' })
    const { drawer } = await openAccess()
    fillRole(drawer, { role: 'receptionist' })
    expect(within(drawer).queryByLabelText(/^Licence number/)).toBeNull()
    save(drawer)
    await waitFor(() => expect(api.changeRole).toHaveBeenCalledWith(HOSPITAL, expect.anything(), { role: 'receptionist',
      reason: 'Qualified as a doctor.', currentPassword: 'demo password' }))
  })

  it.each([
    [{ role: '' }, 'Role', 'Complete this field.'],
    [{ number: '' }, 'Licence number', 'Complete this field.'],
    [{ number: '/x' }, 'Licence number', 'Enter the MDCN licence number as it is on the licence: letters, digits, spaces, slashes, dots '
      + 'and hyphens.'],
    [{ reason: '' }, 'Reason', 'Complete this field.'],
    [{ reason: 'Moved' }, 'Reason', 'Enter a reason of 8 to 500 characters.'],
    [{ attest: false }, 'I confirm', 'Complete this field.'],
    [{ password: '' }, 'Current password', 'Complete this field.'],
  ])('refuses %o before sending, and puts focus on the field', async (change, label, text) => {
    const { drawer } = await openAccess()
    fillRole(drawer, change)
    save(drawer)
    expect(within(drawer).getByText(text)).toBeTruthy()
    const field = label === 'I confirm' ? within(drawer).getByRole('checkbox') : within(drawer).getByLabelText(new RegExp(`^${label}`))
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(api.changeRole).not.toHaveBeenCalled()
  })

  it.each([
    ['FACILITY_STAFF_ROLE_UNCHANGED', 409, 'This person already has this role and licence.', false],
    ['STAFF_REAUTHENTICATION_FAILED', 403, 'That password isn’t right.', false],
    ['FACILITY_STAFF_PLATFORM_ACCOUNT', 409, 'This person’s account is managed by Health ID support. Contact support to change their '
      + 'access.', false],
    ['VERSION_CONFLICT', 409, 'This changed while you were working on it. The list has been refreshed: check it and try again.', true],
  ])('says %s in the drawer, and reads the list again when it was out of date', async (code, status, text, refreshes) => {
    api.changeRole.mockRejectedValueOnce(new HidApiError(status, 'Identity’s detail', { code }))
    const { drawer } = await openAccess()
    fillRole(drawer)
    save(drawer)
    expect((await within(drawer).findByRole('alert')).textContent).toBe(text)
    expect((within(drawer).getByLabelText(/^Current password/) as HTMLInputElement).value).toBe('')
    if (refreshes) {
      await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
      expect(document.getElementById('ehr-staff-problem')?.textContent).toBe(text)
    } else expect(api.read).toHaveBeenCalledTimes(1)
  })
})

describe('removing a member (Account access: ended)', () => {
  it('asks the target’s typed decision, then removes with the reason and the password', async () => {
    api.read.mockResolvedValueOnce(staff()).mockResolvedValue(staff({ members: [administrator()] }))
    api.end.mockResolvedValueOnce({ version: 4, endedAt: '2026-10-25T11:00:00.000Z', grantsRevoked: 2 })
    openPage()
    fireEvent.click(within(await memberRow('Demo Nurse')).getByRole('button', { name: 'Edit access' }))
    const drawer = screen.getByRole('dialog', { name: 'Staff details and access' })
    fillEnd(drawer)
    // Ending access asks nothing about the role.
    expect(within(drawer).queryByLabelText(/^Role/)).toBeNull()
    expect(within(drawer).queryByRole('checkbox')).toBeNull()
    save(drawer)
    const decision = await screen.findByRole('alertdialog', { name: 'Deactivate this staff membership?' })
    expect(decision.textContent).toContain('Demo Nurse will lose access to Demo Hospital at once. Their patients’ consents to this '
      + 'facility end, and Lab or Pharmacy work they accepted stays assigned to them. Saved records remain available to authorized staff.')
    expect(document.activeElement).toBe(within(decision).getByRole('button', { name: 'Cancel' }))
    const confirm = within(decision).getByRole('button', { name: 'Deactivate staff member' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(decision).getByLabelText('Type DEACTIVATE to confirm'), { target: { value: 'DEACTIVATE' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(api.end).toHaveBeenCalledWith(HOSPITAL, expect.objectContaining({ membershipId: 'membership-demo-nurse',
      version: 3 }), 'Left the facility in October.', 'demo password'))
    // Ended consents are kept on the page, in the banner, with no toast.
    await waitFor(() => expect(pageNotice()).toBe('Demo Nurse no longer has access to Demo Hospital. 2 patient consents to them ended.'))
    expect(toasts.success).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // The member is gone once the list is read again: focus goes to the list's heading.
    const heading = screen.getByRole('heading', { name: 'Memberships' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.queryByText('Demo Nurse', { selector: 'strong' })).toBeNull()
    expect(api.changeRole).not.toHaveBeenCalled()
  })

  it.each([[0, ''], [1, ' 1 patient consent to them ended.']])('counts %i ended consents', async (grantsRevoked, words) => {
    api.end.mockResolvedValueOnce({ version: 4, endedAt: null, grantsRevoked })
    const { drawer } = await openAccess()
    fillEnd(drawer)
    save(drawer)
    const decision = await screen.findByRole('alertdialog')
    fireEvent.change(within(decision).getByLabelText('Type DEACTIVATE to confirm'), { target: { value: 'DEACTIVATE' } })
    fireEvent.click(within(decision).getByRole('button', { name: 'Deactivate staff member' }))
    if (words) {
      await waitFor(() => expect(pageNotice()).toBe(`Demo Nurse no longer has access to Demo Hospital.${words}`))
      expect(toasts.success).not.toHaveBeenCalled()
    } else {
      await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Staff member deactivated'))
      expect(pageNotice()).toBe('')
    }
  })

  it('removes nothing when the decision is cancelled, and keeps the form', async () => {
    const { drawer } = await openAccess()
    fillEnd(drawer)
    save(drawer)
    const decision = await screen.findByRole('alertdialog')
    fireEvent.click(within(decision).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.end).not.toHaveBeenCalled()
    expect((within(drawer).getByLabelText(/^Reason/) as HTMLTextAreaElement).value).toBe('Left the facility in October.')
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Save' }))
  })

  it('needs a reason and the password before asking', async () => {
    const { drawer } = await openAccess()
    fillEnd(drawer, { reason: 'Short', password: '' })
    save(drawer)
    expect(within(drawer).getByText('Enter a reason of 8 to 500 characters.')).toBeTruthy()
    expect(within(drawer).getByText('Complete this field.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Each field keeps its fixed id (a refusal focuses it), and is described only by lines on the page.
    const prefix = 'ehr-staff-access-membership-demo-nurse'
    expect(within(drawer).getByLabelText(/^Account access/).id).toBe(`${prefix}-access`)
    const reason = within(drawer).getByLabelText(/^Reason/)
    expect(reason.id).toBe(`${prefix}-reason`)
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(reason.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a reason of 8 to 500 characters.')
    const password = within(drawer).getByLabelText(/^Current password/)
    expect(password.id).toBe(`${prefix}-password`)
    expect(document.getElementById(password.getAttribute('aria-describedby')!)?.textContent).toBe('Complete this field.')
    expect(within(drawer).getByLabelText(/^Account access/).getAttribute('aria-describedby')).toBeNull()
  })

  it.each([
    ['VERSION_CONFLICT', 'This changed while you were working on it. The list has been refreshed: check it and try again.'],
    ['FACILITY_STAFF_ALREADY_ENDED', 'This person no longer works at Demo Hospital. The list has been refreshed.'],
  ])('says %s and reads the list again', async (code, text) => {
    api.read.mockResolvedValueOnce(staff()).mockResolvedValue(code === 'VERSION_CONFLICT' ? staff({ members: [administrator(),
      nurse({ version: 4 })] }) : staff({ members: [administrator()] }))
    api.end.mockRejectedValueOnce(new HidApiError(409, 'Conflict', { code }))
    openPage()
    fireEvent.click(within(await memberRow('Demo Nurse')).getByRole('button', { name: 'Edit access' }))
    const drawer = screen.getByRole('dialog', { name: 'Staff details and access' })
    fillEnd(drawer)
    save(drawer)
    const decision = await screen.findByRole('alertdialog')
    fireEvent.change(within(decision).getByLabelText('Type DEACTIVATE to confirm'), { target: { value: 'DEACTIVATE' } })
    fireEvent.click(within(decision).getByRole('button', { name: 'Deactivate staff member' }))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    const problem = await screen.findByText(text, { selector: '#ehr-staff-problem' })
    if (code === 'VERSION_CONFLICT') {
      // The member is still listed: the drawer stays, with the refusal, and a retry sends the new version.
      expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe(text)
      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(/^Current password/), { target: { value: 'demo password' } })
      api.end.mockResolvedValueOnce({ version: 5, endedAt: null, grantsRevoked: 0 })
      save(screen.getByRole('dialog'))
      const again = await screen.findByRole('alertdialog')
      fireEvent.change(within(again).getByLabelText('Type DEACTIVATE to confirm'), { target: { value: 'DEACTIVATE' } })
      fireEvent.click(within(again).getByRole('button', { name: 'Deactivate staff member' }))
      await waitFor(() => expect(api.end).toHaveBeenLastCalledWith(HOSPITAL, expect.objectContaining({ version: 4 }),
        'Left the facility in October.', 'demo password'))
    } else {
      // The member has gone: the drawer closes with them, and focus goes to what the page says.
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(problem))
    }
  })
})
