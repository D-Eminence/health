import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FacilityStaff } from '../../../../staff/api'
import { HrCredentials } from '../../../../ehr-blue/departments/hr/HrCredentials'
import { SAMPLE_NOTICE } from '../../../../ehr-blue/departments/parts/SampleBanner'
import { DEMO_HOSPITAL_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { dateText } from '../../../../ehr-blue/departments/parts/format'

/**
 * HR & Credentials, its sample half: the design's credential records (create, edit while recorded, the credential review),
 * fictional and in the page's memory only. It shows the sample notice and asks nothing of Health ID: the only request
 * the page makes is the live half's one Staff read.
 */
const session = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility as FakeFacility | undefined) }
})
const api = vi.hoisted(() => ({ read: vi.fn(), recordAdministratorLicence: vi.fn(), invite: vi.fn(), resend: vi.fn(), revoke: vi.fn(),
  end: vi.fn(), changeRole: vi.fn() }))
const touched = vi.hoisted(() => [] as string[])
vi.mock('../../../../staff/api', () => ({
  facilityStaffApi: api,
  staffApi: new Proxy({}, { get: (_target, key) => { if (typeof key === 'string') touched.push(key); return vi.fn() } }),
}))

const staff: FacilityStaff = {
  facility: { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', organizationType: 'hospital', reviewState: 'reviewed', firstThirtyDaysEndAt: null,
    invitationsOpen: true, deliveryPaused: false },
  canInvite: true,
  limits: { pendingInvitations: 0, pendingLimit: 100, invitationsToday: 0, invitationsPerDay: 30, emailsToday: 0, emailsPerDay: 60 },
  inviteOptions: { roles: [], attestation: null }, administratorLicence: null, administratorLicenceBodies: [],
  members: [{ membershipId: '5e0a1b2c-0000-4000-8000-00000000a001', version: 1, accountId: 'account-demo-1', name: 'Demo Administrator',
    email: 'demo.admin@example.test', roles: ['org_admin'], isAdministrator: true, isSelf: true, joinedAt: '2026-10-20T09:00:00.000Z', licence: null }],
  invitations: [],
}

const SEEDED_AT = dateText('2026-10-26T11:41:16.706Z')

/** The sample list: the list card under the sample notice. */
const sampleList = () => screen.getByRole('region', { name: 'Search sample records' })
const row = (name: string) => within(sampleList()).getByRole('button', { name }).closest('tr') as HTMLElement
const fact = (scope: HTMLElement, label: string) => within(scope).queryByText(label, { selector: 'dt' })?.nextElementSibling?.textContent
const savedRecord = () => screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement
const actionsCard = () => screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement

/** Nothing but the live half's one read has been asked of Health ID. */
function expectNoSampleRequest() {
  for (const [name, fn] of Object.entries(api)) if (name !== 'read') expect(fn).not.toHaveBeenCalled()
  expect(api.read.mock.calls.length).toBeLessThanOrEqual(1)
  expect(touched).toEqual([])
}

async function open() {
  renderDept(<HrCredentials />)
  await screen.findByRole('button', { name: 'No licence on record' })
}

function openRecord(name: string) {
  fireEvent.click(within(row(name)).getByRole('button', { name: 'Open' }))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(name)
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  touched.length = 0
  session.facility = fakeFacility(['workforce.manage'], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', roles: ['org_admin'],
    selfService: { review: 'reviewed', organizationType: 'hospital' } })
  api.read.mockResolvedValue(staff)
})

describe('the sample list', () => {
  it('shows the sample notice over the design’s two fictional records', async () => {
    await open()
    expect(SAMPLE_NOTICE).toBe('Sample only: not connected to Health ID yet. Nothing you do here is saved.')
    const notice = screen.getByRole('note')
    expect(notice.textContent).toBe(SAMPLE_NOTICE)
    expect(notice.nextElementSibling).toBe(sampleList())
    const medical = row('Medical licence (fictional)')
    expect(within(medical).getByText('f8f25d2e')).toBeTruthy()
    expect(within(medical).getByText('Demo Doctor')).toBeTruthy()
    expect(within(medical).getByText('reviewed')).toBeTruthy()
    expect(within(medical).getByText(SEEDED_AT)).toBeTruthy()
    const nursing = row('Nursing registration (fictional)')
    expect(within(nursing).getByText('b459b486')).toBeTruthy()
    expect(within(nursing).getByText('Demo Nurse')).toBeTruthy()
    expect(within(nursing).getByText('recorded')).toBeTruthy()
    expect(within(sampleList()).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Record', 'Patient / context', 'Status', 'Updated', 'Actions'])
    expectNoSampleRequest()
  })

  it('searches the sample rows in the page', async () => {
    await open()
    const search = within(sampleList()).getByRole('searchbox', { name: 'Search sample records' })
    expect(search.getAttribute('placeholder')).toBe('Search saved records…')
    fireEvent.change(search, { target: { value: 'nursing' } })
    expect(within(sampleList()).queryByRole('button', { name: 'Medical licence (fictional)' })).toBeNull()
    expect(within(sampleList()).getByRole('button', { name: 'Nursing registration (fictional)' })).toBeTruthy()
    fireEvent.change(search, { target: { value: 'no such credential' } })
    expect(within(sampleList()).getByText('No matching records')).toBeTruthy()
    expect(within(sampleList()).getByText('Change your search.')).toBeTruthy()
    expectNoSampleRequest()
  })

  it('opens a sample record’s quick view', async () => {
    await open()
    fireEvent.click(within(row('Medical licence (fictional)')).getByRole('button', { name: 'Quick view' }))
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    // The sample notice comes first in the drawer, before the record it describes.
    const notice = within(drawer).getByRole('note')
    expect(notice.textContent).toBe(SAMPLE_NOTICE)
    expect(notice.compareDocumentPosition(within(drawer).getByRole('heading', { name: 'Medical licence (fictional)' }))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fact(drawer, 'Review')).toBe('Local review only')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open full record' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Medical licence (fictional)')
  })
})

describe('creating a record', () => {
  it('opens the design’s form, asks for each required field, and saves the record in memory', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New hr & credentials')
    expect(document.activeElement?.id).toBe('hr-title')
    expect(screen.getByRole('note').textContent).toBe(SAMPLE_NOTICE)
    const staffSelect = screen.getByRole('combobox', { name: 'Staff member' }) as HTMLSelectElement
    expect([...staffSelect.options].map(option => option.textContent)).toEqual(['Select…', 'Demo Doctor · Doctor', 'Demo Nurse · Nurse',
      'Demo Pharmacist · Pharmacist', 'Demo Laboratory Scientist · Laboratory scientist'])
    expect(screen.getByText('Staff member').closest('label')?.textContent).toBe('Staff member *')
    expect(screen.getByRole('textbox', { name: 'Leave request (optional)' })).toBeTruthy()
    expect(screen.getByLabelText(/^Expiry/).getAttribute('type')).toBe('date')

    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    expect(screen.getAllByText('Complete this field.')).toHaveLength(4)
    expect(document.activeElement).toBe(staffSelect)
    expect(staffSelect.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New hr & credentials')

    fireEvent.change(staffSelect, { target: { value: 'demo-pharmacist' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional credential' }), { target: { value: 'Pharmacy licence (fictional)' } })
    fireEvent.change(screen.getByLabelText(/^Expiry/), { target: { value: '2031-05-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    expect(screen.getAllByText('Complete this field.')).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Employment information' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Employment information' }), { target: { value: 'Contract' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pharmacy licence (fictional)')
    expect(document.activeElement?.id).toBe('hr-title')
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('Record created: Pharmacy licence (fictional).')
    expect(screen.getByRole('note').textContent).toBe(SAMPLE_NOTICE)
    expect(screen.getByText('recorded')).toBeTruthy()
    expect(screen.getByText(/^Saved \d/)).toBeTruthy()
    expect(fact(savedRecord(), 'Staff')).toBe('Demo Pharmacist')
    expect(fact(savedRecord(), 'Name')).toBe('Pharmacy licence (fictional)')
    expect(fact(savedRecord(), 'Expiry')).toBe('2031-05-01')
    expect(fact(savedRecord(), 'Employment')).toBe('Contract')
    expect(fact(savedRecord(), 'Leave')).toBeUndefined()
    expect(screen.queryByRole('heading', { name: 'Preserved versions & amendments' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(document.activeElement).toBe(within(sampleList()).getByRole('button', { name: 'Pharmacy licence (fictional)' }))
    expect(within(row('Pharmacy licence (fictional)')).getByText('Demo Pharmacist')).toBeTruthy()
    expect(within(row('Pharmacy licence (fictional)')).getByText('recorded')).toBeTruthy()
    expectNoSampleRequest()
  })

  it('goes back from the form to Create record, and a reload starts from the design’s rows again', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create record' }))

    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Staff member' }), { target: { value: 'demo-scientist' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional credential' }), { target: { value: 'Laboratory licence (fictional)' } })
    fireEvent.change(screen.getByLabelText(/^Expiry/), { target: { value: '2030-02-01' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Employment information' }), { target: { value: 'Employed' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Leave request (optional)' }), { target: { value: 'Two days in December' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))
    expect(fact(savedRecord(), 'Leave')).toBe('Two days in December')

    cleanup()
    api.read.mockClear()
    await open()
    expect(within(sampleList()).queryByRole('button', { name: 'Laboratory licence (fictional)' })).toBeNull()
    expect(within(sampleList()).getAllByRole('row')).toHaveLength(3)
    expectNoSampleRequest()
  })
})

describe('a recorded record', () => {
  it('edits its details while it is only recorded, keeping the version before', async () => {
    await open()
    openRecord('Nursing registration (fictional)')
    expect(screen.getByRole('note').textContent).toBe(SAMPLE_NOTICE)
    const edit = within(savedRecord()).getByRole('button', { name: 'Edit record' })
    expect(edit.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(edit)
    expect(edit.getAttribute('aria-expanded')).toBe('true')
    expect(edit.textContent).toBe('Cancel editing')
    const staffSelect = within(savedRecord()).getByRole('combobox', { name: 'Staff member' }) as HTMLSelectElement
    expect(document.activeElement).toBe(staffSelect)
    expect(staffSelect.value).toBe('demo-nurse')

    const credential = within(savedRecord()).getByRole('textbox', { name: 'Fictional credential' })
    fireEvent.change(credential, { target: { value: ' ' } })
    fireEvent.click(within(savedRecord()).getByRole('button', { name: 'Save changes' }))
    expect(within(savedRecord()).getByText('Complete this field.')).toBeTruthy()
    expect(document.activeElement).toBe(credential)

    fireEvent.change(credential, { target: { value: 'Nursing registration renewed (fictional)' } })
    fireEvent.change(within(savedRecord()).getByRole('textbox', { name: 'Leave request (optional)' }), { target: { value: 'Annual leave in December' } })
    fireEvent.click(within(savedRecord()).getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nursing registration renewed (fictional)')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Saved record' }))
    expect(screen.getByText('Record changes saved.')).toBeTruthy()
    expect(fact(savedRecord(), 'Name')).toBe('Nursing registration renewed (fictional)')
    expect(fact(savedRecord(), 'Leave')).toBe('Annual leave in December')
    expect(screen.getByText('recorded')).toBeTruthy()
    expect(within(savedRecord()).getByRole('button', { name: 'Edit record' }).getAttribute('aria-expanded')).toBe('false')
    const history = screen.getByRole('heading', { name: 'Preserved versions & amendments' }).closest('section') as HTMLElement
    const version = within(history).getByText(/ · recorded · Edit record$/)
    expect(version.tagName).toBe('SUMMARY')
    expect(fact(history, 'Name')).toBe('Nursing registration (fictional)')
    expect(within(history).getByText('Author: You')).toBeTruthy()
    expectNoSampleRequest()
  })

  it('cancels editing without a change', async () => {
    await open()
    openRecord('Nursing registration (fictional)')
    const edit = within(savedRecord()).getByRole('button', { name: 'Edit record' })
    fireEvent.click(edit)
    fireEvent.change(within(savedRecord()).getByRole('textbox', { name: 'Fictional credential' }), { target: { value: 'Changed (fictional)' } })
    fireEvent.click(edit)
    expect(within(savedRecord()).queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(fact(savedRecord(), 'Name')).toBe('Nursing registration (fictional)')
    expect(document.activeElement).toBe(edit)
  })

  it('records the credential review: recorded becomes reviewed, and nothing further is offered', async () => {
    await open()
    openRecord('Nursing registration (fictional)')
    const action = within(actionsCard()).getByRole('button', { name: 'Record credential review' })
    expect(action.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(action)
    expect(action.getAttribute('aria-expanded')).toBe('true')
    const review = within(actionsCard()).getByRole('textbox', { name: 'Simulated review (not independent verification)' })
    expect(document.activeElement).toBe(review)
    const submit = within(actionsCard()).getAllByRole('button', { name: 'Record credential review' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.click(submit)
    expect(within(actionsCard()).getByText('Complete this field.')).toBeTruthy()
    expect(document.activeElement).toBe(review)

    fireEvent.change(review, { target: { value: 'Seen the fictional certificate' } })
    fireEvent.click(submit)
    expect(screen.getByText('reviewed')).toBeTruthy()
    expect(fact(savedRecord(), 'Review')).toBe('Seen the fictional certificate')
    expect(within(actionsCard()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(within(actionsCard()).queryByRole('button')).toBeNull()
    expect(within(savedRecord()).queryByRole('button', { name: 'Edit record' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Saved record' }))
    expect(screen.getByText('Credential review recorded.')).toBeTruthy()
    expect(screen.getByText(/ · recorded · Record credential review$/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(within(row('Nursing registration (fictional)')).getByText('reviewed')).toBeTruthy()
    expect(document.activeElement).toBe(within(sampleList()).getByRole('button', { name: 'Nursing registration (fictional)' }))
    expectNoSampleRequest()
  })
})

describe('a reviewed record', () => {
  it('is drawn as the design’s record view, with nothing further to do', async () => {
    await open()
    openRecord('Medical licence (fictional)')
    expect(screen.getByRole('note').textContent).toBe(SAMPLE_NOTICE)
    expect(screen.getByText('reviewed')).toBeTruthy()
    expect(screen.getByText(`Saved ${SEEDED_AT}`)).toBeTruthy()
    expect([...savedRecord().querySelectorAll('dt')].map(term => term.textContent)).toEqual(['Staff', 'Name', 'Expiry', 'Employment', 'Review'])
    expect(fact(savedRecord(), 'Staff')).toBe('Demo Doctor')
    expect(fact(savedRecord(), 'Name')).toBe('Medical licence (fictional)')
    expect(fact(savedRecord(), 'Expiry')).toBe('2030-01-01')
    expect(fact(savedRecord(), 'Employment')).toBe('Employed')
    expect(fact(savedRecord(), 'Review')).toBe('Local review only')
    expect(within(savedRecord()).queryByRole('button')).toBeNull()
    expect(within(actionsCard()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
    const summary = screen.getByText('2026-10-26T11:41:16.706Z · recorded · Record credential review')
    expect(summary.tagName).toBe('SUMMARY')
    expect(screen.queryByText(/waiting to sync/)).toBeNull()
    expectNoSampleRequest()
  })
})

describe('an address below the page’s own', () => {
  /** The page as the frame draws it: anew for each address (BluePageBoundary is keyed by it), with the address shown. */
  function Framed() {
    const { pathname } = useLocation()
    return <><output data-testid="where">{pathname}</output><HrCredentials key={pathname} /></>
  }

  it('shows the list and goes back to /provider/hr, never opening the record the address names, reading once', async () => {
    // A record link from Home or the Notifications drawer, here naming a record the page holds: it is still not opened.
    renderDept(<Framed />, { route: '/provider/hr/f8f25d2e-3c1a-4b7e-9d10-5a6b7c8d9e01' })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/hr'))
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['HR & Credentials'])
    await screen.findByRole('button', { name: 'No licence on record' })
    expect(within(sampleList()).getAllByRole('row')).toHaveLength(3)
    expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
    expect(api.read).toHaveBeenCalledTimes(1)
    expectNoSampleRequest()
  })
})

describe('without the live list', () => {
  it('works in memory, asking Health ID nothing, when the membership cannot read the staff', async () => {
    session.facility = fakeFacility(['ehr.encounter.read'], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital' })
    renderDept(<HrCredentials />)
    openRecord('Nursing registration (fictional)')
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Record credential review' }))
    fireEvent.change(within(actionsCard()).getByRole('textbox', { name: 'Simulated review (not independent verification)' }), { target: { value: 'Checked' } })
    fireEvent.submit(within(actionsCard()).getByRole('textbox', { name: 'Simulated review (not independent verification)' }).closest('form')!)
    expect(screen.getByText('reviewed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New hr & credentials')
    expect(api.read).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })
})
