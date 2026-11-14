import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { forgetOutreachServed } from '../../../../ehr-blue/departments/outreach/outreachServed'
import { SAID_REFUSED } from '../../../said'

/*
 * Outreach campaign management, where Outreach serves it (hid-system#222, migration 0111, ADR-045 option B): anyone
 * who may write campaigns creates one and becomes its first admin; only a campaign's own admins open it, close it and
 * add people to it. Every account, facility, campaign and person here is fictional.
 */

const session = vi.hoisted(() => ({ permissions: [] as string[], roles: ['outreach_officer'] as string[] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return { useStaff: () => staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital', roles: session.roles })) }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCasesPage: vi.fn(), outreachScreening: vi.fn(), outreachCampaignGovernance: vi.fn(),
  outreachCampaignStaff: vi.fn(), createOutreachCampaign: vi.fn(), setOutreachCampaignStatus: vi.fn(), addOutreachCampaignMember: vi.fn(),
  // An outreach group's "Your team" only.
  outreachInvitations: vi.fn(),
}))
// Every staff API member the page reaches for that this test does not provide.
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
const MANAGE = ['outreach.campaign.read', 'outreach.campaign.write']

const campaign = (id: string, name: string, status: string, startsAt = '2026-01-01T00:00:00.000Z') =>
  ({ id, name, status, services: ['registration', 'lab_sample'], startsAt, endsAt: null, rowVersion: 3 })
const PLANNED = campaign('campaign-1', 'Demo screening week', 'planned')
const RUNNING = campaign('campaign-2', 'Demo immunisation day', 'active')
const LATER = campaign('campaign-3', 'Demo eye clinic', 'planned', '2099-03-01T00:00:00.000Z')
const FINISHED = campaign('campaign-4', 'Demo follow-up', 'closed')

const ADMIN = { membershipId: MEMBERSHIP, name: 'Demo Admin', campaignRole: 'admin' }
const NURSE = { membershipId: 'membership-demo-2', name: 'Demo Nurse', campaignRole: null }
const CLERK = { membershipId: 'membership-demo-3', name: 'Demo Clerk', campaignRole: 'enumerator' }

beforeEach(() => {
  // The list's first read (hid-system#247) is today's request; an Outreach before paging answers it with no cursor.
  api.outreachCasesPage.mockImplementation(async (facilityId: string) => ({ items: await api.outreachCases(facilityId), nextCursor: null }))
  vi.clearAllMocks()
  // Today's Outreach serves no health checks (0118): the section is not shown.
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  unprovided.clear()
  session.permissions = MANAGE
  session.roles = ['outreach_officer']
  api.outreachCampaigns.mockResolvedValue([PLANNED, RUNNING, LATER, FINISHED])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins' })
  api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) => [
    { id: `${campaignId}-admin`, campaignId, membershipId: MEMBERSHIP, role: 'admin', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: `${campaignId}-clerk`, campaignId, membershipId: CLERK.membershipId, role: 'enumerator', createdAt: '2026-01-03T00:00:00.000Z' },
  ])
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'admin', people: [ADMIN, CLERK, NURSE] })
})

afterEach(() => {
  // Nothing outside Outreach's campaign requests is reached for.
  expect([...unprovided]).toEqual([])
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const heading = () => screen.getByRole('heading', { level: 1 })
const campaignsList = () => screen.findByRole('list', { name: 'Campaigns' })
async function openCampaign(name: string) {
  await press(within(await campaignsList()).getByRole('button', { name: new RegExp(`^${name}`) }))
  // Its actions once Outreach has said who this membership is in it.
  await waitFor(() => expect(screen.queryByText('Checking your role in this campaign…')).toBeNull())
}
const actions = () => screen.getByRole('heading', { level: 2, name: /^(Available actions|Open campaign|Close campaign|Add a person)$/ })
  .closest('section') as HTMLElement
const statusText = () => screen.getAllByRole('status').map(region => region.textContent ?? '').join(' ')

describe('who is offered campaign management', () => {
  it('asks Outreach only for a membership that may write campaigns', async () => {
    session.permissions = ['outreach.campaign.read']
    renderDept(<Outreach />)
    await campaignsList()
    expect(api.outreachCampaignGovernance).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'New campaign' })).toBeNull()
    await openCampaign('Demo screening week')
    expect(api.outreachCampaignStaff).not.toHaveBeenCalled()
    expect(within(actions()).getByText('Nothing else to do here.')).toBeTruthy()
  })

  it('offers it where Outreach says a campaign’s own admins manage it, and says each campaign’s services in words', async () => {
    renderDept(<Outreach />)
    const list = await campaignsList()
    expect(await screen.findByRole('button', { name: 'New campaign' })).toBeTruthy()
    expect(api.outreachCampaignGovernance.mock.calls).toEqual([[DEMO_HOSPITAL_ID]])
    expect(list.textContent).toContain('Registration, Lab samples')
    expect(list.textContent).not.toContain('lab_sample')
  })

  it('tells a member who is not an admin that only its admins change it, naming its members', async () => {
    api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'enumerator', people: [{ ...ADMIN, membershipId: 'membership-demo-9' },
      { ...CLERK, membershipId: MEMBERSHIP }] })
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    expect(within(actions()).getByText('Only this campaign’s admins can open it, close it or add people to it.')).toBeTruthy()
    for (const name of ['Open campaign', 'Close campaign', 'Add a person']) expect(screen.queryByRole('button', { name })).toBeNull()
    const members = screen.getByRole('heading', { name: 'Members' }).closest('section') as HTMLElement
    expect(within(members).getByText('Demo Clerk')).toBeTruthy()
  })
})

describe('creating a campaign', () => {
  async function openForm() {
    await press(await screen.findByRole('button', { name: 'New campaign' }))
    expect(heading().textContent).toBe('New campaign')
    return screen.getByRole('button', { name: 'Create campaign' }).closest('form') as HTMLFormElement
  }

  it('checks the form as Outreach does before sending anything', async () => {
    renderDept(<Outreach />)
    const form = await openForm()
    fireEvent.click(within(form).getByLabelText(/^Registration/))
    fireEvent.change(within(form).getByLabelText(/^Start date/), { target: { value: '2026-11-20' } })
    fireEvent.change(within(form).getByLabelText(/^End date/), { target: { value: '2026-11-19' } })
    await press(within(form).getByRole('button', { name: 'Create campaign' }))
    expect(form.textContent).toContain('Complete this field.')
    expect(form.textContent).toContain('Choose at least one service.')
    expect(form.textContent).toContain('Choose an end date on or after the start date.')
    expect(document.activeElement).toBe(within(form).getByLabelText(/^Campaign name/))
    fireEvent.change(within(form).getByLabelText(/^Campaign name/), { target: { value: 'D' } })
    await press(within(form).getByRole('button', { name: 'Create campaign' }))
    expect(form.textContent).toContain('Enter at least 2 characters.')
    expect(api.createOutreachCampaign).not.toHaveBeenCalled()
  })

  it('creates it over Nigerian days, then opens it and says its creator is its admin', async () => {
    const created = { ...campaign('campaign-9', 'Demo market outreach', 'planned', '2026-11-19T23:00:00.000Z'), rowVersion: 1 }
    api.createOutreachCampaign.mockResolvedValue(created)
    renderDept(<Outreach />)
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText(/^Campaign name/), { target: { value: '  Demo market outreach ' } })
    fireEvent.click(within(form).getByLabelText(/^Vaccination/))
    fireEvent.change(within(form).getByLabelText(/^Start date/), { target: { value: '2026-11-20' } })
    fireEvent.change(within(form).getByLabelText(/^End date/), { target: { value: '2026-11-20' } })
    const reads = api.outreachCampaigns.mock.calls.length
    await press(within(form).getByRole('button', { name: 'Create campaign' }))
    expect(api.createOutreachCampaign.mock.calls).toEqual([[DEMO_HOSPITAL_ID, { name: 'Demo market outreach',
      services: ['registration', 'vaccination'], startsAt: '2026-11-19T23:00:00.000Z', endsAt: '2026-11-20T22:59:59.000Z' }]])
    expect(heading().textContent).toBe('Demo market outreach')
    expect(document.activeElement).toBe(heading())
    expect(screen.getByText('Campaign created')).toBeTruthy()
    expect(api.outreachCampaigns.mock.calls.length).toBeGreaterThan(reads)
  })

  it('says a create whose answer was lost may be saved, reads the list again, and sends nothing by itself', async () => {
    api.createOutreachCampaign.mockRejectedValue(new HidApiError(0, 'Network down', { code: 'NETWORK_ERROR' }))
    renderDept(<Outreach />)
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText(/^Campaign name/), { target: { value: 'Demo market outreach' } })
    fireEvent.change(within(form).getByLabelText(/^Start date/), { target: { value: '2026-11-20' } })
    const reads = api.outreachCampaigns.mock.calls.length
    await press(within(form).getByRole('button', { name: 'Create campaign' }))
    expect(form.textContent).toContain('Check it for this campaign before you retry')
    await waitFor(() => expect(api.outreachCampaigns.mock.calls.length).toBe(reads + 1))
    expect(api.createOutreachCampaign).toHaveBeenCalledTimes(1)
  })
})

describe('a campaign’s admin', () => {
  it('opens a planned campaign that has started, with a reason, against the version it was read at', async () => {
    api.setOutreachCampaignStatus.mockResolvedValue({ ...PLANNED, status: 'active', rowVersion: 4 })
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    await press(within(actions()).getByRole('button', { name: 'Open campaign' }))
    const form = screen.getByRole('form', { name: 'Open campaign' })
    expect(document.activeElement).toBe(within(form).getByLabelText(/^Why it is opening/))
    fireEvent.change(within(form).getByLabelText(/^Why it is opening/), { target: { value: 'Short' } })
    await press(within(form).getByRole('button', { name: 'Open campaign' }))
    expect(form.textContent).toContain('Enter at least 8 characters.')
    expect(api.setOutreachCampaignStatus).not.toHaveBeenCalled()
    fireEvent.change(within(form).getByLabelText(/^Why it is opening/), { target: { value: ' The team is on site. ' } })
    const reads = api.outreachCampaigns.mock.calls.length
    await press(within(form).getByRole('button', { name: 'Open campaign' }))
    expect(api.setOutreachCampaignStatus.mock.calls).toEqual([[DEMO_HOSPITAL_ID, PLANNED, 'active', 'The team is on site.']])
    expect(statusText()).toContain('Campaign opened. Its members can now register people into it.')
    expect(document.activeElement?.id).toBe('outreach-campaign-campaign-1-done')
    expect(api.outreachCampaigns.mock.calls.length).toBeGreaterThan(reads)
  })

  it('closes a campaign only once they confirm it is for good', async () => {
    api.setOutreachCampaignStatus.mockResolvedValue({ ...RUNNING, status: 'closed', rowVersion: 4 })
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    expect(within(actions()).queryByRole('button', { name: 'Open campaign' })).toBeNull()
    await press(within(actions()).getByRole('button', { name: 'Close campaign' }))
    const form = screen.getByRole('form', { name: 'Close campaign' })
    fireEvent.change(within(form).getByLabelText(/^Why it is closing/), { target: { value: 'The work is done.' } })
    await press(within(form).getByRole('button', { name: 'Close campaign' }))
    const sheet = await screen.findByRole('dialog', { name: 'Close this campaign?' })
    expect(sheet.textContent).toContain('can’t be opened again')
    await press(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(api.setOutreachCampaignStatus).not.toHaveBeenCalled()
    await press(within(form).getByRole('button', { name: 'Close campaign' }))
    await press(within(await screen.findByRole('dialog', { name: 'Close this campaign?' })).getByRole('button', { name: 'Close campaign' }))
    expect(api.setOutreachCampaignStatus.mock.calls).toEqual([[DEMO_HOSPITAL_ID, RUNNING, 'closed', 'The work is done.']])
    expect(statusText()).toContain('Campaign closed.')
  })

  it('is not offered Open before the start date, and a finished campaign offers nothing more', async () => {
    renderDept(<Outreach />)
    await openCampaign('Demo eye clinic')
    expect(within(actions()).queryByRole('button', { name: 'Open campaign' })).toBeNull()
    expect(within(actions()).getByText(/^You can open it from 1 Mar 2099/)).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    await openCampaign('Demo follow-up')
    expect(within(actions()).getByText('This campaign is finished. Nothing more can be changed.')).toBeTruthy()
    expect(within(actions()).queryAllByRole('button')).toEqual([])
  })

  it('adds a person from the facility’s active staff, with their role, and names the members', async () => {
    api.addOutreachCampaignMember.mockResolvedValue({ id: 'member-new', campaignId: 'campaign-1', membershipId: NURSE.membershipId,
      role: 'health_worker', createdAt: '2026-11-11T09:00:00.000Z' })
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    const members = screen.getByRole('heading', { name: 'Members' }).closest('section') as HTMLElement
    expect(within(members).getByText('Demo Admin')).toBeTruthy()
    expect(within(members).getByText('Demo Clerk')).toBeTruthy()
    expect(within(members).queryByText('Team member')).toBeNull()
    await press(within(actions()).getByRole('button', { name: 'Add a person' }))
    const form = screen.getByRole('form', { name: 'Add a person' })
    // Only people not in it yet are offered.
    const person = within(form).getByLabelText(/^Person/) as HTMLSelectElement
    expect([...person.options].map(option => option.textContent)).toEqual(['Choose a person', 'Demo Nurse'])
    await press(within(form).getByRole('button', { name: 'Add to campaign' }))
    expect(form.textContent).toContain('Complete this field.')
    fireEvent.change(person, { target: { value: NURSE.membershipId } })
    fireEvent.change(within(form).getByLabelText(/^Their role/), { target: { value: 'health_worker' } })
    const staffReads = api.outreachCampaignStaff.mock.calls.length
    await press(within(form).getByRole('button', { name: 'Add to campaign' }))
    expect(api.addOutreachCampaignMember.mock.calls).toEqual([[DEMO_HOSPITAL_ID, 'campaign-1', { membershipId: NURSE.membershipId, role: 'health_worker' }]])
    expect(statusText()).toContain('Demo Nurse added as health worker.')
    expect(api.outreachCampaignStaff.mock.calls.length).toBeGreaterThan(staffReads)
  })

  it('says Outreach’s refusals in plain words, never sending them to the facility administrator, and reads the campaign again', async () => {
    api.setOutreachCampaignStatus.mockRejectedValueOnce(new HidApiError(412, 'The Outreach campaign changed; reload before retrying', { code: 'VERSION_CONFLICT' }))
      .mockRejectedValueOnce(new HidApiError(403, 'Only this Outreach campaign\'s admins can open or close it', { code: 'OUTREACH_CAMPAIGN_ADMIN_REQUIRED' }))
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    await press(within(actions()).getByRole('button', { name: 'Open campaign' }))
    const form = screen.getByRole('form', { name: 'Open campaign' })
    fireEvent.change(within(form).getByLabelText(/^Why it is opening/), { target: { value: 'The team is on site.' } })
    const reads = api.outreachCampaigns.mock.calls.length
    await press(within(form).getByRole('button', { name: 'Open campaign' }))
    expect(form.textContent).toContain('This campaign changed since you opened it. It has been read again: check it, then try again.')
    expect(api.outreachCampaigns.mock.calls.length).toBe(reads + 1)
    await press(within(form).getByRole('button', { name: 'Open campaign' }))
    expect(form.textContent).toContain('Only this campaign’s admins can do this. Ask one of them.')
    expect(document.body.textContent).not.toContain(SAID_REFUSED)
    expect(document.body.textContent).not.toMatch(/VERSION_CONFLICT|OUTREACH_CAMPAIGN|reload before retrying/)
  })
})

/*
 * Helpers who join an outreach group are in no campaign until an admin adds them, so at an outreach group an admin can
 * add everyone not in it yet at once, each as an enumerator, one after another.
 */
describe('adding everyone who has joined', () => {
  const PORTER = { membershipId: 'membership-demo-4', name: 'Demo Porter', campaignRole: null }
  const DRIVER = { membershipId: 'membership-demo-5', name: 'Demo Driver', campaignRole: null }
  const everyone = () => within(actions()).getByRole('button', { name: 'Add everyone who has joined (3)' })
  const offered = () => screen.queryByRole('button', { name: /^Add (everyone|the 1 person) who has joined/ })

  beforeEach(() => {
    session.roles = ['outreach_organiser']
    setOutreachQueueStore(memoryQueueStore())
    forgetOutreachServed()
    api.outreachInvitations.mockResolvedValue({ members: [], invitations: [] })
    api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'admin', people: [ADMIN, CLERK, NURSE, PORTER, DRIVER] })
  })
  afterEach(() => {
    setOutreachQueueStore(null)
  })

  it('adds each person not in the campaign yet as an enumerator, one at a time, then reads the campaign’s people again', async () => {
    let running = 0
    let most = 0
    api.addOutreachCampaignMember.mockImplementation(async () => {
      running += 1
      most = Math.max(most, running)
      await new Promise(resolve => setTimeout(resolve, 5))
      running -= 1
      return {}
    })
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    // Adding one person with a chosen role is still offered.
    expect(within(actions()).getByRole('button', { name: 'Add a person' })).toBeTruthy()
    const staffReads = api.outreachCampaignStaff.mock.calls.length
    const memberReads = api.outreachCampaignMembers.mock.calls.length
    await press(everyone())
    // The campaign is open and takes registrations: they see it once they press Refresh.
    await waitFor(() => expect(statusText()).toContain('Added 3 people as enumerators. They can register people once they press Refresh.'))
    expect(api.addOutreachCampaignMember.mock.calls).toEqual([NURSE, PORTER, DRIVER].map(person =>
      [DEMO_HOSPITAL_ID, 'campaign-2', { membershipId: person.membershipId, role: 'enumerator' }]))
    expect(most).toBe(1)
    expect(document.activeElement?.id).toBe('outreach-campaign-campaign-2-done')
    await waitFor(() => expect(api.outreachCampaignStaff.mock.calls.length).toBeGreaterThan(staffReads))
    expect(api.outreachCampaignMembers.mock.calls.length).toBeGreaterThan(memberReads)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('at a campaign not open yet, says they can register once it is open; without registration, says nothing of it', async () => {
    api.addOutreachCampaignMember.mockResolvedValue({})
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    await press(everyone())
    await waitFor(() => expect(statusText()).toContain('Added 3 people as enumerators. They can register people once the campaign is open and they press Refresh.'))
    cleanup()
    api.outreachCampaigns.mockResolvedValue([{ ...RUNNING, services: ['lab_sample'] }])
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    await press(everyone())
    await waitFor(() => expect(statusText()).toContain('Added 3 people as enumerators.'))
    expect(statusText()).not.toMatch(/register people/)
  })

  it('says it for one person, and counts someone already in the campaign as added', async () => {
    api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'admin', people: [ADMIN, CLERK, NURSE] })
    api.addOutreachCampaignMember.mockRejectedValue(new HidApiError(409, 'Already a member', { code: 'OUTREACH_CAMPAIGN_MEMBER_EXISTS' }))
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    await press(within(actions()).getByRole('button', { name: 'Add the 1 person who has joined' }))
    await waitFor(() => expect(statusText()).toContain('Added 1 person as an enumerator. They can register people once they press Refresh.'))
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('adds the rest when one person can’t be added, then names who wasn’t', async () => {
    api.addOutreachCampaignMember.mockImplementation(async (_facilityId: string, _campaignId: string, body: { membershipId: string }) => {
      if (body.membershipId === PORTER.membershipId) throw new HidApiError(409, 'Not staff', { code: 'OUTREACH_STAFF_NOT_AVAILABLE' })
      if (body.membershipId === DRIVER.membershipId) throw new HidApiError(409, 'Already a member', { code: 'OUTREACH_CAMPAIGN_MEMBER_EXISTS' })
      return {}
    })
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    await press(everyone())
    await waitFor(() => expect(statusText()).toContain('Added 2 people as enumerators.'))
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(3)
    expect((await screen.findByRole('alert')).textContent).toBe('1 person couldn’t be added: Demo Porter. Try again.')
    expect(document.body.textContent).not.toMatch(/OUTREACH_STAFF|OUTREACH_CAMPAIGN/)
  })

  it('stops at once with no signal and says so, never naming everyone as not added', async () => {
    api.addOutreachCampaignMember.mockRejectedValue(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    await press(everyone())
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t reach Health ID. Check your connection and try again.')
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toMatch(/couldn’t be added: |NETWORK_ERROR/)
    expect(statusText()).not.toContain('Added')
  })

  it('stops when Health ID is unavailable or access is refused, keeping who was added and who wasn’t', async () => {
    api.addOutreachCampaignMember
      .mockRejectedValueOnce(new HidApiError(409, 'Not staff', { code: 'OUTREACH_STAFF_NOT_AVAILABLE' }))
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    await press(everyone())
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Health ID isn’t available right now. Please try again in a few minutes. 1 person couldn’t be added: Demo Nurse.')
    expect(statusText()).toContain('Added 1 person as an enumerator.')
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(3)
    cleanup()
    api.addOutreachCampaignMember.mockReset()
    api.addOutreachCampaignMember.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }))
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    await press(everyone())
    expect((await screen.findByRole('alert')).textContent).toBe('You don’t have access to do this. Ask your facility administrator if you need it.')
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(1)
  })

  it('stops when the campaign has changed, says so, and reads it again', async () => {
    api.addOutreachCampaignMember.mockRejectedValue(new HidApiError(409, 'Closed', { code: 'OUTREACH_CAMPAIGN_CLOSED' }))
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    const reads = api.outreachCampaigns.mock.calls.length
    await press(everyone())
    expect((await screen.findByRole('alert')).textContent).toBe('This campaign is finished. A finished campaign can’t be opened again.')
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(1)
    expect(api.outreachCampaigns.mock.calls.length).toBeGreaterThan(reads)
    expect(statusText()).not.toContain('Added')
  })

  it('starts nothing more while it is adding', async () => {
    let finish!: () => void
    api.addOutreachCampaignMember.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}) }))
      .mockResolvedValue({})
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    const button = everyone()
    await press(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.textContent).toBe('Adding…')
    expect(within(actions()).getByRole('button', { name: 'Add a person' }).getAttribute('aria-disabled')).toBe('true')
    await press(button)
    await press(within(actions()).getByRole('button', { name: 'Add a person' }))
    expect(screen.queryByRole('form', { name: 'Add a person' })).toBeNull()
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(1)
    await act(async () => { finish() })
    await waitFor(() => expect(statusText()).toContain('Added 3 people as enumerators.'))
    expect(api.addOutreachCampaignMember).toHaveBeenCalledTimes(3)
  })

  it('is not offered to a member who isn’t an admin, nor when everyone is in the campaign', async () => {
    api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'enumerator', people: [{ ...ADMIN, membershipId: 'membership-demo-9' },
      { ...CLERK, membershipId: MEMBERSHIP }, PORTER] })
    renderDept(<Outreach />)
    await openCampaign('Demo screening week')
    expect(offered()).toBeNull()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'admin', people: [ADMIN, CLERK] })
    await openCampaign('Demo immunisation day')
    expect(within(actions()).getByText('Everyone active at this facility is already in this campaign.')).toBeTruthy()
    expect(offered()).toBeNull()
  })

  it('is not offered at a hospital, where it would add all of its staff: one person at a time only', async () => {
    session.roles = ['outreach_officer']
    renderDept(<Outreach />)
    await openCampaign('Demo immunisation day')
    expect(within(actions()).getByRole('button', { name: 'Add a person' })).toBeTruthy()
    expect(offered()).toBeNull()
    expect(api.addOutreachCampaignMember).not.toHaveBeenCalled()
  })
})
