import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { Laboratory, Pharmacy } from '../Operations'
import { Patients } from '../Patients'

/**
 * PEHR-04 (WCAG 3.3.1 Error Identification, 1.3.1). Field errors on the
 * provider screens were shown in an alert at the bottom of the form or page and
 * tied to nothing: no aria-invalid, no aria-describedby. A value refused before
 * sending (a short or blank reason, a malformed PIN, a dose without its unit,
 * nothing changed) is now reported at its field, or at the group of fields a
 * rule covers, which takes focus; the field's description announces it. Refused
 * from Enter in the field itself, focus does not move, so the message is an
 * alert there instead; as both it would be spoken twice. A 400 VALIDATION_FAILED
 * marks each field it names that the form has.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn(),
  consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn(), updateDiagnosis: vi.fn(),
  labWorkItems: vi.fn(), labAccession: vi.fn(), transitionSpecimen: vi.fn(), labExecutions: vi.fn(),
  pharmacyWorkItems: vi.fn(), dispense: vi.fn(),
}))
const staff = vi.hoisted(() => ({ activePatient: null as unknown }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['identity.patient.read', 'identity.consent.write', 'identity.patient-access-pin.verify', 'identity.break-glass.write',
        'ehr.encounter.read', 'ehr.note.read', 'ehr.note.write', 'ehr.vital.read', 'ehr.vital.write', 'ehr.diagnosis.read', 'ehr.diagnosis.write',
        'lab.work-item.read', 'lab.accession.read', 'lab.specimen.reject', 'pharmacy.work-item.read', 'pharmacy.dispensing.create'],
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(() => true),
    lock: null,
  }),
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF23', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, breakGlass: false } }
const diagnosis = { id: 'diagnosis-1', patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z',
  codeSystem: 'ICD-10', code: 'B54', display: 'Malaria', clinicalStatus: 'active', verificationStatus: 'provisional', notes: null, rowVersion: '2' }

/** The text of every element that describes `element`. */
const described = (element: Element) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()
function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }

/** A refusal reported at `control`: marked invalid, described by `message`, and focused; not also an alert. */
async function expectRefusedAt(control: HTMLElement, message: string) {
  await waitFor(() => expect(document.activeElement).toBe(control))
  expect(control.getAttribute('aria-invalid')).toBe('true')
  expect(described(control)).toBe(message)
  expect(screen.queryAllByRole('alert').filter(alert => alert.textContent === message)).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = null
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'diagnoses' ? [diagnosis] : [], nextCursor: null }))
  api.labExecutions.mockResolvedValue({ items: [] })
})

describe('patient access', () => {
  function renderPatients() {
    render(<MemoryRouter><Patients /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
  }

  it('a malformed PIN is refused at the PIN field', async () => {
    renderPatients()
    fireEvent.click(screen.getByRole('button', { name: 'Patient PIN' }))
    const pin = screen.getByLabelText(/^Patient access PIN/)
    fireEvent.change(pin, { target: { value: '12' } })
    fireEvent.submit(pin.closest('form')!)
    await expectRefusedAt(pin, 'Enter the patient’s 4 to 8 digit access PIN.')
    expect(api.verifyPin).not.toHaveBeenCalled()
  })

  it('a short request reason is refused at the reason field', async () => {
    renderPatients()
    const reason = screen.getByLabelText(/^Clinical reason/)
    fireEvent.change(reason, { target: { value: '        ' } })
    fireEvent.submit(reason.closest('form')!)
    await expectRefusedAt(reason, 'Enter a clinical reason of at least 8 characters.')
    expect(api.requestAccess).not.toHaveBeenCalled()
  })

  it('a short emergency reason is refused at its field', async () => {
    renderPatients()
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
    const reason = screen.getByLabelText(/^Emergency reason/)
    fireEvent.change(reason, { target: { value: 'urgent' } })
    fireEvent.submit(reason.closest('form')!)
    await expectRefusedAt(reason, 'Document the emergency reason in at least 8 characters.')
    expect(api.breakGlass).not.toHaveBeenCalled()
  })

  it('refused from Enter in the field itself, where focus already is, the message is an alert', async () => {
    renderPatients()
    const reason = screen.getByLabelText(/^Clinical reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    reason.focus()
    fireEvent.submit(reason.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a clinical reason of at least 8 characters.')
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(described(reason)).toBe('Enter a clinical reason of at least 8 characters.')
  })
})

describe('the clinical record', () => {
  async function openDiagnoses() {
    staff.activePatient = { hid: 'HID-ABCDEF23', purpose: 'direct-care', lookup }
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Diagnoses' }))
    await screen.findByText('Malaria')
  }

  it('a diagnosis update that changes nothing is refused at the group of fields it could change', async () => {
    await openDiagnoses()
    const form = screen.getByRole('button', { name: 'Update diagnosis' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('Reason for change')), { target: { value: 'No real change' } })
    fireEvent.submit(form)
    const group = within(form).getByRole('group', { name: 'Diagnosis changes' })
    await waitFor(() => expect(described(group)).toBe('Change the clinical status, verification or notes before saving.'))
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText(labelled('Clinical status'))))
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
  })

  it('a reason of spaces is refused at the reason field', async () => {
    await openDiagnoses()
    const form = screen.getByRole('button', { name: 'Update diagnosis' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    const reason = within(form).getByLabelText(labelled('Reason for change'))
    fireEvent.change(reason, { target: { value: '     ' } })
    fireEvent.submit(form)
    await expectRefusedAt(reason, 'Give a reason of at least 3 characters.')
  })

  it('one blood pressure reading without the other is refused at the missing one', async () => {
    staff.activePatient = { hid: 'HID-ABCDEF23', purpose: 'direct-care', lookup }
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Vitals' }))
    const form = (await screen.findByRole('button', { name: 'Save record' })).closest('form')!
    fireEvent.change(within(form).getByLabelText('Systolic BP (mmHg)'), { target: { value: '120' } })
    fireEvent.submit(form)
    await expectRefusedAt(within(form).getByLabelText('Diastolic BP (mmHg)'), 'Enter both systolic and diastolic blood pressure, or leave both blank.')
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  // A rule about a group is described at the group, which a screen reader does not
  // read again when focus moves within it, and the group's first field is not
  // described by it. Refused from Enter in one of the group's fields, the rule is
  // an alert there and focus stays; from outside the group, focus moves into it.
  async function vitalsForm() {
    staff.activePatient = { hid: 'HID-ABCDEF23', purpose: 'direct-care', lookup }
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Vitals' }))
    return (await screen.findByRole('button', { name: 'Save record' })).closest('form')!
  }

  it('a rule about the vitals together, refused from Enter in a later vital, is an alert there', async () => {
    const form = await vitalsForm()
    const pulse = within(form).getByLabelText('Pulse (bpm)')
    pulse.focus()
    fireEvent.submit(form)
    expect((await within(form).findByRole('alert')).textContent).toBe('Enter at least one vital measurement.')
    expect(document.activeElement).toBe(pulse)
    expect(described(within(form).getByRole('group', { name: 'Vital measurements' }))).toBe('Enter at least one vital measurement.')
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('the same rule refused from the form’s button moves focus into the group, and is not also an alert', async () => {
    const form = await vitalsForm()
    within(form).getByRole('button', { name: 'Save record' }).focus()
    fireEvent.submit(form)
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Systolic BP (mmHg)')))
    expect(described(within(form).getByRole('group', { name: 'Vital measurements' }))).toBe('Enter at least one vital measurement.')
    expect(within(form).queryAllByRole('alert')).toEqual([])
  })

  it('a correction that changes nothing, refused from Enter in a later vital, is an alert there', async () => {
    const vital = { id: 'vital-1', patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z',
      recordedAt: '2026-10-10T08:05:00.000Z', pulseBpm: 72, systolicMmhg: null, diastolicMmhg: null, currentCorrectionNo: 0, rowVersion: '1' }
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'vitals' ? [vital] : [], nextCursor: null }))
    await vitalsForm()
    fireEvent.click(await screen.findByRole('button', { name: 'Correct these vitals' }))
    const form = screen.getByRole('button', { name: 'Save correction' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('Reason for correction')), { target: { value: 'Misread' } })
    const pulse = within(form).getByLabelText('Pulse (bpm)')
    pulse.focus()
    fireEvent.submit(form)
    expect((await within(form).findByRole('alert')).textContent).toBe('Change at least one value before saving a correction.')
    expect(document.activeElement).toBe(pulse)
    expect(described(within(form).getByRole('group', { name: 'Corrected vital measurements' }))).toBe('Change at least one value before saving a correction.')
  })

  it('a field EHR refuses with 400 VALIDATION_FAILED is marked and described at that field', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', { code: 'VALIDATION_FAILED',
      details: [{ field: 'display', messages: ['display must be shorter than or equal to 500 characters'] }] }))
    await openDiagnoses()
    const form = screen.getByRole('button', { name: 'Save record' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(within(form).getByLabelText(labelled('Code')), { target: { value: 'A01' } })
    fireEvent.change(within(form).getByLabelText(labelled('Display')), { target: { value: 'Typhoid' } })
    fireEvent.submit(form)
    expect((await within(form).findByRole('alert')).textContent).toContain('Display must be shorter than or equal to 500 characters.')
    const display = within(form).getByLabelText(labelled('Display'))
    expect(display.getAttribute('aria-invalid')).toBe('true')
    expect(described(display)).toBe('Display must be shorter than or equal to 500 characters.')
  })
})

describe('laboratory and pharmacy', () => {
  it('a blank rejection reason is refused at its field', async () => {
    api.labWorkItems.mockResolvedValue({ items: [{ id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin',
      accessionId: 'accession-1', accessionNumber: 'ACC-1', acceptedAt: '2026-10-09T08:00:00.000Z' }] })
    api.labAccession.mockResolvedValue({ id: 'accession-1', accessionNumber: 'ACC-1', workItemId: 'work-item-1', status: 'open',
      specimens: [{ id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-1', specimenType: 'Venous blood', status: 'required', version: 2 }] })
    render(<Laboratory />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open accession' }))
    const step = await screen.findByLabelText('Next step')
    fireEvent.change(step, { target: { value: 'reject' } })
    fireEvent.submit(step.closest('form')!)
    await expectRefusedAt(screen.getByLabelText(labelled('Rejection reason')), 'Enter a rejection reason.')
    expect(api.transitionSpecimen).not.toHaveBeenCalled()
  })

  it('a dispensing reason of spaces is refused at the reason field', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ id: 'work-item-9', patientId: PATIENT, version: 3, acceptedAt: '2026-10-08T09:30:00.000Z',
      medication: { display: 'Amoxicillin' }, doseQuantity: 1, doseUnit: 'capsule', frequency: 'Three times daily', dispensing: null }] })
    render(<Pharmacy />)
    const quantity = await screen.findByRole('spinbutton', { name: 'Quantity dispensed' })
    fireEvent.change(quantity, { target: { value: '21' } })
    const reason = screen.getByRole('textbox', { name: 'Reason' })
    fireEvent.change(reason, { target: { value: '        ' } })
    fireEvent.submit(reason.closest('form')!)
    await expectRefusedAt(reason, 'Enter a reason of at least 8 characters.')
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('a quantity of 0 is refused at the quantity field', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ id: 'work-item-9', patientId: PATIENT, version: 3, acceptedAt: '2026-10-08T09:30:00.000Z',
      medication: { display: 'Amoxicillin' }, doseQuantity: 1, doseUnit: 'capsule', frequency: 'Three times daily', dispensing: null }] })
    render(<Pharmacy />)
    const quantity = await screen.findByRole('spinbutton', { name: 'Quantity dispensed' })
    fireEvent.change(quantity, { target: { value: '0' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Full course dispensed' } })
    fireEvent.submit(quantity.closest('form')!)
    await expectRefusedAt(quantity, 'Enter a positive quantity and unit.')
    expect(api.dispense).not.toHaveBeenCalled()
  })
})
