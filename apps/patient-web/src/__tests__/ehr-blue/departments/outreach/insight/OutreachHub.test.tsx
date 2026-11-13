import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../../harness'
import { Outreach } from '../../../../../ehr-blue/departments/outreach/Outreach'
import { memoryQueueStore, saveDaySettings, setOutreachQueueStore } from '../../../../../ehr-blue/departments/outreach/offlineQueue'

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
  endsAt: '2026-11-14T18:00:00.000Z', rowVersion: 2 }
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
const campaignCard = async (name: string) => within(await campaignsList()).getByRole('button', { name: new RegExp(`^${name}`) })
async function openScreening() {
  await waitFor(async () => expect((await campaignCard('Demo Screening')).textContent).toContain('2 sites'))
  await press(await campaignCard('Demo Screening'))
}
const tabNames = () => screen.getAllByRole('tab').map(tab => tab.textContent)

describe('the Outreach page', () => {
  it('shows each campaign as a card with its dates, focuses and counts, and New campaign as the one main action', async () => {
    renderDept(<Outreach />)
    await waitFor(async () => expect((await campaignCard('Demo Screening')).textContent).toContain('2 sites · 2 registered · 5 positive · 1 referral'))
    const card = await campaignCard('Demo Screening')
    expect(card.textContent).toContain('Hepatitis B, High blood pressure')
    expect(within(card).getByText('Running')).toBeTruthy()
    expect(within(card).getByText('1 urgent')).toBeTruthy()
    // A campaign on today's Outreach keeps today's card.
    expect((await campaignCard('Demo Old Drive')).textContent).toContain('Not started')
    // Registrations listed in a campaign's own People are not listed again here.
    const cases = await screen.findByRole('list', { name: 'Registrations' })
    await waitFor(() => expect(within(cases).queryByRole('button', { name: /^Demo Ada/ })).toBeNull())
    expect(screen.getByRole('button', { name: 'New campaign' }).className).toContain('bg-primary-gradient')
    expect(screen.getByRole('button', { name: 'New registration' }).className).not.toContain('bg-primary-gradient')
  })

  it('opens the plan wizard for New campaign, and the campaign it made', async () => {
    renderDept(<Outreach />)
    await waitFor(async () => expect((await campaignCard('Demo Screening')).textContent).toContain('2 sites'))
    await press(screen.getByRole('button', { name: 'New campaign' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Plan wizard')
    await press(screen.getByRole('button', { name: 'Cancel wizard' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New campaign' }))
  })
})

describe('inside a campaign', () => {
  it('gives a coordinator every tab, Today first, and its header in words', async () => {
    renderDept(<Outreach />)
    await openScreening()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo Screening')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    expect(document.body.textContent).toContain('Hepatitis B, High blood pressure')
    expect(tabNames()).toEqual(['Today', 'Dashboard', 'People', 'Follow-ups', 'Team', 'Setup'])
    expect(screen.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText('Day start for camp-1')).toBeTruthy()
    await press(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.getByText('Team of camp-1')).toBeTruthy()
    // Arrow keys move along the tabs.
    await act(async () => { fireEvent.keyDown(screen.getByRole('tab', { name: 'Team' }), { key: 'ArrowRight' }) })
    expect(screen.getByText('Setup of camp-1')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Setup' }))
  })

  it.each([
    [['registrar', 'vitals'], ['Today', 'People']],
    [['counsellor'], ['Today', 'People', 'Follow-ups']],
    [['data_checker'], ['Dashboard', 'People']],
  ])('shows %j only their tabs', async (given, tabs) => {
    roles = given
    renderDept(<Outreach />)
    await openScreening()
    expect(tabNames()).toEqual(tabs)
    expect(screen.queryByRole('button', { name: 'Report' }) !== null).toBe(given.includes('data_checker'))
  })

  it('goes straight to the station saved for the day', async () => {
    await saveDaySettings(memoryQueueStoreRef(), { accountId: 'staff-demo-1', facilityId: DEMO_HOSPITAL_ID }, 'camp-1', { siteId: 'site-2', station: 'vitals' })
    renderDept(<Outreach />)
    await openScreening()
    expect(await screen.findByText('Station vitals')).toBeTruthy()
    expect(document.body.textContent).toContain('Demo Church· Vital signs')
    await press(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByText('Day start for camp-1')).toBeTruthy()
  })

  it('lists its people and opens a visit, coming back to the card opened', async () => {
    renderDept(<Outreach />)
    await openScreening()
    await press(screen.getByRole('tab', { name: 'People' }))
    const card = within(screen.getByRole('list', { name: 'People in this campaign' })).getByRole('button', { name: /^Demo Ada/ })
    expect(card.textContent).toContain('K7-4F2')
    await press(card)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Visit ov-1')
    await press(screen.getByRole('button', { name: 'Back from visit' }))
    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement?.id).toBe('outreach-visit-ov-1-open')
  })

  it('opens the report and comes back', async () => {
    renderDept(<Outreach />)
    await openScreening()
    await press(screen.getByRole('button', { name: 'Report' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Campaign report')
    await press(screen.getByRole('button', { name: 'Back to the campaign' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Report' }))
  })

  it('opens a campaign on today’s Outreach as today’s record', async () => {
    renderDept(<Outreach />)
    await waitFor(async () => expect((await campaignCard('Demo Screening')).textContent).toContain('2 sites'))
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
