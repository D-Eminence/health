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

  it('is available, with nothing to explain, when the role holds both', () => {
    staff.permissions = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write']
    renderPatients()
    fireEvent.click(method('Emergency'))
    expect(submit().disabled).toBe(false)
    expect(submit().getAttribute('aria-describedby')).toBeNull()
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
