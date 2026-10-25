import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Laboratory, Pharmacy } from '../Operations'
import { INCOMING_REFRESH_MS } from '../IncomingOrders'

/**
 * Orders other facilities sent here, waiting to be accepted (Novu, P4c, SPEC-FINAL §4.1, §13.3): a preview without the
 * patient, the clinical information, the instructions or the licence number; found by the patient's Health ID; accepted
 * with the patient's Health ID or date of birth (five wrong tries that name the order lock it here; a date of birth
 * names it only with the order's reference from the patient's app), a pharmacy giving its reason; declined
 * with a reason; read again on focus and every 2 minutes; paused with no Accept while orders between facilities are off;
 * and not shown at all where the backend has no such route.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), decline: vi.fn() }))
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
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

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
