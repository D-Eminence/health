import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'

/**
 * Sending a lab request to a laboratory at another facility from the clinical record (Novu, P4c, SPEC-FINAL §3.5,
 * §13.1): the "Create and send to another laboratory" choice, the directory, the clinician's attestation (Health ID's
 * current text with the names filled, which must be ticked), the notes, the draft kept when the send fails, the
 * route's line under the request, Withdraw, sending again after a decline, the outdated attestation reloaded, and the
 * changes offered for a routed request. Never on a main-v1 build, and never while the list does not say orders are on.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), sendLabRequestToLab: vi.fn(), labReleasedResultsForOrder: vi.fn(),
}))
const routes = vi.hoisted(() => ({ attestation: vi.fn(), destinations: vi.fn(), send: vi.fn(), routes: vi.fn(), withdraw: vi.fn() }))
const staff = vi.hoisted(() => ({ activePatient: null as unknown, permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
  orderRoutesApi: routes,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ade Okon', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const REQUEST = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const ROUTE = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const YABA = { facilityId: 'f0000000-0000-4000-8000-00000000000a', facilityName: 'Yaba Diagnostics',
  organizationName: 'Yaba Diagnostics Limited', registeredAddress: '12 Herbert Macaulay Way, Yaba, Lagos', newOnHealthId: false }
const DOCTOR = ['ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write', 'ehr.order-route.send']
const ATTESTATION = { kind: 'lab_request', version: 'order-route-lab-attestation-v1',
  text: 'I confirm that {patient} agreed that {orderingFacility} sends this test request to {receivingFacility}. I told them that '
    + 'once {receivingFacility} accepts it, it sees their name.' }
const FILLED = 'I confirm that Ada Patient agreed that General Hospital sends this test request to Yaba Diagnostics. I told them '
  + 'that once Yaba Diagnostics accepts it, it sees their name.'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const base = { patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z' }
const summary = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE, reference: '9C1B2D3E', kind: 'lab_request', version: 1,
  effectiveState: 'sent', receivingFacility: { id: YABA.facilityId, name: 'Yaba Diagnostics', available: true },
  createdAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptedAt: null, completedAt: null,
  endedAt: null, endedKind: null, declineReason: null, acceptLocked: false, resendAllowed: false, ...overrides })
const labRequest = (status: string, orderRoute: unknown = null, rowVersion = '2') => ({ ...base, id: REQUEST, testCodeSystem: 'LOINC',
  testCode: '718-7', testDisplay: 'Haemoglobin', priority: 'routine', status, clinicalInformation: null, rowVersion,
  ...(orderRoute === undefined ? {} : { orderRoute }) })

let records: unknown[]
let ordersOn: boolean | undefined
/** Whether the page says the receiver can end an order accepted for the wrong person (hid-system 0088; item 3, D15). */
let reportsServed: boolean

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  staff.permissions = DOCTOR
  records = []
  ordersOn = true
  reportsServed = false
  forgetWrongPatientServed()
  forgetLateCorrectionServed()
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1',
    encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async () => ({ items: records, nextCursor: null,
    ...(ordersOn === undefined ? {} : { crossFacilityOrders: ordersOn }), ...(reportsServed ? { wrongPatientReports: true } : {}) }))
  routes.attestation.mockResolvedValue(ATTESTATION)
  routes.destinations.mockResolvedValue({ items: [YABA] })
})
afterEach(() => { vi.unstubAllEnvs() })

async function openLabRequests() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
  await waitFor(() => expect(api.records).toHaveBeenCalled())
}

function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }

function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

/** Fills the form, chooses another laboratory and picks Yaba Diagnostics from the directory. */
async function chooseAnotherLaboratory(priority = 'routine') {
  await openLabRequests()
  const form = (await screen.findByRole('button', { name: 'Create lab request' })).closest('form')!
  type(form, 'Test code system', 'LOINC')
  type(form, 'Test code', '718-7')
  type(form, 'Test display', 'Haemoglobin')
  type(form, 'Priority', priority)
  await waitFor(() => expect(within(form).getByRole('option', { name: 'Create and send to another laboratory' })).toBeTruthy())
  type(form, 'Request handling', 'route')
  fireEvent.change(within(form).getByLabelText('Search for the laboratory'), { target: { value: 'Yaba' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Search' }))
  fireEvent.click(await within(form).findByRole('radio', { name: /Yaba Diagnostics/ }))
  return form
}

describe('creating a lab request and sending it to another laboratory', () => {
  it('reads the current attestation, fills its names, and sends only once it is ticked, with its own key', async () => {
    api.createRecord.mockImplementation(async () => { records = [labRequest('draft', null, '1')]; return labRequest('draft', null, '1') })
    routes.send.mockImplementation(async () => { records = [labRequest('active', summary(), '2')]; return { route: summary(), order: { id: REQUEST, status: 'active', rowVersion: 2 }, replayed: false } })
    const form = await chooseAnotherLaboratory()

    expect(routes.attestation).toHaveBeenCalledWith('facility-1', 'lab_request')
    const tick = within(form).getByRole('checkbox', { name: FILLED })
    expect(within(form).getByText('Health ID records that you confirmed this, with your name and the time. Ada Patient is told in the Health ID app and can stop it until Yaba Diagnostics accepts it.')).toBeTruthy()
    expect(within(form).getByText('Yaba Diagnostics sees the clinical information only after it accepts. Write only what the laboratory needs.')).toBeTruthy()
    expect(within(form).getByText('If this is a sensitive test, such as an HIV or pregnancy test, check that Ada Patient is happy for Yaba Diagnostics to do it: Yaba Diagnostics sees the test and its result.')).toBeTruthy()
    expect(within(form).queryByText(/is not alerted/)).toBeNull()

    const send = within(form).getByRole('button', { name: 'Create and send to Yaba Diagnostics' })
    fireEvent.click(send)
    expect(await within(form).findByText('Tick the box to confirm that the patient agreed.')).toBeTruthy()
    expect(api.createRecord).not.toHaveBeenCalled()

    fireEvent.click(tick)
    fireEvent.click(send)
    expect(await screen.findByText(/^Lab request created and sent to Yaba Diagnostics\./)).toBeTruthy()
    const [, , , kind, body, createKey] = api.createRecord.mock.calls[0]!
    expect(kind).toBe('lab-requests')
    expect(body).toMatchObject({ testCode: '718-7', status: 'draft', priority: 'routine' })
    expect(routes.send).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab_request', REQUEST,
      { expectedRowVersion: 1, receivingFacilityId: YABA.facilityId, attestationTextVersion: 'order-route-lab-attestation-v1' }, expect.any(String))
    expect(routes.send.mock.calls[0]![6]).not.toBe(createKey)
    // The row now says where it went.
    expect(await screen.findByText(/^Sent to Yaba Diagnostics: waiting for it to accept, until /)).toBeTruthy()
  })

  it('says an urgent order is not alerted at the laboratory', async () => {
    const form = await chooseAnotherLaboratory('stat')
    expect(await within(form).findByText('Yaba Diagnostics is not alerted when it arrives: phone them.')).toBeTruthy()
  })

  it('keeps the draft when the send is refused, and says why', async () => {
    api.createRecord.mockImplementation(async () => { records = [labRequest('draft', null, '1')]; return labRequest('draft', null, '1') })
    routes.send.mockRejectedValue(new HidApiError(409, 'No', { code: 'ORDER_ROUTE_DESTINATION_INELIGIBLE' }))
    const form = await chooseAnotherLaboratory()
    fireEvent.click(within(form).getByRole('checkbox', { name: FILLED }))
    fireEvent.click(within(form).getByRole('button', { name: 'Create and send to Yaba Diagnostics' }))
    const alert = await screen.findByText(/^Saved as a draft\. Not sent:/)
    expect(alert.textContent).toBe('Saved as a draft. Not sent: Yaba Diagnostics can’t receive this order on Health ID at the moment. Choose another laboratory.')
    expect(api.createRecord).toHaveBeenCalledTimes(1)
    // The draft can be sent from its row.
    expect(await screen.findByRole('button', { name: 'Send to another laboratory' })).toBeTruthy()
  })

  it.each([
    ['a timeout (408)', new HidApiError(408, 'Timed out', { code: 'REQUEST_TIMEOUT' })],
    ['the gateway’s 503', new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' })],
    ['a lost connection', new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' })],
  ])('never says “not sent” when the send got no answer (%s): it may have gone, so the row is checked', async (_case, error) => {
    api.createRecord.mockImplementation(async () => { records = [labRequest('draft', null, '1')]; return labRequest('draft', null, '1') })
    // The EHR committed the send after the browser stopped waiting: the reloaded row shows it sent.
    routes.send.mockImplementation(async () => { records = [labRequest('active', summary(), '2')]; throw error })
    const form = await chooseAnotherLaboratory()
    fireEvent.click(within(form).getByRole('checkbox', { name: FILLED }))
    fireEvent.click(within(form).getByRole('button', { name: 'Create and send to Yaba Diagnostics' }))
    const said = await screen.findByText(/^Saved\. Health ID did not answer the send/)
    expect(said.textContent).toBe('Saved. Health ID did not answer the send, so it may or may not have gone to Yaba Diagnostics: '
      + 'check the row below before sending it again. The list was reloaded.')
    expect(screen.queryByText(/Saved as a draft|Not sent/)).toBeNull()
    expect(await screen.findByText(/^Sent to Yaba Diagnostics: waiting for it to accept, until /)).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['without ehr.order-route.send', () => { staff.permissions = DOCTOR.filter(code => code !== 'ehr.order-route.send') }],
    ['while orders between facilities are off', () => { ordersOn = false }],
    ['when the list does not say (an EHR before P4c)', () => { ordersOn = undefined }],
    ['on a main-v1 build', () => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1') }],
    ['with read-only access', () => {
      api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    }],
  ])('is not offered %s', async (_case, setUp) => {
    setUp()
    records = [labRequest('draft')]
    await openLabRequests()
    await screen.findByText('Haemoglobin')
    expect(screen.queryByRole('option', { name: 'Create and send to another laboratory' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send to another laboratory' })).toBeNull()
    expect(routes.attestation).not.toHaveBeenCalled()
  })
})

describe('a lab request sent to another laboratory, on its row', () => {
  it('says it waits there, and withdraws it with a reason', async () => {
    records = [labRequest('active', summary())]
    routes.withdraw.mockImplementation(async () => {
      records = [labRequest('active', summary({ effectiveState: 'withdrawn', endedKind: 'orderer', version: 2 }))]
      return { route: summary({ effectiveState: 'withdrawn' }) }
    })
    await openLabRequests()
    expect(await screen.findByText(/^Sent to Yaba Diagnostics: waiting for it to accept, until /)).toBeTruthy()
    expect(screen.getByText('Ref 9C1B2D3E')).toBeTruthy()
    // Withdrawing needs a reason.
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Choose why it is being withdrawn.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Withdraw it from Yaba Diagnostics'), { target: { value: 'patient_request' } })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Withdrawn from Yaba Diagnostics. Ada Patient is told in the Health ID app.')).toBeTruthy()
    expect(routes.withdraw).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab_request', REQUEST,
      expect.objectContaining({ id: ROUTE, version: 1 }), 'patient_request')
    expect(await screen.findByText('Withdrawn.')).toBeTruthy()
  })

  it('offers Withdraw without write access (it needs no consent), but no send', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    records = [labRequest('active', summary())]
    await openLabRequests()
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to another laboratory' })).toBeNull()
  })

  it('offers no Send to Lab or same-facility results for a routed request, and says a change is passed on', async () => {
    staff.permissions = [...DOCTOR, 'lab.work-item.accept', 'lab.result.released.read']
    records = [labRequest('active', summary({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z' }))]
    reportsServed = true
    await openLabRequests()
    expect(await screen.findByText(/^Accepted by Yaba Diagnostics on /)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Lab' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'View released results' })).toBeNull()
    const status = screen.getByLabelText(labelled('New status')) as HTMLSelectElement
    expect([...status.options].map(option => option.text)).toEqual(['Put on hold', 'Complete', 'Cancel', 'Mark entered in error'])
    // While Yaba Diagnostics may still work on it, the clinician is asked to have it ended there first (item 3, C1).
    expect(screen.getByText('Changing it withdraws it from Yaba Diagnostics, or cancels it there if Yaba Diagnostics has accepted '
      + 'it; a cancelled order can’t be resumed there. If Yaba Diagnostics accepted it for someone who was not Ada Patient, ask '
      + 'Yaba Diagnostics to end it from its work list first: once you change this order, Yaba Diagnostics can no longer '
      + 'withdraw a result or dispensing it sent back.')).toBeTruthy()
    expect(screen.queryByText(/Lab may already be working on this request/)).toBeNull()
  })

  it('keeps the earlier change warning while the backend has no wrong-patient report (D15)', async () => {
    // Today's backend: the laboratory can't end the order, so the clinician is not sent to it; changing the order stays
    // the way to stop it there.
    records = [labRequest('active', summary({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z' }))]
    await openLabRequests()
    expect(await screen.findByText('Changing it withdraws it from Yaba Diagnostics, or cancels it there if Yaba Diagnostics has '
      + 'accepted it; a cancelled order can’t be resumed there.')).toBeTruthy()
    expect(screen.queryByText(/end it from its work list/)).toBeNull()
  })

  it('says the EHR’s LAB_REQUEST_ROUTED in words when the request was sent elsewhere meanwhile, and reads the list again', async () => {
    staff.permissions = [...DOCTOR, 'lab.work-item.accept']
    records = [labRequest('active')]
    api.sendLabRequestToLab.mockImplementation(async () => {
      records = [labRequest('active', summary())]
      throw new HidApiError(409, 'Routed', { code: 'LAB_REQUEST_ROUTED' })
    })
    await openLabRequests()
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    expect(await screen.findByText('This lab request was sent to a laboratory at another facility, so this facility’s Lab can’t take it. '
      + 'The list was reloaded.')).toBeTruthy()
    expect(await screen.findByText(/^Sent to Yaba Diagnostics: waiting for it to accept, until /)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Lab' })).toBeNull()
  })

  it('says an activation was not handed to this facility’s Lab when the EHR answers ORDER_ROUTED', async () => {
    staff.permissions = [...DOCTOR, 'lab.work-item.accept']
    records = [labRequest('draft')]
    api.updateRecord.mockImplementation(async () => {
      records = [labRequest('active', summary(), '3')]
      return { ...labRequest('active', summary(), '3'), labWorkItem: null, labHandoff: { state: 'not_sent', code: 'ORDER_ROUTED' } }
    })
    await openLabRequests()
    const form = (await screen.findByLabelText(labelled('New status'))).closest('form')!
    type(form, 'New status', 'active')
    type(form, 'Reason for change', 'Ready to order')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    expect(await screen.findByText('Lab request activated. It was sent to another facility, so it was not sent to this facility’s Lab.')).toBeTruthy()
    expect(api.sendLabRequestToLab).not.toHaveBeenCalled()
  })

  it('sends a declined request elsewhere, reloading the wording when the EHR says it changed', async () => {
    records = [labRequest('active', summary({ effectiveState: 'declined', declineReason: 'test_not_offered', resendAllowed: true,
      endedAt: '2026-10-21T10:00:00.000Z' }))]
    routes.send.mockRejectedValueOnce(new HidApiError(409, 'Changed', { code: 'ORDER_ROUTE_ATTESTATION_OUTDATED' }))
    routes.attestation.mockResolvedValueOnce(ATTESTATION).mockResolvedValueOnce({ ...ATTESTATION, version: 'order-route-lab-attestation-v2',
      text: `${ATTESTATION.text} Version two.` })
    await openLabRequests()
    expect(await screen.findByText('Declined by Yaba Diagnostics: This test isn’t offered. Send it elsewhere.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to another laboratory' }))
    const form = (await screen.findByRole('button', { name: 'Send' })).closest('form')!
    fireEvent.change(within(form).getByLabelText('Search for the laboratory'), { target: { value: 'Yaba' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Search' }))
    fireEvent.click(await within(form).findByRole('radio', { name: /Yaba Diagnostics/ }))
    fireEvent.click(within(form).getByRole('checkbox', { name: FILLED }))
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Yaba Diagnostics' }))

    expect(await within(form).findByText('The wording changed. Read it again and confirm.')).toBeTruthy()
    const again = await within(form).findByRole('checkbox', { name: `${FILLED} Version two.` })
    expect((again as HTMLInputElement).checked).toBe(false)
    expect(routes.attestation).toHaveBeenCalledTimes(2)

    routes.send.mockImplementation(async () => { records = [labRequest('active', summary({ version: 3 }))]; return { route: summary(), order: { id: REQUEST, status: 'active', rowVersion: 3 }, replayed: false } })
    fireEvent.click(again)
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Yaba Diagnostics' }))
    expect(await screen.findByText(/^Lab request sent to Yaba Diagnostics\./)).toBeTruthy()
    expect(routes.send.mock.calls[1]![5]).toMatchObject({ expectedRowVersion: 2, attestationTextVersion: 'order-route-lab-attestation-v2' })
  })

  it('shows who confirmed the patient agreed, and the results that came back, only when asked', async () => {
    records = [labRequest('active', summary({ effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z',
      completedAt: '2026-10-22T10:00:00.000Z' }))]
    routes.routes.mockResolvedValue({ items: [{ ...summary({ effectiveState: 'completed' }),
      attestation: { textVersion: 'order-route-lab-attestation-v1', attestedByName: 'Dr Ade Okon', attestedAt: '2026-10-20T09:00:00.000Z', receivingFacilityName: 'Yaba Diagnostics' },
      events: [],
      results: [{ resultId: 'r1', resultVersion: 1, kind: 'released', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' },
        resultType: 'numeric', numericValue: '9.8', textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low',
        revisionKind: 'original', correctionReason: null, occurredAt: '2026-10-22T10:00:00.000Z' }] }] })
    await openLabRequests()
    expect(await screen.findByText(/^Results released by Yaba Diagnostics on /)).toBeTruthy()
    expect(routes.routes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show details and results' }))
    expect(await screen.findByText(/^Dr Ade Okon confirmed on .* that Ada Patient agreed to send it to Yaba Diagnostics\.$/)).toBeTruthy()
    expect(screen.getByText(/^Haemoglobin: Released by Yaba Diagnostics on .*: 9\.8 g\/dL, flagged low, reference 12\.0-15\.5$/)).toBeTruthy()
    expect(routes.routes).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab_request', REQUEST)
  })
})

/**
 * D17 (hid-system 0090; SPEC-FINAL §9.2, CT10): once the list says the receiving laboratory can withdraw what it recorded
 * after the order has changed or ended (`lateCorrection: true`), the change warning names the order's own date and its
 * reference instead of asking for it to be ended first; past that date (null), it says only what a change does.
 */
describe('the change warning once the late correction is served (D17)', () => {
  const change = 'Changing it withdraws it from Yaba Diagnostics, or cancels it there if Yaba Diagnostics has accepted it; a '
    + 'cancelled order can’t be resumed there.'
  function serve(route: Record<string, unknown>, late = true) {
    records = [labRequest('active', summary({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z', ...route }))]
    api.records.mockImplementation(async () => ({ items: records, nextCursor: null, crossFacilityOrders: true,
      wrongPatientReports: true, ...(late ? { lateCorrection: true } : {}) }))
  }

  it('names the date and the reference for an accepted order, whether or not it is changed', async () => {
    serve({ correctableUntil: '2027-04-19T10:00:00.000Z', wrongPatient: null })
    await openLabRequests()
    expect(await screen.findByText(`${change} If Yaba Diagnostics accepted it for someone who was not Ada Patient, ask Yaba `
      + 'Diagnostics to withdraw what it recorded on it, giving it the reference 9C1B2D3E: it can do so until 19 Apr 2027, '
      + 'whether or not you change this order.')).toBeTruthy()
    expect(screen.queryByText(/end it from its work list/)).toBeNull()
  })

  it('says only what a change does once the date has passed', async () => {
    serve({ correctableUntil: null, wrongPatient: null })
    await openLabRequests()
    expect(await screen.findByText(change)).toBeTruthy()
    expect(screen.queryByText(/withdraw what it|end it from its work list/)).toBeNull()
  })

  it('keeps item 3’s warning against today’s answers, without lateCorrection or a deadline', async () => {
    serve({}, false)
    await openLabRequests()
    expect(await screen.findByText(/to end it from its work list first: once you change this order/)).toBeTruthy()
    expect(screen.queryByText(/whether or not you change this order/)).toBeNull()
  })
})
