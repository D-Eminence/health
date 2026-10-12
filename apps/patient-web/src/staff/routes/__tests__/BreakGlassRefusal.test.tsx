import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => { vi.clearAllMocks() })

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
    expect(said.textContent).toMatch(/Emergency access is not enabled for this deployment/)
    expect(said.textContent).not.toMatch(/integrity validation/)
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('shows any other refusal as it is', async () => {
    api.breakGlass.mockRejectedValue(new HidApiError(403, 'Break-glass access is not authorized', { code: 'CONSENT_COMMAND_DENIED' }))
    await activateEmergencyAccess()
    expect((await screen.findByRole('alert')).textContent).toBe('Break-glass access is not authorized')
  })
})
