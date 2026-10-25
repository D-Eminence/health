import { render, screen } from '@testing-library/react'
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
const staff = vi.hoisted(() => ({ permissions: [] as string[], roles: ['doctor'], selfService: undefined as
  { review: string; organizationType: string } | undefined }))

vi.mock('../../api', () => ({ staffApi: api }))
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
