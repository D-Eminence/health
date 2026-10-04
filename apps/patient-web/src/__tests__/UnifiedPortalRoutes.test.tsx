import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { App } from '../App'

const calls = vi.hoisted(() => ({
  patientSession: vi.fn(), patientRefresh: vi.fn(), patientEnrollmentCurrent: vi.fn(), patientGoogleOnboarding: vi.fn(),
  staffSession: vi.fn(), staffRefresh: vi.fn(), staffSelectFacility: vi.fn(), staffLogout: vi.fn(),
  staffLookupPatient: vi.fn(), staffBreakGlass: vi.fn(), staffEmergencyRecords: vi.fn(),
  staffEncounters: vi.fn(), staffRecords: vi.fn(), staffCreateRecord: vi.fn(),
  adminSession: vi.fn(), adminRefresh: vi.fn(),
}))

const localEnvironment = { name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }

vi.mock('../env', () => ({ getEnvironment: () => localEnvironment }))
vi.mock('../staff/env', () => ({ getEnvironment: () => localEnvironment }))
vi.mock('../admin/env', () => ({ environment: () => localEnvironment }))
vi.mock('../api', () => ({
  createPatientApi: () => ({ session: calls.patientSession, refresh: calls.patientRefresh,
    enrollmentCurrent: calls.patientEnrollmentCurrent, googleOnboarding: calls.patientGoogleOnboarding }),
}))
vi.mock('../staff/api', () => ({
  staffApi: { session: calls.staffSession, refresh: calls.staffRefresh,
    selectFacility: calls.staffSelectFacility, logout: calls.staffLogout,
    lookupPatient: calls.staffLookupPatient, breakGlass: calls.staffBreakGlass,
    emergencyRecords: calls.staffEmergencyRecords, encounters: calls.staffEncounters,
    records: calls.staffRecords, createRecord: calls.staffCreateRecord },
  isAllowedPatientLookup: (value: { authorization?: { decision?: string } }) => value.authorization?.decision === 'allow',
}))
vi.mock('../admin/api', () => ({
  adminApi: { session: calls.adminSession, refresh: calls.adminRefresh },
}))

function Path() {
  return <output data-testid="portal-path">{useLocation().pathname}</output>
}

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Path /><App /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  const signedOut = new HidApiError(401, 'Sign in required')
  calls.patientSession.mockRejectedValue(signedOut)
  calls.patientRefresh.mockRejectedValue(signedOut)
  calls.patientEnrollmentCurrent.mockRejectedValue(new HidApiError(404, 'No enrollment'))
  calls.patientGoogleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
  calls.staffSession.mockRejectedValue(signedOut)
  calls.staffRefresh.mockRejectedValue(signedOut)
  calls.staffLogout.mockResolvedValue(undefined)
  calls.staffLookupPatient.mockResolvedValue({
    authorization: { decision: 'allow' },
    patient: { patientId: 'patient-1', hid: 'HID-ABC234', fullName: 'A Patient' },
  })
  calls.staffEncounters.mockResolvedValue({ items: [{
    id: 'encounter-1', patientId: 'patient-1', facilityId: 'facility-1',
    encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-01-01T12:00:00.000Z',
    chiefComplaint: 'Consultation', rowVersion: 1,
  }], nextCursor: null })
  calls.staffRecords.mockResolvedValue({ items: [], nextCursor: null })
  calls.staffCreateRecord.mockResolvedValue({ id: 'request-1' })
  calls.staffBreakGlass.mockResolvedValue({ consentGrantId: 'grant-1', status: 'active' })
  calls.staffEmergencyRecords.mockResolvedValue({ encounters: [{
    id: 'encounter-1', encounterType: 'ambulatory', startedAt: '2026-01-01T12:00:00.000Z',
    endedAt: '2026-01-01T12:30:00.000Z',
  }], notes: [], limit: 50 })
  calls.adminSession.mockRejectedValue(signedOut)
  calls.adminRefresh.mockRejectedValue(signedOut)
})

describe('unified authenticated portal routes', () => {
  it('opens patient sign in at /sign-in without mounting a staff or admin session', async () => {
    open('/sign-in')

    expect(await screen.findByLabelText('Email or Health ID')).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/sign-in')
    await waitFor(() => expect(calls.patientSession).toHaveBeenCalledOnce())
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(calls.adminSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: /Work email/ })).toBeNull()
  })

  it('blocks a new enrollment while progress restoration is unavailable, then retries', async () => {
    calls.patientEnrollmentCurrent.mockRejectedValueOnce(new Error('Network unavailable'))
    open('/enroll')

    expect(await screen.findByText('We could not check for an enrollment in progress. Try again before starting.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('textbox', { name: 'National Identification Number' })).toBeTruthy()
    expect(calls.patientEnrollmentCurrent).toHaveBeenCalledTimes(2)
  })

  it('keeps a protected patient URL pending when the session check loses the network', async () => {
    calls.patientSession.mockRejectedValueOnce(new Error('Network unavailable'))
    open('/profile')

    expect(await screen.findByText('We could not check your session. Try again.')).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/profile')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/sign-in'))
    expect(calls.patientSession).toHaveBeenCalledTimes(2)
  })

  it('opens provider sign in directly under /provider', async () => {
    open('/provider/sign-in')

    expect(await screen.findByRole('textbox', { name: /Work email/ })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/sign-in')
    await waitFor(() => expect(calls.staffSession).toHaveBeenCalledOnce())
    expect(calls.patientSession).not.toHaveBeenCalled()
    expect(calls.adminSession).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Email or Health ID')).toBeNull()
  })

  it('opens provider password recovery without requiring an existing session', async () => {
    open('/provider/recover')

    expect(await screen.findByRole('heading', { name: 'Reset your password.' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/recover')
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(calls.patientSession).not.toHaveBeenCalled()
  })

  it('opens platform administration sign in directly under /admin', async () => {
    open('/admin/sign-in')

    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/admin/sign-in')
    await waitFor(() => expect(calls.adminSession).toHaveBeenCalledOnce())
    expect(calls.patientSession).not.toHaveBeenCalled()
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Email or Health ID')).toBeNull()
  })

  it('opens platform password recovery without requiring an existing session', async () => {
    open('/admin/recover')

    expect(await screen.findByRole('heading', { name: 'Reset your password.' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/admin/recover')
    expect(calls.adminSession).not.toHaveBeenCalled()
    expect(calls.patientSession).not.toHaveBeenCalled()
  })

  it('sends an unknown provider URL to provider sign in when signed out', async () => {
    open('/provider/unknown-workspace')

    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/provider/sign-in'))
    expect(screen.getByRole('textbox', { name: /Work email/ })).toBeTruthy()
    expect(calls.patientSession).not.toHaveBeenCalled()
  })

  it('keeps provider navigation inside /provider after a staff session is restored', async () => {
    const facility = {
      id: 'facility-1', membershipId: 'membership-1', organizationId: 'organization-1',
      name: 'Example Clinic', roles: ['clinician'], permissions: ['identity.patient.read'], isPrimary: true,
    }
    calls.staffSession.mockResolvedValue({ actor: {
      kind: 'staff', id: 'staff-1', displayName: 'Ada Clinician', roles: ['clinician'],
      permissions: facility.permissions, facilities: [facility], facility,
    } })
    open('/provider')

    const providerNavigation = await screen.findByRole('complementary', { name: 'Provider navigation' })
    fireEvent.click(within(providerNavigation).getByRole('link', { name: 'Patient access' }))

    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/provider/patients'))
    expect(screen.getByRole('heading', { name: 'Open a patient record.' })).toBeTruthy()
    expect(calls.patientSession).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Email or Health ID')).toBeNull()
  })

  it('keeps the provider session visible when server sign-out fails', async () => {
    const facility = {
      id: 'facility-1', membershipId: 'membership-1', organizationId: 'organization-1',
      name: 'Example Clinic', roles: ['clinician'], permissions: [], isPrimary: true,
    }
    calls.staffSession.mockResolvedValue({ actor: { kind: 'staff', id: 'staff-1',
      roles: ['clinician'], permissions: [], facilities: [facility], facility } })
    calls.staffLogout.mockRejectedValue(new Error('Could not reach the service.'))

    open('/provider')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the service.')
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider')
  })

  it('opens a governed chart and sends an active laboratory request through the EHR API', async () => {
    const facility = {
      id: 'facility-1', membershipId: 'membership-1', organizationId: 'organization-1',
      name: 'Example Clinic', roles: ['clinician'],
      permissions: ['identity.patient.read', 'ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write'],
      isPrimary: true,
    }
    calls.staffSession.mockResolvedValue({ actor: {
      kind: 'staff', id: 'staff-1', displayName: 'Ada Clinician', roles: ['clinician'],
      permissions: facility.permissions, facilities: [facility], facility,
    } })

    open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABC234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))

    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/provider/clinical'))
    expect(calls.staffLookupPatient).toHaveBeenCalledWith('facility-1', 'HID-ABC234', 'direct-care')
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Test code system' }), { target: { value: 'LOINC' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Test code' }), { target: { value: '718-7' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Test display' }), { target: { value: 'Hemoglobin' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Request handling' }), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))

    await waitFor(() => expect(calls.staffCreateRecord).toHaveBeenCalledOnce())
    expect(calls.staffCreateRecord).toHaveBeenCalledWith(
      'facility-1', 'patient-1', 'encounter-1', 'lab-requests',
      expect.objectContaining({ testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Hemoglobin', status: 'active' }),
      expect.any(String),
    )
    expect(await screen.findByText('Active lab request created and accepted by Lab.')).toBeTruthy()
  })

  it('uses only the read-only emergency summary after an audited break-glass grant', async () => {
    const facility = {
      id: 'facility-1', membershipId: 'membership-1', organizationId: 'organization-1',
      name: 'Example Clinic', roles: ['clinician'],
      permissions: ['identity.patient.read', 'identity.break-glass.write', 'ehr.encounter.read'],
      isPrimary: true,
    }
    calls.staffSession.mockResolvedValue({ actor: {
      kind: 'staff', id: 'staff-1', displayName: 'Ada Clinician', roles: ['clinician'],
      permissions: facility.permissions, facilities: [facility], facility,
    } })

    open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABC234' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Emergency' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Emergency reason' }), {
      target: { value: 'Patient cannot consent during emergency care' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Activate emergency access' }))

    expect(await screen.findByRole('heading', { name: 'Completed encounters' })).toBeTruthy()
    expect(calls.staffBreakGlass).toHaveBeenCalledWith('facility-1', 'HID-ABC234', 'Patient cannot consent during emergency care')
    expect(calls.staffLookupPatient).toHaveBeenCalledWith('facility-1', 'HID-ABC234', 'emergency')
    expect(calls.staffEmergencyRecords).toHaveBeenCalledWith('facility-1', 'patient-1')
    expect(calls.staffEncounters).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Start encounter' })).toBeNull()
  })
})
