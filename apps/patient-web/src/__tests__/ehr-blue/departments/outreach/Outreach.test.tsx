import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'

/*
 * The blue Outreach page: the design's workspace (list, Quick view, record view, create
 * form) on today's Outreach requests and rules (staff/routes/Operations.tsx Outreach,
 * CampaignCard, OutreachCaseCard; staff/routes/__tests__/Outreach.test.tsx). Fictional data.
 */

const session = vi.hoisted(() => ({ permissions: [] as string[], facility: 'hospital' as 'hospital' | 'other' | 'none' }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => staffContext(session.facility === 'none' ? undefined : fakeFacility(session.permissions, {
      id: session.facility === 'other' ? 'facility-other' : hospital, name: 'Demo Hospital', roles: ['outreach_officer'],
    })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(),
}))
// Every staff API member the page reaches for that this test does not provide, such as a campaign write.
const unprovided = vi.hoisted(() => new Set<string>())
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, {
    get(target, property) {
      if (typeof property === 'string' && !(property in target)) unprovided.add(property)
      return Reflect.get(target, property)
    },
  }),
}))

const MEMBERSHIP = 'membership-demo-1'
const READ = ['outreach.campaign.read', 'outreach.registration.read']
const ALL = [...READ, 'outreach.campaign.write', 'outreach.registration.write']

const campaign = (id: string, name: string, status: string, services = ['registration']) =>
  ({ id, name, status, services, startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 })
const CAMPAIGNS = [
  campaign('campaign-1', 'Demo screening week', 'active'),
  campaign('campaign-2', 'Demo follow-up', 'planned'),
  campaign('campaign-3', 'Demo immunisation day', 'active'),
  campaign('campaign-4', 'Demo eye clinic', 'active', ['screening']),
]
// This membership belongs to campaigns 1, 2 and 4, not 3.
const MEMBER_OF = new Set(['campaign-1', 'campaign-2', 'campaign-4'])

const CASE_ID = 'c0a5e000-0000-4000-8000-000000000001'
const pendingCase = {
  id: CASE_ID, campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: 'Patient One', ageYears: 34, sex: 'female',
  temporaryPatientId: 'tmp_c0000000-0000-4000-8000-000000000001', createdAt: '2026-10-12T09:00:00.000Z', rowVersion: 3,
}
const resolvedCase = {
  id: 'c0a5e000-0000-4000-8000-000000000002', status: 'identity_resolved', fullName: 'Patient Two', sex: 'male', ageYears: 51,
  createdAt: '2026-10-11T09:00:00.000Z', rowVersion: 5,
}
const PATIENT = 'a0000000-0000-4000-8000-000000000001'

let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  unprovided.clear()
  session.permissions = ALL
  session.facility = 'hospital'
  api.outreachCampaigns.mockResolvedValue(CAMPAIGNS)
  api.outreachCases.mockResolvedValue([pendingCase, resolvedCase])
  api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) => MEMBER_OF.has(campaignId)
    ? [{ id: `${campaignId}-member`, campaignId, membershipId: MEMBERSHIP, role: 'health_worker', createdAt: '2026-01-02T00:00:00.000Z' }]
    : [{ id: `${campaignId}-other`, campaignId, membershipId: 'membership-demo-9', role: 'enumerator', createdAt: '2026-01-02T00:00:00.000Z' }])
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  // Nothing outside today's Outreach requests is reached for, and nothing is kept in the browser.
  expect([...unprovided]).toEqual([])
  expect(setItem).not.toHaveBeenCalled()
  expect(document.cookie).toBe('')
})

function renderPage() {
  return renderDept(<Outreach />)
}

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const casesTable = () => screen.findByRole('region', { name: 'Registration cases' })
const campaignsTable = () => screen.findByRole('region', { name: 'Campaigns' })
const heading = () => screen.getByRole('heading', { level: 1 })

describe('who can open Outreach', () => {
  it('refuses a membership with no outreach read permission, and reads nothing', async () => {
    session.permissions = ['outreach.registration.write', 'outreach.campaign.write']
    renderPage()
    expect(heading().textContent).toBe('Outreach')
    expect(screen.getByRole('alert').textContent).toBe('Permission denied. This membership or branch cannot open this module.')
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(api.outreachCases).not.toHaveBeenCalled()
    expect(api.outreachCampaigns).not.toHaveBeenCalled()
  })

  it('refuses when no facility is being worked at', () => {
    session.facility = 'none'
    renderPage()
    expect(screen.getByRole('alert').textContent).toBe('Permission denied. This membership or branch cannot open this module.')
    expect(api.outreachCases).not.toHaveBeenCalled()
  })

  it('with registration read only, lists cases and offers neither campaigns nor a new case', async () => {
    session.permissions = ['outreach.registration.read']
    renderPage()
    expect(await screen.findByRole('button', { name: 'Patient One' })).toBeTruthy()
    expect(api.outreachCases).toHaveBeenCalledWith(DEMO_HOSPITAL_ID)
    expect(api.outreachCampaigns).not.toHaveBeenCalled()
    expect(api.outreachCampaignMembers).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Campaigns' })).toBeNull()
    expect(screen.queryByText('Campaigns are read only')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('with campaign read only, lists campaigns and reads no cases', async () => {
    session.permissions = ['outreach.campaign.read']
    renderPage()
    expect(await campaignsTable()).toBeTruthy()
    expect(api.outreachCases).not.toHaveBeenCalled()
    expect(screen.queryByRole('searchbox', { name: 'Search Outreach' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })
})

describe('the list', () => {
  it('shows the design list: one h1, Create record, the search card and the table columns', async () => {
    renderPage()
    const table = await casesTable()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(heading().textContent).toBe('Outreach')
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search Outreach' }).getAttribute('placeholder')).toBe('Search saved records…')
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Patient / context', 'Status', 'Created', 'Actions'])
    const row = within(table).getByRole('button', { name: 'Patient One' }).closest('tr') as HTMLElement
    // The record's short reference, its age and sex, and its status in lowercase words.
    expect(within(row).getByText('c0a5e000')).toBeTruthy()
    expect(within(row).getByText('34 years · female')).toBeTruthy()
    expect(within(row).getByText('identity resolution pending')).toBeTruthy()
    expect(within(table).getByText('identity resolved')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Quick view' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Open' })).toBeTruthy()
    // No export: today's API has none, and a download would keep identifying data on the device.
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull()
  })

  it('says the list is loading', async () => {
    api.outreachCases.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(await screen.findByText('Loading registration cases')).toBeTruthy()
    expect(screen.getByText('Loading registration cases').getAttribute('role')).toBe('status')
  })

  it('says when there are no cases yet', async () => {
    api.outreachCases.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Create the first record when you have the appropriate permission.')).toBeTruthy()
  })

  it.each([
    ['a refusal, in its own words', new HidApiError(403, 'This membership cannot read registration cases.', { code: 'FORBIDDEN' }),
      'This membership cannot read registration cases.'],
    ['a module that is off', new HidApiError(404, 'Not found.', { code: 'API_ROUTE_NOT_FOUND' }),
      'This workspace is not in service on this Health ID deployment: its work cannot be loaded or changed here, and refreshing will not help.'],
    ['a fault between services', new HidApiError(503, 'Upstream.', { code: 'EHR_SERVICE_AUTH_UNAVAILABLE' }),
      'A connection between Health ID services failed; retry in about 15 seconds.'],
    ['an unknown failure', 'offline', 'Registration cases could not be loaded. Refresh to try again.'],
  ])('says %s when cases cannot be read', async (_name, error, message) => {
    api.outreachCases.mockRejectedValue(error)
    renderPage()
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toContain(message))
    expect(screen.queryByText('No matching records')).toBeNull()
  })

  it('says when campaigns cannot be read', async () => {
    api.outreachCampaigns.mockRejectedValue('offline')
    renderPage()
    expect(await screen.findByText('Campaigns could not be loaded. Refresh to try again.')).toBeTruthy()
  })

  it('searches what is loaded without sending anything, and clears the search', async () => {
    renderPage()
    const table = await casesTable()
    const reads = api.outreachCases.mock.calls.length
    const search = screen.getByRole('searchbox', { name: 'Search Outreach' })
    fireEvent.change(search, { target: { value: 'two male' } })
    expect(within(table).queryByRole('button', { name: 'Patient One' })).toBeNull()
    expect(within(table).getByRole('button', { name: 'Patient Two' })).toBeTruthy()
    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Clear search' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(within(await casesTable()).getByRole('button', { name: 'Patient One' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(api.outreachCases).toHaveBeenCalledTimes(reads)
  })

  it('pages a long list 50 at a time', async () => {
    api.outreachCases.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({
      ...pendingCase, id: `c0a5e000-0000-4000-8000-${String(index).padStart(12, '0')}`, fullName: `Patient ${index + 1}`,
    })))
    renderPage()
    const pages = await screen.findByRole('navigation', { name: 'Registration case pages' })
    expect(within(await casesTable()).getAllByRole('row')).toHaveLength(51)
    expect(within(pages).getByText('Page 1 of 2')).toBeTruthy()
    expect((within(pages).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    await press(within(pages).getByRole('button', { name: 'Next page' }))
    expect(within(pages).getByText('Page 2 of 2')).toBeTruthy()
    expect(within(await casesTable()).getByRole('button', { name: 'Patient 51' })).toBeTruthy()
  })

  it('reads both lists again on Refresh', async () => {
    renderPage()
    await casesTable()
    await campaignsTable()
    await press(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledTimes(2))
    expect(api.outreachCampaigns).toHaveBeenCalledTimes(2)
  })

  it('shows a record in Quick view, and opens it from there', async () => {
    renderPage()
    const row = within(await casesTable()).getByRole('button', { name: 'Patient One' }).closest('tr') as HTMLElement
    const quick = within(row).getByRole('button', { name: 'Quick view' })
    await press(quick)
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { name: 'Patient One' })).toBeTruthy()
    expect(within(drawer).getByText('Temporary patient ID')).toBeTruthy()
    expect(within(drawer).getByText('tmp_c0000000-0000-4000-8000-000000000001')).toBeTruthy()
    // The campaign the case was registered under, by name.
    expect(within(drawer).getByText('Demo screening week')).toBeTruthy()
    // Escape closes it, and focus goes back to Quick view.
    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(quick)
    await press(quick)
    await press(within(screen.getByRole('dialog', { name: 'Record quick view' })).getByRole('button', { name: 'Open full record' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(heading().textContent).toBe('Patient One')
    expect(document.activeElement).toBe(heading())
  })

  it('offers every control as a native button or field that the keyboard reaches', async () => {
    renderPage()
    await casesTable()
    await campaignsTable()
    const page = document.querySelector('.hid-ehr-dept') as HTMLElement
    for (const control of page.querySelectorAll<HTMLElement>('button, input, select, textarea, a')) {
      expect(['BUTTON', 'INPUT']).toContain(control.tagName)
      expect(control.getAttribute('tabindex')).not.toBe('-1')
      if (control instanceof HTMLButtonElement) expect(control.type).toBe('button')
    }
  })
})

/**
 * GAP-L93, OUTREACH-01: Identity does not authorize outreach.campaign.write until campaign
 * governance is decided, so creating a campaign, changing its status and adding a member always
 * answer 400. The page offers none of them, and says so; campaigns and members can be read.
 */
describe('campaigns, read only', () => {
  it('offers no campaign create, status or member control, even with outreach.campaign.write, and says why', async () => {
    renderPage()
    const table = await campaignsTable()
    expect(within(table).getByRole('button', { name: 'Demo screening week' })).toBeTruthy()
    expect(within(table).getByText('planned')).toBeTruthy()
    expect(screen.getByText('Campaigns are read only')).toBeTruthy()
    expect(screen.getByText(/^You can view campaigns and their members here\. Creating, activating or closing a campaign, and adding members, is not available yet\.$/)).toBeTruthy()
    for (const name of [/create campaign/i, /activate/i, /close campaign/i, /add member/i, /new campaign/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Every campaign's members are read as it is listed, and nothing else is reached for.
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledTimes(4))
    for (const id of ['campaign-1', 'campaign-2', 'campaign-3', 'campaign-4']) expect(api.outreachCampaignMembers).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, id)
  })

  it('opens a campaign as a read-only record with its members', async () => {
    renderPage()
    await press(within(await campaignsTable()).getByRole('button', { name: 'Demo screening week' }))
    expect(heading().textContent).toBe('Demo screening week')
    expect(document.activeElement).toBe(heading())
    expect(screen.getByRole('heading', { name: 'Saved record' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Available actions' })).toBeTruthy()
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(screen.getByText('Campaigns are read only')).toBeTruthy()
    const members = screen.getByRole('heading', { name: 'Members' }).closest('section') as HTMLElement
    expect(await within(members).findByText('Membership membersh')).toBeTruthy()
    expect(within(members).getByText('health worker')).toBeTruthy()
    expect(screen.queryAllByRole('button').map(button => button.textContent)).toEqual(['Back to list'])
    // Back to the list, focus returns to the campaign opened.
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(document.activeElement).toBe(within(await campaignsTable()).getByRole('button', { name: 'Demo screening week' }))
  })

  it('says when a campaign has no members, and when its members cannot be read, with a retry', async () => {
    api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) => {
      if (campaignId === 'campaign-2') throw new HidApiError(403, 'Members of this campaign cannot be read here.', { code: 'FORBIDDEN' })
      return []
    })
    renderPage()
    await press(within(await campaignsTable()).getByRole('button', { name: 'Demo screening week' }))
    expect(await screen.findByText('No members')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    await press(within(await campaignsTable()).getByRole('button', { name: 'Demo follow-up' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Members of this campaign cannot be read here.')
    const reads = api.outreachCampaignMembers.mock.calls.filter(call => call[1] === 'campaign-2').length
    await press(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.outreachCampaignMembers.mock.calls.filter(call => call[1] === 'campaign-2')).toHaveLength(reads + 1))
  })
})

/** The new registration case form, filled in as given. */
async function openNew() {
  await press(await screen.findByRole('button', { name: 'Create record' }))
  return screen.getByRole('button', { name: 'Save record' }).closest('form') as HTMLFormElement
}

function fill(form: HTMLElement, values: { fullName?: string; sex?: string; age?: string; phone?: string; notes?: string; campaign?: string }) {
  const set = (label: RegExp, value: string | undefined) => { if (value !== undefined) fireEvent.change(within(form).getByLabelText(label), { target: { value } }) }
  set(/^Campaign/, values.campaign); set(/^Full name/, values.fullName); set(/^Sex/, values.sex); set(/^Age/, values.age); set(/^Phone/, values.phone)
  set(/^Operational notes/, values.notes)
  return within(form).getByRole('button', { name: 'Save record' })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const commands = () => api.createOutreachCase.mock.calls.map(call => call[2] as { localCommandId: string; temporaryPatientId: string })
const createdCase = { ...pendingCase, id: 'c0a5e000-0000-4000-8000-0000000000aa', fullName: 'Patient One', campaignId: undefined, rowVersion: 1 }

describe('creating a registration case', () => {
  it('opens the design form, its heading focused, with the required fields marked and required', async () => {
    renderPage()
    const form = await openNew()
    expect(heading().textContent).toBe('New outreach')
    expect(document.activeElement).toBe(heading())
    expect(form.noValidate).toBe(true)
    const marked = Array.from(form.querySelectorAll('label')).filter(label => label.querySelector('[aria-hidden="true"]')?.textContent === ' *')
    expect(marked.map(label => label.textContent)).toEqual(['Full name *', 'Sex *', 'Age (years) *'])
    for (const label of marked) expect((document.getElementById(label.htmlFor) as HTMLInputElement).required).toBe(true)
    expect((within(form).getByLabelText(/^Sex/) as HTMLSelectElement).value).toBe('unknown')
    expect(within(form).getByRole('button', { name: 'Save record' }).getAttribute('type')).toBe('submit')
  })

  it('offers only active registration campaigns this membership belongs to', async () => {
    renderPage()
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledTimes(4))
    const form = await openNew()
    const select = within(form).getByLabelText(/^Campaign/) as HTMLSelectElement
    await waitFor(() => expect(Array.from(select.options).map(option => option.textContent)).toEqual(['No campaign', 'Demo screening week']))
    expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Only active registration campaigns you belong to are listed. A case can also be saved without one.')
  })

  it('has no campaign field without campaign read permission', async () => {
    session.permissions = ['outreach.registration.read', 'outreach.registration.write']
    renderPage()
    const form = await openNew()
    expect(within(form).queryByLabelText(/^Campaign/)).toBeNull()
  })

  it('sends the case with a new command, then opens the case made and reads the cases again', async () => {
    api.createOutreachCase.mockResolvedValue(createdCase)
    renderPage()
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledTimes(4))
    const form = await openNew()
    await waitFor(() => expect(within(form).getAllByRole('option', { name: 'Demo screening week' })).toHaveLength(1))
    await press(fill(form, { campaign: 'campaign-1', fullName: '  Patient One ', sex: 'female', age: '34', phone: ' 0800 000 0000 ', notes: '  Met at the market clinic ' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    expect(api.createOutreachCase.mock.calls[0]!.slice(0, 2)).toEqual([DEMO_HOSPITAL_ID, { campaignId: 'campaign-1', fullName: 'Patient One', sex: 'female',
      ageYears: 34, phone: '0800 000 0000', operationalNotes: 'Met at the market clinic' }])
    expect(commands()[0]!.localCommandId).toMatch(UUID)
    expect(commands()[0]!.temporaryPatientId).toMatch(/^tmp_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await waitFor(() => expect(heading().textContent).toBe('Patient One'))
    expect(document.activeElement).toBe(heading())
    expect(screen.getByText('Registration case created')).toBeTruthy()
    expect(screen.getByText('It stays pending until it is linked to a verified Health ID patient.')).toBeTruthy()
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledTimes(2))
  })

  it('sends nothing but a campaign it is offered: no campaign by default', async () => {
    api.createOutreachCase.mockResolvedValue(createdCase)
    renderPage()
    const form = await openNew()
    await press(fill(form, { fullName: 'Patient One', age: '0' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    expect(api.createOutreachCase.mock.calls[0]![1]).toEqual({ campaignId: undefined, fullName: 'Patient One', sex: 'unknown', ageYears: 0,
      phone: undefined, operationalNotes: undefined })
  })

  it('sends the same command again when the same case is retried after a lost answer, and says how to retry', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(0, 'The network request failed.', { code: 'NETWORK_ERROR' }))
    renderPage()
    const form = await openNew()
    const save = fill(form, { fullName: 'Patient One', sex: 'female', age: '34' })
    await press(save)
    expect((await screen.findByRole('alert')).textContent).toBe('The network request failed.')
    expect(screen.getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeTruthy()
    // The form keeps what was entered.
    expect((within(form).getByLabelText(/^Full name/) as HTMLInputElement).value).toBe('Patient One')
    api.createOutreachCase.mockResolvedValueOnce(createdCase)
    await press(save)
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(2))
    expect(commands()[1]).toEqual(commands()[0])
  })

  it('sends a new command for a different case, and for the next case once one is created', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(503, 'Outreach is unavailable.', { code: 'SERVICE_UNAVAILABLE' }))
    renderPage()
    let form = await openNew()
    await press(fill(form, { fullName: 'Patient One', sex: 'female', age: '34' }))
    await screen.findByRole('alert')
    // A different case: the age was mistyped.
    api.createOutreachCase.mockResolvedValueOnce(createdCase)
    await press(fill(form, { age: '43' }))
    await waitFor(() => expect(heading().textContent).toBe('Patient One'))
    // The next case, though its details match the last.
    await press(screen.getByRole('button', { name: 'Back to list' }))
    form = await openNew()
    api.createOutreachCase.mockResolvedValueOnce(createdCase)
    await press(fill(form, { fullName: 'Patient One', sex: 'female', age: '43' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(3))
    const [first, second, third] = commands()
    expect(second!.localCommandId).not.toBe(first!.localCommandId)
    expect(second!.temporaryPatientId).not.toBe(first!.temporaryPatientId)
    expect(third!.localCommandId).not.toBe(second!.localCommandId)
  })

  it('says each field Outreach refused, by name', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(400, 'Some details were refused.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'fullName', messages: ['fullName must be shorter than or equal to 200 characters'] }],
    }))
    renderPage()
    await press(fill(await openNew(), { fullName: 'Patient One', age: '34' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Some details were refused. Full name must be shorter than or equal to 200 characters.')
  })

  it('says a failure with no words of its own plainly', async () => {
    api.createOutreachCase.mockRejectedValueOnce('offline')
    renderPage()
    await press(fill(await openNew(), { fullName: 'Patient One', age: '34' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The registration case could not be saved. Please retry.')
  })

  it.each([
    ['Operational notes', { notes: '  ab ' }, 'outreach-case-notes', 'Enter at least 3 characters, or leave this blank.'],
    ['Phone', { phone: ' 12 ' }, 'outreach-case-phone', 'Enter at least 3 characters, or leave this blank.'],
    ['an empty full name', { fullName: '   ' }, 'outreach-case-name', 'Complete this field.'],
    ['an empty age', { age: '' }, 'outreach-case-age', 'Complete this field.'],
    ['an age over 130', { age: '131' }, 'outreach-case-age', 'Enter an age in whole years, from 0 to 130.'],
    ['an age below 0', { age: '-1' }, 'outreach-case-age', 'Enter an age in whole years, from 0 to 130.'],
    ['an age in part years', { age: '4.5' }, 'outreach-case-age', 'Enter an age in whole years, from 0 to 130.'],
  ])('refuses %s as Outreach would, at the field', async (_name, values, id, message) => {
    renderPage()
    await press(fill(await openNew(), { fullName: 'Patient One', sex: 'female', age: '34', ...values }))
    const field = document.getElementById(id)!
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe(message)
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })

  it('marks every refused field at once, focus on the first, and clears them once corrected', async () => {
    api.createOutreachCase.mockResolvedValue(createdCase)
    renderPage()
    const form = await openNew()
    await press(fill(form, { fullName: '', age: '', phone: '1' }))
    const name = document.getElementById('outreach-case-name')!
    await waitFor(() => expect(document.activeElement).toBe(name))
    for (const id of ['outreach-case-name', 'outreach-case-age', 'outreach-case-phone']) {
      expect(document.getElementById(id)!.getAttribute('aria-invalid')).toBe('true')
    }
    expect(document.getElementById('outreach-case-notes')!.getAttribute('aria-invalid')).toBeNull()
    await press(fill(form, { fullName: 'Patient One', age: '34', phone: '' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
  })

  // Refused from Save record, focus moves to the field, whose description says why. Refused from Enter in that field,
  // focus cannot move, so the refusal is an alert there, new each time.
  it('says a refusal made from Enter in the refused field itself as an alert', async () => {
    renderPage()
    const form = await openNew()
    await press(fill(form, { fullName: 'Patient One', sex: 'female', age: '34', phone: ' 12 ' }))
    const phone = document.getElementById('outreach-case-phone')!
    await waitFor(() => expect(document.activeElement).toBe(phone))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { fireEvent.submit(form) })
    const message = 'Enter at least 3 characters, or leave this blank.'
    const first = await screen.findByRole('alert')
    expect(first.textContent).toBe(message)
    await act(async () => { fireEvent.submit(form) })
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })

  it('goes back to the list without sending anything', async () => {
    renderPage()
    await openNew()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(heading().textContent).toBe('Outreach')
    expect(document.activeElement).toBe(heading())
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })
})

async function openCase(name = 'Patient One') {
  await press(within(await casesTable()).getByRole('button', { name }))
}

const linkToggle = () => screen.getByRole('button', { name: 'Link existing patient', expanded: false })

describe('a registration case', () => {
  it('opens as the design record view, its heading focused', async () => {
    renderPage()
    await openCase()
    expect(heading().textContent).toBe('Patient One')
    expect(document.activeElement).toBe(heading())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Patient One · c0a5e000')).toBeTruthy()
    const saved = screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement
    expect(within(saved).getAllByRole('term').map(term => term.textContent)).toEqual(['Full name', 'Age', 'Sex', 'Status', 'Temporary patient ID', 'Campaign', 'Created'])
    expect(within(saved).getByText('34 years')).toBeTruthy()
    expect(within(saved).getByText('Demo screening week')).toBeTruthy()
    expect(screen.getByText('Identity resolution pending')).toBeTruthy()
    expect(screen.getByText('This is a temporary registration. It stays pending until it is linked to a verified Health ID patient.')).toBeTruthy()
    expect(linkToggle()).toBeTruthy()
  })

  it('opens the link form inline from Available actions, and closes it again', async () => {
    renderPage()
    await openCase()
    const toggle = linkToggle()
    await press(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const form = screen.getByRole('form', { name: 'Link existing patient' }) as HTMLFormElement
    expect(toggle.getAttribute('aria-controls')).toBe(form.id)
    expect(within(form).getByLabelText(/^Patient ID/)).toBeTruthy()
    expect(within(form).getByLabelText(/^Reason for linking/)).toBeTruthy()
    expect(form.noValidate).toBe(true)
    await press(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('form', { name: 'Link existing patient' })).toBeNull()
  })

  it('sends the patient, the case and its version, and the reason, then reads the cases again and says so', async () => {
    api.outreachCases.mockResolvedValueOnce([pendingCase, resolvedCase]).mockResolvedValue([{ ...pendingCase, status: 'identity_resolved', rowVersion: 4 }, resolvedCase])
    api.linkExistingOutreachCase.mockResolvedValue({ ...pendingCase, status: 'identity_resolved', rowVersion: 4 })
    renderPage()
    await openCase()
    await press(linkToggle())
    const form = screen.getByRole('form', { name: 'Link existing patient' })
    fireEvent.change(within(form).getByLabelText(/^Patient ID/), { target: { value: ` ${PATIENT} ` } })
    fireEvent.change(within(form).getByLabelText(/^Reason for linking/), { target: { value: ' Same name, age and phone as the Health ID record ' } })
    await press(within(form).getByRole('button', { name: 'Link existing patient' }))
    await waitFor(() => expect(api.linkExistingOutreachCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, pendingCase, PATIENT,
      'Same name, age and phone as the Health ID record'))
    const status = document.getElementById(`outreach-case-status-${CASE_ID}`)!
    expect(status.getAttribute('role')).toBe('status')
    await waitFor(() => expect(within(status).getByText('Patient linked')).toBeTruthy())
    expect(api.outreachCases).toHaveBeenCalledTimes(2)
    // Resolved: the link is no longer offered, and focus, lost with the form, is on the case.
    await waitFor(() => expect(screen.getByText('No further actions for your permission and this record state.')).toBeTruthy())
    expect(screen.getAllByText('identity resolved').length).toBeGreaterThan(0)
    expect(screen.queryByText('Identity resolution pending')).toBeNull()
    expect(document.activeElement).toBe(heading())
  })

  it('sends nothing without a patient ID, or with a reason under 8 characters', async () => {
    renderPage()
    await openCase()
    await press(linkToggle())
    const form = screen.getByRole('form', { name: 'Link existing patient' })
    const submit = within(form).getByRole('button', { name: 'Link existing patient' })
    await press(submit)
    const patient = within(form).getByLabelText(/^Patient ID/)
    await waitFor(() => expect(document.activeElement).toBe(patient))
    expect(document.getElementById(patient.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Complete this field.')
    const reason = within(form).getByLabelText(/^Reason for linking/)
    expect(reason.getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(patient, { target: { value: PATIENT } })
    fireEvent.change(reason, { target: { value: ' short  ' } })
    await press(submit)
    await waitFor(() => expect(document.activeElement).toBe(reason))
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter at least 8 characters.')
    expect(patient.getAttribute('aria-invalid')).toBeNull()
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
  })

  it.each([
    ['a version conflict', new HidApiError(409, 'This registration case has changed. Refresh it and try again.', { code: 'VERSION_CONFLICT' }),
      'This registration case has changed. Refresh it and try again.'],
    ['a patient this membership may not open', new HidApiError(403, 'You do not have access to this patient.', { code: 'FORBIDDEN' }),
      'You do not have access to this patient.'],
    ['an unknown failure', 'offline', 'The patient could not be linked. Check your access to this patient, then refresh the case.'],
  ])('says %s, keeps the form, and reads nothing again', async (_name, error, message) => {
    api.linkExistingOutreachCase.mockRejectedValue(error)
    renderPage()
    await openCase()
    await press(linkToggle())
    const form = screen.getByRole('form', { name: 'Link existing patient' })
    fireEvent.change(within(form).getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    fireEvent.change(within(form).getByLabelText(/^Reason for linking/), { target: { value: 'Same name and phone as the record' } })
    await press(within(form).getByRole('button', { name: 'Link existing patient' }))
    expect((await within(form).findByRole('alert')).textContent).toBe(message)
    expect(within(form).getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeTruthy()
    expect(screen.queryByText('Patient linked')).toBeNull()
    expect(api.outreachCases).toHaveBeenCalledTimes(1)
  })

  it('offers no link without registration write permission', async () => {
    session.permissions = READ
    renderPage()
    await openCase()
    expect(screen.queryByRole('button', { name: 'Link existing patient' })).toBeNull()
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeTruthy()
  })

  it('offers no link for a case already resolved', async () => {
    renderPage()
    await openCase('Patient Two')
    expect(screen.queryByRole('button', { name: 'Link existing patient' })).toBeNull()
    expect(screen.queryByText('Identity resolution pending')).toBeNull()
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeTruthy()
  })

  it('says a record the list no longer holds is not found', async () => {
    api.outreachCases.mockResolvedValueOnce([pendingCase, resolvedCase]).mockResolvedValue([resolvedCase])
    api.linkExistingOutreachCase.mockResolvedValue({ ...pendingCase, status: 'identity_resolved', rowVersion: 4 })
    renderPage()
    await openCase()
    await press(linkToggle())
    const form = screen.getByRole('form', { name: 'Link existing patient' })
    fireEvent.change(within(form).getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    fireEvent.change(within(form).getByLabelText(/^Reason for linking/), { target: { value: 'Same name and phone as the record' } })
    await press(within(form).getByRole('button', { name: 'Link existing patient' }))
    // Read again, the list no longer holds the case: it is not shown from memory.
    await waitFor(() => expect(heading().textContent).toBe('Record not found'))
    expect(screen.getByText('The record is missing or outside your authorized hospital / branch.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(within(await casesTable()).queryByRole('button', { name: 'Patient One' })).toBeNull()
  })

  it('goes back to the list with focus on the case it came from', async () => {
    renderPage()
    await openCase()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(document.activeElement).toBe(within(await casesTable()).getByRole('button', { name: 'Patient One' }))
  })

  it('opens on its lists at another facility, read for that facility', async () => {
    const { rerender } = renderPage()
    await openCase()
    session.facility = 'other'
    rerender(<MemoryRouter initialEntries={['/ehr']}><div className="hid-ehr"><Outreach /></div></MemoryRouter>)
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledWith('facility-other'))
    expect(heading().textContent).toBe('Outreach')
    expect(api.outreachCampaigns).toHaveBeenCalledWith('facility-other')
  })

  it('puts nothing about the record in the address', async () => {
    const before = window.location.href
    renderPage()
    await openCase()
    expect(window.location.href).toBe(before)
    expect(window.location.href).not.toContain(CASE_ID)
  })
})
