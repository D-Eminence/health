import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import {
  DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, type Sent,
} from '../../frame/blueHarness'
import { exportOf, reportOf } from './fixtures'

/*
 * Reports & Analytics (hid-system REP-1, 0203 and 0204) inside the blue EHR's real frame, joined as departments/pages.ts
 * joins it: listed under Insight for the facility's administrators, reading the report with the contract's query and
 * headers, comparing each figure with the days before, downloading from route 2's answer alone with small counts hidden,
 * and, while the switch is off (404 or 503), keeping the demo's sample at a demo facility and saying "not available yet"
 * anywhere else, never a broken page. The device is set to Los Angeles: every day and time on screen is Lagos's. Every
 * account, facility and figure is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const saved = vi.hoisted(() => ({ saveFile: vi.fn() }))
vi.mock('../../../../download', () => saved)

// The blue EHR loads lazily: built once here, so the first test does not spend its wait on the build.
beforeAll(async () => {
  await import('../../../../ehr-blue/EhrBlueApp')
  vi.resetModules()
}, 120_000)

const originalZone = process.env.TZ
beforeEach(async () => {
  process.env.TZ = 'America/Los_Angeles'
  // 23:30 UTC on 30 Nov 2026: still 30 Nov on the device, already 1 Dec in Lagos.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 30, 23, 30))
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { reportsPage } = await import('../../../../ehr-blue/departments/reports/page')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
      './departments/pages.ts': { pages: [reportsPage] } }) }
  })
})
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); saved.saveFile.mockReset()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

const REPORT = 'GET /api/v1/ehr/reports/operations'
const EXPORT = 'POST /api/v1/ehr/reports/operations/exports'
const ADMIN = ['reports.read', 'reports.export']
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const many = <T,>(answer: T, count = 4): T[] => Array.from({ length: count }, () => answer)

/** The addresses the page asked for: only the two days ever go in a query. */
function reportQueries(): URLSearchParams[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)))
    .filter(url => url.pathname === '/api/v1/ehr/reports/operations').map(url => url.searchParams)
}
function checkHeaders(call: Sent | undefined, id = REAL_FACILITY) {
  expect(call?.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
  expect(call?.headers.get('X-Facility-ID')).toBe(id)
  expect(call?.headers.get('Idempotency-Key')).toBeNull()
}
function noPatientInAddresses() {
  for (const [url] of vi.mocked(fetch).mock.calls) {
    const address = new URL(String(url))
    expect([...address.searchParams.keys()].filter(key => !['from', 'to'].includes(key))).toEqual([])
    expect(String(url)).not.toMatch(/HID-|patient|healthId|nin/i)
  }
}

async function openReports(permissions: readonly string[], routes: Record<string, (() => Response)[]>, {
  id = REAL_FACILITY, name = 'Fictional Riverside Hospital', roles = ['org_admin'], path = '/provider/reports',
}: { id?: string; name?: string; roles?: string[]; path?: string } = {}) {
  const current = facility(id, name, permissions, roles)
  const sent = serve({ [SESSION]: [sessionAt(current, [current])], ...routes })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe('Reports & Analytics for a facility administrator', () => {
  it('is listed under Insight and shows the last 30 Lagos days, each figure against the days before, as a draft', async () => {
    const sent = await openReports(ADMIN, { [REPORT]: [() => json(reportOf('2026-11-02', '2026-12-01', { includesToday: true }))] })
    expect(await screen.findByRole('heading', { level: 1, name: 'Reports & Analytics' })).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Reports & Analytics' }).getAttribute('href')).toBe('/provider/reports')

    // Today in Lagos is 1 Dec, whatever the device says: the default range ends there.
    await screen.findByText('2 Nov 2026 to 1 Dec 2026 (30 days)')
    expect(reportQueries().map(query => Object.fromEntries(query))).toEqual([{ from: '2026-11-02', to: '2026-12-01' }])
    checkHeaders(sent.find(call => call.route === REPORT))
    expect(screen.getByText(/Compared with 3 Oct 2026 to 1 Nov 2026\. Today is counted so far\. Worked out 1 Dec 2026, 09:00\./)).toBeDefined()
    expect(screen.getByText('Figure definitions are awaiting clinical sign-off.')).toBeDefined()
    expect(screen.getByText('This facility only. Days are Lagos days. Totals only: no patient is named.')).toBeDefined()

    const waiting = screen.getByRole('list', { name: 'Waiting list' })
    const checkedIn = within(waiting).getByRole('listitem', { name: 'Patients checked in' })
    expect(within(checkedIn).getByText('412')).toBeDefined()
    expect(within(checkedIn).getByText('Up 32 from 380 in the previous 30 days.')).toBeDefined()
    expect(within(checkedIn).getByRole('img').getAttribute('aria-label'))
      .toBe('Patients checked in, day by day: highest 412 on 2 Nov 2026, lowest 0 on 3 Nov 2026.')
    const seen = within(waiting).getByRole('listitem', { name: 'Seen by a clinician' })
    expect(within(seen).getByText('Counted for 300 of 412 check-ins (the previous 30 days: 0 of 380 check-ins).')).toBeDefined()
    const wait = within(waiting).getByRole('listitem', { name: 'Median wait to see a clinician' })
    expect(within(wait).getByText('34 minutes')).toBeDefined()
    expect(within(wait).getByText('From 290 check-ins.')).toBeDefined()
    expect(within(wait).getByText('No median for the previous 30 days.')).toBeDefined()

    const visits = screen.getByRole('list', { name: 'Visits' })
    expect(within(within(visits).getByRole('listitem', { name: 'Visits completed' })).getByText('1,284')).toBeDefined()
    const pharmacy = screen.getByRole('list', { name: 'Pharmacy' })
    const notCompleted = within(pharmacy).getByRole('listitem', { name: 'Prescriptions this pharmacy could not complete' })
    const reasons = within(notCompleted).getByLabelText('By reason')
    expect(reasons.textContent).toContain('Out of stock3 (2 in the previous 30 days)')
    expect(reasons.textContent).toContain('Patient chose not to go ahead1 (0 in the previous 30 days)')
    expect(reasons.textContent).not.toContain('Another reason')

    // The daily values, as text, once opened.
    const daily = screen.getByText('Daily values: laboratory').closest('details')!
    act(() => { daily.open = true; daily.dispatchEvent(new Event('toggle')) })
    const table = await within(daily).findByRole('table', { name: 'Laboratory, day by day' })
    expect(within(table).getAllByRole('row')).toHaveLength(31)
    expect(within(table).getByRole('rowheader', { name: '2 Nov 2026' })).toBeDefined()

    expect(document.body.textContent).not.toMatch(/permission|medianWaitMinutes|out_of_stock|waitingList/i)
    expect(where()).toBe('/provider/reports')
    noPatientInAddresses()
  })

  it('reads the range chosen, keeps it in the address, and refuses a range the backend would refuse without asking', async () => {
    await openReports(ADMIN, { [REPORT]: [
      () => json(reportOf('2026-11-02', '2026-12-01')),
      () => json(reportOf('2026-11-01', '2026-11-30')),
      () => json(reportOf('2026-11-25', '2026-12-01')),
    ] })
    await screen.findByText('2 Nov 2026 to 1 Dec 2026 (30 days)')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: '2026-11-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show figures' }))
    await screen.findByText('1 Nov 2026 to 30 Nov 2026 (30 days)')
    expect(Object.fromEntries(reportQueries()[1]!)).toEqual({ from: '2026-11-01', to: '2026-11-30' })

    // 93 days: said at once, and nothing is asked.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show figures' }))
    expect(await screen.findByText('Choose a range of up to 92 days.')).toBeDefined()
    // A day after today in Lagos.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: '2026-12-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show figures' }))
    expect(await screen.findByText('Choose a start date on or before the end date, ending today or earlier, within the last 2 years.')).toBeDefined()
    expect(reportQueries()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await screen.findByText('25 Nov 2026 to 1 Dec 2026 (7 days)')
    expect(Object.fromEntries(reportQueries()[2]!)).toEqual({ from: '2026-11-25', to: '2026-12-01' })
    noPatientInAddresses()
  })

  it('says the backend’s own refusals in plain words', async () => {
    await openReports(ADMIN, { [REPORT]: [() => problem(503, 'REPORT_TOO_SLOW', 'Statement timeout')] })
    expect(await screen.findByText('This report took too long. Try a shorter range, or try again later.')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Reports & Analytics' })).toBeDefined()
    expect(document.body.textContent).not.toMatch(/Statement timeout|REPORT_TOO_SLOW/)
  })
})

describe('downloads', () => {
  it('builds the CSV from the download’s own answer, small counts hidden, with no Idempotency-Key', async () => {
    const sent = await openReports(ADMIN, {
      [REPORT]: [() => json(reportOf('2026-11-02', '2026-12-01'))],
      [EXPORT]: [() => json(exportOf('2026-11-02', '2026-12-01', 'csv'))],
    })
    await screen.findByText('2 Nov 2026 to 1 Dec 2026 (30 days)')
    expect(screen.getByText(/Counts from 1 to 4 are shown as fewer than 5\. Each download is recorded\./)).toBeDefined()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download CSV' })) })
    await waitFor(() => expect(saved.saveFile).toHaveBeenCalledTimes(1))
    const call = sent.find(request => request.route === EXPORT)
    expect(call?.body).toEqual({ from: '2026-11-02', to: '2026-12-01', format: 'csv' })
    checkHeaders(call)
    const [blob, name] = saved.saveFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('reports-operations-2026-11-02-to-2026-12-01.csv')
    const csv = await blob.text()
    expect(csv).toContain('Facility: Fictional Riverside Hospital')
    expect(csv).toContain('Pharmacy,Dispensings reversed,fewer than 5,fewer than 5,')
    expect(csv).toContain('Laboratory,Median time from sample to result (minutes),not shown (fewer than 5),110,')
    expect(csv).toContain('Draft: Figure definitions are awaiting clinical sign-off.')
    // On screen the same figure is shown as it is: the facility's own administrators.
    expect(within(screen.getByRole('listitem', { name: 'Dispensings reversed' })).getByText('3')).toBeDefined()
    expect(await screen.findByText('The CSV file for 2 Nov 2026 to 1 Dec 2026 was saved. This download is recorded.')).toBeDefined()
  })

  it('makes a PDF from the download’s answer', async () => {
    await openReports(ADMIN, {
      [REPORT]: [() => json(reportOf('2026-11-02', '2026-12-01'))],
      [EXPORT]: [() => json(exportOf('2026-11-02', '2026-12-01', 'pdf'))],
    })
    await screen.findByText('2 Nov 2026 to 1 Dec 2026 (30 days)')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download PDF' })) })
    await waitFor(() => expect(saved.saveFile).toHaveBeenCalledTimes(1), { timeout: 20_000 })
    const [blob, name] = saved.saveFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('reports-operations-2026-11-02-to-2026-12-01.pdf')
    expect(blob.type).toBe('application/pdf')
    expect(new TextDecoder('latin1').decode(await blob.arrayBuffer()).startsWith('%PDF-')).toBe(true)
  })

  it('says so and offers no download while downloads are switched off', async () => {
    await openReports(ADMIN, {
      [REPORT]: [() => json(reportOf('2026-11-02', '2026-12-01'))],
      [EXPORT]: [() => problem(503, 'REPORTS_EXPORT_NOT_AVAILABLE', 'Export switched off')],
    })
    await screen.findByText('2 Nov 2026 to 1 Dec 2026 (30 days)')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download CSV' })) })
    expect(await screen.findByText('Downloading reports is not available yet.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull()
    expect(saved.saveFile).not.toHaveBeenCalled()
    // The figures stay.
    expect(screen.getByRole('listitem', { name: 'Patients checked in' })).toBeDefined()
  })

  it('offers no download to a session that may read but not download', async () => {
    await openReports(['reports.read'], { [REPORT]: [() => json(reportOf('2026-11-02', '2026-12-01'))] })
    await screen.findByText('2 Nov 2026 to 1 Dec 2026 (30 days)')
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Download' })).toBeNull()
  })
})

describe('while reports are switched off', () => {
  it.each([
    ['503 REPORTS_NOT_AVAILABLE (the switch off)', () => problem(503, 'REPORTS_NOT_AVAILABLE', 'Switched off')],
    ['404 (an ehr-api before REP-1)', () => problem(404, 'API_ROUTE_NOT_FOUND', 'Not found')],
  ])('a real facility is told they are not available yet, and the sidebar stops listing them: %s', async (_name, answer) => {
    await openReports(ADMIN, { [REPORT]: [answer] })
    expect(await screen.findByText('Reports are not available yet.')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Reports & Analytics' })).toBeDefined()
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Reports & Analytics' })).toBeNull())
    expect(screen.queryByText(/Sample only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show figures' })).toBeNull()
  })

  it('a demo facility keeps today’s sample', async () => {
    await openReports(ADMIN, { [REPORT]: [() => problem(503, 'REPORTS_NOT_AVAILABLE', 'Switched off')] },
      { id: DEMO_HOSPITAL, name: 'Demo Hospital' })
    expect(await screen.findByLabelText('Created from')).toBeDefined()
    expect(screen.getByText(/Sample only/)).toBeDefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Reports & Analytics' })).toBeDefined()
  })

  it('an administrator on a backend before 0204 (no report code) is told they are not available yet, with nothing read', async () => {
    const sent = await openReports(['workforce.read'], {})
    expect(await screen.findByText('Reports are not available yet.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Reports & Analytics' })).toBeNull()
    expect(sent.filter(call => call.route === REPORT)).toEqual([])
  })

  it('anyone else at a real facility is told who can see reports, with nothing read', async () => {
    const sent = await openReports(['ehr.encounter.read'], {}, { roles: ['doctor'] })
    expect(await screen.findByText('Only this facility’s administrators can see its reports.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/permission/i)
    expect(sent.filter(call => call.route === REPORT)).toEqual([])
  })

  it('a demo facility’s administrator without the code keeps today’s sample', async () => {
    const sent = await openReports([], {}, { id: DEMO_HOSPITAL, name: 'Demo Hospital' })
    expect(await screen.findByLabelText('Created from')).toBeDefined()
    expect(sent.filter(call => call.route === REPORT)).toEqual([])
  })
})

describe('Home’s Activity card', () => {
  it('shows four live figures for the last 7 Lagos days against the 7 before, and the last 30 when chosen', async () => {
    const sent = await openReports(ADMIN, { [REPORT]: [
      () => json(reportOf('2026-11-25', '2026-12-01', { includesToday: true })),
      () => json(reportOf('2026-11-02', '2026-12-01', { includesToday: true })),
    ], ...{ 'GET /api/v1/identity/access-requests': many(() => json([])) } }, { path: '/provider' })
    const card = await screen.findByLabelText('Activity in period')
    await within(card).findByText('Patients checked in')
    expect(Object.fromEntries(reportQueries()[0]!)).toEqual({ from: '2026-11-25', to: '2026-12-01' })
    checkHeaders(sent.find(call => call.route === REPORT))
    expect(within(card).getByText('Lagos days')).toBeDefined()
    for (const label of ['Patients checked in', 'Visits opened', 'Results released', 'Prescriptions dispensed']) {
      expect(within(card).getByText(label)).toBeDefined()
    }
    expect(within(card).getByText('vs 380 previous 7 days')).toBeDefined()
    expect(within(card).getByText('Figure definitions are awaiting clinical sign-off.')).toBeDefined()
    expect(within(card).queryByText(/Sample/)).toBeNull()

    fireEvent.change(within(card).getByLabelText('Reporting period'), { target: { value: '30' } })
    await within(card).findByText('vs 380 previous 30 days')
    expect(Object.fromEntries(reportQueries()[1]!)).toEqual({ from: '2026-11-02', to: '2026-12-01' })
  })

  it('is not drawn while reports are switched off at a real facility', async () => {
    await openReports(ADMIN, { [REPORT]: [() => problem(503, 'REPORTS_NOT_AVAILABLE', 'Switched off')],
      'GET /api/v1/identity/access-requests': many(() => json([])) }, { path: '/provider' })
    await waitFor(() => expect(reportQueries()).toHaveLength(1))
    await waitFor(() => expect(screen.queryByLabelText('Activity in period')).toBeNull())
    await waitFor(() => expect(within(nav()).queryByRole('link', { name: 'Reports & Analytics' })).toBeNull())
    expect(screen.queryByText('Reports are not available yet.')).toBeNull()
  })
})
