import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { FacilityStaff, FacilityStaffMember } from '../../../../staff/api'
import { HrCredentials } from '../../../../ehr-blue/departments/hr/HrCredentials'
import { hrPage } from '../../../../ehr-blue/departments/hr/page'
import { DEMO_HOSPITAL_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * HR & Credentials, its live half: each member of the facility and the licence on record for them, from today's one
 * Staff read (facilityStaffApi.read), in the design's list and record view. Read only: nothing else is asked of Identity.
 * Fictional data only.
 */
const session = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility as FakeFacility | undefined) }
})
const api = vi.hoisted(() => ({ read: vi.fn(), recordAdministratorLicence: vi.fn(), invite: vi.fn(), resend: vi.fn(), revoke: vi.fn(),
  end: vi.fn(), changeRole: vi.fn() }))
/** Every member of staffApi the page touches: none. */
const touched = vi.hoisted(() => [] as string[])
vi.mock('../../../../staff/api', () => ({
  facilityStaffApi: api,
  staffApi: new Proxy({}, { get: (_target, key) => { if (typeof key === 'string') touched.push(key); return vi.fn() } }),
}))

const ADMIN_ID = '5e0a1b2c-0000-4000-8000-00000000a001'
const NURSE_ID = '7c3d4e5f-0000-4000-8000-00000000a002'
const DESK_ID = '9a8b7c6d-0000-4000-8000-00000000a003'

const administrator = (overrides: Partial<FacilityStaffMember> = {}): FacilityStaffMember => ({ membershipId: ADMIN_ID, version: 2,
  accountId: 'account-demo-1', name: 'Demo Administrator', email: 'demo.admin@example.test', roles: ['org_admin', 'doctor'],
  isAdministrator: true, isSelf: true, joinedAt: '2026-10-20T09:00:00.000Z',
  licence: { body: 'MDCN', numberHint: '2345', vouchedBy: null, vouchedAt: '2026-10-24T12:00:00.000Z', method: 'platform_review' },
  ...overrides })
const nurse = (): FacilityStaffMember => ({ membershipId: NURSE_ID, version: 3, accountId: 'account-demo-2', name: 'Demo Nurse',
  email: 'demo.nurse@example.test', roles: ['nurse'], isAdministrator: false, isSelf: false, joinedAt: '2026-10-25T09:00:00.000Z',
  licence: { body: 'NMCN', numberHint: '8765', vouchedBy: 'Demo Administrator', vouchedAt: '2026-10-25T08:00:00.000Z', method: 'facility_attestation' } })
const receptionist = (): FacilityStaffMember => ({ membershipId: DESK_ID, version: 1, accountId: 'account-demo-3', name: 'Demo Receptionist',
  email: 'demo.desk@example.test', roles: ['receptionist'], isAdministrator: false, isSelf: false, joinedAt: '2026-10-26T09:00:00.000Z', licence: null })
const staff = (overrides: Partial<FacilityStaff> = {}, facility: Partial<FacilityStaff['facility']> = {}): FacilityStaff => ({
  facility: { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', organizationType: 'hospital', reviewState: 'reviewed', firstThirtyDaysEndAt: null,
    invitationsOpen: true, deliveryPaused: false, ...facility },
  canInvite: true,
  limits: { pendingInvitations: 0, pendingLimit: 100, invitationsToday: 0, invitationsPerDay: 30, emailsToday: 0, emailsPerDay: 60 },
  inviteOptions: { roles: [{ code: 'doctor', licenceBody: 'MDCN' }, { code: 'nurse', licenceBody: 'NMCN' }], attestation: null },
  administratorLicence: null, administratorLicenceBodies: ['MDCN', 'NMCN'],
  members: [administrator(), nurse(), receptionist()], invitations: [], ...overrides })

function setFacility(permissions = ['workforce.manage'], selfService: FakeFacility['selfService'] | null = { review: 'reviewed', organizationType: 'hospital' }) {
  session.facility = fakeFacility(permissions, { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['org_admin'],
    ...selfService ? { selfService } : {} })
}

function open() {
  return renderDept(<HrCredentials />)
}

/** The table row of the record named `name`. */
const row = (name: string) => screen.getByRole('button', { name }).closest('tr') as HTMLElement
/** A "Saved record" value by its label. */
const fact = (scope: HTMLElement, label: string) => within(scope).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
const savedRecord = () => screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement

function expectOnlyTheRead(times = 1) {
  expect(api.read).toHaveBeenCalledTimes(times)
  for (const [name, fn] of Object.entries(api)) if (name !== 'read') expect(fn).not.toHaveBeenCalled()
  expect(touched).toEqual([])
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  touched.length = 0
  setFacility()
})

describe('the page entry', () => {
  it('keeps its path, group, label, permission and partial status', () => {
    expect(hrPage).toMatchObject({ path: 'hr/*', group: 'People', label: 'HR & Credentials', permission: 'workforce.manage', status: 'partial' })
  })
})

describe('the live list', () => {
  it('lists each member’s licence as a record, from the one Staff read', async () => {
    api.read.mockResolvedValue(staff())
    open()
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['HR & Credentials'])
    expect(await screen.findByRole('button', { name: 'MDCN licence' })).toBeTruthy()
    expect(api.read).toHaveBeenCalledWith(DEMO_HOSPITAL_ID)
    const table = screen.getByRole('table', { name: 'HR & Credentials' })
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Patient / context', 'Status', 'Updated', 'Actions'])
    expect(screen.getByRole('searchbox', { name: 'Search HR & Credentials' })).toBeTruthy()

    const admin = row('MDCN licence')
    expect(within(admin).getByText('Demo Administrator')).toBeTruthy()
    expect(within(admin).getByText('Facility administrator, Doctor · You')).toBeTruthy()
    expect(within(admin).getByText('reviewed')).toBeTruthy()
    expect(within(admin).getByText(ADMIN_ID.slice(0, 8))).toBeTruthy()
    expect(within(admin).getByText(new Date('2026-10-24T12:00:00.000Z').toLocaleString())).toBeTruthy()
    const vouched = row('NMCN licence')
    expect(within(vouched).getByText('Demo Nurse')).toBeTruthy()
    expect(within(vouched).getByText('vouched')).toBeTruthy()
    const none = row('No licence on record')
    expect(within(none).getByText('Demo Receptionist')).toBeTruthy()
    expect(within(none).getByText('no licence')).toBeTruthy()
    expectOnlyTheRead()
  })

  it('searches only the rows on the page, sending nothing', async () => {
    api.read.mockResolvedValue(staff())
    open()
    const search = await screen.findByRole('searchbox', { name: 'Search HR & Credentials' })
    fireEvent.change(search, { target: { value: 'nurse' } })
    expect(screen.getByRole('button', { name: 'NMCN licence' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'MDCN licence' })).toBeNull()
    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.change(search, { target: { value: 'nobody here' } })
    const list = screen.getByRole('region', { name: 'Search HR & Credentials' })
    expect(within(list).getByText('No matching records')).toBeTruthy()
    expect(within(list).getByText('Change your search.')).toBeTruthy()
    expectOnlyTheRead()
  })

  it('opens a record from its name or Open, shows what Health ID holds and no action, and returns focus to it', async () => {
    api.read.mockResolvedValue(staff())
    open()
    const link = await screen.findByRole('button', { name: 'NMCN licence' })
    expect(link.tagName).toBe('BUTTON')
    expect(link.getAttribute('type')).toBe('button')
    const openButton = within(row('NMCN licence')).getByRole('button', { name: 'Open' })
    expect(openButton.getAttribute('aria-describedby')).toBe(link.id)
    fireEvent.click(openButton)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('NMCN licence')
    expect(document.activeElement?.id).toBe('hr-title')
    expect(screen.getByText(`Demo Nurse · ${NURSE_ID.slice(0, 8)}`)).toBeTruthy()
    expect(screen.getByText('vouched')).toBeTruthy()
    expect(screen.getByText(`Saved ${new Date('2026-10-25T08:00:00.000Z').toLocaleString()}`)).toBeTruthy()
    const saved = savedRecord()
    expect(fact(saved, 'Staff')).toBe('Demo Nurse')
    expect(fact(saved, 'Email')).toBe('demo.nurse@example.test')
    expect(fact(saved, 'Name')).toBe('NMCN licence')
    expect(fact(saved, 'Number')).toBe('ending 8765')
    expect(fact(saved, 'Issued by')).toBe('Nursing and Midwifery Council of Nigeria')
    expect(fact(saved, 'Employment')).toBe('Nurse')
    expect(fact(saved, 'Review')).toMatch(/^Vouched by Demo Administrator on /)
    expect(screen.getByRole('heading', { name: 'Available actions' })).toBeTruthy()
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(screen.queryByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('HR & Credentials')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'NMCN licence' }))
    expectOnlyTheRead()
  })

  it('shows a record checked by Health ID support, and one with no licence', async () => {
    api.read.mockResolvedValue(staff())
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'MDCN licence' }))
    expect(fact(savedRecord(), 'Issued by')).toBe('Medical and Dental Council of Nigeria')
    expect(fact(savedRecord(), 'Employment')).toBe('Facility administrator, Doctor')
    expect(fact(savedRecord(), 'Review')).toMatch(/^Checked by Health ID support on /)
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'No licence on record' }))
    expect(screen.getByText('no licence')).toBeTruthy()
    expect(within(savedRecord()).queryByText('Review', { selector: 'dt' })).toBeNull()
    expect(within(savedRecord()).queryByText('Number', { selector: 'dt' })).toBeNull()
    expect(fact(savedRecord(), 'Employment')).toBe('Receptionist')
  })

  it('opens the design’s quick view, which closes back to its button or opens the full record', async () => {
    api.read.mockResolvedValue(staff())
    open()
    await screen.findByRole('button', { name: 'NMCN licence' })
    const quick = within(row('NMCN licence')).getByRole('button', { name: 'Quick view' })
    quick.focus()
    fireEvent.click(quick)
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { name: 'NMCN licence' })).toBeTruthy()
    // A live record is not a sample: no sample notice in its drawer.
    expect(within(drawer).queryByRole('note')).toBeNull()
    expect(within(drawer).getByText(`Last updated ${new Date('2026-10-25T08:00:00.000Z').toLocaleString()}`)).toBeTruthy()
    expect(fact(drawer, 'Staff')).toBe('Demo Nurse')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(quick)

    fireEvent.click(quick)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Record quick view' })).getByRole('button', { name: 'Open full record' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('NMCN licence')
    expect(document.activeElement?.id).toBe('hr-title')
    expectOnlyTheRead()
  })
})

describe('a facility Health ID support has not checked yet', () => {
  beforeEach(() => setFacility(['workforce.manage'], { review: 'pending', organizationType: 'hospital' }))

  it('says staff come after the check, and lists the administrator’s own licence as recorded for it', async () => {
    api.read.mockResolvedValue(staff({ canInvite: false, members: [administrator({ roles: ['org_admin_awaiting_review'], licence: null })],
      administratorLicence: { body: 'MDCN', numberHint: '4321', recordedAt: '2026-10-25T10:00:00.000Z' } }, { reviewState: 'pending' }))
    open()
    expect(await screen.findByText('You can add staff once Health ID support has checked Demo Hospital.')).toBeTruthy()
    expect(screen.getByText('Waiting for Health ID support')).toBeTruthy()
    expect(within(row('MDCN licence')).getByText('recorded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'MDCN licence' }))
    expect(fact(savedRecord(), 'Number')).toBe('ending 4321')
    expect(fact(savedRecord(), 'Review')).toBe('Waiting for Health ID support’s check')
    expect(fact(savedRecord(), 'Employment')).toBe('Facility administrator')
    expectOnlyTheRead()
  })

  it('says where the administrator adds their own licence when none is recorded', async () => {
    api.read.mockResolvedValue(staff({ canInvite: false, members: [administrator({ roles: ['org_admin_awaiting_review'], licence: null })] },
      { reviewState: 'pending' }))
    open()
    expect(await screen.findByText('You can add staff once Health ID support has checked Demo Hospital. To get clinical access yourself, '
      + 'add your licence on Staff & access.')).toBeTruthy()
    expect(within(row('No licence on record')).getByText('no licence')).toBeTruthy()
  })

  it('does not point to a licence when support can give the type no clinical role', async () => {
    api.read.mockResolvedValue(staff({ members: [administrator({ licence: null })], administratorLicenceBodies: [] }, { reviewState: 'pending' }))
    open()
    expect(await screen.findByText('You can add staff once Health ID support has checked Demo Hospital.')).toBeTruthy()
  })
})

describe('where the live list does not apply', () => {
  it('refuses a membership without workforce.manage, without asking Identity, and still offers the sample', () => {
    setFacility(['ehr.encounter.read'])
    open()
    expect(screen.getByText('Permission denied. Only Demo Hospital’s administrator can open its staff records.')).toBeTruthy()
    expect(screen.getByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  it('says Health ID support manages a governed facility’s staff, without asking Identity', () => {
    setFacility(['workforce.manage'], null)
    open()
    expect(screen.getByText('Health ID support manages who works at Demo Hospital. Contact Health ID support to add or remove staff.')).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
  })

  it('asks for a facility first', () => {
    session.facility = undefined
    open()
    expect(screen.getByText('Choose the facility you are working at first.')).toBeTruthy()
    expect(api.read).not.toHaveBeenCalled()
  })

  it('says the list is loading while Identity answers', async () => {
    api.read.mockReturnValue(new Promise(() => {}))
    open()
    expect(screen.getByText('Loading staff records…').getAttribute('role')).toBe('status')
    expect(screen.queryByRole('table', { name: 'HR & Credentials' })).toBeNull()
    expect(api.read).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }), 'Staff records aren’t available on Health ID yet. Check again later.'],
    [new HidApiError(404, 'No route', { code: 'API_ROUTE_NOT_FOUND' }), 'Staff records aren’t available on Health ID yet. Check again later.'],
    [new HidApiError(403, 'Not available', { code: 'STAFF_MANAGEMENT_NOT_AVAILABLE' }),
      'Health ID support manages who works at Demo Hospital. Contact Health ID support to add or remove staff.'],
  ])('answers a refused read with no retry: %s', async (refusal, text) => {
    api.read.mockRejectedValue(refusal)
    open()
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it.each([
    [new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }), 'Staff management is temporarily unavailable. Please try again in a few minutes.'],
    [new HidApiError(403, 'Denied', { code: 'PERMISSION_DENIED' }),
      'Demo Hospital’s staff couldn’t be loaded. Only Demo Hospital’s administrator can manage its staff.'],
    [new Error('offline'), 'Demo Hospital’s staff couldn’t be loaded. That didn’t work. Please try again.'],
  ])('answers a failed read with Try again, which reads once more: %s', async (refusal, text) => {
    api.read.mockRejectedValueOnce(refusal).mockResolvedValue(staff())
    open()
    expect((await screen.findByRole('alert')).textContent).toBe(`${text}Try again`)
    const retry = screen.getByRole('button', { name: 'Try again' })
    retry.focus()
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: 'MDCN licence' })).toBeTruthy()
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(text)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search HR & Credentials' }))
    expectOnlyTheRead(2)
  })

  it('announces a refusal again after Try again, with focus back on Try again', async () => {
    const refusal = new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' })
    api.read.mockRejectedValueOnce(refusal).mockRejectedValueOnce(refusal).mockResolvedValue(staff())
    open()
    const first = await screen.findByRole('alert')
    expect(first.textContent).toContain('Staff management is temporarily unavailable. Please try again in a few minutes.')
    const retry = screen.getByRole('button', { name: 'Try again' })
    retry.focus()
    fireEvent.click(retry)
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
    const again = await screen.findByRole('alert')
    expect(again).not.toBe(first)
    expect(again.textContent).toContain('Staff management is temporarily unavailable. Please try again in a few minutes.')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' })))
    expect(document.activeElement?.id).toBe('hr-live-retry')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'MDCN licence' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search HR & Credentials' }))
    expectOnlyTheRead(3)
  })
})
