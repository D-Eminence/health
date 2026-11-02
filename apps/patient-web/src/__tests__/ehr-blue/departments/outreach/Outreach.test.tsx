import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'

/*
 * The blue Outreach page as the owner redesigned it: registrations as cards (filtered by what still needs doing), a
 * three-step New registration, and a case view with one next step (link, confirmed against the person) and a done
 * state; campaigns read only. On today's Outreach requests and rules (staff/routes/Operations.tsx Outreach,
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

const casesList = () => screen.findByRole('list', { name: 'Registrations' })
const campaignsList = () => screen.findByRole('list', { name: 'Campaigns' })
const heading = () => screen.getByRole('heading', { level: 1 })
/** A card's one button, named by everything on it: the person first. */
const card = (scope: HTMLElement, name: string) => within(scope).getByRole('button', { name: new RegExp(`^${name}(?![0-9])`) })
const queryCard = (scope: HTMLElement, name: string) => within(scope).queryByRole('button', { name: new RegExp(`^${name}(?![0-9])`) })
/** Shows the registrations in one tab of the list. */
async function showTab(name: 'Waiting to link' | 'Linked' | 'All') {
  const tabs = await screen.findByRole('navigation', { name: 'Show registrations' })
  await press(within(tabs).getByRole('button', { name: new RegExp(`^${name}`) }))
}
/** The card a card header's heading titles. */
const cardOf = (title: HTMLElement) => title.parentElement!.parentElement!.parentElement!.parentElement as HTMLElement
const alertTexts = () => screen.queryAllByRole('alert').map(alert => alert.textContent ?? '')

describe('who can open Outreach', () => {
  it('refuses a membership with no outreach read permission, and reads nothing', async () => {
    session.permissions = ['outreach.registration.write', 'outreach.campaign.write']
    renderPage()
    // Today's words (staff/routes/Operations.tsx Outreach): "Outreach unavailable" and the permission it needs.
    expect(heading().textContent).toBe('Outreach unavailable')
    expect(screen.getByText('This facility membership needs outreach campaign or registration read permission.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New registration' })).toBeNull()
    expect(api.outreachCases).not.toHaveBeenCalled()
    expect(api.outreachCampaigns).not.toHaveBeenCalled()
  })

  it('refuses when no facility is being worked at', () => {
    session.facility = 'none'
    renderPage()
    expect(screen.getByRole('alert').textContent).toBe('No facility is selected. Choose the facility you are working at to open Outreach.')
    expect(api.outreachCases).not.toHaveBeenCalled()
  })

  it('with registration read only, lists cases and offers neither campaigns nor a new case', async () => {
    session.permissions = ['outreach.registration.read']
    renderPage()
    expect(card(await casesList(), 'Patient One')).toBeTruthy()
    expect(api.outreachCases).toHaveBeenCalledWith(DEMO_HOSPITAL_ID)
    expect(api.outreachCampaigns).not.toHaveBeenCalled()
    expect(api.outreachCampaignMembers).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Campaigns' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Campaigns' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New registration' })).toBeNull()
  })

  it('with campaign read only, lists campaigns and reads no cases', async () => {
    session.permissions = ['outreach.campaign.read']
    renderPage()
    expect(await campaignsList()).toBeTruthy()
    expect(api.outreachCases).not.toHaveBeenCalled()
    expect(screen.queryByRole('searchbox', { name: 'Search Outreach' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New registration' })).toBeNull()
  })
})

describe('the list', () => {
  it('shows one h1, New registration, the search and the registrations as cards with their next step', async () => {
    renderPage()
    const list = await casesList()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(heading().textContent).toBe('Outreach')
    expect(screen.getByRole('button', { name: 'New registration' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search Outreach' }).getAttribute('placeholder')).toBe('Search by name')
    // The list opens on who still needs linking.
    const tabs = screen.getByRole('navigation', { name: 'Show registrations' })
    expect(within(tabs).getAllByRole('button').map(tab => [tab.textContent, tab.getAttribute('aria-pressed')]))
      .toEqual([['Waiting to link1', 'true'], ['Linked1', 'false'], ['All2', 'false']])
    const one = card(list, 'Patient One')
    // Who, age and sex, the status in words, and the next step.
    expect(within(one).getByText('34 years · Female · Demo screening week')).toBeTruthy()
    expect(within(one).getByText('Waiting to link')).toBeTruthy()
    expect(within(one).getByText('Next: link their Health ID')).toBeTruthy()
    expect(queryCard(list, 'Patient Two')).toBeNull()
    await showTab('Linked')
    const two = card(await casesList(), 'Patient Two')
    expect(within(two).getByText('Linked')).toBeTruthy()
    expect(within(two).getByText('Done: nothing more to do')).toBeTruthy()
    // No export: today's API has none, and a download would keep identifying data on the device.
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull()
  })

  it('says the list is loading', async () => {
    api.outreachCases.mockReturnValue(new Promise(() => {}))
    renderPage()
    const loading = await screen.findByRole('status', { name: 'Loading registrations' })
    expect(loading.textContent).toBe('Loading registrations…')
  })

  it('says when there are no cases yet, and offers the first registration', async () => {
    api.outreachCases.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No registrations yet')).toBeTruthy()
    expect(screen.getByText('People you register in the field show here, with what each needs next.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'New registration' })).toHaveLength(2)
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
    await waitFor(() => expect(alertTexts().some(text => text.includes(message))).toBe(true))
    expect(alertTexts().find(text => text.includes(message))).toContain('Couldn’t load registrations')
    expect(screen.queryByText('No registrations yet')).toBeNull()
  })

  it('says when campaigns cannot be read', async () => {
    api.outreachCampaigns.mockRejectedValue('offline')
    renderPage()
    expect(await screen.findByText('Campaigns could not be loaded. Refresh to try again.')).toBeTruthy()
  })

  it('searches what is loaded without sending anything, and clears the search', async () => {
    renderPage()
    await casesList()
    await showTab('All')
    const reads = api.outreachCases.mock.calls.length
    const search = screen.getByRole('searchbox', { name: 'Search Outreach' })
    fireEvent.change(search, { target: { value: 'two male' } })
    expect(queryCard(await casesList(), 'Patient One')).toBeNull()
    expect(card(await casesList(), 'Patient Two')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(screen.getByText('No matching registrations')).toBeTruthy()
    expect(screen.getByText('Check the spelling, or search by another name.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Clear search' }))
    expect((search as HTMLInputElement).value).toBe('')
    // The button removed itself: focus is back on the search.
    expect(document.activeElement).toBe(search)
    expect(card(await casesList(), 'Patient One')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(api.outreachCases).toHaveBeenCalledTimes(reads)
  })

  it('pages a long list 50 at a time', async () => {
    api.outreachCases.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({
      ...pendingCase, id: `c0a5e000-0000-4000-8000-${String(index).padStart(12, '0')}`, fullName: `Patient ${index + 1}`,
    })))
    renderPage()
    const pages = await screen.findByRole('navigation', { name: 'Registration case pages' })
    expect(within(await casesList()).getAllByRole('listitem')).toHaveLength(50)
    expect(within(pages).getByText('Page 1 of 2')).toBeTruthy()
    const previous = within(pages).getByRole('button', { name: 'Previous page' })
    const next = within(pages).getByRole('button', { name: 'Next page' })
    // Unavailable at the ends, but never disabled, so a button keeps the focus it has.
    expect(previous.getAttribute('aria-disabled')).toBe('true')
    expect(next.getAttribute('aria-disabled')).toBeNull()
    await press(previous)
    expect(within(pages).getByText('Page 1 of 2')).toBeTruthy()
    await press(next)
    expect(within(pages).getByText('Page 2 of 2')).toBeTruthy()
    expect(within(await casesList()).getAllByRole('listitem')).toHaveLength(1)
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect((next as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(next)
    await press(next)
    expect(within(pages).getByText('Page 2 of 2')).toBeTruthy()
    expect(previous.getAttribute('aria-disabled')).toBeNull()
  })

  it('reads both lists again on Refresh', async () => {
    renderPage()
    await casesList()
    await campaignsList()
    await press(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledTimes(2))
    expect(api.outreachCampaigns).toHaveBeenCalledTimes(2)
  })

  // The design's Quick view drawer is gone: a card opens the case itself, which shows what the drawer showed.
  it('opens a record from its card, with its saved details and campaign by name', async () => {
    renderPage()
    await press(card(await casesList(), 'Patient One'))
    expect(heading().textContent).toBe('Patient One')
    expect(document.activeElement).toBe(heading())
    const saved = cardOf(screen.getByRole('heading', { name: 'Registration' }))
    expect(within(saved).getByText('Temporary patient ID')).toBeTruthy()
    expect(within(saved).getByText('tmp_c0000000-0000-4000-8000-000000000001')).toBeTruthy()
    // The campaign the case was registered under, by name.
    expect(within(saved).getByText('Demo screening week')).toBeTruthy()
  })

  it('offers every control as a native button or field that the keyboard reaches', async () => {
    renderPage()
    await casesList()
    await campaignsList()
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
 * answer 400. The page offers none of them; campaigns and members can be read.
 */
describe('campaigns, read only', () => {
  it('offers no campaign create, status or member control, even with outreach.campaign.write', async () => {
    renderPage()
    const list = await campaignsList()
    expect(card(list, 'Demo screening week')).toBeTruthy()
    expect(within(card(list, 'Demo follow-up')).getByText('planned')).toBeTruthy()
    for (const name of [/create campaign/i, /activate/i, /close campaign/i, /add member/i, /new campaign/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Every campaign's members are read as it is listed, and nothing else is reached for.
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledTimes(4))
    for (const id of ['campaign-1', 'campaign-2', 'campaign-3', 'campaign-4']) expect(api.outreachCampaignMembers).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, id)
  })

  it('opens a campaign as a read-only record with its members', async () => {
    renderPage()
    await press(card(await campaignsList(), 'Demo screening week'))
    expect(heading().textContent).toBe('Demo screening week')
    expect(document.activeElement).toBe(heading())
    expect(screen.getByRole('heading', { name: 'Saved record' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Available actions' })).toBeTruthy()
    expect(screen.getByText('No further actions for your permission and this record state.')).toBeTruthy()
    const members = screen.getByRole('heading', { name: 'Members' }).closest('section') as HTMLElement
    expect(await within(members).findByText('Membership membersh')).toBeTruthy()
    expect(within(members).getByText('Health worker')).toBeTruthy()
    expect(screen.getAllByRole('button')).toEqual([screen.getByRole('button', { name: 'Back to list' })])
    // Back to the list, focus returns to the campaign opened.
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(document.activeElement).toBe(card(await campaignsList(), 'Demo screening week'))
  })

  it('says when a campaign has no members, and when its members cannot be read, with a retry', async () => {
    api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) => {
      if (campaignId === 'campaign-2') throw new HidApiError(403, 'Members of this campaign cannot be read here.', { code: 'FORBIDDEN' })
      return []
    })
    renderPage()
    await press(card(await campaignsList(), 'Demo screening week'))
    expect(await screen.findByText('No members yet')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    await press(card(await campaignsList(), 'Demo follow-up'))
    expect((await screen.findByRole('alert')).textContent).toContain('Members of this campaign cannot be read here.')
    const reads = api.outreachCampaignMembers.mock.calls.filter(call => call[1] === 'campaign-2').length
    await press(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.outreachCampaignMembers.mock.calls.filter(call => call[1] === 'campaign-2')).toHaveLength(reads + 1))
  })
})

/** The New registration form. */
async function openNew() {
  await press(await screen.findByRole('button', { name: 'New registration' }))
  return screen.getByRole('button', { name: 'Save registration' }).closest('form') as HTMLFormElement
}

function fill(form: HTMLElement, values: { fullName?: string; sex?: string; age?: string; phone?: string; notes?: string; campaign?: string }) {
  const set = (label: RegExp, value: string | undefined) => { if (value !== undefined) fireEvent.change(within(form).getByLabelText(label), { target: { value } }) }
  set(/^Campaign/, values.campaign); set(/^Full name/, values.fullName); set(/^Sex/, values.sex); set(/^Age/, values.age); set(/^Phone/, values.phone)
  set(/^Notes for the team/, values.notes)
  return within(form).getByRole('button', { name: /^(Save registration|Saving…)$/ })
}

/** The form's header Back to list (Cancel at its foot does the same). */
const formBack = () => screen.getByRole('button', { name: 'Back to list' })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const commands = () => api.createOutreachCase.mock.calls.map(call => call[2] as { localCommandId: string; temporaryPatientId: string })
const createdCase = { ...pendingCase, id: 'c0a5e000-0000-4000-8000-0000000000aa', fullName: 'Patient One', campaignId: undefined, rowVersion: 1 }

describe('creating a registration case', () => {
  it('opens the form in three steps, its heading focused, with the required fields marked and required', async () => {
    renderPage()
    const form = await openNew()
    expect(heading().textContent).toBe('New registration')
    expect(document.activeElement).toBe(heading())
    expect(form.noValidate).toBe(true)
    expect(within(form).getAllByRole('heading', { level: 3 }).map(step => step.textContent))
      .toEqual(['Who they are', 'How to reach them', 'Campaign and notes'])
    const marked = Array.from(form.querySelectorAll('label')).filter(label => label.querySelector('[aria-hidden="true"]')?.textContent === ' *')
    expect(marked.map(label => label.textContent)).toEqual(['Full name *', 'Sex *', 'Age in years *'])
    for (const label of marked) expect((document.getElementById(label.htmlFor) as HTMLInputElement).required).toBe(true)
    expect((within(form).getByLabelText(/^Sex/) as HTMLSelectElement).value).toBe('unknown')
    expect(within(form).getByRole('button', { name: 'Save registration' }).getAttribute('type')).toBe('submit')
  })

  it('offers only active registration campaigns this membership belongs to', async () => {
    renderPage()
    await waitFor(() => expect(api.outreachCampaignMembers).toHaveBeenCalledTimes(4))
    const form = await openNew()
    const select = within(form).getByLabelText(/^Campaign/) as HTMLSelectElement
    await waitFor(() => expect(Array.from(select.options).map(option => option.textContent)).toEqual(['No campaign', 'Demo screening week']))
    expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Only active registration campaigns you belong to are listed.')
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
    // Said in the page's status region, mounted throughout, and shown as a banner.
    const status = document.getElementById('outreach-status')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe('Registration case created. It stays pending until it is linked to a verified Health ID patient.')
    expect(screen.getByText('Registration saved')).toBeTruthy()
    expect(screen.getByText('They have a temporary record. Link it to their Health ID when you find it.')).toBeTruthy()
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledTimes(2))
  })

  it('keeps one status region mounted through the views, and says a created case whatever its status', async () => {
    api.createOutreachCase.mockResolvedValue({ ...createdCase, status: 'identity_resolved' })
    renderPage()
    await casesList()
    const status = document.getElementById('outreach-status')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe('')
    await press(fill(await openNew(), { fullName: 'Patient One', age: '34' }))
    await waitFor(() => expect(heading().textContent).toBe('Patient One'))
    expect(document.getElementById('outreach-status')).toBe(status)
    expect(within(status).getByText('Registration case created. Its status is linked.')).toBeTruthy()
    expect(screen.getByText('Registration saved')).toBeTruthy()
    expect(screen.getByText('Its status is linked.')).toBeTruthy()
    // Sending the next case clears what the last one said.
    api.createOutreachCase.mockReturnValue(new Promise(() => {}))
    await press(screen.getAllByRole('button', { name: 'Back to list' })[0]!)
    expect(document.getElementById('outreach-status')).toBe(status)
    await press(fill(await openNew(), { fullName: 'Patient Two', age: '51' }))
    await waitFor(() => expect(status.textContent).toBe(''))
  })

  it('keeps the user on the form while the case is sent, so its answer is not lost', async () => {
    let answer: (value: unknown) => void = () => {}
    api.createOutreachCase.mockReturnValue(new Promise(resolve => { answer = resolve }))
    renderPage()
    await press(fill(await openNew(), { fullName: 'Patient One', age: '34' }))
    const back = formBack()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(back.getAttribute('aria-disabled')).toBe('true')
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: 'Saving…' }).getAttribute('aria-busy')).toBe('true')
    await press(back)
    await press(cancel)
    expect(heading().textContent).toBe('New registration')
    expect(document.activeElement).toBe(cancel)
    await act(async () => { answer(createdCase) })
    await waitFor(() => expect(heading().textContent).toBe('Patient One'))
    expect(document.getElementById('outreach-status')!.textContent).toContain('Registration case created.')
  })

  it('keeps the user on the form while a refused case is sent, and says the refusal there', async () => {
    let refuse: (reason: unknown) => void = () => {}
    api.createOutreachCase.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject }))
    renderPage()
    await press(fill(await openNew(), { fullName: 'Patient One', age: '34' }))
    await press(formBack())
    await act(async () => { refuse(new HidApiError(503, 'Outreach is unavailable.', { code: 'SERVICE_UNAVAILABLE' })) })
    expect((await screen.findByRole('alert')).textContent).toBe('Outreach is unavailable.')
    expect(heading().textContent).toBe('New registration')
    expect(formBack().getAttribute('aria-disabled')).toBeNull()
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
    // The next case, though its details match the last: from the case made, "Register another person".
    await press(screen.getByRole('button', { name: 'Register another person' }))
    form = screen.getByRole('button', { name: 'Save registration' }).closest('form') as HTMLFormElement
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
    ['Notes for the team', { notes: '  ab ' }, 'outreach-case-notes', 'Enter at least 3 characters, or leave this blank.'],
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

  // Refused from Save registration, focus moves to the field, whose description says why. Refused from Enter in that
  // field, focus cannot move, so the refusal is an alert there, new each time.
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

  it.each(['Back to list', 'Cancel'])('goes back to the list from %s without sending anything', async name => {
    renderPage()
    await openNew()
    await press(screen.getByRole('button', { name }))
    expect(heading().textContent).toBe('Outreach')
    expect(document.activeElement).toBe(heading())
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })
})

async function openCase(name = 'Patient One') {
  await press(card(await casesList(), name))
}

const linkOpener = () => screen.getByRole('button', { name: 'Link existing patient', expanded: false })
/** The case's details card. */
const registration = () => cardOf(screen.getByRole('heading', { name: 'Registration' }))

/** Fills the link form and sends it, then answers the confirm sheet (Link patient, or Cancel). */
async function link(patientId: string, reason: string, answer: 'Link patient' | 'Cancel' = 'Link patient') {
  const form = screen.getByRole('form', { name: 'Link existing patient' })
  fireEvent.change(within(form).getByLabelText(/^Patient ID/), { target: { value: patientId } })
  fireEvent.change(within(form).getByLabelText(/^How you know/), { target: { value: reason } })
  await press(within(form).getByRole('button', { name: 'Link existing patient' }))
  const sheet = await screen.findByRole('dialog', { name: 'Confirm the link' })
  await press(within(sheet).getByRole('button', { name: answer }))
  return form
}

describe('a registration case', () => {
  it('opens as the case view, its heading focused, with its next step', async () => {
    renderPage()
    await openCase()
    expect(heading().textContent).toBe('Patient One')
    expect(document.activeElement).toBe(heading())
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText(/· case c0a5e000$/)).toBeTruthy()
    expect(within(registration()).getAllByRole('term').map(term => term.textContent)).toEqual(['Full name', 'Age', 'Sex', 'Status', 'Temporary patient ID', 'Campaign', 'Created'])
    expect(within(registration()).getByText('34 years')).toBeTruthy()
    expect(within(registration()).getByText('Demo screening week')).toBeTruthy()
    expect(screen.getAllByText('Waiting to link').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Next step: link their Health ID' })).toBeTruthy()
    expect(linkOpener()).toBeTruthy()
  })

  it('opens the link form in place, and closes it again on Cancel', async () => {
    renderPage()
    await openCase()
    const opener = linkOpener()
    const controls = opener.getAttribute('aria-controls')
    await press(opener)
    const form = screen.getByRole('form', { name: 'Link existing patient' }) as HTMLFormElement
    expect(controls).toBe(form.id)
    expect(within(form).getByLabelText(/^Patient ID/)).toBeTruthy()
    expect(within(form).getByLabelText(/^How you know it’s the same person/)).toBeTruthy()
    expect(form.noValidate).toBe(true)
    await press(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Link existing patient' })).toBeNull()
    expect(linkOpener()).toBeTruthy()
  })

  it('asks to confirm the person before linking, and sends nothing when cancelled', async () => {
    renderPage()
    await openCase()
    await press(linkOpener())
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    fireEvent.change(screen.getByLabelText(/^How you know/), { target: { value: 'Same name and phone as the record' } })
    await press(screen.getByRole('button', { name: 'Link existing patient' }))
    const sheet = await screen.findByRole('dialog', { name: 'Confirm the link' })
    expect(within(sheet).getByText('Patient One')).toBeTruthy()
    expect(within(sheet).getByText('34 years · Female · case c0a5e000')).toBeTruthy()
    expect(within(sheet).getByText(PATIENT)).toBeTruthy()
    await press(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: 'Link existing patient' })).toBeTruthy()
  })

  it('sends the patient, the case and its version, and the reason, then reads the cases again and says so', async () => {
    api.outreachCases.mockResolvedValueOnce([pendingCase, resolvedCase]).mockResolvedValue([{ ...pendingCase, status: 'identity_resolved', rowVersion: 4 }, resolvedCase])
    api.linkExistingOutreachCase.mockResolvedValue({ ...pendingCase, status: 'identity_resolved', rowVersion: 4 })
    renderPage()
    await openCase()
    await press(linkOpener())
    await link(` ${PATIENT} `, ' Same name, age and phone as the Health ID record ')
    await waitFor(() => expect(api.linkExistingOutreachCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, pendingCase, PATIENT,
      'Same name, age and phone as the Health ID record'))
    const status = document.getElementById(`outreach-case-status-${CASE_ID}`)!
    expect(status.getAttribute('role')).toBe('status')
    await waitFor(() => expect(status.textContent).toBe('Patient linked. This registration case is now linked to the verified Health ID patient.'))
    expect(api.outreachCases).toHaveBeenCalledTimes(2)
    // Linked: the link is no longer offered, and focus, lost with the form, is on what was done.
    const done = await screen.findByRole('heading', { name: 'Patient linked' })
    expect(screen.queryByRole('button', { name: 'Link existing patient' })).toBeNull()
    expect(within(registration()).getByText('Linked')).toBeTruthy()
    expect(screen.queryByText('Waiting to link')).toBeNull()
    expect(document.activeElement).toBe(done)
  })

  it('sends nothing without a patient ID, or with a reason under 8 characters', async () => {
    renderPage()
    await openCase()
    await press(linkOpener())
    const form = screen.getByRole('form', { name: 'Link existing patient' })
    const submit = within(form).getByRole('button', { name: 'Link existing patient' })
    await press(submit)
    const patient = within(form).getByLabelText(/^Patient ID/)
    await waitFor(() => expect(document.activeElement).toBe(patient))
    expect(document.getElementById(patient.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Complete this field.')
    const reason = within(form).getByLabelText(/^How you know/)
    expect(reason.getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(patient, { target: { value: PATIENT } })
    fireEvent.change(reason, { target: { value: ' short  ' } })
    await press(submit)
    await waitFor(() => expect(document.activeElement).toBe(reason))
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter at least 8 characters.')
    expect(patient.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
  })

  it.each([
    ['a version conflict', new HidApiError(409, 'This registration case has changed. Refresh it and try again.', { code: 'VERSION_CONFLICT' }),
      'This registration case has changed. Refresh it and try again.'],
    ['a patient this membership may not open', new HidApiError(403, 'You do not have access to this patient.', { code: 'FORBIDDEN' }),
      'You do not have access to this patient.'],
    ['an unknown failure', 'offline', 'The patient could not be linked. Check your access to this patient, then refresh the case.'],
  ])('says %s, keeps the form, and reads the case again for the next attempt', async (_name, error, message) => {
    api.linkExistingOutreachCase.mockRejectedValue(error)
    renderPage()
    await openCase()
    await press(linkOpener())
    const form = await link(PATIENT, 'Same name and phone as the record')
    expect((await within(form).findByRole('alert')).textContent).toBe(message)
    expect(within(form).getByText('The case has been read again, so a retry uses its latest version. Check the details, then retry using the same button. No success is reported until saved.')).toBeTruthy()
    expect(screen.queryByText('Patient linked')).toBeNull()
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledTimes(2))
    // The form keeps what was entered.
    expect((within(form).getByLabelText(/^Patient ID/) as HTMLInputElement).value).toBe(PATIENT)
  })

  it('retries a link refused for a stale version with the version read since', async () => {
    api.outreachCases.mockResolvedValueOnce([pendingCase, resolvedCase]).mockResolvedValue([{ ...pendingCase, rowVersion: 4 }, resolvedCase])
    api.linkExistingOutreachCase.mockRejectedValueOnce(new HidApiError(409, 'This registration case has changed. Refresh it and try again.', { code: 'VERSION_CONFLICT' }))
    api.linkExistingOutreachCase.mockResolvedValueOnce({ ...pendingCase, status: 'identity_resolved', rowVersion: 5 })
    renderPage()
    await openCase()
    await press(linkOpener())
    const form = await link(PATIENT, 'Same name and phone as the record')
    await within(form).findByRole('alert')
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledTimes(2))
    const submit = within(form).getByRole('button', { name: 'Link existing patient' })
    await waitFor(() => expect(submit.getAttribute('aria-busy')).toBeNull())
    await press(submit)
    await press(within(await screen.findByRole('dialog', { name: 'Confirm the link' })).getByRole('button', { name: 'Link patient' }))
    await waitFor(() => expect(api.linkExistingOutreachCase).toHaveBeenCalledTimes(2))
    expect((api.linkExistingOutreachCase.mock.calls[0]![1] as { rowVersion: number }).rowVersion).toBe(3)
    expect((api.linkExistingOutreachCase.mock.calls[1]![1] as { rowVersion: number }).rowVersion).toBe(4)
  })

  it('still says a refusal once the case, read again, no longer offers the link', async () => {
    api.outreachCases.mockResolvedValueOnce([pendingCase, resolvedCase]).mockResolvedValue([{ ...pendingCase, status: 'identity_resolved', rowVersion: 4 }, resolvedCase])
    api.linkExistingOutreachCase.mockRejectedValue(new HidApiError(409, 'This registration case has already been resolved.', { code: 'VERSION_CONFLICT' }))
    renderPage()
    await openCase()
    await press(linkOpener())
    await link(PATIENT, 'Same name and phone as the record')
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Link existing patient' })).toBeNull())
    expect(screen.getByRole('alert').textContent).toBe('This registration case has already been resolved.')
    expect(screen.getByRole('heading', { name: 'Nothing more to do' })).toBeTruthy()
    expect(screen.queryByText('Patient linked')).toBeNull()
  })

  it('keeps the user on the case while a link is sent', async () => {
    let answer: (value: unknown) => void = () => {}
    api.linkExistingOutreachCase.mockReturnValue(new Promise(resolve => { answer = resolve }))
    renderPage()
    await openCase()
    await press(linkOpener())
    await link(PATIENT, 'Same name and phone as the record')
    const back = screen.getByRole('button', { name: 'Back to list' })
    expect(back.getAttribute('aria-disabled')).toBe('true')
    await press(back)
    expect(heading().textContent).toBe('Patient One')
    await act(async () => { answer({ ...pendingCase, status: 'identity_resolved', rowVersion: 4 }) })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Patient linked' })).toBeTruthy())
    expect(back.getAttribute('aria-disabled')).toBeNull()
  })

  it('offers no link without registration write permission, and says who may', async () => {
    session.permissions = READ
    renderPage()
    await openCase()
    expect(screen.queryByRole('button', { name: 'Link existing patient' })).toBeNull()
    expect(screen.getByText('Waiting to be linked')).toBeTruthy()
    expect(screen.getByText('This is a temporary registration. Someone who may write registrations needs to link it to the person’s Health ID.')).toBeTruthy()
  })

  it('offers no link for a case already resolved', async () => {
    renderPage()
    await casesList()
    await showTab('Linked')
    await openCase('Patient Two')
    expect(screen.queryByRole('button', { name: 'Link existing patient' })).toBeNull()
    expect(screen.queryByText('Waiting to link')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Nothing more to do' })).toBeTruthy()
    expect(screen.getByText('This registration is linked. No further step is needed here.')).toBeTruthy()
  })

  it('says a record the list no longer holds is not found', async () => {
    api.outreachCases.mockResolvedValueOnce([pendingCase, resolvedCase]).mockResolvedValue([resolvedCase])
    api.linkExistingOutreachCase.mockResolvedValue({ ...pendingCase, status: 'identity_resolved', rowVersion: 4 })
    renderPage()
    await openCase()
    await press(linkOpener())
    await link(PATIENT, 'Same name and phone as the record')
    // Read again, the list no longer holds the case: it is not shown from memory.
    await waitFor(() => expect(heading().textContent).toBe('Record not found'))
    expect(screen.getByText('The record is missing or outside your authorized hospital / branch.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    await showTab('All')
    expect(queryCard(await casesList(), 'Patient One')).toBeNull()
  })

  it('goes back to the list with focus on the case it came from', async () => {
    renderPage()
    await openCase()
    await press(screen.getByRole('button', { name: 'Back to list' }))
    expect(document.activeElement).toBe(card(await casesList(), 'Patient One'))
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

/*
 * Outreach sends the phone number and the notes for the team on every case (hid-system outreach.types.ts
 * registrationCase(), live in production): the case's own view shows them, the phone in full so the team can call back
 * (owner, 2026-11-02); the list card and the search never carry it. A backend without them sends neither key, and the
 * case shows what it does today (the term list above).
 */
describe('a case\'s phone number and notes', () => {
  const PHONE = '+2348031234567'
  const withContact = { ...pendingCase, phone: PHONE, operationalNotes: 'Met at the market stall.\nNeeds a follow-up visit.' }

  it('shows the phone and the notes in full on the case', async () => {
    api.outreachCases.mockResolvedValue([withContact, resolvedCase])
    renderPage()
    await openCase()
    expect(within(registration()).getAllByRole('term').map(term => term.textContent)).toEqual(
      ['Full name', 'Age', 'Sex', 'Phone number', 'Status', 'Temporary patient ID', 'Campaign', 'Created', 'Notes for the team'])
    expect(within(registration()).getByText(PHONE)).toBeTruthy()
    expect(within(registration()).queryByText(/••••/)).toBeNull()
    const notes = within(registration()).getByText(/^Met at the market stall\./)
    expect(notes.textContent).toBe('Met at the market stall.\nNeeds a follow-up visit.')
  })

  it('says when no phone number or notes were given', async () => {
    api.outreachCases.mockResolvedValue([{ ...pendingCase, phone: null, operationalNotes: null }, resolvedCase])
    renderPage()
    await openCase()
    const terms = within(registration()).getAllByRole('term')
    const valueOf = (label: string) => terms.find(term => term.textContent === label)!.nextElementSibling!.textContent
    expect(valueOf('Phone number')).toBe('Not recorded')
    expect(valueOf('Notes for the team')).toBe('None')
  })

  it('shows a phone number Outreach already masked as it was sent', async () => {
    api.outreachCases.mockResolvedValue([{ ...pendingCase, phone: '+234 ••• ••• 4567' }, resolvedCase])
    renderPage()
    await openCase()
    expect(within(registration()).getByText('+234 ••• ••• 4567')).toBeTruthy()
  })

  it('never finds a case by its phone number, and the list card never carries it', async () => {
    api.outreachCases.mockResolvedValue([withContact, resolvedCase])
    renderPage()
    await casesList()
    await showTab('All')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Outreach' }), { target: { value: '8031234567' } })
    expect(screen.getByText('No matching registrations')).toBeTruthy()
    // Nor does the card in the list carry it.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Outreach' }), { target: { value: '' } })
    expect(card(await casesList(), 'Patient One').textContent).not.toContain('4567')
    expect(document.body.textContent).not.toContain('8031234567')
  })
})
