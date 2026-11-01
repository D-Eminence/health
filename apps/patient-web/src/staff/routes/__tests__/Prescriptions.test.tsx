import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { SAID_CHANGED, SAID_REFUSED } from '../../../__tests__/said'

/**
 * Prescriptions as hid-system EHR takes them (ehr/prescriptions/prescriptions.controller.ts,
 * ehr/shared/clinical.dto.ts CreatePrescriptionDto): a draft with a dose of at
 * least 0.0001 to 4 decimal places, given with its unit or not at all; a status
 * change with the loaded version and a reason; and the Pharmacy handoff of an
 * active prescription (POST …/pharmacy-work-item, reason 8-500 characters),
 * which needs pharmacy.work-item.accept and a write grant. EHR seeds that
 * permission for pharmacists only.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), acceptPrescription: vi.fn(), updateEncounter: vi.fn(), encounter: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Pharmacist', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['pharmacist'], permissions: staff.permissions,
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const base = { patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z',
  doseQuantity: '500', doseUnit: 'mg', routeCode: 'oral', instructions: 'Take with food' }
const active = { ...base, id: 'rx-1', medicationDisplay: 'Amoxicillin', frequency: 'Three times daily', status: 'active', rowVersion: '3' }
const draft = { ...base, id: 'rx-2', medicationDisplay: 'Ibuprofen', frequency: 'As needed', status: 'draft', rowVersion: '1' }
const PRESCRIBE = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write']
const HAND_OFF = [...PRESCRIBE, 'pharmacy.work-item.accept']

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = HAND_OFF
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockResolvedValue({ items: [active, draft], nextCursor: null })
  api.createRecord.mockResolvedValue({ ...draft, id: 'rx-3' })
  api.updateRecord.mockResolvedValue({ ...draft, status: 'active', rowVersion: '2' })
  api.acceptPrescription.mockResolvedValue({ id: 'work-item-1' })
})

function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }
function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

async function openPrescriptions() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Prescriptions' }))
  await screen.findByText('Amoxicillin')
}

function entry(medication: string) {
  return screen.getByText(medication).closest<HTMLElement>('.staff-list-item')!
}

async function draftForm() {
  await openPrescriptions()
  return screen.getByRole('button', { name: 'Save draft' }).closest('form')!
}

function fillDraft(form: HTMLElement) {
  type(form, 'Medication', 'Paracetamol')
  type(form, 'Frequency', 'Every six hours')
  type(form, 'Instructions', 'Do not exceed four doses a day')
}

describe('creating a draft prescription', () => {
  it('sends the dose with its unit, the route and the instructions as a draft', async () => {
    const form = await draftForm()
    fillDraft(form)
    type(form, 'Dose quantity', '500')
    type(form, 'Dose unit', 'mg')
    type(form, 'Route code', 'oral')
    fireEvent.click(within(form).getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions', {
      medicationDisplay: 'Paracetamol', doseQuantity: 500, doseUnit: 'mg', routeCode: 'oral', frequency: 'Every six hours',
      instructions: 'Do not exceed four doses a day', status: 'draft',
    }, expect.any(String)))
  })

  it('refuses a dose without its unit, and sends nothing', async () => {
    const form = await draftForm()
    fillDraft(form)
    type(form, 'Dose quantity', '500')
    fireEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    expect(await within(form).findByText('Enter both dose quantity and dose unit, or leave both blank.')).toBeTruthy()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('lets the browser refuse a dose EHR would refuse: at least 0.0001, to 4 decimal places', async () => {
    const form = await draftForm()
    const dose = within(form).getByLabelText(labelled('Dose quantity')) as HTMLInputElement
    const valid = (value: string) => { fireEvent.change(dose, { target: { value } }); return dose.checkValidity() }
    expect(valid('0.0001')).toBe(true)
    expect(valid('2.5')).toBe(true)
    expect(valid('0')).toBe(false)
    expect(valid('-1')).toBe(false)
    expect(valid('0.00005')).toBe(false)
    // Above the minimum, a fifth decimal place is refused too (step 0.0001, not any).
    expect(valid('1.0005')).toBe(true)
    expect(valid('1.00005')).toBe(false)
  })

  it('limits each text field to what EHR accepts', async () => {
    const form = await draftForm()
    const limit = (label: string) => (within(form).getByLabelText(labelled(label)) as HTMLInputElement).maxLength
    expect(limit('Medication')).toBe(500)
    expect(limit('Dose unit')).toBe(80)
    expect(limit('Route code')).toBe(100)
    expect(limit('Frequency')).toBe(240)
    expect(limit('Instructions')).toBe(4000)
  })
})

describe('changing a prescription status', () => {
  it('sends the new status with the loaded version and a reason', async () => {
    await openPrescriptions()
    const form = within(entry('Ibuprofen')).getByRole('button', { name: 'Update status' }).closest('form')!
    const options = within(within(form).getByLabelText(labelled('New status'))).getAllByRole('option').map(option => (option as HTMLOptionElement).value)
    expect(options).toEqual(['active', 'cancelled', 'entered_in_error'])
    type(form, 'New status', 'active')
    type(form, 'Reason for change', 'Reviewed dose')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions', 'rx-2',
      { expectedRowVersion: 1, changeReason: 'Reviewed dose', status: 'active' }))
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
  })
})

/** The text of everything that describes `element`, in order. */
function descriptions(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

/**
 * EHR passes no change to Pharmacy (hid-system prescriptions.service.ts update()
 * writes EHR only; acceptForPharmacy is the only Pharmacy call, for an active
 * prescription). Since hid-system #48 (migration 0080) Pharmacy dispenses only
 * while the prescription is still active at the version it accepted: a hold,
 * completion, cancellation, entered in error or any edit leaves its work item
 * undispensable, a resume included (409 PHARMACY_PRESCRIPTION_NOT_DISPENSABLE),
 * and a dispensing recorded before is not undone. Before 0080 Pharmacy still
 * dispenses a cancelled prescription, and nothing in a response tells the two
 * apart, so the clinician is told what holds for both where the change is
 * confirmed: contact the pharmacy, and prescribe again if it cannot dispense.
 */
describe('changing the status of a prescription Pharmacy may hold', () => {
  it.each(['active', 'on_hold'])('says at the action that Pharmacy is not told of a change to a %s prescription, so the pharmacy must be contacted', async status => {
    api.records.mockResolvedValue({ items: [{ ...active, status }, draft], nextCursor: null })
    await openPrescriptions()
    const button = within(entry('Amoxicillin')).getByRole('button', { name: 'Update status' })
    const warning = descriptions(button)
    expect(warning).toContain('Pharmacy is not told of this change, so if this prescription was sent to Pharmacy you must contact the pharmacy.')
    expect(warning).toContain('A dispensing already recorded is not undone.')
    expect(warning).toContain('Pharmacy may refuse to dispense the version it was sent')
    expect(warning).toContain('even after it is resumed')
    expect(warning).toContain('if treatment is to continue and the pharmacy cannot dispense it, create a new prescription and send it')
    // True only once migration 0080 is deployed; a Pharmacy before it still dispenses a cancelled prescription.
    expect(warning).not.toContain('can no longer dispense')
    expect(warning).not.toContain('does not make it dispensable')
    // Shown in the form before the change is confirmed, not a message that comes and goes.
    const shown = document.getElementById(button.getAttribute('aria-describedby')!)!
    expect(button.closest('form')!.contains(shown)).toBe(true)
    expect(shown.closest('[role="alert"], [role="status"]')).toBeNull()
  })

  it('keeps the warning in the form when the change is refused, and sends the change as before', async () => {
    api.updateRecord.mockRejectedValueOnce(new HidApiError(412, 'Prescription changed since it was loaded', { code: 'VERSION_CONFLICT' }))
    await openPrescriptions()
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Update status' }).closest('form')!
    type(form, 'New status', 'cancelled')
    type(form, 'Reason for change', 'Allergy reported')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions', 'rx-1',
      { expectedRowVersion: 3, changeReason: 'Allergy reported', status: 'cancelled' }))
    expect(await within(form).findByText(SAID_CHANGED)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Prescription changed since it was loaded')
    expect(descriptions(within(form).getByRole('button', { name: 'Update status' }))).toContain('Pharmacy is not told of this change')
  })

  // The status form and the handoff form once shared a React key, so a redraw of
  // the list could leave a second status form, and its warning, under the same ids.
  it('shows the status form, and its warning, once however often the list is drawn again', async () => {
    await openPrescriptions()
    expect(await within(entry('Amoxicillin')).findByRole('button', { name: 'Send to Pharmacy' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh encounters' }))
    await waitFor(() => expect(api.encounters).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh encounters' }).getAttribute('aria-disabled')).toBeNull())
    expect(within(entry('Amoxicillin')).getAllByRole('button', { name: 'Update status' })).toHaveLength(1)
    expect(within(entry('Amoxicillin')).getAllByRole('button', { name: 'Send to Pharmacy' })).toHaveLength(1)
    expect(document.querySelectorAll('#prescription-rx-1-status')).toHaveLength(1)
  })

  it('gives no Pharmacy warning on a draft, which EHR never sends to Pharmacy', async () => {
    await openPrescriptions()
    const button = within(entry('Ibuprofen')).getByRole('button', { name: 'Update status' })
    expect(button.getAttribute('aria-describedby')).toBeNull()
    expect(entry('Ibuprofen').textContent).not.toContain('Pharmacy is not told')
  })
})

/**
 * Since hid-system #64 (CLIN-EIE, migration 0084) a change to an encounter's
 * status also closes its records, in the same transaction (encounters.service.ts
 * CLOSE_STEPS; INTERFACE_CONTRACT.md "Encounter status and its records"):
 * cancelling cancels its draft, active and on-hold prescriptions and lab
 * requests, and leaves everything else. Since hid-system #74 (ENC-RETRACT-2,
 * migration 0090) marking it entered in error marks its notes, its diagnoses,
 * its final vitals, its draft, active, on-hold and completed prescriptions and
 * lab requests, and its initiated or uploaded documents entered in error.
 * Neither Pharmacy nor Lab hears of it. Every status change the portal offers an
 * encounter includes Cancel and Mark entered in error, so the clinician is told
 * so where the change is confirmed. The answer is the encounter (with
 * `cascade`), so the records shown are read again. A close that would change a
 * kind of record the actor may not write is refused, with nothing written, as
 * 403 ENCOUNTER_RETRACTION_NOT_PERMITTED and a fixed detail naming no kind
 * (ENC-RETRACT-1).
 */
describe('changing the status of an encounter whose orders Pharmacy or Lab may hold', () => {
  it.each(['planned', 'in_progress', 'on_hold'])('says at the action what cancelling a %s encounter does to its orders, and whom to contact', async status => {
    staff.permissions = [...HAND_OFF, 'ehr.encounter.write']
    api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
      status, startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
    await openPrescriptions()
    const form = screen.getByText('Encounter status').closest('form')!
    const options = within(within(form).getByLabelText(labelled('New status'))).getAllByRole('option').map(option => (option as HTMLOptionElement).value)
    expect(options).toEqual(expect.arrayContaining(['cancelled', 'entered_in_error']))
    const button = within(form).getByRole('button', { name: 'Update status' })
    const warning = descriptions(button)
    expect(warning).not.toContain('does not cancel')
    expect(warning).not.toContain('Cancel each order itself')
    expect(warning).toContain('Cancelling this encounter also cancels its draft, active and on-hold prescriptions and lab requests')
    // Cancelling has no step for notes, diagnoses, vitals, documents or a completed order.
    expect(warning).toContain('its notes, diagnoses, vitals, documents and completed orders are not changed')
    // Since 0090 a retraction also covers final vitals, completed orders and initiated or uploaded documents.
    expect(warning).toContain('Marking it entered in error also marks entered in error its notes, diagnoses and vitals, its documents (other than rejected uploads), and its prescriptions and lab requests that are not cancelled, completed ones included')
    expect(warning).not.toContain('Completed orders, vitals and documents are not changed')
    expect(warning).toContain('Pharmacy and the Laboratory are not told')
    expect(warning).toContain('contact the pharmacy or laboratory')
    // Shown in the form before the change is confirmed, not a message that comes and goes.
    const shown = document.getElementById(button.getAttribute('aria-describedby')!)!
    expect(form.contains(shown)).toBe(true)
    expect(shown.closest('[role="alert"], [role="status"]')).toBeNull()
  })

  it.each([['cancelled', 'Cancel'], ['entered_in_error', 'Mark entered in error']])('reads the records shown again once the encounter is %s', async (status, label) => {
    staff.permissions = [...HAND_OFF, 'ehr.encounter.write']
    const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
      startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null }
    api.encounters.mockResolvedValue({ items: [{ ...encounter, status: 'in_progress', rowVersion: 1 }], nextCursor: null })
    await openPrescriptions()
    expect(within(entry('Amoxicillin')).getByRole('button', { name: 'Update status' })).toBeTruthy()
    const closed = { ...encounter, status, rowVersion: 2 }
    api.updateEncounter.mockResolvedValue(closed)
    api.encounters.mockResolvedValue({ items: [closed], nextCursor: null })
    api.records.mockResolvedValue({ items: [{ ...active, status, rowVersion: '4' }, { ...draft, status, rowVersion: '2' }], nextCursor: null })
    const form = screen.getByText('Encounter status').closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('New status')), { target: { value: status } })
    expect((within(form).getByRole('option', { name: label }) as HTMLOptionElement).selected).toBe(true)
    type(form, 'Reason for change', 'Duplicate encounter')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    expect(await screen.findByText('Encounter status updated.')).toBeTruthy()
    expect(api.updateEncounter).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER,
      expect.objectContaining({ status, expectedRowVersion: 1, changeReason: 'Duplicate encounter' }))
    await waitFor(() => expect(api.records).toHaveBeenCalledTimes(2))
    expect(api.records).toHaveBeenLastCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions', expect.objectContaining({ fresh: true }))
    // The closed orders are shown as the EHR now holds them, without a status change to offer.
    await waitFor(() => expect(within(entry('Amoxicillin')).queryByRole('button', { name: 'Update status' })).toBeNull())
    expect(within(entry('Ibuprofen')).queryByRole('button', { name: 'Update status' })).toBeNull()
  })

  it.each([
    ['cancelled', 'You may not cancel this encounter'],
    ['entered_in_error', 'You may not mark this encounter entered in error'],
  ])('says why a change to %s refused for records the role may not change was not made, and changes nothing', async (status, refusal) => {
    staff.permissions = [...HAND_OFF, 'ehr.encounter.write']
    await openPrescriptions()
    api.updateEncounter.mockRejectedValue(new HidApiError(403, 'Cancelling or retracting this encounter changes records you may not write',
      { code: 'ENCOUNTER_RETRACTION_NOT_PERMITTED' }))
    const form = screen.getByText('Encounter status').closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('New status')), { target: { value: status } })
    type(form, 'Reason for change', 'Opened on the wrong patient')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    const alert = await within(form).findByRole('alert')
    expect(alert.textContent).toContain(`${refusal}: it holds records that this change would also change, and your role may not change all of them.`)
    expect(alert.textContent).toContain('Nothing was changed.')
    expect(alert.textContent).toContain('Ask a colleague whose role may change all of its records')
    // It is not a stale encounter: nothing is read again, and nothing is said to have changed.
    expect(api.encounter).not.toHaveBeenCalled()
    expect(api.records).toHaveBeenCalledTimes(1)
    expect(api.encounters).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Encounter status updated.')).toBeNull()
    // The choice and the reason stay, to be shown to the colleague or changed.
    expect((within(form).getByLabelText(labelled('New status')) as HTMLSelectElement).value).toBe(status)
    expect((within(form).getByLabelText(labelled('Reason for change')) as HTMLInputElement).value).toBe('Opened on the wrong patient')
  })

  it('reads again the records tab shown when the change is answered, after the clinician moved to another', async () => {
    staff.permissions = [...HAND_OFF, 'ehr.encounter.write', 'ehr.lab-request.read']
    const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
      startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null }
    api.encounters.mockResolvedValue({ items: [{ ...encounter, status: 'in_progress', rowVersion: 1 }], nextCursor: null })
    await openPrescriptions()
    let answer: (value: unknown) => void = () => {}
    api.updateEncounter.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const form = screen.getByText('Encounter status').closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('New status')), { target: { value: 'cancelled' } })
    type(form, 'Reason for change', 'Duplicate encounter')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    await waitFor(() => expect(api.updateEncounter).toHaveBeenCalled())
    // The lab requests read on moving to their tab may reach EHR before the change commits.
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    fireEvent.click(screen.getByRole('tab', { name: 'Lab requests' }))
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab-requests'))
    const reads = api.records.mock.calls.length
    const closed = { ...encounter, status: 'cancelled', rowVersion: 2 }
    api.encounters.mockResolvedValue({ items: [closed], nextCursor: null })
    answer(closed)
    expect(await screen.findByText('Encounter status updated.')).toBeTruthy()
    expect(api.records).toHaveBeenCalledTimes(reads + 1)
    expect(api.records).toHaveBeenLastCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab-requests', expect.objectContaining({ fresh: true }))
  })
})

describe('sending a prescription to Pharmacy', () => {
  it('is offered only for an active prescription', async () => {
    await openPrescriptions()
    expect(within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' })).toBeTruthy()
    expect(within(entry('Ibuprofen')).queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
  })

  it('is not offered without pharmacy.work-item.accept', async () => {
    staff.permissions = PRESCRIBE
    await openPrescriptions()
    expect(screen.queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
  })

  it('is not offered under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openPrescriptions()
    expect(await screen.findByText(/Read-only access/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
  })

  it('sends the loaded version and the reason, reusing its key when retried', async () => {
    api.acceptPrescription.mockRejectedValueOnce(new Error('Network error'))
    await openPrescriptions()
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    type(form, 'Reason', 'Patient collecting today')
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))
    expect(await within(form).findByText('Send to Pharmacy could not be completed.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Network error')

    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))
    await waitFor(() => expect(api.acceptPrescription).toHaveBeenCalledTimes(2))
    expect(api.acceptPrescription).toHaveBeenLastCalledWith('facility-1', PATIENT, ENCOUNTER, 'rx-1', 3, 'Patient collecting today', expect.any(String))
    expect(api.acceptPrescription.mock.calls[1]![6]).toBe(api.acceptPrescription.mock.calls[0]![6])
    expect(await screen.findByText('Pharmacy accepted this exact prescription version.')).toBeTruthy()
  })

  it('shows a refusal where the handoff was made', async () => {
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(403, 'Pharmacy access is not authorized', { code: 'PHARMACY_ACCESS_DENIED' }))
    await openPrescriptions()
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    type(form, 'Reason', 'Patient collecting today')
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))
    expect(await within(form).findByText(SAID_REFUSED)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Pharmacy access is not authorized')
    expect(screen.queryByText('Pharmacy accepted this exact prescription version.')).toBeNull()
  })

  // hid-system #48: Pharmacy accepts only the exact active prescription version EHR
  // checked; one changed, held or cancelled meanwhile answers 409
  // PHARMACY_PRESCRIPTION_NOT_ELIGIBLE, which EHR passes through.
  it('reads the list again when Pharmacy finds the prescription no longer matches what was sent', async () => {
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(409, 'Pharmacy acceptance must match the current active EHR prescription version',
      { code: 'PHARMACY_PRESCRIPTION_NOT_ELIGIBLE' }))
    await openPrescriptions()
    api.records.mockClear()
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    type(form, 'Reason', 'Patient collecting today')
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))

    expect(await screen.findByText(/This prescription no longer matches what was sent/)).toBeTruthy()
    expect(screen.getByText(/The list was reloaded/)).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions', { cursor: undefined, fresh: true })
    expect(screen.queryByText('Pharmacy accepted this exact prescription version.')).toBeNull()
  })

  it('says only that the list could not be reloaded when reading it again fails', async () => {
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(409, 'Pharmacy acceptance must match the current active EHR prescription version',
      { code: 'PHARMACY_PRESCRIPTION_NOT_ELIGIBLE' }))
    await openPrescriptions()
    api.records.mockRejectedValue(new Error('Service unavailable'))
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    type(form, 'Reason', 'Patient collecting today')
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))

    const said = await screen.findByText(/This prescription no longer matches what was sent/)
    expect(said.textContent).toMatch(/The list could not be reloaded/)
    expect(said.textContent).not.toMatch(/list was reloaded/)
  })

  it('does not say the list could not be reloaded when another list replaced the read', async () => {
    staff.permissions = [...HAND_OFF, 'ehr.note.read']
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(409, 'Pharmacy acceptance must match the current active EHR prescription version',
      { code: 'PHARMACY_PRESCRIPTION_NOT_ELIGIBLE' }))
    await openPrescriptions()
    let reread: (value: unknown) => void = () => {}
    api.records.mockImplementationOnce(() => new Promise(resolve => { reread = resolve }))
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    type(form, 'Reason', 'Patient collecting today')
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions', { cursor: undefined, fresh: true }))
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    reread({ items: [active, draft], nextCursor: null })

    const said = await screen.findByText(/This prescription no longer matches what was sent/)
    expect(said.textContent).not.toMatch(/could not be reloaded/)
  })

  // hid-system 0100: Pharmacy checks the prescription itself as it accepts it, and the EHR passes its refusal on.
  it.each([
    ['PRESCRIPTION_SOURCE_VERSION_MISMATCH', 409, 'This prescription changed since it was read; reload it and send it again',
      'This prescription changed since it was loaded, so it was not sent to Pharmacy: check it, and send it again if it is still needed.'],
    ['PRESCRIPTION_SOURCE_NOT_ACTIVE', 409, 'This prescription is no longer active, so Pharmacy did not accept it',
      'This prescription is no longer active, so it was not sent to Pharmacy.'],
    ['PRESCRIPTION_SOURCE_NOT_FOUND', 404, 'The prescription was not found at this facility',
      'This prescription can’t be sent to Pharmacy as it is: check it, and try again if it is still needed.'],
    ['PRESCRIPTION_SOURCE_MISMATCH', 422, 'The details sent do not match the prescription, so Pharmacy did not accept it',
      'This prescription can’t be sent to Pharmacy as it is: check it, and try again if it is still needed.'],
  ])('reads the list again and says plainly why Pharmacy refused it (%s)', async (code, status, detail, said) => {
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(status, detail, { code }))
    await openPrescriptions()
    api.records.mockClear()
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    type(form, 'Reason', 'Patient collecting today')
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))

    expect(await screen.findByText(`${said} The list was reloaded.`)).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'prescriptions', { cursor: undefined, fresh: true })
    expect(document.body.textContent).not.toContain(code)
    expect(document.body.textContent).not.toContain(detail)
    expect(screen.queryByText('Pharmacy accepted this exact prescription version.')).toBeNull()
  })

  // Pharmacy holds one work item per prescription (pharmacy.service.ts acceptEhrPrescription).
  it('says Pharmacy already holds work for a prescription sent before, and that a changed one needs a new prescription', async () => {
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(409, 'Prescription acceptance conflicts with existing Pharmacy work',
      { code: 'IDEMPOTENCY_CONFLICT' }))
    await openPrescriptions()
    const form = within(entry('Amoxicillin')).getByRole('button', { name: 'Send to Pharmacy' }).closest('form')!
    type(form, 'Reason', 'Patient collecting today')
    fireEvent.click(within(form).getByRole('button', { name: 'Send to Pharmacy' }))

    const said = await within(form).findByRole('alert')
    expect(said.textContent).toMatch(/Pharmacy already holds work for this prescription/)
    expect(said.textContent).toMatch(/contact the pharmacy/)
    expect(said.textContent).toMatch(/create a new prescription/)
    // A Pharmacy before migration 0080 still dispenses a changed prescription.
    expect(said.textContent).not.toMatch(/Pharmacy cannot dispense it/)
  })
})
