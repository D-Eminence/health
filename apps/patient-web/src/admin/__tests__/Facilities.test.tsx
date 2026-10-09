import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, Facility } from '../api'
import { FacilitiesPage, FacilityDetailPage } from '../Facilities'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({
  api: { facilities: vi.fn(), facility: vi.fn(), audit: vi.fn(), command: vi.fn(), stepUp: vi.fn() },
  keys: 0,
}))
vi.mock('../api', () => ({ adminApi: mocks.api, PAGE_SIZE: 25, newIdempotencyKey: () => `key-${++mocks.keys}` }))

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const facility = (overrides: Partial<Facility> = {}): Facility => ({ id: FACILITY_ID, organizationId: 'org-1',
  organizationName: 'Lagos Health', name: 'Ikeja Clinic', code: 'IKJ', status: 'pending', statusReason: null,
  statusChangedAt: null, createdAt: '2026-09-01T09:00:00.000Z', membershipCount: 4, version: 3, ...overrides })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: ['platform.facility.read', ...permissions] })

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function open(path: string, element: ReactElement, route = '/admin/facilities') {
  render(<MemoryRouter initialEntries={[path]}><StepUpProvider><Routes>
    <Route path={route} element={<>{element}<Location /></>} />
  </Routes></StepUpProvider></MemoryRouter>)
}

const location = () => screen.getByTestId('location').textContent

beforeEach(() => { vi.clearAllMocks(); mocks.keys = 0 })

describe('facilities list', () => {
  it('loads the filters and page in the link', async () => {
    mocks.api.facilities.mockResolvedValue({ items: [facility()], page: 2, pageSize: 25, total: 30 })
    open('/admin/facilities?status=suspended&query=Ikeja&page=2', <FacilitiesPage actor={actor([])} />)
    expect(await screen.findByText('Ikeja Clinic')).toBeTruthy()
    expect(mocks.api.facilities).toHaveBeenCalledWith({ page: 2, pageSize: 25, status: 'suspended', query: 'Ikeja' }, expect.anything())
    expect(screen.getByRole('link', { name: 'Ikeja Clinic' }).getAttribute('href')).toBe(`/admin/facilities/${FACILITY_ID}`)
    expect(screen.getByText('View only')).toBeTruthy()
  })

  it('pages through results and starts a new search on the first page', async () => {
    mocks.api.facilities.mockResolvedValue({ items: [facility()], page: 1, pageSize: 25, total: 30 })
    open('/admin/facilities', <FacilitiesPage actor={actor([])} />)
    await screen.findByText('Page 1 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(location()).toBe('/admin/facilities?page=2'))
    expect(mocks.api.facilities).toHaveBeenLastCalledWith({ page: 2, pageSize: 25 }, expect.anything())

    fireEvent.change(screen.getByLabelText('Name or code'), { target: { value: 'I' } })
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Name or code'), { target: { value: 'Ikeja' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(location()).toBe('/admin/facilities?query=Ikeja'))
  })

  it('changes a status with step-up, one idempotency key and the confirmation kept after the refresh', async () => {
    mocks.api.facilities.mockResolvedValueOnce({ items: [facility()], page: 1, pageSize: 25, total: 1 })
    mocks.api.facilities.mockResolvedValueOnce({ items: [facility({ status: 'verified', version: 4 })], page: 1, pageSize: 25, total: 1 })
    mocks.api.command.mockRejectedValueOnce(new HidApiError(403, 'Step-up required', { code: 'STEP_UP_REQUIRED' }))
    mocks.api.command.mockResolvedValueOnce({ status: 'verified', version: 4 })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open('/admin/facilities', <FacilitiesPage actor={actor(['platform.facility.manage'])} />)
    await screen.findByText('Ikeja Clinic')
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'verified' } })
    fireEvent.change(screen.getByLabelText('Reason for this change'), { target: { value: 'Documents reviewed and accepted' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Saved. Current information is being refreshed.')).toBeTruthy()
    await waitFor(() => expect(mocks.api.facilities).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.querySelector('.admin-status[data-state="verified"]')).toBeTruthy())
    expect(screen.getByText('Saved. Current information is being refreshed.')).toBeTruthy()
    expect(mocks.api.command).toHaveBeenCalledTimes(2)
    for (const call of mocks.api.command.mock.calls) {
      expect(call).toEqual([`/api/v1/admin/facilities/${FACILITY_ID}/status`,
        { status: 'verified', reason: 'Documents reviewed and accepted' }, { version: 3, idempotencyKey: 'key-1' }])
    }
  })
})

describe('facility detail', () => {
  it('rejects a malformed link without a request', () => {
    open('/admin/facilities/not-a-facility', <FacilityDetailPage actor={actor([])} />, '/admin/facilities/:facilityId')
    expect(screen.getByRole('heading', { name: 'Facility not found' })).toBeTruthy()
    expect(mocks.api.facility).not.toHaveBeenCalled()
  })

  it('shows the platform record, its platform changes by target and facility-scoped audit only to auditors', async () => {
    mocks.api.facility.mockResolvedValue(facility({ status: 'suspended', statusReason: 'Licence under review' }))
    const facilityEvent = { sequenceId: '9', eventId: 'event-9', occurredAt: '2026-10-08T12:00:00.000Z',
      correlationId: 'corr-9', actorType: 'staff', actorSubject: 'staff:nurse', facilityId: FACILITY_ID,
      action: 'ehr.encounter.read', outcome: 'success', resourceType: null, resourceId: null, purposeOfUse: null,
      reason: null, sourceSystem: null }
    const platformEvent = { ...facilityEvent, sequenceId: '12', eventId: 'event-12', correlationId: 'corr-12',
      actorSubject: 'staff:super', facilityId: null, action: 'admin.facility.suspended', resourceType: 'facility',
      resourceId: FACILITY_ID, reason: 'Licence lapsed during inspection' }
    mocks.api.audit.mockImplementation(async (filters: { resourceType?: string }) => ({
      items: [filters.resourceType ? platformEvent : facilityEvent], nextBeforeSequenceId: null }))
    open(`/admin/facilities/${FACILITY_ID}`, <FacilityDetailPage actor={actor(['platform.audit.read'])} />, '/admin/facilities/:facilityId')
    expect(await screen.findByRole('heading', { name: 'Ikeja Clinic', level: 1 })).toBeTruthy()
    expect(screen.getByText('Licence under review')).toBeTruthy()
    expect(mocks.api.facility).toHaveBeenCalledWith(FACILITY_ID, expect.anything())
    const activity = screen.getByRole('region', { name: 'Activity inside this facility' })
    expect(await within(activity).findByText('staff:nurse')).toBeTruthy()
    expect(mocks.api.audit).toHaveBeenCalledWith({ facilityId: FACILITY_ID }, undefined, expect.anything())
    expect(within(activity).getByRole('link', { name: 'Open in Audit' }).getAttribute('href'))
      .toBe(`/admin/audit?facilityId=${FACILITY_ID}`)
    // Platform commands carry no facility scope: they are found by their target (Stage 4A).
    const changes = screen.getByRole('region', { name: 'Platform changes to this facility' })
    expect(await within(changes).findByText('staff:super')).toBeTruthy()
    expect(within(changes).getByText('Licence lapsed during inspection')).toBeTruthy()
    expect(within(changes).queryByText('staff:nurse')).toBeNull()
    expect(mocks.api.audit).toHaveBeenCalledWith({ resourceType: 'facility', resourceId: FACILITY_ID }, undefined, expect.anything())
    expect(within(changes).getByRole('link', { name: 'Open in Audit' }).getAttribute('href'))
      .toBe(`/admin/audit?resourceType=facility&resourceId=${FACILITY_ID}`)
  })

  it('leaves out facility audit for administrators without audit access', async () => {
    mocks.api.facility.mockResolvedValue(facility())
    open(`/admin/facilities/${FACILITY_ID}`, <FacilityDetailPage actor={actor([])} />, '/admin/facilities/:facilityId')
    await screen.findByRole('heading', { name: 'Ikeja Clinic', level: 1 })
    expect(screen.queryByRole('region', { name: 'Activity inside this facility' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Platform changes to this facility' })).toBeNull()
    expect(mocks.api.audit).not.toHaveBeenCalled()
  })
})
