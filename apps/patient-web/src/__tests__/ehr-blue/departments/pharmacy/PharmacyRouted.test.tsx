import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, confirmPatient, CREATE, DISPENSING_READ, expectNoFullPatientIds, fillDispensing, otherActions, pickCard, PRESCRIPTIONS,
  pressDispense, prescriptionCard, READ, RECEIVE, REVERSE, ROUTE_ID, routeCard, routed, row, showTab, tick,
} from './fixtures'

/**
 * Work from prescriptions other facilities send to a pharmacy (Novu): Incoming, the patient named only on such work, where
 * it came from, the hand-over check, how an ended or lapsed order is said, the paused switch, "This isn’t the order’s
 * patient" and "We can’t complete this order" from the record, what a refusal said once the list is read again, and
 * "Correct an order that has ended". The reused staff parts keep their own words.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), decline: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(),
  cannotComplete: vi.fn(), findCorrectable: vi.fn(), correctWrongPatient: vi.fn() }))
const strays = vi.hoisted(() => new Set<string>())

const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
  const { commerceMock } = await import('../harness')
  return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
})
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, { get(target, key) {
    if (typeof key === 'string' && !(key in target)) strays.add(key)
    return target[key as keyof typeof target]
  } }),
  orderRoutesApi: routes,
}))

const PHARMACIST = [READ, CREATE, DISPENSING_READ, REVERSE, RECEIVE]
const NAME = 'Amoxicillin 250 mg capsules'
const answer = (items: PharmacyWorkItem[], fields: Record<string, unknown> = {}) =>
  ({ items, crossFacilityOrders: true, crossFacilityWork: true, ...fields })
const WRONG_PATIENT_ENDED = { route: { id: ROUTE_ID, version: 4, effectiveState: 'cancelled', endedKind: 'wrong_patient' },
  resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: false, replayed: false }
const NOT_COMPLETED = { route: { id: ROUTE_ID, version: 4, effectiveState: 'cancelled', endedKind: 'receiving_unable' },
  reason: 'needs_prescriber_review', readUntil: new Date(Date.now() - 1000).toISOString(), specimensCollected: 0, resultsRecorded: 0,
  criticalCandidates: 0, replayed: false }

function working(permissions: string[], selfService?: FakeFacility['selfService']) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'],
    ...(selfService ? { selfService } : {}) })
}

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  working(PHARMACIST)
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  routes.reportWrongPatient.mockResolvedValue(WRONG_PATIENT_ENDED)
  routes.cannotComplete.mockResolvedValue(NOT_COMPLETED)
  api.pharmacyWorkItems.mockResolvedValue(answer([routed(), accepted]))
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  expect([...strays]).toEqual([])
  vi.unstubAllEnvs()
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

function renderPage() {
  return renderDept(<Pharmacy />, { route: PRESCRIPTIONS })
}
async function renderList() {
  renderPage()
  await screen.findByRole('button', { name: NAME })
}
const back = () => screen.getByRole('button', { name: 'Back to prescriptions' })
async function openRouted() {
  await renderList()
  fireEvent.click(screen.getByRole('button', { name: NAME }))
}

describe('a prescription from another facility', () => {
  it('names the patient and where it came from on its row only', async () => {
    await renderList()
    const mine = row(NAME)
    expect(within(mine).getByText('Patient One')).toBeTruthy()
    expect(within(mine).getByText('Born 1 Jan 1990')).toBeTruthy()
    expect(mine.textContent).toContain('250 mg · Three times daily')
    expect(within(mine).getByText('From Demo Hospital')).toBeTruthy()
    const ours = row('Amoxicillin 500 mg capsule')
    expect(within(ours).getByText('Patient ••••6f8a10')).toBeTruthy()
    expect(ours.textContent).not.toMatch(/From |Patient One/)
    expectNoFullPatientIds()
  })

  it('shows the order on the record, and asks to check the person before handing anything over', async () => {
    await openRouted()
    expect(screen.getByRole('region', { name: 'Patient: Patient One' }).textContent).toContain('Health ID ending AAA2')
    expect(within(prescriptionCard()).getByText('From Demo Hospital · Ref 9C1B2D3E · Ordered by Dr Demo Prescriber')).toBeTruthy()
    const form = screen.getByRole('form', { name: 'Dispense' })
    const check = within(form).getByText('Check that the person is Patient One, or is collecting for them, before you hand anything over.')
    const submit = within(form).getByRole('button', { name: 'Dispense' })
    expect(check.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says which facility changed it when Pharmacy won’t dispense it', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(409, 'No', { code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE' }))
    await openRouted()
    tick()
    fillDispensing({ quantity: '21', reason: 'Dispensed at the counter' })
    pressDispense()
    const sheet = await confirmPatient('Dispense')
    // The patient confirmed is the one the order names.
    expect(within(sheet).getByRole('region', { name: 'Patient: Patient One' })).toBeTruthy()
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, routed(), 21, 'mg', 'Dispensed at the counter')
    expect((await screen.findByRole('alert')).textContent).toBe('Not dispensableDemo Hospital changed or cancelled this '
      + 'prescription, or its time for dispensing has ended. A new prescription is needed.')
  })

  it('says how an ended or lapsed order stands, on the list and the record, and offers no writes on it', async () => {
    api.pharmacyWorkItems.mockResolvedValue(answer([
      routed({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed', version: 4 }) }),
      routed({ id: 'f6a7b8c9-routed-2', medication: { display: 'Paracetamol 500 mg tablets' }, dispensing: { id: 'd2', reversed: false },
        orderRoute: routeCard({ id: 'r-2', effectiveState: 'expired', access: 'read' }) }),
    ]))
    await renderList()
    showTab('All')
    expect(within(row(NAME)).getByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
    expect(within(row('Paracetamol 500 mg tablets')).getByText('This order has lapsed: no more work can be recorded on it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: NAME }))
    expect(within(prescriptionCard()).getByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Other actions' })).toBeNull()
    expect(screen.getByText('This order is closed')).toBeTruthy()
    expect(screen.getByText('No more work can be recorded on it.')).toBeTruthy()
    fireEvent.click(back())
    fireEvent.click(screen.getByRole('button', { name: 'Paracetamol 500 mg tablets' }))
    expect(within(prescriptionCard()).getByText('Nothing was released within 30 days of accepting it, so this order has lapsed: no more work can be recorded on it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
  })
})

describe('work between facilities paused', () => {
  it('says so above the list and on the record while such work is listed', async () => {
    api.pharmacyWorkItems.mockResolvedValue(answer([routed()], { crossFacilityWork: false }))
    await renderList()
    expect(screen.getByText('Work on orders from other facilities is paused by Health ID.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: NAME }))
    expect(screen.getAllByText('Work on orders from other facilities is paused by Health ID.').filter(notice => !notice.closest('[hidden]'))).toHaveLength(1)
  })

  it('says accepted work is hidden, not cancelled, at a pharmacy with none listed', async () => {
    working([READ, RECEIVE], { review: 'reviewed', organizationType: 'pharmacy' })
    api.pharmacyWorkItems.mockResolvedValue(answer([], { crossFacilityWork: false }))
    renderPage()
    expect(await screen.findByText('Work on orders from other facilities is paused by Health ID: any you accepted are hidden from '
      + 'this list until it resumes. They are not cancelled.')).toBeTruthy()
  })

  it('says nothing of it on a list without such work, to a member who doesn’t receive', async () => {
    working([READ, CREATE])
    api.pharmacyWorkItems.mockResolvedValue(answer([accepted], { crossFacilityWork: false }))
    renderPage()
    await screen.findByRole('button', { name: 'Amoxicillin 500 mg capsule' })
    expect(screen.queryByText(/paused by Health ID/)).toBeNull()
  })
})

describe('Incoming, at a pharmacy that receives prescriptions', () => {
  const incomingRx = { id: ROUTE_ID, reference: '9C1B2D3E', version: 1, effectiveState: 'sent', orderingFacilityName: 'Demo Hospital',
    orderer: { name: 'Dr Demo Prescriber', licenceBody: null }, medication: { codeSystem: null, code: null, display: NAME },
    doseQuantity: '250', doseUnit: 'mg', routeCode: 'oral', frequency: 'Three times daily', startsOn: '2026-10-20', endsOn: '2026-10-27',
    prescribedAt: '2026-10-20T08:55:00.000Z', sentAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z',
    acceptLocked: false, attemptsLeft: 5 }

  beforeEach(() => {
    working([READ, RECEIVE], { review: 'reviewed', organizationType: 'pharmacy' })
    routes.incoming.mockResolvedValue({ items: [incomingRx], crossFacilityOrders: true, crossFacilityWork: true })
  })

  it('says where the work comes from, shows what waits, and reads the list again once one is accepted', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce(answer([])).mockResolvedValue(answer([routed()]))
    routes.accept.mockResolvedValue({ route: { id: ROUTE_ID, version: 2, effectiveState: 'accepted' }, workItemId: 'w1', patient: {
      fullName: 'Patient One', sex: 'female', dateOfBirth: '1990-01-01', healthIdLast4: 'AAA2' }, clinicalInformation: null,
    instructions: null, orderer: { licenceBody: null, licenceNumber: null }, replayed: false })
    renderPage()
    const incoming = (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section') as HTMLElement
    expect(incoming.closest('.hid-ehr-dept-embedded')).toBeTruthy()
    expect(routes.incoming).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'pharmacy', undefined)
    expect(screen.getByText(/^Prescriptions that Health ID clinicians at other facilities send Demo Pharmacy appear under Incoming/)).toBeTruthy()
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept' }))
    fireEvent.change(within(incoming).getByLabelText(/^Patient’s Health ID/), { target: { value: 'HID-ZDEMAAA2' } })
    fireEvent.change(within(incoming).getByLabelText(/^Reason for accepting/), { target: { value: 'Patient at the counter with their card' } })
    fireEvent.click(within(incoming).getByRole('button', { name: 'Accept order' }))
    await waitFor(() => expect(routes.accept).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'pharmacy', { id: ROUTE_ID, version: 1 },
      { kind: 'health_id', value: 'HID-ZDEMAAA2' }, 'Patient at the counter with their card', expect.any(String), undefined))
    expect(await screen.findByRole('button', { name: NAME })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it('is not read for a member who doesn’t receive prescriptions', async () => {
    working([READ, CREATE])
    renderPage()
    await screen.findByRole('button', { name: NAME })
    expect(routes.incoming).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
  })
})

describe('this isn’t the order’s patient, from the record', () => {
  function report(note = 'Picked the wrong order from the list') {
    const card = otherActions()
    fireEvent.click(within(card).getByRole('button', { name: 'This isn’t the order’s patient' }))
    fireEvent.click(within(card).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(card).getByLabelText('What happened, for Health ID support'), { target: { value: note } })
    fireEvent.click(within(card).getByRole('checkbox', { name: 'The person I accepted this order for is not Patient One, and was not collecting it for them.' }))
    fireEvent.click(within(card).getByRole('button', { name: 'End this order' }))
  }

  it('is offered under the record’s actions, in the reused staff form, only to a member who receives', async () => {
    await openRouted()
    const card = otherActions()
    const button = within(card).getByRole('button', { name: 'This isn’t the order’s patient' })
    expect(button.closest('.hid-ehr-dept-embedded')).toBeTruthy()
    expect(within(pickCard()).getByRole('button', { name: 'Dispense' })
      .compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(button)
    expect(document.activeElement).toBe(within(card).getByText('End this order: accepted for the wrong person'))
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(within(otherActions()).getByRole('button', { name: 'This isn’t the order’s patient' })))
  })

  it('is not offered without the receive permission, or on this facility’s own work', async () => {
    working([READ, CREATE])
    await openRouted()
    expect(screen.queryByRole('button', { name: /isn’t the order’s patient/ })).toBeNull()
    fireEvent.click(back())
    working(PHARMACIST)
    fireEvent.click(screen.getByRole('button', { name: 'Amoxicillin 500 mg capsule' }))
    expect(screen.queryByRole('button', { name: /isn’t the order’s patient/ })).toBeNull()
  })

  it('ends the order: the record closes at once, what happened stays above the list with focus, and the row goes', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce(answer([routed(), accepted])).mockResolvedValue(answer([accepted]))
    await openRouted()
    report()
    const ended = await screen.findByText('Ended: Amoxicillin 250 mg capsules, reference 9C1B2D3E. Patient One is told in the Health ID app.')
    expect(routes.reportWrongPatient).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'pharmacy', { id: ROUTE_ID, version: 3 },
      { reason: 'wrong_order_chosen', note: 'Picked the wrong order from the list' }, expect.any(String))
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Prescription' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(ended))
    await waitFor(() => expect(screen.queryByRole('button', { name: NAME })).toBeNull())
    expect(screen.getByText(/^Ended: Amoxicillin 250 mg capsules/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(/^Ended: Amoxicillin 250 mg capsules/)).toBeNull()
  })

  it('keeps a refusal in the record, with focus on it, once the list read again no longer offers the form', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce(answer([routed()]))
      .mockResolvedValue(answer([routed({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed', version: 4 }) })]))
    routes.reportWrongPatient.mockRejectedValueOnce(new HidApiError(409, 'Ended', { code: 'ORDER_ROUTE_ALREADY_ENDED' }))
    await openRouted()
    report()
    const said = await waitFor(() => {
      const element = document.getElementById(`pharmacy-${routed().id}-said`)
      if (!element) throw new Error('Not said yet')
      return element
    })
    expect(said.getAttribute('role')).toBe('alert')
    expect(said.textContent).toBe('This order has already ended, so it can’t be ended here. If a result or dispensing had gone back, '
      + 'phone Demo Hospital and tell Health ID support.')
    await waitFor(() => expect(document.activeElement).toBe(said))
    expect(within(prescriptionCard()).getByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('says a refusal above the list, with focus there, when the work has left the list', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce(answer([routed(), accepted])).mockResolvedValue(answer([accepted]))
    routes.reportWrongPatient.mockRejectedValueOnce(new HidApiError(404, 'Gone', { code: 'ORDER_ROUTE_NOT_FOUND' }))
    await openRouted()
    report()
    const said = (await screen.findByText('This order was not found here. Refresh the list.')).closest('[role="alert"]')
    expect(said?.id).toBe('pharmacy-said')
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: NAME })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(said))
  })
})

describe('we can’t complete this order, once served', () => {
  const served = (items: PharmacyWorkItem[]) => answer(items, { receives: true, routesHere: { waiting: false, held: true },
    lateCorrection: true, cannotComplete: true })
  const CC = `We can’t complete this order: ${NAME}, Ref 9C1B2D3E`

  it('is not offered against today’s answers, without cannotComplete', async () => {
    await openRouted()
    await within(otherActions()).findByRole('button', { name: 'This isn’t the order’s patient' })
    expect(within(otherActions()).queryByRole('button', { name: /^We can’t complete/ })).toBeNull()
  })

  it('ends the order from the record with the pharmacy’s reasons; it closes, and what follows is said until closed', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce(served([routed(), accepted])).mockResolvedValue(served([accepted]))
    await openRouted()
    const card = otherActions()
    fireEvent.click(await within(card).findByRole('button', { name: CC }))
    const form = within(card).getByRole('form', { name: 'End this order: we can’t complete it' })
    fireEvent.click(within(form).getByRole('radio', { name: /^It needs the prescriber’s review/ }))
    fireEvent.click(within(form).getByRole('checkbox', { name: 'We will phone Demo Hospital about this now.' }))
    fireEvent.click(within(form).getByRole('checkbox', { name: 'The person we accepted this prescription for was Patient One, or '
      + 'was collecting it for them, and we can’t complete it here.' }))
    fireEvent.click(within(form).getByRole('button', { name: 'End it: we can’t complete it' }))
    const ended = await screen.findByText(/^Ended: Amoxicillin 250 mg capsules, reference 9C1B2D3E\./)
    expect(routes.cannotComplete).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'pharmacy', { id: ROUTE_ID, version: 3 },
      { reason: 'needs_prescriber_review', confirmedPatient: true }, expect.any(String))
    // Its reads ended at once: the record closes.
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(ended))
    await waitFor(() => expect(screen.queryByRole('button', { name: NAME })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: `Close: ${NAME}, Ref 9C1B2D3E` }))
    expect(screen.queryByText(/^Ended: Amoxicillin 250 mg capsules/)).toBeNull()
  })

  it('keeps the record open, marked ended, when its reads are kept', async () => {
    routes.cannotComplete.mockResolvedValueOnce({ ...NOT_COMPLETED, readUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() })
    api.pharmacyWorkItems.mockResolvedValueOnce(served([routed()]))
      .mockResolvedValue(served([routed({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'receiving_unable', version: 4 }) })]))
    await openRouted()
    const card = otherActions()
    fireEvent.click(await within(card).findByRole('button', { name: CC }))
    const form = within(card).getByRole('form', { name: 'End this order: we can’t complete it' })
    fireEvent.click(within(form).getByRole('radio', { name: /^It needs the prescriber’s review/ }))
    fireEvent.click(within(form).getByRole('checkbox', { name: 'We will phone Demo Hospital about this now.' }))
    fireEvent.click(within(form).getByRole('checkbox', { name: /^The person we accepted this prescription for/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'End it: we can’t complete it' }))
    await screen.findByText(/^Ended: Amoxicillin 250 mg capsules/)
    expect(await within(prescriptionCard()).findByText(/^You ended this order: you couldn’t complete it\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Dispense$|^We can’t|isn’t the order’s patient/ })).toBeNull()
  })

  it('adds to the cap that an order past it can be ended from “Correct an order that has ended”', async () => {
    const many = Array.from({ length: 200 }, (_, n) => ({ ...accepted, id: `${String(n).padStart(8, '0')}-w` }))
    api.pharmacyWorkItems.mockResolvedValue(served(many))
    renderPage()
    expect(await screen.findByText('To end one you can’t complete, find it by its reference under “Correct an order that has ended”.')).toBeTruthy()
    expect(screen.getByText('Correct an order that has ended', { selector: 'summary' })).toBeTruthy()
  })
})

describe('correct an order that has ended', () => {
  it('is offered above the list once the backend serves it, to a member who receives', async () => {
    api.pharmacyWorkItems.mockResolvedValue(answer([routed()], { lateCorrection: true }))
    renderPage()
    const summary = await screen.findByText('Correct an order that has ended', { selector: 'summary' })
    expect(summary.closest('.hid-ehr-dept-embedded')).toBeTruthy()
    // A native disclosure: Enter and Space open it.
    expect(summary.closest('details')).toBeTruthy()
  })

  it('is not offered against an answer without lateCorrection', async () => {
    api.pharmacyWorkItems.mockResolvedValue(answer([routed()]))
    renderPage()
    await screen.findByRole('button', { name: NAME })
    expect(screen.queryByText('Correct an order that has ended')).toBeNull()
    expect(routes.findCorrectable).not.toHaveBeenCalled()
  })
})
