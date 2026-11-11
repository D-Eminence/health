import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor } from '../api'
import { OverviewPage } from '../Dashboard'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), approvals: vi.fn(), applications: vi.fn(), demos: vi.fn(), integrations: vi.fn(),
  activity: vi.fn(), operationsHealth: vi.fn(), operationsErrors: vi.fn(),
}))
vi.mock('../api', () => ({ adminApi: mocks }))

const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: ['platform.admin.access', ...permissions] })
const ALL = ['platform.role.manage', 'platform.identity-review.read', 'platform.demo.read', 'platform.integration.read',
  'platform.facility.read']

function open(permissions: string[]) {
  render(<MemoryRouter><OverviewPage actor={actor(permissions)} /></MemoryRouter>)
}

/** A row of waiting work: a link named by its title, its detail and its count. */
const row = (title: string) => within(screen.getByRole('region', { name: 'Waiting for attention' }))
  .getByRole('link', { name: new RegExp(`^${title}`) })
const findRow = (title: string) => within(screen.getByRole('region', { name: 'Waiting for attention' }))
  .findByRole('link', { name: new RegExp(`^${title}`) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.overview.mockResolvedValue({ registeredPatients: 1200, facilities: 29, verifiedFacilities: 12, suspendedFacilities: 1,
    activeStaffMemberships: 40, pendingIdentityReviews: 3 })
  mocks.approvals.mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: null })
  mocks.applications.mockResolvedValue({ items: [{ status: 'ready_for_review' }, { status: 'pending_verification' },
    { status: 'pending_verification' }, { status: 'approved' }] })
  mocks.demos.mockResolvedValue({ items: Array.from({ length: 100 }, (_, index) => ({ id: String(index) })), nextCursor: 'more' })
  mocks.integrations.mockResolvedValue({ items: [{ enabled: true, health: 'failed' }, { enabled: true, health: 'healthy' },
    { enabled: false, health: 'unknown' }], capabilities: [] })
  const notDeployed = () => Promise.reject(new HidApiError(404, 'Not Found', { code: 'NOT_FOUND' }))
  mocks.activity.mockImplementation(notDeployed)
  mocks.operationsHealth.mockImplementation(notDeployed)
  mocks.operationsErrors.mockImplementation(notDeployed)
})

describe('platform overview', () => {
  it('shows the backend totals with links to the areas', async () => {
    open(ALL)
    expect(await screen.findByText('1,200')).toBeTruthy()
    const facilities = screen.getByRole('link', { name: /Facilities/ })
    expect(facilities.getAttribute('href')).toBe('/admin/facilities')
    // Every total is shown: verified and suspended facilities under the facilities total.
    expect(facilities.textContent).toContain('29')
    expect(facilities.textContent).toContain('12 verified · 1 suspended')
    expect(screen.getByRole('link', { name: /Identity reviews/ }).getAttribute('href')).toBe('/admin/reviews')
    expect(screen.getByText('40')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Registered patients/ })).toBeNull()
  })

  it('links a total only to an area the administrator may open', async () => {
    open(['platform.principal.read', 'platform.session.revoke'])
    expect(await screen.findByText('1,200')).toBeTruthy()
    expect(screen.getByText('12 verified ·', { exact: false })).toBeTruthy()
    expect(screen.getByText('1 suspended')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Facilities/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Identity reviews/ })).toBeNull()
  })

  it('counts waiting work from the lists the administrator can open, marking lists with more pages', async () => {
    open(ALL)
    await screen.findByText('1,200')
    expect((await findRow('Approvals')).textContent).toContain('2 waiting')
    expect(row('Approvals').getAttribute('href')).toBe('/admin/approvals')
    expect(row('Organization applications').textContent).toContain('1 ready')
    expect(row('Organization applications').textContent).toContain('2 more waiting for the CAC check')
    // "+" only when the backend says there is another page, never from a fixed cap.
    expect(row('Demo requests').textContent).toContain('100+ new')
    expect(row('Demo requests').getAttribute('href')).toBe('/admin/demos?status=new')
    expect(mocks.demos).toHaveBeenCalledWith({ status: 'new' }, { limit: 100 }, expect.anything())
    // The backend's default approvals page: an Identity build before Stage 4A refuses `limit` there.
    expect(mocks.approvals).toHaveBeenCalledWith('pending', {}, expect.anything())
    expect(row('Integrations').textContent).toContain('1 failing')
  })

  it('shows an exact count for a full page with no further page, and N+ when one follows', async () => {
    mocks.approvals.mockResolvedValue({ items: Array.from({ length: 100 }, (_, index) => ({ id: String(index) })), nextCursor: null })
    mocks.demos.mockResolvedValue({ items: [{ id: 'd' }], nextCursor: 'more' })
    open(ALL)
    expect((await findRow('Approvals')).textContent).toContain('100 waiting')
    expect(row('Approvals').textContent).not.toContain('100+')
    expect(row('Demo requests').textContent).toContain('1+ new')
  })

  it('keeps the rest of the overview when one count fails', async () => {
    mocks.demos.mockRejectedValueOnce(new HidApiError(503, 'unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    open(ALL)
    const region = within(screen.getByRole('region', { name: 'Waiting for attention' }))
    expect((await region.findByRole('alert')).textContent).toMatch(/Demo requests: /)
    expect(screen.getByText('1,200')).toBeTruthy()
    expect((await findRow('Approvals')).textContent).toContain('2 waiting')
    expect(region.queryByRole('link', { name: /^Demo requests/ })).toBeNull()
  })

  // Owner rule: the overview never shows a reference id, a problem code or the server's own text. Each failure says in
  // plain words what could not be checked and what to do next.
  it('shows a failed count in plain words, without the reference, code or server text', async () => {
    mocks.demos.mockRejectedValue(new HidApiError(500, 'relation "identity.demo_requests" violates check constraint',
      { code: 'INTERNAL_ERROR', requestId: 'hid_web_0b692cd0-f30f-416e-84ff-9325f6163f7d' }))
    open(ALL)
    const region = within(screen.getByRole('region', { name: 'Waiting for attention' }))
    const alert = (await region.findByRole('alert')).textContent ?? ''
    expect(alert).toMatch(/Demo requests: /)
    expect(alert).toMatch(/Try again/)
    expect(alert).not.toMatch(/Reference|hid_web_|0b692cd0|INTERNAL_ERROR|constraint|relation/)
  })

  it('never shows the text or code of a refusal the overview does not know', async () => {
    mocks.demos.mockRejectedValue(new HidApiError(400, 'limit must not be greater than 50', { code: 'VALIDATION_FAILED' }))
    mocks.integrations.mockRejectedValue(new TypeError('Failed to fetch'))
    open(ALL)
    const region = within(screen.getByRole('region', { name: 'Waiting for attention' }))
    await region.findAllByRole('alert')
    const text = region.getAllByRole('alert').map(alert => alert.textContent ?? '').join('\n')
    expect(text).toMatch(/Demo requests: /)
    expect(text).toMatch(/Integrations: /)
    expect(text).not.toMatch(/limit must|VALIDATION_FAILED|Failed to fetch|Reference/)
  })

  it('leaves out an area the backend refuses this administrator, instead of showing it as an error', async () => {
    mocks.applications.mockRejectedValue(new HidApiError(403, 'Organization review is not permitted',
      { code: 'PERMISSION_DENIED', requestId: 'hid_web_x' }))
    open(ALL)
    expect((await findRow('Approvals')).textContent).toContain('2 waiting')
    const region = within(screen.getByRole('region', { name: 'Waiting for attention' }))
    expect(region.queryByRole('alert')).toBeNull()
    expect(region.queryByText(/permission/i)).toBeNull()
    expect(region.queryByRole('link', { name: /^Organization applications/ })).toBeNull()
    expect(region.getByText(/Organization applications aren’t available here right now\./)).toBeTruthy()
  })

  it('still names the end of a session, which the administrator can act on', async () => {
    mocks.demos.mockRejectedValue(new HidApiError(401, 'jwt expired', { code: 'AUTHENTICATION_REQUIRED', requestId: 'hid_web_y' }))
    open(ALL)
    const region = within(screen.getByRole('region', { name: 'Waiting for attention' }))
    const alert = (await region.findByRole('alert')).textContent ?? ''
    expect(alert).toContain('Demo requests: Your platform session has ended. Sign in again to continue.')
    expect(alert).not.toMatch(/jwt|hid_web_|Reference/)
  })

  it('shows failed totals in plain words, without the reference', async () => {
    mocks.overview.mockRejectedValue(new HidApiError(503, 'upstream timed out', { code: 'SERVICE_UNAVAILABLE', requestId: 'hid_web_z' }))
    open(ALL)
    const alert = await screen.findByText(/The platform totals couldn’t be loaded just now/)
    expect(alert.textContent).not.toMatch(/Reference|hid_web_|upstream|SERVICE_UNAVAILABLE/)
  })

  // The owner removed the overview's "Your areas" and "Not available yet" lists (the navigation lists the areas): the
  // overview now reads only what the administrator may open, and has nothing waiting for an area it cannot read.
  it('reads nothing for areas the administrator cannot use, and lists no unavailable capabilities', async () => {
    open(['platform.facility.read'])
    await screen.findByText('1,200')
    expect(screen.getByRole('link', { name: /Facilities/ }).getAttribute('href')).toBe('/admin/facilities')
    expect(screen.queryByRole('link', { name: /Audit/ })).toBeNull()
    expect(screen.queryByText('Support cases')).toBeNull()
    expect(mocks.approvals).not.toHaveBeenCalled()
    expect(mocks.demos).not.toHaveBeenCalled()
  })

  it('asks nothing of the activity endpoints without the dashboard permission', async () => {
    open(ALL)
    await screen.findByText('1,200')
    expect(mocks.activity).not.toHaveBeenCalled()
    expect(mocks.operationsHealth).not.toHaveBeenCalled()
    expect(mocks.operationsErrors).not.toHaveBeenCalled()
  })
})

const SUPER = [...ALL, 'platform.dashboard.read']
const notConfigured = () => Promise.reject(new HidApiError(503, 'SENTRY_READ_TOKEN_SECRET_ARN is unset', { code: 'not_configured', requestId: 'hid_web_nc' }))
const ACTIVITY = (days: number) => ({
  days, generatedAt: '2026-11-11T10:00:00Z',
  people: { accounts: 341, verifiedPct: 96, profilesCompletePct: null, activeInPeriod: 188, sharedWithFacility: 214, accessPins: 146,
    newInPeriod: 64, prevNewInPeriod: 53 },
  care: { healthRecords: 1184, visits: 486, labRequests: 212, prescriptions: 174, emergencyAccess: 31, outreachSignups: 58 },
  migrateAsk: { pagesRead: 1140, recordsMoved: 642, questionsAnswered: null, answersWithSourcesPct: 97 },
  daily: [{ date: '2026-11-09', signups: 3, activeAccounts: 40 }, { date: '2026-11-10', signups: 9, activeAccounts: 52 }],
  recentSignups: [{ name: 'Ada O.', email: 'a***@gmail.com', healthId: 'HID-7K…M9', profilePct: 86, status: 'verified', createdAt: '2026-11-11T09:00:00Z' },
    { name: 'Chidi E.', email: 'c***@yahoo.com', healthId: 'HID-Q4…X2', profilePct: 58, status: 'pending', createdAt: '2026-11-11T08:00:00Z' }],
  recentUploads: [{ document: 'PDF', patient: 'Ada O.', facility: 'Demo Hospital', sizeBytes: 1258291, scan: 'clean', createdAt: '2026-11-11T09:30:00Z' },
    // An older build that still sent a file name: shown as "Document", never the name.
    { document: 'hiv-test-ada.pdf', patient: 'Ada O.', facility: 'Demo Hospital', sizeBytes: 2048, scan: 'pending', createdAt: '2026-11-11T09:00:00Z' }],
})

describe('platform activity (super admin)', () => {
  beforeEach(() => {
    mocks.activity.mockImplementation((days: number) => Promise.resolve(ACTIVITY(days)))
    mocks.operationsHealth.mockImplementation(notConfigured)
    mocks.operationsErrors.mockImplementation(notConfigured)
  })

  it('keeps the four totals and leaves out the new sections while the activity endpoint is not deployed (404)', async () => {
    mocks.activity.mockRejectedValue(new HidApiError(404, 'Cannot GET /api/v1/admin/overview/activity', { code: 'NOT_FOUND' }))
    open(SUPER)
    expect(await screen.findByText('1,200')).toBeTruthy()
    await waitFor(() => expect(mocks.activity).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull())
    expect(screen.getByText('Registered patients')).toBeTruthy()
    expect(screen.getByText('Active staff memberships')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'People' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Recent sign-ups' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/404|NOT_FOUND|Cannot GET/)
  })

  it('shows the sections in the owner’s order', async () => {
    open(SUPER)
    await screen.findByRole('heading', { name: 'People' })
    const order = screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)
    expect(order.filter(text => text !== 'Platform totals' && text !== 'Waiting for attention')).toEqual(['People', 'Care activity',
      'Migrate and Ask about this patient', 'System health', 'Product analytics', 'Recent sign-ups', 'Recent uploads'])
    expect(screen.getAllByText('Not yet')).toHaveLength(2) // a figure the backend cannot measure is not shown as zero
    expect(screen.getByText('+21%')).toBeTruthy()
  })

  it('shows "Not set up yet" for service checks and errors that answer 503 not_configured, never an error', async () => {
    open(SUPER)
    const health = within(await screen.findByRole('region', { name: 'System health' }))
    expect(await health.findByRole('heading', { name: 'Service checks: Not set up yet' })).toBeTruthy()
    expect(await health.findByRole('heading', { name: 'Errors: Not set up yet' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Product analytics: Not set up yet' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/503|not_configured|SENTRY|hid_web_nc/)
  })

  it('shows service checks and errors in plain words when they are set up', async () => {
    mocks.operationsHealth.mockResolvedValue({ services: [{ name: 'identity-api', availabilityPct: 99.98, p50Ms: 182, p95Ms: 412 }],
      messagesDelivered: 99.9, documentsScanned: null, source: 'cloudwatch' })
    mocks.operationsErrors.mockResolvedValue({ unresolvedIssues: 0, errorFreeSessionsPct: 99.6, crashFreeUsersPct: null, top: [] })
    open(SUPER)
    const health = within(await screen.findByRole('region', { name: 'System health' }))
    expect(await health.findByText('Sign-in and Health ID lookups')).toBeTruthy()
    expect(health.getByText('99.98% available')).toBeTruthy()
    expect(health.getByText('182 ms usually · 412 ms at the slowest')).toBeTruthy()
    expect(await health.findByText('No open problems')).toBeTruthy()
    expect(health.getByText('99.6%')).toBeTruthy()
    expect(health.queryByText(/identity-api|p95|cloudwatch/)).toBeNull()
  })

  it('switches the period with a radio group: a click and the arrow keys ask for that many days', async () => {
    open(SUPER)
    const group = await screen.findByRole('radiogroup', { name: 'Show activity for the last' })
    await waitFor(() => expect(mocks.activity).toHaveBeenCalledWith(30, expect.anything()))
    const radios = within(group).getAllByRole('radio')
    expect(radios.map(radio => radio.textContent)).toEqual(['7 days', '30 days', '90 days'])
    expect(within(group).getByRole('radio', { name: '30 days' }).getAttribute('aria-checked')).toBe('true')
    // One Tab stop: only the chosen period is focusable.
    expect(radios.map(radio => radio.tabIndex)).toEqual([-1, 0, -1])

    fireEvent.click(within(group).getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(mocks.activity).toHaveBeenLastCalledWith(7, expect.anything()))
    expect(await screen.findByText('Active in the last 7 days')).toBeTruthy()

    mocks.activity.mockClear()
    fireEvent.keyDown(within(group).getByRole('radio', { name: '7 days' }), { key: 'ArrowRight' })
    await waitFor(() => expect(mocks.activity).toHaveBeenCalledWith(30, expect.anything()))
    const thirty = within(group).getByRole('radio', { name: '30 days' })
    expect(thirty.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(thirty)
    expect(await screen.findByText('Active in the last 30 days')).toBeTruthy()
    fireEvent.keyDown(thirty, { key: 'End' })
    await waitFor(() => expect(mocks.activity).toHaveBeenLastCalledWith(90, expect.anything()))
  })

  it('shows recent sign-ups and uploads with the shortened values as the backend sends them', async () => {
    open(SUPER)
    const signups = await screen.findByRole('table', { name: 'Recent sign-ups, newest first' })
    const first = within(signups).getAllByRole('row')[1]!
    expect(within(first).getByRole('rowheader').textContent).toContain('Ada O.')
    expect(within(first).getByText('a***@gmail.com')).toBeTruthy()
    expect(within(first).getByText('HID-7K…M9')).toBeTruthy()
    expect(within(first).getByText('86%')).toBeTruthy()
    expect(within(first).getByText('Verified')).toBeTruthy()
    expect(within(signups).getByText('Not verified yet')).toBeTruthy()

    const uploads = screen.getByRole('table', { name: 'Recent uploads, newest first' })
    const upload = within(uploads).getAllByRole('row')[1]!
    expect(within(uploads).getByRole('columnheader', { name: 'Type' })).toBeTruthy()
    expect(within(upload).getByRole('rowheader').textContent).toBe('PDF')
    expect(within(uploads).getAllByRole('row')[2]!.querySelector('th')!.textContent).toBe('Document')
    expect(document.body.textContent).not.toMatch(/hiv-test|\.pdf/)
    expect(within(upload).getByText('Ada O.')).toBeTruthy()
    expect(within(upload).getByText('1.2 MB')).toBeTruthy()
    expect(within(upload).getByText('Scanned clean')).toBeTruthy()
  })

  it('shows a failed activity read in plain words, keeping the totals', async () => {
    mocks.activity.mockRejectedValue(new HidApiError(500, 'relation "identity.x" does not exist', { code: 'INTERNAL_ERROR', requestId: 'hid_web_q' }))
    open(SUPER)
    expect(await screen.findByText(/The activity figures couldn’t be loaded just now/)).toBeTruthy()
    expect(screen.getByText('1,200')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/INTERNAL_ERROR|relation|hid_web_q/)
  })
})
