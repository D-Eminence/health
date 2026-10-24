import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, SelfServiceFacility } from '../api'
import { PrincipalsPage } from '../Principals'
import { SelfServiceFacilitiesPage } from '../SelfServiceFacilities'
import { StepUpProvider } from '../StepUp'

/**
 * New facility sign-ups (P4, which only Novu serves): support checks every facility that signed itself up within a
 * working day, marks it reviewed with a note (version-checked), and suspends the facility or disables its
 * administrator through the Facilities and Users & roles pages when it looks wrong.
 */
const mocks = vi.hoisted(() => ({
  api: { selfServiceFacilities: vi.fn(), reviewSelfServiceFacility: vi.fn(), principals: vi.fn(), stepUp: vi.fn() },
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
  })

  it.each([
    ['Reviewed', 'reviewed'],
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
    expect(within(item).getByText('View only: marking a sign-up reviewed needs the platform.facility.manage permission.')).toBeTruthy()
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

describe('Users & roles opened without a handed-over search', () => {
  it('searches nothing until asked', async () => {
    render(<MemoryRouter initialEntries={['/admin/principals']}><StepUpProvider><Routes>
      <Route path="/admin/principals" element={<PrincipalsPage actor={actor(REVIEWER)} />} />
    </Routes></StepUpProvider></MemoryRouter>)
    expect(await screen.findByText('Enter at least two characters to search.')).toBeTruthy()
    expect(mocks.api.principals).not.toHaveBeenCalled()
  })
})
