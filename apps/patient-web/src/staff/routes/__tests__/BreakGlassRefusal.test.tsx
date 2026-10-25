import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Patients } from '../Patients'

const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn(),
  listAccessRequests: vi.fn() }))

vi.mock('../../api', () => ({
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
const DOCTOR = { id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
  permissions: ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'ehr.note.read'] }
const working = vi.hoisted(() => ({ facility: null as Record<string, unknown> | null }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: working.facility } } },
    activePatient: null, setActivePatient: vi.fn(), lock: null,
  }),
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

beforeEach(() => { vi.clearAllMocks(); working.facility = DOCTOR })
afterEach(() => { vi.unstubAllEnvs() })

async function activateEmergencyAccess() {
  render(<MemoryRouter><Patients /></MemoryRouter>)
  fireEvent.change(screen.getByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
  fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Emergency reason' }), { target: { value: 'Patient cannot consent during emergency care' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate emergency access' })) })
}

/**
 * hid-system #58 (ehr-api migration 0082) seeds only the direct-care purpose of
 * use, so until operators seed `emergency` Identity refuses break-glass with
 * 400 INVALID_CONSENT_COMMAND, "The consent command failed integrity
 * validation" (identity consent.service.ts), which says nothing a clinician can
 * act on.
 */
describe('emergency access refused by a deployment without the emergency purpose', () => {
  it('says emergency access may not be enabled here, and who can enable it', async () => {
    api.breakGlass.mockRejectedValue(new HidApiError(400, 'The consent command failed integrity validation', { code: 'INVALID_CONSENT_COMMAND' }))
    await activateEmergencyAccess()
    const said = await screen.findByRole('alert')
    // Identity answers this for any SQLSTATE 22023 activate_break_glass raises (a bad duration or
    // reason too, migration 0031), so a missing emergency purpose is likely, not certain.
    expect(said.textContent).toMatch(/Emergency access may not be enabled for this deployment/)
    expect(said.textContent).not.toMatch(/is not enabled/)
    expect(said.textContent).not.toMatch(/integrity validation/)
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('says emergency access is switched off when Identity answers 423 BREAK_GLASS_DISABLED (hid-system #111)', async () => {
    api.breakGlass.mockRejectedValue(new HidApiError(423, 'Emergency access is currently disabled by the platform administrator',
      { code: 'BREAK_GLASS_DISABLED' }))
    await activateEmergencyAccess()
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Emergency access is switched off for Health ID right now, so the record was not opened. Ask your Health ID administrator.')
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('shows any other refusal as it is', async () => {
    api.breakGlass.mockRejectedValue(new HidApiError(403, 'Break-glass access is not authorized', { code: 'CONSENT_COMMAND_DENIED' }))
    await activateEmergencyAccess()
    expect((await screen.findByRole('alert')).textContent).toBe('Break-glass access is not authorized')
  })
})

/**
 * Novu since P4b: in its first 30 days after Health ID support's check, a facility that signed itself up may activate
 * emergency access 5 times a day, until support ends the limit (Identity answers 429 EMERGENCY_PROBATION_LIMITED).
 */
describe('emergency access limited at a new self-signed-up facility', () => {
  it('names the facility, the limit, and who lifts it', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    working.facility = { ...DOCTOR, name: 'Ikeja Care', selfService: { review: 'reviewed', organizationType: 'clinic' } }
    api.breakGlass.mockRejectedValue(new HidApiError(429, 'Too many emergency activations', { code: 'EMERGENCY_PROBATION_LIMITED' }))
    await activateEmergencyAccess()
    expect((await screen.findByRole('alert')).textContent).toBe('Ikeja Care is new to Health ID: emergency access is limited to '
      + '5 times a day in its first 30 days. Contact Health ID support to lift the limit.')
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })
})

/** Who to ask for a permission the role lacks: at a self-signed-up facility (Novu, P4b), its administrator is the one asked. */
describe('a role that cannot reach patients', () => {
  const ADMIN = ['workforce.manage', 'audit.read', 'outreach.registration.read', 'outreach.registration.write',
    'outreach.campaign.read', 'outreach.campaign.write']
  const reason = () => document.getElementById('access-method-unavailable')?.textContent ?? ''

  it.each([
    ['novu-v1', 'pending', 'You are this facility’s administrator. Health ID support gives your own role clinical access when it '
      + 'checks your facility: add your licence on the Staff page.'],
    ['novu-v1', 'reviewed', 'You are this facility’s administrator. Health ID support gives your own role clinical access; ask '
      + 'them, or invite a colleague who holds this role.'],
    ['novu-v1', null, 'Ask your organization administrator.'],
    ['main-v1', 'pending', 'Ask your organization administrator.'],
  ])('on a %s build, at a facility whose review is %s, ends: %s', (contract, review, ending) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    working.facility = { ...DOCTOR, name: 'Ikeja Care', roles: ['org_admin'], permissions: ADMIN,
      ...(review ? { selfService: { review, organizationType: 'hospital' } } : {}) }
    render(<MemoryRouter><Patients /></MemoryRouter>)
    expect(reason()).toMatch(/^Your role at this facility cannot /)
    expect(reason().endsWith(ending)).toBe(true)
  })

  it('asks the organization administrator when a member without workforce.manage lacks a permission', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    working.facility = { ...DOCTOR, roles: ['receptionist'], permissions: ['outreach.registration.read'],
      selfService: { review: 'reviewed', organizationType: 'hospital' } }
    render(<MemoryRouter><Patients /></MemoryRouter>)
    expect(reason().endsWith('Ask your organization administrator.')).toBe(true)
  })
})
