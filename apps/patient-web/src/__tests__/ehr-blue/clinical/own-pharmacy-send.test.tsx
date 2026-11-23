import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EncounterOrderPages, orderPath } from '../../../ehr-blue/clinical/consult/orders'
import { handoffRetryable, ownSendOffered, readPharmacyHandoff } from '../../../ehr-blue/clinical/consult/orders/ownPharmacySend'
import { ChartProvider } from '../../../ehr-blue/clinical/parts/chart'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { COLLEAGUE, ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, SIGNED_IN, activePatient, allowedLookup, renderPage, type SignedIn } from './harness'

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
})

describe('Send to pharmacy on the prescription page', () => {
  it('sends the prescription with its row version, says it was sent, and does not offer it again', async () => {
    api.ownPharmacySend.mockResolvedValueOnce({ pharmacyHandoff: { status: 'sent', message: 'Sent to this hospital\'s pharmacy.' } })
    await openPrescription()
    // Today's pharmacist hand-off is not offered beside it.
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
