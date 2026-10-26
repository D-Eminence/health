import { act, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../Dashboard'
import { forgetReceiving, RECEIVING_MEMORY_MS, rememberReceiving } from '../../orderRoutes'

/**
 * The "Health ID Migrate" card leads to the governed OCR workflow. OCR is closed
 * at launch: the gateway answers every OCR route 404 API_ROUTE_NOT_FOUND, and
 * since hid-system migration 0091 no role holds any ocr.* permission. The card is
 * shown, like the Document OCR workspace, only to a role holding ocr.job.read.
 */
const api = vi.hoisted(() => ({ listAccessRequests: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], roles: ['doctor'], selfService: undefined as
  { review: string; organizationType: string } | undefined }))

vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: routes }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: staff.roles, permissions: staff.permissions,
      ...(staff.selfService ? { selfService: staff.selfService } : {}),
    } } } },
    activePatient: null,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  staff.roles = ['doctor']
  staff.selfService = undefined
  api.listAccessRequests.mockResolvedValue([])
  forgetReceiving()
})

function open() {
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
}

describe('the Health ID Migrate card', () => {
  it('is not shown to a role without ocr.job.read', async () => {
    staff.permissions = ['identity.patient.read', 'ehr.encounter.read']
    open()
    expect(await screen.findByRole('link', { name: /Clinical record/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Health ID Migrate' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open document workflow →' })).toBeNull()
  })

  it('is shown to a role holding ocr.job.read, leading to the document workflow', async () => {
    staff.permissions = ['identity.patient.read', 'ocr.job.read']
    open()
    expect(await screen.findByRole('heading', { name: 'Health ID Migrate' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open document workflow →' }).getAttribute('href')).toBe('/provider/ocr')
  })
})

/** Novu (P4b): role names in words, and the facility check while Health ID support has not yet checked the facility. */
describe('the Active facility card', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it.each([
    ['novu-v1', 'Facility administrator, Laboratory scientist'],
    ['main-v1', 'org_admin_awaiting_review, lab'],
  ])('on a %s build names the roles “%s”', async (contract, label) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    staff.roles = ['org_admin_awaiting_review', 'lab']
    staff.permissions = ['audit.read']
    open()
    expect(await screen.findByText(label)).toBeTruthy()
  })

  it('is joined by the facility check at a self-signed-up facility awaiting review', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = ['audit.read']
    staff.selfService = { review: 'pending', organizationType: 'hospital' }
    open()
    expect(await screen.findByRole('heading', { name: 'Facility check' })).toBeTruthy()
    expect(screen.getByText('Pending')).toBeTruthy()
  })
})

/** Novu (P4c): orders other facilities sent here, counted for a laboratory scientist or pharmacist (SPEC-FINAL §13.5). */
describe('the Incoming orders card', () => {
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('counts the lab requests waiting here, and leads to the Laboratory', async () => {
    staff.permissions = ['lab.work-item.read', 'lab.order-route.receive']
    routes.incoming.mockResolvedValue({ items: [{ id: 'r1' }, { id: 'r2' }], crossFacilityOrders: true, crossFacilityWork: true })
    open()
    expect(await screen.findByText('2 lab requests from other facilities waiting at General Hospital')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Laboratory →' }).getAttribute('href')).toBe('/provider/laboratory')
    expect(routes.incoming).toHaveBeenCalledWith('facility-1', 'lab')
  })

  it('counts a pharmacist’s prescriptions in the singular', async () => {
    staff.permissions = ['pharmacy.work-item.read', 'pharmacy.order-route.receive']
    routes.incoming.mockResolvedValue({ items: [{ id: 'r1' }], crossFacilityOrders: true, crossFacilityWork: true })
    open()
    expect(await screen.findByText('1 prescription from other facilities waiting at General Hospital')).toBeTruthy()
  })

  it('says none are waiting at a laboratory that signed itself up and was checked', async () => {
    staff.permissions = ['lab.work-item.read', 'lab.order-route.receive']
    staff.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    open()
    expect(await screen.findByText('0 lab requests from other facilities waiting at General Hospital')).toBeTruthy()
  })

  it('is not shown, and nothing is read, at a hospital or clinic that signed itself up: they are never sent orders', async () => {
    staff.permissions = ['lab.work-item.read', 'lab.order-route.receive', 'pharmacy.work-item.read', 'pharmacy.order-route.receive']
    for (const type of ['hospital', 'clinic']) {
      staff.selfService = { review: 'reviewed', organizationType: type }
      const { unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>)
      expect(await screen.findByRole('link', { name: /Laboratory/ })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Incoming orders' })).toBeNull()
      unmount()
    }
    expect(routes.incoming).not.toHaveBeenCalled()
  })

  it('at a governed facility, whose type the session does not say, is shown only while orders are waiting', async () => {
    staff.permissions = ['lab.work-item.read', 'lab.order-route.receive']
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    open()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(/waiting at General Hospital/)).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Incoming orders' })).toBeNull()
  })

  it('is not shown where the backend has no such route, nor to a member who receives none', async () => {
    staff.permissions = ['lab.work-item.read', 'lab.order-route.receive']
    routes.incoming.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
    const { unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await waitFor(() => expect(routes.incoming).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Incoming orders' })).toBeNull())
    unmount()
    routes.incoming.mockClear()
    staff.permissions = ['ehr.encounter.read']
    open()
    expect(await screen.findByRole('link', { name: /Clinical record/ })).toBeTruthy()
    expect(routes.incoming).not.toHaveBeenCalled()
  })
})

/**
 * Item 4 (hid-system 0089): each Incoming answer says whether this facility receives orders from other facilities now
 * (`receives`) and whether orders sent before still wait (`routesHere.waiting`, D4), and is remembered for 10 minutes per
 * membership, facility and service (D3). The card then says "0 waiting" only where orders can come, says orders sent before
 * only where the Laboratory or Pharmacy page shows them, and a governed facility an answer said does not receive is not
 * read again until that is forgotten.
 */
describe('the Incoming orders card, by what Incoming says of this facility (item 4)', () => {
  const LAB = ['lab.work-item.read', 'lab.order-route.receive']
  const FACILITY = { id: 'facility-1', membershipId: 'member-1' }
  const waiting = (count: number, fields: Record<string, unknown>) => ({ items: Array.from({ length: count }, (_, index) => ({ id: `r${index}` })),
    crossFacilityOrders: true, crossFacilityWork: true, ...fields })
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'); staff.permissions = LAB })
  afterEach(() => { vi.unstubAllEnvs(); forgetReceiving() })

  async function settled() {
    await waitFor(() => expect(screen.getByRole('link', { name: /Laboratory/ })).toBeTruthy())
    await waitFor(() => expect(routes.incoming.mock.results.every(result => result.type === 'return')).toBe(true))
    await act(async () => { await Promise.resolve() })
  }

  it('at a governed facility that receives: says none are waiting', async () => {
    routes.incoming.mockResolvedValue(waiting(0, { receives: true, routesHere: { waiting: false, held: true } }))
    open()
    expect(await screen.findByText('0 lab requests from other facilities waiting at General Hospital')).toBeTruthy()
  })

  it('at a governed facility that does not receive: no card, even with orders counted, and none without routesHere (S5)', async () => {
    routes.incoming.mockResolvedValue(waiting(2, { receives: false }))
    open()
    await settled()
    expect(routes.incoming).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Incoming orders' })).toBeNull()
  })

  it('at a governed facility support unlisted, with orders sent before still waiting: counts them (D4)', async () => {
    routes.incoming.mockResolvedValue(waiting(2, { receives: false, routesHere: { waiting: true, held: false } }))
    open()
    expect(await screen.findByText('2 lab requests from other facilities waiting at General Hospital')).toBeTruthy()
  })

  it('at a checked laboratory that can’t receive now: a card only while orders sent before wait', async () => {
    staff.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    routes.incoming.mockResolvedValue(waiting(1, { receives: false }))
    const { unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>)
    expect(await screen.findByText('1 lab request from other facilities waiting at General Hospital')).toBeTruthy()
    unmount()
    routes.incoming.mockResolvedValue(waiting(0, { receives: false }))
    open()
    await settled()
    expect(screen.queryByRole('heading', { name: 'Incoming orders' })).toBeNull()
  })

  it('at a governed facility remembered not to receive: reads nothing, and reads again once 10 minutes have passed (D3)', async () => {
    const now = Date.now()
    rememberReceiving(FACILITY, 'lab', waiting(0, { receives: false }), now)
    routes.incoming.mockResolvedValue(waiting(0, { receives: false }))
    const { unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await settled()
    expect(routes.incoming).not.toHaveBeenCalled()
    unmount()
    vi.spyOn(Date, 'now').mockReturnValue(now + RECEIVING_MEMORY_MS)
    open()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
  })

  it('remembers what its own read says for the next time it opens, never reading again now', async () => {
    staff.permissions = [...LAB, 'pharmacy.work-item.read', 'pharmacy.order-route.receive', 'identity.consent.write']
    // The laboratory answer comes first and is remembered; the Overview is drawn again (its access requests arrive)
    // before the pharmacy's answer: neither is read twice.
    api.listAccessRequests.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([]), 10)))
    routes.incoming.mockImplementation(async (_facility: string, service: string) => service === 'lab'
      ? waiting(0, { receives: false, routesHere: { waiting: false, held: false } })
      : new Promise(resolve => setTimeout(() => resolve(waiting(0, { receives: false })), 30)))
    const { unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 50))
    await settled()
    expect(routes.incoming).toHaveBeenCalledTimes(2)
    unmount()
    routes.incoming.mockClear()
    open()
    await settled()
    expect(routes.incoming).not.toHaveBeenCalled()
  })

  it('at a laboratory the session calls checked, remembered not to receive: still reads, for Decline (S5)', async () => {
    staff.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    rememberReceiving(FACILITY, 'lab', waiting(0, { receives: false }))
    routes.incoming.mockResolvedValue(waiting(1, { receives: false }))
    open()
    expect(await screen.findByText('1 lab request from other facilities waiting at General Hospital')).toBeTruthy()
  })

  it('remembered not to receive, but with orders sent before still waiting: reads and counts them (D4)', async () => {
    rememberReceiving(FACILITY, 'lab', waiting(0, { receives: false, routesHere: { waiting: true, held: false } }))
    routes.incoming.mockResolvedValue(waiting(3, { receives: false, routesHere: { waiting: true, held: false } }))
    open()
    expect(await screen.findByText('3 lab requests from other facilities waiting at General Hospital')).toBeTruthy()
  })

  it('remembered as receiving, at a facility that signed itself up as something else: reads, as Health ID says', async () => {
    staff.selfService = { review: 'reviewed', organizationType: 'other' }
    rememberReceiving(FACILITY, 'lab', waiting(0, { receives: true }))
    routes.incoming.mockResolvedValue(waiting(0, { receives: true }))
    open()
    expect(await screen.findByText('0 lab requests from other facilities waiting at General Hospital')).toBeTruthy()
  })

  it('is not read for another member, nor at another facility, from what one remembered', async () => {
    rememberReceiving({ id: 'facility-1', membershipId: 'member-2' }, 'lab', waiting(0, { receives: false }))
    rememberReceiving({ id: 'facility-2', membershipId: 'member-1' }, 'lab', waiting(0, { receives: false }))
    routes.incoming.mockResolvedValue(waiting(0, {}))
    open()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
  })

  it('without the fields: today’s rule (a governed facility says only orders waiting)', async () => {
    routes.incoming.mockResolvedValue(waiting(1, {}))
    open()
    expect(await screen.findByText('1 lab request from other facilities waiting at General Hospital')).toBeTruthy()
  })
})
