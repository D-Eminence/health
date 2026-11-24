import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncounterOrderPages, orderPath } from '../../../ehr-blue/clinical/consult/orders'
import {
  handoffRetryable, ownSendOffered, pharmacistHandoffOffered, readPharmacyHandoff,
} from '../../../ehr-blue/clinical/consult/orders/ownPharmacySend'
import { ALLERGY_GO_AHEAD_ERROR } from '../../../ehr-blue/clinical/parts/allergyWarning'
import { ChartProvider } from '../../../ehr-blue/clinical/parts/chart'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { COLLEAGUE, ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, PATIENT_NAME, SIGNED_IN, activePatient, allowedLookup, renderPage, type SignedIn } from './harness'

/**
 * "Send to pharmacy" for the prescriber on the blue prescription page (hid-system 0133, ehr-api at 06f98040: `POST
 * .../prescriptions/:prescriptionId/own-pharmacy-send` with the row version; `pharmacyHandoff` on its answer and on
 * Activate's). Offered only where somebody here works on pharmacy items (`ownPharmacyStaffed: true`). Fictional data.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(),
  acceptPrescription: vi.fn(), ownPharmacySend: vi.fn(), sendLabRequestToLab: vi.fn(), labReleasedResultsForOrder: vi.fn(),
  reportedHealthProfile: vi.fn(), allergies: vi.fn(), allergyCheck: vi.fn(),
}))
const routes = vi.hoisted(() => ({ destinations: vi.fn(), attestation: vi.fn(), send: vi.fn(), routes: vi.fn(), withdraw: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true),
  facilityId: undefined as string | undefined, roles: undefined as string[] | undefined, signedIn: undefined as SignedIn | undefined }))

vi.mock('../../../staff/api', async () => ({
  staffApi: api,
  orderRoutesApi: routes,
  isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup,
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

const RX = 'b0000000-0000-4000-8000-000000000001'
const READ_WRITE = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write']

/** The signed-in prescriber's active prescription, not yet received by this hospital's pharmacy, which has staff. */
function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: RX, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-11-20T09:00:00.000Z', medicationDisplay: 'Amoxicillin',
    doseQuantity: 500, doseUnit: 'mg', routeCode: 'oral', frequency: 'Twice daily', instructions: 'After meals', status: 'active', rowVersion: 4,
    createdBy: SIGNED_IN.accountId, createdByMembershipId: SIGNED_IN.membershipId, ownPharmacyStaffed: true,
    ownProgress: { status: 'not_received' }, orderRoute: null, ...overrides,
  }
}

let list: unknown[] = []

beforeEach(() => {
  vi.clearAllMocks()
  forgetWrongPatientServed()
  forgetLateCorrectionServed()
  staff.facilityId = undefined
  staff.roles = undefined
  staff.signedIn = SIGNED_IN
  staff.permissions = [...READ_WRITE]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ writeAllowed: true })
  list = [prescription()]
  api.records.mockImplementation(async (_facility: string, _patient: string, _encounter: string, kind: string) => ({
    items: kind === 'prescriptions' ? list : [], nextCursor: null, crossFacilityOrders: false,
  }))
  api.reportedHealthProfile.mockResolvedValue(null)
  api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
  api.allergyCheck.mockRejectedValue(new HidApiError(404, 'Cannot POST', { code: 'NOT_FOUND' }))
})

// An answer queued for a send or a change a test did not make is never left for the next test.
afterEach(() => {
  api.ownPharmacySend.mockReset()
  api.updateRecord.mockReset()
})

function Consult() {
  return (
    <Workspace path="consult">
      <ChartProvider>
        <Routes>
          <Route path=":recordId/orders/*" element={<EncounterOrderPages />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}

async function openPrescription() {
  renderPage(<Consult />, 'consult', `/${orderPath(ENCOUNTER_ID, 'pharmacy', RX)}`)
  return screen.findByRole('heading', { level: 1 })
}

const sendButton = () => screen.queryByRole('button', { name: 'Send to pharmacy' })
const actionsCard = () => screen.getByText('Actions').closest('section') as HTMLElement
/** The open Send to pharmacy form (its own button is the last of that name). */
const sendForm = () => screen.getAllByRole('button', { name: 'Send to pharmacy' }).at(-1)!.closest('form')!
/** Today's pharmacist hand-off, offered beside it to a member who may accept pharmacy work. */
const handoffButton = () => screen.queryByRole('button', { name: 'Send to Pharmacy' })
const SENT = { pharmacyHandoff: { status: 'sent', message: 'Sent to this hospital\'s pharmacy.' } }
const PENDING = { status: 'pending', message: 'Not sent to the pharmacy yet. Use Send to pharmacy to try again.' }
const RECEIVED = { status: 'received', receivedAt: '2026-11-20T09:05:00.000Z' }

/** Activate, Resume or another status change, with its reason, on the open prescription. */
function changeStatus(action: string, why: string) {
  fireEvent.click(screen.getByRole('button', { name: action }))
  fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: why } })
  fireEvent.submit(screen.getByLabelText(/Reason for change/).closest('form')!)
}

describe('pharmacyHandoff, read defensively', () => {
  it('reads the contract’s rows, an unknown reason as could not be reached, and nothing else', () => {
    expect(readPharmacyHandoff({ status: 'sent', message: 'Sent to this hospital\'s pharmacy.' })).toEqual({ status: 'sent', message: 'Sent to this hospital\'s pharmacy.' })
    expect(readPharmacyHandoff({ status: 'not_sent', reason: 'no_pharmacy', message: 'x' })?.reason).toBe('no_pharmacy')
    expect(readPharmacyHandoff({ status: 'not_sent', reason: 'something_new', message: 'x' })?.reason).toBe('unavailable')
    expect(readPharmacyHandoff(undefined)).toBeNull()
    expect(readPharmacyHandoff({ status: 'maybe' })).toBeNull()
    expect(handoffRetryable({ status: 'pending', message: '' })).toBe(true)
    expect(handoffRetryable({ status: 'not_sent', reason: 'unavailable', message: '' })).toBe(true)
    for (const reason of ['no_pharmacy', 'routed', 'not_prescriber', 'changed', 'superseded', 'not_allowed'] as const) {
      expect(handoffRetryable({ status: 'not_sent', reason, message: '' })).toBe(false)
    }
    expect(handoffRetryable({ status: 'sent', message: '' })).toBe(false)
  })

  it('offers the send only on the prescriber’s own active prescription not yet received, where the pharmacy has staff', () => {
    const actor = { accountId: SIGNED_IN.accountId, facility: { id: FACILITY_ID, membershipId: SIGNED_IN.membershipId } }
    const offered = (record: Record<string, unknown>, extra: { canWrite?: boolean; routed?: boolean } = {}) => ownSendOffered({
      record: prescription(record) as never, actor, facilityId: FACILITY_ID, canWrite: extra.canWrite ?? true, routed: extra.routed ?? false, handoff: null })
    expect(offered({})).toBe(true)
    expect(offered({ ownPharmacyStaffed: false })).toBe(false)
    expect(offered({ ownPharmacyStaffed: undefined })).toBe(false)
    expect(offered({ status: 'draft' })).toBe(false)
    expect(offered({ ownProgress: { status: 'received' } })).toBe(false)
    expect(offered({ ownProgress: undefined })).toBe(false)
    expect(offered({ createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId })).toBe(false)
    expect(offered({ createdByMembershipId: COLLEAGUE.membershipId })).toBe(false)
    expect(offered({}, { canWrite: false })).toBe(false)
    expect(offered({}, { routed: true })).toBe(false)
  })

  it('after an answer that says to try again, offers the send even where the read could not say the pharmacy has staff', () => {
    const actor = { accountId: SIGNED_IN.accountId, facility: { id: FACILITY_ID, membershipId: SIGNED_IN.membershipId } }
    const offered = (record: Record<string, unknown>, handoff: Parameters<typeof ownSendOffered>[0]['handoff']) => ownSendOffered({
      record: prescription(record) as never, actor, facilityId: FACILITY_ID, canWrite: true, routed: false, handoff })
    expect(offered({ ownPharmacyStaffed: undefined }, { status: 'pending', message: '' })).toBe(true)
    expect(offered({ ownPharmacyStaffed: undefined }, { status: 'not_sent', reason: 'unavailable', message: '' })).toBe(true)
    expect(offered({}, { status: 'not_sent', reason: 'superseded', message: '' })).toBe(false)
    expect(offered({ status: 'on_hold', ownPharmacyStaffed: undefined }, { status: 'pending', message: '' })).toBe(false)
  })

  it('offers today’s pharmacist hand-off only while this hospital’s pharmacy has not received the prescription', () => {
    const offered = (ownProgress: unknown, handoff: Parameters<typeof pharmacistHandoffOffered>[1] = null) =>
      pharmacistHandoffOffered(prescription({ ownProgress }) as never, handoff)
    expect(offered({ status: 'not_received' })).toBe(true)
    // An EHR before ORD-3 sends no progress, and `unknown` is a pharmacy that could not be asked: offered, as before.
    expect(offered(undefined)).toBe(true)
    expect(offered({ status: 'unknown' })).toBe(true)
    for (const status of ['received', 'dispensed', 'dispensing_reversed', 'withdrawn', 'sent_elsewhere']) expect(offered({ status }), status).toBe(false)
    // Sent on this page (by Activate or Send to pharmacy) before the progress was read again.
    expect(offered({ status: 'not_received' }, { status: 'sent', message: '' })).toBe(false)
  })
})

describe('Send to pharmacy on the prescription page', () => {
  it('sends the prescription with its row version, says it was sent, and does not offer it again', async () => {
    api.ownPharmacySend.mockResolvedValueOnce({ pharmacyHandoff: { status: 'sent', message: 'Sent to this hospital\'s pharmacy.' } })
    await openPrescription()
    // This role may not accept pharmacy work, so today's pharmacist hand-off is not offered.
    expect(screen.queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
    fireEvent.click(sendButton()!)
    const form = within(actionsCard()).getAllByRole('button', { name: 'Send to pharmacy' }).at(-1)!.closest('form')!
    list = [prescription({ ownProgress: { status: 'received', receivedAt: '2026-11-20T09:05:00.000Z' } })]
    fireEvent.submit(form)
    expect(await screen.findByText('Sent to this hospital’s pharmacy.')).toBeTruthy()
    expect(api.ownPharmacySend).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, RX, 4, null)
    await waitFor(() => expect(sendButton()).toBeNull())
  })

  it('keeps the form open, saying what the EHR said, while the send is pending, and sends again', async () => {
    api.ownPharmacySend
      .mockResolvedValueOnce({ pharmacyHandoff: { status: 'pending', message: 'Not sent to the pharmacy yet. Use Send to pharmacy to try again.' } })
      .mockResolvedValueOnce({ pharmacyHandoff: { status: 'sent', message: 'Sent to this hospital\'s pharmacy.' } })
    await openPrescription()
    fireEvent.click(sendButton()!)
    const form = () => screen.getAllByRole('button', { name: 'Send to pharmacy' }).at(-1)!.closest('form')!
    fireEvent.submit(form())
    expect(await screen.findByText('Not sent to the pharmacy yet. Use Send to pharmacy to try again.')).toBeTruthy()
    fireEvent.submit(form())
    expect(await screen.findByText('Sent to this hospital’s pharmacy.')).toBeTruthy()
    expect(api.ownPharmacySend).toHaveBeenCalledTimes(2)
  })

  it('says an answer that trying again cannot change, and does not offer the send again', async () => {
    api.ownPharmacySend.mockResolvedValueOnce({ pharmacyHandoff: { status: 'not_sent', reason: 'not_allowed', message: 'whatever the server says' } })
    await openPrescription()
    fireEvent.click(sendButton()!)
    fireEvent.submit(screen.getAllByRole('button', { name: 'Send to pharmacy' }).at(-1)!.closest('form')!)
    expect(await screen.findByText('Not sent: your role at this facility does not allow sending prescriptions to the pharmacy.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('whatever the server says')
    await waitFor(() => expect(sendButton()).toBeNull())
    expect(document.body.textContent).not.toMatch(/permission/i)
  })

  it('says plainly when the send is not served yet (503 OWN_PHARMACY_SEND_UNAVAILABLE)', async () => {
    api.ownPharmacySend.mockRejectedValueOnce(new HidApiError(503, 'unavailable', { code: 'OWN_PHARMACY_SEND_UNAVAILABLE' }))
    await openPrescription()
    fireEvent.click(sendButton()!)
    fireEvent.submit(screen.getAllByRole('button', { name: 'Send to pharmacy' }).at(-1)!.closest('form')!)
    expect(await screen.findByText('Send to pharmacy isn’t available here yet. Try again later.')).toBeTruthy()
  })

  it('reads the prescription again when it changed meanwhile (412)', async () => {
    api.ownPharmacySend.mockRejectedValueOnce(new HidApiError(412, 'conflict', { code: 'PRESCRIPTION_VERSION_CONFLICT' }))
    await openPrescription()
    fireEvent.click(sendButton()!)
    const reads = api.records.mock.calls.length
    fireEvent.submit(screen.getAllByRole('button', { name: 'Send to pharmacy' }).at(-1)!.closest('form')!)
    expect(await screen.findByText(/This prescription changed since it was loaded/)).toBeTruthy()
    expect(api.records.mock.calls.length).toBeGreaterThan(reads)
  })

  it.each([
    ['nobody here works on pharmacy items', { ownPharmacyStaffed: false }],
    ['the EHR does not say (before 0133)', { ownPharmacyStaffed: undefined, ownProgress: undefined }],
    ['a colleague wrote it', { createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId }],
    ['the pharmacy has it', { ownProgress: { status: 'received', receivedAt: '2026-11-20T09:05:00.000Z' } }],
    ['it is a draft', { status: 'draft' }],
  ])('offers no Send to pharmacy when %s', async (_why, overrides) => {
    list = [prescription(overrides)]
    await openPrescription()
    expect(sendButton()).toBeNull()
  })
})

describe('Activate says what became of the send', () => {
  it('says the pending send, and offers Send to pharmacy', async () => {
    list = [prescription({ status: 'draft', ownProgress: { status: 'not_received' } })]
    api.updateRecord.mockImplementationOnce(async () => {
      list = [prescription({ rowVersion: 5 })]
      return { ...prescription({ rowVersion: 5 }), pharmacyHandoff: { status: 'pending', message: 'Not sent to the pharmacy yet. Use Send to pharmacy to try again.' } }
    })
    await openPrescription()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: 'Start treatment' } })
    fireEvent.submit(screen.getByLabelText(/Reason for change/).closest('form')!)
    expect(await screen.findByText('Prescription status updated. Not sent to the pharmacy yet. Use Send to pharmacy to try again.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Send to pharmacy' })).toBeTruthy()
  })

  it('says it was sent, and offers no send', async () => {
    list = [prescription({ status: 'draft' })]
    api.updateRecord.mockImplementationOnce(async () => {
      list = [prescription({ rowVersion: 5, ownProgress: { status: 'received', receivedAt: '2026-11-20T09:05:00.000Z' } })]
      return { ...prescription({ rowVersion: 5 }), pharmacyHandoff: { status: 'sent', message: 'Sent to this hospital\'s pharmacy.' } }
    })
    await openPrescription()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: 'Start treatment' } })
    fireEvent.submit(screen.getByLabelText(/Reason for change/).closest('form')!)
    expect(await screen.findByText('Prescription status updated. Sent to this hospital’s pharmacy.')).toBeTruthy()
    await waitFor(() => expect(sendButton()).toBeNull())
  })
})

describe('Send to pharmacy refused, in plain words', () => {
  it('says the visit was entered in error and closes the form (409 VISIT_ENTERED_IN_ERROR)', async () => {
    api.ownPharmacySend.mockRejectedValueOnce(new HidApiError(409, 'Encounter was entered in error', { code: 'VISIT_ENTERED_IN_ERROR' }))
    await openPrescription()
    fireEvent.click(sendButton()!)
    fireEvent.submit(sendForm())
    expect(await screen.findByText('This visit was marked entered in error, so nothing more can be sent from it.')).toBeTruthy()
    // The form closed: only the action's own button is left.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Send to pharmacy' })).toHaveLength(1))
    expect(document.body.textContent).not.toContain('could not be completed')
    expect(document.body.textContent).not.toContain('Encounter was entered in error')
  })

  it('says the patient’s approval for changes has ended, never to ask an administrator (403 CONSENT_REQUIRED)', async () => {
    api.ownPharmacySend.mockRejectedValueOnce(new HidApiError(403, 'Active consent and facility membership are required', { code: 'CONSENT_REQUIRED' }))
    await openPrescription()
    fireEvent.click(sendButton()!)
    fireEvent.submit(sendForm())
    expect(await screen.findByText(`${PATIENT_NAME}’s approval for changes to their record has ended. Ask them to approve a read-and-write request first.`)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/administrator|Active consent/)
  })

  it('reads the prescription again when it was not found (404), and closes the form', async () => {
    api.ownPharmacySend.mockRejectedValueOnce(new HidApiError(404, 'Clinical resource was not found', { code: 'CLINICAL_RESOURCE_NOT_FOUND' }))
    await openPrescription()
    fireEvent.click(sendButton()!)
    const reads = api.records.mock.calls.length
    fireEvent.submit(sendForm())
    expect(await screen.findByText('This prescription was not found, so it was not sent to the pharmacy. The list was reloaded.')).toBeTruthy()
    expect(api.records.mock.calls.length).toBeGreaterThan(reads)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Send to pharmacy' })).toHaveLength(1))
    expect(document.body.textContent).not.toContain('Clinical resource was not found')
  })
})

describe('A pending answer offers the send it asks for', () => {
  it('after Activate answers pending, offers Send to pharmacy even when the read could not say the pharmacy has staff', async () => {
    list = [prescription({ status: 'draft' })]
    api.updateRecord.mockImplementationOnce(async () => {
      list = [prescription({ rowVersion: 5, ownPharmacyStaffed: undefined })]
      return { ...prescription({ rowVersion: 5 }), pharmacyHandoff: PENDING }
    })
    api.ownPharmacySend.mockResolvedValueOnce(SENT)
    await openPrescription()
    changeStatus('Activate', 'Start treatment')
    expect(await screen.findByText('Prescription status updated. Not sent to the pharmacy yet. Use Send to pharmacy to try again.')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Send to pharmacy' }))
    list = [prescription({ rowVersion: 5, ownPharmacyStaffed: undefined, ownProgress: RECEIVED })]
    fireEvent.submit(sendForm())
    expect(await screen.findByText('Sent to this hospital’s pharmacy.')).toBeTruthy()
    expect(api.ownPharmacySend).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, RX, 5, null)
  })
})

describe('Today’s pharmacist hand-off beside the automatic send', () => {
  beforeEach(() => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
  })

  // A colleague's prescription: Send to pharmacy (the prescriber's) is not offered, so only the hand-off could be.
  const colleagues = (extra: Record<string, unknown> = {}) =>
    prescription({ createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId, ...extra })

  it.each([
    ['the pharmacy has it already (sent by itself on activation)', RECEIVED],
    ['the pharmacy dispensed it', { status: 'dispensed', dispensedAt: '2026-11-20T10:00:00.000Z' }],
  ])('is not offered when %s', async (_why, ownProgress) => {
    list = [colleagues({ ownProgress })]
    await openPrescription()
    expect(handoffButton()).toBeNull()
    expect(sendButton()).toBeNull()
  })

  it('is offered beside the prescriber’s own Send to pharmacy, as classic offers it on every active prescription (Clinical.tsx:1865)', async () => {
    list = [prescription()]
    await openPrescription()
    expect(sendButton()).toBeTruthy()
    expect(handoffButton()).toBeTruthy()
    // Each opens its own form: the hand-off's reason, the send's confirmation.
    fireEvent.click(handoffButton()!)
    expect(screen.getByRole('button', { name: 'Send to Pharmacy', expanded: true })).toBeTruthy()
  })

  it.each([
    ['the pharmacy has not received it', { status: 'not_received' }],
    ['the EHR sends no progress (before ORD-3)', undefined],
    ['the pharmacy could not be asked', { status: 'unknown' }],
  ])('is offered when %s', async (_why, ownProgress) => {
    list = [colleagues({ ownProgress })]
    await openPrescription()
    expect(handoffButton()).toBeTruthy()
  })
})

describe('Clinical paths of Send to pharmacy', () => {
  const TOKEN = 'd'.repeat(64)
  const SEVERE = {
    source: 'recorded', allergyId: 'a1240000-0000-4000-8000-000000000001', allergyIds: ['a1240000-0000-4000-8000-000000000001'],
    substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'severe', matchKind: 'same_class', className: 'penicillins',
    recordedHere: true, recordedOn: '2026-04-20T10:00:00.000Z',
    message: 'Penicillin allergy: SEVERE (Anaphylaxis). This medicine is one of the penicillins, the same group. Recorded by a clinician at this facility on 20 Apr 2026.',
  }
  const DETAIL = 'This medicine may match an allergy on the patient\'s record. Check the allergies and give a reason to go ahead.'
  /** The EHR's 409 as the http client gives it (hid-system#218 at 7fbb04aa): the match, the token, the missing acknowledgement. */
  const allergyRefused = () => new HidApiError(409, DETAIL, {
    code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED', detail: DETAIL,
    details: [{ field: 'allergyAcknowledgement', messages: [SEVERE.message] }, { field: 'allergyAcknowledgement.warningToken', messages: [TOKEN] },
      { field: 'allergyAcknowledgement.rejected', code: 'ALLERGY_ACKNOWLEDGEMENT_MISSING', messages: ['Check the allergies and give a reason to go ahead.'] }],
  })
  const REASON = 'Tolerated amoxicillin in 2025 with no reaction; observe for 30 minutes.'

  it('the EHR’s allergy warning, then the same send at the same version with the tick and the reason', async () => {
    api.ownPharmacySend.mockRejectedValueOnce(allergyRefused()).mockResolvedValueOnce(SENT)
    api.allergyCheck.mockResolvedValue({ matches: [SEVERE], acknowledgementRequired: true, warningToken: TOKEN })
    await openPrescription()
    fireEvent.click(sendButton()!)
    fireEvent.submit(sendForm())
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_GO_AHEAD_ERROR)
    // Sent first with no acknowledgement; nothing was written, so the page does not read the prescription again.
    expect(api.ownPharmacySend).toHaveBeenNthCalledWith(1, FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, RX, 4, null)
    const panel = screen.getByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    expect(within(panel).getAllByRole('listitem').map(line => line.textContent)).toEqual([SEVERE.message])
    expect(document.body.textContent).not.toContain('Check the allergies')
    expect(document.body.textContent).not.toContain(TOKEN)

    fireEvent.click(screen.getByRole('checkbox', { name: /^I have checked this allergy with the patient/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why is it safe to go ahead?' }), { target: { value: REASON } })
    list = [prescription({ ownProgress: RECEIVED })]
    fireEvent.submit(sendForm())
    expect(await screen.findByText('Sent to this hospital’s pharmacy.')).toBeTruthy()
    expect(api.ownPharmacySend).toHaveBeenCalledTimes(2)
    expect(api.ownPharmacySend).toHaveBeenNthCalledWith(2, FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, RX, 4, { reason: REASON, warningToken: TOKEN })
    await waitFor(() => expect(sendButton()).toBeNull())
  })

  it('Resume answers that the pharmacy holds an earlier version: the page says so and offers no send', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    list = [prescription({ status: 'on_hold', rowVersion: 6, ownProgress: { status: 'withdrawn', receivedAt: '2026-11-20T09:05:00.000Z' } })]
    api.updateRecord.mockImplementationOnce(async () => {
      list = [prescription({ rowVersion: 7, ownProgress: { status: 'withdrawn', receivedAt: '2026-11-20T09:05:00.000Z' } })]
      return { ...prescription({ rowVersion: 7 }), pharmacyHandoff: { status: 'not_sent', reason: 'superseded', message: 'whatever the server says' } }
    })
    await openPrescription()
    changeStatus('Resume', 'Results are back')
    expect(await screen.findByText('Prescription status updated. Not sent: this hospital’s pharmacy has an earlier version of this '
      + 'prescription, which it can no longer dispense.')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Put on hold' })).toBeTruthy())
    expect(sendButton()).toBeNull()
    expect(handoffButton()).toBeNull()
    expect(api.ownPharmacySend).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('whatever the server says')
  })
})
