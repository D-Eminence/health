import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Laboratory, Pharmacy } from '../Operations'
import { BETWEEN_FACILITIES } from '../../betweenFacilities'

/**
 * A laboratory or pharmacy that signed itself up (Novu, P4b) works alone until test orders and prescriptions travel
 * between facilities (P4c): its Laboratory or Pharmacy page says where its work comes from today, in one message per
 * case kept in betweenFacilities.ts.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn() }))
const working = vi.hoisted(() => ({ facility: null as Record<string, unknown> | null }))
vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: working.facility } } } }),
}))

const PERMISSIONS = ['lab.work-item.read', 'pharmacy.work-item.read']
function at(type: string | null, review = 'reviewed') {
  working.facility = { id: 'facility-1', membershipId: 'member-1', name: 'Yaba Diagnostics', roles: [], permissions: PERMISSIONS,
    ...(type ? { selfService: { review, organizationType: type } } : {}) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  api.labWorkItems.mockResolvedValue({ items: [] })
  api.pharmacyWorkItems.mockResolvedValue({ items: [] })
})
afterEach(() => { vi.unstubAllEnvs() })

const LAB_NOTE = 'Lab work arrives here from tests ordered at Yaba Diagnostics: a receptionist opens the patient’s visit, and a '
  + 'laboratory scientist orders the test. Health ID does not yet send test orders from other hospitals or clinics.'
const PHARMACY_NOTE = 'Prescriptions written at Yaba Diagnostics appear here. Health ID does not yet send prescriptions from '
  + 'hospitals and clinics to pharmacies, so this list stays empty for now.'

describe('where a stand-alone laboratory’s or pharmacy’s work comes from', () => {
  it('is said on a reviewed laboratory’s Laboratory page', async () => {
    at('laboratory')
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText(LAB_NOTE)).toBeTruthy()
    expect(BETWEEN_FACILITIES.laboratory.workspace('Yaba Diagnostics')).toBe(LAB_NOTE)
  })

  it('is said on a reviewed pharmacy’s Pharmacy page', async () => {
    at('pharmacy')
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByText(PHARMACY_NOTE)).toBeTruthy()
    expect(BETWEEN_FACILITIES.pharmacy.workspace('Yaba Diagnostics')).toBe(PHARMACY_NOTE)
  })

  it.each([
    ['a hospital’s pages', () => at('hospital'), 'both'],
    ['a pharmacy’s Laboratory page', () => at('pharmacy'), 'laboratory'],
    ['a laboratory still awaiting review', () => at('laboratory', 'pending'), 'both'],
    ['a governed facility', () => at(null), 'both'],
    ['a main-v1 build', () => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1'); at('laboratory') }, 'both'],
  ])('is not said on %s', async (_, setUp, pages) => {
    setUp()
    const { unmount } = render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Laboratory' })).toBeTruthy()
    expect(screen.queryByText(/does not yet send/)).toBeNull()
    unmount()
    if (pages === 'both') {
      render(<MemoryRouter><Pharmacy /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Pharmacy' })).toBeTruthy()
      expect(screen.queryByText(/does not yet send/)).toBeNull()
    }
  })
})
