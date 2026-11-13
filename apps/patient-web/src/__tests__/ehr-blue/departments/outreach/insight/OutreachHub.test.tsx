import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../../harness'
import { Outreach } from '../../../../../ehr-blue/departments/outreach/Outreach'
import { lastOpenedCampaign, memoryQueueStore, rememberOpenedCampaign, saveDaySettings, setOutreachQueueStore } from '../../../../../ehr-blue/departments/outreach/offlineQueue'

/*
 * The Outreach hub where Outreach serves its campaign routes (owner decisions of 13 November 2026): campaigns as cards,
 * "New campaign" opening the plan wizard, and inside a campaign its tabs as the member's roles allow. The plan and day
 * screens (Builders A and B) stand in as stubs that say their props. Every person and campaign here is fictional.
 */

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../../harness')
  return { useStaff: () => staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Group', roles: ['outreach_officer'] })) }
})
const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCampaignGovernance: vi.fn(),
  outreachCampaignStaff: vi.fn(), setOutreachCampaignStatus: vi.fn(),
}))
type Spec = { method: string; path: string }
const request = vi.hoisted(() => vi.fn())
vi.mock('../../../../../staff/api', () => ({ outreachCampaignRequest: request, staffApi: api }))

vi.mock('../../../../../ehr-blue/departments/outreach/plan', () => ({
  CampaignPlanWizard: ({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) => <div>
    <h1>Plan wizard</h1><button type="button" onClick={() => onDone('camp-new')}>Finish wizard</button>
    <button type="button" onClick={onCancel}>Cancel wizard</button></div>,
  CampaignTeam: ({ campaignId }: { campaignId: string }) => <p>Team of {campaignId}</p>,
  CampaignSetup: ({ campaignId }: { campaignId: string }) => <p>Setup of {campaignId}</p>,
}))
vi.mock('../../../../../ehr-blue/departments/outreach/day', () => ({
  DayStart: ({ campaignId }: { campaignId: string }) => <p>Day start for {campaignId}</p>,
  RegisterPerson: ({ campaignId }: { campaignId: string }) => <p>Register for {campaignId}</p>,
  StationWork: ({ station }: { station: string }) => <p>Station {station}</p>,
  AllInOne: ({ campaignId }: { campaignId: string }) => <p>All in one for {campaignId}</p>,
  VisitView: ({ caseId, onBack }: { caseId: string; onBack: () => void }) => <div><h1>Visit {caseId}</h1>
    <button type="button" onClick={onBack}>Back from visit</button></div>,
}))

const BASE = '/api/v1/outreach/registration-cases/campaigns'
const SCREENING = { id: 'camp-1', name: 'Demo Screening', status: 'active', services: ['registration'], startsAt: '2026-11-12T08:00:00.000Z',
  endsAt: '2099-11-14T18:00:00.000Z', rowVersion: 2 }
const OLD = { id: 'camp-old', name: 'Demo Old Drive', status: 'planned', services: ['registration'], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 }
const PLAN = { campaignId: 'camp-1', organisationName: 'Demo Volunteers', target: 100, focuses: ['hepatitis_b', 'hypertension'],
  sites: [{ id: 'site-1', name: 'Demo Hall', community: 'Demo', lga: 'Demo', address: '1 Demo Road' }, { id: 'site-2', name: 'Demo Church', community: 'Demo', lga: 'Demo', address: '2 Demo Road' }],
  package: { vitals: [], tests: [], questions: [] }, stationMode: 'split', stations: ['register', 'vitals', 'tests'], partners: [],
  consent: { text: 'Demo', version: '1' }, kits: [], rowVersion: 1 }
const DASHBOARD = { asOf: '2026-11-13T10:00:00.000Z', target: 100, registered: 2, screened: 1, waiting: { vitals: 1 },
  outcomes: { normal: 0, followUp: 0, referUrgent: 1, referRoutine: 0, pending: 1 },
  byFocus: [{ focus: 'hepatitis_b', screened: 1, positive: 1, referred: 1 }, { focus: 'hypertension', screened: 1, positive: 4, referred: 0 }],
  byMember: [], bySite: [], byHour: [], kits: [], alerts: [] }
const VISIT = { id: 'ov-1', campaignId: 'camp-1', status: 'identity_resolution_pending', fullName: 'Demo Ada', ageYears: 30, sex: 'female',
  temporaryPatientId: 'tmp_1', createdAt: '2026-11-13T09:00:00.000Z', rowVersion: 1, visitCode: 'K7-4F2', stationsDone: ['register'] }
const OUTSIDE = { id: 'oc-9', status: 'identity_resolution_pending', fullName: 'Demo Outside', ageYears: 50, sex: 'male', temporaryPatientId: 'tmp_9',
  createdAt: '2026-11-10T09:00:00.000Z', rowVersion: 1 }

let roles: string[]
beforeEach(() => {
  vi.clearAllMocks()
  setOutreachQueueStore(memoryQueueStore())
  session.permissions = ['outreach.campaign.read', 'outreach.campaign.write', 'outreach.registration.read', 'outreach.registration.write']
  roles = ['coordinator', 'clinician']
  api.outreachCampaigns.mockResolvedValue([SCREENING, OLD])
  api.outreachCases.mockResolvedValue([VISIT, OUTSIDE])
  api.outreachCampaignMembers.mockResolvedValue([])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins' })
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'admin', people: [] })
  request.mockImplementation(async (_facility: string, spec: Spec) => {
    if (spec.path.startsWith(`${BASE}/camp-old/`)) throw new HidApiError(404, 'Not Found', { code: 'NOT_FOUND' })
    if (spec.path === `${BASE}/camp-1/plan`) return PLAN
    if (spec.path === `${BASE}/camp-1/team`) return { members: [], you: { memberId: 'tm-1', roles, siteId: null, station: null } }
    if (spec.path === `${BASE}/camp-1/dashboard`) return DASHBOARD
    throw new HidApiError(404, 'Not Found', { code: 'NOT_FOUND' })
  })
})
afterEach(() => setOutreachQueueStore(null))

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const campaignsList = () => screen.findByRole('list', { name: 'Campaigns' })
const runningList = () => screen.findByRole('list', { name: 'Running now' })
const campaignCard = async (name: string) => within(await campaignsList()).getByRole('button', { name: new RegExp(`^${name}`) })
const runningCard = async (name: string) => within(await runningList()).getByRole('button', { name: new RegExp(`^${name}`) })
/**
 * Demo Screening is running and this person is on its team. A coordinator starts on the organisation's home and carries
 * on with it from there (Continue, the one main action); someone who only works in the field goes straight in (no
 * reselecting).
 */
async function openScreening() {
  if (roles.includes('coordinator')) await press(await screen.findByRole('button', { name: 'Continue Demo Screening' }))
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo Screening'))
  await waitFor(() => expect(screen.queryAllByRole('tab').length).toBeGreaterThan(0))
}
/** The organisation's Overview, with the running campaign's card read. */
async function toOverview() {
  await waitFor(async () => expect((await runningCard('Demo Screening')).textContent).toContain('2 sites'))
}
/** Campaigns (every campaign), from the Overview's All campaigns, with every campaign's card read. */
async function toCampaigns() {
  await press(await screen.findByRole('button', { name: /^All campaigns \(/ }))
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Campaigns')
  await waitFor(async () => expect((await campaignCard('Demo Screening')).textContent).toContain('2 sites'))
}
const fieldOnly = () => { session.permissions = session.permissions.filter(permission => permission !== 'outreach.campaign.write') }
/** One of the campaign's sections (its Overview has tabs of its own: Stations, Focus, Team, Sites). */
const campaignTab = (name: string) => within(screen.getByRole('tablist', { name: 'Campaign' })).getByRole('tab', { name })
const tabNames = () => within(screen.getByRole('tablist', { name: 'Campaign' })).getAllByRole('tab').map(tab => tab.textContent)

describe('the Outreach page', () => {
  it('shows each campaign as a card with its dates, focuses and counts, and Continue as the one main action', async () => {
    renderDept(<Outreach />)
    await toCampaigns()
    await waitFor(async () => expect((await campaignCard('Demo Screening')).textContent).toContain('2 sites · 2 registered · 5 positive · 1 referral'))
    const card = await campaignCard('Demo Screening')
    expect(card.textContent).toContain('Hepatitis B, High blood pressure')
    expect(within(card).getByText('Running')).toBeTruthy()
    expect(within(card).getByText('1 urgent')).toBeTruthy()
    // A campaign on today's Outreach keeps today's card.
    expect((await campaignCard('Demo Old Drive')).textContent).toContain('Not started')
    await press(screen.getByRole('button', { name: 'Back to Overview' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview')
    expect(document.activeElement?.id).toBe('outreach-all-campaigns')
    // No registrations on the home: those made before campaigns are in the menu; those in a campaign are in its People.
    expect(screen.queryByRole('list', { name: 'Registrations' })).toBeNull()
    await press(screen.getByRole('button', { name: 'More' }))
    await press(screen.getByRole('button', { name: 'Registered before campaigns' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Registered before campaigns')
    const cases = await screen.findByRole('list', { name: 'Registrations' })
    await press(screen.getByRole('button', { name: /^All/, pressed: false }))
    expect(within(cases).getByRole('button', { name: /^Demo Outside/ })).toBeTruthy()
    expect(within(cases).queryByRole('button', { name: /^Demo Ada/ })).toBeNull()
    await press(screen.getByRole('button', { name: 'Back to Overview' }))
    expect(document.activeElement?.id).toBe('outreach-home-more')
    // The campaign running for this person is the one main action; New campaign is secondary; no Refresh, and no
    // registration outside a campaign (it is made in the campaign's Today).
    expect(screen.getByRole('button', { name: 'Continue Demo Screening' }).className).toContain('bg-primary-gradient')
    expect(screen.getByRole('button', { name: 'New campaign' }).className).not.toContain('bg-primary-gradient')
    expect(screen.queryByRole('button', { name: 'New registration' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('makes New campaign the one main action when nothing runs for this person', async () => {
    api.outreachCampaigns.mockResolvedValue([{ ...SCREENING, status: 'planned' }, OLD])
    renderDept(<Outreach />)
    await screen.findByText('No campaign is running now.')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview')
    expect(screen.getByRole('button', { name: 'New campaign' }).className).toContain('bg-primary-gradient')
    expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull()
  })

  it('opens the campaign the person was last in directly, from the day settings on this device', async () => {
    // Not running (so not opened for that), but remembered: it opens straight away, on the tab last used this visit.
    fieldOnly()
    roles = ['registrar']
    api.outreachCampaigns.mockResolvedValue([{ ...SCREENING, status: 'planned' }, OLD])
    await rememberOpenedCampaign(memoryQueueStoreRef(), { accountId: 'staff-demo-1', facilityId: DEMO_HOSPITAL_ID }, 'camp-1')
    renderDept(<Outreach />)
    await openScreening()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    expect(campaignTab('Today').getAttribute('aria-selected')).toBe('true')
  })

  it('remembers the campaign opened, and each campaign’s last tab for the visit', async () => {
    const kept = memoryQueueStoreRef()
    renderDept(<Outreach />)
    await openScreening()
    await waitFor(async () => expect(await lastOpenedCampaign(kept, { accountId: 'staff-demo-1', facilityId: DEMO_HOSPITAL_ID })).toBe('camp-1'))
    await press(campaignTab('Team'))
    // Back goes to Campaigns, focus on the campaign's card.
    await press(screen.getByRole('button', { name: 'All campaigns' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Campaigns')
    await waitFor(async () => expect(document.activeElement).toBe(await campaignCard('Demo Screening')))
    await press(await campaignCard('Demo Screening'))
    expect(campaignTab('Team').getAttribute('aria-selected')).toBe('true')
  })

  it('opens the plan wizard for New campaign, and the campaign it made', async () => {
    renderDept(<Outreach />)
    await toOverview()
    await press(screen.getByRole('button', { name: 'New campaign' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Plan wizard')
    await press(screen.getByRole('button', { name: 'Cancel wizard' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New campaign' }))
    // Made: it lands inside the campaign, not back on the list.
    await press(screen.getByRole('button', { name: 'New campaign' }))
    await press(screen.getByRole('button', { name: 'Finish wizard' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('Outreach')
    expect(screen.queryByRole('list', { name: 'Campaigns' })).toBeNull()
  })
})

describe('the organisation’s home', () => {
  it('shows the numbers first, then the types of outreach and conditions found, then the actions, then the campaigns', async () => {
    renderDept(<Outreach />)
    await toOverview()
    // Not served yet (404): worked out from each campaign's own dashboard.
    const numbers = await screen.findByRole('group', { name: 'Your outreach in numbers' })
    expect(numbers.textContent).toContain('Outreaches run21 running')
    expect(numbers.textContent).toContain('People reached1')
    expect(numbers.textContent).toContain('Positive5')
    expect(numbers.textContent).toContain('Referred1')
    const types = screen.getByRole('heading', { name: 'By type of outreach' }).closest('section')!
    expect(within(types).getByRole('rowheader', { name: 'Hepatitis B' })).toBeTruthy()
    expect(within(types).getByRole('rowheader', { name: 'High blood pressure' })).toBeTruthy()
    const conditions = screen.getByRole('list', { name: /^Conditions found/ })
    expect(conditions.textContent).toContain('High blood pressure4 of 1 positive')
    // The hierarchy: numbers, then the actions, then the campaigns running now. People reached leads the tiles.
    expect(within(numbers).getAllByText(/^(People reached|Outreaches run|Screened|Positive|Referred)$/).map(label => label.textContent))
      .toEqual(['People reached', 'Outreaches run', 'Screened', 'Positive', 'Referred'])
    const order = [numbers, screen.getByRole('button', { name: 'Continue Demo Screening' }), await runningList()]
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // One search: the top bar's, not the page's.
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('reads the organisation’s summary where it is served, with a type of outreach of its own', async () => {
    const base = request.getMockImplementation()!
    request.mockImplementation(async (facility: string, spec: Spec) => {
      if (spec.path === '/api/v1/outreach/registration-cases/organisation/summary') {
        return { campaigns: { total: 9, running: 2, planned: 3, closed: 4 }, people: { reached: 1250, thisMonth: 40 }, screened: 1100, positive: 120, referred: 60,
          byFocus: [{ focus: 'malaria', label: 'Malaria', campaigns: 3, screened: 600, positive: 90, referred: 30 },
            { focus: 'custom:sickle-cell', label: 'Sickle cell', campaigns: 1, screened: 64, positive: 5, referred: 5 }],
          conditions: [{ condition: 'custom:sickle-cell', label: 'Sickle cell', screened: 64, positive: 5 }] }
      }
      return base(facility, spec)
    })
    renderDept(<Outreach />)
    const numbers = await screen.findByRole('group', { name: 'Your outreach in numbers' })
    await waitFor(() => expect(numbers.textContent).toContain('Outreaches run92 running'))
    expect(numbers.textContent).toContain('People reached1,250+40 this month')
    expect(numbers.textContent).toContain('11% of screened')
    expect(screen.getByRole('rowheader', { name: 'Sickle cell' })).toBeTruthy()
    expect(screen.getByRole('list', { name: /^Conditions found/ }).textContent).toContain('Sickle cell5 of 64 positive (8%)')
  })

  it('shows at most three campaigns running now, and every one in Campaigns, running first', async () => {
    const many = Array.from({ length: 4 }, (_, index) => ({ ...OLD, id: `camp-x${index}`, name: `Demo Drive ${index + 1}` }))
    const running = Array.from({ length: 3 }, (_, index) => ({ ...SCREENING, id: `camp-r${index}`, name: `Demo Running ${index + 1}` }))
    api.outreachCampaigns.mockResolvedValue([...many, ...running, SCREENING])
    renderDept(<Outreach />)
    await waitFor(async () => expect(within(await runningList()).getAllByRole('button')).toHaveLength(3))
    for (const card of within(await runningList()).getAllByRole('button')) expect(card.textContent).toContain('Running')
    expect(screen.queryByRole('list', { name: 'Campaigns' })).toBeNull()
    await press(screen.getByRole('button', { name: 'All campaigns (8)' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Campaigns')
    expect(within(await campaignsList()).getAllByRole('button')).toHaveLength(8)
    expect(within(await campaignsList()).getAllByRole('button')[0]!.textContent).toContain('Running')
  })

  it('lets the top bar’s Search find people and campaigns, opening what is chosen', async () => {
    const { useOutreachSearch } = await import('../../../../../ehr-blue/departments/outreach/outreachNav')
    let source: ReturnType<typeof useOutreachSearch> = null
    function Probe() { source = useOutreachSearch(DEMO_HOSPITAL_ID); return null }
    renderDept(<><Outreach /><Probe /></>)
    await toOverview()
    // Not before the campaign is open: Demo Ada is in its People. Outside any campaign, Demo Outside is found.
    await waitFor(() => expect(source?.search('demo outside').map(hit => hit.title)).toEqual(['Demo Outside']))
    expect(source!.search('screening').map(hit => [hit.kind, hit.title])).toEqual([['campaign', 'Demo Screening']])
    await act(async () => { source!.search('screening')[0]!.open() })
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo Screening'))
    // In the campaign open: by name, by visit code (with or without the dash).
    await waitFor(() => expect(source!.search('k74f2').map(hit => hit.title)).toEqual(['Demo Ada']))
    await act(async () => { source!.search('Ada')[0]!.open() })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Visit ov-1')
  })
})

describe('following the menu', () => {
  it('goes to Campaigns and back to Overview once, without the address and the page chasing each other', async () => {
    const { Link, useLocation } = await import('react-router-dom')
    const seen: string[] = []
    function Menu() {
      const location = useLocation()
      if (seen.at(-1) !== location.pathname) seen.push(location.pathname)
      return <><Link to="/provider/outreach/campaigns">Go to campaigns</Link><Link to="/provider/outreach">Go to overview</Link></>
    }
    renderDept(<><Outreach /><Menu /></>, { route: '/provider/outreach' })
    await toOverview()
    seen.length = 0
    await press(screen.getByRole('link', { name: 'Go to campaigns' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Campaigns'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Campaigns')
    expect(seen).toEqual(['/provider/outreach/campaigns'])
    await press(screen.getByRole('link', { name: 'Go to overview' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview')
    expect(seen).toEqual(['/provider/outreach/campaigns', '/provider/outreach'])
  })
})

describe('inside a campaign', () => {
  it('gives a coordinator every section, its Overview first and shown, and its header in words', async () => {
    renderDept(<Outreach />)
    await openScreening()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo Screening')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    expect(document.body.textContent).toContain('Hepatitis B, High blood pressure')
    expect(tabNames()).toEqual(['Overview', 'Today', 'People', 'Follow-ups', 'Team', 'Setup'])
    expect(campaignTab('Overview').getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('group', { name: 'Today’s counts' })).toBeTruthy()
    // Status and dates on one line under the name; More (⋯) on the name's row.
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.parentElement!.contains(screen.getByRole('button', { name: 'More' }))).toBe(true)
    expect(title.parentElement!.contains(screen.getByRole('button', { name: 'All campaigns' }))).toBe(true)
    await press(campaignTab('Today'))
    expect(await screen.findByText('Day start for camp-1')).toBeTruthy()
    await press(campaignTab('Team'))
    expect(screen.getByText('Team of camp-1')).toBeTruthy()
    // Arrow keys move along the tabs.
    await act(async () => { fireEvent.keyDown(campaignTab('Team'), { key: 'ArrowRight' }) })
    expect(screen.getByText('Setup of camp-1')).toBeTruthy()
    expect(document.activeElement).toBe(campaignTab('Setup'))
  })

  it.each([
    [['registrar', 'vitals'], ['Today', 'People']],
    [['counsellor'], ['Today', 'People', 'Follow-ups']],
    [['data_checker'], ['Overview', 'People']],
  ])('shows %j only their tabs', async (given, tabs) => {
    roles = given
    renderDept(<Outreach />)
    await openScreening()
    expect(tabNames()).toEqual(tabs)
    // The report is in More, for a data checker only.
    const more = screen.queryByRole('button', { name: 'More' })
    if (more) await press(more)
    expect(screen.queryByRole('button', { name: 'Report' }) !== null).toBe(given.includes('data_checker'))
  })

  it('goes straight to the station saved for the day', async () => {
    await saveDaySettings(memoryQueueStoreRef(), { accountId: 'staff-demo-1', facilityId: DEMO_HOSPITAL_ID }, 'camp-1', { siteId: 'site-2', station: 'vitals' })
    renderDept(<Outreach />)
    await openScreening()
    await press(campaignTab('Today'))
    expect(await screen.findByText('Station vitals')).toBeTruthy()
    expect(document.body.textContent).toContain('Demo Church· Vital signs')
    await press(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByText('Day start for camp-1')).toBeTruthy()
  })

  it('lists its people and opens a visit, coming back to the card opened', async () => {
    renderDept(<Outreach />)
    await openScreening()
    await press(campaignTab('People'))
    const card = within(screen.getByRole('list', { name: 'People in this campaign' })).getByRole('button', { name: /^Demo Ada/ })
    expect(card.textContent).toContain('K7-4F2')
    await press(card)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Visit ov-1')
    await press(screen.getByRole('button', { name: 'Back from visit' }))
    expect(campaignTab('People').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement?.id).toBe('outreach-visit-ov-1-open')
  })

  it('opens the report from More and comes back', async () => {
    renderDept(<Outreach />)
    await openScreening()
    // Report and Campaign record fold into one More (⋯), not a row of buttons.
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull()
    await press(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('button', { name: 'Campaign record' })).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Report' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Campaign report')
    await press(screen.getByRole('button', { name: 'Back to the campaign' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }))
  })

  it('puts the role’s main action at the bottom away from Today, and none for a coordinator', async () => {
    roles = ['registrar']
    renderDept(<Outreach />)
    await openScreening()
    expect(screen.queryByRole('button', { name: 'Register a person' })).toBeNull()
    await press(campaignTab('People'))
    const main = screen.getByRole('button', { name: 'Register a person' })
    expect(main.className).toContain('h-14')
    expect(main.closest('[data-form-actions]')).not.toBeNull()
    await press(main)
    expect(campaignTab('Today').getAttribute('aria-selected')).toBe('true')
  })

  it('gives a coordinator no main action on the Overview', async () => {
    renderDept(<Outreach />)
    await openScreening()
    await press(campaignTab('Today'))
    await press(campaignTab('Overview'))
    expect(screen.queryByRole('button', { name: 'Register a person' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next person' })).toBeNull()
  })

  it('never says Dashboard: the organisation’s numbers and a campaign’s are each its Overview', async () => {
    renderDept(<Outreach />)
    await toOverview()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview')
    expect(document.body.textContent).not.toMatch(/Dashboard/i)
    await openScreening()
    await screen.findByRole('group', { name: 'Today’s counts' })
    expect(campaignTab('Overview').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tablist', { name: 'Overview detail' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Dashboard/i)
  })

  it('keeps the sections to one row on a phone: the first three, the rest under More', async () => {
    // A phone's page, 358px wide.
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.callback([{ contentRect: { width: 358 } }]) }
      disconnect() { /* nothing to stop */ }
    })
    try {
      renderDept(<Outreach />)
      await openScreening()
      await waitFor(() => expect(tabNames()).toEqual(['Overview', 'Today', 'People']))
      const more = screen.getByRole('button', { name: 'More sections' })
      await press(more)
      expect(['Follow-ups', 'Team', 'Setup'].map(name => screen.getByRole('button', { name }).textContent)).toEqual(['Follow-ups', 'Team', 'Setup'])
      await press(screen.getByRole('button', { name: 'Setup' }))
      expect(await screen.findByText('Setup of camp-1')).toBeTruthy()
      // The More button says which section it shows, and keeps focus; no tab in the row is selected then.
      const shown = screen.getByRole('button', { name: 'Setup, more sections' })
      expect(document.activeElement).toBe(shown)
      expect(screen.getByRole('tabpanel', { name: 'Setup' })).toBeTruthy()
      expect(within(screen.getByRole('tablist', { name: 'Campaign' })).getAllByRole('tab').map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false'])
      await press(shown)
      expect(screen.getByRole('button', { name: 'Setup' }).getAttribute('aria-current')).toBe('true')
      // Arrow keys still move along the tabs in the row.
      await press(campaignTab('Overview'))
      await act(async () => { fireEvent.keyDown(campaignTab('Overview'), { key: 'ArrowRight' }) })
      expect(document.activeElement).toBe(campaignTab('Today'))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens a campaign on today’s Outreach as today’s record', async () => {
    renderDept(<Outreach />)
    await toCampaigns()
    await press(await campaignCard('Demo Old Drive'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo Old Drive')
    expect(screen.queryAllByRole('tab')).toEqual([])
    expect(screen.getByRole('heading', { name: 'Saved record' })).toBeTruthy()
  })
})

let store: ReturnType<typeof memoryQueueStore> | null = null
function memoryQueueStoreRef() {
  store = memoryQueueStore()
  setOutreachQueueStore(store)
  return store
}
