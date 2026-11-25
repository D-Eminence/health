import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type * as StaffApi from '../../../staff/api'
import type * as Product from '../../../ehr-blue/frame/product'
import { staffApi } from '../../../staff/api'
import { accessRequestsError } from '../../../staff/routes/AccessRequests'
import { BlueHome } from '../../../ehr-blue/home/BlueHome'
import { AttentionProvider } from '../../../ehr-blue/frame/attention'
import { RoleViewProvider } from '../../../ehr-blue/frame/roleView'
import { REAL_FACILITY, facility } from '../frame/blueHarness'

/**
 * Home where the Access requests page does not open (so there is no Access requests card), for a session that still
 * reads the requests: Needs attention says them. When that read fails it says classic's error sentence alone
 * (staff/routes/Dashboard.tsx:272; parity report 15b, 28), with no title and no Try again, and no "All clear" (28b).
 * Every account and facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  return { ...actual, staffApi: { ...actual.staffApi, listAccessRequests: vi.fn() } }
})
// Every page opens here but Access requests.
vi.mock('../../../ehr-blue/frame/product', async importOriginal => {
  const actual = await importOriginal<typeof Product>()
  return { ...actual, opensInProduct: (product: Product.Product, path: string) => path !== 'requests' && actual.opensInProduct(product, path) }
})
const staff = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../staff/App', async importOriginal => ({
  ...await importOriginal<object>(),
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-demo-1', displayName: 'Demo Clinician', roles: [], permissions: [],
      facility: staff.facility, facilities: [staff.facility] }, expiresAt: '2026-11-30T12:00:00.000Z' } },
    activePatient: null, lock: null,
  }),
}))
afterEach(() => { vi.clearAllMocks() })

function home() {
  const here = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.consent.write', 'identity.patient.read'])
  staff.facility = here
  render(<MemoryRouter><RoleViewProvider><AttentionProvider facilityId={here.id} permissions={here.permissions}>
    <BlueHome />
  </AttentionProvider></RoleViewProvider></MemoryRouter>)
  return within(screen.getByRole('region', { name: 'Needs attention' }))
}

describe('Home without the Access requests card: a failed read in Needs attention', () => {
  it('says the error sentence alone, with no title and no Try again, and no all clear', async () => {
    const failure = new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' })
    vi.mocked(staffApi.listAccessRequests).mockRejectedValue(failure)
    const attention = home()
    expect(screen.queryByLabelText('Access requests')).toBeNull()
    const words = await attention.findByText(accessRequestsError(failure))
    expect(words.tagName).toBe('P')
    expect(screen.getAllByText(accessRequestsError(failure))).toHaveLength(1)
    expect(screen.queryByText('Couldn’t load access requests')).toBeNull()
    expect(attention.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(attention.queryByText('All clear')).toBeNull()
    // The sentence says it: no second, vaguer one beside it.
    expect(attention.queryByText('We couldn’t check everything that needs attention just now.')).toBeNull()
  })

  it('lists the waiting requests there once the read works', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue([{ accessRequestId: 'r1', patientId: 'p-0000aa11bb22', scope: 'read_records',
      purposeOfUse: 'direct-care', reason: 'Follow-up (fictional)', status: 'pending', requestedDurationMinutes: 60,
      requestedAt: '2026-10-29T09:00:00Z', approvedAt: null, deniedAt: null, deniedReason: null }] as unknown as Awaited<ReturnType<typeof staffApi.listAccessRequests>>)
    const attention = home()
    expect(await attention.findByText('1 access request waiting')).toBeDefined()
    expect(attention.queryByText('All clear')).toBeNull()
  })
})
