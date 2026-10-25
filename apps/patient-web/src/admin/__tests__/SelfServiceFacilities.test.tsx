import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, SelfServiceApplication, SelfServiceFacility } from '../api'
import { PrincipalsPage } from '../Principals'
import { SelfServiceFacilitiesPage } from '../SelfServiceFacilities'
import { StepUpProvider } from '../StepUp'

/**
 * New facility sign-ups (P4, which only Novu serves): support checks every facility that signed itself up within a
 * working day, marks it reviewed with a note (version-checked), and suspends the facility or disables its
 * administrator through the Facilities and Users & roles pages when it looks wrong. Once both are done it can release
 * the sign-up, freeing its CAC number for the real company, and it sees and can reject open applications (P4 round 2).
 */
const mocks = vi.hoisted(() => ({
  api: { selfServiceFacilities: vi.fn(), reviewSelfServiceFacility: vi.fn(), releaseSelfServiceFacility: vi.fn(),
    selfServiceApplications: vi.fn(), searchSelfServiceApplications: vi.fn(), rejectSelfServiceApplication: vi.fn(),
    waiveSelfServiceRefusals: vi.fn(), principals: vi.fn(), stepUp: vi.fn() },
}))
vi.mock('../api', () => ({ adminApi: mocks.api, PAGE_SIZE: 25, newIdempotencyKey: () => 'key-1' }))

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const signUp = (overrides: Partial<SelfServiceFacility> = {}): SelfServiceFacility => ({
  applicationId: '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a', version: 3, organizationId: 'org-1',
  organizationName: 'IKEJA CARE LIMITED', facilityId: FACILITY_ID, facilityName: 'IKEJA CARE LIMITED',
  facilityLifecycleStatus: 'verified', productCode: 'laboratory', organizationType: 'laboratory', cacHint: 'RC••••56',
  administratorName: 'Bola Adewale', administratorEmail: 'bola@ikejacare.example', administratorAccountId: 'account-1',
  administratorAccountStatus: 'active', activatedAt: '2026-10-24T09:00:00.000Z', reviewedAt: null,
  reviewedByAccountId: null, reviewNote: null, ...overrides })
/** Novu 0064: the facility review role reads applications and manages facilities; support reads principals. */
const REVIEWER = ['platform.admin.access', 'platform.identity-review.read', 'platform.facility.read', 'platform.facility.manage',
  'platform.principal.read']
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function open(element: ReactElement, path = '/admin/self-service-facilities') {
  render(<MemoryRouter initialEntries={[path]}><StepUpProvider><Routes>
    <Route path="/admin/self-service-facilities" element={<>{element}<Location /></>} />
    <Route path="/admin/principals" element={<><PrincipalsPage actor={actor(REVIEWER)} /><Location /></>} />
    <Route path="/admin/facilities/:facilityId" element={<><h1>Facility page</h1><Location /></>} />
  </Routes></StepUpProvider></MemoryRouter>)
}

const card = async (name: string) => (await screen.findByRole('heading', { name, level: 2 })).closest('article')!

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
afterEach(() => { vi.unstubAllEnvs() })

describe('new facility sign-ups', () => {
  it('lists the ones to review first, with what support checks, and says how many wait', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [signUp(),
      signUp({ applicationId: 'app-2', facilityName: 'Surulere Pharmacy', organizationName: 'SURULERE PHARMACY LTD' })] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    expect(mocks.api.selfServiceFacilities).toHaveBeenCalledWith('unreviewed', expect.anything())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New facility sign-ups (2 to review)')
    expect(screen.getByRole('button', { name: 'To review' }).getAttribute('aria-pressed')).toBe('true')
    const shown = (term: string) => within(item).getByText(term).nextElementSibling?.textContent
    expect(shown('Legal name (CAC)')).toBe('IKEJA CARE LIMITED')
    expect(shown('CAC number')).toBe('RC••••56')
    expect(shown('Product')).toBe('Laboratory')
    expect(shown('Administrator')).toBe('Bola Adewalebola@ikejacare.example')
    expect(shown('Account status')).toBe('Active')
    expect(shown('Reviewed')).toBe('Not yet')
    expect(within(item).getByText('Verified')).toBeTruthy()
    // What the review is, said plainly.
    const check = within(screen.getByRole('region', { name: 'What to check' }))
    expect(check.getByText('The CAC check proves that the company exists and is active. It does not prove that the person who '
      + 'signed up works there.')).toBeTruthy()
    expect(check.getByText(/If anything looks wrong, suspend the facility and disable the administrator’s account/)).toBeTruthy()
    // And what the release is for (P4 round 2).
    expect(check.getByText('If it used another company’s CAC number, by mistake or not, also release it once the facility is '
      + 'suspended and the account disabled. That frees the CAC number and the legal name, so the real company can sign up.')).toBeTruthy()
    // One mistyped digit registers another company under its legal name (P4 review).
    expect(check.getByText('A mistyped CAC number can sign up another, real company under its legal name. If the legal name '
      + 'is not the administrator’s own organization, treat the sign-up as wrong.')).toBeTruthy()
  })

  it.each([
    ['Reviewed or released', 'reviewed'],
    ['All', 'all'],
  ] as const)('shows %s from the filter, kept in the address', async (title, state) => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [signUp({ reviewedAt: '2026-10-24T11:00:00.000Z',
      reviewedByAccountId: 'admin-9', reviewNote: 'Called the lab; the director confirmed Bola.' })] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    await card('IKEJA CARE LIMITED')
    fireEvent.click(screen.getByRole('button', { name: title }))
    await waitFor(() => expect(mocks.api.selfServiceFacilities).toHaveBeenLastCalledWith(state, expect.anything()))
    expect(screen.getByTestId('location').textContent).toBe(`/admin/self-service-facilities?state=${state}`)
    const item = await card('IKEJA CARE LIMITED')
    expect(within(item).getByText('Review note: Called the lab; the director confirmed Bola.')).toBeTruthy()
    expect(within(item).queryByText('Mark reviewed')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toBe(state === 'all' ? 'New facility sign-ups (0 to review)' : 'New facility sign-ups')
  })

  it('shows a row whose optional details are missing without failing', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [signUp({ organizationType: null as unknown as string,
      cacHint: '', administratorAccountId: null, administratorAccountStatus: null, activatedAt: null })] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    const shown = (term: string) => within(item).getByText(term).nextElementSibling?.textContent
    expect(shown('Organization type')).toBe('Not provided')
    expect(shown('CAC number')).toBe('Not shown')
    expect(shown('Account status')).toBe('No account')
    expect(shown('Signed up')).toBe('Not available')
  })

  it('says when nothing is waiting', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    expect(await screen.findByText('No new facility sign-ups are waiting for review.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New facility sign-ups (0 to review)')
  })

  it('says 200 or more when the list is at Identity’s limit', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: Array.from({ length: 200 },
      (_, index) => signUp({ applicationId: `app-${index}`, facilityName: `Facility ${index}` })) })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    await card('Facility 0')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New facility sign-ups (200 or more to review)')
  })

  it('marks one reviewed with a note of 8 to 500 characters and the version listed, then reads the list again', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValueOnce({ items: [signUp()] }).mockResolvedValue({ items: [] })
    mocks.api.reviewSelfServiceFacility.mockResolvedValueOnce({ applicationId: signUp().applicationId,
      reviewedAt: '2026-10-24T12:00:00.000Z', version: 4 })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    fireEvent.click(within(item).getByText('Mark reviewed', { selector: 'summary' }))
    const note = within(item).getByLabelText('What you checked')
    const save = within(item).getByRole('button', { name: 'Mark reviewed' }) as HTMLButtonElement
    fireEvent.change(note, { target: { value: ' short ' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(note, { target: { value: '  Called the lab; the director confirmed Bola.  ' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(await screen.findByText('Marked IKEJA CARE LIMITED reviewed.')).toBeTruthy()
    expect(mocks.api.reviewSelfServiceFacility).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: signUp().applicationId, version: 3 }), 'Called the lab; the director confirmed Bola.')
    await waitFor(() => expect(mocks.api.selfServiceFacilities).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No new facility sign-ups are waiting for review.')).toBeTruthy()
  })

  it.each([
    ['VERSION_CONFLICT', 'This sign-up changed after the list was loaded. The list has been refreshed: check it again before marking it reviewed.'],
    ['SELF_SERVICE_FACILITY_ALREADY_REVIEWED', 'Another administrator has already reviewed this sign-up. The list has been refreshed.'],
    ['SELF_SERVICE_FACILITY_NOT_FOUND', 'This sign-up is no longer in the list. The list has been refreshed.'],
  ])('reads the list again after %s and says why', async (code, text) => {
    mocks.api.selfServiceFacilities.mockResolvedValueOnce({ items: [signUp()] })
      .mockResolvedValue({ items: [signUp({ version: 4 })] })
    mocks.api.reviewSelfServiceFacility.mockRejectedValueOnce(new HidApiError(code.endsWith('NOT_FOUND') ? 404 : 409,
      'Identity’s own detail', { code }))
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    fireEvent.click(within(item).getByText('Mark reviewed', { selector: 'summary' }))
    fireEvent.change(within(item).getByLabelText('What you checked'), { target: { value: 'Called the lab; confirmed.' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Mark reviewed' }))
    await waitFor(() => expect(mocks.api.selfServiceFacilities).toHaveBeenCalledTimes(2))
    // Said once, by the page, whether or not the card is replaced.
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([text]))
    // The card is the new version's: a second review sends version 4.
    mocks.api.reviewSelfServiceFacility.mockResolvedValueOnce({ applicationId: signUp().applicationId, reviewedAt: '2026-10-24T12:00:00.000Z', version: 5 })
    const again = await card('IKEJA CARE LIMITED')
    fireEvent.click(within(again).getByText('Mark reviewed', { selector: 'summary' }))
    fireEvent.change(within(again).getByLabelText('What you checked'), { target: { value: 'Checked again; confirmed.' } })
    fireEvent.click(within(again).getByRole('button', { name: 'Mark reviewed' }))
    await waitFor(() => expect(mocks.api.reviewSelfServiceFacility).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 4 }), 'Checked again; confirmed.'))
  })

  it.each([['SELF_SERVICE_FACILITY_REQUEST_INVALID'], ['VALIDATION_FAILED']])('keeps any other refusal (%s) on the card, without reading the list again', async code => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [signUp()] })
    mocks.api.reviewSelfServiceFacility.mockRejectedValueOnce(new HidApiError(400, 'Bad request', { code }))
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    fireEvent.click(within(item).getByText('Mark reviewed', { selector: 'summary' }))
    fireEvent.change(within(item).getByLabelText('What you checked'), { target: { value: 'Called the lab; confirmed.' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Mark reviewed' }))
    expect((await within(item).findByRole('alert')).textContent).toBe('Enter a note of 8 to 500 characters about what you checked.')
    expect(mocks.api.selfServiceFacilities).toHaveBeenCalledTimes(1)
  })

  it('links to the facility page to suspend it, and to Users & roles with the email searched, never in the address', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [signUp()] })
    mocks.api.principals.mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    expect(within(item).getByText(/^If it looks wrong,/).textContent).toBe('If it looks wrong, suspend the facility on its facility page '
      + 'and disable the administrator’s account in Users & roles.')
    expect(within(item).getByRole('link', { name: 'facility page' }).getAttribute('href')).toBe(`/admin/facilities/${FACILITY_ID}`)
    fireEvent.click(within(item).getByRole('link', { name: 'Users & roles' }))
    await waitFor(() => expect(mocks.api.principals).toHaveBeenCalledWith('bola@ikejacare.example', { page: 1 }, expect.anything()))
    expect(screen.getByTestId('location').textContent).toBe('/admin/principals')
    expect((screen.getByLabelText('Search users') as HTMLInputElement).value).toBe('bola@ikejacare.example')
  })

  it('hides Mark reviewed without platform.facility.manage, and each link without its page’s permission', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [signUp()] })
    open(<SelfServiceFacilitiesPage actor={actor(['platform.admin.access', 'platform.identity-review.read'])} />)
    const item = await card('IKEJA CARE LIMITED')
    expect(within(item).queryByText('Mark reviewed')).toBeNull()
    expect(within(item).getByText('View only: reviewing or releasing a sign-up needs the platform.facility.manage permission.')).toBeTruthy()
    expect(within(item).queryByRole('link')).toBeNull()
    expect(mocks.api.reviewSelfServiceFacility).not.toHaveBeenCalled()
  })

  it('says so when this Identity has no list of new sign-ups', async () => {
    mocks.api.selfServiceFacilities.mockRejectedValue(new HidApiError(404, 'New facility sign-ups are not available from this Identity.',
      { code: 'SELF_SERVICE_REVIEW_UNAVAILABLE' }))
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    expect((await screen.findByRole('alert')).textContent).toContain('This Identity does not list new facility sign-ups yet '
      + '(facility self sign-up is not deployed), so there is nothing to review here.')
  })
})

/**
 * Releasing a fraudulent or mistaken sign-up (P4 round 2, R2): Identity requires every facility of the organization
 * suspended and the administrator's account disabled first, then frees the CAC number and the legal name.
 */
describe('releasing a sign-up', () => {
  const stopped = (overrides: Partial<SelfServiceFacility> = {}) => signUp({ facilityLifecycleStatus: 'suspended',
    administratorAccountStatus: 'disabled', ...overrides })
  const releaseSummary = (item: HTMLElement) => within(item).queryByText('Release this sign-up', { selector: 'summary' })

  async function fillRelease(item: HTMLElement, reason = 'The company confirmed by phone it did not sign up.') {
    fireEvent.click(releaseSummary(item)!)
    fireEvent.change(within(item).getByLabelText('Reason for releasing'), { target: { value: `  ${reason}  ` } })
    fireEvent.click(within(item).getByLabelText('I understand that releasing can’t be undone.'))
  }

  it.each([
    ['the facility is still verified and the account active', signUp(), null],
    ['only the facility is suspended', signUp({ facilityLifecycleStatus: 'suspended' }),
      'To release this sign-up for the real company, also disable the administrator’s account.'],
    ['only the account is disabled', signUp({ administratorAccountStatus: 'disabled' }),
      'To release this sign-up for the real company, also suspend the facility.'],
    ['the account is locked, not disabled', signUp({ facilityLifecycleStatus: 'suspended', administratorAccountStatus: 'locked' }),
      'To release this sign-up for the real company, also disable the administrator’s account.'],
    ['there is no account', signUp({ facilityLifecycleStatus: 'suspended', administratorAccountStatus: null }),
      'To release this sign-up for the real company, also disable the administrator’s account.'],
  ])('is not offered while %s', async (_, facility, note) => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [facility] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    expect(releaseSummary(item)).toBeNull()
    if (note) expect(within(item).getByText(note)).toBeTruthy()
    else expect(within(item).queryByText(/^To release this sign-up/)).toBeNull()
  })

  it.each([
    ['disabled', 'suspended'],
    ['deleted', 'suspended'],
    ['disabled', 'rejected'],
  ])('is offered once the account is %s and the facility %s, and explains what it does', async (account, lifecycle) => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [stopped({ administratorAccountStatus: account,
      facilityLifecycleStatus: lifecycle })] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    fireEvent.click(releaseSummary(item)!)
    expect(within(item).getByText(/^Releasing frees this CAC number and legal name/).textContent).toBe('Releasing frees this CAC '
      + 'number and legal name, so the real company can sign up. It closes this sign-up, unlinks the CAC number, suspends the '
      + 'product, deactivates and renames the organization, and removes the administrator’s access. It can’t be undone. The '
      + 'administrator’s email stays with the disabled account and can’t be used to sign up again. Unless you let the '
      + 'applicant start again, this sign-up’s email and network can’t sign up this CAC number and product again for 7 days.')
    expect(within(item).queryByText(/^To release this sign-up/)).toBeNull()
  })

  it('needs a reason of 8 to 500 characters and the confirmation, sends the version listed, then reads the list again', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValueOnce({ items: [stopped()] }).mockResolvedValue({ items: [] })
    mocks.api.releaseSelfServiceFacility.mockResolvedValueOnce({ applicationId: signUp().applicationId,
      releasedAt: '2026-10-24T13:00:00.000Z', version: 4 })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    fireEvent.click(releaseSummary(item)!)
    const reason = within(item).getByLabelText('Reason for releasing')
    const release = within(item).getByRole('button', { name: 'Release sign-up' }) as HTMLButtonElement
    const confirm = within(item).getByLabelText('I understand that releasing can’t be undone.')
    fireEvent.change(reason, { target: { value: ' short ' } })
    fireEvent.click(confirm)
    expect(release.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: '  The company confirmed by phone it did not sign up.  ' } })
    expect(release.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(release.disabled).toBe(true)
    fireEvent.click(confirm)
    fireEvent.click(release)
    expect(await screen.findByText('Released IKEJA CARE LIMITED. Its CAC number and legal name are free for the real company '
      + 'to sign up.')).toBeTruthy()
    expect(mocks.api.releaseSelfServiceFacility).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: signUp().applicationId, version: 3 }), 'The company confirmed by phone it did not sign up.',
      false)
    await waitFor(() => expect(mocks.api.selfServiceFacilities).toHaveBeenCalledTimes(2))
  })

  it.each([
    ['VERSION_CONFLICT', 409, 'This sign-up changed after the list was loaded. The list has been refreshed: check it again '
      + 'before releasing it.'],
    ['SELF_SERVICE_FACILITY_ALREADY_RELEASED', 409, 'Another administrator has already released this sign-up. The list has '
      + 'been refreshed.'],
    ['SELF_SERVICE_FACILITY_NOT_FOUND', 404, 'This sign-up is no longer in the list. The list has been refreshed.'],
    ['SELF_SERVICE_FACILITY_RELEASE_REQUIRES_SUSPENSION', 409, 'This sign-up can’t be released while any facility of its '
      + 'organization is active or its administrator’s account isn’t disabled. The list has been refreshed: suspend the '
      + 'facility and disable the account first.'],
  ])('reads the list again after %s and says why', async (code, status, text) => {
    mocks.api.selfServiceFacilities.mockResolvedValueOnce({ items: [stopped()] }).mockResolvedValue({ items: [stopped({ version: 4 })] })
    mocks.api.releaseSelfServiceFacility.mockRejectedValueOnce(new HidApiError(status, 'Identity’s own detail', { code }))
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    await fillRelease(item)
    fireEvent.click(within(item).getByRole('button', { name: 'Release sign-up' }))
    await waitFor(() => expect(mocks.api.selfServiceFacilities).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([text]))
    // The next release sends the new version.
    mocks.api.releaseSelfServiceFacility.mockResolvedValueOnce({ applicationId: signUp().applicationId,
      releasedAt: '2026-10-24T13:00:00.000Z', version: 5 })
    const again = await card('IKEJA CARE LIMITED')
    await fillRelease(again, 'Checked again; the company did not sign up.')
    fireEvent.click(within(again).getByRole('button', { name: 'Release sign-up' }))
    await waitFor(() => expect(mocks.api.releaseSelfServiceFacility).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 4 }), 'Checked again; the company did not sign up.', false))
  })

  it.each([['SELF_SERVICE_FACILITY_REQUEST_INVALID'], ['VALIDATION_FAILED']])('keeps a refused reason (%s) on the card, in its own words', async code => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [stopped()] })
    mocks.api.releaseSelfServiceFacility.mockRejectedValueOnce(new HidApiError(400, 'Bad request', { code }))
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    await fillRelease(item)
    fireEvent.click(within(item).getByRole('button', { name: 'Release sign-up' }))
    expect((await within(item).findByRole('alert')).textContent).toBe('Enter a reason of 8 to 500 characters.')
    expect(mocks.api.selfServiceFacilities).toHaveBeenCalledTimes(1)
  })

  it('is hidden without platform.facility.manage', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [stopped()] })
    open(<SelfServiceFacilitiesPage actor={actor(['platform.admin.access', 'platform.identity-review.read'])} />)
    const item = await card('IKEJA CARE LIMITED')
    expect(releaseSummary(item)).toBeNull()
    expect(within(item).queryByText(/^To release this sign-up/)).toBeNull()
    expect(within(item).getByText('View only: reviewing or releasing a sign-up needs the platform.facility.manage permission.')).toBeTruthy()
  })

  it('shows a released sign-up as released, with its reason, and offers nothing more on it', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [stopped({ releasedAt: '2026-10-24T13:00:00.000Z',
      releasedByAccountId: 'admin-9', releaseReason: 'The company confirmed by phone it did not sign up.' })] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />, '/admin/self-service-facilities?state=all')
    const item = await card('IKEJA CARE LIMITED')
    expect(within(item).getByText('Released', { selector: '.admin-status' })).toBeTruthy()
    expect(within(item).getByText('Released', { selector: 'dt' }).nextElementSibling?.textContent).not.toBe('Not available')
    expect(within(item).getByText('Release reason: The company confirmed by phone it did not sign up.')).toBeTruthy()
    expect(within(item).queryByText('Mark reviewed')).toBeNull()
    expect(releaseSummary(item)).toBeNull()
    expect(within(item).queryByText(/^If it looks wrong/)).toBeNull()
    expect(within(item).queryByText(/^View only/)).toBeNull()
    // A released sign-up is not waiting for review.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New facility sign-ups (0 to review)')
  })

  it('lets the applicant start again at once when asked (allowRetry), and says nothing of it otherwise', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValueOnce({ items: [stopped()] }).mockResolvedValue({ items: [] })
    mocks.api.releaseSelfServiceFacility.mockResolvedValueOnce({ applicationId: signUp().applicationId,
      releasedAt: '2026-10-24T13:00:00.000Z', version: 4 })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    const item = await card('IKEJA CARE LIMITED')
    await fillRelease(item, 'The company’s own sign-up, with a personal email address.')
    const retry = within(item).getByLabelText('Let the applicant start again at once: the sign-up was the company’s own, with '
      + 'the wrong email address.') as HTMLInputElement
    expect(retry.checked).toBe(false)
    fireEvent.click(retry)
    fireEvent.click(within(item).getByRole('button', { name: 'Release sign-up' }))
    expect(await screen.findByText('Released IKEJA CARE LIMITED. Its CAC number and legal name are free for the real company '
      + 'to sign up.')).toBeTruthy()
    expect(mocks.api.releaseSelfServiceFacility).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }),
      'The company’s own sign-up, with a personal email address.', true)
  })

  it('can release a sign-up that was already reviewed', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [stopped({ reviewedAt: '2026-10-24T11:00:00.000Z',
      reviewNote: 'Looked fine at first.' })] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />, '/admin/self-service-facilities?state=reviewed')
    const item = await card('IKEJA CARE LIMITED')
    expect(within(item).queryByText('Mark reviewed')).toBeNull()
    expect(releaseSummary(item)).toBeTruthy()
  })
})

/**
 * Open applications (P4 round 2, R3): self-service sign-ups not activated yet, each holding its CAC number and product
 * for 24 hours; support can reject one that is not the company's own.
 */
describe('open applications', () => {
  const application = (overrides: Partial<SelfServiceApplication> = {}): SelfServiceApplication => ({
    applicationId: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', version: 2, productCode: 'pharmacy', organizationType: 'pharmacy',
    cacHint: 'RC****21', organizationName: 'SURULERE PHARMACY LTD', administratorName: 'Tunde Bello',
    administratorEmail: 'tunde@example.test', status: 'ready_for_review', verificationResult: 'verified', emailVerified: false,
    submittedAt: '2026-10-24T08:00:00.000Z', lapsesAt: '2026-10-25T08:00:00.000Z', ...overrides })

  async function openView(permissions = REVIEWER) {
    open(<SelfServiceFacilitiesPage actor={actor(permissions)} />, '/admin/self-service-facilities?state=open')
  }

  it('is a view of the page, kept in the address, listing what support needs to judge each one', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [] })
    mocks.api.selfServiceApplications.mockResolvedValue({ items: [application(), application({ applicationId: 'app-2',
      organizationName: null, cacHint: 'BN****77', status: 'pending_verification', verificationResult: null })] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
    await screen.findByText('No new facility sign-ups are waiting for review.')
    fireEvent.click(screen.getByRole('button', { name: 'Open applications' }))
    expect(screen.getByTestId('location').textContent).toBe('/admin/self-service-facilities?state=open')
    const item = await card('SURULERE PHARMACY LTD')
    expect(mocks.api.selfServiceApplications).toHaveBeenCalledWith(expect.anything())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('New facility sign-ups')
    expect(screen.queryByRole('region', { name: 'What to check' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Open applications' })).getByText(/^Sign-ups that haven’t been finished yet/)
      .textContent).toBe('Sign-ups that haven’t been finished yet: the administrator hasn’t confirmed their email or chosen a '
        + 'password. Each one holds its CAC number and product for 24 hours after it was submitted, so nobody else can sign up '
        + 'that company meanwhile. The ones holding a CAC number now are listed first.')
    // hid-system R15: a sign-up opened within 7 days of an earlier one closing, from its email or network, holds nothing.
    expect(within(screen.getByRole('region', { name: 'Open applications' })).getByText(/^A sign-up started within 7 days/)
      .textContent).toBe('A sign-up started within 7 days of an earlier sign-up for the same CAC number and product closing, '
        + 'from the same email or network, holds nothing: any other sign-up for that CAC number replaces it.')
    expect(within(screen.getByRole('region', { name: 'Open applications' })).getByText(/^If one isn’t the company’s own/)
      .textContent).toBe('If one isn’t the company’s own, for example because of a mistyped CAC number, reject it so the real '
        + 'company can sign up. Unless you let its applicant start again, its email and network can’t sign up that CAC '
        + 'number and product again for 7 days.')
    // An applicant can't close a sign-up they disowned at the password step: support finds and rejects it.
    expect(within(screen.getByRole('region', { name: 'Open applications' })).getByText(/^A company told that another sign-up/)
      .textContent).toBe('A company told that another sign-up for its CAC number may be in progress may be held by one of these. '
        + 'For example, an applicant who mistyped the number, saw another company’s legal name and selected “This isn’t my '
        + 'organization” leaves that sign-up here, with its email confirmed, until it lapses; they are asked to tell support '
        + 'the number. Find the company’s CAC number below, check the legal name, and reject the one that isn’t the company’s '
        + 'own.')
    const shown = (term: string) => within(item).getByText(term).nextElementSibling?.textContent
    expect(shown('CAC number')).toBe('RC****21')
    expect(shown('Product')).toBe('Pharmacy')
    expect(shown('Administrator')).toBe('Tunde Bellotunde@example.test')
    expect(shown('CAC check')).toBe('Verified')
    expect(shown('Email confirmed')).toBe('Not yet')
    expect(shown('Holds the CAC number until')).not.toBe('Not available')
    expect(within(item).getByText('Not activated')).toBeTruthy()
    const unverified = await card('BN****77 (legal name not verified)')
    expect(within(unverified).getByText('Legal name (CAC)').nextElementSibling?.textContent).toBe('Not verified yet')
    expect(within(unverified).getByText('CAC check').nextElementSibling?.textContent).toBe('Not checked yet')
    expect(mocks.api.rejectSelfServiceApplication).not.toHaveBeenCalled()
  })

  it('rejects one with a reason of 8 to 500 characters and the version listed, saying what that does, then reads the list again', async () => {
    mocks.api.selfServiceApplications.mockResolvedValueOnce({ items: [application()] }).mockResolvedValue({ items: [] })
    mocks.api.rejectSelfServiceApplication.mockResolvedValueOnce({ applicationId: application().applicationId,
      rejectedAt: '2026-10-24T12:00:00.000Z', version: 3 })
    await openView()
    const item = await card('SURULERE PHARMACY LTD')
    fireEvent.click(within(item).getByText('Reject', { selector: 'summary' }))
    expect(within(item).getByText(/^Rejecting closes this sign-up at once/).textContent).toBe('Rejecting closes this sign-up at '
      + 'once: its codes stop working, and the CAC number is free for the real company. Unless you let the applicant start '
      + 'again, this sign-up’s email and network can’t sign up this CAC number and product again for 7 days.')
    expect((within(item).getByLabelText(/^Let the applicant start again at once/) as HTMLInputElement).checked).toBe(false)
    const reason = within(item).getByLabelText('Reason for rejecting')
    const reject = within(item).getByRole('button', { name: 'Reject sign-up' }) as HTMLButtonElement
    fireEvent.change(reason, { target: { value: 'short' } })
    expect(reject.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: ' Not the company’s own: it did not sign up. ' } })
    fireEvent.click(reject)
    expect(await screen.findByText('Rejected the sign-up for SURULERE PHARMACY LTD.')).toBeTruthy()
    expect(mocks.api.rejectSelfServiceApplication).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: application().applicationId, version: 2 }), 'Not the company’s own: it did not sign up.',
      false)
    await waitFor(() => expect(mocks.api.selfServiceApplications).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No sign-ups are waiting to be finished.')).toBeTruthy()
  })

  it.each([
    ['VERSION_CONFLICT', 409, 'This sign-up changed after the list was loaded, for example its administrator confirmed the '
      + 'email. The list has been refreshed: check it again before rejecting it.'],
    ['SELF_SERVICE_APPLICATION_NOT_FOUND', 404, 'This sign-up is no longer open: it was finished, rejected or has lapsed. The '
      + 'list has been refreshed.'],
  ])('reads the list again after %s and says why', async (code, status, text) => {
    mocks.api.selfServiceApplications.mockResolvedValueOnce({ items: [application()] })
      .mockResolvedValue({ items: [application({ version: 3, emailVerified: true })] })
    mocks.api.rejectSelfServiceApplication.mockRejectedValueOnce(new HidApiError(status, 'Identity’s own detail', { code }))
    await openView()
    const item = await card('SURULERE PHARMACY LTD')
    fireEvent.click(within(item).getByText('Reject', { selector: 'summary' }))
    fireEvent.change(within(item).getByLabelText('Reason for rejecting'), { target: { value: 'Not the company’s own.' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Reject sign-up' }))
    await waitFor(() => expect(mocks.api.selfServiceApplications).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([text]))
    mocks.api.rejectSelfServiceApplication.mockResolvedValueOnce({ applicationId: application().applicationId,
      rejectedAt: '2026-10-24T12:00:00.000Z', version: 4 })
    const again = await card('SURULERE PHARMACY LTD')
    expect(within(again).getByText('Email confirmed').nextElementSibling?.textContent).toBe('Yes')
    fireEvent.click(within(again).getByText('Reject', { selector: 'summary' }))
    fireEvent.change(within(again).getByLabelText('Reason for rejecting'), { target: { value: 'Still not the company’s own.' } })
    fireEvent.click(within(again).getByRole('button', { name: 'Reject sign-up' }))
    await waitFor(() => expect(mocks.api.rejectSelfServiceApplication).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 3 }), 'Still not the company’s own.', false))
  })

  it.each([['SELF_SERVICE_FACILITY_REQUEST_INVALID'], ['VALIDATION_FAILED']])('keeps a refused reason (%s) on the card, in its own words', async code => {
    mocks.api.selfServiceApplications.mockResolvedValue({ items: [application()] })
    mocks.api.rejectSelfServiceApplication.mockRejectedValueOnce(new HidApiError(400, 'Bad request', { code }))
    await openView()
    const item = await card('SURULERE PHARMACY LTD')
    fireEvent.click(within(item).getByText('Reject', { selector: 'summary' }))
    fireEvent.change(within(item).getByLabelText('Reason for rejecting'), { target: { value: 'Not the company’s own.' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Reject sign-up' }))
    expect((await within(item).findByRole('alert')).textContent).toBe('Enter a reason of 8 to 500 characters.')
    expect(mocks.api.selfServiceApplications).toHaveBeenCalledTimes(1)
  })

  it('lets the applicant start again at once when asked (allowRetry), and says so', async () => {
    mocks.api.selfServiceApplications.mockResolvedValueOnce({ total: 1, items: [application()] }).mockResolvedValue({ total: 0, items: [] })
    mocks.api.rejectSelfServiceApplication.mockResolvedValueOnce({ applicationId: application().applicationId,
      rejectedAt: '2026-10-24T12:00:00.000Z', version: 3 })
    await openView()
    const item = await card('SURULERE PHARMACY LTD')
    fireEvent.click(within(item).getByText('Reject', { selector: 'summary' }))
    fireEvent.change(within(item).getByLabelText('Reason for rejecting'), { target: { value: 'The applicant mistyped their email.' } })
    fireEvent.click(within(item).getByLabelText('Let the applicant start again at once: the mistake was theirs, for example a '
      + 'mistyped email address.'))
    fireEvent.click(within(item).getByRole('button', { name: 'Reject sign-up' }))
    expect(await screen.findByText('Rejected the sign-up for SURULERE PHARMACY LTD. Its applicant can start again at once.')).toBeTruthy()
    expect(mocks.api.rejectSelfServiceApplication).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }),
      'The applicant mistyped their email.', true)
  })

  it.each([
    ['holds its CAC number now', { holdsCac: true }, 'Holds the CAC number until', null],
    ['comes from an Identity before holdsCac', {}, 'Holds the CAC number until', null],
    ['holds nothing', { holdsCac: false, lapsesAt: '2026-10-24T08:00:00.000Z' }, 'Holds the CAC number',
      'No: its administrator can still finish it, but any other sign-up for this CAC number and product replaces it'],
  ] as const)('says how long a sign-up that %s holds the CAC number', async (_, overrides, term, text) => {
    mocks.api.selfServiceApplications.mockResolvedValue({ total: 1, items: [application(overrides)] })
    await openView()
    const item = await card('SURULERE PHARMACY LTD')
    const shown = within(item).getByText(term, { selector: 'dt' }).nextElementSibling?.textContent
    if (text) expect(shown).toBe(text)
    else expect(shown).not.toMatch(/^(No|Not available)/)
    expect(within(item).queryByText(term === 'Holds the CAC number' ? 'Holds the CAC number until' : 'Holds the CAC number',
      { selector: 'dt' })).toBeNull()
  })

  it('says how many there are when Identity lists 200 of more than 200', async () => {
    mocks.api.selfServiceApplications.mockResolvedValue({ total: 216, items: Array.from({ length: 200 },
      (_, index) => application({ applicationId: `app-${index}`, organizationName: `COMPANY ${index} LTD` })) })
    await openView()
    await card('COMPANY 0 LTD')
    expect(screen.getByText(/^Showing 200 of 216 open sign-ups/).textContent).toBe('Showing 200 of 216 open sign-ups, those '
      + 'holding a CAC number now first. Find a CAC number to see its own.')
  })

  it.each([
    ['all of them', { total: 2 }],
    ['an Identity before the total', {}],
  ] as const)('says nothing of a count when Identity lists %s', async (_, extra) => {
    mocks.api.selfServiceApplications.mockResolvedValue({ ...extra, items: [application(), application({ applicationId: 'app-2',
      organizationName: 'YABA CLINIC LTD' })] })
    await openView()
    await card('YABA CLINIC LTD')
    expect(screen.queryByText(/^Showing/)).toBeNull()
  })

  it('finds a CAC number’s open sign-ups, kept out of the address, and shows all again', async () => {
    mocks.api.selfServiceApplications.mockResolvedValue({ total: 2, items: [application(), application({ applicationId: 'app-2',
      organizationName: 'YABA CLINIC LTD' })] })
    mocks.api.searchSelfServiceApplications.mockResolvedValueOnce({ total: 1, items: [application({ applicationId: 'app-2',
      organizationName: 'YABA CLINIC LTD' })] }).mockResolvedValueOnce({ total: 0, items: [] })
    await openView()
    await card('SURULERE PHARMACY LTD')
    const search = screen.getByRole('search', { name: 'Open sign-ups by CAC number' })
    const input = within(search).getByLabelText('Find a CAC number’s open sign-ups')
    // A number Identity would refuse is not sent.
    fireEvent.change(input, { target: { value: 'RC12' } })
    fireEvent.click(within(search).getByRole('button', { name: 'Search' }))
    expect(within(search).getByRole('alert').textContent).toBe('Enter a CAC registration number: RC, BN or IT followed by 4 to '
      + '20 digits.')
    expect(mocks.api.searchSelfServiceApplications).not.toHaveBeenCalled()
    // Spaces removed and upper case, as Identity takes it.
    fireEvent.change(input, { target: { value: ' rc 1234 567 ' } })
    expect(within(search).queryByRole('alert')).toBeNull()
    fireEvent.click(within(search).getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(mocks.api.searchSelfServiceApplications).toHaveBeenCalledWith('RC1234567', expect.anything()))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'SURULERE PHARMACY LTD', level: 2 })).toBeNull())
    await card('YABA CLINIC LTD')
    expect(screen.getByTestId('location').textContent).toBe('/admin/self-service-facilities?state=open')
    expect((screen.getByLabelText('Find a CAC number’s open sign-ups') as HTMLInputElement).value).toBe('RC1234567')
    // None for another number.
    fireEvent.change(screen.getByLabelText('Find a CAC number’s open sign-ups'), { target: { value: 'BN7654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('No sign-up for BN7654321 is waiting to be finished.')).toBeTruthy()
    // Back to the whole list.
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    await card('SURULERE PHARMACY LTD')
    expect(mocks.api.selfServiceApplications).toHaveBeenCalledTimes(2)
    expect((screen.getByLabelText('Find a CAC number’s open sign-ups') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
  })

  it('reads the search again after a rejection from it', async () => {
    mocks.api.selfServiceApplications.mockResolvedValue({ total: 1, items: [application()] })
    mocks.api.searchSelfServiceApplications.mockResolvedValueOnce({ total: 1, items: [application()] })
      .mockResolvedValue({ total: 0, items: [] })
    mocks.api.rejectSelfServiceApplication.mockResolvedValueOnce({ applicationId: application().applicationId,
      rejectedAt: '2026-10-24T12:00:00.000Z', version: 3 })
    await openView()
    await card('SURULERE PHARMACY LTD')
    fireEvent.change(screen.getByLabelText('Find a CAC number’s open sign-ups'), { target: { value: 'RC1234521' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(mocks.api.searchSelfServiceApplications).toHaveBeenCalledTimes(1))
    const item = await card('SURULERE PHARMACY LTD')
    fireEvent.click(within(item).getByText('Reject', { selector: 'summary' }))
    fireEvent.change(within(item).getByLabelText('Reason for rejecting'), { target: { value: 'Not the company’s own.' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Reject sign-up' }))
    expect(await screen.findByText('No sign-up for RC1234521 is waiting to be finished.')).toBeTruthy()
    expect(mocks.api.searchSelfServiceApplications).toHaveBeenLastCalledWith('RC1234521', expect.anything())
    expect(mocks.api.selfServiceApplications).toHaveBeenCalledTimes(1)
  })

  it('says so when this Identity can’t search by CAC number', async () => {
    mocks.api.selfServiceApplications.mockResolvedValue({ items: [application()] })
    mocks.api.searchSelfServiceApplications.mockRejectedValue(new HidApiError(404, 'Open sign-ups can’t be found by CAC number '
      + 'from this Identity.', { code: 'SELF_SERVICE_APPLICATION_SEARCH_UNAVAILABLE' }))
    await openView()
    await card('SURULERE PHARMACY LTD')
    fireEvent.change(screen.getByLabelText('Find a CAC number’s open sign-ups'), { target: { value: 'RC1234521' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect((await screen.findByRole('alert')).textContent).toContain('This Identity can’t find open sign-ups by CAC number yet. '
      + 'Select “Show all” to see the list.')
  })

  it('leaves the search when another view is chosen', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [] })
    mocks.api.selfServiceApplications.mockResolvedValue({ total: 1, items: [application()] })
    mocks.api.searchSelfServiceApplications.mockResolvedValue({ total: 0, items: [] })
    await openView()
    await card('SURULERE PHARMACY LTD')
    fireEvent.change(screen.getByLabelText('Find a CAC number’s open sign-ups'), { target: { value: 'RC1234521' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('No sign-up for RC1234521 is waiting to be finished.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'To review' }))
    expect(await screen.findByText('No new facility sign-ups are waiting for review.')).toBeTruthy()
    expect(screen.queryByRole('search', { name: 'Open sign-ups by CAC number' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open applications' }))
    await card('SURULERE PHARMACY LTD')
    expect(mocks.api.searchSelfServiceApplications).toHaveBeenCalledTimes(1)
  })

  it('hides Reject without platform.facility.manage', async () => {
    mocks.api.selfServiceApplications.mockResolvedValue({ items: [application()] })
    await openView(['platform.admin.access', 'platform.identity-review.read'])
    const item = await card('SURULERE PHARMACY LTD')
    expect(within(item).queryByText('Reject', { selector: 'summary' })).toBeNull()
    expect(within(item).getByText('View only: rejecting a sign-up needs the platform.facility.manage permission.')).toBeTruthy()
  })

  it('says so when this Identity has no list of open applications', async () => {
    mocks.api.selfServiceApplications.mockRejectedValue(new HidApiError(404, 'Open sign-up applications are not available '
      + 'from this Identity.', { code: 'SELF_SERVICE_APPLICATIONS_UNAVAILABLE' }))
    await openView()
    expect((await screen.findByRole('alert')).textContent).toContain('This Identity does not list open sign-ups yet, so there '
      + 'is nothing to show here.')
  })
})

/**
 * Lifting a 7-day refusal (hid-system R15): a rejection or release refuses the sign-up's email and network for that CAC
 * number and product for 7 days unless support let the applicant start again; support lifts it for the company itself.
 */
describe('lifting a refusal', () => {
  const application = (): SelfServiceApplication => ({
    applicationId: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', version: 2, productCode: 'pharmacy', organizationType: 'pharmacy',
    cacHint: 'RC****21', organizationName: 'SURULERE PHARMACY LTD', administratorName: 'Tunde Bello',
    administratorEmail: 'tunde@example.test', status: 'ready_for_review', verificationResult: 'verified', emailVerified: false,
    submittedAt: '2026-10-24T08:00:00.000Z', lapsesAt: '2026-10-25T08:00:00.000Z', holdsCac: true })
  const waiver = () => screen.getByText('Lift a 7-day refusal', { selector: 'summary' }).closest('details')!

  async function openWaiver(permissions = REVIEWER) {
    mocks.api.selfServiceApplications.mockResolvedValue({ total: 1, items: [application()] })
    open(<SelfServiceFacilitiesPage actor={actor(permissions)} />, '/admin/self-service-facilities?state=open')
    await card('SURULERE PHARMACY LTD')
  }

  function fill(cac: string, product: string, reason: string) {
    fireEvent.click(screen.getByText('Lift a 7-day refusal', { selector: 'summary' }))
    fireEvent.change(within(waiver()).getByLabelText('CAC registration number'), { target: { value: cac } })
    fireEvent.change(within(waiver()).getByLabelText('Product'), { target: { value: product } })
    fireEvent.change(within(waiver()).getByLabelText('Reason for lifting the refusal'), { target: { value: reason } })
  }

  it('says what it does, needs a CAC number, a product and a reason, and sends them as Identity takes them', async () => {
    mocks.api.waiveSelfServiceRefusals.mockResolvedValueOnce({ waived: [{ applicationId: 'app-1',
      waivedAt: '2026-10-25T09:00:00.000Z', version: 4 }] })
    await openWaiver()
    fireEvent.click(screen.getByText('Lift a 7-day refusal', { selector: 'summary' }))
    expect(within(waiver()).getByText(/^Rejecting or releasing a sign-up stops/).textContent).toBe('Rejecting or releasing a '
      + 'sign-up stops its email and network from signing up that CAC number and product again for 7 days, unless you let the '
      + 'applicant start again. If that stops the company itself, for example a colleague on the same office network, lift '
      + 'the refusal here. Every refusal in force for the CAC number and product is lifted. A sign-up started from that email '
      + 'or network within those 7 days holds nothing: any other sign-up for the same CAC number replaces it.')
    const lift = within(waiver()).getByRole('button', { name: 'Lift refusal' }) as HTMLButtonElement
    expect(lift.disabled).toBe(true)
    fill('RC12', 'pharmacy', 'The company’s own administrator, same office.')
    expect(within(waiver()).getByText('Enter a CAC registration number: RC, BN or IT followed by 4 to 20 digits.')).toBeTruthy()
    expect(lift.disabled).toBe(true)
    fireEvent.change(within(waiver()).getByLabelText('CAC registration number'), { target: { value: ' rc 1234 521 ' } })
    expect(lift.disabled).toBe(false)
    fireEvent.change(within(waiver()).getByLabelText('Product'), { target: { value: '' } })
    expect(lift.disabled).toBe(true)
    fireEvent.change(within(waiver()).getByLabelText('Product'), { target: { value: 'pharmacy' } })
    fireEvent.change(within(waiver()).getByLabelText('Reason for lifting the refusal'), { target: { value: 'short' } })
    expect(lift.disabled).toBe(true)
    fireEvent.change(within(waiver()).getByLabelText('Reason for lifting the refusal'),
      { target: { value: '  The company’s own administrator, same office.  ' } })
    fireEvent.click(lift)
    expect(await within(waiver()).findByText('Lifted 1 refusal for RC1234521 (Pharmacy). The company can sign up again now.')).toBeTruthy()
    expect(mocks.api.waiveSelfServiceRefusals).toHaveBeenCalledWith({ cacRegistrationNumber: 'RC1234521', productCode: 'pharmacy',
      reason: 'The company’s own administrator, same office.' })
    expect((within(waiver()).getByLabelText('CAC registration number') as HTMLInputElement).value).toBe('')
  })

  it('counts the refusals lifted', async () => {
    mocks.api.waiveSelfServiceRefusals.mockResolvedValueOnce({ waived: [
      { applicationId: 'app-1', waivedAt: '2026-10-25T09:00:00.000Z', version: 4 },
      { applicationId: 'app-2', waivedAt: '2026-10-25T09:00:00.000Z', version: 6 }] })
    await openWaiver()
    fill('BN7654321', 'ehr', 'Two colleagues were refused after a rejection.')
    fireEvent.click(within(waiver()).getByRole('button', { name: 'Lift refusal' }))
    expect(await within(waiver()).findByText('Lifted 2 refusals for BN7654321 (EHR). The company can sign up again now.')).toBeTruthy()
  })

  it.each([
    ['SELF_SERVICE_REFUSAL_NOT_FOUND', 404, 'No 7-day refusal is in force for this CAC number and product. Check the number and '
      + 'the product.'],
    ['VALIDATION_FAILED', 400, 'Enter a CAC registration number: RC, BN or IT followed by 4 to 20 digits. Choose the product, '
      + 'and give a reason of 8 to 500 characters.'],
    ['PERMISSION_DENIED', 403, 'Lifting a refusal needs the platform.facility.manage permission. Ask a Super Admin.'],
  ])('keeps %s on the form, in its own words', async (code, status, text) => {
    mocks.api.waiveSelfServiceRefusals.mockRejectedValueOnce(new HidApiError(status, 'Identity’s own detail', { code }))
    await openWaiver()
    fill('RC1234521', 'laboratory', 'The company’s own administrator, same office.')
    fireEvent.click(within(waiver()).getByRole('button', { name: 'Lift refusal' }))
    expect((await within(waiver()).findByRole('alert')).textContent).toBe(text)
    expect((within(waiver()).getByLabelText('CAC registration number') as HTMLInputElement).value).toBe('RC1234521')
    expect(mocks.api.selfServiceApplications).toHaveBeenCalledTimes(1)
  })

  it('is not offered without platform.facility.manage, nor outside the open applications', async () => {
    await openWaiver(['platform.admin.access', 'platform.identity-review.read'])
    expect(screen.queryByText('Lift a 7-day refusal')).toBeNull()
    cleanupAndOpenUnreviewed()
    expect(await screen.findByText('No new facility sign-ups are waiting for review.')).toBeTruthy()
    expect(screen.queryByText('Lift a 7-day refusal')).toBeNull()
  })

  function cleanupAndOpenUnreviewed() {
    cleanup()
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [] })
    open(<SelfServiceFacilitiesPage actor={actor(REVIEWER)} />)
  }
})

describe('Users & roles opened without a handed-over search', () => {
  it('searches nothing until asked', async () => {
    render(<MemoryRouter initialEntries={['/admin/principals']}><StepUpProvider><Routes>
      <Route path="/admin/principals" element={<PrincipalsPage actor={actor(REVIEWER)} />} />
    </Routes></StepUpProvider></MemoryRouter>)
    expect(await screen.findByText('Enter at least two characters to search.')).toBeTruthy()
    expect(mocks.api.principals).not.toHaveBeenCalled()
  })
})
