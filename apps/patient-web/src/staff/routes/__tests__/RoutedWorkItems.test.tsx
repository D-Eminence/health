import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Laboratory, Pharmacy } from '../Operations'

/**
 * Work from an order another facility sent here, on the Lab and Pharmacy work lists (Novu, P4c, SPEC-FINAL §13.3): it
 * names the ordering facility, the reference and who ordered it; the patient is named (name, sex, date of birth, the
 * Health ID's last 4) only on such a row, which carries the patient card, and every other row stays masked; a cancelled
 * order says to stop work; ORDER_ROUTE_CLOSED and a paused switch are said on every action; and a paused switch is said
 * above the list.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn(), createLabAccession: vi.fn(), dispense: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), reportWrongPatient: vi.fn() }))
const working = vi.hoisted(() => ({ permissions: [] as string[], selfService: undefined as
  { review: string; organizationType: string } | undefined }))
vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: routes }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: { id: 'facility-1', membershipId: 'member-1',
    name: 'Yaba Diagnostics', roles: ['lab'], permissions: working.permissions,
    ...(working.selfService ? { selfService: working.selfService } : {}) } } } } }),
}))

const routed = (overrides: Record<string, unknown> = {}) => ({ id: 'w-routed', patientId: 'a0000000-0000-4000-8000-0000004f9c2e',
  version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T10:00:00.000Z',
  priority: 'urgent',
  orderRoute: { id: 'r1', reference: '9C1B2D3E', effectiveState: 'accepted', access: 'work', orderingFacilityName: 'General Hospital',
    ordererName: 'Dr Ade Okon', ordererLicence: { body: 'MDCN', number: 'MDCN/12345' } },
  patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' }, ...overrides })
const local = { id: 'w-local', patientId: 'a0000000-0000-4000-8000-000000aa11bb', version: 1, status: 'accepted', testName: 'Malaria parasite',
  accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T09:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  working.permissions = ['lab.work-item.read', 'lab.accession.create']
  working.selfService = undefined
  api.labWorkItems.mockResolvedValue({ items: [routed(), local], crossFacilityOrders: true, crossFacilityWork: true })
})
afterEach(() => { vi.unstubAllEnvs() })

function row(text: string) { return screen.getByText(text).closest('.staff-list-item') as HTMLElement }

describe('work from another facility on the Laboratory page', () => {
  it('names the ordering facility and the patient on that row only', async () => {
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    const fromElsewhere = row('Haemoglobin')
    expect(within(fromElsewhere).getByText(/^Tunde Bello, male, born 12 Mar 1985, Health ID ending 7KQ2 · Accepted /)).toBeTruthy()
    expect(within(fromElsewhere).getByText('From General Hospital · Ref 9C1B2D3E · Ordered by Dr Ade Okon · Licence on record: MDCN MDCN/12345')).toBeTruthy()
    const ours = row('Malaria parasite')
    expect(within(ours).getByText(/^Patient ••••aa11bb · Accepted /)).toBeTruthy()
    expect(ours.textContent).not.toMatch(/From |Tunde/)
  })

  it('says to stop work on a cancelled order, and that a lapsed one takes no more work', async () => {
    api.labWorkItems.mockResolvedValue({ items: [
      routed({ orderRoute: { ...routed().orderRoute, effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed' } }),
      routed({ id: 'w-2', testName: 'Lipid profile', orderRoute: { ...routed().orderRoute, effectiveState: 'expired', access: 'read' } }),
    ], crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText('Cancelled by General Hospital: stop work.')).toBeTruthy()
    expect(screen.getByText('Nothing was released within 30 days of accepting it, so this order has lapsed: no more work can be recorded on it.')).toBeTruthy()
  })

  it('says a closed order on any action', async () => {
    api.createLabAccession.mockRejectedValue(new HidApiError(409, 'Closed', { code: 'ORDER_ROUTE_CLOSED' }))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    fireEvent.click(within(row('Haemoglobin')).getByRole('button', { name: 'Prepare accession' }))
    fireEvent.change(screen.getByLabelText(/^Specimen type/), { target: { value: 'Venous blood' } })
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Collect at the counter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create accession' }))
    expect(await screen.findByText('This order from another facility is closed: it was cancelled, or its time for work has ended, so nothing more can be recorded on it. Refresh the list.')).toBeTruthy()
  })

  it('says work on orders from other facilities is paused, and what a paused action means', async () => {
    api.labWorkItems.mockResolvedValue({ items: [routed()], crossFacilityOrders: true, crossFacilityWork: false })
    api.createLabAccession.mockRejectedValue(new HidApiError(423, 'Paused', { code: 'CROSS_FACILITY_ORDERS_UNAVAILABLE' }))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText('Work on orders from other facilities is paused by Health ID.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare accession' }))
    fireEvent.change(screen.getByLabelText(/^Specimen type/), { target: { value: 'Venous blood' } })
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Collect at the counter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create accession' }))
    expect(await screen.findByText('Health ID has paused work on orders from other facilities. Try again later.')).toBeTruthy()
  })

  it('says work from other facilities is paused, and hidden, when the list is paused and shows none (the backend’s answer)', async () => {
    // With route access off, Lab hides every route-backed item: the list holds this facility's own work only.
    working.permissions = ['lab.work-item.read', 'lab.accession.create', 'lab.order-route.receive']
    working.selfService = { review: 'reviewed', organizationType: 'laboratory' }
    api.labWorkItems.mockResolvedValue({ items: [local], crossFacilityOrders: true, crossFacilityWork: false })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText('Work on orders from other facilities is paused by Health ID: any you accepted are hidden from '
      + 'this list until it resumes. They are not cancelled.')).toBeTruthy()
  })

  it('says it at a pharmacy too, even with nothing listed', async () => {
    working.permissions = ['pharmacy.work-item.read', 'pharmacy.order-route.receive']
    working.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    api.pharmacyWorkItems.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: false })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByText(/^Work on orders from other facilities is paused by Health ID: any you accepted are hidden/)).toBeTruthy()
  })

  it('says nothing of a pause at a hospital’s laboratory, which is never sent orders', async () => {
    working.permissions = ['lab.work-item.read', 'lab.order-route.receive']
    working.selfService = { review: 'reviewed', organizationType: 'hospital' }
    api.labWorkItems.mockResolvedValue({ items: [local], crossFacilityOrders: true, crossFacilityWork: false })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Malaria parasite')
    expect(screen.queryByText(/paused by Health ID/)).toBeNull()
  })

  it('says nothing of other facilities on a list without such work', async () => {
    api.labWorkItems.mockResolvedValue({ items: [local], crossFacilityOrders: true, crossFacilityWork: false })
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Malaria parasite')
    expect(screen.queryByText(/paused by Health ID/)).toBeNull()
  })
})

describe('work from another facility on the Pharmacy page', () => {
  it('names the prescriber’s facility and licence, the patient, and says why it can’t be dispensed', async () => {
    working.permissions = ['pharmacy.work-item.read', 'pharmacy.dispensing.create']
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ id: 'p1', patientId: 'a0000000-0000-4000-8000-0000004f9c2e', version: 1,
      acceptedAt: '2026-10-21T10:00:00.000Z', medication: { display: 'Amoxicillin 500 mg capsules' }, doseQuantity: 500, doseUnit: 'mg',
      routeCode: 'oral', frequency: 'Three times daily', instructions: 'Take with food', dispensing: null,
      orderRoute: { id: 'r1', reference: '9C1B2D3E', effectiveState: 'accepted', access: 'work', orderingFacilityName: 'General Hospital',
        ordererName: 'Dr Ade Okon' },
      patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' } }],
    crossFacilityOrders: true, crossFacilityWork: true })
    api.dispense.mockRejectedValue(new HidApiError(409, 'No', { code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE' }))
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    const item = (await screen.findByText('Amoxicillin 500 mg capsules')).closest('.staff-list-item') as HTMLElement
    expect(within(item).getByText(/^Tunde Bello, male, born 12 Mar 1985, Health ID ending 7KQ2 · 500 mg/)).toBeTruthy()
    expect(within(item).getByText('From General Hospital · Ref 9C1B2D3E · Ordered by Dr Ade Okon')).toBeTruthy()
    fireEvent.change(within(item).getByLabelText(/^Quantity dispensed/), { target: { value: '21' } })
    fireEvent.change(within(item).getByLabelText(/^Reason/), { target: { value: 'Dispensed at the counter' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))
    expect(await within(item).findByText('Not dispensable: General Hospital changed or cancelled this prescription, or its time for dispensing has ended. A new prescription is needed.')).toBeTruthy()
  })
})

/**
 * Item 3 (SPEC-FINAL §8.1; B1, B3, C8): a routed work row offers "This isn't the order's patient" only while its order may
 * be worked, from a backend that sends the route's version, to a member who receives such orders; once ended the row
 * leaves the list (only a member holding the patient's own consent still sees it, saying how it ended); only the writes
 * the services would refuse as closed are hidden, never Open accession; and the person is checked before any work.
 */
describe('this isn’t the order’s patient, on a work row', () => {
  const RECEIVER = ['lab.work-item.read', 'lab.accession.create', 'lab.accession.read', 'lab.order-route.receive']
  const ENDED = { route: { id: 'r1', version: 4, effectiveState: 'cancelled', endedKind: 'wrong_patient' }, resultsVoided: 0,
    resultReportsMarked: 0, dispensingReversed: false, replayed: false }
  const current = (overrides: Record<string, unknown> = {}) => ({ ...routed().orderRoute, version: 3, endedKind: null, ...overrides })
  const labItems = (...items: unknown[]) => ({ items, crossFacilityOrders: true, crossFacilityWork: true })

  beforeEach(() => {
    working.permissions = RECEIVER
    routes.reportWrongPatient.mockResolvedValue(ENDED)
  })

  async function report(item: HTMLElement, note = 'Picked the wrong order from the list') {
    fireEvent.click(within(item).getByRole('button', { name: 'This isn’t the order’s patient' }))
    fireEvent.click(within(item).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(item).getByLabelText('What happened, for Health ID support'), { target: { value: note } })
    fireEvent.click(within(item).getByRole('checkbox', { name: 'The person I accepted this order for is not Tunde Bello.' }))
    fireEvent.click(within(item).getByRole('button', { name: 'End this order' }))
  }

  it('is offered only for work the order still allows, from a backend that sends its version, to a member who receives', async () => {
    api.labWorkItems.mockResolvedValue(labItems(
      routed({ orderRoute: current() }),
      routed({ id: 'w-old', testName: 'Lipid profile' }),
      routed({ id: 'w-read', testName: 'Blood film', orderRoute: current({ access: 'read' }) }),
      routed({ id: 'w-string', testName: 'Malaria RDT', orderRoute: current({ version: '3' }) }),
      routed({ id: 'w-ended', testName: 'Urea', patient: undefined, orderRoute: current({ access: 'none', effectiveState: 'cancelled', endedKind: 'wrong_patient' }) }),
      local))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    const offered = (text: string) => within(row(text)).queryByRole('button', { name: 'This isn’t the order’s patient' }) !== null
    expect(offered('Haemoglobin')).toBe(true)
    // An older backend's card (no version, B9), work that may only be read, an ended order and this facility's own work: none.
    expect(['Lipid profile', 'Blood film', 'Malaria RDT', 'Urea', 'Malaria parasite'].filter(offered)).toEqual([])
    expect(routes.reportWrongPatient).not.toHaveBeenCalled()
  })

  it('is not offered to a member who doesn’t receive orders from other facilities', async () => {
    working.permissions = ['lab.work-item.read', 'lab.accession.create']
    api.labWorkItems.mockResolvedValue(labItems(routed({ orderRoute: current() })))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    expect(screen.queryByRole('button', { name: 'This isn’t the order’s patient' })).toBeNull()
  })

  it('ends the order from its row: the message stays, and the row goes once the list is read again (B1)', async () => {
    api.labWorkItems.mockResolvedValueOnce(labItems(routed({ orderRoute: current() }), local)).mockResolvedValue(labItems(local))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    await report(row('Haemoglobin'))
    expect(await screen.findByText('Ended: Haemoglobin, reference 9C1B2D3E. Tunde Bello is told in the Health ID app.')).toBeTruthy()
    expect(routes.reportWrongPatient).toHaveBeenCalledWith('facility-1', 'lab', { id: 'r1', version: 3 },
      { reason: 'wrong_order_chosen', note: 'Picked the wrong order from the list' }, expect.any(String))
    await waitFor(() => expect(screen.queryByText('Haemoglobin')).toBeNull())
    expect(screen.getByText('Malaria parasite')).toBeTruthy()
    expect(screen.getByText(/^Ended: Haemoglobin/)).toBeTruthy()
  })

  it('reads the list again after 412 and keeps the form open at the order’s new version', async () => {
    api.labWorkItems.mockResolvedValueOnce(labItems(routed({ orderRoute: current() })))
      .mockResolvedValue(labItems(routed({ orderRoute: current({ version: 4, effectiveState: 'completed' }) })))
    routes.reportWrongPatient.mockRejectedValueOnce(new HidApiError(412, 'Changed', { code: 'VERSION_CONFLICT' }))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    await report(row('Haemoglobin'))
    expect(await screen.findByText('Something was recorded on this order a moment ago. It has been reloaded: check what will happen and try again.')).toBeTruthy()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    fireEvent.click(within(row('Haemoglobin')).getByRole('button', { name: 'End this order' }))
    await waitFor(() => expect(routes.reportWrongPatient).toHaveBeenCalledTimes(2))
    expect(routes.reportWrongPatient.mock.calls[1]![2]).toEqual({ id: 'r1', version: 4 })
  })

  it('says how an ended order ended, to a member who still holds the patient’s consent', async () => {
    api.labWorkItems.mockResolvedValue(labItems(
      routed({ patient: undefined, orderRoute: current({ access: 'none', effectiveState: 'cancelled', endedKind: 'wrong_patient', version: 4 }) }),
      routed({ id: 'w-2', testName: 'Lipid profile', orderRoute: current({ access: 'read', effectiveState: 'cancelled', endedKind: 'support' }) }),
      routed({ id: 'w-3', testName: 'Blood film', orderRoute: current({ access: 'read', effectiveState: 'cancelled', endedKind: 'order_changed' }) }),
      routed({ id: 'w-4', testName: 'Urea', patient: undefined, orderRoute: current({ access: 'none', effectiveState: 'completed', endedKind: 'wrong_patient' }) })))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    const ended = 'You ended this order: it was accepted for someone who is not its patient. Nothing more can be recorded on it.'
    expect(within(row('Haemoglobin')).getByText(ended)).toBeTruthy()
    expect(within(row('Urea')).getByText(ended)).toBeTruthy()
    expect(within(row('Haemoglobin')).getByText(/^Patient ••••4f9c2e · Accepted /)).toBeTruthy()
    expect(within(row('Lipid profile')).getByText('Closed by Health ID support: stop work.')).toBeTruthy()
    expect(within(row('Blood film')).getByText('Cancelled by General Hospital: stop work.')).toBeTruthy()
    expect(row('Haemoglobin').textContent).not.toMatch(/Cancelled by|is closed/)
  })

  it('hides only the writes the services would refuse as closed, and never Open accession (B3)', async () => {
    api.labWorkItems.mockResolvedValue(labItems(
      routed({ orderRoute: current({ access: 'read' }), accessionId: 'acc-1', accessionNumber: 'ACC-1' }),
      routed({ id: 'w-2', testName: 'Lipid profile', orderRoute: current({ access: 'read', effectiveState: 'cancelled', endedKind: 'order_changed' }) }),
      routed({ id: 'w-3', testName: 'Blood film', orderRoute: current({ access: 'read', effectiveState: 'expired' }) }),
      routed({ id: 'w-4', testName: 'Urea', patient: undefined, orderRoute: current({ access: 'none', effectiveState: 'completed', endedKind: 'wrong_patient' }) }),
      routed({ id: 'w-5', testName: 'Creatinine', patient: undefined, orderRoute: current({ access: 'none' }) }),
      routed({ id: 'w-6', testName: 'Sodium', patient: undefined, orderRoute: current({ access: 'none', effectiveState: 'cancelled', endedKind: 'wrong_patient' }),
        accessionId: 'acc-6', accessionNumber: 'ACC-6' })))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    const action = (text: string) => within(row(text)).queryAllByRole('button').map(button => button.textContent)
    expect(action('Haemoglobin')).toEqual(['Open accession'])
    expect(action('Lipid profile')).toEqual([])
    expect(action('Blood film')).toEqual([])
    expect(action('Urea')).toEqual([])
    // A live order the member works under the patient's own consent: the services and consent decide.
    expect(action('Creatinine')).toEqual(['Prepare accession'])
    expect(action('Sodium')).toEqual(['Open accession'])
  })

  it('checks the person against the patient beside Prepare accession (C8)', async () => {
    api.labWorkItems.mockResolvedValue(labItems(routed({ orderRoute: current() }), local))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    const item = row('Haemoglobin')
    const check = within(item).getByText('Check that the person is Tunde Bello before you take a sample.')
    const prepare = within(item).getByRole('button', { name: 'Prepare accession' })
    expect(check.compareDocumentPosition(prepare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row('Malaria parasite').textContent).not.toMatch(/Check that the person/)
  })

  it('at a pharmacy: checks the person above Record full dispensing, hides the writes of an ended order, and says a dispensing is reversed', async () => {
    working.permissions = ['pharmacy.work-item.read', 'pharmacy.dispensing.create', 'pharmacy.dispensing.read', 'pharmacy.dispensing.reverse',
      'pharmacy.order-route.receive']
    const prescription = (overrides: Record<string, unknown> = {}) => ({ id: 'p1', patientId: 'a0000000-0000-4000-8000-0000004f9c2e',
      version: 1, acceptedAt: '2026-10-21T10:00:00.000Z', medication: { display: 'Amoxicillin 500 mg capsules' }, doseQuantity: 500,
      doseUnit: 'mg', routeCode: 'oral', frequency: 'Three times daily', instructions: null, dispensing: null,
      orderRoute: current(), patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' }, ...overrides })
    api.pharmacyWorkItems.mockResolvedValue({ items: [
      prescription(),
      prescription({ id: 'p2', medication: { display: 'Paracetamol 500 mg tablets' }, dispensing: { id: 'd2', reversed: false } }),
      prescription({ id: 'p3', medication: { display: 'Metformin 500 mg tablets' }, dispensing: { id: 'd3', reversed: false }, patient: undefined,
        orderRoute: current({ access: 'none', effectiveState: 'completed', endedKind: 'wrong_patient' }) }),
      prescription({ id: 'p4', medication: { display: 'Ibuprofen 400 mg tablets' }, patient: undefined,
        orderRoute: current({ access: 'none', effectiveState: 'cancelled', endedKind: 'wrong_patient' }) }),
    ], crossFacilityOrders: true, crossFacilityWork: true })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    const first = (await screen.findByText('Amoxicillin 500 mg capsules')).closest('.staff-list-item') as HTMLElement
    const check = within(first).getByText('Check that the person is Tunde Bello, or is collecting for them, before you hand anything over.')
    expect(check.compareDocumentPosition(within(first).getByRole('button', { name: 'Record full dispensing' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const ended = (text: string) => screen.getByText(text).closest('.staff-list-item') as HTMLElement
    for (const text of ['Metformin 500 mg tablets', 'Ibuprofen 400 mg tablets']) {
      expect(within(ended(text)).queryByRole('button', { name: /Record full dispensing|Reverse dispensing|This isn’t/ }), text).toBeNull()
    }
    const dispensed = ended('Paracetamol 500 mg tablets')
    expect(within(dispensed).getByRole('button', { name: 'Reverse dispensing' })).toBeTruthy()
    fireEvent.click(within(dispensed).getByRole('button', { name: 'This isn’t the order’s patient' }))
    expect(within(dispensed).getByText('The dispensing you recorded is reversed in the record.')).toBeTruthy()
    fireEvent.click(within(first).getByRole('button', { name: 'This isn’t the order’s patient' }))
    expect(within(first).queryByText(/dispensing you recorded/)).toBeNull()
    expect(within(first).getByText('Someone collecting for Tunde Bello with their agreement is not the wrong person: don’t use this for them.')).toBeTruthy()
  })
})

