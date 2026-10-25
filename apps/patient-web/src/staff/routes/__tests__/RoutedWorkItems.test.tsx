import { fireEvent, render, screen, within } from '@testing-library/react'
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
const working = vi.hoisted(() => ({ permissions: [] as string[], selfService: undefined as
  { review: string; organizationType: string } | undefined }))
vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: { incoming: vi.fn(async () => ({ items: [], crossFacilityOrders: true, crossFacilityWork: true })) } }))
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
      routed({ orderRoute: { ...routed().orderRoute, effectiveState: 'cancelled', access: 'read' } }),
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
