import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Dashboard } from '../Dashboard'

/**
 * The ordering facility's Overview card (item 3, owner decision D10's alternative (a), C28): orders sent from this
 * facility that the receiving laboratory or pharmacy ended as accepted for someone who was not the patient, in the last 30
 * days. The member who sent an order sees it in full, with a way to the order, whether or not they may still open the
 * patient's record (the backend decides, C28); an order a colleague sent is shown only as a count and its reference, never a
 * patient's name, and the card says that colleagues sent them; a member without ehr.order-route.send reads nothing. Read once when the
 * Overview opens; nothing is shown when there is none, or where the backend has no such route (404).
 */
const api = vi.hoisted(() => ({ listAccessRequests: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), sentWrongPatient: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown }))

vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: routes }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ade Okon', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: staff.activePatient,
  }),
}))

const SENDER = ['ehr.encounter.read', 'ehr.lab-request.read', 'ehr.order-route.send']
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const lab = { routeId: 'r1', reference: '9C1B2D3E', kind: 'lab_request', receivingFacility: { id: 'f-yaba', name: 'Yaba Diagnostics' },
  patient: { name: 'Ada Patient' }, endedAt: '2026-10-24T09:00:00.000000+00:00', resultsWithdrawn: 2, dispensingReversed: false,
  link: { patientId: PATIENT, encounterId: 'e0000000-0000-4000-8000-000000000001', kind: 'lab_request', orderId: 'o1' } }
const prescription = { routeId: 'r2', reference: '1A2B3C4D', kind: 'prescription', receivingFacility: { id: 'f-med', name: 'Medplus Yaba' },
  patient: { name: 'Bola Patient' }, endedAt: '2026-10-25T09:00:00.000000+00:00', resultsWithdrawn: 0, dispensingReversed: true,
  link: { patientId: 'a0000000-0000-4000-8000-000000000002', encounterId: 'e0000000-0000-4000-8000-000000000002', kind: 'prescription', orderId: 'o2' } }
const EMPTY = { windowDays: 30, items: [], others: { count: 0, references: [] } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  staff.permissions = SENDER
  staff.activePatient = null
  api.listAccessRequests.mockResolvedValue([])
  routes.sentWrongPatient.mockResolvedValue(EMPTY)
})
afterEach(() => { vi.unstubAllEnvs() })

function Where() {
  const location = useLocation()
  return <p>Opened {location.pathname} with {JSON.stringify(location.state)}</p>
}

function open() {
  render(<MemoryRouter initialEntries={['/provider']}><Routes>
    <Route path="/provider" element={<Dashboard />} />
    <Route path="/provider/*" element={<Where />} />
  </Routes></MemoryRouter>)
}

async function card() {
  return (await screen.findByRole('heading', { name: 'Orders accepted for the wrong person' })).closest('.staff-card') as HTMLElement
}

describe('the Overview card of orders accepted for the wrong person', () => {
  it('shows the member’s own orders in full: what was withdrawn, and how to reach the order', async () => {
    routes.sentWrongPatient.mockResolvedValue({ windowDays: 30, items: [lab, prescription], others: { count: 0, references: [] } })
    open()
    const shown = await card()
    expect(routes.sentWrongPatient).toHaveBeenCalledTimes(1)
    expect(routes.sentWrongPatient).toHaveBeenCalledWith('facility-1')
    expect(within(shown).getByText(/^In the last 30 days, a laboratory or pharmacy reported that it accepted these orders from General Hospital for someone who was not the patient, and ended them\./)).toBeTruthy()
    const [first, second] = [...shown.querySelectorAll('li')] as HTMLElement[]
    expect(within(first!).getByText('Lab request · Ref 9C1B2D3E · Ada Patient')).toBeTruthy()
    expect(within(first!).getByText('Yaba Diagnostics reports that it accepted it for someone who was not Ada Patient, and ended it on 24 Oct 2026.')).toBeTruthy()
    expect(within(first!).getByText('2 results it had sent back were withdrawn: do not use them, and tell Ada Patient that a result '
      + 'they may have seen was not theirs.')).toBeTruthy()
    expect(within(second!).getByText('Prescription · Ref 1A2B3C4D · Bola Patient')).toBeTruthy()
    expect(within(second!).getByText('The dispensing it recorded was reversed: check with Bola Patient before you prescribe it again.')).toBeTruthy()
    // No record is open: the way to the order is through Patient access, never a link that opens a record.
    expect(within(first!).getByText(/^To see it, open Ada Patient’s record from/).textContent)
      .toBe('To see it, open Ada Patient’s record from Patient access, then the lab request with reference 9C1B2D3E.')
    expect(within(first!).getByRole('link', { name: 'Patient access' }).getAttribute('href')).toBe('/provider/patients')
    expect(within(shown).queryByText(/other order/)).toBeNull()
  })

  it('links to the order in the record open for its patient', async () => {
    staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup: { patient: { patientId: PATIENT, fullName: 'Ada Patient' } } }
    routes.sentWrongPatient.mockResolvedValue({ windowDays: 30, items: [lab, prescription], others: { count: 0, references: [] } })
    open()
    const shown = await card()
    expect(within(shown).queryByRole('link', { name: 'Open the prescription →' })).toBeNull()
    fireEvent.click(within(shown).getByRole('link', { name: 'Open the lab request →' }))
    expect(await screen.findByText(`Opened /provider/clinical with ${JSON.stringify({ order: lab.link })}`)).toBeTruthy()
  })

  it('shows a colleague’s orders only as a count and their references, never a patient’s name', async () => {
    routes.sentWrongPatient.mockResolvedValue({ windowDays: 30, items: [],
      // Anything else the answer carried is never shown: the card says only the count and the references.
      others: { count: 3, references: ['AB12CD34', '9F00E1A2'], patients: ['Chidi Patient'] } })
    open()
    const shown = await card()
    // The backend gives a member every order they sent in full, so the references are only ever colleagues' (C28): the card
    // says so, and never suggests that one of them may be the reader's own.
    expect(within(shown).getByText('3 orders that colleagues sent from this facility were reported accepted for the wrong person: '
      + 'AB12CD34, 9F00E1A2 and 1 more. Only the clinician who sent each one sees it here in full.')).toBeTruthy()
    expect(shown.textContent).not.toMatch(/Chidi|Patient’s record|Ref /)
    expect(shown.querySelectorAll('li')).toHaveLength(0)
    expect(within(shown).queryAllByRole('link')).toHaveLength(0)
  })

  it('says how many other orders there are beside the member’s own', async () => {
    routes.sentWrongPatient.mockResolvedValue({ windowDays: 30, items: [lab], others: { count: 1, references: ['AB12CD34'] } })
    open()
    const shown = await card()
    expect(within(shown).getByText('1 more order that a colleague sent from this facility was reported accepted for the wrong '
      + 'person: AB12CD34. Only the clinician who sent each one sees it here in full.')).toBeTruthy()
  })

  it.each([
    ['none in the last 30 days', () => routes.sentWrongPatient.mockResolvedValue(EMPTY)],
    ['a backend without the route (404)', () => routes.sentWrongPatient.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))],
  ])('shows nothing for %s', async (_case, arrange) => {
    arrange()
    open()
    await waitFor(() => expect(routes.sentWrongPatient).toHaveBeenCalled())
    await screen.findByRole('link', { name: /Clinical record/ })
    expect(screen.queryByRole('heading', { name: 'Orders accepted for the wrong person' })).toBeNull()
  })

  it('says it could not be loaded when the read fails', async () => {
    routes.sentWrongPatient.mockRejectedValue(new HidApiError(503, 'Down', { code: 'ORDER_ROUTE_UNAVAILABLE' }))
    open()
    const shown = await card()
    expect(shown.textContent).toMatch(/could not be loaded/)
  })

  it('reads nothing for a member who doesn’t send orders to other facilities, or on a main-v1 build', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.lab-request.read']
    open()
    await screen.findByRole('link', { name: /Clinical record/ })
    expect(routes.sentWrongPatient).not.toHaveBeenCalled()
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    staff.permissions = SENDER
    open()
    expect((await screen.findAllByRole('link', { name: /Clinical record/ })).length).toBeGreaterThan(0)
    expect(routes.sentWrongPatient).not.toHaveBeenCalled()
  })
})
