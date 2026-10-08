import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor } from '../api'
import { OverviewPage } from '../Dashboard'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(), approvals: vi.fn(), applications: vi.fn(), demos: vi.fn(), integrations: vi.fn(),
}))
vi.mock('../api', () => ({ adminApi: mocks, DEMO_REQUEST_LIMIT: 100 }))

const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: ['platform.admin.access', ...permissions] })
const ALL = ['platform.role.manage', 'platform.identity-review.read', 'platform.demo.read', 'platform.integration.read',
  'platform.facility.read']

function open(permissions: string[]) {
  render(<MemoryRouter><OverviewPage actor={actor(permissions)} /></MemoryRouter>)
}

const tile = (title: string) => within(screen.getByRole('region', { name: 'Waiting for attention' }))
  .getByRole('link', { name: title }).closest('article')!

beforeEach(() => {
  vi.clearAllMocks()
  mocks.overview.mockResolvedValue({ registeredPatients: 1200, facilities: 29, verifiedFacilities: 12, suspendedFacilities: 1,
    activeStaffMemberships: 40, pendingIdentityReviews: 3 })
  mocks.approvals.mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }] })
  mocks.applications.mockResolvedValue({ items: [{ status: 'ready_for_review' }, { status: 'pending_verification' },
    { status: 'pending_verification' }, { status: 'approved' }] })
  mocks.demos.mockResolvedValue({ items: Array.from({ length: 100 }, (_, index) => ({ id: String(index) })) })
  mocks.integrations.mockResolvedValue({ items: [{ enabled: true, health: 'failed' }, { enabled: true, health: 'healthy' },
    { enabled: false, health: 'unknown' }], capabilities: [] })
})

describe('platform overview', () => {
  it('shows the backend totals with links to the filtered areas', async () => {
    open(ALL)
    expect(await screen.findByText('1,200')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Suspended facilities' }).getAttribute('href')).toBe('/admin/facilities?status=suspended')
    expect(screen.getByRole('link', { name: 'Pending identity reviews' }).getAttribute('href')).toBe('/admin/reviews')
    expect(screen.queryByRole('link', { name: 'Registered patients' })).toBeNull()
  })

  it('counts waiting work from the lists the administrator can open, marking capped lists', async () => {
    open(ALL)
    await screen.findByText('1,200')
    expect(await within(tile('Pending approvals')).findByText('2')).toBeTruthy()
    expect(await within(tile('Organization applications')).findByText(/awaiting CAC verification/)).toBeTruthy()
    expect(tile('Organization applications').textContent).toContain('1 ready for review · 2 awaiting CAC verification')
    expect(await within(tile('New demo requests')).findByText('100+')).toBeTruthy()
    expect(mocks.demos).toHaveBeenCalledWith({ status: 'new' }, expect.anything())
    expect(tile('Integrations').textContent).toContain('1 with a failed last test · 2 of 3 enabled')
  })

  it('keeps the rest of the overview when one count fails', async () => {
    mocks.demos.mockRejectedValueOnce(new HidApiError(503, 'unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    open(ALL)
    expect(await within(tile('New demo requests')).findByRole('alert')).toBeTruthy()
    expect(screen.getByText('1,200')).toBeTruthy()
    expect(await within(tile('Pending approvals')).findByText('2')).toBeTruthy()
  })

  it('lists the areas the administrator can use and the capabilities that do not exist yet', async () => {
    open(['platform.facility.read'])
    await screen.findByText('1,200')
    const areas = within(screen.getByRole('region', { name: 'Your areas' }))
    expect(areas.getByRole('link', { name: 'Facilities' })).toBeTruthy()
    expect(areas.queryByRole('link', { name: 'Audit' })).toBeNull()
    const unavailable = within(screen.getByRole('region', { name: 'Not available yet' }))
    expect(unavailable.getByText('Support cases')).toBeTruthy()
    expect(unavailable.queryAllByRole('link')).toHaveLength(0)
    expect(mocks.approvals).not.toHaveBeenCalled()
  })
})
