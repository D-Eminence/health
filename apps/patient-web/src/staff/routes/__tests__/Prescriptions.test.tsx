import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'

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
  updateRecord: vi.fn(), acceptPrescription: vi.fn(),
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
 * prescription), and Pharmacy dispenses the copy it accepted whatever EHR says
 * later (pharmacy.service.ts dispense()). Until that is fixed (backend A1), the
 * clinician is told so where the change is confirmed.
 */
describe('changing the status of a prescription Pharmacy may hold', () => {
  it.each(['active', 'on_hold'])('says at the action that Pharmacy is not told and may still dispense a %s prescription it was sent', async status => {
    api.records.mockResolvedValue({ items: [{ ...active, status }, draft], nextCursor: null })
    await openPrescriptions()
    const button = within(entry('Amoxicillin')).getByRole('button', { name: 'Update status' })
    const warning = descriptions(button)
    expect(warning).toContain('Pharmacy is not told of this change.')
    expect(warning).toContain('Pharmacy may still dispense the earlier version it was sent')
    expect(warning).toContain('you must contact the pharmacy')
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
    expect(await within(form).findByText('Prescription changed since it was loaded')).toBeTruthy()
    expect(descriptions(within(form).getByRole('button', { name: 'Update status' }))).toContain('Pharmacy is not told of this change.')
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
    expect(await within(form).findByText('Network error')).toBeTruthy()

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
    expect(await within(form).findByText('Pharmacy access is not authorized')).toBeTruthy()
    expect(screen.queryByText('Pharmacy accepted this exact prescription version.')).toBeNull()
  })
})
