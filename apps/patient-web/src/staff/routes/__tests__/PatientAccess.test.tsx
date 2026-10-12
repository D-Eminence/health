import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Patients } from '../Patients'

/**
 * Patient access: obtaining access by request, patient PIN or emergency
 * (break-glass) access, and what each option says before it is used.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: null,
    setActivePatient: vi.fn(() => true),
  }),
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

// What the emergency summary's route requires (contracts registry ehr.emergencyRecords).
const SUMMARY_READ = ['ehr.encounter.read', 'ehr.note.read']

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = ['identity.patient.read', 'identity.consent.write', 'identity.patient-access-pin.verify', 'identity.break-glass.write']
})

function renderPatients() {
  render(<MemoryRouter><Patients /></MemoryRouter>)
}

/** The access method control, whichever role it is given. */
function method(name: string) {
  return screen.getAllByRole('button').concat(screen.queryAllByRole('tab')).find(element => element.textContent === name)!
}

describe('the emergency option describes the summary it opens', () => {
  it('names every section the emergency summary can show, and that it shows no vitals or files', () => {
    renderPatients()
    fireEvent.click(method('Emergency'))
    const notice = screen.getByText(/Use emergency access only when/)
    expect(notice.textContent).not.toMatch(/completed encounters and signed notes only/)
    expect(notice.textContent).toMatch(/diagnoses, prescriptions, lab requests and documents/)
    expect(notice.textContent).toMatch(/no vital signs/)
  })
})

describe('emergency access is offered only to a role the backend will let use it', () => {
  // POST /identity/break-glass requires both (hid-system identity consent.controller.ts; contracts registry access.breakGlass).
  const submit = () => screen.getByRole('button', { name: 'Activate emergency access' }) as HTMLButtonElement
  const reason = () => document.getElementById(submit().getAttribute('aria-describedby') ?? '')?.textContent ?? ''

  it('is unavailable with identity.break-glass.write alone, and says it also needs identity.consent.write', () => {
    staff.permissions = ['identity.patient.read', 'identity.break-glass.write']
    renderPatients()
    fireEvent.click(method('Emergency'))
    expect(submit().disabled).toBe(true)
    expect(reason()).toMatch(/identity\.consent\.write/)
    expect(reason()).not.toMatch(/identity\.break-glass\.write/)
  })

  it('is unavailable with identity.consent.write alone, and says it needs identity.break-glass.write', () => {
    staff.permissions = ['identity.patient.read', 'identity.consent.write']
    renderPatients()
    fireEvent.click(method('Emergency'))
    expect(submit().disabled).toBe(true)
    expect(reason()).toMatch(/identity\.break-glass\.write/)
  })

  it('is available, with nothing to explain, when the role holds both and what the record it opens needs', () => {
    staff.permissions = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', ...SUMMARY_READ]
    renderPatients()
    fireEvent.click(method('Emergency'))
    expect(submit().disabled).toBe(false)
    expect(submit().getAttribute('aria-describedby')).toBeNull()
  })

  // Emergency access then looks the patient up (POST /identity/patient-lookup, identity.patient.read)
  // and opens the emergency summary (GET /ehr/patients/:id/emergency-records, ehr.encounter.read and
  // ehr.note.read). A role without them would create an audited grant, which may notify the
  // patient, and then be refused.
  it('is unavailable without identity.patient.read, which opens the record after the grant', () => {
    staff.permissions = ['identity.consent.write', 'identity.break-glass.write', ...SUMMARY_READ]
    renderPatients()
    fireEvent.click(method('Emergency'))
    expect(submit().disabled).toBe(true)
    expect(reason()).toMatch(/identity\.patient\.read/)
    expect(reason()).not.toMatch(/identity\.consent\.write|identity\.break-glass\.write|ehr\./)
    fireEvent.click(submit())
    expect(api.breakGlass).not.toHaveBeenCalled()
  })

  it('is unavailable without the emergency summary’s read permissions, and names them', () => {
    staff.permissions = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read']
    renderPatients()
    fireEvent.click(method('Emergency'))
    expect(submit().disabled).toBe(true)
    expect(reason()).toMatch(/ehr\.note\.read/)
    expect(reason()).toMatch(/emergency summary/)
    expect(reason()).not.toMatch(/ehr\.encounter\.read/)
  })

  it('offers the PIN only with identity.patient.read too, which opens the record once the PIN is verified', () => {
    staff.permissions = ['identity.consent.write', 'identity.patient-access-pin.verify']
    renderPatients()
    fireEvent.click(method('Patient PIN'))
    const pin = screen.getByRole('button', { name: 'Verify PIN and open' }) as HTMLButtonElement
    expect(pin.disabled).toBe(true)
    const why = document.getElementById(pin.getAttribute('aria-describedby') ?? '')?.textContent
    expect(why).toMatch(/identity\.patient\.read/)
    expect(why).not.toMatch(/identity\.patient-access-pin\.verify/)
    fireEvent.click(pin)
    expect(api.verifyPin).not.toHaveBeenCalled()
  })

  it('says why the PIN and request methods are unavailable too', () => {
    staff.permissions = ['identity.patient.read']
    renderPatients()
    const request = screen.getByRole('button', { name: 'Send access request' }) as HTMLButtonElement
    expect(request.disabled).toBe(true)
    expect(document.getElementById(request.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/identity\.consent\.write/)
    fireEvent.click(method('Patient PIN'))
    const pin = screen.getByRole('button', { name: 'Verify PIN and open' }) as HTMLButtonElement
    expect(pin.disabled).toBe(true)
    expect(document.getElementById(pin.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/identity\.patient-access-pin\.verify/)
  })
})

describe('the patient PIN', () => {
  // Identity removes every space from the PIN before checking it (hid-system
  // VerifyPatientAccessPinDto compactPin), so a PIN typed in groups is accepted.
  it('is sent without the spaces it was typed with', async () => {
    api.verifyPin.mockResolvedValue({})
    api.lookupPatient.mockResolvedValue({ patient: { patientId: 'a0000000-0000-4000-8000-000000000001', hid: 'HID-ABCDEF23', fullName: 'Ada Patient', version: 1 },
      authorization: { decision: 'allow', consentGrantId: null, breakGlass: false } })
    renderPatients()
    fireEvent.change(screen.getByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.click(method('Patient PIN'))
    const pin = screen.getByLabelText(/^Patient access PIN/)
    fireEvent.change(pin, { target: { value: '12 34' } })
    fireEvent.submit(pin.closest('form')!)
    await waitFor(() => expect(api.verifyPin).toHaveBeenCalledWith('facility-1', 'HID-ABCDEF23', '1234'))
    expect(pin.getAttribute('aria-invalid')).toBeNull()
  })

  // A field cut at 8 characters would send 1234 567 as 1234567, a wrong PIN, and each
  // failed verification counts towards Identity's lock (access_patient_with_pin).
  it('takes an 8 digit PIN typed in two groups whole', () => {
    renderPatients()
    fireEvent.click(method('Patient PIN'))
    const pin = screen.getByLabelText(/^Patient access PIN/) as HTMLInputElement
    expect(pin.maxLength).toBeGreaterThanOrEqual('1234 5678'.length)
    fireEvent.change(pin, { target: { value: '1234 5678' } })
    expect(pin.checkValidity()).toBe(true)
  })

  it('is still refused when it is not 4 to 8 digits once its spaces are removed', async () => {
    renderPatients()
    fireEvent.change(screen.getByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.click(method('Patient PIN'))
    const pin = screen.getByLabelText(/^Patient access PIN/)
    fireEvent.change(pin, { target: { value: '12 3' } })
    fireEvent.submit(pin.closest('form')!)
    await waitFor(() => expect(pin.getAttribute('aria-invalid')).toBe('true'))
    expect(api.verifyPin).not.toHaveBeenCalled()
  })
})
