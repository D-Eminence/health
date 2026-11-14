import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { Laboratory } from '../Operations'
import { forgetReceiving } from '../../orderRoutes'
import { forgetCannotCompleteServed } from '../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { focusWhenShown } from '../../../__tests__/focusWhenShown'

/**
 * The Laboratory page and the Clinical record move focus in the commit that shows where it goes. From an effect, focus
 * moved a task after a render that followed a request, and a check made as soon as that was shown (findBy on a busy
 * runner, as on health#16's CI) found focus still where it was. Each test answers the request outside act, as a fetch's
 * answer arrives, and reads focus at the moment its target is shown.
 */
const api = vi.hoisted(() => ({
  labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn(), createLabAccession: vi.fn(),
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), acceptPrescription: vi.fn(), updateEncounter: vi.fn(),
}))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(), cannotComplete: vi.fn(),
  findCorrectable: vi.fn(), correctWrongPatient: vi.fn(), attestation: vi.fn(), destinations: vi.fn(), send: vi.fn(), routes: vi.fn(),
  withdraw: vi.fn() }))
const working = vi.hoisted(() => ({ roles: [] as string[], permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
  orderRoutesApi: routes,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ade Okon', facility: { id: 'facility-1', membershipId: 'member-1',
      name: 'Yaba Diagnostics', roles: working.roles, permissions: working.permissions } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }

const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }

/** Settles a request outside act: React renders the outcome in one task and would run its effects in a later one. */
function answer(settle: () => void) {
  environment.IS_REACT_ACT_ENVIRONMENT = false
  settle()
}

/** A request's answer, settled from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = undefined
  vi.unstubAllEnvs()
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

describe('the Laboratory page (Operations)', () => {
  const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
  const routeCard = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE_ID, reference: '9C1B2D3E', effectiveState: 'accepted',
    access: 'work', orderingFacilityName: 'General Hospital', ordererName: 'Dr Ade Okon', version: 3, endedKind: null, ...overrides })
  const labItem = (overrides: Record<string, unknown> = {}) => ({ id: 'w-routed', patientId: 'a0000000-0000-4000-8000-0000004f9c2e',
    version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: null, accessionNumber: null,
    acceptedAt: '2026-10-21T10:00:00.000Z', priority: 'routine', specimenStatuses: [], orderRoute: routeCard(),
    patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' }, ...overrides })
  /** A work list from a backend that serves item 3's report (numeric route versions) and D17, not D18. */
  const list = (...items: unknown[]) => ({ items, crossFacilityOrders: true, crossFacilityWork: true, receives: true,
    routesHere: { waiting: false, held: true }, lateCorrection: true })

  beforeEach(() => {
    working.roles = ['lab']
    working.permissions = ['lab.work-item.read', 'lab.accession.create', 'lab.accession.read', 'lab.order-route.receive']
    routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true, receives: true })
  })

  // A refusal whose list read again no longer offers the form: its words stay in the row, which takes focus (D17's UX-2).
  it('has focus on what the row says as soon as the list read again shows it', async () => {
    const reread = deferred<unknown>()
    api.labWorkItems.mockResolvedValueOnce(list(labItem())).mockReturnValueOnce(reread.promise)
    routes.reportWrongPatient.mockRejectedValueOnce(new HidApiError(409, 'Ended', { code: 'ORDER_ROUTE_ALREADY_ENDED' }))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    const item = screen.getByText('Haemoglobin').closest('.staff-list-item') as HTMLElement
    fireEvent.click(await within(item).findByRole('button', { name: /^This isn’t the order’s patient/ }))
    fireEvent.click(within(item).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(item).getByLabelText('What happened, for Health ID support'), { target: { value: 'Picked the wrong order' } })
    fireEvent.click(within(item).getByRole('checkbox', { name: 'The person I accepted this order for is not Tunde Bello.' }))
    fireEvent.click(within(item).getByRole('button', { name: 'End this order' }))
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    const shown = focusWhenShown('#lab-w-routed-said')
    answer(() => reread.resolve(list(labItem({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read',
      endedKind: 'order_changed', version: 4 }) }))))
    const { element, focused } = await shown
    expect(element.textContent).toMatch(/^This order has already ended/)
    expect(focused).toBe(element)
  })
})

describe('the Clinical record', () => {
  const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
  const LINKED = 'e0000000-0000-4000-8000-000000000002'
  const encounter = (id: string, status: string) => ({ id, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status, startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 })
  const rx = { patientId: PATIENT, encounterId: LINKED, facilityId: 'facility-1', createdAt: '2026-10-01T08:05:00.000Z',
    doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral', instructions: 'Take with food', id: 'rx-1',
    medicationDisplay: 'Amoxicillin 500 mg capsules', frequency: 'Three times daily', status: 'active', rowVersion: '3', orderRoute: null }
  const page = (items: unknown[]) => ({ items, nextCursor: null, crossFacilityOrders: true })

  beforeEach(() => {
    working.roles = ['doctor']
    working.permissions = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.order-route.send']
    api.lookupPatient.mockResolvedValue(lookup)
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true,
      writeAllowed: true })
    api.encounters.mockResolvedValue({ items: [encounter(ENCOUNTER, 'in_progress')], nextCursor: null })
    api.encounter.mockResolvedValue(encounter(LINKED, 'finished'))
    routes.attestation.mockResolvedValue({ kind: 'prescription', version: 'order-route-prescription-attestation-v1',
      text: 'I confirm that {patient} agreed that {orderingFacility} sends this prescription to {receivingFacility}.' })
    routes.destinations.mockResolvedValue({ items: [] })
  })

  // An order the Overview linked to takes focus once its list shows it, in the commit that does.
  it('has focus on the linked order as soon as its list shows it', async () => {
    const linked = deferred<unknown>()
    api.records.mockImplementation((_facilityId: string, _patientId: string, encounterId: string) =>
      encounterId === LINKED ? linked.promise : Promise.resolve(page([])))
    render(<MemoryRouter initialEntries={[{ pathname: '/provider/clinical', state: { order: { patientId: PATIENT, encounterId: LINKED,
      kind: 'prescription', orderId: 'rx-1' } } }]}><Clinical /></MemoryRouter>)
    await waitFor(() => expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT, LINKED, 'prescriptions'))
    const shown = focusWhenShown('#record-rx-1-title')
    answer(() => linked.resolve(page([rx])))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})
