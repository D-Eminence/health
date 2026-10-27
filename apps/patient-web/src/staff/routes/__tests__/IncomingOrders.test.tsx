import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Laboratory, Pharmacy } from '../Operations'
import { INCOMING_REFRESH_MS } from '../IncomingOrders'
import { forgetWrongPatientServed, learnWrongPatientServed } from '../../../wrongPatientServed'
import { forgetReceiving, rememberedReceiving, RECEIVING_MEMORY_MS } from '../../orderRoutes'
import { focusWhenShown } from '../../../__tests__/focusWhenShown'

/**
 * Orders other facilities sent here, waiting to be accepted (Novu, P4c, SPEC-FINAL §4.1, §13.3): a preview without the
 * patient, the clinical information, the instructions or the licence number; found by the patient's Health ID; accepted
 * with the patient's Health ID or date of birth (five wrong tries that name the order lock it here; a date of birth
 * names it only with the order's reference from the patient's app), a pharmacy giving its reason; declined
 * with a reason; read again on focus and every 2 minutes; paused with no Accept while orders between facilities are off;
 * and not shown at all where the backend has no such route.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), decline: vi.fn(), reportWrongPatient: vi.fn(), get: vi.fn() }))
const working = vi.hoisted(() => ({ permissions: [] as string[], selfService: undefined as
  { review: string; organizationType: string } | undefined }))
vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: routes }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: { id: 'facility-1', membershipId: 'member-1',
    name: 'Yaba Diagnostics', roles: ['lab'], permissions: working.permissions,
    ...(working.selfService ? { selfService: working.selfService } : {}) } } } } }),
}))

const LAB = ['lab.work-item.read', 'lab.order-route.receive']
const PHARMACIST = ['pharmacy.work-item.read', 'pharmacy.order-route.receive']
const ROUTE = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const incomingLab = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE, reference: '9C1B2D3E', version: 1, effectiveState: 'sent',
  orderingFacilityName: 'General Hospital', orderer: { name: 'Dr Ade Okon', licenceBody: 'MDCN' },
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, priority: 'urgent', specimenTypeCode: 'Venous blood',
  sentAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptLocked: false, attemptsLeft: 5, ...overrides })
const incomingRx = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE, reference: '9C1B2D3E', version: 1, effectiveState: 'sent',
  orderingFacilityName: 'General Hospital', orderer: { name: 'Dr Ade Okon', licenceBody: null },
  medication: { codeSystem: null, code: null, display: 'Amoxicillin 500 mg capsules' }, doseQuantity: '500', doseUnit: 'mg',
  routeCode: 'oral', frequency: 'Three times daily', startsOn: '2026-10-20', endsOn: '2026-10-27', prescribedAt: '2026-10-20T08:55:00.000Z',
  sentAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptLocked: false, attemptsLeft: 5, ...overrides })
const ACCEPTED = { route: { id: ROUTE, version: 2, effectiveState: 'accepted' }, workItemId: 'w1',
  patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' },
  clinicalInformation: 'Tired for two weeks', orderer: { licenceBody: 'MDCN', licenceNumber: 'MDCN/12345' }, replayed: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  working.permissions = LAB
  // A laboratory that signed itself up and that Health ID support checked: one that receives lab requests.
  working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
  api.labWorkItems.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  api.pharmacyWorkItems.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  routes.incoming.mockResolvedValue({ items: [incomingLab()], crossFacilityOrders: true, crossFacilityWork: true })
  forgetWrongPatientServed()
  forgetReceiving()
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
// A request answered outside act, as a fetch's answer arrives, renders in one task and runs its effects in a later one.
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = true })

async function openLaboratory() {
  render(<MemoryRouter><Laboratory /></MemoryRouter>)
  return (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section')!
}

describe('Incoming at a laboratory', () => {
  it('previews an order without the patient or what the clinician wrote', async () => {
    const incoming = await openLaboratory()
    expect(routes.incoming).toHaveBeenCalledWith('facility-1', 'lab', undefined)
    const card = within(incoming).getByText('Haemoglobin').closest('.staff-list-item') as HTMLElement
    expect(within(card).getByText('From General Hospital · Ordered by Dr Ade Okon · Licence on record: MDCN')).toBeTruthy()
    expect(within(card).getByText(/^LOINC 718-7 · Specimen: Venous blood · Urgent$/)).toBeTruthy()
    expect(within(card).getByText(/^Sent .* · Accept by .* · Ref 9C1B2D3E$/)).toBeTruthy()
    expect(within(card).getByText('Patient shown after you accept.')).toBeTruthy()
    expect(card.textContent).not.toMatch(/Tunde|Tired|12345/)
  })

  it('finds a patient’s orders by their Health ID, and refuses one that is not a Health ID', async () => {
    const incoming = await openLaboratory()
    fireEvent.change(within(incoming).getByLabelText('Find by Health ID'), { target: { value: 'hid-7kq2m9' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Find' }))
    await waitFor(() => expect(routes.incoming).toHaveBeenLastCalledWith('facility-1', 'lab', 'HID-7KQ2M9'))
    fireEvent.change(within(incoming).getByLabelText('Find by Health ID'), { target: { value: '1985-03-12' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Find' }))
    expect(await within(incoming).findByText(/^Check the Health ID: it starts with HID-/)).toBeTruthy()
  })

  it('sends a Health ID only when asked: never again by the timer or on focus, and not after the order is accepted', async () => {
    const every = vi.spyOn(window, 'setInterval')
    routes.accept.mockResolvedValue(ACCEPTED)
    const incoming = await openLaboratory()
    fireEvent.change(within(incoming).getByLabelText('Find by Health ID'), { target: { value: 'HID-7KQ2M9' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Find' }))
    await waitFor(() => expect(routes.incoming).toHaveBeenLastCalledWith('facility-1', 'lab', 'HID-7KQ2M9'))
    expect(within(incoming).getByText(/^Showing the orders for HID-7KQ2M9 only\./)).toBeTruthy()
    const withHealthId = () => routes.incoming.mock.calls.filter(call => call[2] !== undefined).length
    expect(withHealthId()).toBe(1)
    // While one patient's orders are shown, the window's focus and the 2-minute timer read nothing.
    every.mockClear()
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(every).not.toHaveBeenCalledWith(expect.any(Function), INCOMING_REFRESH_MS)
    expect(withHealthId()).toBe(1)
    // Refresh is asked for: it reads that patient's orders again.
    fireEvent.click(within(incoming).getByRole('button', { name: 'Refresh incoming' }))
    await waitFor(() => expect(withHealthId()).toBe(2))
    // Accepting the order goes back to every order, without the Health ID.
    fireEvent.click(await within(incoming).findByRole('button', { name: 'Accept' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s Health ID/), { target: { value: 'HID-7KQ2M9' } })
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText('Accepted: Haemoglobin.')).toBeTruthy()
    await waitFor(() => expect(routes.incoming).toHaveBeenLastCalledWith('facility-1', 'lab', undefined))
    expect(withHealthId()).toBe(2)
    expect((within(incoming).getByLabelText('Find by Health ID') as HTMLInputElement).value).toBe('')
    every.mockRestore()
  })

  it('accepts with the patient’s Health ID, then names the patient and refreshes the work list', async () => {
    routes.accept.mockResolvedValue(ACCEPTED)
    const incoming = await openLaboratory()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s Health ID/), { target: { value: ' hid-7kq2m9 ' } })
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText('Accepted: Haemoglobin.')).toBeTruthy()
    expect(within(incoming).getByText(/^Tunde Bello, male, born 12 Mar 1985, Health ID ending 7KQ2\.$/)).toBeTruthy()
    expect(within(incoming).getByText('Clinical information: Tired for two weeks')).toBeTruthy()
    expect(within(incoming).getByText('Licence on record: MDCN MDCN/12345.')).toBeTruthy()
    expect(routes.accept).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE, version: 1 }, { kind: 'health_id', value: 'HID-7KQ2M9' },
      undefined, expect.any(String), undefined)
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
  })

  it('counts down the tries left after a date of birth given with the order’s reference, a new key for each try', async () => {
    routes.accept.mockRejectedValue(new HidApiError(409, 'No match', { code: 'ORDER_ROUTE_PATIENT_MISMATCH', attemptsLeft: 4 }))
    const incoming = await openLaboratory()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    expect(within(incoming).queryByLabelText(/^Order reference/)).toBeNull()
    fireEvent.click(within(incoming).getByRole('radio', { name: 'Date of birth' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s date of birth/), { target: { value: '1985-03-21' } })
    // Typed from what the patient's app shows: never filled from this card.
    const reference = within(incoming).getByLabelText(/^Order reference from the patient’s app/) as HTMLInputElement
    expect(reference.value).toBe('')
    expect(within(incoming).getByText(/^Five dates of birth that don’t match, given with the reference, or 20 wrong details/)).toBeTruthy()
    fireEvent.change(reference, { target: { value: ' 9c1b2d3e ' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText('That doesn’t match this order’s patient. 4 tries left.')).toBeTruthy()
    expect(routes.accept).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE, version: 1 }, { kind: 'date_of_birth', value: '1985-03-21' },
      undefined, expect.any(String), '9C1B2D3E')
    // A settled refusal frees its key: the next try is a new acceptance.
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    await waitFor(() => expect(routes.accept).toHaveBeenCalledTimes(2))
    expect(routes.accept.mock.calls[1]![5]).not.toBe(routes.accept.mock.calls[0]![5])
  })

  it('after a date of birth alone that does not match, asks for the reference instead of counting down', async () => {
    routes.accept.mockRejectedValue(new HidApiError(409, 'No match', { code: 'ORDER_ROUTE_PATIENT_MISMATCH', attemptsLeft: 5 }))
    const incoming = await openLaboratory()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    fireEvent.click(within(incoming).getByRole('radio', { name: 'Date of birth' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s date of birth/), { target: { value: '1985-03-21' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText('That doesn’t match this order’s patient. Check that this is their order: ask for the '
      + 'reference shown with it in their Health ID app, and enter it with the date of birth.')).toBeTruthy()
    expect(within(incoming).queryByText(/tries left/)).toBeNull()
    expect(routes.accept).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE, version: 1 }, { kind: 'date_of_birth', value: '1985-03-21' },
      undefined, expect.any(String), undefined)
  })

  it('refuses a reference that is not 8 characters before sending, and says another order’s reference is not this one’s', async () => {
    routes.accept.mockRejectedValue(new HidApiError(409, 'Not this order', { code: 'ORDER_ROUTE_REFERENCE_MISMATCH' }))
    const incoming = await openLaboratory()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    fireEvent.click(within(incoming).getByRole('radio', { name: 'Date of birth' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s date of birth/), { target: { value: '1985-03-12' } })
    const reference = within(incoming).getByLabelText(/^Order reference from the patient’s app/)
    fireEvent.change(reference, { target: { value: 'HID-7KQ2' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText(/^The reference is the 8 characters shown with the order/)).toBeTruthy()
    expect(routes.accept).not.toHaveBeenCalled()
    fireEvent.change(reference, { target: { value: '0A1B2C3D' } })
    const reads = routes.incoming.mock.calls.length
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText('That reference is not this order’s. Check that you picked the patient’s own order: '
      + 'their Health ID app shows its reference.')).toBeTruthy()
    expect(routes.accept).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE, version: 1 }, { kind: 'date_of_birth', value: '1985-03-12' },
      undefined, expect.any(String), '0A1B2C3D')
    // Nothing was counted and the order did not change: the list is not read again.
    expect(routes.incoming.mock.calls.length).toBe(reads)
    // Switching to the Health ID drops the reference.
    fireEvent.click(within(incoming).getByRole('radio', { name: 'Health ID' }))
    expect(within(incoming).queryByLabelText(/^Order reference/)).toBeNull()
  })

  it('says a locked order can’t be accepted here, and offers only Decline', async () => {
    routes.incoming.mockResolvedValue({ items: [incomingLab({ acceptLocked: true, attemptsLeft: 0 })], crossFacilityOrders: true, crossFacilityWork: true })
    const incoming = await openLaboratory()
    expect(within(incoming).getByText('Too many wrong tries: this order can’t be accepted here. General Hospital can send it again.')).toBeTruthy()
    expect(within(incoming).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(within(incoming).getByRole('button', { name: 'Decline' })).toBeTruthy()
  })

  it.each([
    ['ORDER_ROUTE_ACCEPT_LOCKED', 409, 'Too many wrong tries: this order can’t be accepted here. General Hospital can send it again.'],
    ['ORDER_ROUTE_HEALTH_ID_REQUIRED', 409, 'No date of birth is on record for this patient: ask for their Health ID instead.'],
    ['ORDER_ROUTE_EXPIRED', 409, 'This order was not accepted within 7 days of sending, so it has expired. General Hospital can send it again.'],
    ['ORDER_ROUTE_ACCEPT_LIMITED', 429, 'You have entered too many details that didn’t match today. Try again tomorrow, or ask a colleague.'],
    ['CROSS_FACILITY_ORDERS_UNAVAILABLE', 423, 'Health ID has paused orders between facilities. Try again later.'],
  ])('says what a refused acceptance means (%s)', async (code, status, says) => {
    routes.accept.mockRejectedValue(new HidApiError(status, 'No', { code }))
    const incoming = await openLaboratory()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s Health ID/), { target: { value: 'HID-7KQ2M9' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText(says)).toBeTruthy()
  })

  it('declines with a reason the ordering facility is told', async () => {
    routes.decline.mockResolvedValue({ route: { id: ROUTE, version: 2, effectiveState: 'declined' } })
    const incoming = await openLaboratory()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Decline' }))
    const reason = within(incoming).getByLabelText('Why can’t you take it?') as HTMLSelectElement
    expect([...reason.options].map(option => option.text)).toEqual(['Choose a reason', 'This test isn’t offered',
      'It can’t be done at this priority', 'The patient didn’t come', 'Another reason'])
    fireEvent.change(reason, { target: { value: 'test_not_offered' } })
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    fireEvent.click(within(incoming).getAllByRole('button', { name: 'Decline' }).at(-1)!)
    expect(await within(incoming).findByText('Declined. General Hospital is told.')).toBeTruthy()
    expect(routes.decline).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE, version: 1 }, 'test_not_offered')
  })

  it('says orders are paused and offers no Accept while orders between facilities are off', async () => {
    routes.incoming.mockResolvedValue({ items: [{ ...incomingLab(), test: undefined, orderer: { name: null, licenceBody: null } }],
      crossFacilityOrders: false, crossFacilityWork: true })
    const incoming = await openLaboratory()
    expect(within(incoming).getByText(/^Health ID has paused orders between facilities\. You can’t accept orders now/)).toBeTruthy()
    expect(within(incoming).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(within(incoming).getByText('Lab request')).toBeTruthy()
  })

  it('reads Incoming again when the window comes back into focus, and every 2 minutes', async () => {
    const every = vi.spyOn(window, 'setInterval')
    await openLaboratory()
    expect(every).toHaveBeenCalledWith(expect.any(Function), INCOMING_REFRESH_MS)
    expect(INCOMING_REFRESH_MS).toBe(120_000)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(2))
    every.mockRestore()
  })

  it.each([
    ['a backend without the route (404)', () => { routes.incoming.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })) }],
    ['a member without the receive permission', () => { working.permissions = ['lab.work-item.read'] }],
    ['a main-v1 build', () => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1') }],
  ])('is not shown for %s', async (_case, setUp) => {
    setUp()
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Laboratory' })).toBeTruthy()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
  })
})

describe('Incoming at a pharmacy', () => {
  beforeEach(() => {
    working.permissions = PHARMACIST
    working.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    routes.incoming.mockResolvedValue({ items: [incomingRx()], crossFacilityOrders: true, crossFacilityWork: true })
  })

  it('previews the prescription, warns about controlled medicines, and accepts with a reason', async () => {
    routes.accept.mockResolvedValue({ ...ACCEPTED, clinicalInformation: undefined, instructions: 'Take with food' })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    const incoming = (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section')!
    expect(routes.incoming).toHaveBeenCalledWith('facility-1', 'pharmacy', undefined)
    expect(within(incoming).getByText('From General Hospital · Ordered by Dr Ade Okon · Licence not on record')).toBeTruthy()
    expect(within(incoming).getByText('500 mg · Route: oral · Three times daily')).toBeTruthy()
    expect(within(incoming).getByText('If this is a controlled medicine, check the prescription as you would a paper one before you dispense it.')).toBeTruthy()
    expect(incoming.textContent).not.toMatch(/Take with food/)

    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s Health ID/), { target: { value: 'HID-7KQ2M9' } })
    fireEvent.change(within(incoming).getByLabelText(/^Reason for accepting/), { target: { value: 'short' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText('Give a reason of 8 to 500 characters.')).toBeTruthy()
    expect(routes.accept).not.toHaveBeenCalled()
    fireEvent.change(within(incoming).getByLabelText(/^Reason for accepting/), { target: { value: 'Patient at the counter with their card' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    expect(await within(incoming).findByText('Instructions: Take with food')).toBeTruthy()
    expect(routes.accept).toHaveBeenCalledWith('facility-1', 'pharmacy', { id: ROUTE, version: 1 }, { kind: 'health_id', value: 'HID-7KQ2M9' },
      'Patient at the counter with their card', expect.any(String), undefined)
  })

  it('offers a pharmacy the medicine’s decline reasons', async () => {
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    const incoming = (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section')!
    fireEvent.click(within(incoming).getByRole('button', { name: 'Decline' }))
    const reason = within(incoming).getByLabelText('Why can’t you take it?') as HTMLSelectElement
    expect([...reason.options].map(option => option.text)).toEqual(['Choose a reason', 'The medicine isn’t available',
      'It can’t be done at this priority', 'The patient didn’t come', 'Another reason'])
  })
})

/**
 * Only a laboratory receives lab requests, and only a pharmacy prescriptions (owner decision Q4): the receive permission
 * comes with the lab and pharmacist roles at every facility, but a hospital's or clinic's own laboratory or pharmacy is
 * never found or sent orders. No answer says whether this facility receives (P4c review), so the page goes by the
 * session's facility type, and for a governed facility, whose type the session does not carry, by whether there is work
 * from another facility to show.
 */
describe('a laboratory scientist or pharmacist where orders from other facilities never come', () => {
  it.each([['hospital'], ['clinic'], ['other']])('at a %s that signed itself up: no Incoming, no claim, no read', async type => {
    working.selfService = { review: 'reviewed', organizationType: type }
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText('Accepted EHR test orders at this facility. A separate accession records the specimen chain of custody.')).toBeTruthy()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalled())
    expect(routes.incoming).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/other facilities|paused orders/)
  })

  it('at a pharmacy’s Laboratory page: a pharmacy receives no lab requests', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalled())
    expect(routes.incoming).not.toHaveBeenCalled()
  })

  it('at a governed facility with nothing waiting: one read when the page opens, then nothing said or read again', async () => {
    working.selfService = undefined
    const every = vi.spyOn(window, 'setInterval')
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: false, crossFacilityWork: true })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Accepted EHR test orders at this facility. A separate accession records the specimen chain of custody.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/other facilities|paused orders/)
    expect(every).not.toHaveBeenCalledWith(expect.any(Function), INCOMING_REFRESH_MS)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(routes.incoming).toHaveBeenCalledTimes(1)
    every.mockRestore()
  })

  it('at a governed facility with an order waiting: shows Incoming, says it receives them, and reads it every 2 minutes', async () => {
    working.selfService = undefined
    const every = vi.spyOn(window, 'setInterval')
    await openLaboratory()
    expect(await screen.findByText('Tests ordered at this facility, and lab requests from other facilities once you accept them. A separate accession records the specimen chain of custody.')).toBeTruthy()
    await waitFor(() => expect(every).toHaveBeenCalledWith(expect.any(Function), INCOMING_REFRESH_MS))
    every.mockRestore()
  })

  it('at a governed facility with accepted work from another facility: says it receives them, and keeps Incoming in view', async () => {
    working.selfService = undefined
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    api.labWorkItems.mockResolvedValue({ items: [{ id: 'w1', patientId: 'a0000000-0000-4000-8000-0000004f9c2e', version: 1,
      status: 'accepted', testName: 'Haemoglobin', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T10:00:00.000Z',
      orderRoute: { id: 'r1', reference: '9C1B2D3E', effectiveState: 'accepted', access: 'work', orderingFacilityName: 'General Hospital',
        ordererName: 'Dr Ade Okon' } }], crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Incoming (0)' })).toBeTruthy()
    expect(screen.getByText(/^Tests ordered at this facility, and lab requests from other facilities/)).toBeTruthy()
  })
})

/**
 * Item 3 (owner decisions D1-D6, D18; SPEC-FINAL §8.1, §9.1): the Accepted panel is where the receiver first sees who the
 * order is for. It leads with the check that the person at the counter is that patient, then "This isn't the order's
 * patient", whose form sends nothing until what happened, a note for support and the confirmation are given. The order
 * then ends here, and the message that says to phone the ordering facility stays until closed. On 412 the route is read
 * again and the form stays open at its new version; a backend without the route says it is not available yet.
 */
describe('the Accepted panel: this isn’t the order’s patient', () => {
  const ENDED = { route: { id: ROUTE, version: 3, effectiveState: 'cancelled', endedKind: 'wrong_patient' }, resultsVoided: 0,
    resultReportsMarked: 0, dispensingReversed: false, replayed: false }

  async function acceptAt(open: () => void, identify: (incoming: HTMLElement) => void = incoming =>
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s Health ID/), { target: { value: 'HID-7KQ2M9' } })) {
    open()
    const incoming = (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section')!
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    identify(incoming)
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    await within(incoming).findByText(/^Accepted: /)
    return incoming
  }
  const openLab = () => render(<MemoryRouter><Laboratory /></MemoryRouter>)

  function fill(incoming: HTMLElement, { reason = 'I picked another patient’s order from the list', note = '  Two patients with the same date of birth  ', tick = true } = {}) {
    if (reason) fireEvent.click(within(incoming).getByRole('radio', { name: reason }))
    fireEvent.change(within(incoming).getByLabelText('What happened, for Health ID support'), { target: { value: note } })
    if (tick) fireEvent.click(within(incoming).getByRole('checkbox'))
  }

  beforeEach(() => {
    routes.accept.mockResolvedValue(ACCEPTED)
    routes.reportWrongPatient.mockResolvedValue(ENDED)
    // A backend that serves the report (hid-system 0088): its work lists' cards carry the route's version (D15).
    learnWrongPatientServed(true)
  })

  it('asks only for the check on today’s backend: no button, and no “end this order now” (D15)', async () => {
    forgetWrongPatientServed()
    // Today's work lists: no card carries the route's version, so nothing has said the receiver can end an order.
    const incoming = await acceptAt(openLab)
    expect(within(incoming).getByText('Check that the person in front of you is Tunde Bello, born 12 Mar 1985, before you take '
      + 'a sample or hand over any medicine.')).toBeTruthy()
    expect(within(incoming).queryByText(/end this order now/)).toBeNull()
    expect(within(incoming).queryByRole('button', { name: 'This isn’t the order’s patient' })).toBeNull()
    expect(within(incoming).getByText('Accepted: Haemoglobin.')).toBeTruthy()
  })

  it('offers it once the work list carries the route’s version, as only a backend with the report sends', async () => {
    forgetWrongPatientServed()
    const routedWork = { id: 'w1', patientId: 'a0000000-0000-4000-8000-0000004f9c2e', version: 1, status: 'accepted',
      testName: 'Haemoglobin', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T10:00:00.000Z',
      orderRoute: { id: ROUTE, version: 2, reference: '9C1B2D3E', effectiveState: 'accepted', access: 'work',
        orderingFacilityName: 'General Hospital', ordererName: 'Dr Ade Okon', endedKind: null },
      patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' } }
    const incoming = await acceptAt(() => {
      openLab()
      api.labWorkItems.mockResolvedValue({ items: [routedWork], crossFacilityOrders: true, crossFacilityWork: true })
    })
    expect(await within(incoming).findByRole('button', { name: 'This isn’t the order’s patient' })).toBeTruthy()
    expect(within(incoming).getByText('Check that the person in front of you is Tunde Bello, born 12 Mar 1985, before you take '
      + 'a sample or hand over any medicine. If they are not, end this order now.')).toBeTruthy()
  })

  it('leads with the check that the person is the patient, then the button, then the form', async () => {
    const incoming = await acceptAt(openLab)
    const check = within(incoming).getByText('Check that the person in front of you is Tunde Bello, born 12 Mar 1985, before you take '
      + 'a sample or hand over any medicine. If they are not, end this order now.')
    const button = within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' })
    const accepted = within(incoming).getByText('Accepted: Haemoglobin.')
    const panel = check.closest('.staff-notice') as HTMLElement
    const order = [...panel.querySelectorAll('*')]
    expect(order.indexOf(check)).toBeLessThan(order.indexOf(button))
    expect(order.indexOf(button)).toBeLessThan(order.indexOf(accepted))
    fireEvent.click(button)
    const form = within(incoming).getByRole('form', { name: 'End this order: accepted for the wrong person' })
    // The button is gone: focus is in the form it opened (its title), not back at the top of the page.
    expect(document.activeElement).toBe(within(form).getByText('End this order: accepted for the wrong person'))
    expect(within(form).getByText('Tunde Bello is the patient on this order. Use this only if the person you accepted it for is someone else.')).toBeTruthy()
    expect(within(form).getByText('If you can’t do the test, don’t use this either: phone General Hospital.')).toBeTruthy()
    expect(within(form).queryByText(/collecting for/)).toBeNull()
    expect([...form.querySelectorAll('ul li')].map(item => item.textContent)).toEqual([
      'You stop seeing Tunde Bello’s details and this order at once, and nothing more can be recorded on it.',
      'Any result you released on it is marked entered in error, and General Hospital is shown not to use it.',
      'Tunde Bello is told in the Health ID app. General Hospital sees it on the order, but Health ID does not alert them: you must phone them.',
      'Health ID support reviews every report. This can’t be undone.'])
    expect(within(form).getAllByRole('radio').map(radio => radio.closest('label')!.textContent!.trim())).toEqual([
      'I picked another patient’s order from the list', 'The person gave someone else’s Health ID or date of birth',
      'I think the person was pretending to be the patient', 'The person was not the patient for another reason'])
    expect(within(form).getByText(/^8 to 500 characters\. Describe what happened at the counter\. Support reads this; the patient and General Hospital don’t\./)).toBeTruthy()
    expect(within(form).getByRole('checkbox', { name: 'The person I accepted this order for is not Tunde Bello.' })).toBeTruthy()
    // Prevention first: the panel's own wording is the receiver's, never sent anywhere.
    expect(routes.reportWrongPatient).not.toHaveBeenCalled()
  })

  // Cancel gives focus back in the commit that shows the button again: from a timer a task later, a check made as soon as
  // the button was shown found focus on the page.
  it('has focus on “This isn’t the order’s patient” as soon as Cancel shows it again', async () => {
    const incoming = await acceptAt(openLab)
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    const form = within(incoming).getByRole('form', { name: 'End this order: accepted for the wrong person' })
    const shown = focusWhenShown(() => within(incoming).queryByRole('button', { name: 'This isn’t the order’s patient' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('sends nothing until what happened, the note and the confirmation are given, then ends the order with one key', async () => {
    const incoming = await acceptAt(openLab)
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    const end = () => fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    end()
    expect(await within(incoming).findByText('Choose what happened.')).toBeTruthy()
    fill(incoming, { note: ' short  ', tick: false })
    end()
    expect(await within(incoming).findByText('Describe what happened in 8 to 500 characters.')).toBeTruthy()
    fill(incoming, { reason: '', tick: false })
    end()
    expect(await within(incoming).findByText('Tick the box to confirm that the person was not the patient.')).toBeTruthy()
    expect(routes.reportWrongPatient).not.toHaveBeenCalled()
    fireEvent.click(within(incoming).getByRole('checkbox'))
    api.labWorkItems.mockClear()
    // Focus is read the moment the message is shown. Read after findBy, it passed only when the runner was slow enough for
    // an effect a task later to have run (this test failed under load when the message took focus that way).
    const shown = focusWhenShown(() => screen.queryByText('Ended: Haemoglobin, reference 9C1B2D3E. Tunde Bello is told in the Health ID app.'))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    end()
    const { element: message, focused } = await shown
    expect(routes.reportWrongPatient).toHaveBeenCalledTimes(1)
    expect(routes.reportWrongPatient).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE, version: 2 },
      { reason: 'wrong_order_chosen', note: 'Two patients with the same date of birth' }, expect.stringMatching(/^[0-9a-f-]{36}$/))
    // The message replaces the panel and stays until closed; the work list is read again, and the order leaves it.
    const said = message.closest('.staff-notice') as HTMLElement
    expect(said.textContent).toContain('Health ID shows this to General Hospital on the order but does not alert them. Phone '
      + 'General Hospital if the test is urgent, so they can send a new order.')
    expect(said.textContent).toContain('Set aside any specimen taken for it, following your laboratory’s procedure: it is not Tunde Bello’s.')
    expect(said.textContent).toContain('This order leaves your work list when it refreshes.')
    expect(said.textContent).not.toContain('Next time, ask for the order’s reference')
    expect(within(incoming).queryByText('Accepted: Haemoglobin.')).toBeNull()
    expect(focused).toBe(message)
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalled())
    fireEvent.click(within(said).getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(/^Ended: Haemoglobin/)).toBeNull()
  })

  it.each([
    ['other work remains', true],
    ['the list is left empty, until other work comes', false],
  ])('drops the accession form of the order it ends, for good (%s)', async (_case, othersRemain) => {
    // The receiver stops seeing the patient's details at once (§9.1), wherever the page showed them.
    working.permissions = [...LAB, 'lab.accession.create']
    const routedWork = { id: 'w1', patientId: 'a0000000-0000-4000-8000-0000004f9c2e', version: 1, status: 'accepted',
      testName: 'Haemoglobin', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T10:00:00.000Z',
      orderRoute: { id: ROUTE, version: 2, reference: '9C1B2D3E', effectiveState: 'accepted', access: 'work',
        orderingFacilityName: 'General Hospital', ordererName: 'Dr Ade Okon', ordererLicence: { body: 'MDCN', number: 'MDCN/12345' },
        endedKind: null },
      patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' } }
    const localWork = { id: 'w-local', patientId: 'a0000000-0000-4000-8000-000000aa11bb', version: 1, status: 'accepted',
      testName: 'Malaria parasite', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T09:00:00.000Z' }
    const listed = (...items: unknown[]) => ({ items, crossFacilityOrders: true, crossFacilityWork: true })
    api.labWorkItems.mockResolvedValue(listed(localWork))
    routes.reportWrongPatient.mockResolvedValue(ENDED)
    const incoming = await acceptAt(() => { openLab(); api.labWorkItems.mockResolvedValue(listed(routedWork, localWork)) })
    const work = (await screen.findByText('Haemoglobin', { selector: '.staff-two-col strong' })).closest('.staff-list-item') as HTMLElement
    fireEvent.click(within(work).getByRole('button', { name: 'Prepare accession' }))
    expect(screen.getByRole('heading', { name: 'Create specimen accession' })).toBeTruthy()
    expect(screen.getByText(/^Haemoglobin · Tunde Bello, male, born 12 Mar 1985/)).toBeTruthy()
    // Ended from the Accepted panel, still open above the work list.
    api.labWorkItems.mockResolvedValue(othersRemain ? listed(localWork) : listed())
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    fill(incoming)
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    await screen.findByText(/^Ended: Haemoglobin, reference 9C1B2D3E/)
    await waitFor(() => expect(screen.queryByText('Haemoglobin', { selector: '.staff-two-col strong' })).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Create specimen accession' })).toBeNull()
    expect(screen.queryByText(/Tunde Bello, male/)).toBeNull()
    // Nor once other work is listed again.
    api.labWorkItems.mockResolvedValue(listed(localWork))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))
    await screen.findByText('Malaria parasite', { selector: '.staff-two-col strong' })
    expect(screen.queryByRole('heading', { name: 'Create specimen accession' })).toBeNull()
    expect(screen.queryByText(/Tunde Bello, male/)).toBeNull()
  })

  it('says to phone now when a result had already gone back', async () => {
    routes.reportWrongPatient.mockResolvedValue({ ...ENDED, route: { ...ENDED.route, effectiveState: 'completed' }, resultsVoided: 1,
      resultReportsMarked: 1 })
    const incoming = await acceptAt(openLab)
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    fill(incoming)
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    expect(await screen.findByText('Health ID shows this to General Hospital on the order but does not alert them. Phone General '
      + 'Hospital now: a result had already gone back to them.')).toBeTruthy()
  })

  it('keeps the key for the same report after no answer, and takes a new one once the report changes', async () => {
    routes.reportWrongPatient.mockRejectedValue(new HidApiError(503, 'Down', { code: 'UPSTREAM_UNAVAILABLE' }))
    const incoming = await acceptAt(openLab)
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    fill(incoming)
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    expect(await within(incoming).findByText('Health ID did not answer, so it may or may not have ended. Refresh the list and check.')).toBeTruthy()
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    await waitFor(() => expect(routes.reportWrongPatient).toHaveBeenCalledTimes(2))
    fireEvent.change(within(incoming).getByLabelText('What happened, for Health ID support'), { target: { value: 'Another description of it' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    await waitFor(() => expect(routes.reportWrongPatient).toHaveBeenCalledTimes(3))
    const keys = routes.reportWrongPatient.mock.calls.map(call => call[4] as string)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('reads the order again after 412 and keeps the form open at its new version', async () => {
    routes.reportWrongPatient.mockRejectedValueOnce(new HidApiError(412, 'Changed', { code: 'VERSION_CONFLICT' }))
    routes.get.mockResolvedValue({ ...incomingLab({ version: 5, effectiveState: 'completed' }) })
    const incoming = await acceptAt(openLab)
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    fill(incoming)
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    expect(await within(incoming).findByText('Something was recorded on this order a moment ago. It has been reloaded: check what '
      + 'will happen and try again.')).toBeTruthy()
    expect(routes.get).toHaveBeenCalledWith('facility-1', 'lab', ROUTE)
    expect(within(incoming).getByRole('form', { name: 'End this order: accepted for the wrong person' })).toBeTruthy()
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    await waitFor(() => expect(routes.reportWrongPatient).toHaveBeenCalledTimes(2))
    expect(routes.reportWrongPatient.mock.calls[1]![2]).toEqual({ id: ROUTE, version: 5 })
    expect(routes.reportWrongPatient.mock.calls[1]![4]).not.toBe(routes.reportWrongPatient.mock.calls[0]![4])
  })

  it.each([
    [new HidApiError(409, 'Ended', { code: 'ORDER_ROUTE_ALREADY_ENDED' }), 'This order has already ended, so it can’t be ended here. '
      + 'If a result or dispensing had gone back, phone General Hospital and tell Health ID support.'],
    [new HidApiError(403, 'Permission', { code: 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED' }), 'Results were recorded on this '
      + 'order, and your role can’t mark results entered in error. Ask a laboratory scientist to end it.'],
    [new HidApiError(409, 'Raced', { code: 'ORDER_ROUTE_CHANGED_CONCURRENTLY' }), 'Someone changed this order at the same moment. Try again.'],
    [new HidApiError(423, 'Paused', { code: 'CROSS_FACILITY_ORDERS_UNAVAILABLE' }), 'Health ID has paused work on orders from other '
      + 'facilities, so this can’t be done now. Try again when it resumes, and tell Health ID support now. Don’t ask support to '
      + 'close the order: closing it stops you withdrawing anything you sent back.'],
    [new HidApiError(404, 'Missing', { code: 'API_ROUTE_NOT_FOUND' }), 'Ending an order for the wrong person isn’t available yet. '
      + 'Tell Health ID support, and phone General Hospital.'],
  ])('says the refusal %#, and the order stays as it is', async (refusal, says) => {
    routes.reportWrongPatient.mockRejectedValue(refusal)
    const incoming = await acceptAt(openLab)
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    fill(incoming)
    fireEvent.click(within(incoming).getByRole('button', { name: 'End this order' }))
    expect((await within(incoming).findByRole('alert')).textContent).toBe(says)
    expect(within(incoming).getByText('Accepted: Haemoglobin.')).toBeTruthy()
    expect(screen.queryByText(/^Ended: /)).toBeNull()
  })

  it('at a pharmacy, says that someone collecting for the patient is not the wrong person, and after a date of birth alone, to ask for the reference', async () => {
    working.permissions = PHARMACIST
    working.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    routes.incoming.mockResolvedValue({ items: [incomingRx()], crossFacilityOrders: true, crossFacilityWork: true })
    routes.accept.mockResolvedValue({ ...ACCEPTED, clinicalInformation: undefined, instructions: 'Take with food' })
    const incoming = await acceptAt(() => render(<MemoryRouter><Pharmacy /></MemoryRouter>), panel => {
      fireEvent.click(within(panel).getByRole('radio', { name: 'Date of birth' }))
      fireEvent.change(within(panel).getByLabelText(/^Patient’s date of birth/), { target: { value: '1985-03-12' } })
      fireEvent.change(within(panel).getByLabelText(/^Reason for accepting/), { target: { value: 'Patient at the counter' } })
    })
    fireEvent.click(within(incoming).getByRole('button', { name: 'This isn’t the order’s patient' }))
    const form = within(incoming).getByRole('form', { name: 'End this order: accepted for the wrong person' })
    expect(within(form).getByText('Someone collecting for Tunde Bello with their agreement is not the wrong person: don’t use this for them.')).toBeTruthy()
    expect(within(form).getByText('If you can’t do the medicine, don’t use this either: phone General Hospital.')).toBeTruthy()
    expect(within(form).queryByText(/marked entered in error/)).toBeNull()
    expect(within(form).queryByText(/dispensing you recorded/)).toBeNull()
    fill(incoming, { reason: 'I think the person was pretending to be the patient', note: 'Gave a Health ID card that was not theirs', tick: false })
    fireEvent.click(within(form).getByRole('checkbox', { name: 'The person I accepted this order for is not Tunde Bello, and was not collecting it for them.' }))
    fireEvent.click(within(form).getByRole('button', { name: 'End this order' }))
    const message = await screen.findByText('Ended: Amoxicillin 500 mg capsules, reference 9C1B2D3E. Tunde Bello is told in the Health ID app.')
    expect(routes.reportWrongPatient).toHaveBeenCalledWith('facility-1', 'pharmacy', { id: ROUTE, version: 2 },
      { reason: 'suspected_misuse', note: 'Gave a Health ID card that was not theirs' }, expect.any(String))
    const said = message.closest('.staff-notice') as HTMLElement
    expect(said.textContent).toContain('If medicine was handed over, try to get it back and follow your pharmacy’s incident procedure.')
    expect(said.textContent).toContain('Next time, ask for the order’s reference with the date of birth: it shows in the patient’s Health ID app.')
  })
})


/**
 * Item 4 (hid-system 0089): the work list says whether this facility receives orders from other facilities now
 * (`receives`), and whether orders sent before still wait here (`routesHere.waiting`, owner decision D4), to a member
 * holding the receive permission. The page then reads Incoming only where there is something to accept or decline: never
 * at a governed hospital, at once and every 2 minutes at a facility that receives, and once, with Decline but no Accept,
 * where orders sent before still wait at a facility that can't accept them now. Without the fields, today's rule runs.
 */
describe('what the work list says of this facility (item 4)', () => {
  const NOT_HERE = 'Yaba Diagnostics can’t receive orders from other facilities at the moment, so these can’t be accepted '
    + 'here; you can still decline them.'
  const HOLDS = /^Tests ordered at this facility, and lab requests from other facilities once you accept them/
  const OWN = 'Accepted EHR test orders at this facility. A separate accession records the specimen chain of custody.'
  const CANT_SEND = 'Health ID clinicians at other facilities can’t send Yaba Diagnostics lab requests at the moment. If you '
    + 'expect them, ask Health ID support.'
  const RECEIVES = 'Lab work arrives from tests ordered at Yaba Diagnostics, and from Health ID clinicians at other '
    + 'facilities: accept those under Incoming, with the patient in front of you.'
  // Incoming's 2-minute timers still running (set and not cleared), and one tick of the newest of them.
  const refreshTimers = (every: { mock: { calls: unknown[][]; results: { value: unknown }[] } }) =>
    every.mock.calls.flatMap((call, index) => call[1] === INCOMING_REFRESH_MS ? [every.mock.results[index]!.value] : [])
  const running = (every: Parameters<typeof refreshTimers>[0], stop: { mock: { calls: unknown[][] } }) =>
    refreshTimers(every).filter(timer => !stop.mock.calls.some(call => call[0] === timer)).length
  const tick = (every: { mock: { calls: unknown[][] } }) => {
    const call = every.mock.calls.filter(entry => entry[1] === INCOMING_REFRESH_MS).at(-1)
    if (!call) throw new Error('No 2-minute timer was set')
    ;(call[0] as () => void)()
  }
  const list = (fields: Record<string, unknown>, items: unknown[] = []) =>
    ({ items, crossFacilityOrders: true, crossFacilityWork: true, ...fields })
  beforeEach(() => { working.selfService = undefined })
  afterEach(() => { forgetReceiving() })

  async function opened() {
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'Refresh work' })
    // Let the work list's answer, and anything it starts, settle.
    await act(async () => { await Promise.resolve() })
  }

  it.each([
    ['receives: false alone', { receives: false }],
    ['receives: false with nothing waiting or held', { receives: false, routesHere: { waiting: false, held: false } }],
  ])('at a governed facility whose work list says %s, reads nothing from Incoming and claims nothing', async (_case, fields) => {
    api.labWorkItems.mockResolvedValue(list(fields))
    await opened()
    expect(routes.incoming).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    expect(screen.getByText(OWN)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/other facilities/)
  })

  it('at a governed facility whose work list says receives: true, reads Incoming at once, every 2 minutes and on focus', async () => {
    const every = vi.spyOn(window, 'setInterval')
    api.labWorkItems.mockResolvedValue(list({ receives: true, routesHere: { waiting: false, held: false } }))
    routes.incoming.mockResolvedValue({ items: [], receives: true, crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    // Shown although nothing waits: this facility receives, so it is not a probe.
    expect(await screen.findByRole('heading', { name: 'Incoming (0)' })).toBeTruthy()
    expect(screen.getByText(HOLDS)).toBeTruthy()
    expect(screen.getByText('No lab requests from other facilities are waiting.')).toBeTruthy()
    expect(every).toHaveBeenCalledWith(expect.any(Function), INCOMING_REFRESH_MS)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(2))
    every.mockRestore()
  })

  it('at a governed facility, reads nothing from Incoming before the work list answers, then probes as today without the field', async () => {
    let answer: (value: unknown) => void = () => {}
    api.labWorkItems.mockReturnValue(new Promise(resolve => { answer = resolve }))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(routes.incoming).not.toHaveBeenCalled()
    // An earlier backend: no field, so today's probe: one read, shown because an order waits.
    await act(async () => { answer(list({})) })
    expect(await screen.findByRole('heading', { name: 'Incoming (1)' })).toBeTruthy()
    expect(routes.incoming).toHaveBeenCalledTimes(1)
  })

  it('at a laboratory the session calls checked, reads Incoming at once, in parallel with the work list, as today', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    api.labWorkItems.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
  })

  it('keeps what Incoming says of this facility: no Accept where it can’t receive now, Decline kept, and remembered', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: false, routesHere: { waiting: true, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    const incoming = await openLaboratory()
    expect(within(incoming).getByText(NOT_HERE)).toBeTruthy()
    expect(within(incoming).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(within(incoming).getByRole('button', { name: 'Decline' })).toBeTruthy()
    expect(rememberedReceiving({ id: 'facility-1', membershipId: 'member-1' }, 'lab'))
      .toEqual({ receives: false, routesHere: { waiting: true, held: false } })
    expect(rememberedReceiving({ id: 'facility-1', membershipId: 'member-2' }, 'lab')).toBeNull()
  })

  it('offers Accept and says nothing more where Incoming says this facility receives', async () => {
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: true, crossFacilityOrders: true, crossFacilityWork: true })
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    const incoming = await openLaboratory()
    expect(within(incoming).getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(within(incoming).queryByText(NOT_HERE)).toBeNull()
  })

  it('at a checked laboratory that can’t receive now, with an order sent before: Decline but no Accept, read again every 2 minutes (CC2, W1)', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    const every = vi.spyOn(window, 'setInterval')
    const stop = vi.spyOn(window, 'clearInterval')
    api.labWorkItems.mockResolvedValue(list({ receives: false }))
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: false, crossFacilityOrders: true, crossFacilityWork: true })
    const incoming = await openLaboratory()
    expect(within(incoming).getByText(NOT_HERE)).toBeTruthy()
    expect(within(incoming).queryByRole('button', { name: 'Accept' })).toBeNull()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Decline' }))
    expect(within(incoming).getByLabelText('Why can’t you take it?')).toBeTruthy()
    // As a checked laboratory read it before item 4: every 2 minutes and on focus, so a relisting shows up (W1).
    expect(running(every, stop)).toBe(1)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(2))
    // The header still says it holds work from other facilities (CC1).
    expect(screen.getByText(HOLDS)).toBeTruthy()
    every.mockRestore(); stop.mockRestore()
  })

  it('at a checked laboratory that can’t receive now, with nothing waiting: nothing shown (CC2)', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    api.labWorkItems.mockResolvedValue(list({ receives: false }))
    routes.incoming.mockResolvedValue({ items: [], receives: false, crossFacilityOrders: true, crossFacilityWork: true })
    await opened()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
  })

  it('where nothing waits (routesHere), shows no Incoming at a laboratory the session calls checked, but reads it every 2 minutes (W1)', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    const every = vi.spyOn(window, 'setInterval')
    const stop = vi.spyOn(window, 'clearInterval')
    api.labWorkItems.mockResolvedValue(list({ receives: false, routesHere: { waiting: false, held: true } }))
    routes.incoming.mockResolvedValue({ items: [], receives: false, routesHere: { waiting: false, held: true },
      crossFacilityOrders: true, crossFacilityWork: true })
    await opened()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    expect(running(every, stop)).toBe(1)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    expect(screen.getByText(HOLDS)).toBeTruthy()
    every.mockRestore(); stop.mockRestore()
  })

  it('once support lists a checked laboratory again, the 2-minute read says so: the note and Accept follow without Refresh work (W1)', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    const every = vi.spyOn(window, 'setInterval')
    api.labWorkItems.mockResolvedValue(list({ receives: false, routesHere: { waiting: false, held: false } }))
    routes.incoming.mockResolvedValue({ items: [], receives: false, routesHere: { waiting: false, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    await opened()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
    expect(screen.getByText(CANT_SEND)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    // Support lists it again, and a clinician sends it a lab request: the next 2-minute read says both.
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: true, routesHere: { waiting: true, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    await act(async () => { tick(every) })
    const incoming = (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section')!
    expect(within(incoming).getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(within(incoming).queryByText(NOT_HERE)).toBeNull()
    expect(screen.getByText(RECEIVES)).toBeTruthy()
    expect(screen.queryByText(CANT_SEND)).toBeNull()
    expect(api.labWorkItems).toHaveBeenCalledTimes(1)
    expect(rememberedReceiving({ id: 'facility-1', membershipId: 'member-1' }, 'lab'))
      .toEqual({ receives: true, routesHere: { waiting: true, held: false } })
    every.mockRestore()
  })

  it('goes by the newer of the work list and Incoming: a later Incoming answer, then a later Refresh work (W1)', async () => {
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    const every = vi.spyOn(window, 'setInterval')
    api.labWorkItems.mockResolvedValue(list({ receives: true, routesHere: { waiting: true, held: false } }))
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: true, routesHere: { waiting: true, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    const incoming = await openLaboratory()
    await waitFor(() => expect(screen.getByText(RECEIVES)).toBeTruthy())
    // Support unlists it: Incoming's next read says so, and the note above agrees with Incoming's line.
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: false, routesHere: { waiting: true, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    await act(async () => { tick(every) })
    expect(await within(incoming).findByText(NOT_HERE)).toBeTruthy()
    expect(screen.getByText(CANT_SEND)).toBeTruthy()
    expect(screen.queryByText(RECEIVES)).toBeNull()
    // Listed again, as a later Refresh work says: the work list is now the newer.
    api.labWorkItems.mockResolvedValue(list({ receives: true, routesHere: { waiting: true, held: false } }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(RECEIVES)).toBeTruthy()
    expect(screen.queryByText(CANT_SEND)).toBeNull()
    every.mockRestore()
  })

  it('at a governed laboratory this page saw receive, keeps reading Incoming after support unlists it, and shows orders once listed again (W1)', async () => {
    const every = vi.spyOn(window, 'setInterval')
    const stop = vi.spyOn(window, 'clearInterval')
    api.labWorkItems.mockResolvedValue(list({ receives: true, routesHere: { waiting: false, held: false } }))
    routes.incoming.mockResolvedValue({ items: [], receives: true, routesHere: { waiting: false, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Incoming (0)' })).toBeTruthy()
    // Unlisted: nothing waits, so nothing is shown, but it is still read.
    routes.incoming.mockResolvedValue({ items: [], receives: false, routesHere: { waiting: false, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    await act(async () => { tick(every) })
    await waitFor(() => expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull())
    expect(running(every, stop)).toBe(1)
    // Listed again, with an order sent: the next read shows it, with Accept.
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: true, routesHere: { waiting: true, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    await act(async () => { tick(every) })
    const incoming = (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section')!
    expect(within(incoming).getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(routes.incoming).toHaveBeenCalledTimes(3)
    expect(api.labWorkItems).toHaveBeenCalledTimes(1)
    every.mockRestore(); stop.mockRestore()
  })

  it('at a governed facility support unlisted, shows the orders sent before and lets them be declined (D4)', async () => {
    const every = vi.spyOn(window, 'setInterval')
    api.labWorkItems.mockResolvedValue(list({ receives: false, routesHere: { waiting: true, held: false } }))
    routes.incoming.mockResolvedValue({ items: [incomingLab()], receives: false, routesHere: { waiting: true, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    const incoming = await openLaboratory()
    expect(within(incoming).getByText(NOT_HERE)).toBeTruthy()
    expect(within(incoming).queryByRole('button', { name: 'Accept' })).toBeNull()
    routes.decline.mockResolvedValue({ route: { id: ROUTE, version: 2, effectiveState: 'declined' } })
    routes.incoming.mockResolvedValue({ items: [], receives: false, routesHere: { waiting: false, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Decline' }))
    fireEvent.change(within(incoming).getByLabelText('Why can’t you take it?'), { target: { value: 'test_not_offered' } })
    fireEvent.click(within(incoming).getAllByRole('button', { name: 'Decline' }).at(-1)!)
    // The last one declined: Incoming stays to say so, and was never read by the timer.
    expect(await within(incoming).findByText('Declined. General Hospital is told.')).toBeTruthy()
    expect(routes.decline).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE, version: 1 }, 'test_not_offered')
    expect(screen.getByRole('heading', { name: 'Incoming (0)' })).toBeTruthy()
    expect(every).not.toHaveBeenCalledWith(expect.any(Function), INCOMING_REFRESH_MS)
    expect(routes.incoming).toHaveBeenCalledTimes(2)
    every.mockRestore()
  })

  it('keeps the last answer when a later read says nothing of it, and when the page opens again within 10 minutes (CC8)', async () => {
    api.labWorkItems.mockResolvedValue(list({ receives: false }))
    await opened()
    expect(routes.incoming).not.toHaveBeenCalled()
    // A refresh without the field (a pinned-back Lab, or a failed read of it): still nothing read.
    api.labWorkItems.mockResolvedValue(list({}))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    await act(async () => { await Promise.resolve() })
    expect(routes.incoming).not.toHaveBeenCalled()
    cleanup()
    // The page opens again and its work list can't be read: the remembered answer still holds.
    api.labWorkItems.mockRejectedValue(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))
    await opened()
    expect(routes.incoming).not.toHaveBeenCalled()
    cleanup()
    // Ten minutes after it was said, it is forgotten: today's probe runs again once the work list has answered.
    const later = Date.now() + RECEIVING_MEMORY_MS
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await opened()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledTimes(1))
  })

  it('reads receives only for a member who holds the receive permission (D1)', async () => {
    working.permissions = ['lab.work-item.read']
    api.labWorkItems.mockResolvedValue(list({ receives: true, routesHere: { waiting: true, held: true } }))
    await opened()
    expect(routes.incoming).not.toHaveBeenCalled()
    expect(screen.getByText(OWN)).toBeTruthy()
    expect(rememberedReceiving({ id: 'facility-1', membershipId: 'member-1' }, 'lab')).toBeNull()
  })

  it('at a checked pharmacy, the 2-minute read that says it receives again turns the note definite (W1)', async () => {
    working.permissions = PHARMACIST
    working.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    const every = vi.spyOn(window, 'setInterval')
    api.pharmacyWorkItems.mockResolvedValue(list({ receives: false, routesHere: { waiting: false, held: false } }))
    routes.incoming.mockResolvedValue({ items: [], receives: false, routesHere: { waiting: false, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByText(/^Health ID clinicians at other facilities can’t send Yaba Diagnostics prescriptions/)).toBeTruthy()
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledWith('facility-1', 'pharmacy', undefined))
    routes.incoming.mockResolvedValue({ items: [incomingRx()], receives: true, routesHere: { waiting: true, held: false },
      crossFacilityOrders: true, crossFacilityWork: true })
    await act(async () => { tick(every) })
    expect(await screen.findByText(/^Prescriptions that Health ID clinicians at other facilities send Yaba Diagnostics appear under Incoming\. Accept/))
      .toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Incoming (1)' })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    every.mockRestore()
  })

  it('at a pharmacy, reads Incoming at once where its work list says it receives', async () => {
    working.permissions = PHARMACIST
    api.pharmacyWorkItems.mockResolvedValue(list({ receives: true }))
    routes.incoming.mockResolvedValue({ items: [], receives: true, crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Incoming (0)' })).toBeTruthy()
    expect(screen.getByText(/^Prescriptions accepted here, from this facility and from other facilities/)).toBeTruthy()
    expect(routes.incoming).toHaveBeenCalledWith('facility-1', 'pharmacy', undefined)
  })
})
