import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Patients } from '../Patients'

vi.mock('../../api', () => ({
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
  isAllowedPatientLookup: () => false,
  staffApi: { lookupPatient: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn(),
    listAccessRequests: vi.fn() },
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'ehr.note.read'],
    } } } },
    activePatient: null, setActivePatient: vi.fn(), lock: null,
  }),
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

afterEach(() => { vi.unstubAllEnvs() })

const BEFORE = 'Use emergency access only when the patient cannot consent and care cannot wait. The action is time limited and audited.'
const AFTER = ' It opens a read-only summary from this facility: completed encounters and signed notes, and the diagnoses, '
  + 'prescriptions, lab requests and documents your role may read. It shows no vital signs and opens no files.'
// hid-system #109's alert (notification-api emergencyContactAlertContent) names the staff member on the grant, the
// facility and the time, and never the typed reason or any medical detail; only verified contacts with
// 'Notify this contact' ticked get it, and only while delivery is on.
const CONTACTS_TOLD = ' While emergency-contact alerts are on, each verified emergency contact the patient has chosen to notify '
  + 'is told that the patient’s record was opened for emergency care, with your name, this facility and the time, but never '
  + 'the reason you type or any medical details.'

function emergencyNotice(): string {
  render(<MemoryRouter><Patients /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
  const notice = document.querySelector('.staff-notice.staff-danger')
  expect(notice).not.toBeNull()
  return notice!.textContent ?? ''
}

describe('the break-glass notice (owner decision O12)', () => {
  it('on Novu, says verified emergency contacts are told, with the staff member’s name, and never the reason', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    expect(emergencyNotice()).toBe(BEFORE + CONTACTS_TOLD + AFTER)
  })

  it('on main, keeps its wording: main’s alert names no staff member', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const notice = emergencyNotice()
    expect(notice).toBe(BEFORE + AFTER)
    expect(notice).not.toMatch(/emergency contact|your name/i)
  })

  it('shows the sentence only with the emergency method', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    render(<MemoryRouter><Patients /></MemoryRouter>)
    expect(document.body.textContent).not.toMatch(/emergency-contact alerts/)
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
    expect(document.body.textContent).toMatch(/emergency-contact alerts are on/)
  })
})
