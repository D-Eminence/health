import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../Dashboard'

/**
 * The "Health ID Migrate" card leads to the governed OCR workflow. OCR is closed
 * at launch: the gateway answers every OCR route 404 API_ROUTE_NOT_FOUND, and
 * since hid-system migration 0091 no role holds any ocr.* permission. The card is
 * shown, like the Document OCR workspace, only to a role holding ocr.job.read.
 */
const api = vi.hoisted(() => ({ listAccessRequests: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: null,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
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
