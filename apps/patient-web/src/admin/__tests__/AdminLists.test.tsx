import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { AdminActor } from '../api'
import { AuditPage } from '../Audit'
import { DemosPage, OperationsPage, ReviewsPage } from '../Pages'
import { PrincipalsPage } from '../Principals'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(), principals: vi.fn(), demos: vi.fn(), services: vi.fn(), events: vi.fn(), reviews: vi.fn(), command: vi.fn(),
  stepUp: vi.fn(),
}))
vi.mock('../api', () => ({ adminApi: mocks, newIdempotencyKey: () => 'key-1' }))

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function open(path: string, element: ReactElement) {
  const route = new URL(path, 'http://admin.test').pathname
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={<>{element}<Location /></>} /></Routes></MemoryRouter>)
}

const location = () => decodeURIComponent(screen.getByTestId('location').textContent ?? '')

beforeEach(() => vi.clearAllMocks())

describe('audit filters', () => {
  const event = { sequenceId: '7', eventId: 'event-7', occurredAt: '2026-10-08T12:00:00.000Z', correlationId: 'corr-7',
    actorType: 'staff', actorSubject: 'staff:ada', facilityId: FACILITY_ID, action: 'admin.facility.status.request',
    outcome: 'denied', resourceType: 'facility', resourceId: FACILITY_ID, purposeOfUse: 'operations', reason: 'Licence lapsed',
    sourceSystem: 'hid' }

  it('sends only valid filters from the link, with local times as instants', async () => {
    mocks.audit.mockResolvedValue({ items: [event], nextBeforeSequenceId: null })
    open('/admin/audit?actor=staff:ada&outcome=denied&facilityId=not-a-uuid&from=2026-10-01T09:00&to=bogus', <AuditPage />)
    expect(await screen.findByText('corr-7')).toBeTruthy()
    expect(mocks.audit).toHaveBeenCalledWith({ actor: 'staff:ada', outcome: 'denied',
      from: new Date('2026-10-01T09:00').toISOString() }, undefined, expect.anything())
  })

  it('shows actor, target, scope, purpose and reason without inventing missing fields', async () => {
    mocks.audit.mockResolvedValue({ items: [event, { ...event, sequenceId: '6', eventId: 'event-6', correlationId: 'corr-6',
      actorSubject: null, actorType: null, facilityId: null, resourceType: null, resourceId: null, purposeOfUse: null, reason: null }],
    nextBeforeSequenceId: null })
    open('/admin/audit', <AuditPage />)
    await screen.findByText('corr-7')
    expect(screen.getByText('Licence lapsed')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Facility/ }).getAttribute('href')).toBe(`/admin/facilities/${FACILITY_ID}`)
    expect(screen.getByText('System')).toBeTruthy()
    expect(screen.getByText('Platform')).toBeTruthy()
    expect(screen.getAllByText('Not recorded')).toHaveLength(2)
  })

  it('sends a target filter from the link, and only a target ID that has a valid type', async () => {
    mocks.audit.mockResolvedValue({ items: [event], nextBeforeSequenceId: null })
    open(`/admin/audit?resourceType=facility&resourceId=${FACILITY_ID}`, <AuditPage />)
    expect(await screen.findByText('corr-7')).toBeTruthy()
    expect(mocks.audit).toHaveBeenCalledWith({ resourceType: 'facility', resourceId: FACILITY_ID }, undefined, expect.anything())
    cleanup()
    vi.clearAllMocks()
    mocks.audit.mockResolvedValue({ items: [event], nextBeforeSequenceId: null })
    open(`/admin/audit?resourceId=${FACILITY_ID}&resourceType=Not%20A%20Type`, <AuditPage />)
    expect(await screen.findByText('corr-7')).toBeTruthy()
    expect(mocks.audit).toHaveBeenCalledWith({}, undefined, expect.anything())
  })

  it('refuses a target ID without a target type before searching', async () => {
    mocks.audit.mockResolvedValue({ items: [], nextBeforeSequenceId: null })
    open('/admin/audit', <AuditPage />)
    await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Target ID'), { target: { value: FACILITY_ID } })
    expect(screen.getByText(/Enter a target type such as facility/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply filters' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'facility' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(location()).toBe(`/admin/audit?resourceType=facility&resourceId=${FACILITY_ID}`))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ resourceType: 'facility', resourceId: FACILITY_ID },
      undefined, expect.anything()))
  })

  it('applies filters into the link and refuses a partial facility ID', async () => {
    mocks.audit.mockResolvedValue({ items: [], nextBeforeSequenceId: null })
    open('/admin/audit', <AuditPage />)
    await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Facility ID'), { target: { value: '0f8c' } })
    expect(screen.getByText('Enter a full facility ID.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply filters' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Facility ID'), { target: { value: FACILITY_ID } })
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: ' admin.account.status ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(location()).toBe(`/admin/audit?action=admin.account.status&facilityId=${FACILITY_ID}`))
    await waitFor(() => expect(mocks.audit).toHaveBeenLastCalledWith({ action: 'admin.account.status', facilityId: FACILITY_ID },
      undefined, expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(location()).toBe('/admin/audit'))
  })
})

describe('users and roles lookup', () => {
  const principal = { id: 'account-2', subject: 'staff:ada', email: 'ada@example.test', displayName: 'Ada Operator', status: 'active',
    createdAt: '2026-09-01T09:00:00.000Z', platformRoles: [], activeSessionCount: 0, version: 2,
    memberships: [{ id: 'm-1', facilityId: FACILITY_ID, facilityName: 'Ikeja Clinic', role: 'nurse', appRole: 'provider', active: false }] }

  function search(text: string) {
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  }

  it('searches with a status and pages, keeping the search term out of the URL', async () => {
    mocks.principals.mockImplementation((_query: string, filters: { page: number }) =>
      Promise.resolve({ items: [principal], page: filters.page, pageSize: 25, total: 26 }))
    open('/admin/principals', <PrincipalsPage actor={actor(['platform.principal.read', 'platform.audit.read'])} />)
    fireEvent.change(screen.getByLabelText('Account status'), { target: { value: 'active' } })
    search('ada@example.test')
    expect(await screen.findByText('Ada Operator')).toBeTruthy()
    expect(mocks.principals).toHaveBeenLastCalledWith('ada@example.test', { page: 1, status: 'active' }, expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Page 2 of 2')).toBeTruthy()
    expect(mocks.principals).toHaveBeenLastCalledWith('ada@example.test', { page: 2, status: 'active' }, expect.anything())
    expect(location()).toBe('/admin/principals')
    expect(screen.getByText('Ikeja Clinic · Nurse (inactive)')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Activity in audit' }).getAttribute('href')).toBe('/admin/audit?actor=staff%3Aada')
    expect(screen.getByText('View only')).toBeTruthy()
  })

  it('shows authenticator enrolment and offers an MFA reset only for enrolled administrators', async () => {
    mocks.principals.mockResolvedValue({ items: [
      { ...principal, id: 'account-3', displayName: 'Bayo Enrolled', subject: 'staff:bayo', mfaEnrolled: true },
      { ...principal, id: 'account-4', displayName: 'Chika Unenrolled', subject: 'staff:chika', mfaEnrolled: false },
      // An Identity build before Stage 4A does not report enrolment: the reset stays offered and the backend decides.
      { ...principal, id: 'account-5', displayName: 'Dele Unreported', subject: 'staff:dele', mfaEnrolled: undefined },
    ], page: 1, pageSize: 25, total: 3 })
    open('/admin/principals', <StepUpProvider><PrincipalsPage actor={actor(['platform.principal.read', 'platform.mfa.reset'])} />
    </StepUpProvider>)
    search('example')
    const enrolled = (await screen.findByText('Bayo Enrolled')).closest('tr')!
    const unenrolled = screen.getByText('Chika Unenrolled').closest('tr')!
    expect(within(enrolled).getByText('Enrolled')).toBeTruthy()
    expect(within(unenrolled).getByText('Not set up')).toBeTruthy()
    expect(within(enrolled).getByText('Request authenticator reset')).toBeTruthy()
    expect(within(unenrolled).queryByText('Request authenticator reset')).toBeNull()
    expect(within(unenrolled).getByText('View only')).toBeTruthy()
    const unreported = screen.getByText('Dele Unreported').closest('tr')!
    expect(within(unreported).getByText('Not reported')).toBeTruthy()
    expect(within(unreported).getByText('Request authenticator reset')).toBeTruthy()
  })

  it('keeps the "Revoke all sessions" confirmation after the reload reports no sessions left', async () => {
    const withSessions = { ...principal, id: 'account-6', displayName: 'Efe Sessions', subject: 'staff:efe', activeSessionCount: 2 }
    mocks.principals.mockResolvedValueOnce({ items: [withSessions], page: 1, pageSize: 25, total: 1 })
      .mockResolvedValueOnce({ items: [{ ...withSessions, activeSessionCount: 0 }], page: 1, pageSize: 25, total: 1 })
    mocks.command.mockResolvedValueOnce({ accountId: 'account-6', revokedCount: 2, replayed: false })
    open('/admin/principals', <StepUpProvider><PrincipalsPage actor={actor(['platform.principal.read', 'platform.session.revoke'])} />
    </StepUpProvider>)
    search('efe')
    const row = (await screen.findByText('Efe Sessions')).closest('tr')!
    const form = within(row).getByText('Revoke all sessions').closest('details')!
    fireEvent.change(within(form).getByLabelText('Reason for this change'), { target: { value: 'Reported lost laptop' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Confirm change' }))
    await waitFor(() => expect(mocks.principals).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(row).getByText('0')).toBeTruthy())
    expect(within(row).getByText('Saved. Current information is being refreshed.')).toBeTruthy()
    expect(within(row).getByText('This account has no active sessions.')).toBeTruthy()
    expect((within(form).getByRole('button', { name: 'Confirm change' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.command).toHaveBeenCalledWith('/api/v1/admin/principals/account-6/sessions/revoke',
      { reason: 'Reported lost laptop' }, { idempotencyKey: 'key-1' })
  })

  it('offers "Revoke all sessions" only for an account with active sessions', async () => {
    mocks.principals.mockResolvedValue({ items: [{ ...principal, activeSessionCount: 0 }], page: 1, pageSize: 25, total: 1 })
    open('/admin/principals', <StepUpProvider><PrincipalsPage actor={actor(['platform.principal.read', 'platform.session.revoke'])} />
    </StepUpProvider>)
    search('ada')
    const row = (await screen.findByText('Ada Operator')).closest('tr')!
    expect(within(row).queryByText('Revoke all sessions')).toBeNull()
  })

  it('leaves out the audit link without audit access', async () => {
    mocks.principals.mockResolvedValue({ items: [principal], page: 1, pageSize: 25, total: 1 })
    open('/admin/principals', <PrincipalsPage actor={actor(['platform.principal.read'])} />)
    search('ada')
    await screen.findByText('Ada Operator')
    expect(screen.queryByRole('link', { name: 'Activity in audit' })).toBeNull()
  })
})

describe('demo requests, operations and identity reviews', () => {
  it('filters demo requests by valid status and product from the link', async () => {
    mocks.demos.mockResolvedValue({ items: [], nextCursor: null })
    open('/admin/demos?status=new&product=laboratory', <DemosPage actor={actor(['platform.demo.read'])} />)
    await waitFor(() => expect(mocks.demos).toHaveBeenCalledWith({ status: 'new', productCode: 'laboratory' }, {}, expect.anything()))
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: '' } })
    await waitFor(() => expect(location()).toBe('/admin/demos?status=new'))
  })

  it('ignores unknown demo filters and pages beyond the first page with the backend cursor', async () => {
    const demo = (index: number) => ({ id: `d-${index}`, contactName: `Contact ${index}`, contactEmail: `c${index}@example.test`,
      organizationName: null, productCode: 'ehr', status: 'new', createdAt: '2026-10-08T12:00:00.000Z', version: 1 })
    mocks.demos.mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, index) => demo(index)), nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [demo(50), demo(51)], nextCursor: null })
    open('/admin/demos?status=bogus', <DemosPage actor={actor(['platform.demo.read'])} />)
    expect(await screen.findByText('Showing 50 requests, newest first; more are available')).toBeTruthy()
    expect(mocks.demos).toHaveBeenCalledWith({}, {}, expect.anything())
    expect(screen.queryByText(/newest 100/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    expect(await screen.findByText('Contact 51')).toBeTruthy()
    expect(mocks.demos).toHaveBeenLastCalledWith({}, { cursor: 'cursor-2' }, expect.any(AbortSignal))
    expect(screen.getByText('Showing 52 requests, newest first')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load more requests' })).toBeNull()
  })

  it('confirms a status change on a row from a later page after the list starts again', async () => {
    const demo = (index: number) => ({ id: `d-${index}`, contactName: `Contact ${index}`, contactEmail: `c${index}@example.test`,
      organizationName: null, productCode: 'ehr', status: 'new', createdAt: '2026-10-08T12:00:00.000Z', version: 1 })
    mocks.demos.mockResolvedValueOnce({ items: [demo(0)], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [demo(1)], nextCursor: null })
      .mockResolvedValueOnce({ items: [demo(0)], nextCursor: 'cursor-2b' })
    mocks.command.mockResolvedValueOnce({ status: 'contacted', version: 2 })
    open('/admin/demos', <StepUpProvider><DemosPage actor={actor(['platform.demo.read', 'platform.demo.manage'])} /></StepUpProvider>)
    await screen.findByText('Contact 0')
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    const row = (await screen.findByText('Contact 1')).closest('tr')!
    fireEvent.change(within(row).getByLabelText('Reason for this change'), { target: { value: 'Called back and booked a demo' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm change' }))
    expect(await screen.findByText('The request from Contact 1 is now contacted.')).toBeTruthy()
    // The reload starts again from the first page, which removes the row; the confirmation stays.
    await waitFor(() => expect(screen.queryByText('Contact 1')).toBeNull())
    expect(screen.getByText('The request from Contact 1 is now contacted.')).toBeTruthy()
    expect(mocks.command).toHaveBeenCalledWith('/api/v1/admin/demo-requests/d-1/status',
      { status: 'contacted', reason: 'Called back and booked a demo' }, { version: 1 })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'new' } })
    await waitFor(() => expect(screen.queryByText('The request from Contact 1 is now contacted.')).toBeNull())
  })

  it('lists event delivery failures as the dispatcher reports them', async () => {
    mocks.services.mockResolvedValue({ checkedAt: '2026-10-08T12:00:00.000Z', services: [] })
    mocks.events.mockResolvedValue({ state: 'degraded', code: null, metrics: { pending: 3 }, failures: [{ eventId: 'evt-1',
      eventType: 'patient.registered', producer: 'identity-api', attemptCount: 5, errorCode: 'TARGET_TIMEOUT',
      errorSummary: 'Timed out after 10s', failedAt: '2026-10-08T11:59:00.000Z' }] })
    open('/admin/operations', <OperationsPage />)
    expect(await screen.findByText('patient.registered')).toBeTruthy()
    expect(screen.getByText('Timed out after 10s')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
  })

  it('pages identity reviews with the status from the link', async () => {
    mocks.reviews.mockResolvedValue({ items: [], page: 3, pageSize: 25, total: 0 })
    open('/admin/reviews?status=rejected&page=3', <ReviewsPage />)
    await waitFor(() => expect(mocks.reviews).toHaveBeenCalledWith({ page: 3, status: 'rejected' }, expect.anything()))
  })
})
