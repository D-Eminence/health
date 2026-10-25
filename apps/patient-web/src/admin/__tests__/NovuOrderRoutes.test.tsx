import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

async function openAt(path: string) {
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
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
    expect(organizations(['platform.admin.access', 'platform.principal.read', 'platform.facility.read'])).toEqual(['Facilities', 'Orders between facilities'])
    expect(organizations(['platform.admin.access', 'platform.facility.read'])).toEqual(['Facilities'])
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

  it('finds a patient’s orders by Health ID, and refreshes after a version conflict', async () => {
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
    await waitFor(() => expect(calls.filter(call => call.path === '/api/v1/admin/order-routes').map(call => call.search))
      .toEqual(['?healthId=HID-7KQ2M9', '?healthId=HID-7KQ2M9']))
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
    expect(await within(panel).findByText('Listed for orders from other facilities, by default.')).toBeTruthy()
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
})
