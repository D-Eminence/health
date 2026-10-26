import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Laboratory, Pharmacy } from '../Operations'
import { BETWEEN_FACILITIES } from '../../betweenFacilities'
import { forgetReceiving } from '../../orderRoutes'

/**
 * A laboratory or pharmacy that signed itself up (Novu, P4b) says where its work comes from, in one message per case
 * kept in betweenFacilities.ts: since P4c by whether orders between facilities are on, as the work list says
 * (crossFacilityOrders). Off, or not said, it gets no orders from other facilities; on, they arrive under Incoming.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn() }))
const incoming = vi.hoisted(() => ({ incoming: vi.fn() }))
const working = vi.hoisted(() => ({ facility: null as Record<string, unknown> | null }))
vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: incoming }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: working.facility } } } }),
}))

const PERMISSIONS = ['lab.work-item.read', 'pharmacy.work-item.read']
function at(type: string | null, review = 'reviewed', permissions = PERMISSIONS) {
  working.facility = { id: 'facility-1', membershipId: 'member-1', name: 'Yaba Diagnostics', roles: [], permissions,
    ...(type ? { selfService: { review, organizationType: type } } : {}) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  api.labWorkItems.mockResolvedValue({ items: [] })
  api.pharmacyWorkItems.mockResolvedValue({ items: [] })
  incoming.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  forgetReceiving()
})
afterEach(() => { vi.unstubAllEnvs(); forgetReceiving() })

const LAB_NOTE = 'Lab work arrives here from tests ordered at Yaba Diagnostics: a receptionist opens the patient’s visit, and a '
  + 'laboratory scientist orders the test. Health ID is not sending test orders from other hospitals or clinics at the moment.'
const PHARMACY_NOTE = 'Prescriptions written at Yaba Diagnostics appear here. Health ID is not sending prescriptions from '
  + 'hospitals and clinics to pharmacies at the moment, so this list stays empty for now.'
// P4c: with orders between facilities on.
// Listing is not in any answer the workspace reads (support may record its check as Other, or stop listing it): the
// copy says orders come while it is listed, and whom to ask when none come (P4c review).
const LAB_NOTE_ON = 'Lab work arrives from tests ordered at Yaba Diagnostics, and from Health ID clinicians at other facilities '
  + 'while Health ID lists Yaba Diagnostics for their orders: accept those under Incoming, with the patient in front of you. If '
  + 'none ever arrive, ask Health ID support whether Yaba Diagnostics is listed.'
const PHARMACY_NOTE_ON = 'Prescriptions that Health ID clinicians at other facilities send Yaba Diagnostics appear under Incoming, '
  + 'while Health ID lists Yaba Diagnostics for their orders. Accept one when the patient is at your counter: it then moves to the '
  + 'list below for dispensing. If none ever arrive, ask Health ID support whether Yaba Diagnostics is listed.'

describe('where a stand-alone laboratory’s or pharmacy’s work comes from', () => {
  it('is said on a reviewed laboratory’s Laboratory page', async () => {
    at('laboratory')
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText(LAB_NOTE)).toBeTruthy()
    expect(BETWEEN_FACILITIES.laboratory.workspace('Yaba Diagnostics', false)).toBe(LAB_NOTE)
  })

  it('is said on a reviewed pharmacy’s Pharmacy page', async () => {
    at('pharmacy')
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByText(PHARMACY_NOTE)).toBeTruthy()
    expect(BETWEEN_FACILITIES.pharmacy.workspace('Yaba Diagnostics', false)).toBe(PHARMACY_NOTE)
  })

  it('says orders from other facilities arrive under Incoming once the work list says they are on (P4c)', async () => {
    at('laboratory')
    api.labWorkItems.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    const { unmount } = render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText(LAB_NOTE_ON)).toBeTruthy()
    expect(screen.queryByText(/not sending/)).toBeNull()
    unmount()
    at('pharmacy')
    api.pharmacyWorkItems.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByText(PHARMACY_NOTE_ON)).toBeTruthy()
    expect(BETWEEN_FACILITIES.laboratory.workspace('Yaba Diagnostics', true)).toBe(LAB_NOTE_ON)
    expect(BETWEEN_FACILITIES.pharmacy.workspace('Yaba Diagnostics', true)).toBe(PHARMACY_NOTE_ON)
  })

  it('never says a laboratory or pharmacy receives nothing from other facilities while orders are on', () => {
    for (const kind of ['laboratory', 'pharmacy'] as const) {
      expect(BETWEEN_FACILITIES[kind].signUp(true)).toMatch(/clinicians at other facilities can send you/)
      expect(BETWEEN_FACILITIES[kind].workspace('Yaba Diagnostics', true)).toMatch(/Incoming/)
      for (const text of [BETWEEN_FACILITIES[kind].signUp(true), BETWEEN_FACILITIES[kind].workspace('Yaba Diagnostics', true)]) {
        expect(text).not.toMatch(/not sending|does not yet|stays empty/)
      }
    }
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
    expect(screen.queryByText(/not sending|does not yet send/)).toBeNull()
    unmount()
    if (pages === 'both') {
      render(<MemoryRouter><Pharmacy /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Pharmacy' })).toBeTruthy()
      expect(screen.queryByText(/not sending|does not yet send/)).toBeNull()
    }
  })
})

/**
 * Item 4 (hid-system 0089, owner decision D2): the work list says to a member holding the receive permission whether
 * clinicians at other facilities can send orders here now (`receives`). With it the note says so plainly, and when they
 * can't, says so without a reason and whom to ask; without it, the hedge above.
 */
describe('where a stand-alone laboratory’s or pharmacy’s work comes from, by whether it receives (item 4)', () => {
  const LAB_RECEIVES = 'Lab work arrives from tests ordered at Yaba Diagnostics, and from Health ID clinicians at other '
    + 'facilities: accept those under Incoming, with the patient in front of you.'
  const LAB_NOT_NOW = 'Health ID clinicians at other facilities can’t send Yaba Diagnostics lab requests at the moment. If you '
    + 'expect them, ask Health ID support.'
  const PHARMACY_RECEIVES = 'Prescriptions that Health ID clinicians at other facilities send Yaba Diagnostics appear under '
    + 'Incoming. Accept one when the patient is at your counter: it then moves to the list below for dispensing.'
  const PHARMACY_NOT_NOW = 'Health ID clinicians at other facilities can’t send Yaba Diagnostics prescriptions at the moment. '
    + 'If you expect them, ask Health ID support.'
  const routes = { items: [], crossFacilityOrders: true, crossFacilityWork: true }

  it('says each case in one message, kept in betweenFacilities.ts', () => {
    expect(BETWEEN_FACILITIES.laboratory.workspace('Yaba Diagnostics', true, true)).toBe(LAB_RECEIVES)
    expect(BETWEEN_FACILITIES.laboratory.workspace('Yaba Diagnostics', true, false)).toBe(LAB_NOT_NOW)
    expect(BETWEEN_FACILITIES.laboratory.workspace('Yaba Diagnostics', true, undefined)).toBe(LAB_NOTE_ON)
    expect(BETWEEN_FACILITIES.pharmacy.workspace('Yaba Diagnostics', true, true)).toBe(PHARMACY_RECEIVES)
    expect(BETWEEN_FACILITIES.pharmacy.workspace('Yaba Diagnostics', true, false)).toBe(PHARMACY_NOT_NOW)
    expect(BETWEEN_FACILITIES.pharmacy.workspace('Yaba Diagnostics', true, undefined)).toBe(PHARMACY_NOTE_ON)
    // With orders between facilities off, that is what is said, whatever the facility's listing.
    for (const receives of [true, false, undefined]) {
      expect(BETWEEN_FACILITIES.laboratory.workspace('Yaba Diagnostics', false, receives)).toBe(LAB_NOTE)
      expect(BETWEEN_FACILITIES.pharmacy.workspace('Yaba Diagnostics', false, receives)).toBe(PHARMACY_NOTE)
    }
    // No reason is given (D2): never the listing, the check or the product.
    for (const text of [LAB_NOT_NOW, PHARMACY_NOT_NOW]) expect(text).not.toMatch(/listed|Other|suspended|checked|because/)
  })

  it('says a laboratory can’t be sent lab requests now, where its work list says so to a laboratory scientist', async () => {
    at('laboratory', 'reviewed', [...PERMISSIONS, 'lab.order-route.receive'])
    api.labWorkItems.mockResolvedValue({ ...routes, receives: false })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText(LAB_NOT_NOW)).toBeTruthy()
  })

  it('says a pharmacy receives prescriptions, where its work list says so to a pharmacist', async () => {
    at('pharmacy', 'reviewed', [...PERMISSIONS, 'pharmacy.order-route.receive'])
    api.pharmacyWorkItems.mockResolvedValue({ ...routes, receives: true })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByText(PHARMACY_RECEIVES)).toBeTruthy()
  })

  it('keeps the hedge for a member without the receive permission, whatever the answer carries (D1)', async () => {
    at('laboratory')
    api.labWorkItems.mockResolvedValue({ ...routes, receives: false })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText(LAB_NOTE_ON)).toBeTruthy()
  })
})
