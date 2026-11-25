import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type * as StaffApi from '../../../staff/api'
import { staffApi } from '../../../staff/api'
import { accessRequestsError } from '../../../staff/routes/AccessRequests'
import { BlueHome } from '../../../ehr-blue/home/BlueHome'
import { AttentionProvider } from '../../../ehr-blue/frame/attention'
import { RoleViewProvider } from '../../../ehr-blue/frame/roleView'
import { REAL_FACILITY, facility } from './blueHarness'

/**
 * Home's Access requests card, as today's Overview shows it (classic Dashboard.tsx:272): always there for a session
 * that reads access requests, 0 pending included, with its loading and read-error words and the way to the requests.
 * Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  return { ...actual, staffApi: { ...actual.staffApi, listAccessRequests: vi.fn() } }
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

type Requests = Awaited<ReturnType<typeof staffApi.listAccessRequests>>
const request = (id: string, status: string) => ({ accessRequestId: id, patientId: 'p-0000aa11bb22', scope: 'read_records',
  purposeOfUse: 'direct-care', reason: 'Follow-up (fictional)', status, requestedDurationMinutes: 60, requestedAt: '2026-10-29T09:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null })
const READS = ['identity.consent.write', 'identity.patient.read']

function home(permissions: readonly string[]) {
  const here = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', permissions)
  staff.facility = here
  render(<MemoryRouter><RoleViewProvider><AttentionProvider facilityId={here.id} permissions={here.permissions}>
    <BlueHome />
  </AttentionProvider></RoleViewProvider></MemoryRouter>)
}
const card = () => within(screen.getByLabelText('Access requests'))
const attention = () => within(screen.getByRole('region', { name: 'Needs attention' }))

describe('Home: the Access requests card, as today\'s Overview', () => {
  it.each([
    [[] as ReturnType<typeof request>[], '0 pending requests'],
    [[request('r1', 'pending'), request('r2', 'approved')], '1 pending request'],
    [[request('r1', 'pending'), request('r2', 'pending'), request('r3', 'denied')], '2 pending requests'],
  ])('counts the pending requests (%#)', async (requests, words) => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue(requests as unknown as Requests)
    home(READS)
    expect(card().getByRole('heading', { level: 2, name: 'Access requests' })).toBeDefined()
    expect(await card().findByText(words)).toBeDefined()
  })

  it('says it is loading while it reads, and leads to the access requests page', () => {
    vi.mocked(staffApi.listAccessRequests).mockReturnValue(new Promise(() => {}))
    home(READS)
    expect(card().getByText('Loading requests…')).toBeDefined()
    expect(card().getByRole('link', { name: 'Review requests' }).getAttribute('href')).toBe('/provider/requests')
  })

  // Parity report 15b and 28: classic says the error sentence alone in the card's one line (Dashboard.tsx:272), with no
  // title and no Try again.
  it('says the read error when the read fails, in the card\'s one line, as classic does', async () => {
    const failure = new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' })
    vi.mocked(staffApi.listAccessRequests).mockRejectedValue(failure)
    home(READS)
    const words = await card().findByText(accessRequestsError(failure))
    expect(words.tagName).toBe('P')
    expect(card().queryByText('Loading requests…')).toBeNull()
    // Said once, on the card: Needs attention says nothing of the requests.
    expect(screen.getAllByText(accessRequestsError(failure))).toHaveLength(1)
    expect(screen.queryByText('Couldn’t load access requests')).toBeNull()
    expect(card().queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // The card is classic's: its heading, the sentence and the way to the requests, nothing more.
    expect(card().getAllByRole('link').map(link => link.textContent)).toEqual(['Review requests'])
    expect(card().queryAllByRole('button')).toHaveLength(0)
    expect(attention().queryByText(/request/)).toBeNull()
  })

  it('says the same plain sentence for a role that may not read them', async () => {
    const failure = new HidApiError(403, 'Forbidden', { code: 'CONSENT_COMMAND_DENIED' })
    vi.mocked(staffApi.listAccessRequests).mockRejectedValue(failure)
    home(READS)
    expect(await card().findByText('Your role here can’t see access requests. Ask your facility administrator if you need to.')).toBeDefined()
    expect(screen.queryByText('Couldn’t load access requests')).toBeNull()
    expect(screen.getByLabelText('Access requests').textContent).not.toMatch(/permission/i)
  })

  // Parity report 28b: Needs attention says "All clear" only for what was read, the card's requests included.
  it('does not say all clear while the card\'s read is on its way, nor after it fails', async () => {
    let fail: (reason: unknown) => void = () => {}
    vi.mocked(staffApi.listAccessRequests).mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))
    home(READS)
    expect(card().getByText('Loading requests…')).toBeDefined()
    expect(attention().getByRole('status', { name: 'Loading what needs attention' })).toBeDefined()
    expect(attention().queryByText('All clear')).toBeNull()
    expect(attention().queryByText('Nothing is waiting for you.')).toBeNull()
    fail(new HidApiError(503, 'Unavailable', { code: 'UNAVAILABLE' }))
    expect(await attention().findByText('We couldn’t check everything that needs attention just now.')).toBeDefined()
    expect(attention().queryByText('All clear')).toBeNull()
    expect(attention().queryByText('Nothing is waiting for you.')).toBeNull()
    expect(attention().queryByText(/request/)).toBeNull()
  })

  it('says all clear once the card\'s read has worked and nothing else waits', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue([] as unknown as Requests)
    home(READS)
    expect(await card().findByText('0 pending requests')).toBeDefined()
    expect(attention().getByText('All clear')).toBeDefined()
    expect(attention().getByText('Nothing is waiting for you.')).toBeDefined()
  })

  it('says the pending count once on Home: on the card, not again in Needs attention', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue([request('r1', 'pending'), request('r2', 'pending')] as unknown as Requests)
    home(READS)
    expect(await card().findByText('2 pending requests')).toBeDefined()
    expect(screen.getAllByText(/\b2\b[^.]*request/)).toHaveLength(1)
    expect(attention().queryByText(/request/)).toBeNull()
    expect(attention().queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: /request/ }).map(link => link.textContent)).toEqual(['Review requests'])
  })

  it('shows no card, and reads nothing, for a session that may not read access requests', () => {
    home(['identity.patient.read'])
    expect(screen.queryByLabelText('Access requests')).toBeNull()
    expect(screen.queryByText('Review requests')).toBeNull()
    expect(staffApi.listAccessRequests).not.toHaveBeenCalled()
  })
})
