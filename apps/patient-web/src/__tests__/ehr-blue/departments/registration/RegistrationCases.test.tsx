import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { PatientRegistration } from '../../../../ehr-blue/departments/registration/Registration'

/*
 * SX-10 in the blue Patient registration: "My registrations" for the desk (GET identity/registration-cases?view=mine)
 * and "All registrations" for approvers (view=facility), with "NIN Verified" / "NIN Not Verified", the filters, "Load
 * more" while a next page is sent, every refusal in plain words, and a row opening its registration (GET :caseId).
 * Every person, case and facility here is fictional: Patient One, Patient Two, HID-ZDEMAAA2, Demo Hospital.
 */

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return { useStaff: () => staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital', roles: ['receptionist'] })) }
})

const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), listRegistrationCases: vi.fn(), registrationCase: vi.fn(), resolveNin: vi.fn(),
  approveNewRegistration: vi.fn(), linkExistingRegistration: vi.fn(), enrollRegistration: vi.fn(),
}))
// Every staff API member the page reaches for that these tests do not provide.
const unprovided = vi.hoisted(() => new Set<string>())
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, {
    get(target, property) {
      if (typeof property === 'string' && !(property in target)) unprovided.add(property)
      return Reflect.get(target, property)
    },
  }),
}))

const WRITE = 'identity.registration.write'
const APPROVE = 'identity.registration.approve'
const CASE = 'c0000000-0000-4000-8000-000000000001'
const OTHER_CASE = 'c0000000-0000-4000-8000-000000000002'
const THIRD_CASE = 'c0000000-0000-4000-8000-000000000003'
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENABLED = { nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true }

const ONE = {
  caseId: CASE, status: 'approved_new_identity', version: 2, candidateCount: 0, contactRecorded: true, ninStatus: 'verified',
  identityEvidence: 'nin', patient: { patientId: PATIENT, hid: 'HID-ZDEMAAA2' }, fullName: 'Patient One', dateOfBirth: '1990-01-02',
  createdAt: '2026-11-20T09:15:00.000Z', updatedAt: '2026-11-21T10:30:00.000Z', createdByMe: true,
}
const TWO = {
  caseId: OTHER_CASE, status: 'review_required', version: 1, candidateCount: 1, contactRecorded: false, ninStatus: 'not_verified',
  identityEvidence: 'none', fullName: 'Patient Two', dateOfBirth: '2019-05-06', createdAt: '2026-11-19T08:00:00.000Z',
  updatedAt: '2026-11-19T08:00:00.000Z', createdByMe: false,
}
const THREE = {
  caseId: THIRD_CASE, status: 'pending_new_identity_approval', version: 1, candidateCount: 0, contactRecorded: true,
  ninStatus: 'verified', identityEvidence: 'nin', fullName: 'Patient Three', dateOfBirth: null, createdAt: '2026-11-18T08:00:00.000Z',
  updatedAt: '2026-11-18T08:00:00.000Z', createdByMe: true,
}
const page = (cases: readonly object[], nextCursor: string | null = null, view: 'mine' | 'facility' = 'mine') => ({ view, cases, nextCursor })
/** The case as GET :caseId reads it: the list item without its name, dates or starter. */
const detail = ({ fullName: _n, dateOfBirth: _d, createdAt: _c, updatedAt: _u, createdByMe: _m, contactRecorded: _r, ...item }: typeof ONE | typeof TWO | typeof THREE) => item

let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.resetAllMocks()
  unprovided.clear()
  session.permissions = [WRITE]
  api.registrationCapabilities.mockResolvedValue(ENABLED)
  api.listRegistrationCases.mockResolvedValue(page([ONE, TWO]))
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  expect([...unprovided]).toEqual([])
  // Nothing of the list is kept in the browser.
  expect(setItem).not.toHaveBeenCalled()
  setItem.mockRestore()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const table = (name = 'My registrations') => screen.findByRole('region', { name })
const rowOf = (region: HTMLElement, name: string) => within(region).getByRole('button', { name }).closest('tr') as HTMLElement
const listSection = () => screen.getByRole('heading', { level: 2, name: /^(My registrations|Registrations)$/ }).closest('section') as HTMLElement
/** Nothing internal on the screen: no case or patient id, no code, no permission, no dash, never "unverified". */
function expectPlainScreen() {
  const text = document.body.textContent ?? ''
  for (const id of [CASE, OTHER_CASE, THIRD_CASE, PATIENT]) expect(text).not.toContain(id)
  expect(text).not.toMatch(/permission|membership|view=|REGISTRATION_|VALIDATION_FAILED|_DENIED|unverified/i)
  expect(text).not.toMatch(/[–—]/)
}

describe('My registrations', () => {
  it('lists the desk’s own registrations, newest first as sent, in plain words, with no choice of all registrations', async () => {
    renderDept(<PatientRegistration />)
    expect(screen.getByText('Loading registrations…').getAttribute('role')).toBe('status')
    const region = await table()
    expect(api.listRegistrationCases).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, { view: 'mine' })
    expect(screen.getByRole('heading', { level: 2, name: 'My registrations' })).toBeTruthy()
    const rows = within(region).getAllByRole('row').slice(1)
    expect(rows.map(row => within(row).getAllByRole('button')[0]?.textContent)).toEqual(['Patient One', 'Patient Two'])
    const one = rowOf(region, 'Patient One')
    expect(within(one).getByText('Born 2 Jan 1990')).toBeTruthy()
    expect(within(one).getByText('HID-ZDEMAAA2')).toBeTruthy()
    expect(within(one).getByText('NIN Verified')).toBeTruthy()
    expect(within(one).getByText('New Health ID')).toBeTruthy()
    expect(within(one).getByText(/^\d{1,2} Nov 2026, \d{2}:\d{2}$/)).toBeTruthy()
    const two = rowOf(region, 'Patient Two')
    expect(within(two).getByText('No Health ID yet')).toBeTruthy()
    expect(within(two).getByText('NIN Not Verified')).toBeTruthy()
    expect(within(two).getByText('Possible match')).toBeTruthy()
    // Every row here is the member's own: nothing more is said of who started it.
    expect(within(region).queryByText(/Started by you/)).toBeNull()
    // A member who does not approve registrations is offered neither all of them nor the NIN filter.
    expect(screen.queryByRole('button', { name: 'All registrations' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'NIN' })).toBeNull()
    expectPlainScreen()
  })

  it('says when there are none yet', async () => {
    api.listRegistrationCases.mockResolvedValue(page([]))
    renderDept(<PatientRegistration />)
    expect(await screen.findByText('No registrations yet')).toBeTruthy()
    expect(screen.getByText('Patients you register at this facility are listed here.')).toBeTruthy()
  })

  it('filters by status, reading the first page of what is chosen, and says when nothing matches', async () => {
    renderDept(<PatientRegistration />)
    await table()
    api.listRegistrationCases.mockResolvedValueOnce(page([]))
    const status = screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement
    expect([...status.options].map(option => option.textContent)).toEqual(['All statuses', 'Needs approval', 'Possible match',
      'New Health ID', 'Linked', 'Already on Health ID', 'Rejected', 'Cancelled'])
    fireEvent.change(status, { target: { value: 'pending_new_identity_approval' } })
    expect(await screen.findByText('No matching registrations')).toBeTruthy()
    expect(screen.getByText('Change the filters to see more registrations.')).toBeTruthy()
    expect(api.listRegistrationCases).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { view: 'mine', status: 'pending_new_identity_approval' })
  })

  it('reads nothing, the list included, without identity registration write', () => {
    session.permissions = [APPROVE]
    renderDept(<PatientRegistration />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('You can’t register patients here')
    expect(api.listRegistrationCases).not.toHaveBeenCalled()
  })
})

describe('All registrations', () => {
  beforeEach(() => { session.permissions = [WRITE, APPROVE] })

  it('is offered to an approver: every registration at the facility, "Started by you" on their own and nobody else named', async () => {
    renderDept(<PatientRegistration />)
    await table()
    expect(screen.getByRole('heading', { level: 2, name: 'Registrations' })).toBeTruthy()
    const mine = screen.getByRole('button', { name: 'My registrations' })
    const all = screen.getByRole('button', { name: 'All registrations' })
    expect(mine.getAttribute('aria-pressed')).toBe('true')
    api.listRegistrationCases.mockResolvedValue(page([ONE, TWO], null, 'facility'))
    fireEvent.click(all)
    const region = await table('All registrations')
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(api.listRegistrationCases).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { view: 'facility' })
    expect(within(rowOf(region, 'Patient One')).getByText('Born 2 Jan 1990 · Started by you')).toBeTruthy()
    expect(within(rowOf(region, 'Patient Two')).getByText('Born 6 May 2019')).toBeTruthy()
    expect(within(region).getAllByText(/Started by you/)).toHaveLength(1)
    expectPlainScreen()
    // Back to the member's own.
    api.listRegistrationCases.mockResolvedValue(page([ONE]))
    fireEvent.click(mine)
    await table()
    expect(api.listRegistrationCases).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { view: 'mine' })
  })

  it('says when the facility has none yet', async () => {
    renderDept(<PatientRegistration />)
    await table()
    api.listRegistrationCases.mockResolvedValue(page([], null, 'facility'))
    fireEvent.click(screen.getByRole('button', { name: 'All registrations' }))
    expect(await screen.findByText('Patients registered at this facility are listed here.')).toBeTruthy()
    expect(screen.getByText('No registrations yet')).toBeTruthy()
  })

  it('filters registrations without a NIN, with the status', async () => {
    renderDept(<PatientRegistration />)
    await table()
    fireEvent.click(screen.getByRole('button', { name: 'All registrations' }))
    await table('All registrations')
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'review_required' } })
    const evidence = screen.getByRole('combobox', { name: 'NIN' }) as HTMLSelectElement
    expect([...evidence.options].map(option => option.textContent))
      .toEqual(['With or without a NIN', 'Registered without a NIN', 'Registered with a NIN'])
    fireEvent.change(evidence, { target: { value: 'none' } })
    await waitFor(() => expect(api.listRegistrationCases).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID,
      { view: 'facility', status: 'review_required', evidence: 'none' }))
  })

  it('goes back to the member’s own registrations when Identity refuses all of them, and offers them no more', async () => {
    renderDept(<PatientRegistration />)
    await table()
    api.listRegistrationCases.mockRejectedValueOnce(new HidApiError(403, 'Only staff who approve registrations can see every case at this facility.',
      { code: 'REGISTRATION_CASE_LIST_DENIED' }))
    fireEvent.click(screen.getByRole('button', { name: 'All registrations' }))
    expect(await screen.findByText('Only staff who approve registrations can see every registration at this facility. Showing your registrations instead.'))
      .toBeTruthy()
    await table()
    expect(api.listRegistrationCases).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { view: 'mine' })
    expect(screen.queryByRole('button', { name: 'All registrations' })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'My registrations' })).toBeTruthy()
    expectPlainScreen()
  })

  it('shows only the answer for the list chosen last', async () => {
    const first = deferred<unknown>()
    api.listRegistrationCases.mockReturnValueOnce(first.promise)
    renderDept(<PatientRegistration />)
    api.listRegistrationCases.mockResolvedValueOnce(page([TWO], null, 'facility'))
    fireEvent.click(await screen.findByRole('button', { name: 'All registrations' }))
    const region = await table('All registrations')
    await act(async () => { first.resolve(page([ONE])) })
    expect(within(region).queryByRole('button', { name: 'Patient One' })).toBeNull()
    expect(within(region).getByRole('button', { name: 'Patient Two' })).toBeTruthy()
  })
})

describe('Load more', () => {
  it('adds the next page under the rows while Identity sends one, then goes', async () => {
    api.listRegistrationCases.mockResolvedValueOnce(page([ONE], 'next-page_2')).mockResolvedValueOnce(page([TWO]))
    renderDept(<PatientRegistration />)
    await table()
    const more = screen.getByRole('button', { name: 'Load more' })
    more.focus()
    fireEvent.click(more)
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Load more|^Loading/ })).toBeNull())
    expect(api.listRegistrationCases).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { view: 'mine', cursor: 'next-page_2' })
    const rows = within(await table()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    // The button is gone, so focus goes to the line that says every one is shown.
    const end = within(listSection()).getByText('Every registration in this list is shown.')
    await waitFor(() => expect(document.activeElement).toBe(end))
  })

  it('keeps the rows read when a page fails, and tries again', async () => {
    api.listRegistrationCases.mockResolvedValueOnce(page([ONE], 'next-page_2')).mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(page([TWO], 'next-page_3'))
    renderDept(<PatientRegistration />)
    await table()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect((await screen.findByText('We couldn’t load more registrations. Try again.')).getAttribute('role')).toBe('alert')
    expect(within(await table()).getAllByRole('row').slice(1)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'My registrations' })).getAllByRole('row').slice(1)).toHaveLength(2))
    expect(screen.queryByText('We couldn’t load more registrations. Try again.')).toBeNull()
    expect(within(listSection()).getByText('More registrations added below.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy()
  })

  it('starts again from the top when Identity did not issue the page link, and says so in plain words', async () => {
    api.listRegistrationCases.mockResolvedValueOnce(page([ONE], 'next-page_2'))
      .mockRejectedValueOnce(new HidApiError(400, 'This page link is not valid. Start again from the first page.', { code: 'REGISTRATION_CASE_CURSOR_INVALID' }))
      .mockResolvedValueOnce(page([ONE, TWO]))
    renderDept(<PatientRegistration />)
    await table()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('This list changed, so it was loaded again from the top.')).toBeTruthy()
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'My registrations' })).getAllByRole('row').slice(1)).toHaveLength(2))
    expect(api.listRegistrationCases.mock.calls.map(call => call[1])).toEqual([{ view: 'mine' }, { view: 'mine', cursor: 'next-page_2' }, { view: 'mine' }])
    expect(document.activeElement).toBe(screen.getByText('This list changed, so it was loaded again from the top.').closest('.hid-ehr-dept-notice'))
    expect(screen.queryByText('Every registration in this list is shown.')).toBeNull()
    expectPlainScreen()
  })

  it('goes back to the member’s own registrations when Identity refuses a later page of all of them', async () => {
    session.permissions = [WRITE, APPROVE]
    renderDept(<PatientRegistration />)
    await table()
    const denied = new HidApiError(403, 'Only staff who approve registrations can see every case at this facility.', { code: 'REGISTRATION_CASE_LIST_DENIED' })
    api.listRegistrationCases.mockResolvedValueOnce(page([ONE], 'next-page_2', 'facility'))
      .mockResolvedValueOnce(page([TWO], 'next-page_2', 'facility')).mockRejectedValueOnce(denied).mockResolvedValueOnce(page([ONE]))
    fireEvent.click(screen.getByRole('button', { name: 'All registrations' }))
    await table('All registrations')
    fireEvent.change(screen.getByRole('combobox', { name: 'NIN' }), { target: { value: 'none' } })
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'All registrations' })).getByRole('button', { name: 'Patient Two' })).toBeTruthy())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Only staff who approve registrations can see every registration at this facility. Showing your registrations instead.'))
      .toBeTruthy()
    expect(api.listRegistrationCases).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, { view: 'facility', evidence: 'none', cursor: 'next-page_2' })
    await table()
    // Their own, without the filter only approvers are offered.
    expect(api.listRegistrationCases).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { view: 'mine' })
    expect(screen.queryByRole('button', { name: 'All registrations' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'NIN' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expectPlainScreen()
  })
})

describe('a list that can’t be read', () => {
  const NO_ACCESS = 'You can’t see the registrations at this facility. Ask your facility administrator if you need to.'
  const FAILED = 'We couldn’t load registrations. Try again.'
  it.each([
    ['VALIDATION_FAILED', 400, FAILED],
    ['PURPOSE_OF_USE_REQUIRED', 400, FAILED],
    ['FACILITY_REQUIRED', 400, FAILED],
    ['AUTHENTICATION_REQUIRED', 401, 'Your session has ended. Please sign in again.'],
    ['FACILITY_ACCESS_DENIED', 403, NO_ACCESS],
    ['PATIENT_SCOPE_DENIED', 403, NO_ACCESS],
    ['NO_ACTIVE_FACILITY_MEMBERSHIP', 403, NO_ACCESS],
    ['PERMISSION_DENIED', 403, NO_ACCESS],
    ['INTERNAL_ERROR', 500, 'Health ID isn’t available right now. Please try again in a few minutes.'],
    ['NETWORK_ERROR', 0, 'We couldn’t reach Health ID. Check your connection and try again.'],
  ])('%s: says so in plain words, never the code, and tries again', async (code, status, words) => {
    api.listRegistrationCases.mockRejectedValueOnce(new HidApiError(status, 'Identity said something technical.', { code }))
    renderDept(<PatientRegistration />)
    expect(await screen.findByText(words)).toBeTruthy()
    expect(screen.getByText(words).closest('[role="alert"]')).toBeTruthy()
    expect(document.body.textContent).not.toContain(code)
    expect(document.body.textContent).not.toContain('Identity said something technical.')
    expectPlainScreen()
    fireEvent.click(within(listSection()).getByRole('button', { name: 'Try again' }))
    expect(await table()).toBeTruthy()
    expect(screen.queryByText(words)).toBeNull()
  })

  it('an answer in another shape: its own words', async () => {
    api.listRegistrationCases.mockRejectedValueOnce(new Error('The registration list answered in a shape this page does not read.'))
    renderDept(<PatientRegistration />)
    expect(await screen.findByText(FAILED)).toBeTruthy()
    expect(screen.queryByText(/shape/)).toBeNull()
  })
})

describe('opening a registration from the list', () => {
  it('reads it by GET :caseId and opens it by the list’s name; Back returns to the same row, list and pages', async () => {
    api.listRegistrationCases.mockResolvedValueOnce(page([ONE], 'next-page_2')).mockResolvedValueOnce(page([TWO]))
    api.registrationCase.mockResolvedValue(detail(TWO))
    renderDept(<PatientRegistration />)
    await table()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    const region = await screen.findByRole('region', { name: 'My registrations' })
    await waitFor(() => expect(within(region).getAllByRole('row').slice(1)).toHaveLength(2))
    fireEvent.click(within(rowOf(region, 'Patient Two')).getByRole('button', { name: /^Open/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Patient Two' })).toBeTruthy()
    expect(api.registrationCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, OTHER_CASE)
    // When it was started, as the list says.
    const facts = within(screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement)
    expect(facts.getByText('Started').nextElementSibling?.textContent).toMatch(/^19 Nov 2026, \d{2}:\d{2}$/)
    expect(facts.getByText('NIN').nextElementSibling?.textContent).toBe('NIN Not Verified')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const back = await table()
    expect(within(back).getAllByRole('row').slice(1)).toHaveLength(2)
    expect(document.activeElement).toBe(within(back).getByRole('button', { name: 'Patient Two' }))
    // Not read again, and not listed twice.
    expect(api.listRegistrationCases).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('region', { name: 'Opened on this visit' })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Registration ID' }) as HTMLInputElement).value).toBe('')
  })

  it('says a row could not be opened in plain words, and stays on the list', async () => {
    api.registrationCase.mockRejectedValueOnce(new Error('lost'))
    renderDept(<PatientRegistration />)
    const region = await table()
    fireEvent.click(within(region).getByRole('button', { name: 'Patient One' }))
    expect(await within(listSection()).findByText('We couldn’t open that registration.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Patient registration')
    // Said no more once another filter is chosen.
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'rejected' } })
    await waitFor(() => expect(screen.queryByText('We couldn’t open that registration.')).toBeNull())
  })

  it('a decision made there is shown on its row', async () => {
    session.permissions = [WRITE, APPROVE]
    api.listRegistrationCases.mockResolvedValue(page([THREE]))
    api.registrationCase.mockResolvedValue(detail(THREE))
    api.approveNewRegistration.mockResolvedValue({ caseId: THIRD_CASE, status: 'approved_new_identity', version: 2, candidateCount: 0,
      patient: { patientId: PATIENT, hid: 'HID-ZDEMAAA2' } })
    renderDept(<PatientRegistration />)
    const region = await table()
    expect(within(rowOf(region, 'Patient Three')).getByText('Date of birth not given')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: 'Patient Three' }))
    await screen.findByRole('heading', { level: 1, name: 'Registration for Patient Three' })
    const actions = screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
    fireEvent.click(within(actions).getByRole('button', { name: 'Create Health ID' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why (for the record)' }), { target: { value: 'Checked at the desk.' } })
    fireEvent.click(within(screen.getByRole('form', { name: 'Create Health ID' })).getByRole('button', { name: 'Create Health ID' }))
    await waitFor(() => expect(document.getElementById('registration-status')?.textContent).toBe('New Health ID created.'))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const row = rowOf(await table(), 'Patient Three')
    expect(within(row).getByText('New Health ID')).toBeTruthy()
    expect(within(row).getByText('HID-ZDEMAAA2')).toBeTruthy()
    expect(api.listRegistrationCases).toHaveBeenCalledTimes(1)
  })

  it('a registration without a NIN this approver started waits for another approver, as the list says', async () => {
    session.permissions = [WRITE, APPROVE]
    const mine = { ...TWO, createdByMe: true }
    api.listRegistrationCases.mockResolvedValue(page([mine]))
    api.registrationCase.mockResolvedValue({ ...detail(mine), candidates: [] })
    renderDept(<PatientRegistration />)
    fireEvent.click(within(await table()).getByRole('button', { name: 'Patient Two' }))
    await screen.findByRole('heading', { level: 1, name: 'Registration for Patient Two' })
    expect(screen.getByText('Sent for review. This may be someone who is already registered. An approver at this facility, other than the person who started it, will decide.'))
      .toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Give a new Health ID' })).toBeNull()
  })

  it('another member’s registration without a NIN is the approver’s to decide', async () => {
    session.permissions = [WRITE, APPROVE]
    api.listRegistrationCases.mockResolvedValue(page([TWO]))
    api.registrationCase.mockResolvedValue({ ...detail(TWO), candidates: [] })
    renderDept(<PatientRegistration />)
    fireEvent.click(within(await table()).getByRole('button', { name: 'Patient Two' }))
    await screen.findByRole('heading', { level: 1, name: 'Registration for Patient Two' })
    expect(screen.getByRole('button', { name: 'Give a new Health ID' })).toBeTruthy()
  })
})

describe('a registration started here', () => {
  it('is read into the list again, so it is listed there once, not as one opened on this visit', async () => {
    api.listRegistrationCases.mockResolvedValueOnce(page([TWO])).mockResolvedValueOnce(page([ONE, TWO]))
    api.resolveNin.mockResolvedValueOnce(detail(ONE))
    api.registrationCase.mockResolvedValue(detail(ONE))
    renderDept(<PatientRegistration />)
    await table()
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    fireEvent.input(await screen.findByLabelText(/^NIN \(11 digits\)/), { target: { value: '00000000000' } })
    fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: 'Patient' } })
    fireEvent.input(screen.getByLabelText(/^Last name/), { target: { value: 'One' } })
    fireEvent.input(screen.getByLabelText(/^Date of birth/), { target: { value: '1990-01-02' } })
    fireEvent.input(screen.getByLabelText(/^Phone/), { target: { value: '0803 123 4567' } })
    fireEvent.input(screen.getByLabelText(/^Address/), { target: { value: '3 Example Street' } })
    fireEvent.input(screen.getByLabelText(/^City or town/), { target: { value: 'Ikeja' } })
    fireEvent.change(screen.getByLabelText(/^State/), { target: { value: 'LA' } })
    fireEvent.input(screen.getByLabelText(/^Local government area/), { target: { value: 'Ikeja' } })
    fireEvent.change(screen.getByLabelText(/^Does the patient already have a Health ID/), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })
    await waitFor(() => expect(api.listRegistrationCases).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const region = await table()
    expect(within(region).getAllByRole('row').slice(1)).toHaveLength(2)
    expect(document.activeElement).toBe(within(region).getByRole('button', { name: 'Patient One' }))
    expect(screen.queryByRole('region', { name: 'Opened on this visit' })).toBeNull()
  })
})
