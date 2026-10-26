import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'

/**
 * Sending a prescription to a pharmacy at another facility (Novu, P4c, SPEC-FINAL §13.1): "Send to a pharmacy" on a
 * draft or active prescription for a doctor or clinician (ehr.prescription.write and ehr.order-route.send), the
 * prescription attestation, the controlled-medicine warning (owner decision Q9), and what a routed prescription no
 * longer offers here: this facility's pharmacist "Send to Pharmacy", answered PRESCRIPTION_ROUTED by the EHR.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), acceptPrescription: vi.fn(), updateEncounter: vi.fn(), encounter: vi.fn(),
}))
const routes = vi.hoisted(() => ({ attestation: vi.fn(), destinations: vi.fn(), send: vi.fn(), routes: vi.fn(), withdraw: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
  orderRoutesApi: routes,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ade Okon', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const MEDPLUS = { facilityId: 'f0000000-0000-4000-8000-00000000000c', facilityName: 'Medplus Yaba', organizationName: 'Medplus Limited',
  registeredAddress: '1 Commercial Avenue, Yaba, Lagos', newOnHealthId: true }
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const base = { patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z',
  doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral', instructions: 'Take with food' }
const route = (overrides: Record<string, unknown> = {}) => ({ id: '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e', reference: '9C1B2D3E',
  kind: 'prescription', version: 1, effectiveState: 'sent', receivingFacility: { id: MEDPLUS.facilityId, name: 'Medplus Yaba', available: true },
  createdAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptedAt: null, completedAt: null, endedAt: null,
  endedKind: null, declineReason: null, acceptLocked: false, resendAllowed: false, ...overrides })
const rx = (status: string, orderRoute: unknown = null) => ({ ...base, id: 'rx-1', medicationDisplay: 'Amoxicillin 500 mg capsules',
  frequency: 'Three times daily', status, rowVersion: '3', orderRoute })
const PRESCRIBER = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.order-route.send']
const ATTESTATION = { kind: 'prescription', version: 'order-route-prescription-attestation-v1',
  text: 'I confirm that {patient} agreed that {orderingFacility} sends this prescription to {receivingFacility}.' }

let records: unknown[]
/** Whether the page says the receiver can end an order accepted for the wrong person (hid-system 0088; item 3, D15). */
let reportsServed: boolean

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  staff.permissions = PRESCRIBER
  records = [rx('active')]
  reportsServed = false
  forgetWrongPatientServed()
  forgetLateCorrectionServed()
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async () => ({ items: records, nextCursor: null, crossFacilityOrders: true,
    ...(reportsServed ? { wrongPatientReports: true } : {}) }))
  routes.attestation.mockResolvedValue(ATTESTATION)
  routes.destinations.mockResolvedValue({ items: [MEDPLUS] })
})
afterEach(() => { vi.unstubAllEnvs() })

async function openPrescriptions() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Prescriptions' }))
  await screen.findByText('Amoxicillin 500 mg capsules')
}

describe('sending a prescription to a pharmacy at another facility', () => {
  it('sends it with the prescription attestation, and warns about controlled medicines', async () => {
    routes.send.mockImplementation(async () => { records = [rx('active', route())]; return { route: route(), order: { id: 'rx-1', status: 'active', rowVersion: 4 }, replayed: false } })
    await openPrescriptions()
    expect(screen.getByText('This saves a draft. To send it to a pharmacy at another facility, use Send to a pharmacy on it in the list.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to a pharmacy' }))
    const form = (await screen.findByRole('button', { name: 'Send' })).closest('form')!
    expect(routes.attestation).toHaveBeenCalledWith('facility-1', 'prescription')
    fireEvent.change(within(form).getByLabelText('Search for the pharmacy'), { target: { value: 'Medplus' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Search' }))
    fireEvent.click(await within(form).findByRole('radio', { name: /Medplus Yaba/ }))
    expect(within(form).getByText('If this is a controlled medicine, Medplus Yaba may ask the patient for a paper prescription.')).toBeTruthy()
    expect(within(form).getByText('Medplus Yaba sees your instructions only after it accepts.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('checkbox', {
      name: 'I confirm that Ada Patient agreed that General Hospital sends this prescription to Medplus Yaba.' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Medplus Yaba' }))
    expect(await screen.findByText(/^Prescription sent to Medplus Yaba\./)).toBeTruthy()
    expect(routes.send).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescription', 'rx-1',
      { expectedRowVersion: 3, receivingFacilityId: MEDPLUS.facilityId, attestationTextVersion: 'order-route-prescription-attestation-v1' },
      expect.any(String))
    expect(await screen.findByText(/^Sent to Medplus Yaba: waiting for it to accept/)).toBeTruthy()
  })

  it.each([
    ['ORDER_ROUTE_PATIENT_APP_REQUIRED', 'Ada Patient has no active Health ID account, so Health ID can’t tell them where the order went. Give them a paper prescription instead.'],
    ['ORDER_ROUTE_PATIENT_DENIED', 'Ada Patient has asked Health ID not to share their records with Medplus Yaba. Choose another pharmacy.'],
    ['ORDER_ROUTE_RESEND_LIMIT', 'This prescription has been sent 5 times, the most allowed. Write a new one.'],
  ])('says why a send was refused (%s), in the form', async (code, says) => {
    routes.send.mockRejectedValue(new HidApiError(409, 'No', { code }))
    await openPrescriptions()
    fireEvent.click(screen.getByRole('button', { name: 'Send to a pharmacy' }))
    const form = (await screen.findByRole('button', { name: 'Send' })).closest('form')!
    fireEvent.change(within(form).getByLabelText('Search for the pharmacy'), { target: { value: 'Medplus' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Search' }))
    fireEvent.click(await within(form).findByRole('radio', { name: /Medplus Yaba/ }))
    fireEvent.click(await within(form).findByRole('checkbox'))
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Medplus Yaba' }))
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe(says))
  })

  it('offers this facility’s pharmacist no Send to Pharmacy for a routed prescription, and warns that a change is passed on', async () => {
    staff.permissions = [...PRESCRIBER, 'pharmacy.work-item.accept']
    records = [rx('active', route({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z' }))]
    reportsServed = true
    await openPrescriptions()
    expect(await screen.findByText(/^Accepted by Medplus Yaba on /)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send to a pharmacy' })).toBeNull()
    // While Medplus Yaba may still work on it, the clinician is asked to have it ended there first (item 3, C1).
    expect(screen.getByText('Changing it withdraws it from Medplus Yaba, or cancels it there if Medplus Yaba has accepted it; a '
      + 'cancelled order can’t be resumed there. If Medplus Yaba accepted it for someone who was not Ada Patient, ask Medplus '
      + 'Yaba to end it from its work list first: once you change this order, Medplus Yaba can no longer withdraw a result or '
      + 'dispensing it sent back.')).toBeTruthy()
  })

  it('keeps the earlier change warning while the backend has no wrong-patient report (D15)', async () => {
    records = [rx('active', route({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z' }))]
    await openPrescriptions()
    expect(await screen.findByText('Changing it withdraws it from Medplus Yaba, or cancels it there if Medplus Yaba has accepted it; '
      + 'a cancelled order can’t be resumed there.')).toBeTruthy()
    expect(screen.queryByText(/end it from its work list/)).toBeNull()
  })

  it('says the EHR’s PRESCRIPTION_ROUTED in words when this facility’s pharmacist sends one routed meanwhile', async () => {
    staff.permissions = [...PRESCRIBER, 'pharmacy.work-item.accept']
    api.acceptPrescription.mockRejectedValue(new HidApiError(409, 'Routed', { code: 'PRESCRIPTION_ROUTED' }))
    await openPrescriptions()
    const form = screen.getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(/^Reason/), { target: { value: 'Patient at the counter' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))
    expect(await screen.findByText(/^This prescription was sent to a pharmacy at another facility, so this facility’s Pharmacy can’t take it\./)).toBeTruthy()
  })

  it('shows what was dispensed there, when asked', async () => {
    records = [rx('active', route({ effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-21T11:00:00.000Z' }))]
    routes.routes.mockResolvedValue({ items: [{ ...route({ effectiveState: 'completed' }),
      attestation: { textVersion: 'order-route-prescription-attestation-v1', attestedByName: 'Dr Ade Okon', attestedAt: '2026-10-20T09:00:00.000Z', receivingFacilityName: 'Medplus Yaba' },
      events: [], dispensings: [
        { dispensingId: 'd1', kind: 'dispensed', medication: { codeSystem: null, code: null, display: 'Amoxicillin 500 mg capsules' }, quantityDispensed: '21', quantityUnit: 'capsules', occurredAt: '2026-10-21T11:00:00.000Z' },
        { dispensingId: 'd1', kind: 'reversed', medication: { codeSystem: null, code: null, display: null }, quantityDispensed: null, quantityUnit: null, occurredAt: '2026-10-21T12:00:00.000Z' },
      ] }] })
    await openPrescriptions()
    expect(await screen.findByText(/^Dispensed by Medplus Yaba on /)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show details and dispensing' }))
    expect(await screen.findByText(/^Dispensed by Medplus Yaba: 21 capsules on .* \(Amoxicillin 500 mg capsules\)\.$/)).toBeTruthy()
    expect(screen.getByText(/^Dispensing reversed on .*: contact Medplus Yaba\.$/)).toBeTruthy()
  })
})

/**
 * Item 3 (SPEC-FINAL §8.2, §9.2; D5, D10): a prescription the pharmacy reports it dispensed to someone who was not the
 * patient, and the Overview's link to such an order, which opens it in the record already open for that patient only.
 */
describe('a prescription the pharmacy reports it accepted for the wrong person', () => {
  const wrong = (overrides: Record<string, unknown> = {}) => route({ effectiveState: 'completed', endedKind: 'wrong_patient',
    acceptedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-22T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z', version: 5, ...overrides })

  it('says what the pharmacy reports, to check with the patient before prescribing again, and offers no Send', async () => {
    records = [rx('active', wrong())]
    routes.routes.mockResolvedValue({ items: [{ ...wrong(), attestation: { textVersion: 'v1', attestedByName: 'Dr Ade Okon',
      attestedAt: '2026-10-20T09:00:00.000Z', receivingFacilityName: 'Medplus Yaba' }, events: [], dispensings: [
      { dispensingId: 'd1', kind: 'dispensed', medication: { codeSystem: null, code: null, display: 'Amoxicillin 500 mg capsules' },
        quantityDispensed: '21', quantityUnit: 'capsules', occurredAt: '2026-10-22T10:00:00.000Z' },
      { dispensingId: 'd1', kind: 'reversed', medication: { codeSystem: null, code: null, display: 'Amoxicillin 500 mg capsules' },
        quantityDispensed: null, quantityUnit: null, occurredAt: '2026-10-23T10:00:00.000Z' }] }] })
    await openPrescriptions()
    expect(screen.getByText('Medplus Yaba reports that it dispensed this to someone who was not Ada Patient, and has ended it.')).toBeTruthy()
    const notice = document.querySelector('.staff-order-route .staff-danger') as HTMLElement
    expect([...notice.querySelectorAll('p')].map(line => line.textContent)).toEqual([
      'This order can’t be sent again. Write a new prescription if Ada Patient still needs it.',
      'Medplus Yaba reports that Ada Patient did not receive this medicine from it. Check with Ada Patient before you prescribe it '
        + 'again, especially a controlled medicine.'])
    expect(screen.queryByRole('button', { name: 'Send to a pharmacy' })).toBeNull()
    // Once ended there, nothing can be withdrawn there any more: the change warning says only what a change does.
    expect(screen.getByText('Changing it withdraws it from Medplus Yaba, or cancels it there if Medplus Yaba has accepted it; a '
      + 'cancelled order can’t be resumed there.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show details and dispensing' }))
    expect(await screen.findByText('Dispensing reversed on 23 Oct 2026: contact Medplus Yaba.')).toBeTruthy()
  })

  it('opens the order the Overview links to, in the record open for its patient: its encounter, tab and row', async () => {
    const LINKED = 'e0000000-0000-4000-8000-000000000002'
    const linked = { id: LINKED, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory', status: 'finished',
      startedAt: '2026-10-01T08:00:00.000Z', chiefComplaint: null, rowVersion: 2 }
    api.encounter.mockResolvedValue(linked)
    records = [rx('active', wrong())]
    render(<MemoryRouter initialEntries={[{ pathname: '/provider/clinical', state: { order: { patientId: PATIENT, encounterId: LINKED,
      kind: 'prescription', orderId: 'rx-1' } } }]}><Clinical /></MemoryRouter>)
    await waitFor(() => expect(api.encounter).toHaveBeenCalledWith('facility-1', PATIENT, LINKED))
    await waitFor(() => expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT, LINKED, 'prescriptions'))
    expect(screen.getByRole('tab', { name: 'Prescriptions' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement?.id).toBe('record-rx-1-title'))
  })

  it('opens nothing from a link to another patient’s order', async () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/provider/clinical', state: { order: { patientId: 'a0000000-0000-4000-8000-0000000000ff',
      encounterId: ENCOUNTER, kind: 'prescription', orderId: 'rx-9' } } }]}><Clinical /></MemoryRouter>)
    await waitFor(() => expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions'))
    await screen.findByText('Amoxicillin 500 mg capsules')
    expect(api.encounter).not.toHaveBeenCalled()
    expect(api.records.mock.calls.every(call => call[2] === ENCOUNTER)).toBe(true)
  })
})

/** D17 (SPEC-FINAL §9.2): the same for a prescription something came back on: "what it sent back". */
describe('the change warning once the late correction is served (D17)', () => {
  it('names the date and the reference for a dispensed prescription', async () => {
    staff.permissions = [...PRESCRIBER, 'pharmacy.work-item.accept']
    records = [rx('active', route({ effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z',
      completedAt: '2026-10-22T10:00:00.000Z', correctableUntil: '2027-04-19T10:00:00.000Z', wrongPatient: null }))]
    api.records.mockImplementation(async () => ({ items: records, nextCursor: null, crossFacilityOrders: true,
      wrongPatientReports: true, lateCorrection: true }))
    await openPrescriptions()
    expect(await screen.findByText('Changing it withdraws it from Medplus Yaba, or cancels it there if Medplus Yaba has accepted it; a '
      + 'cancelled order can’t be resumed there. If Medplus Yaba accepted it for someone who was not Ada Patient, ask Medplus Yaba '
      + 'to withdraw what it sent back, giving it the reference 9C1B2D3E: it can do so until 19 Apr 2027, 11:00, whether or not you change '
      + 'this order.')).toBeTruthy()
    expect(screen.getByText('If Ada Patient did not receive this medicine from Medplus Yaba, and no one collected it for them, phone '
      + 'Medplus Yaba and give it the reference 9C1B2D3E: it can reverse the dispensing until 19 Apr 2027, 11:00.')).toBeTruthy()
  })
})
