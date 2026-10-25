import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    selfServiceApplications: vi.fn(), rejectSelfServiceApplication: vi.fn(), principals: vi.fn(), stepUp: vi.fn() },
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

  it('keeps any other refusal on the card, without reading the list again', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [signUp()] })
    mocks.api.reviewSelfServiceFacility.mockRejectedValueOnce(new HidApiError(400, 'Bad request', { code: 'SELF_SERVICE_FACILITY_REQUEST_INVALID' }))
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
      + 'administrator’s email stays with the disabled account and can’t be used to sign up again.')
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
      expect.objectContaining({ applicationId: signUp().applicationId, version: 3 }), 'The company confirmed by phone it did not sign up.')
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
      expect.objectContaining({ version: 4 }), 'Checked again; the company did not sign up.'))
  })

  it('keeps a refused reason on the card, in its own words', async () => {
    mocks.api.selfServiceFacilities.mockResolvedValue({ items: [stopped()] })
    mocks.api.releaseSelfServiceFacility.mockRejectedValueOnce(new HidApiError(400, 'Bad request',
      { code: 'SELF_SERVICE_FACILITY_REQUEST_INVALID' }))
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
        + 'that company meanwhile.')
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
      + 'once: its codes stop working, and the CAC number is free for the real company. This sign-up’s email and network can’t '
      + 'sign up this CAC number and product again for 7 days.')
    const reason = within(item).getByLabelText('Reason for rejecting')
    const reject = within(item).getByRole('button', { name: 'Reject sign-up' }) as HTMLButtonElement
    fireEvent.change(reason, { target: { value: 'short' } })
    expect(reject.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: ' Not the company’s own: it did not sign up. ' } })
    fireEvent.click(reject)
    expect(await screen.findByText('Rejected the sign-up for SURULERE PHARMACY LTD.')).toBeTruthy()
    expect(mocks.api.rejectSelfServiceApplication).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: application().applicationId, version: 2 }), 'Not the company’s own: it did not sign up.')
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
      expect.objectContaining({ version: 3 }), 'Still not the company’s own.'))
  })

  it('keeps a refused reason on the card, in its own words', async () => {
    mocks.api.selfServiceApplications.mockResolvedValue({ items: [application()] })
    mocks.api.rejectSelfServiceApplication.mockRejectedValueOnce(new HidApiError(400, 'Bad request',
      { code: 'SELF_SERVICE_FACILITY_REQUEST_INVALID' }))
    await openView()
    const item = await card('SURULERE PHARMACY LTD')
    fireEvent.click(within(item).getByText('Reject', { selector: 'summary' }))
    fireEvent.change(within(item).getByLabelText('Reason for rejecting'), { target: { value: 'Not the company’s own.' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Reject sign-up' }))
    expect((await within(item).findByRole('alert')).textContent).toBe('Enter a reason of 8 to 500 characters.')
    expect(mocks.api.selfServiceApplications).toHaveBeenCalledTimes(1)
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

describe('Users & roles opened without a handed-over search', () => {
  it('searches nothing until asked', async () => {
    render(<MemoryRouter initialEntries={['/admin/principals']}><StepUpProvider><Routes>
      <Route path="/admin/principals" element={<PrincipalsPage actor={actor(REVIEWER)} />} />
    </Routes></StepUpProvider></MemoryRouter>)
    expect(await screen.findByText('Enter at least two characters to search.')).toBeTruthy()
    expect(mocks.api.principals).not.toHaveBeenCalled()
  })
})
