import { fireEvent, render, screen } from '@testing-library/react'
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
