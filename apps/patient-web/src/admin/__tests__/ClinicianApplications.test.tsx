import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { ClinicianApplicationPage, ClinicianApplicationsPage } from '../ClinicianApplications'
import type { AdminActor, ClinicianApplicationDetail, ClinicianApplicationSummary } from '../api'
import { StepUpProvider } from '../StepUp'

/**
 * The clinician verification queue (hid-system ADR-064, branch
 * claude/clinician-self-signup at fa58e2b): A1 list, A2 detail, A3 step 1,
 * A4 step 2 by a different Super Admin, A5 reject. The network is stubbed at
 * adminApi; the contract is the backend's ClinicianApplicationAdminService and
 * identity.admin_get_clinician_application (C18).
 */
const mocks = vi.hoisted(() => ({
  api: { clinicianApplications: vi.fn(), clinicianApplication: vi.fn(), attestClinicianApplication: vi.fn(),
    approveClinicianApplication: vi.fn(), rejectClinicianApplication: vi.fn(), stepUp: vi.fn() },
  keys: 0,
}))
vi.mock('../api', () => ({ adminApi: mocks.api, newIdempotencyKey: () => `key-${++mocks.keys}` }))
const api = mocks.api

const ID = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const OTHER_ID = '1a3c5e7f-2b4d-4c6e-8f1a-3b5c7d9e1f2a'
const THIRD_ID = '2b4d6f8a-3c5e-4d7f-9a2b-4c6d8e0f2a3b'

const actor: AdminActor = { accountId: 'admin-b', subject: 'staff:b', displayName: 'Bola Admin', email: 'b@example.test',
  platformRoles: ['platform_super_admin'], platformPermissions: ['platform.admin.access', 'platform.workforce.manage'] }

const problem = (status: number, code: string, requestId?: string) =>
  new HidApiError(status, 'Backend detail', { code, ...(requestId ? { requestId } : {}) })

function summary(overrides: Partial<ClinicianApplicationSummary> = {}): ClinicianApplicationSummary {
  return { applicationId: ID, state: 'submitted', version: 3, submittedAt: '2026-10-10T09:00:00.000Z',
    expiresAt: '2026-11-09T09:00:00.000Z',
    applicant: { accountId: 'account-c', fullName: 'Chiamaka Obi', email: 'chiamaka@example.test' },
    profession: 'doctor', regulator: { code: 'MDCN', name: 'Medical and Dental Council of Nigeria' },
    licenceNumber: 'MDCN/R/12345', licenceValidUntil: '2027-03-31',
    facility: { id: 'facility-1', name: 'Lekki Family Clinic', organizationName: 'Lekki Health Ltd' },
    authenticatorReady: true, step1: null, ...overrides }
}

function detail(overrides: Partial<ClinicianApplicationDetail> = {}): ClinicianApplicationDetail {
  const { facility: _facility, step1: _step1, ...base } = summary()
  return { ...base,
    account: { status: 'active', createdAt: '2026-10-10T08:50:00.000Z', emailVerifiedAt: '2026-10-10T08:52:00.000Z',
      patientAccount: false, identityRejection: false },
    staff: { id: 'staff-1', verificationStatus: 'pending', version: 1 },
    authenticator: { enrolled: true, factorId: 'factor-1', activatedAt: '2026-10-10T09:05:00.000Z', enrolledAfterRecovery: false },
    otherMemberships: [],
    facility: { id: 'facility-1', name: 'Lekki Family Clinic', organizationName: 'Lekki Health Ltd', lifecycleStatus: 'verified',
      active: true, cacHint: 'RC****89', orgAdmins: [{ displayName: 'Tunde Bello', email: 'tunde@lekki.example.test' }] },
    attestation: null, approval: null, decision: null, accessState: null,
    rolePermissions: ['ehr.note.read', 'ehr.note.write', 'ehr.prescription.write', 'identity.break-glass.write',
      'identity.registration.write'],
    flags: { sameLicenceKeyOtherAccounts: 0, sameLicenceKeyOtherOpenApplications: 0, sameLicenceAttestedElsewhere: false,
      orgAdminNameMatch: false, orgAdminEmailDomainMatch: false },
    callerHints: { attest: { allowed: true, reason: null }, approve: { allowed: false, reason: 'STATE' },
      reject: { allowed: true, reason: null } },
    ...overrides }
}

/** Step 1 recorded by `reviewer`; step 2 open to the caller unless the hint says otherwise. */
function underReview(reviewer = 'admin-a', overrides: Partial<ClinicianApplicationDetail> = {}) {
  return detail({ state: 'under_review', version: 4,
    attestation: { id: 'attestation-1', reviewerAccountId: reviewer, reviewerName: reviewer === 'admin-b' ? 'Bola Admin' : 'Ade Admin',
      validUntil: '2027-03-31T22:59:59.000Z', evidenceReference: 'Ticket HID-VER-1234',
      reason: 'Licence on the register; video call with passport', recordedAt: '2026-10-14T10:00:00.000Z',
      checklist: { registerChecked: true, licenceCurrentUntilRecorded: true, identityMethod: 'video_call_photo_id',
        identityConfirmed: true, employmentChannel: 'facility_public_phone', employmentConfirmed: true },
      factorConfirmedAt: '2026-10-14T09:59:30.000Z' },
    callerHints: { attest: { allowed: false, reason: 'STATE' },
      approve: reviewer === 'admin-b' ? { allowed: false, reason: 'STEP1_BY_YOU' } : { allowed: true, reason: null },
      reject: { allowed: true, reason: null } },
    ...overrides })
}

function Location() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function openAt(path: string, who: AdminActor = actor) {
  render(<MemoryRouter initialEntries={[path]}><StepUpProvider><Routes>
    <Route path="/admin/clinicians" element={<ClinicianApplicationsPage actor={who} />} />
    <Route path="/admin/clinicians/:applicationId" element={<ClinicianApplicationPage actor={who} />} />
    <Route path="/admin/principals" element={<h1>Users and roles</h1>} />
  </Routes><Location /></StepUpProvider></MemoryRouter>)
}

const openDetail = async (value: ClinicianApplicationDetail, who: AdminActor = actor) => {
  api.clinicianApplication.mockResolvedValueOnce(value)
  openAt(`/admin/clinicians/${value.applicationId}`, who)
  return screen.findByRole('heading', { level: 1, name: value.applicant.fullName })
}

const type = (name: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } })

/** Every part of the step-1 checklist, as the reviewer completes it after the call. */
function completeStepOne(code = '123456') {
  fireEvent.click(screen.getByLabelText('I checked the licence on the Medical and Dental Council of Nigeria (MDCN) register and it is current'))
  fireEvent.click(screen.getByLabelText('The register shows it valid at least until the date below'))
  fireEvent.click(screen.getByLabelText('Video call with photo ID'))
  fireEvent.click(screen.getByLabelText('The photo ID matches the name on the licence and the person I spoke to'))
  type('Applicant’s authenticator code', code)
  fireEvent.click(screen.getByLabelText(/^Facility phone number from a public record/))
  fireEvent.click(screen.getByLabelText('The facility confirmed the applicant works there'))
  type('Evidence reference', 'Ticket HID-VER-1234')
  type('Reason', 'Licence on the register; video call with passport')
}

const CHECKLIST = { registerChecked: true, licenceCurrentUntilRecorded: true, identityMethod: 'video_call_photo_id',
  identityConfirmed: true, employmentChannel: 'facility_public_phone', employmentConfirmed: true }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.keys = 0
  // Only Date is faked: "today" in Lagos is 15 October 2026; timers stay real for the queries.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T10:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

describe('clinician verification queue (A1)', () => {
  it('lists open applications oldest first with what each step needs, and says who did step 1', async () => {
    api.clinicianApplications.mockResolvedValueOnce({ nextCursor: null, items: [
      summary(),
      summary({ applicationId: OTHER_ID, state: 'under_review', version: 4, profession: 'nurse',
        applicant: { accountId: 'account-d', fullName: 'Dayo Musa', email: 'dayo@example.test' },
        regulator: { code: 'NMCN', name: 'Nursing and Midwifery Council of Nigeria' },
        step1: { by: { accountId: 'admin-b', displayName: 'Bola Admin' }, at: '2026-10-14T10:00:00.000Z' } }),
      summary({ applicationId: THIRD_ID, state: 'awaiting_authenticator', authenticatorReady: false,
        applicant: { accountId: 'account-e', fullName: 'Efe Okoro', email: 'efe@example.test' } }),
    ] })
    openAt('/admin/clinicians')

    expect(await screen.findByText('Showing 3 applications, oldest first')).toBeTruthy()
    expect(api.clinicianApplications).toHaveBeenCalledWith('open', {}, expect.any(AbortSignal))
    expect(screen.getByRole('heading', { level: 1, name: 'Clinician applications' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Under review' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(/Each step is checked again by the server, needs your authenticator confirmation and is recorded in the audit log/)).toBeTruthy()

    const [first, second, third] = screen.getAllByRole('article')
    for (const text of ['chiamaka@example.test', 'Doctor', 'Medical and Dental Council of Nigeria (MDCN)', 'MDCN/R/12345',
      'Valid until 31 Mar 2027', 'Lekki Family Clinic', 'Lekki Health Ltd', 'Submitted', 'Applied', 'Not yet']) {
      expect(within(first!).getByText(text), text).toBeTruthy()
    }
    expect(within(first!).getByRole('heading', { name: 'Chiamaka Obi' })).toBeTruthy()
    expect(within(first!).getByText('Set up')).toBeTruthy()
    expect(within(first!).getByRole('link', { name: 'Open Chiamaka Obi’s application' }).getAttribute('href'))
      .toBe(`/admin/clinicians/${ID}`)
    // Step 1 by the caller: the queue says another Super Admin must take step 2.
    expect(within(second!).getByText('Nurse or midwife')).toBeTruthy()
    expect(within(second!).getByText('You')).toBeTruthy()
    expect(within(second!).getByText('Needs a different Super Admin')).toBeTruthy()
    expect(within(third!).getByText('Waiting for authenticator')).toBeTruthy()
    expect(within(third!).getByText('Not set up')).toBeTruthy()
    expect(within(first!).queryByText('Needs a different Super Admin')).toBeNull()
  })

  it('filters by state through the address, newest first, and pages with the cursor of that state', async () => {
    api.clinicianApplications.mockResolvedValueOnce({ items: [summary()], nextCursor: null })
      .mockResolvedValueOnce({ items: [summary({ state: 'under_review', version: 4 })], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [summary({ applicationId: OTHER_ID, state: 'under_review',
        applicant: { accountId: 'account-d', fullName: 'Dayo Musa', email: 'dayo@example.test' } })], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    openAt('/admin/clinicians')
    await screen.findByText('Showing 1 applications, oldest first')

    fireEvent.click(screen.getByRole('button', { name: 'Under review' }))
    expect(await screen.findByText('Showing 1 applications, newest first; more are available')).toBeTruthy()
    expect(api.clinicianApplications).toHaveBeenLastCalledWith('under_review', {}, expect.any(AbortSignal))
    expect(screen.getByTestId('location').textContent).toBe('/admin/clinicians?state=under_review')
    expect(screen.getByRole('button', { name: 'Under review' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }))
    expect(await screen.findByRole('heading', { name: 'Dayo Musa' })).toBeTruthy()
    expect(api.clinicianApplications).toHaveBeenLastCalledWith('under_review', { cursor: 'cursor-2' }, expect.any(AbortSignal))
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Load more applications' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(api.clinicianApplications).toHaveBeenLastCalledWith('open', {}, expect.any(AbortSignal)))
    expect(screen.getByTestId('location').textContent).toBe('/admin/clinicians')
    // Nothing personal is ever put in the address.
    expect(screen.getByTestId('location').textContent).not.toMatch(/Chiamaka|example\.test|MDCN/)
  })

  it('opens a linked state, keeps Refresh after an outage, and says when a list position is refused', async () => {
    api.clinicianApplications.mockRejectedValueOnce(problem(503, 'ADMIN_COMMAND_UNAVAILABLE', 'req-503'))
      .mockResolvedValueOnce({ items: [summary({ state: 'rejected' })], nextCursor: 'cursor-2' })
      .mockRejectedValueOnce(problem(400, 'ADMIN_INVALID_CURSOR'))
    openAt('/admin/clinicians?state=rejected')
    const outage = await screen.findByRole('alert')
    expect(outage.textContent).toMatch(/^Clinician applications could not be loaded\. Reference: req-503/)
    expect(api.clinicianApplications).toHaveBeenCalledWith('rejected', {}, expect.any(AbortSignal))
    fireEvent.click(within(outage).getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Showing 1 applications, newest first; more are available')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/list position is no longer valid/)
  })

  it('opens an application from the list', async () => {
    api.clinicianApplications.mockResolvedValueOnce({ items: [summary()], nextCursor: null })
    api.clinicianApplication.mockResolvedValueOnce(detail())
    openAt('/admin/clinicians')
    fireEvent.click(await screen.findByRole('link', { name: 'Open Chiamaka Obi’s application' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Chiamaka Obi' })).toBeTruthy()
    expect(api.clinicianApplication).toHaveBeenCalledWith(ID, expect.any(AbortSignal))
    expect(screen.getByRole('link', { name: '← All clinician applications' }).getAttribute('href')).toBe('/admin/clinicians')
  })
})

describe('one clinician application (A2)', () => {
  it('shows the application, the account, the facility with its administrators, and every warning', async () => {
    await openDetail(detail({
      account: { status: 'active', createdAt: '2026-10-10T08:50:00.000Z', emailVerifiedAt: '2026-10-10T08:52:00.000Z',
        patientAccount: true, identityRejection: true },
      authenticator: { enrolled: true, factorId: 'factor-1', activatedAt: '2026-10-12T09:05:00.000Z', enrolledAfterRecovery: true },
      otherMemberships: [{ facilityName: 'Ikoyi Clinic', state: 'active', roles: ['nurse'] }],
      flags: { sameLicenceKeyOtherAccounts: 2, sameLicenceKeyOtherOpenApplications: 1, sameLicenceAttestedElsewhere: true,
        orgAdminNameMatch: true, orgAdminEmailDomainMatch: true },
    }))
    const warnings = screen.getByRole('region', { name: 'Warnings' })
    for (const text of [
      'This licence number appears on 2 other accounts.',
      '1 other open application uses this licence.',
      'This licence is attested on another account.',
      'The applicant’s name matches an administrator of this facility’s organisation: confirm employment especially carefully.',
      'The applicant’s email address has the same domain as a facility administrator’s. That doesn’t confirm employment.',
      'This account was refused for identity: it can’t be verified.',
      'The authenticator was set up after a password reset. Confirm the person especially carefully.',
    ]) expect(within(warnings).getByText(text), text).toBeTruthy()

    const application = screen.getByRole('region', { name: 'Application' })
    for (const text of ['chiamaka@example.test', 'Doctor', 'Medical and Dental Council of Nigeria (MDCN)', 'MDCN/R/12345',
      '31 Mar 2027']) expect(within(application).getByText(text), text).toBeTruthy()
    const account = screen.getByRole('region', { name: 'Account' })
    expect(within(account).getByText('Ikoyi Clinic: Active (Nurse)')).toBeTruthy()
    expect(within(account).getByText('Set up after a password reset')).toBeTruthy()
    expect(within(account).getByText('Yes')).toBeTruthy()

    const facility = screen.getByRole('region', { name: 'Facility' })
    expect(within(facility).getByText('RC****89')).toBeTruthy()
    expect(within(facility).getByText(/to look up the facility’s public phone number/)).toBeTruthy()
    const admins = within(facility).getByRole('heading', { name: 'Facility administrators (not sufficient alone to confirm employment)' })
    expect(admins).toBeTruthy()
    expect(within(facility).getByText('Tunde Bello')).toBeTruthy()
    expect(within(facility).getByText('tunde@lekki.example.test')).toBeTruthy()
  })

  it('shows no warnings section when the application raises none, and the authenticator date', async () => {
    await openDetail(detail())
    expect(screen.queryByRole('region', { name: 'Warnings' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Account' })).getByText(/^Set up on 10 Oct 2026/)).toBeTruthy()
  })

  it('asks nothing for an address that holds no application ID', () => {
    openAt('/admin/clinicians/not-an-application')
    expect(screen.getByRole('heading', { level: 1, name: 'Application not found' })).toBeTruthy()
    expect(api.clinicianApplication).not.toHaveBeenCalled()
  })

  it('says an application the server cannot find is gone, with Refresh', async () => {
    api.clinicianApplication.mockRejectedValueOnce(problem(404, 'CLINICIAN_APPLICATION_NOT_FOUND'))
    openAt(`/admin/clinicians/${ID}`)
    const gone = await screen.findByRole('alert')
    expect(gone.textContent).toMatch(/This application no longer exists/)
    expect(within(gone).getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })
})

describe('step 1: verify the licence and the person (A3)', () => {
  it('records step 1 with the full checklist, the applicant’s live code and a reason, after step-up, as one submission', async () => {
    api.attestClinicianApplication.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ applicationId: ID, state: 'under_review', attestationId: 'attestation-1',
        attestedRoles: ['doctor'], verificationMethod: 'manual_review', validUntil: '2027-03-31T22:59:59.000Z', version: 4,
        replayed: false })
    api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-15T10:05:00.000Z' })
    await openDetail(detail())
    api.clinicianApplication.mockResolvedValueOnce(underReview('admin-b'))

    const panel = screen.getByRole('region', { name: 'Step 1 of 2: verify the licence and the person' })
    const submit = within(panel).getByRole('button', { name: 'Record verification (step 1)' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(within(panel).getByRole('group', { name: 'Licence' })).toBeTruthy()
    expect(within(panel).getByRole('group', { name: 'Identity' })).toBeTruthy()
    expect(within(panel).getByRole('group', { name: 'Employment' })).toBeTruthy()
    expect(within(panel).getByText(/Ask the applicant to read the current code from their authenticator app during your call\. Codes change every 30 seconds\./)).toBeTruthy()
    expect(within(panel).getByText(/facility administrator’s own contact is not enough/)).toBeTruthy()
    expect(within(panel).getByText(/Never paste documents or personal details/)).toBeTruthy()
    // The earlier of the licence expiry and one year, never later than the licence.
    const validity = within(panel).getByLabelText('Verification valid until') as HTMLInputElement
    expect([validity.value, validity.min, validity.max]).toEqual(['2027-03-31', '2026-10-15', '2027-03-31'])
    const code = within(panel).getByLabelText('Applicant’s authenticator code') as HTMLInputElement
    // The applicant's code, not the reviewer's own: the browser must not offer the reviewer's one-time code.
    expect([code.getAttribute('inputmode'), code.getAttribute('autocomplete'), code.getAttribute('pattern')])
      .toEqual(['numeric', 'off', '[0-9]{6}'])

    completeStepOne('12 34-56')
    expect(code.value).toBe('123456')
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Authenticator code'), { target: { value: '654321' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))

    const notice = await screen.findByText('Step 1 recorded. A different Super Admin must now approve it.')
    expect(notice.getAttribute('role')).toBe('status')
    await waitFor(() => expect(document.activeElement).toBe(notice))
    const body = { validUntil: '2027-03-31T23:59:59+01:00', evidenceReference: 'Ticket HID-VER-1234', checklist: CHECKLIST,
      authenticatorCode: '123456', reason: 'Licence on the register; video call with passport' }
    // The step-up repeats the same submission: the same body and key, never a second command.
    expect(api.attestClinicianApplication.mock.calls).toEqual([
      [expect.objectContaining({ applicationId: ID, version: 3 }), body, 'key-1'],
      [expect.objectContaining({ applicationId: ID, version: 3 }), body, 'key-1'],
    ])
    expect(api.stepUp).toHaveBeenCalledWith('654321')
    // The reloaded application: step 2 is not offered to the administrator who did step 1.
    expect(await screen.findByText('You verified this application. A different Super Admin must approve it.')).toBeTruthy()
    expect(api.clinicianApplication).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Approve and give access' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record verification (step 1)' })).toBeNull()
  })

  it('clears only the applicant’s code when it is refused, and says when the applicant’s codes are locked', async () => {
    api.attestClinicianApplication.mockRejectedValueOnce(problem(403, 'CLINICIAN_APPLICATION_AUTHENTICATOR_CODE_INVALID'))
      .mockRejectedValueOnce(new HidApiError(429, 'Too many', { code: 'CLINICIAN_APPLICATION_AUTHENTICATOR_RATE_LIMITED' }))
    await openDetail(detail())
    completeStepOne()
    fireEvent.click(screen.getByRole('button', { name: 'Record verification (step 1)' }))

    const panel = screen.getByRole('region', { name: 'Step 1 of 2: verify the licence and the person' })
    expect((await within(panel).findByRole('alert')).textContent)
      .toBe('The authenticator code wasn’t accepted. Ask for a new code and try again.')
    const code = within(panel).getByLabelText('Applicant’s authenticator code') as HTMLInputElement
    expect(code.value).toBe('')
    expect(document.activeElement).toBe(code)
    expect((within(panel).getByLabelText('Evidence reference') as HTMLInputElement).value).toBe('Ticket HID-VER-1234')
    expect((within(panel).getByLabelText('Reason') as HTMLTextAreaElement).value).toBe('Licence on the register; video call with passport')
    expect((within(panel).getByLabelText('Video call with photo ID') as HTMLInputElement).checked).toBe(true)
    expect((within(panel).getByRole('button', { name: 'Record verification (step 1)' }) as HTMLButtonElement).disabled).toBe(true)

    type('Applicant’s authenticator code', '222333')
    fireEvent.click(screen.getByRole('button', { name: 'Record verification (step 1)' }))
    await waitFor(() => expect(within(panel).getByRole('alert').textContent)
      .toBe('Too many wrong codes for this applicant. Wait 15 minutes.'))
    // Each attempt is its own submission; nothing reloaded, nothing else cleared.
    expect(api.attestClinicianApplication.mock.calls.map(call => call[2])).toEqual(['key-1', 'key-2'])
    expect(api.attestClinicianApplication.mock.calls[1]![1]).toMatchObject({ authenticatorCode: '222333' })
    expect(api.clinicianApplication).toHaveBeenCalledTimes(1)
  })

  it('offers a verification date up to the licence expiry or three years, defaulting to one year', async () => {
    await openDetail(detail({ licenceValidUntil: '2030-06-30' }))
    const validity = screen.getByLabelText('Verification valid until') as HTMLInputElement
    expect([validity.value, validity.min, validity.max]).toEqual(['2027-10-15', '2026-10-15', '2029-10-14'])
    completeStepOne()
    fireEvent.change(validity, { target: { value: '2029-10-15' } })
    expect((screen.getByRole('button', { name: 'Record verification (step 1)' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(validity, { target: { value: '2028-01-31' } })
    expect((screen.getByRole('button', { name: 'Record verification (step 1)' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers no step 1 for a licence that has already expired', async () => {
    await openDetail(detail({ licenceValidUntil: '2026-10-01' }))
    expect(screen.getByText('The licence expired on 1 Oct 2026. Reject the application with ‘Licence not current’.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record verification (step 1)' })).toBeNull()
  })

  it.each([
    ['SELF', 'This is your own application.'],
    ['WORKS_AT_FACILITY', 'You work at this facility, so another Super Admin must verify it.'],
    ['AUTHENTICATOR_REQUIRED', 'The applicant hasn’t set up their authenticator.'],
    ['ACCOUNT_INELIGIBLE', 'This applicant’s account can’t be verified: it is not active, or an application of it was refused for identity.'],
  ])('says why the caller cannot record step 1 (%s)', async (reason, text) => {
    await openDetail(detail({ callerHints: { attest: { allowed: false, reason }, approve: { allowed: false, reason: 'STATE' },
      reject: { allowed: true, reason: null } } }))
    const panel = screen.getByRole('region', { name: 'Step 1 of 2: verify the licence and the person' })
    expect(within(panel).getByText(text)).toBeTruthy()
    expect(within(panel).queryByRole('button')).toBeNull()
  })

  it('waits for the applicant’s authenticator before step 1', async () => {
    await openDetail(detail({ state: 'awaiting_authenticator', authenticatorReady: false,
      authenticator: { enrolled: false, factorId: null, activatedAt: null, enrolledAfterRecovery: false },
      callerHints: { attest: { allowed: false, reason: 'STATE' }, approve: { allowed: false, reason: 'STATE' },
        reject: { allowed: true, reason: null } } }))
    expect(within(screen.getByRole('region', { name: 'Account' })).getByText('Not set up: step 1 is unavailable')).toBeTruthy()
    expect(screen.getByText('The applicant hasn’t set up their authenticator yet. Step 1 opens when they have.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record verification (step 1)' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reject application' })).toBeTruthy()
  })
})

describe('step 2: approve and give access (A4)', () => {
  it('offers step 2 to a different Super Admin, says what the role can do, and approves once', async () => {
    api.approveClinicianApplication.mockResolvedValueOnce({ applicationId: ID, state: 'approved', accountId: 'account-c',
      facilityId: 'facility-1', membershipId: 'membership-1', roleCode: 'doctor', attestationId: 'attestation-1', version: 5,
      replayed: false })
    await openDetail(underReview())
    api.clinicianApplication.mockResolvedValueOnce(detail({ state: 'approved', version: 5, accessState: 'active',
      approval: { by: 'admin-b', at: '2026-10-15T10:01:00.000Z', membershipId: 'membership-1' },
      callerHints: { attest: { allowed: false, reason: 'STATE' }, approve: { allowed: false, reason: 'STATE' },
        reject: { allowed: false, reason: 'STATE' } } }))

    const record = screen.getByRole('region', { name: 'Step 1 record' })
    for (const text of ['Ade Admin', 'Ticket HID-VER-1234', 'Video call with photo ID', 'Licence on the register; video call with passport',
      'Facility phone number from a public record']) expect(within(record).getByText(text), text).toBeTruthy()

    const panel = screen.getByRole('region', { name: 'Step 2 of 2: approve and give access' })
    expect(within(panel).getByText('Grants Doctor at Lekki Family Clinic to Chiamaka Obi.')).toBeTruthy()
    const can = within(panel).getByRole('list', { name: 'This role can' })
    expect(within(can).getAllByRole('listitem').map(item => item.textContent)).toEqual(['read patient records with consent',
      'write clinical notes', 'write prescriptions', 'open emergency summaries without consent when break-glass is on',
      'register patients'])
    const approve = within(panel).getByRole('button', { name: 'Approve and give access' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    type('Reason for approval', 'Step 1 evidence reviewed')
    fireEvent.click(approve)

    const notice = await screen.findByText('Approved. Chiamaka Obi can now sign in to the provider portal with their password and authenticator.')
    await waitFor(() => expect(document.activeElement).toBe(notice))
    expect(api.approveClinicianApplication.mock.calls).toEqual([
      [expect.objectContaining({ applicationId: ID, version: 4 }), 'Step 1 evidence reviewed', 'key-1']])
    expect(await screen.findByText('Active: they can sign in at this facility')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve and give access' })).toBeNull()
  })

  it('says what step 2 still needs while its button is disabled', async () => {
    await openDetail(underReview())
    const panel = screen.getByRole('region', { name: 'Step 2 of 2: approve and give access' })
    const approve = within(panel).getByRole('button', { name: 'Approve and give access' }) as HTMLButtonElement
    type('Reason for approval', 'LGTM')
    expect(approve.disabled).toBe(true)
    const needed = within(panel).getByText('Still needed: a reason (8 to 500 characters).')
    expect(approve.getAttribute('aria-describedby')).toBe(needed.id)
    type('Reason for approval', 'Step 1 evidence reviewed')
    expect(approve.disabled).toBe(false)
    expect(within(panel).queryByText(/Still needed/)).toBeNull()
    expect(approve.getAttribute('aria-describedby')).toBeNull()
  })

  it('never offers step 2 to the administrator who did step 1, even if a hint says otherwise', async () => {
    await openDetail(underReview('admin-b', { callerHints: { attest: { allowed: false, reason: 'STATE' },
      approve: { allowed: true, reason: null }, reject: { allowed: true, reason: null } } }))
    const panel = screen.getByRole('region', { name: 'Step 2 of 2: approve and give access' })
    expect(within(panel).getByText('You verified this application. A different Super Admin must approve it.')).toBeTruthy()
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Step 1 record' })).getByText('You')).toBeTruthy()
  })

  it('explains the second-admin refusal and an authenticator reset after step 1', async () => {
    api.approveClinicianApplication.mockRejectedValueOnce(problem(403, 'CLINICIAN_APPLICATION_SECOND_ADMIN_REQUIRED'))
      .mockRejectedValueOnce(problem(409, 'CLINICIAN_APPLICATION_AUTHENTICATOR_CHANGED'))
    await openDetail(underReview())
    type('Reason for approval', 'Step 1 evidence reviewed')
    fireEvent.click(screen.getByRole('button', { name: 'Approve and give access' }))
    const panel = screen.getByRole('region', { name: 'Step 2 of 2: approve and give access' })
    expect((await within(panel).findByRole('alert')).textContent)
      .toBe('You recorded step 1 for this application, so a different Super Admin must approve it. Nothing was changed.')
    fireEvent.click(screen.getByRole('button', { name: 'Approve and give access' }))
    await waitFor(() => expect(within(panel).getByRole('alert').textContent)
      .toBe('The applicant’s authenticator was reset after step 1. Reject the application with ‘Other’; they can apply again.'))
    expect(api.clinicianApplication).toHaveBeenCalledTimes(1)
  })

  it('says so instead of offering step 2 when the authenticator changed after step 1', async () => {
    await openDetail(underReview('admin-a', { callerHints: { attest: { allowed: false, reason: 'STATE' },
      approve: { allowed: false, reason: 'AUTHENTICATOR_REQUIRED' }, reject: { allowed: true, reason: null } } }))
    const panel = screen.getByRole('region', { name: 'Step 2 of 2: approve and give access' })
    expect(within(panel).getByText('The applicant’s authenticator was reset after step 1. Reject the application with ‘Other’; they can apply again.')).toBeTruthy()
    expect(within(panel).queryByRole('button')).toBeNull()
  })
})

describe('reject (A5)', () => {
  it('rejects with a decision code whose applicant words are shown, and warns that an identity refusal is final', async () => {
    api.rejectClinicianApplication.mockResolvedValueOnce({ applicationId: ID, state: 'rejected',
      decisionCode: 'licence_not_current', version: 4, replayed: false })
    await openDetail(detail())
    api.clinicianApplication.mockResolvedValueOnce(detail({ state: 'rejected', version: 4,
      decision: { code: 'licence_not_current', reason: 'The register shows the licence expired', by: 'admin-b', at: '2026-10-15T10:01:00.000Z' },
      callerHints: { attest: { allowed: false, reason: 'STATE' }, approve: { allowed: false, reason: 'STATE' },
        reject: { allowed: false, reason: 'STATE' } } }))

    const panel = screen.getByRole('region', { name: 'Reject this application' })
    const select = within(panel).getByLabelText('Reason shown to the applicant') as HTMLSelectElement
    const options = [...select.options].filter(option => option.value)
    expect(options.map(option => option.value)).toEqual(['licence_not_verified', 'licence_not_current', 'details_mismatch',
      'identity_not_confirmed', 'employment_not_confirmed', 'facility_not_available', 'duplicate', 'existing_account', 'other'])
    expect(options[1]!.textContent).toBe('Licence not current: “Your licence is not current on the MDCN register.”')
    expect(options[4]!.textContent).toBe('Employment not confirmed: “Lekki Family Clinic did not confirm that you work there.”')

    fireEvent.change(select, { target: { value: 'identity_not_confirmed' } })
    expect(within(panel).getByText(/This account won’t be able to apply again\. To also stop it signing in anywhere, lock it in/)).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Users & roles' }).getAttribute('href')).toBe('/admin/principals')
    fireEvent.change(select, { target: { value: 'licence_not_current' } })
    expect(within(panel).queryByRole('link', { name: 'Users & roles' })).toBeNull()

    const reject = within(panel).getByRole('button', { name: 'Reject application' }) as HTMLButtonElement
    expect(reject.disabled).toBe(true)
    type('Internal reason (never shown to the applicant)', 'The register shows the licence expired')
    fireEvent.click(reject)
    const notice = await screen.findByText('Rejected. The applicant sees: ‘Your licence is not current on the MDCN register.’')
    await waitFor(() => expect(document.activeElement).toBe(notice))
    expect(api.rejectClinicianApplication.mock.calls).toEqual([[expect.objectContaining({ applicationId: ID, version: 3 }),
      'licence_not_current', 'The register shows the licence expired', 'key-1']])
    // The decision as recorded: the code the applicant sees, and the internal reason they never see.
    const decision = await screen.findByRole('region', { name: 'Decision' })
    expect(within(decision).getByText('Licence not current')).toBeTruthy()
    expect(within(decision).getByText('The register shows the licence expired')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reject application' })).toBeNull()
  })

  it('says what a rejection still needs while its button is disabled', async () => {
    await openDetail(detail())
    const panel = screen.getByRole('region', { name: 'Reject this application' })
    const reject = within(panel).getByRole('button', { name: 'Reject application' }) as HTMLButtonElement
    const needed = within(panel).getByText('Still needed: the reason shown to the applicant, an internal reason (8 to 500 characters).')
    expect(reject.getAttribute('aria-describedby')).toBe(needed.id)
    fireEvent.change(within(panel).getByLabelText('Reason shown to the applicant'), { target: { value: 'duplicate' } })
    type('Internal reason (never shown to the applicant)', 'Dup')
    expect(reject.disabled).toBe(true)
    expect(within(panel).getByText('Still needed: an internal reason (8 to 500 characters).')).toBeTruthy()
    type('Internal reason (never shown to the applicant)', 'Second application for the same facility')
    expect(reject.disabled).toBe(false)
    expect(within(panel).queryByText(/Still needed/)).toBeNull()
  })

  it('offers no rejection to an administrator who works at the facility', async () => {
    await openDetail(detail({ callerHints: { attest: { allowed: false, reason: 'WORKS_AT_FACILITY' },
      approve: { allowed: false, reason: 'STATE' }, reject: { allowed: false, reason: 'WORKS_AT_FACILITY' } } }))
    const panel = screen.getByRole('region', { name: 'Reject this application' })
    expect(within(panel).getByText('You work at this facility, so another Super Admin must decide it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reject application' })).toBeNull()
  })

  it('offers no step on a decided application and shows its access', async () => {
    await openDetail(detail({ state: 'approved', version: 5, accessState: 'lapsed',
      attestation: underReview().attestation, approval: { by: 'admin-c', at: '2026-10-15T09:00:00.000Z', membershipId: 'membership-1' },
      callerHints: { attest: { allowed: false, reason: 'STATE' }, approve: { allowed: false, reason: 'STATE' },
        reject: { allowed: false, reason: 'STATE' } } }))
    expect(screen.getByText('Lapsed: the role is held but its licence check expired, so it gives no access')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Reject this application' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Step 1 of 2: verify the licence and the person' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Step 2 of 2: approve and give access' })).toBeNull()
  })
})

describe('changed, replayed and unanswered commands', () => {
  it.each(['VERSION_CONFLICT', 'CLINICIAN_APPLICATION_STATE_INVALID'])('reloads the application when it changed (%s)', async code => {
    api.rejectClinicianApplication.mockRejectedValueOnce(problem(409, code))
    await openDetail(detail())
    api.clinicianApplication.mockResolvedValueOnce(underReview('admin-a'))
    fireEvent.change(screen.getByLabelText('Reason shown to the applicant'), { target: { value: 'duplicate' } })
    type('Internal reason (never shown to the applicant)', 'Second application for the same facility')
    fireEvent.click(screen.getByRole('button', { name: 'Reject application' }))
    const notice = await screen.findByText('This application changed; here is its current state.')
    await waitFor(() => expect(document.activeElement).toBe(notice))
    expect(await screen.findByRole('region', { name: 'Step 2 of 2: approve and give access' })).toBeTruthy()
    expect(api.clinicianApplication).toHaveBeenCalledTimes(2)
  })

  it('shows a replayed command as already done', async () => {
    api.rejectClinicianApplication.mockResolvedValueOnce({ applicationId: ID, state: 'rejected', decisionCode: 'duplicate',
      version: 4, replayed: true })
    await openDetail(detail())
    api.clinicianApplication.mockResolvedValueOnce(detail({ state: 'rejected', version: 4 }))
    fireEvent.change(screen.getByLabelText('Reason shown to the applicant'), { target: { value: 'duplicate' } })
    type('Internal reason (never shown to the applicant)', 'Second application for the same facility')
    fireEvent.click(screen.getByRole('button', { name: 'Reject application' }))
    expect(await screen.findByText('This application was already rejected with this submission. The applicant sees: '
      + '‘You already have access, or another application, for this facility.’')).toBeTruthy()
  })

  it('shows a replayed step 1 and step 2 as already done', async () => {
    api.attestClinicianApplication.mockResolvedValueOnce({ applicationId: ID, state: 'under_review',
      attestationId: 'attestation-1', attestedRoles: ['doctor'], verificationMethod: 'manual_review',
      validUntil: '2027-03-31T22:59:59.000Z', version: 4, replayed: true })
    await openDetail(detail())
    api.clinicianApplication.mockResolvedValueOnce(underReview('admin-a'))
    completeStepOne()
    fireEvent.click(screen.getByRole('button', { name: 'Record verification (step 1)' }))
    expect(await screen.findByText('Step 1 was already recorded with this submission. A different Super Admin must now approve it.')).toBeTruthy()

    api.approveClinicianApplication.mockResolvedValueOnce({ applicationId: ID, state: 'approved', accountId: 'account-c',
      facilityId: 'facility-1', membershipId: 'membership-1', roleCode: 'doctor', attestationId: 'attestation-1', version: 5,
      replayed: true })
    api.clinicianApplication.mockResolvedValueOnce(detail({ state: 'approved', version: 5 }))
    // Step 2's form comes with the reload after step 1.
    fireEvent.change(await screen.findByLabelText('Reason for approval'), { target: { value: 'Step 1 evidence reviewed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve and give access' }))
    expect(await screen.findByText('This application was already approved with this submission. Chiamaka Obi can sign in to the provider portal with their password and authenticator.')).toBeTruthy()
  })

  it('reloads after a command whose answer was lost, without claiming it failed or succeeded', async () => {
    api.approveClinicianApplication.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await openDetail(underReview())
    api.clinicianApplication.mockResolvedValueOnce(underReview())
    type('Reason for approval', 'Step 1 evidence reviewed')
    fireEvent.click(screen.getByRole('button', { name: 'Approve and give access' }))
    const alert = await screen.findByText('We couldn’t confirm whether this step was recorded. The application was reloaded: check its state before trying again.')
    expect(alert.getAttribute('role')).toBe('alert')
    await waitFor(() => expect(api.clinicianApplication).toHaveBeenCalledTimes(2))
  })

  it.each([
    ['step 1', async () => {
      api.attestClinicianApplication.mockRejectedValueOnce(new HidApiError(408, 'Timeout', { code: 'REQUEST_TIMEOUT' }))
      await openDetail(detail())
      api.clinicianApplication.mockResolvedValueOnce(detail())
      completeStepOne()
      fireEvent.click(screen.getByRole('button', { name: 'Record verification (step 1)' }))
    }],
    ['step 2', async () => {
      api.approveClinicianApplication.mockRejectedValueOnce(new HidApiError(408, 'Timeout', { code: 'REQUEST_TIMEOUT' }))
      await openDetail(underReview())
      api.clinicianApplication.mockResolvedValueOnce(underReview())
      type('Reason for approval', 'Step 1 evidence reviewed')
      fireEvent.click(screen.getByRole('button', { name: 'Approve and give access' }))
    }],
    ['a rejection', async () => {
      api.rejectClinicianApplication.mockRejectedValueOnce(new HidApiError(408, 'Timeout', { code: 'REQUEST_TIMEOUT' }))
      await openDetail(detail())
      api.clinicianApplication.mockResolvedValueOnce(detail())
      fireEvent.change(screen.getByLabelText('Reason shown to the applicant'), { target: { value: 'duplicate' } })
      type('Internal reason (never shown to the applicant)', 'Second application for the same facility')
      fireEvent.click(screen.getByRole('button', { name: 'Reject application' }))
    }],
  ])('reloads after %s timed out on this side, as an answer that was lost, since Identity may have recorded it', async (_step, send) => {
    // The client gave up after its time budget (HidApiError 408 REQUEST_TIMEOUT); the server may still have carried it out.
    await send()
    const alert = await screen.findByText('We couldn’t confirm whether this step was recorded. The application was reloaded: check its state before trying again.')
    expect(alert.getAttribute('role')).toBe('alert')
    await waitFor(() => expect(api.clinicianApplication).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('The request took too long. Please try again.')).toBeNull()
  })

  it('keeps the form and says nothing changed when the step-up is cancelled', async () => {
    api.rejectClinicianApplication.mockRejectedValueOnce(problem(403, 'STEP_UP_EXPIRED'))
    await openDetail(detail())
    fireEvent.change(screen.getByLabelText('Reason shown to the applicant'), { target: { value: 'other' } })
    type('Internal reason (never shown to the applicant)', 'Applicant asked to stop the review')
    fireEvent.click(screen.getByRole('button', { name: 'Reject application' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    const panel = screen.getByRole('region', { name: 'Reject this application' })
    expect((await within(panel).findByRole('alert')).textContent).toMatch(/cancelled, so the action was not carried out/)
    expect((within(panel).getByLabelText('Internal reason (never shown to the applicant)') as HTMLTextAreaElement).value)
      .toBe('Applicant asked to stop the review')
    expect(api.rejectClinicianApplication).toHaveBeenCalledTimes(1)
    expect(api.clinicianApplication).toHaveBeenCalledTimes(1)
  })
})
