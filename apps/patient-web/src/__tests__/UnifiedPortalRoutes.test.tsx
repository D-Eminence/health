import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { App } from '../App'
import { LEGACY_PATIENT_PATHS } from '../legacyPaths'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

const calls = vi.hoisted(() => ({
  patientSession: vi.fn(), patientRefresh: vi.fn(), patientEnrollmentCurrent: vi.fn(), patientGoogleOnboarding: vi.fn(), patientProfile: vi.fn(),
  patientEnrollmentAvailability: vi.fn(), patientParticipatingFacilities: vi.fn(),
  staffSession: vi.fn(), staffRefresh: vi.fn(), staffSelectFacility: vi.fn(), staffLogout: vi.fn(),
  staffLookupPatient: vi.fn(), staffBreakGlass: vi.fn(), staffEmergencyRecords: vi.fn(),
  staffEncounters: vi.fn(), staffRecords: vi.fn(), staffCreateRecord: vi.fn(), staffConsentStatus: vi.fn(),
  adminSession: vi.fn(), adminRefresh: vi.fn(),
}))

const localEnvironment = { name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }

vi.mock('../env', () => ({ getEnvironment: () => localEnvironment }))
vi.mock('../staff/env', () => ({ getEnvironment: () => localEnvironment }))
vi.mock('../admin/env', () => ({ environment: () => localEnvironment }))
vi.mock('../api', () => ({
  createPatientApi: () => ({ session: calls.patientSession, refresh: calls.patientRefresh,
    enrollmentCurrent: calls.patientEnrollmentCurrent, googleOnboarding: calls.patientGoogleOnboarding, profile: calls.patientProfile,
    enrollmentAvailability: calls.patientEnrollmentAvailability, participatingFacilities: calls.patientParticipatingFacilities,
    // The portal's bell listens for answered requests (notificationBadge.tsx).
    onSessionAccepted: () => () => undefined,
    // The overview's other cards (hid-1.0 parity B3): not served here, as a backend without them answers.
    ...Object.fromEntries(['records', 'accessHistory', 'accessRequests', 'notifications', 'accessLog', 'profileDetails', 'healthProfile',
      'emergencyContactsAvailability', 'emergencyContacts', 'photo',
      // Sharing's probe (hid-1.0 parity B4, hid-system 0095): not served here either.
      'shareInvitations'].map(name => [name, () => Promise.reject(new HidApiError(404, 'Not served'))])) }),
}))
vi.mock('../staff/api', () => ({
  staffApi: { session: calls.staffSession, refresh: calls.staffRefresh,
    selectFacility: calls.staffSelectFacility, logout: calls.staffLogout,
    lookupPatient: calls.staffLookupPatient, breakGlass: calls.staffBreakGlass,
    emergencyRecords: calls.staffEmergencyRecords, encounters: calls.staffEncounters,
    records: calls.staffRecords, createRecord: calls.staffCreateRecord, consentStatus: calls.staffConsentStatus },
  isAllowedPatientLookup: (value: { authorization?: { decision?: string } }) => value.authorization?.decision === 'allow',
}))
const clinician = vi.hoisted(() => ({ availability: vi.fn(), current: vi.fn() }))
vi.mock('../staff/clinicianApplicationApi', () => ({
  clinicianApplicationApi: clinician,
  newClinicianIdempotencyKey: () => 'key-1',
  CLINICIAN_REGULATOR_OF: { doctor: 'MDCN', nurse: 'NMCN' },
}))
vi.mock('../admin/api', () => ({
  adminApi: { session: calls.adminSession, refresh: calls.adminRefresh },
  adminSessionAccount: () => null, setAdminSessionAccount: () => undefined, closeAdminSession: () => undefined,
}))

function Path() {
  const { pathname, search } = useLocation()
  return <><output data-testid="portal-path">{pathname}</output><output data-testid="portal-search">{search}</output></>
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
  calls.patientEnrollmentAvailability.mockResolvedValue({ open: true })
  // Provider sign-in asks whether clinician self sign-up is open (hid-system ADR-066).
  clinician.availability.mockResolvedValue({ open: false })
  calls.patientParticipatingFacilities.mockResolvedValue({ facilities: [], whatToBring: ['Your own phone with this registration open'] })
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
  // A read-and-write grant (POST /identity/consent-status), so the chart offers changes.
  calls.staffConsentStatus.mockResolvedValue({ patientId: 'patient-1', facilityId: 'facility-1', purpose: 'direct-care',
    readAllowed: true, writeAllowed: true })
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

    expect(await screen.findByLabelText('Email, phone or Health ID')).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/sign-in')
    await waitFor(() => expect(calls.patientSession).toHaveBeenCalledOnce())
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(calls.adminSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: /Work email/ })).toBeNull()
  })

  it('opens the public list of participating facilities at /enroll/facilities without a sign-in', async () => {
    open('/enroll/facilities')

    expect(await screen.findByRole('heading', { level: 1, name: 'Register at a healthcare facility' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'What to bring' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/enroll/facilities')
    expect(calls.patientParticipatingFacilities).toHaveBeenCalledOnce()
    expect(calls.patientEnrollmentCurrent).not.toHaveBeenCalled()
    expect(calls.staffSession).not.toHaveBeenCalled()
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

  it('moves focus to the NIN field once Try again finds no enrollment, and to Try again when the check fails again', async () => {
    calls.patientEnrollmentCurrent.mockRejectedValueOnce(new Error('Network unavailable')).mockRejectedValueOnce(new Error('Network unavailable'))
    open('/enroll')

    const first = await screen.findByRole('button', { name: 'Try again' })
    first.focus()
    await act(async () => { fireEvent.click(first) })
    const second = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(document.activeElement).toBe(second))
    await act(async () => { fireEvent.click(second) })

    const nin = await screen.findByRole('textbox', { name: 'National Identification Number' })
    await waitFor(() => expect(document.activeElement).toBe(nin))
  })

  it('keeps a protected patient URL pending when the session check loses the network', async () => {
    calls.patientSession.mockRejectedValueOnce(new Error('Network unavailable'))
    open('/profile')

    expect(await screen.findByRole('heading', { level: 1, name: 'We could not check your session' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/profile')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/sign-in'))
    expect(calls.patientSession).toHaveBeenCalledTimes(2)
  })

  it('sends a protected patient URL to sign-in, saying so, when the browser holds a provider\'s sign-in', async () => {
    // hid-system's staff actor carries no `kind` (auth.controller.ts session; current-staff-context.service.ts).
    calls.patientSession.mockResolvedValue({ actor: { id: 'staff-1', subject: 'staff-1', accountId: 'account-1',
      roles: ['clinician'], permissions: [], facilities: [] } })
    open('/profile')

    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/sign-in'))
    expect(await screen.findByText('A provider sign-in is active in this browser. Signing in here as a patient replaces it.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the provider portal' }).getAttribute('href')).toBe('/provider')
    expect(screen.queryByText(/could not check your session/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls.patientSession).toHaveBeenCalledOnce()
    expect(calls.staffSession).not.toHaveBeenCalled()
  })

  it('asks for the provider portal\'s sign-out, with no retry loop, when enrollment is refused for a provider\'s sign-in', async () => {
    calls.patientSession.mockResolvedValue({ actor: { id: 'staff-1', subject: 'staff-1', accountId: 'account-1', roles: [], permissions: [] } })
    calls.patientEnrollmentCurrent.mockRejectedValue(new HidApiError(409, 'Sign out before starting or continuing a new Health ID enrollment',
      { code: 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT' }))
    open('/enroll')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('A provider sign-in is active in this browser. Sign out of the provider portal before starting a new Health ID.')
    // The alert is the message: the note's link and button are not inside it.
    expect(within(alert).queryAllByRole('link')).toEqual([])
    expect(screen.getByRole('link', { name: 'Go to the provider portal' }).getAttribute('href')).toBe('/provider')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.queryByText(/could not check for an enrollment/)).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
  })

  it('checks again once the provider portal was signed out elsewhere, as the note asks, and opens the NIN step', async () => {
    calls.patientSession.mockResolvedValueOnce({ actor: { id: 'staff-1', subject: 'staff-1', accountId: 'account-1', roles: [], permissions: [] } })
    calls.patientEnrollmentCurrent.mockRejectedValueOnce(new HidApiError(409, 'Sign out before starting or continuing a new Health ID enrollment',
      { code: 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT' }))
    open('/enroll')
    expect((await screen.findByRole('alert')).textContent).toContain('A provider sign-in is active in this browser.')

    // The provider signs out in another tab; the next checks find no sign-in and no enrollment.
    const check = screen.getByRole('button', { name: 'Check again' })
    check.focus()
    await act(async () => { fireEvent.click(check) })

    const nin = await screen.findByRole('textbox', { name: 'National Identification Number' })
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect(screen.queryByText(/Sign out of the provider portal/)).toBeNull()
    expect(calls.patientEnrollmentCurrent).toHaveBeenCalledTimes(2)
    expect(calls.patientSession).toHaveBeenCalledTimes(2)
  })

  it('keeps the sign-out note, with focus on it, when checking again finds the sign-in still there', async () => {
    calls.patientEnrollmentCurrent.mockRejectedValue(new HidApiError(409, 'Sign out before starting or continuing a new Health ID enrollment',
      { code: 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT' }))
    open('/enroll')
    const check = await screen.findByRole('button', { name: 'Check again' })
    check.focus()
    await act(async () => { fireEvent.click(check) })

    await waitFor(() => expect(calls.patientEnrollmentCurrent).toHaveBeenCalledTimes(2))
    // Focus moves to the note, which is read there once: it is not also an alert.
    const note = await screen.findByRole('group', { name: /This browser is still signed in to Health ID\./ })
    await waitFor(() => expect(document.activeElement).toBe(note))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
  })

  it('opens the patient portal, where the patient can sign out, once checking again finds the patient signed in elsewhere', async () => {
    calls.patientEnrollmentCurrent.mockRejectedValue(new HidApiError(409, 'Sign out before starting or continuing a new Health ID enrollment',
      { code: 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT' }))
    calls.patientProfile.mockResolvedValue({ hid: 'HID-ABC234', fullName: 'Ada Example' })
    open('/enroll')
    const check = await screen.findByRole('button', { name: 'Check again' })

    // The patient signed in from another tab after this one opened.
    calls.patientSession.mockResolvedValue({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' } })
    await act(async () => { fireEvent.click(check) })
    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/'))
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('asks for a sign-out, with no retry loop, when enrollment is refused for a sign-in the browser holds', async () => {
    calls.patientEnrollmentCurrent.mockRejectedValue(new HidApiError(409, 'Sign out before starting or continuing a new Health ID enrollment',
      { code: 'GOOGLE_ONBOARDING_REQUIRES_SIGN_OUT' }))
    open('/enroll')

    expect((await screen.findByRole('alert')).textContent)
      .toBe('This browser is still signed in to Health ID. Sign out of the patient or provider portal before starting a new Health ID.')
    expect(screen.getByText('If a patient is signed in, Check again opens the patient portal, where you can sign out.')).toBeTruthy()
    // A link to the portal would only reach sign-in: this tab has no patient session to open it with.
    expect(screen.queryByRole('link', { name: 'Go to the patient portal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
  })

  it('opens provider sign in directly under /provider', async () => {
    open('/provider/sign-in')

    expect(await screen.findByRole('textbox', { name: /Work email/ }, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/sign-in')
    await waitFor(() => expect(calls.staffSession).toHaveBeenCalledOnce())
    expect(calls.patientSession).not.toHaveBeenCalled()
    expect(calls.adminSession).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Email, phone or Health ID')).toBeNull()
  })

  it('opens provider password recovery without requiring an existing session', async () => {
    open('/provider/recover')

    expect(await screen.findByRole('heading', { name: 'Reset your password.' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/recover')
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(calls.patientSession).not.toHaveBeenCalled()
  })

  it('opens clinician sign-up outside the provider workspace, without a staff session', async () => {
    clinician.availability.mockResolvedValue({ open: true })
    open('/provider/join')
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply as a doctor or nurse' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeTruthy()
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(calls.staffRefresh).not.toHaveBeenCalled()
    expect(calls.patientSession).not.toHaveBeenCalled()
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/join')
  })

  it('opens the clinician application status page outside the provider workspace, without a staff session', async () => {
    clinician.current.mockRejectedValue(new HidApiError(401, 'Verify your email address again',
      { code: 'CLINICIAN_APPLICATION_SESSION_INVALID' }))
    open('/provider/join/status')
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your clinician application' })).toBeTruthy()
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(calls.staffRefresh).not.toHaveBeenCalled()
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/join/status')
  })

  it('opens platform administration sign in directly under /admin', async () => {
    open('/admin/sign-in')

    // The platform workspace is imported on first use, which can take over a second under a full run.
    expect(await screen.findByRole('heading', { name: 'Administration sign in' }, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/admin/sign-in')
    await waitFor(() => expect(calls.adminSession).toHaveBeenCalledOnce())
    expect(calls.patientSession).not.toHaveBeenCalled()
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Email, phone or Health ID')).toBeNull()
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
    expect(screen.queryByLabelText('Email, phone or Health ID')).toBeNull()
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
      // Lab accepts an order only from an actor holding lab.work-item.accept (lab-work-items.service.ts).
      permissions: ['identity.patient.read', 'ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write', 'lab.work-item.accept'],
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

  it('keeps an active laboratory request Lab refused as saved, without creating it again or naming its ID', async () => {
    const facility = {
      id: 'facility-1', membershipId: 'membership-1', organizationId: 'organization-1',
      name: 'Example Clinic', roles: ['clinician'],
      // A role that may accept Lab orders, which Lab's row-level security refuses for this patient
      // (403 LAB_ACCESS_DENIED, lab-work-items.service.ts); a role without lab.work-item.accept is
      // not offered an active request at all.
      permissions: ['identity.patient.read', 'ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write', 'lab.work-item.accept'],
      isPrimary: true,
    }
    calls.staffSession.mockResolvedValue({ actor: {
      kind: 'staff', id: 'staff-1', displayName: 'Ada Clinician', roles: ['clinician'],
      permissions: facility.permissions, facilities: [facility], facility,
    } })
    // hid-system #56: the request is committed and active; Lab refused it.
    calls.staffCreateRecord.mockRejectedValue(new HidApiError(409,
      'Lab request 0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a is saved and active in the EHR, but Lab refused it (LAB_ACCESS_DENIED); send it to Lab again once that is resolved',
      { code: 'LAB_HANDOFF_REFUSED' }))

    open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABC234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Test code system' }), { target: { value: 'LOINC' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Test code' }), { target: { value: '718-7' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Test display' }), { target: { value: 'Hemoglobin' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Request handling' }), { target: { value: 'active' } })
    const readsBefore = calls.staffRecords.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))

    expect((await screen.findByText(/^Lab request saved and active in the EHR/)).textContent).toMatch(/Lab refused it \(LAB_ACCESS_DENIED\)/)
    expect(calls.staffRecords.mock.calls.length).toBeGreaterThan(readsBefore)
    expect((screen.getByRole('textbox', { name: 'Test display' }) as HTMLInputElement).value).toBe('')
    expect(document.body.textContent).not.toMatch(/0f2b6d0e/)
    expect(screen.queryByText(/accepted by Lab/)).toBeNull()
    expect(calls.staffCreateRecord).toHaveBeenCalledOnce()
  })

  it('uses only the read-only emergency summary after an audited break-glass grant', async () => {
    const facility = {
      id: 'facility-1', membershipId: 'membership-1', organizationId: 'organization-1',
      name: 'Example Clinic', roles: ['clinician'],
      // POST /identity/break-glass requires identity.consent.write as well as identity.break-glass.write;
      // the emergency summary it opens, ehr.encounter.read and ehr.note.read.
      permissions: ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'ehr.note.read'],
      isPrimary: true,
    }
    calls.staffSession.mockResolvedValue({ actor: {
      kind: 'staff', id: 'staff-1', displayName: 'Ada Clinician', roles: ['clinician'],
      permissions: facility.permissions, facilities: [facility], facility,
    } })

    open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABC234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Emergency' }))
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

/** A facility's staff invitation (Novu, P4b): a public page beside provider enrollment, outside the workspace. */
describe('the staff invitation page', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('opens at /provider/invitation on a novu-v1 build without any session', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    open('/provider/invitation')

    expect(await screen.findByRole('heading', { level: 1, name: 'Join your facility.' }, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Enter your invitation code' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/invitation')
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(calls.staffRefresh).not.toHaveBeenCalled()
    expect(calls.patientSession).not.toHaveBeenCalled()
    expect(calls.adminSession).not.toHaveBeenCalled()
  })

  it('is no page on a main-v1 build: the address is the provider workspace’s, which asks for a sign-in', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    open('/provider/invitation')

    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/provider/sign-in'), { timeout: 5000 })
    expect(screen.queryByRole('heading', { name: 'Join your facility.' })).toBeNull()
    expect(calls.staffSession).toHaveBeenCalled()
  })
})

/**
 * hid-1.0's patient addresses (its src/App.tsx 259-273): bookmarks and links open the page that replaces each. The
 * session is still being checked, so each stays at its page rather than going on to sign-in.
 */
describe("hid-1.0's old patient addresses", () => {
  beforeEach(() => { calls.patientSession.mockReturnValue(new Promise(() => {})) })

  it.each(Object.entries(LEGACY_PATIENT_PATHS))('%s opens %s', async (from, to) => {
    open(from)
    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe(to))
  })

  it('takes them in any case and with a trailing slash, and keeps nothing of the old address', async () => {
    open('/Patient/Records/?tab=history&id=7')
    await waitFor(() => expect(screen.getByTestId('portal-path').textContent).toBe('/records'))
    expect(screen.getByTestId('portal-search').textContent).toBe('')
  })

  it('leaves the portal\'s own pages and other unknown addresses as they were', async () => {
    open('/patient/settings')
    expect(await screen.findByRole('heading', { name: 'Checking your session…' })).toBeTruthy()
    expect(screen.getByTestId('portal-path').textContent).toBe('/patient/settings')
  })
})
