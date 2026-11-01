import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor } from '../api'
import { OverviewPage } from '../Dashboard'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), approvals: vi.fn(), applications: vi.fn(), demos: vi.fn(), integrations: vi.fn(),
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
})
