import { render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../Dashboard'

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
