import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminActor } from '../api'

/**
 * Support's tools for orders between facilities through the console's own client (Novu, P4c, SPEC-FINAL §10.4, §13.6):
 * "Orders between facilities" finds an order by its reference or the patient's Health ID and closes it (If-Match with
 * its version, a reason, no Idempotency-Key); a facility's page shows its orders with other facilities on demand and
 * lists it for orders, or stops listing it. Only a Novu build links or routes them.
 */
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })
const SUPPORT = ['platform.admin.access', 'platform.principal.read', 'platform.facility.read', 'platform.facility.manage',
  'platform.facility.unlock']
const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const FOUND = { routeId: ROUTE_ID, reference: '9C1B2D3E', kind: 'lab_request', version: 2, effectiveState: 'accepted',
  orderingFacilityId: '11111111-1111-4111-8111-111111111111', orderingFacilityName: 'General Hospital',
  receivingFacilityId: FACILITY_ID, receivingFacilityName: 'Yaba Diagnostics', createdAt: '2026-10-20T09:00:00.000Z',
  acceptedAt: '2026-10-21T10:00:00.000Z', endedAt: null, endedKind: null }
const SUMMARY = { facilityId: FACILITY_ID, listed: { value: true, byDefault: true, reason: null, setAt: null },
  receivedAcceptedLifetime: 3, receivedPatientsLifetime: 2,
  counterparts: [{ direction: 'received', facilityId: '11111111-1111-4111-8111-111111111111', facilityName: 'General Hospital',
    last30Days: { sent: 1, accepted: 2 } }] }

interface Call { path: string; search: string; method: string; headers: Headers; body: unknown }

function serve(permissions: string[], overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const target = new URL(url)
    calls.push({ path: target.pathname, search: target.search, method: String(init.method), headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null })
    const override = overrides[`${String(init.method)} ${target.pathname}`]
    if (override) return override()
    if (target.pathname === '/api/v1/admin/session') return json({ actor: actor(permissions), expiresAt: '2026-10-24T20:00:00Z' })
    if (target.pathname === '/api/v1/admin/order-routes') return json({ items: [FOUND] })
    if (String(init.method) === 'POST' && target.pathname === '/api/v1/admin/order-routes/search') return json({ items: [FOUND] })
    if (target.pathname === `/api/v1/admin/order-routes/${ROUTE_ID}/close`) return json({ routeId: ROUTE_ID, version: 3, effectiveState: 'cancelled' })
    if (target.pathname === `/api/v1/admin/facilities/${FACILITY_ID}`) return json({ id: FACILITY_ID, organizationId: 'org-1',
      organizationName: 'Yaba Diagnostics Limited', name: 'Yaba Diagnostics', code: 'YD', status: 'verified', statusReason: null,
      statusChangedAt: null, createdAt: '2026-10-01T09:00:00.000Z', membershipCount: 3, version: 4 })
    if (target.pathname === `/api/v1/admin/facilities/${FACILITY_ID}/order-route-summary`) return json(SUMMARY)
    if (target.pathname === `/api/v1/admin/facilities/${FACILITY_ID}/order-destination`) return json({ facilityId: FACILITY_ID, listed: false, setAt: '2026-10-25T09:00:00.000Z' })
    if (target.pathname === `/api/v1/admin/facilities/${FACILITY_ID}/assisted-registration`) return json({ facilityId: FACILITY_ID,
      designated: false, status: null, addressLine: null, town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null })
    if (target.pathname === '/api/v1/admin/audit/events') return json({ items: [], nextBeforeSequenceId: null })
    return json({ status: 404, code: 'NOT_FOUND', detail: `Cannot ${String(init.method)} ${target.pathname}` }, 404)
  }))
  return calls
}

async function openAt(path: string, state?: unknown) {
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={[state === undefined ? path : { pathname: path, state }]}><Routes>
    <Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
}

const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

async function findByReference() {
  fireEvent.change(await screen.findByLabelText('Order reference (8 characters) or patient Health ID'), { target: { value: '9C1B2D3E' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find' }))
  return (await screen.findByText('9C1B2D3E')).closest('tr')!
}

beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'); vi.resetModules()
  document.cookie = 'hid_access_csrf=csrf-token; path=/'
})
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('orders between facilities in the Novu console', () => {
  it('is linked under Organizations for the lookup’s permission, and never on main', async () => {
    const { visibleNavigation, NAVIGATION_ITEMS, isServed } = await import('../navigation')
    const organizations = (permissions: string[]) => visibleNavigation(actor(permissions))
      .find(section => section.title === 'Organizations')?.items.map(item => item.title) ?? []
    expect(organizations(['platform.admin.access', 'platform.principal.read', 'platform.facility.read'])).toEqual(['Facilities',
      'Orders between facilities', 'Wrong-patient reports'])
    expect(organizations(['platform.admin.access', 'platform.facility.read'])).toEqual(['Facilities', 'Wrong-patient reports'])
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    expect(isServed(NAVIGATION_ITEMS.find(item => item.path === '/admin/order-routes')!)).toBe(false)
  })

  it('finds an order by its reference, and closes it with its version and a reason', async () => {
    const calls = serve(SUPPORT)
    await openAt('/admin/order-routes')
    fireEvent.change(await screen.findByLabelText('Order reference (8 characters) or patient Health ID'), { target: { value: 'zz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Enter the 8-character order reference/)
    fireEvent.change(screen.getByLabelText('Order reference (8 characters) or patient Health ID'), { target: { value: '9c1b2d3e' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    expect(within(row).getByText('Accepted')).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'General Hospital' })).toBeTruthy()
    expect(calls.filter(call => call.path === '/api/v1/admin/order-routes').map(call => [call.method, call.search]))
      .toEqual([['GET', '?reference=9C1B2D3E']])

    fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
    fireEvent.change(within(row).getByLabelText('Reason for closing'), { target: { value: 'The patient says they never agreed' } })
    const close = within(row).getByRole('button', { name: 'Close order' }) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    fireEvent.click(within(row).getByLabelText(/I understand that closing can’t be undone/))
    fireEvent.click(close)
    expect(await screen.findByText('Closed order 9C1B2D3E. Access has ended at both facilities, and both, and the patient, are told.')).toBeTruthy()
    const sent = calls.find(call => call.path.endsWith('/close'))!
    expect(sent).toMatchObject({ method: 'POST', body: { reason: 'The patient says they never agreed' } })
    expect(sent.headers.get('If-Match')).toBe('"2"')
    expect(sent.headers.get('Idempotency-Key')).toBeNull()
  })

  it('finds a patient’s orders by Health ID once, and after a version conflict finds that order again by its reference', async () => {
    const calls = serve(SUPPORT, { [`POST /api/v1/admin/order-routes/${ROUTE_ID}/close`]: () =>
      json({ status: 409, code: 'VERSION_CONFLICT', detail: 'Changed' }, 409) })
    await openAt('/admin/order-routes')
    fireEvent.change(await screen.findByLabelText('Order reference (8 characters) or patient Health ID'), { target: { value: 'hid-7kq2m9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
    fireEvent.change(within(row).getByLabelText('Reason for closing'), { target: { value: 'Sent to the wrong laboratory' } })
    fireEvent.click(within(row).getByLabelText(/I understand/))
    fireEvent.click(within(row).getByRole('button', { name: 'Close order' }))
    // The Health ID goes in the body of the search's POST, never in an address: once per Find, never again to refresh
    // a row, which is found again by its reference.
    await waitFor(() => expect(calls.filter(call => call.path.startsWith('/api/v1/admin/order-routes') && !call.path.endsWith('/close'))
      .map(call => [call.method, call.path, call.search])).toEqual([
      ['POST', '/api/v1/admin/order-routes/search', ''], ['GET', '/api/v1/admin/order-routes', '?reference=9C1B2D3E']]))
    const search = calls.find(call => call.path === '/api/v1/admin/order-routes/search')!
    expect(search.body).toEqual({ healthId: 'HID-7KQ2M9' })
    expect(search.headers.get('x-csrf-token')).toBe('csrf-token')
    expect(calls.some(call => `${call.path}${call.search}`.includes('HID-'))).toBe(false)
    expect(await screen.findByText('9C1B2D3E')).toBeTruthy()
  })

  it('says a reference finds just that order, without claiming a Health ID goes in an address', async () => {
    serve(SUPPORT)
    await openAt('/admin/order-routes')
    expect(await screen.findByText(/Use the reference when you have it: it finds just that order, where a\s+Health ID finds all of the patient’s\./))
      .toBeTruthy()
    expect(document.body.textContent).not.toMatch(/address|server logs/)
  })

  it.each([
    ['support closed it', { endedAt: '2026-10-23T09:00:00.000Z', endedKind: 'support' }, /^Access ended /],
    ['45 days have passed since it was accepted', { acceptedAt: ago(46) }, /^Access ended$/],
  ])('offers no Close on a completed order whose access has ended: %s', async (_case, fields, says) => {
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [{ ...FOUND, effectiveState: 'completed', ...fields }] }) })
    await openAt('/admin/order-routes')
    const row = await findByReference()
    expect(within(row).getByText('Result or dispensing returned')).toBeTruthy()
    expect(within(row).queryByText('Close', { selector: 'summary' })).toBeNull()
    expect(within(row).getByText(says)).toBeTruthy()
  })

  it('offers Close on a completed order that may still be open, and once Identity says its access ended, offers it no more', async () => {
    const completed = { ...FOUND, effectiveState: 'completed', acceptedAt: ago(20) }
    const calls = serve(SUPPORT, {
      'GET /api/v1/admin/order-routes': () => json({ items: [completed] }),
      [`POST /api/v1/admin/order-routes/${ROUTE_ID}/close`]: () => json({ status: 409, code: 'ORDER_ROUTE_ALREADY_CLOSED', detail: 'Closed' }, 409),
    })
    await openAt('/admin/order-routes')
    let row = await findByReference()
    fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
    expect(within(row).getByText(/if it has already ended, Health ID says so and nothing changes/)).toBeTruthy()
    fireEvent.change(within(row).getByLabelText('Reason for closing'), { target: { value: 'The patient asked us to end access' } })
    fireEvent.click(within(row).getByLabelText(/I understand/))
    fireEvent.click(within(row).getByRole('button', { name: 'Close order' }))
    expect(await screen.findByText('Order 9C1B2D3E: its access has already ended, so there is nothing to close.')).toBeTruthy()
    await waitFor(() => expect(calls.filter(call => call.path === '/api/v1/admin/order-routes')).toHaveLength(2))
    row = screen.getByText('9C1B2D3E').closest('tr')!
    expect(within(row).queryByText('Close', { selector: 'summary' })).toBeNull()
    expect(within(row).getByText('Access ended')).toBeTruthy()
    expect(calls.filter(call => call.path.endsWith('/close'))).toHaveLength(1)
  })

  it.each([
    ['wrong_patient', 'cancelled', 'the receiving facility accepted it for the wrong person'],
    ['support', 'cancelled', 'closed by support'],
    ['order_changed', 'cancelled', 'the order changed'],
    ['entered_in_error', 'withdrawn', 'the order was marked entered in error'],
    ['receiving_released', 'cancelled', 'the receiving facility was released'],
    ['orderer', 'withdrawn', 'withdrawn by the clinician'],
    ['patient', 'withdrawn', 'stopped by the patient'],
    ['order_in_work', 'withdrawn', 'already in work at the ordering facility'],
    ['not_accepted', 'expired', 'not accepted in time'],
  ])('says how an order ended in words, never its code (%s)', async (endedKind, effectiveState, says) => {
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [{ ...FOUND, effectiveState, endedKind,
      endedAt: '2026-10-23T09:00:00.000Z' }] }) })
    await openAt('/admin/order-routes')
    const row = await findByReference()
    expect(within(row).getByText(/^Ended /).textContent).toMatch(new RegExp(` \\(${says}\\)$`))
    expect(row.textContent).not.toMatch(/_/)
  })

  const LATE_CASE = 'If a patient or clinician tells you a result or dispensing went to the wrong person and the facility can no '
    + 'longer end the order, ask the ordering clinician to record in the patient’s notes that it was not theirs, and refer it to '
    + 'the data protection officer the same day.'
  const ASK_THEM_FIRST = 'If a laboratory or pharmacy accepted it for the wrong person, ask them to end it from their work list '
    + 'instead: only they can withdraw a result or dispensing they sent back. If you close it first, they can’t.'

  it('tells support, where it closes an order, to have a facility that served the wrong person end it first (item 3, C1, C7)', async () => {
    // An Identity with the wrong-patient report (hid-system 0088) says so in the lookup's answer.
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [FOUND], wrongPatientReports: true }) })
    await openAt('/admin/order-routes')
    const row = await findByReference()
    fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
    expect(within(row).getByText(ASK_THEM_FIRST)).toBeTruthy()
    expect(within(row).getByText(LATE_CASE)).toBeTruthy()
    // The sidebar and the narrow-screen navigation both list it.
    expect(screen.getAllByRole('link', { name: 'Wrong-patient reports' })).toHaveLength(2)
  })

  it('keeps Close the remedy on an Identity without the wrong-patient report, and stops listing its page (D15)', async () => {
    // Today's Identity: no laboratory or pharmacy can end an accepted order, so support is not sent to one, and closing
    // stays the way to end its access.
    serve(SUPPORT)
    await openAt('/admin/order-routes')
    expect(await screen.findAllByRole('link', { name: 'Wrong-patient reports' })).toHaveLength(2)
    const row = await findByReference()
    fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
    expect(within(row).queryByText(ASK_THEM_FIRST)).toBeNull()
    expect(within(row).queryByText(/end it from their work list/)).toBeNull()
    expect(within(row).getByText(LATE_CASE)).toBeTruthy()
    await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Wrong-patient reports' })).toHaveLength(0))
  })

  it('offers no Close without platform.facility.manage', async () => {
    serve(['platform.admin.access', 'platform.principal.read'])
    await openAt('/admin/order-routes')
    fireEvent.change(await screen.findByLabelText('Order reference (8 characters) or patient Health ID'), { target: { value: '9C1B2D3E' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    const row = (await screen.findByText('9C1B2D3E')).closest('tr')!
    expect(within(row).queryByText('Close', { selector: 'summary' })).toBeNull()
    expect(within(row).getByText('Closing needs platform.facility.manage')).toBeTruthy()
  })

  it('shows a facility’s orders with other facilities only when asked, and stops listing it with a reason', async () => {
    const calls = serve(SUPPORT)
    await openAt(`/admin/facilities/${FACILITY_ID}`)
    const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
    expect(calls.some(call => call.path.endsWith('/order-route-summary'))).toBe(false)
    fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
    // Opened directly, the console does not know the facility's type: it says what the listing means for each.
    expect(await within(panel).findByText('Listed by default: clinicians at other facilities find it if it is a laboratory or '
      + 'pharmacy. A hospital or clinic is never found, listed or not.')).toBeTruthy()
    expect(within(panel).getByText('Yaba Diagnostics accepted 3 orders from other facilities, for 2 patients.')).toBeTruthy()
    const row = within(panel).getByRole('link', { name: 'General Hospital' }).closest('tr')!
    expect(within(row).getByText('Received from')).toBeTruthy()
    expect(within(row).getByText('1 waiting to be accepted, 2 accepted')).toBeTruthy()

    fireEvent.click(within(panel).getByText('Stop listing it for orders', { selector: 'summary' }))
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'The laboratory asked to stop for now' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop listing' }))
    expect(await within(panel).findByText('Yaba Diagnostics is no longer listed. Orders it has already accepted are not affected.')).toBeTruthy()
    expect(calls.find(call => call.path.endsWith('/order-destination'))).toMatchObject({ method: 'POST',
      body: { listed: false, reason: 'The laboratory asked to stop for now' } })
  })

  it('says what a facility without a laboratory or pharmacy product can’t be listed for', async () => {
    serve(SUPPORT, { [`POST /api/v1/admin/facilities/${FACILITY_ID}/order-destination`]: () =>
      json({ status: 404, code: 'ADMIN_FACILITY_NOT_FOUND', detail: 'Facility was not found' }, 404) })
    await openAt(`/admin/facilities/${FACILITY_ID}`)
    const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
    fireEvent.click(await within(panel).findByText('Stop listing it for orders', { selector: 'summary' }))
    fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'Checking the listing works' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop listing' }))
    expect(await within(panel).findByText('Only a facility that signed up, or was approved, as a laboratory or pharmacy can be listed for orders from other facilities.')).toBeTruthy()
  })

  it.each([
    ['a laboratory support has not checked yet', { organizationType: 'laboratory', reviewedAt: null, verificationMethod: null },
      { value: false, byDefault: true }, 'Not listed until Health ID support has checked it: marking it reviewed lists it, unless the '
        + 'check is recorded as “Other”.', true],
    ['a laboratory support checked as Other', { organizationType: 'laboratory', reviewedAt: '2026-10-20T09:00:00.000Z',
      verificationMethod: 'other' }, { value: false, byDefault: true },
    'Not listed for orders from other facilities, by default: Health ID support recorded its check as “Other”.', true],
    ['a reviewed pharmacy', { organizationType: 'pharmacy', reviewedAt: '2026-10-20T09:00:00.000Z', verificationMethod: 'in_person' },
      { value: true, byDefault: true }, 'Listed for orders from other facilities, by default.', true],
    ['a hospital', { organizationType: 'hospital', reviewedAt: '2026-10-20T09:00:00.000Z', verificationMethod: 'in_person' },
      { value: true, byDefault: true }, 'Only laboratories and pharmacies receive orders from other facilities. Yaba Diagnostics '
        + 'signed up as a hospital, so clinicians at other facilities never find it.', false],
  ])('opened from New facility sign-ups, says the listing of %s as it is', async (_case, signUp, listed, says, listable) => {
    serve(SUPPORT, { [`GET /api/v1/admin/facilities/${FACILITY_ID}/order-route-summary`]: () =>
      json({ ...SUMMARY, listed: { ...SUMMARY.listed, ...listed } }) })
    await openAt(`/admin/facilities/${FACILITY_ID}`, { selfServiceFacility: { facilityId: FACILITY_ID, releasedAt: null, ...signUp } })
    const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
    expect(await within(panel).findByText(says)).toBeTruthy()
    expect(within(panel).queryByText(/^(Stop listing it|List it) for orders$/, { selector: 'summary' }) !== null).toBe(listable)
    if (!/“Other”\.$/.test(says)) expect(panel.textContent).not.toMatch(/recorded its check as “Other”/)
  })

  it('ignores what a link says of another facility', async () => {
    serve(SUPPORT)
    await openAt(`/admin/facilities/${FACILITY_ID}`, { selfServiceFacility: { facilityId: '22222222-2222-4222-8222-222222222222',
      organizationType: 'hospital', reviewedAt: null, verificationMethod: null, releasedAt: null } })
    const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
    expect(await within(panel).findByText(/^Listed by default: clinicians at other facilities find it if/)).toBeTruthy()
    expect(within(panel).getByText('Stop listing it for orders', { selector: 'summary' })).toBeTruthy()
  })

  it('from New facility sign-ups, the facility page knows a laboratory support has not checked yet is not listed for that reason', async () => {
    serve([...SUPPORT, 'platform.identity-review.read'], {
      'GET /api/v1/admin/self-service-facilities': () => json({ items: [{ applicationId: '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a',
        version: 3, organizationId: 'org-1', organizationName: 'YABA DIAGNOSTICS LIMITED', facilityId: FACILITY_ID,
        facilityName: 'Yaba Diagnostics', facilityLifecycleStatus: 'verified', productCode: 'laboratory', organizationType: 'laboratory',
        cacHint: 'RC••••56', administratorName: 'Bola Adewale', administratorEmail: 'bola@yaba.example', administratorAccountId: 'account-1',
        administratorAccountStatus: 'active', activatedAt: '2026-10-24T09:00:00.000Z', reviewedAt: null, reviewedByAccountId: null,
        reviewNote: null, verificationMethod: null }] }),
      [`GET /api/v1/admin/facilities/${FACILITY_ID}/order-route-summary`]: () =>
        json({ ...SUMMARY, listed: { value: false, byDefault: true, reason: null, setAt: null } }),
    })
    await openAt('/admin/self-service-facilities')
    fireEvent.click(await screen.findByRole('link', { name: 'facility page' }))
    const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
    fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
    expect(await within(panel).findByText('Not listed until Health ID support has checked it: marking it reviewed lists it, unless '
      + 'the check is recorded as “Other”.')).toBeTruthy()
    expect(panel.textContent).not.toMatch(/recorded its check as “Other”/)
  })

  /**
   * Item 4 (hid-system 0089): C21 says when the receiving facility's access ends (`accessEndsAt`) and whether Close would
   * act at the time of the Find (`closable`). The console offers Close exactly then, whatever the browser's clock says
   * (CC3), names the day access ended (CC4), and keeps the ALREADY_CLOSED path for a page left open.
   */
  describe('Close, by what Identity says (item 4)', () => {
    const completed = (fields: Record<string, unknown>) => ({ ...FOUND, effectiveState: 'completed', ...fields })
    async function said(value: string) { const { date } = await import('../ui'); return date(value) }

    it('offers no Close on an order Identity says can’t be closed, and says when its access ended', async () => {
      const ended = ago(3)
      serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [completed({ acceptedAt: ago(20), accessEndsAt: ended,
        closable: false })] }) })
      await openAt('/admin/order-routes')
      const row = await findByReference()
      expect(within(row).queryByText('Close', { selector: 'summary' })).toBeNull()
      expect(within(row).getByText(`Access ended ${await said(ended)}`)).toBeTruthy()
    })

    it('names the day access ended, not the day a release came after it (CC4)', async () => {
      const accepted = ago(50)
      const accessEnded = new Date(Date.parse(accepted) + 14 * DAY).toISOString()
      const released = new Date(Date.parse(accepted) + 40 * DAY).toISOString()
      serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [completed({ acceptedAt: accepted, endedAt: released,
        endedKind: 'receiving_released', accessEndsAt: accessEnded, closable: false })] }) })
      await openAt('/admin/order-routes')
      const row = await findByReference()
      expect(within(row).getByText(`Access ended ${await said(accessEnded)}`)).toBeTruthy()
      expect(within(row).queryByText(`Access ended ${await said(released)}`)).toBeNull()
    })

    it('offers Close on a completed order Identity says can be closed, with the day its access ends', async () => {
      const ends = new Date(Date.now() + 5 * DAY).toISOString()
      serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [completed({ acceptedAt: ago(12), accessEndsAt: ends,
        closable: true })] }) })
      await openAt('/admin/order-routes')
      const row = await findByReference()
      fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
      expect(within(row).getByText(new RegExp(`Its access ends on ${(await said(ends)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `
        + 'closing ends it now\\.'))).toBeTruthy()
      expect(within(row).queryByText(/if it has already ended, Health ID says so/)).toBeNull()
    })

    it('trusts Identity over the browser’s clock: Close is offered a day after the access end it named, and past 45 days (CC3)', async () => {
      serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [completed({ acceptedAt: ago(46), accessEndsAt: ago(1),
        closable: true })] }) })
      await openAt('/admin/order-routes')
      const row = await findByReference()
      expect(within(row).getByText('Close', { selector: 'summary' })).toBeTruthy()
    })

    it.each([
      ['waiting to be accepted', 'sent', true, true],
      ['accepted', 'accepted', true, true],
      ['accepted, past its time for work', 'accepted', false, false],
    ])('on an order %s, offers Close only as Identity says', async (_case, effectiveState, closable, offered) => {
      serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [{ ...FOUND, effectiveState, accessEndsAt: null,
        closable }] }) })
      await openAt('/admin/order-routes')
      const row = await findByReference()
      expect(within(row).queryByText('Close', { selector: 'summary' }) !== null).toBe(offered)
      if (!offered) expect(within(row).getByText('Access ended')).toBeTruthy()
    })

    it('ends with one close when access ended between the Find and the Close, and the order found again says so', async () => {
      const ended = ago(0.01)
      let finds = 0
      const calls = serve(SUPPORT, {
        'GET /api/v1/admin/order-routes': () => json({ items: [finds++ === 0
          ? completed({ acceptedAt: ago(14), accessEndsAt: new Date(Date.now() + 60_000).toISOString(), closable: true })
          : completed({ acceptedAt: ago(14), accessEndsAt: ended, closable: false })] }),
        [`POST /api/v1/admin/order-routes/${ROUTE_ID}/close`]: () => json({ status: 409, code: 'ORDER_ROUTE_ALREADY_CLOSED', detail: 'Closed' }, 409),
      })
      await openAt('/admin/order-routes')
      let row = await findByReference()
      fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
      fireEvent.change(within(row).getByLabelText('Reason for closing'), { target: { value: 'The patient asked us to end access' } })
      fireEvent.click(within(row).getByLabelText(/I understand/))
      fireEvent.click(within(row).getByRole('button', { name: 'Close order' }))
      expect(await screen.findByText('Order 9C1B2D3E: its access has already ended, so there is nothing to close.')).toBeTruthy()
      await waitFor(() => expect(calls.filter(call => call.path === '/api/v1/admin/order-routes')).toHaveLength(2))
      row = screen.getByText('9C1B2D3E').closest('tr')!
      await waitFor(() => expect(within(row).queryByText('Close', { selector: 'summary' })).toBeNull())
      expect(within(row).getByText(`Access ended ${await said(ended)}`)).toBeTruthy()
      expect(calls.filter(call => call.path.endsWith('/close'))).toHaveLength(1)
    })

    it('reads an access end that is not a time as unknown', async () => {
      serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [completed({ acceptedAt: ago(20), endedAt: null,
        accessEndsAt: 'soon', closable: false })] }) })
      await openAt('/admin/order-routes')
      const row = await findByReference()
      expect(within(row).getByText('Access ended')).toBeTruthy()
    })
  })

  /**
   * Item 4 (hid-system 0089): the summary says what the facility is as a destination (`destination { receivingTypes,
   * review }`). The panel then says the listing exactly, however it was opened, and offers the form only where listing can
   * change whether the facility is found: a laboratory or pharmacy product, and a pending, reviewed or support-approved
   * sign-up (CC7). Without it, the link's sign-up and the hedge, as before.
   */
  describe('a facility’s listing, by what the summary says it is (item 4)', () => {
    async function panelWith(summary: Record<string, unknown>, state?: unknown) {
      serve(SUPPORT, { [`GET /api/v1/admin/facilities/${FACILITY_ID}/order-route-summary`]: () => json({ ...SUMMARY, ...summary }) })
      await openAt(`/admin/facilities/${FACILITY_ID}`, state)
      const panel = (await screen.findByRole('heading', { name: 'Orders with other facilities' })).closest('section')!
      fireEvent.click(within(panel).getByRole('button', { name: 'Show orders with other facilities' }))
      await within(panel).findByText(/accepted 3 orders from other facilities/)
      return panel
    }
    const form = (panel: HTMLElement) => within(panel).queryByText(/^(Stop listing it|List it) for orders$/, { selector: 'summary' })
    const byDefault = (value: boolean) => ({ listed: { value, byDefault: true, reason: null, setAt: null } })

    it.each([
      ['a governed hospital', { receivingTypes: [], review: 'governed' }, true, 'Only laboratories and pharmacies receive orders from '
        + 'other facilities. Yaba Diagnostics has no laboratory or pharmacy service on Health ID, so clinicians at other facilities '
        + 'don’t find it.', false],
      ['a governed laboratory', { receivingTypes: ['laboratory'], review: 'governed' }, true,
        'Listed for orders from other facilities, by default (approved by Health ID support).', true],
      ['a released sign-up', { receivingTypes: [], review: 'released' }, true,
        'Yaba Diagnostics’s sign-up was released, so clinicians at other facilities no longer find it.', false],
      ['a laboratory not checked yet', { receivingTypes: ['laboratory'], review: 'pending' }, false,
        'Not listed until Health ID support has checked it: marking it reviewed lists it, unless the check is recorded as “Other”.', true],
      ['a laboratory checked as Other', { receivingTypes: ['laboratory'], review: 'reviewed' }, false,
        'Not listed for orders from other facilities, by default: Health ID support recorded its check as “Other”.', true],
      ['a checked pharmacy', { receivingTypes: ['pharmacy'], review: 'reviewed' }, true,
        'Listed for orders from other facilities, by default.', true],
      ['a legacy facility with a laboratory product (CC7a)', { receivingTypes: ['laboratory'], review: 'legacy' }, true,
        'Yaba Diagnostics has no reviewed or support-approved sign-up on Health ID, so clinicians at other facilities don’t find it, '
        + 'listed or not.', false],
    ])('opened directly, says the listing of %s exactly', async (_case, destination, value, says, listable) => {
      const panel = await panelWith({ ...byDefault(value), destination })
      expect(within(panel).getByText(says)).toBeTruthy()
      expect(form(panel) !== null).toBe(listable)
      expect(panel.textContent).not.toMatch(/if it is a laboratory or pharmacy/)
    })

    it('adds what support set itself where listing changes nothing (CC7b)', async () => {
      const setAt = '2026-10-20T09:00:00.000Z'
      const panel = await panelWith({ listed: { value: false, byDefault: false, reason: 'Asked to stop', setAt },
        destination: { receivingTypes: [], review: 'governed' } })
      const { date } = await import('../ui')
      expect(within(panel).getByText('Only laboratories and pharmacies receive orders from other facilities. Yaba Diagnostics has no '
        + `laboratory or pharmacy service on Health ID, so clinicians at other facilities don’t find it. Health ID support stopped `
        + `listing it on ${date(setAt)}: Asked to stop`)).toBeTruthy()
      expect(form(panel)).toBeNull()
    })

    it('says support’s own setting with the form where listing can change it', async () => {
      const setAt = '2026-10-20T09:00:00.000Z'
      const panel = await panelWith({ listed: { value: true, byDefault: false, reason: null, setAt },
        destination: { receivingTypes: ['laboratory', 'pharmacy'], review: 'reviewed' } })
      const { date } = await import('../ui')
      expect(within(panel).getByText(`Listed for orders from other facilities by Health ID support on ${date(setAt)}.`)).toBeTruthy()
      expect(form(panel)).toBeTruthy()
    })

    it('goes by the summary over the link’s sign-up, and keeps the link’s type in its words', async () => {
      const link = { selfServiceFacility: { facilityId: FACILITY_ID, organizationType: 'hospital', reviewedAt: null,
        verificationMethod: null, releasedAt: null } }
      let panel = await panelWith({ ...byDefault(true), destination: { receivingTypes: ['laboratory'], review: 'reviewed' } }, link)
      expect(within(panel).getByText('Listed for orders from other facilities, by default.')).toBeTruthy()
      expect(form(panel)).toBeTruthy()
      cleanup(); vi.unstubAllGlobals(); vi.resetModules()
      panel = await panelWith({ ...byDefault(true), destination: { receivingTypes: [], review: 'reviewed' } }, link)
      expect(within(panel).getByText('Only laboratories and pharmacies receive orders from other facilities. Yaba Diagnostics signed '
        + 'up as a hospital and has no laboratory or pharmacy service on Health ID, so clinicians at other facilities don’t find it.'))
        .toBeTruthy()
      expect(form(panel)).toBeNull()
    })

    it.each([
      ['an unknown review', { receivingTypes: ['laboratory'], review: 'approved' }],
      ['types that are not a list', { receivingTypes: 'laboratory', review: 'reviewed' }],
      ['types that are not words', { receivingTypes: [1], review: 'reviewed' }],
      ['no destination at all', null],
    ])('falls back to the hedge for %s', async (_case, destination) => {
      const panel = await panelWith({ ...byDefault(true), ...(destination ? { destination } : {}) })
      expect(within(panel).getByText('Listed by default: clinicians at other facilities find it if it is a laboratory or pharmacy. '
        + 'A hospital or clinic is never found, listed or not.')).toBeTruthy()
      expect(form(panel)).toBeTruthy()
    })
  })
})


/**
 * D17 (hid-system 0090; SPEC-FINAL §9.4, CT10): Find's rows say whether the receiving facility may still withdraw what it
 * recorded, until when, with the reference to give it, or, past that date, D17-3's stop-gap; a report made after the order
 * had ended shows in its State; and Close no longer says closing stops the facility withdrawing it. All from Identity's
 * answer: without its fields and `lateCorrection`, every word stays as it was.
 */
describe('the late correction in support’s Find (D17)', () => {
  const LATE_CASE_SERVED = 'If a patient or clinician tells you a result or dispensing went to the wrong person after the order '
    + 'ended, give the order’s reference to the laboratory or pharmacy itself, on a phone number Health ID holds for it, and tell '
    + 'it what was reported, not that it is so. It can use “Correct an order that has ended” on its Laboratory or Pharmacy page '
    + 'until 180 days after it accepted the order; Find shows the date. After that, or if the facility is no longer on Health '
    + 'ID, ask the ordering clinician to record in the patient’s notes that it was not theirs, without repeating its value, and '
    + 'refer it to the data protection officer the same day.'
  async function said(value: string) { const { date } = await import('../ui'); return date(value) }
  const closed = (fields: Record<string, unknown>) => ({ ...FOUND, effectiveState: 'completed', endedAt: '2026-10-23T09:00:00.000Z',
    endedKind: 'support', accessEndsAt: '2026-10-23T09:00:00.000Z', closable: false, ...fields })

  it('says the facility can still withdraw it until its date, with the reference, on an order whose access ended', async () => {
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [closed({ correction: 'correctable',
      correctableUntil: '2027-04-19T10:00:00.000Z', wrongPatient: null })], wrongPatientReports: true, lateCorrection: true }) })
    await openAt('/admin/order-routes')
    const row = await findByReference()
    expect(within(row).getByText(`Yaba Diagnostics can still withdraw what it recorded on it, until ${await said('2027-04-19T10:00:00.000Z')}: `
      + 'if it accepted this for the wrong person, give it reference 9C1B2D3E.')).toBeTruthy()
    expect(within(row).getByText(/^Access ended /)).toBeTruthy()
  })

  it('says, past its date, the stop-gap only if someone says it was the wrong person, and only where something came back; '
    + 'and a late report in the State column', async () => {
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [
      closed({ correction: 'too_late', correctableUntil: '2026-04-19T10:00:00.000Z', wrongPatient: null }),
      closed({ routeId: 'aa000000-0000-4000-8000-000000000002', reference: '5E6F7A8B', version: 5, correction: 'reported', correctableUntil: null,
        wrongPatient: { reportedAt: '2026-11-02T09:00:00.000Z', late: true } }),
      closed({ routeId: 'aa000000-0000-4000-8000-000000000003', reference: '6F7A8B9C', version: 4, effectiveState: 'cancelled',
        endedKind: 'order_changed', correction: 'too_late', correctableUntil: '2026-04-19T10:00:00.000Z', wrongPatient: null }),
    ], lateCorrection: true }) })
    await openAt('/admin/order-routes')
    await findByReference()
    const [tooLate, reported, cancelled] = [...document.querySelectorAll('tbody tr')] as HTMLElement[]
    expect(within(tooLate!).getByText('If a patient or clinician says Yaba Diagnostics accepted this for the wrong person, it can no '
      + `longer withdraw it (past ${await said('2026-04-19T10:00:00.000Z')}): ask the ordering clinician to record in the patient’s `
      + 'notes that it was not theirs, without repeating its value, and refer it to the data protection officer the same day.')).toBeTruthy()
    expect(within(reported!).getByText(`Reported ${await said('2026-11-02T09:00:00.000Z')}: the receiving facility accepted it for the `
      + 'wrong person')).toBeTruthy()
    expect(reported!.textContent).not.toMatch(/can still withdraw|can no longer withdraw/)
    // Nothing came back on a cancelled order: there is no value to note, and nothing to refer.
    expect(within(cancelled!).getByText('Closed')).toBeTruthy()
    expect(cancelled!.textContent).not.toMatch(/withdraw|data protection officer/)
  })

  it('says, once the receiving facility was released from Health ID, that it can no longer withdraw it, with the stop-gap '
    + 'where something came back (D17-3)', async () => {
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [
      closed({ correction: 'receiver_released', correctableUntil: null, wrongPatient: null }),
      closed({ routeId: 'aa000000-0000-4000-8000-000000000002', reference: '5E6F7A8B', version: 5, endedKind: 'receiving_released',
        correction: 'correctable', correctableUntil: '2027-04-19T10:00:00.000Z', wrongPatient: null }),
      closed({ routeId: 'aa000000-0000-4000-8000-000000000003', reference: '6F7A8B9C', version: 4, effectiveState: 'cancelled',
        correction: 'receiver_released', correctableUntil: null, wrongPatient: null }),
    ], lateCorrection: true }) })
    await openAt('/admin/order-routes')
    await findByReference()
    const [released, releasedBefore, cancelled] = [...document.querySelectorAll('tbody tr')] as HTMLElement[]
    const words = 'Yaba Diagnostics is no longer on Health ID, so it can no longer withdraw it. If a patient or clinician says it '
      + 'accepted this for the wrong person, ask the ordering clinician to record in the patient’s notes that it was not theirs, '
      + 'without repeating its value, and refer it to the data protection officer the same day.'
    expect(within(released!).getByText(words)).toBeTruthy()
    // An answer that still says correctable, for an order the release ended, gets the same words, never "can still withdraw".
    expect(within(releasedBefore!).getByText(words)).toBeTruthy()
    expect(releasedBefore!.textContent).not.toMatch(/can still withdraw/)
    expect(cancelled!.textContent).not.toMatch(/withdraw|data protection officer/)
  })

  it('says in Close that closing does not stop the facility withdrawing it later, until its date, with the new case note', async () => {
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [{ ...FOUND, correction: 'open',
      correctableUntil: '2027-04-19T10:00:00.000Z', wrongPatient: null }], wrongPatientReports: true, lateCorrection: true }) })
    await openAt('/admin/order-routes')
    const row = await findByReference()
    fireEvent.click(within(row).getByText('Close', { selector: 'summary' }))
    expect(within(row).getByText('If a laboratory or pharmacy accepted it for the wrong person, ask them to end it from their work '
      + `list instead. Closing it does not stop them withdrawing it later, until ${await said('2027-04-19T10:00:00.000Z')}.`)).toBeTruthy()
    expect(within(row).getByText(LATE_CASE_SERVED)).toBeTruthy()
    expect(within(row).queryByText(/If you close it first, they can’t/)).toBeNull()
  })

  it('keeps every word as it was against today’s Identity, with item 3’s and item 4’s fields but none of D17’s', async () => {
    serve(SUPPORT, { 'GET /api/v1/admin/order-routes': () => json({ items: [closed({})], wrongPatientReports: true }) })
    await openAt('/admin/order-routes')
    const row = await findByReference()
    expect(row.textContent).not.toMatch(/withdraw what it recorded|can no longer withdraw|Reported .*wrong person/)
  })
})
