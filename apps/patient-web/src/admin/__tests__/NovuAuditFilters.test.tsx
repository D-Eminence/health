import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'
import { AuditPage } from '../Audit'
import { FacilityDetailPage } from '../Facilities'
import { StepUpProvider } from '../StepUp'

/**
 * Novu's audit read (ListPlatformAuditDto) has no target filter and refuses
 * resourceType and resourceId with 400 VALIDATION_FAILED: the production
 * console never sends them.
 */
const mocks = vi.hoisted(() => ({ audit: vi.fn(), facility: vi.fn(), assistedRegistration: vi.fn() }))
vi.mock('../api', () => ({ adminApi: mocks, PAGE_SIZE: 25, newIdempotencyKey: () => 'key-1' }))

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const actor: AdminActor = { accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada', email: 'ada@example.test', platformRoles: [],
  platformPermissions: ['platform.admin.access', 'platform.facility.read', 'platform.audit.read'] }
const event = { sequenceId: '7', eventId: 'event-7', occurredAt: '2026-10-08T12:00:00.000Z', correlationId: 'corr-7',
  actorSubject: 'staff:nurse', facilityId: FACILITY_ID, action: 'ehr.encounter.read', outcome: 'success' }

function open(path: string, route: string, element: ReactElement) {
  render(<MemoryRouter initialEntries={[path]}><StepUpProvider><Routes><Route path={route} element={element} /></Routes></StepUpProvider></MemoryRouter>)
}
const sentTargets = () => mocks.audit.mock.calls.filter(([filters]) => 'resourceType' in filters || 'resourceId' in filters)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  mocks.audit.mockResolvedValue({ items: [event], nextBeforeSequenceId: null })
  mocks.facility.mockResolvedValue({ id: FACILITY_ID, organizationId: 'org-1', organizationName: 'Lagos Health', name: 'Ikeja Clinic',
    code: 'IKJ', status: 'verified', statusReason: null, statusChangedAt: null, createdAt: '2026-09-01T09:00:00.000Z',
    membershipCount: 4, version: 3 })
  mocks.assistedRegistration.mockResolvedValue({ facilityId: FACILITY_ID, designated: false, status: null, addressLine: null,
    town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('audit filters on Novu', () => {
  it('shows a facility only the activity in its scope, read by facility', async () => {
    open(`/admin/facilities/${FACILITY_ID}`, '/admin/facilities/:facilityId', <FacilityDetailPage actor={actor} />)
    expect(await screen.findByText('staff:nurse')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Activity inside this facility' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Platform changes to this facility' })).toBeNull()
    expect(mocks.audit).toHaveBeenCalledWith({ facilityId: FACILITY_ID }, undefined, expect.anything())
    expect(sentTargets()).toEqual([])
  })

  it('opens an old target link without sending the target, and offers no target fields', async () => {
    open(`/admin/audit?resourceType=facility&resourceId=${FACILITY_ID}&outcome=denied`, '/admin/audit', <AuditPage />)
    expect(await screen.findByText('corr-7')).toBeTruthy()
    expect(mocks.audit).toHaveBeenCalledWith({ outcome: 'denied' }, undefined, expect.anything())
    expect(sentTargets()).toEqual([])
    expect(screen.queryByLabelText('Item type')).toBeNull()
    expect(screen.queryByLabelText('Item ID')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the target filter on the main backend', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    open(`/admin/audit?resourceType=facility&resourceId=${FACILITY_ID}`, '/admin/audit', <AuditPage />)
    expect(await screen.findByText('corr-7')).toBeTruthy()
    expect(mocks.audit).toHaveBeenCalledWith({ resourceType: 'facility', resourceId: FACILITY_ID }, undefined, expect.anything())
    expect(screen.getByLabelText('Item type')).toBeTruthy()
    expect(screen.getByLabelText('Item ID')).toBeTruthy()
  })
})
