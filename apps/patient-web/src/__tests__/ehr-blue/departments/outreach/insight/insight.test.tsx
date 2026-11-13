import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../../harness'
import { CampaignDashboard } from '../../../../../ehr-blue/departments/outreach/insight/CampaignDashboard'
import { FollowUps } from '../../../../../ehr-blue/departments/outreach/insight/FollowUps'
import { CampaignReport, reportCount, reportCsv } from '../../../../../ehr-blue/departments/outreach/insight/CampaignReport'
import { CampaignPeople, visitMatches } from '../../../../../ehr-blue/departments/outreach/insight/CampaignPeople'
import { tabsFor } from '../../../../../ehr-blue/departments/outreach/insight/tabs'
import type { CampaignDashboard as Dashboard, CampaignFollowUpRow, CampaignReport as Report, OutreachVisit } from '../../../../../ehr-blue/departments/outreach/campaignTypes'

/*
 * The campaign's dashboard, follow-ups, report and People list (owner decisions of 13 November 2026), on the proposed
 * campaign routes. Every person, phone and campaign here is fictional.
 */

vi.mock('../../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../../harness')
  return { useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.campaign.write'], { id: hospital, name: 'Demo Group', roles: ['outreach_organiser'] })) }
})
type Spec = { method: string; path: string; headers?: Record<string, string>; body?: unknown }
const request = vi.hoisted(() => vi.fn())
const api = vi.hoisted(() => ({ setOutreachCampaignStatus: vi.fn() }))
vi.mock('../../../../../staff/api', () => ({ outreachCampaignRequest: request, staffApi: api }))

const CAMPAIGN = 'camp-demo'
const BASE = `/api/v1/outreach/registration-cases/campaigns/${CAMPAIGN}`
const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })

const DASHBOARD: Dashboard = {
  asOf: '2026-11-13T10:00:00.000Z', target: 400, registered: 40, screened: 30,
  waiting: { vitals: 12, tests: 3, counselling: 2, results: 0 },
  outcomes: { normal: 20, followUp: 2, referUrgent: 1, referRoutine: 3, pending: 14 },
  byFocus: [{ focus: 'hepatitis_b', screened: 25, positive: 5, referred: 3 }, { focus: 'hypertension', screened: 30, positive: 4, referred: 1 }],
  byMember: [
    { memberId: 'tm-2', name: 'Demo Registrar', roles: ['registrar'], registered: 20, screened: 0 },
    { memberId: 'tm-1', name: 'Demo Coordinator', roles: ['coordinator', 'clinician'], registered: 5, screened: 30 },
  ],
  bySite: [{ siteId: 'site-1', name: 'Demo Town Hall', registered: 26, screened: 20 }, { siteId: 'site-2', name: 'Demo Church Hall', registered: 14, screened: 10 }],
  byHour: [{ siteId: 'site-1', hour: '2026-11-13T08:00:00.000Z', registered: 9 }, { siteId: 'site-2', hour: '2026-11-13T08:00:00.000Z', registered: 4 }],
  kits: [{ kitId: 'kit-1', siteId: 'site-2', testId: 'hbsag', lot: 'HB-1', expiresOn: dayOffset(10), count: 14, used: 11, left: 3 }],
  alerts: [{ kind: 'queue_long', message: '12 people are waiting for vital signs.', count: 12 }, { kind: 'urgent_referral', message: 'Urgent referral: K7-4F2.' }],
}

const followUp = (caseId: string, fullName: string, dueOn: string, status: CampaignFollowUpRow['followUp']['status'], referral = false): CampaignFollowUpRow => ({
  caseId, visitCode: 'K7-4F2', fullName, phone: '+2348030000001', siteId: 'site-1', sensitive: false,
  followUp: { followUpId: `fu-${caseId}`, dueOn, reason: 'Recheck blood pressure.', status, notes: null, attempts: 0, updatedAt: '2026-11-13T09:00:00.000Z', rowVersion: 4 },
  referral: referral ? { referralId: `ref-${caseId}`, partnerId: 'p-1', partnerName: 'Demo General Hospital', urgency: 'urgent', reason: 'Very high blood pressure.',
    status: 'made', notes: null, madeAt: '2026-11-13T09:00:00.000Z', updatedAt: '2026-11-13T09:00:00.000Z', rowVersion: 2 } : null,
})

const REPORT: Report = {
  campaignName: 'Demo Screening', organisationName: 'Demo Volunteers', startsOn: '2026-11-12', endsOn: '2026-11-14',
  sites: [{ siteId: 'site-1', name: 'Demo Town Hall', lga: 'Demo LGA', registered: 26, screened: 20 }],
  target: 400, registered: 40, screened: 30, bySex: { female: 22, male: 17, other: 1 },
  byAgeBand: [{ band: '18 to 29', count: 3 }, { band: '30 to 44', count: 37 }],
  byFocus: DASHBOARD.byFocus, outcomes: DASHBOARD.outcomes,
  referrals: { made: 4, arrived: 2, notArrived: 1, waiting: 1 }, followUps: { due: 3, reached: 2, notReached: 1, closed: 0 },
  kitsUsed: 31, invalidTests: 1, smallCountThreshold: 5,
}

let answers: Record<string, () => unknown>
beforeEach(() => {
  vi.clearAllMocks()
  answers = {
    [`GET ${BASE}/dashboard`]: () => DASHBOARD,
    [`GET ${BASE}/team`]: () => ({ members: [], you: { memberId: 'tm-1', roles: ['coordinator', 'clinician'], siteId: null, station: null } }),
    [`GET ${BASE}/report`]: () => REPORT,
    [`GET ${BASE}/follow-ups`]: () => ({ items: [followUp('c-1', 'Demo Later', dayOffset(3), 'due'), followUp('c-2', 'Demo Overdue', dayOffset(-2), 'due', true),
      followUp('c-3', 'Demo Reached', dayOffset(-1), 'reached')] }),
  }
  request.mockImplementation(async (_facility: string, spec: Spec) => {
    const answer = answers[`${spec.method} ${spec.path}`]
    if (!answer) throw new HidApiError(404, 'Not Found', { code: 'NOT_FOUND' })
    return answer()
  })
})
afterEach(() => { vi.useRealTimers() })

const calls = (method: string, path: string) => request.mock.calls.filter(([, spec]) => spec.method === method && spec.path === path)

describe('the dashboard', () => {
  it('shows the big counts, waiting, by focus, team, sites and hours, kits and alerts, every value in words', async () => {
    renderDept(<CampaignDashboard campaignId={CAMPAIGN} roles={['coordinator', 'clinician']} />)
    const tiles = await screen.findByRole('list', { name: 'Today’s counts' }).catch(() => screen.findByLabelText('Today’s counts'))
    const tile = (label: string) => within(tiles).getByText(label).parentElement!
    expect(within(tile('Registered')).getByText('40')).toBeTruthy()
    expect(within(tile('Screened')).getByText('30')).toBeTruthy()
    expect(within(tile('Waiting')).getByText('17')).toBeTruthy()
    expect(within(tile('Waiting')).getByText('Most at vital signs: 12')).toBeTruthy()
    expect(within(tile('Positive')).getByText('9')).toBeTruthy()
    expect(within(tile('Referred')).getByText('4')).toBeTruthy()
    expect(within(tile('Referred')).getByText('1 urgent')).toBeTruthy()
    const alerts = screen.getByRole('heading', { name: 'Needs attention' }).closest('section')!
    expect(within(alerts).getAllByRole('listitem').map(item => item.textContent)).toEqual(['UrgentUrgent referral: K7-4F2.', 'Waiting12 people are waiting for vital signs.'])
    const team = screen.getByRole('heading', { name: 'Team' }).closest('section')!
    // Sorted by what each did.
    expect(within(team).getAllByText(/^Demo /).map(name => name.textContent)).toEqual(['Demo Coordinator', 'Demo Registrar'])
    expect(screen.getByRole('list', { name: 'People registered each hour at Demo Town Hall' }).textContent).toContain('9 people')
    const kits = screen.getByRole('heading', { name: 'Kits' }).closest('section')!
    expect(within(kits).getByText('3 left')).toBeTruthy()
    expect(within(kits).getByText('Running low')).toBeTruthy()
    expect(within(kits).getByText(/^Expires /)).toBeTruthy()
    expect(calls('GET', `${BASE}/team`)).toHaveLength(0)
  })

  it('leaves out hepatitis B and HIV positives for someone who may not see sensitive results', async () => {
    renderDept(<CampaignDashboard campaignId={CAMPAIGN} roles={['registrar', 'data_checker']} />)
    const tiles = await screen.findByLabelText('Today’s counts')
    const positive = within(tiles).getByText('Positive').parentElement!
    expect(within(positive).getByText('4')).toBeTruthy()
    expect(within(positive).getByText('Not counting hepatitis b')).toBeTruthy()
    const focus = screen.getByRole('heading', { name: 'By focus' }).closest('section')!
    // Each focus's counts as StatCards: hepatitis B's positives left out, high blood pressure's shown.
    const hepB = within(focus).getByRole('group', { name: 'Hepatitis B' })
    expect(within(hepB).queryByText('Positive')).toBeNull()
    expect(within(focus).getByText('Positives: counsellors and clinicians only')).toBeTruthy()
    const shownGroups = within(focus).getAllByRole('group').filter(group => within(group).queryByText('Positive'))
    expect(shownGroups.some(group => within(within(group).getByText('Positive').parentElement!).queryByText('4'))).toBe(true)
  })

  it('shows the counts as every dashboard does: StatCards in a StatGroup, tiles opening the tab they count, no Refresh', async () => {
    const opened = vi.fn()
    renderDept(<CampaignDashboard campaignId={CAMPAIGN} roles={['coordinator']} opens={['today', 'people', 'followups']} onOpen={opened} />)
    const tiles = await screen.findByRole('group', { name: 'Today’s counts' })
    // Kasuwa's StatGroup: the grey tray holding white tiles, each with its icon chip, number, label and hint.
    expect(tiles.className).toContain('bg-tray')
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    expect(screen.getByText(/^Updated \d\d:\d\d$/)).toBeTruthy()
    const referred = within(tiles).getByRole('button', { name: /Referred/ })
    expect(referred.textContent).toContain('1 urgent')
    expect(referred.querySelector('.rounded-full svg')).not.toBeNull()
    fireEvent.click(referred)
    expect(opened).toHaveBeenLastCalledWith('followups', undefined)
    fireEvent.click(within(tiles).getByRole('button', { name: /Positive/ }))
    expect(opened).toHaveBeenLastCalledWith('people', 'care')
    // Screened and Waiting open nothing: they are plain tiles.
    expect(within(tiles).queryByRole('button', { name: /Screened/ })).toBeNull()
  })

  it('opens no tab the viewer does not have', async () => {
    renderDept(<CampaignDashboard campaignId={CAMPAIGN} roles={['data_checker']} opens={['dashboard', 'people']} onOpen={vi.fn()} />)
    const tiles = await screen.findByRole('group', { name: 'Today’s counts' })
    expect(within(tiles).queryByRole('button', { name: /Referred/ })).toBeNull()
    expect(within(tiles).getByRole('button', { name: /Registered/ })).toBeTruthy()
  })

  it('reads the counts again every 30 seconds while shown, and on focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderDept(<CampaignDashboard campaignId={CAMPAIGN} roles={['coordinator']} />)
    await screen.findByLabelText('Today’s counts')
    expect(calls('GET', `${BASE}/dashboard`)).toHaveLength(1)
    await act(async () => { vi.advanceTimersByTime(30_000) })
    await waitFor(() => expect(calls('GET', `${BASE}/dashboard`)).toHaveLength(2))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(calls('GET', `${BASE}/dashboard`)).toHaveLength(3))
  })

  it('says plainly when this Outreach does not serve the dashboard yet', async () => {
    delete answers[`GET ${BASE}/dashboard`]
    renderDept(<CampaignDashboard campaignId={CAMPAIGN} roles={['coordinator']} />)
    expect(await screen.findByText('This isn’t available on Health ID yet. Your work here is not affected.')).toBeTruthy()
  })
})

describe('follow-ups', () => {
  it('lists who to call, overdue first, with a tap-to-call phone and the reason in words', async () => {
    renderDept(<FollowUps campaignId={CAMPAIGN} />)
    const list = await screen.findByRole('list', { name: 'Follow-ups' })
    expect(within(list).getAllByRole('heading', { level: 3 }).map(name => name.textContent)).toEqual(['Demo Overdue', 'Demo Later'])
    const overdue = within(list).getAllByRole('listitem')[0]!
    expect(within(overdue).getByText(/^Overdue since /)).toBeTruthy()
    expect(within(overdue).getByRole('link', { name: 'Call +2348030000001' }).getAttribute('href')).toBe('tel:+2348030000001')
    expect(within(overdue).getByText('Recheck blood pressure.')).toBeTruthy()
    const tabs = screen.getByRole('navigation', { name: 'Show follow-ups' })
    await act(async () => { fireEvent.click(within(tabs).getByRole('button', { name: /^Overdue/ })) })
    expect(within(await screen.findByRole('list', { name: 'Follow-ups' })).getAllByRole('heading', { level: 3 }).map(name => name.textContent)).toEqual(['Demo Overdue'])
    await act(async () => { fireEvent.click(within(tabs).getByRole('button', { name: /^Done/ })) })
    expect(within(await screen.findByRole('list', { name: 'Follow-ups' })).getAllByRole('heading', { level: 3 }).map(name => name.textContent)).toEqual(['Demo Reached'])
  })

  it('marks someone reached with a note, against the version read, and resends the same command after a lost answer', async () => {
    const path = '/api/v1/outreach/registration-cases/c-1/follow-up'
    let fail = true
    answers[`PATCH ${path}`] = () => { if (fail) { fail = false; throw new TypeError('Failed to fetch') } return {} }
    renderDept(<FollowUps campaignId={CAMPAIGN} />)
    const later = within(await screen.findByRole('list', { name: 'Follow-ups' })).getAllByRole('listitem')[1]!
    await act(async () => { fireEvent.click(within(later).getByRole('button', { name: 'Reached' })) })
    const note = within(later).getByLabelText(/^Note/)
    expect(document.activeElement).toBe(note)
    fireEvent.change(note, { target: { value: 'Feeling better.' } })
    const save = within(later).getByRole('button', { name: 'Save: reached' })
    await act(async () => { fireEvent.click(save) })
    expect(within(later).getByRole('alert').textContent).toContain('Not saved')
    await act(async () => { fireEvent.click(save) })
    const sent = calls('PATCH', path)
    expect(sent).toHaveLength(2)
    expect(sent[0]![1].body).toEqual({ status: 'reached', notes: 'Feeling better.' })
    expect(sent[0]![1].headers['If-Match']).toBe('"4"')
    expect(sent[0]![1].headers['Idempotency-Key']).toBe(sent[1]![1].headers['Idempotency-Key'])
    await waitFor(() => expect(calls('GET', `${BASE}/follow-ups`).length).toBeGreaterThan(1))
  })

  it('tracks a referral: arrived at referral', async () => {
    const path = '/api/v1/outreach/registration-cases/c-2/referral'
    answers[`PATCH ${path}`] = () => ({})
    renderDept(<FollowUps campaignId={CAMPAIGN} />)
    const overdue = within(await screen.findByRole('list', { name: 'Follow-ups' })).getAllByRole('listitem')[0]!
    expect(within(overdue).getByText('Sent, not yet seen')).toBeTruthy()
    await act(async () => { fireEvent.click(within(overdue).getByRole('button', { name: 'Arrived at referral' })) })
    await act(async () => { fireEvent.click(within(overdue).getByRole('button', { name: 'Save: arrived at referral' })) })
    expect(calls('PATCH', path)[0]![1].body).toEqual({ status: 'arrived' })
    expect(calls('PATCH', path)[0]![1].headers['If-Match']).toBe('"2"')
  })
})

describe('the report', () => {
  it('says counts only, small ones as “fewer than”, and no name of anyone', async () => {
    renderDept(<CampaignReport campaignId={CAMPAIGN} />)
    const bySex = (await screen.findByRole('heading', { name: 'By sex' })).closest('section')!
    expect(within(bySex).getByText('Other or not said').nextElementSibling?.textContent).toBe('fewer than 5')
    expect(within(bySex).getByText('Female').nextElementSibling?.textContent).toBe('22')
    expect(screen.getByRole('heading', { name: 'Totals' }).closest('section')!.textContent).toContain('Registered40')
    expect(document.body.textContent).not.toMatch(/Demo (Overdue|Later|Registrar)|\+234/)
    expect(screen.getByRole('button', { name: 'Download report (PDF)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close campaign' })).toBeNull()
  })

  it('writes the CSV from the same counts', () => {
    expect(reportCount(0, 5)).toBe('0')
    expect(reportCount(3, 5)).toBe('fewer than 5')
    const csv = reportCsv(REPORT)
    expect(csv.split('\r\n')[0]).toBe('Section,Count of,Number')
    expect(csv).toContain('By sex,Other or not said,fewer than 5')
    expect(csv).toContain('Totals,Registered,40')
  })

  it('closes the campaign only after a reason and a confirmation, on today’s status route', async () => {
    api.setOutreachCampaignStatus.mockResolvedValue({})
    const onClosed = vi.fn()
    const campaign = { id: CAMPAIGN, name: 'Demo Screening', status: 'active', services: ['registration'], startsAt: '2026-11-12T00:00:00.000Z', rowVersion: 7 }
    renderDept(<CampaignReport campaignId={CAMPAIGN} campaign={campaign} canClose onClosed={onClosed} />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Close campaign' })) })
    const dialog = screen.getByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Close campaign' })) })
    expect(api.setOutreachCampaignStatus).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Enter at least 8 characters.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Why it is closing'), { target: { value: 'The work is done.' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Close campaign' })) })
    expect(api.setOutreachCampaignStatus).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, campaign, 'closed', 'The work is done.')
    expect(onClosed).toHaveBeenCalled()
    expect(await screen.findByText('Campaign closed')).toBeTruthy()
  })
})

const visit = (id: string, fullName: string, extra: Partial<OutreachVisit>): OutreachVisit => ({
  id, campaignId: CAMPAIGN, status: 'identity_resolution_pending', fullName, ageYears: 40, sex: 'female', temporaryPatientId: `tmp_${id}`,
  createdAt: '2026-11-13T09:00:00.000Z', rowVersion: 1, ...extra,
} as OutreachVisit)

describe('People', () => {
  const people = [
    visit('v-1', 'Demo Ada', { visitCode: 'K7-4F2', phone: '+2348031234567', stationsDone: ['register', 'vitals'] }),
    visit('v-2', 'Demo Bola', { visitCode: 'AC-9DE', phone: null, stationsDone: ['register', 'vitals', 'tests', 'counselling', 'results'],
      outcome: { kind: 'refer', urgency: 'urgent', reason: 'x', confirmedBy: { memberId: 'tm-1', name: null, roles: [] }, confirmedAt: '2026-11-13T10:00:00.000Z' } }),
  ]
  it('finds a person by name, visit code (with or without the dash) or phone', () => {
    expect(visitMatches(people[0]!, 'ada')).toBe(true)
    expect(visitMatches(people[0]!, 'k74f2')).toBe(true)
    expect(visitMatches(people[0]!, 'K7-4F2')).toBe(true)
    expect(visitMatches(people[0]!, '08031234567')).toBe(true)
    expect(visitMatches(people[1]!, '08031234567')).toBe(false)
    expect(visitMatches(people[1]!, 'k74f2')).toBe(false)
  })

  it('shows each person as a card with their visit code, stations done and outcome, and opens their visit', async () => {
    const onOpen = vi.fn()
    renderDept(<CampaignPeople campaignId={CAMPAIGN} cases={{ value: people, loading: false, error: '', refresh: async () => {} }} onOpen={onOpen} />)
    const tabs = screen.getByRole('navigation', { name: 'Show people' })
    await act(async () => { fireEvent.click(within(tabs).getByRole('button', { name: /^All/ })) })
    const list = screen.getByRole('list', { name: 'People in this campaign' })
    const ada = within(list).getByRole('button', { name: /^Demo Ada/ })
    expect(ada.textContent).toContain('Visit code K7-4F2')
    expect(ada.textContent).toContain('2 of 5 stations done')
    expect(within(ada).getByText('Being seen')).toBeTruthy()
    expect(within(within(list).getByRole('button', { name: /^Demo Bola/ })).getByText('Refer (urgent)')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search people' }), { target: { value: 'ac9de' } })
    expect(within(list).queryByRole('button', { name: /^Demo Ada/ })).toBeNull()
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: /^Demo Bola/ })) })
    expect(onOpen).toHaveBeenCalledWith(people[1])
  })
})

describe('the tabs each role sees', () => {
  it('follows the brief', () => {
    expect(tabsFor(['registrar'])).toEqual(['today', 'people'])
    expect(tabsFor(['vitals', 'tester'])).toEqual(['today', 'people'])
    expect(tabsFor(['counsellor'])).toEqual(['today', 'people', 'followups'])
    expect(tabsFor(['data_checker'])).toEqual(['dashboard', 'people'])
    expect(tabsFor(['coordinator'])).toEqual(['today', 'dashboard', 'people', 'followups', 'team', 'setup'])
  })
})
