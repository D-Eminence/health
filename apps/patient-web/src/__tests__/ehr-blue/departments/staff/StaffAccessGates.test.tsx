import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { onFacilityStaffChanged } from '../../../../staff/staffAccess'
import { administrator, expectGenericToasts, hospital, memberRow, openPage, pending, staff, watchToasts } from './staffFixtures'

/**
 * Staff & access: who may open it (today's Novu-only route, workforce.manage, a self-signed-up facility), how it loads
 * and fails, and the facility before Health ID support's check.
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

let toasts: ReturnType<typeof watchToasts>
beforeEach(() => {
  vi.resetAllMocks()
  session.facility = hospital()
  session.novu = true
  stray.touched = []
  toasts = watchToasts()
})
afterEach(() => expectGenericToasts(toasts))

const onlyRead = () => {
  for (const name of ['recordAdministratorLicence', 'invite', 'resend', 'revoke', 'end', 'changeRole'] as const) {
    expect(api[name]).not.toHaveBeenCalled()
  }
  expect(stray.touched).toEqual([])
}

describe('who may open Staff & access', () => {
  it('keeps today’s Novu-only route: elsewhere it says so and asks nothing', () => {
    session.novu = false
    openPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Staff & access')
    expect(screen.getByText('Staff & access isn’t available on this Health ID service.')).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
  })

  it('asks for a facility first', () => {
    session.facility = undefined
    openPage()
    expect(screen.getByText('Choose the facility you are working at first.')).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
  })

  it('says only the administrator manages staff, without asking Identity', () => {
    session.facility = hospital(null, ['ehr.encounter.read'])
    openPage()
    expect(screen.getByText('Only Demo Hospital’s administrator can manage its staff.')).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
  })

  it('says Health ID support manages a governed facility’s staff, without asking Identity', () => {
    session.facility = hospital(null)
    openPage()
    expect(screen.getByText('Health ID support manages who works at Demo Hospital. Contact Health ID support to add or remove '
      + 'staff.')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(api.read).not.toHaveBeenCalled()
  })
})

describe('loading', () => {
  it('shows the target heading and a loading status while it reads, then the two cards', async () => {
    let answer: (value: unknown) => void = () => {}
    api.read.mockReturnValue(new Promise(resolve => { answer = resolve }))
    openPage()
    expect(screen.getByText('Hospital memberships')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Staff & access')
    expect(screen.getByRole('status').textContent).toBe('Loading staff and invitations')
    expect(api.read).toHaveBeenCalledWith('98d00002-0000-4000-8000-000000000001')
    answer(staff())
    expect(await screen.findByRole('heading', { name: 'Memberships', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Invitation lifecycle', level: 2 })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Invite staff' })).toBeTruthy()
    onlyRead()
  })

  it.each([
    [new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }), 'Adding staff isn’t available on Health ID yet. Please check again later.', false],
    [new HidApiError(403, 'Not available', { code: 'STAFF_MANAGEMENT_NOT_AVAILABLE' }), 'Health ID support manages who works at '
      + 'Demo Hospital. Contact Health ID support to add or remove staff.', false],
    [new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }), 'Staff management is temporarily unavailable. Please try '
      + 'again in a few minutes.', true],
    [new HidApiError(403, 'Denied', { code: 'PERMISSION_DENIED' }), 'Demo Hospital’s staff couldn’t be loaded. Only Demo Hospital’s '
      + 'administrator can manage its staff.', true],
  ])('answers a refused read: %s', async (refusal, text, retry) => {
    api.read.mockRejectedValue(refusal)
    openPage()
    expect(await screen.findByText(text)).toBeTruthy()
    expect(Boolean(screen.queryByRole('button', { name: 'Try again' }))).toBe(retry)
    if (retry) expect(screen.getByText('Staff couldn’t be loaded')).toBeTruthy()
    onlyRead()
  })

  it('reads again on Try again, and puts focus where the answer is', async () => {
    api.read.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))
      .mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))
      .mockResolvedValue(staff())
    openPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    const again = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(document.activeElement).toBe(again))
    fireEvent.click(again)
    const heading = await screen.findByRole('heading', { name: 'Memberships' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(api.read).toHaveBeenCalledTimes(3)
  })
})

describe('before Health ID support’s check', () => {
  beforeEach(() => { session.facility = hospital({ review: 'pending', organizationType: 'hospital' }) })

  it('shows the administrator alone, says staff come after the check, and offers no change', async () => {
    api.read.mockResolvedValue(pending())
    openPage()
    expect(await screen.findByText('You can add staff once Health ID support has checked Demo Hospital.')).toBeTruthy()
    const invite = screen.getByRole('button', { name: 'Invite staff' }) as HTMLButtonElement
    expect(invite.disabled).toBe(true)
    expect(document.getElementById(invite.getAttribute('aria-describedby')!)?.textContent)
      .toBe('You can add staff once Health ID support has checked Demo Hospital.')
    const self = await memberRow('Demo Administrator')
    expect(within(self).getByText('Facility administrator · active')).toBeTruthy()
    expect(within(self).getByText('DA')).toBeTruthy()
    expect(within(self).queryByRole('button', { name: 'Edit access' })).toBeNull()
    expect(screen.getByText('No invitations yet')).toBeTruthy()
    expect(screen.getByText('You can invite staff once Health ID support has checked Demo Hospital.')).toBeTruthy()
    onlyRead()
  })

  it('lets the administrator record their own licence, from the licences their type allows', async () => {
    api.read.mockResolvedValueOnce(pending()).mockResolvedValue(pending({ administratorLicence: { body: 'NMCN', numberHint: '4321',
      recordedAt: '2026-10-25T10:00:00.000Z' } }))
    api.recordAdministratorLicence.mockResolvedValueOnce({ licenceBody: 'NMCN', numberHint: '4321', recordedAt: '2026-10-25T10:00:00.000Z' })
    const changed = vi.fn()
    const stop = onFacilityStaffChanged(changed)
    openPage()
    const card = (await screen.findByRole('heading', { name: 'Your own clinical access' })).closest('section')!
    expect(within(card).getByText(/^If you are a licensed/).textContent).toBe('If you are a licensed doctor or nurse and will treat '
      + 'patients yourself, enter your licence. Health ID support checks it when it reviews Demo Hospital. Leave it empty to '
      + 'manage the facility and its staff without clinical access yourself.')
    const body = within(card).getByLabelText(/^Licence \*?$/) as HTMLSelectElement
    expect([...body.options].map(option => option.textContent)).toEqual(['Select…', 'MDCN (doctor)', 'NMCN (nurse)'])
    expect(body.value).toBe('MDCN')
    fireEvent.change(body, { target: { value: 'NMCN' } })
    const number = within(card).getByLabelText(/^Licence number/) as HTMLInputElement
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    expect(within(card).getByText('Complete this field.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(number))
    expect(number.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(number, { target: { value: 'rn/' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    expect(within(card).getByText('Enter the NMCN licence number as it is on the licence: letters, digits, spaces, slashes, dots '
      + 'and hyphens.')).toBeTruthy()
    expect(api.recordAdministratorLicence).not.toHaveBeenCalled()
    fireEvent.change(number, { target: { value: ' rn  4321 ' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    await waitFor(() => expect(api.recordAdministratorLicence).toHaveBeenCalledWith('98d00002-0000-4000-8000-000000000001', 'NMCN', 'RN 4321'))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Licence saved'))
    expect(changed).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Saved: NMCN ending 4321. You can change it until Health ID support’s check.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save new licence' })).toBeTruthy()
    expect(api.read).toHaveBeenCalledTimes(2)
    stop()
  })

  it('offers no own-licence card when support can give the type no clinical role', async () => {
    api.read.mockResolvedValue(pending({ administratorLicenceBodies: [] }))
    openPage()
    await screen.findByText('You can add staff once Health ID support has checked Demo Hospital.')
    expect(screen.queryByRole('heading', { name: 'Your own clinical access' })).toBeNull()
  })

  it('reads the page again when support’s check happened meanwhile, and says so at the top', async () => {
    api.read.mockResolvedValueOnce(pending()).mockResolvedValue(staff())
    api.recordAdministratorLicence.mockRejectedValueOnce(new HidApiError(409, 'Reviewed', { code: 'FACILITY_ALREADY_REVIEWED' }))
    openPage()
    const card = (await screen.findByRole('heading', { name: 'Your own clinical access' })).closest('section')!
    fireEvent.change(within(card).getByLabelText(/^Licence number/), { target: { value: 'MDCN/12345' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    const problem = await screen.findByText('Health ID support has already checked Demo Hospital. To change your own clinical access '
      + 'now, contact Health ID support.', { selector: '[role="alert"]' })
    // The card has gone with the check: focus goes to what the page says.
    await waitFor(() => expect(document.activeElement).toBe(problem))
    expect(screen.queryByRole('heading', { name: 'Your own clinical access' })).toBeNull()
  })

  it('says a refusal of the licence in the card, with the target form’s retry line', async () => {
    api.read.mockResolvedValue(pending())
    api.recordAdministratorLicence.mockRejectedValueOnce(new HidApiError(400, 'Invalid', { code: 'ADMINISTRATOR_LICENCE_INVALID' }))
    openPage()
    const card = (await screen.findByRole('heading', { name: 'Your own clinical access' })).closest('section')!
    fireEvent.change(within(card).getByLabelText(/^Licence number/), { target: { value: 'MDCN/12345' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save licence' }))
    expect((await within(card).findByRole('alert')).textContent).toBe('Check the licence number. Use the letters, digits, spaces, '
      + 'slashes, dots and hyphens shown on the licence.')
    expect(within(card).getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeTruthy()
    expect(api.read).toHaveBeenCalledTimes(1)
  })
})

describe('the administrator’s own row', () => {
  it('names their roles in words and offers no change to themselves or another administrator', async () => {
    api.read.mockResolvedValue(staff({ members: [administrator(), administrator({ membershipId: 'membership-demo-admin-2',
      name: 'Demo Director', isSelf: false, email: 'demo.director@example.test' })] }))
    openPage()
    const self = await memberRow('Demo Administrator')
    expect(within(self).getByText('Facility administrator, Doctor · active')).toBeTruthy()
    expect(within(self).queryByRole('button', { name: 'Edit access' })).toBeNull()
    expect(within(await memberRow('Demo Director')).queryByRole('button', { name: 'Edit access' })).toBeNull()
  })
})
