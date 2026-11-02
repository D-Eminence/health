import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, OrganizationApplication } from '../api'
import { ApplicationsPage } from '../Organizations'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({
  api: { applications: vi.fn(), verifyApplicationCac: vi.fn(), approveApplication: vi.fn(), rejectApplication: vi.fn(),
    facilities: vi.fn(), stepUp: vi.fn() },
}))
vi.mock('../api', () => ({ adminApi: mocks.api, newIdempotencyKey: () => 'key-1' }))
// The deployment the console runs in, which decides where a new administrator sets a password.
const deployment = vi.hoisted(() => ({ name: 'local' }))
vi.mock('../env', () => ({ environment: () => ({ name: deployment.name }) }))

const application = (overrides: Partial<OrganizationApplication> = {}): OrganizationApplication => ({
  applicationId: 'app-1', productCode: 'ehr', organizationName: 'Ikeja Care Ltd', organizationType: 'clinic', cacHint: 'RC••••56',
  administratorName: 'Bola Admin', administratorEmail: 'bola@example.test', status: 'ready_for_review', verificationResult: 'verified',
  verifiedOrganizationName: 'IKEJA CARE LIMITED', verifiedEntityType: 'Limited company', verifiedRegistrationDate: '2015-04-01',
  verifiedAddress: '1 Allen Avenue, Ikeja', verifiedRegistryStatus: 'active', profileCompanyName: 'Ikeja Care Ltd',
  profileEntityType: null, profileRegistrationDate: null, profileAddress: null, profileRegistryStatus: null, profileState: 'complete',
  fieldSources: { companyName: 'qoreid' }, createdAt: '2026-10-01T09:00:00.000Z', verifiedAt: '2026-10-02T09:00:00.000Z',
  reviewedAt: null, version: 5, ...overrides })
const REVIEWER = ['platform.identity-review.read', 'platform.facility.manage', 'platform.principal.manage', 'platform.role.manage']
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })

function open(permissions = REVIEWER, path = '/admin/applications') {
  render(<MemoryRouter initialEntries={[path]}><StepUpProvider><ApplicationsPage actor={actor(permissions)} /></StepUpProvider></MemoryRouter>)
}

const card = async (name: string) => (await screen.findByRole('heading', { name, level: 2 })).closest('article')!

beforeEach(() => vi.clearAllMocks())

describe('organization applications', () => {
  it('loads the status in the link and shows registry and profile evidence side by side', async () => {
    mocks.api.applications.mockResolvedValue({ items: [application()] })
    open(REVIEWER, '/admin/applications?status=ready_for_review')
    const item = await card('Ikeja Care Ltd')
    expect(mocks.api.applications).toHaveBeenCalledWith('ready_for_review', expect.anything())
    expect(screen.getByRole('button', { name: 'Ready for review' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(item).getByText('IKEJA CARE LIMITED')).toBeTruthy()
    expect(within(item).getByText('RC••••56')).toBeTruthy()
  })

  it('rejects with a reason after step-up, retrying the same command once', async () => {
    mocks.api.applications.mockResolvedValue({ items: [application()] })
    mocks.api.rejectApplication.mockRejectedValueOnce(new HidApiError(403, 'Step-up required', { code: 'STEP_UP_REQUIRED' }))
    mocks.api.rejectApplication.mockResolvedValueOnce({ status: 'rejected', version: 6 })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open()
    const item = await card('Ikeja Care Ltd')
    const reject = within(item).getByRole('button', { name: 'Reject application' }) as HTMLButtonElement
    fireEvent.change(within(item).getByLabelText('Reason for your decision'), { target: { value: 'short' } })
    expect(reject.disabled).toBe(true)
    fireEvent.change(within(item).getByLabelText('Reason for your decision'), { target: { value: 'Duplicate of an approved organization' } })
    fireEvent.click(reject)
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Application rejected. The applicant was not given access.')).toBeTruthy()
    expect(mocks.api.rejectApplication).toHaveBeenCalledTimes(2)
    expect(mocks.api.rejectApplication.mock.calls[1]).toEqual([expect.objectContaining({ applicationId: 'app-1', version: 5 }),
      'Duplicate of an approved organization'])
    await waitFor(() => expect(mocks.api.applications).toHaveBeenCalledTimes(2))
    expect(mocks.api.approveApplication).not.toHaveBeenCalled()
  })

  it('approves into an existing organization chosen through one of its facilities', async () => {
    mocks.api.applications.mockResolvedValue({ items: [application()] })
    mocks.api.facilities.mockResolvedValueOnce({ items: [{ id: 'facility-9', organizationId: 'org-9', organizationName: 'Lagos Health',
      name: 'Ikeja Clinic', code: 'IKJ', status: 'verified', statusReason: null, statusChangedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
      membershipCount: 2, version: 1 }], page: 1, pageSize: 10, total: 1 })
    mocks.api.approveApplication.mockResolvedValueOnce({ organizationId: 'org-9', facilityId: 'facility-9',
      firstAdminAccountId: 'account-9', version: 6, organizationReused: true })
    open()
    const item = await card('Ikeja Care Ltd')
    fireEvent.change(within(item).getByLabelText('Existing facility (optional)'), { target: { value: 'Ikeja' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Find facility' }))
    fireEvent.click(await within(item).findByRole('button', { name: 'Ikeja Clinic' }))
    expect(within(item).getByText(/Linking to/).textContent).toContain('Ikeja Clinic (Lagos Health)')
    expect(mocks.api.facilities).toHaveBeenCalledWith({ query: 'Ikeja', pageSize: 10 })
    fireEvent.change(within(item).getByLabelText('Reason for your decision'), { target: { value: 'Registry evidence matches the profile' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Approve application' }))
    const message = await screen.findByText(/linked to the existing organization/)
    // hid-system 0048 links only to an already active administrator: nothing to set up.
    expect(message.textContent).not.toMatch(/password/i)
    expect(mocks.api.approveApplication).toHaveBeenCalledWith(expect.objectContaining({ applicationId: 'app-1' }),
      'Registry evidence matches the profile', { organizationId: 'org-9', facilityId: 'facility-9' })
  })

  it.each([
    ['local', 'clinic', `${window.location.origin}/provider/recover`],
    ['production', 'clinic', 'https://ehr.healthidentitydirectory.com/provider/recover'],
    ['production', 'laboratory', 'https://lab.healthidentitydirectory.com/provider/recover'],
    ['staging', 'pharmacy', 'https://pharmacy.staging.healthidentitydirectory.com/provider/recover'],
  ])('in %s, tells the reviewer a new %s administrator sets a password at %s, never the patient portal', async (name, type, href) => {
    deployment.name = name
    try {
      mocks.api.applications.mockResolvedValue({ items: [application({ organizationType: type })] })
      mocks.api.approveApplication.mockResolvedValueOnce({ organizationId: 'org-1', facilityId: 'facility-1',
        firstAdminAccountId: 'account-1', version: 6, organizationReused: false })
      open()
      const item = await card('Ikeja Care Ltd')
      fireEvent.change(within(item).getByLabelText('Reason for your decision'), { target: { value: 'Registry evidence matches the profile' } })
      fireEvent.click(within(item).getByRole('button', { name: 'Approve application' }))
      const message = await screen.findByText(/A new organization, facility and administrator account were created/)
      // The administrator is created pending_reset; each product site has its own password recovery.
      expect(message.textContent).toContain(`ask them to set one at ${href}, or with “Forgot password?” on the sign-in page`)
      expect(message.textContent).not.toMatch(/main site|https:\/\/app\.healthidentitydirectory\.com|https:\/\/staging\.healthidentitydirectory\.com/)
      expect(message.textContent).not.toContain('does not work yet')
    } finally { deployment.name = 'local' }
  })

  // Novu (P4b): an approval that would reuse a company which signed itself up waits for its review on New facility sign-ups.
  it.each([
    ['novu-v1', 'This application conflicts with existing records and needs separate administrator resolution. A company '
      + 'that signed itself up must be reviewed on New facility sign-ups before a second product is approved.', true],
    ['main-v1', 'This application conflicts with existing records and needs separate administrator resolution.', false],
  ] as const)('on %s, says why a second product is refused, and when to review the sign-up first', async (contract, text, note) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    try {
      mocks.api.applications.mockResolvedValue({ items: [application()] })
      mocks.api.approveApplication.mockRejectedValueOnce(new HidApiError(409, 'review', { code: 'ORGANIZATION_REVIEW_REQUIRED' }))
      open()
      const item = await card('Ikeja Care Ltd')
      expect(Boolean(screen.queryByText('A company that signed itself up must be reviewed on New facility sign-ups before a '
        + 'second product is approved.', { selector: 'p.admin-note' }))).toBe(note)
      fireEvent.change(within(item).getByLabelText('Reason for your decision'), { target: { value: 'Registry evidence matches the profile' } })
      fireEvent.click(within(item).getByRole('button', { name: 'Approve application' }))
      expect(await within(item).findByText(text)).toBeTruthy()
    } finally { vi.unstubAllEnvs() }
  })

  it('explains a CAC verification refusal from the backend', async () => {
    mocks.api.applications.mockResolvedValue({ items: [application({ status: 'pending_verification', verificationResult: null })] })
    mocks.api.verifyApplicationCac.mockRejectedValueOnce(new HidApiError(503, 'disabled', { code: 'QOREID_DISABLED' }))
    open()
    const item = await card('Ikeja Care Ltd')
    fireEvent.click(within(item).getByRole('button', { name: 'Verify CAC with the registry' }))
    expect(await within(item).findByText('CAC verification is not enabled in this environment.')).toBeTruthy()
  })

  it('offers only the review steps the administrator holds and none on closed applications', async () => {
    mocks.api.applications.mockResolvedValue({ items: [application(),
      application({ applicationId: 'app-2', organizationName: 'Closed Care Ltd', status: 'approved' })] })
    open(['platform.identity-review.read', 'platform.facility.manage'])
    const open1 = await card('Ikeja Care Ltd')
    expect(within(open1).getByRole('button', { name: 'Reject application' })).toBeTruthy()
    expect(within(open1).queryByRole('button', { name: 'Approve application' })).toBeNull()
    const closed = await card('Closed Care Ltd')
    expect(within(closed).queryByRole('button')).toBeNull()
  })

  it('is view only without review permissions', async () => {
    mocks.api.applications.mockResolvedValue({ items: [application()] })
    open(['platform.identity-review.read'])
    const item = await card('Ikeja Care Ltd')
    // Nothing to do on it: no review actions at all.
    expect(within(item).queryByRole('button')).toBeNull()
    expect(within(item).queryByLabelText(/Reason/)).toBeNull()
  })
})
