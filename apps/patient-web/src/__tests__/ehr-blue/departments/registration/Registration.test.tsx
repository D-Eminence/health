import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { HidApiError } from '@hid/http'
import { MemoryRouter } from 'react-router-dom'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { PatientRegistration } from '../../../../ehr-blue/departments/registration/Registration'
import { SAID_CHANGED, SAID_NOT_FOUND, SAID_REFUSED } from '../../../said'

/*
 * The blue Patient registration page: the design's patients workspace (list, "New patients" form, saved record with
 * Available actions) on today's page, staff/routes/Registration.tsx, its requests, keys, checks and words
 * (staff/routes/Registration.test.tsx, __tests__/RegistrationOutreachFocus, RefreshFocus and FieldProblemsPerForm).
 * Every person, case and number here is fictional: Patient One, NIN 00000000000, example.test.
 */

const session = vi.hoisted(() => ({ permissions: [] as string[], facility: 'hospital' as 'hospital' | 'other' | 'none' }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => staffContext(session.facility === 'none' ? undefined : fakeFacility(session.permissions, {
      id: session.facility === 'other' ? '98d00002-0000-4000-8000-000000000004' : hospital, name: 'Demo Hospital', roles: ['records_officer'],
    })),
  }
})

const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), registrationCase: vi.fn(), resolveNin: vi.fn(), linkExistingRegistration: vi.fn(),
  approveNewRegistration: vi.fn(), enrollRegistration: vi.fn(),
}))
// Every staff API member the page reaches for that today's page does not use.
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
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const NIN = '00000000000'

const ENABLED = { nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true }
const DEFERRED = { nin: { enabled: false, state: 'deferred' }, newPatientRegistrationRequiresNin: true }
const pending = (caseId = CASE, version = 1) => ({ caseId, status: 'pending_new_identity_approval', version, candidateCount: 0 })
const review = { caseId: CASE, status: 'review_required', version: 3, candidateCount: 1,
  candidates: [{ patientId: PATIENT, fullName: 'Patient One', dateOfBirth: '1990-01-02' }] }
const linked = { caseId: CASE, status: 'linked_existing', version: 4, candidateCount: 1, patient: { patientId: PATIENT, hid: 'HID-ZDEMAAA2' } }
const approved = { caseId: CASE, status: 'approved_new_identity', version: 2, candidateCount: 0, patient: { patientId: PATIENT, hid: 'HID-ZDEMAAA2' } }

let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  unprovided.clear()
  session.permissions = [WRITE, APPROVE]
  session.facility = 'hospital'
  api.registrationCapabilities.mockResolvedValue(ENABLED)
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  // Nothing beyond today's registration requests is reached for, and nothing is kept in the browser.
  expect([...unprovided]).toEqual([])
  expect(setItem).not.toHaveBeenCalled()
  expect(document.cookie).toBe('')
  setItem.mockRestore()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const heading = () => screen.getByRole('heading', { level: 1 })
const status = () => {
  const region = document.getElementById('registration-status')
  if (!region) throw new Error('The status region is mounted throughout.')
  expect(region.getAttribute('role')).toBe('status')
  return region
}
function described(control: Element) {
  return (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}
function expectRefused(control: Element, message: string) {
  expect(control.getAttribute('aria-invalid')).toBe('true')
  expect(described(control)).toBe(message)
}

async function openNew() {
  renderDept(<PatientRegistration />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create record' }))
  return screen.findByLabelText(/^National Identity Number/) as Promise<HTMLInputElement>
}
function fillNin({ nin = NIN, first = 'Patient', last = 'One', dob = '1990-01-02' } = {}) {
  fireEvent.input(screen.getByLabelText(/^National Identity Number/), { target: { value: nin } })
  fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: first } })
  fireEvent.input(screen.getByLabelText(/^Last name/), { target: { value: last } })
  fireEvent.input(screen.getByLabelText(/^Date of birth/), { target: { value: dob } })
}
async function findCase(caseId = CASE) {
  renderDept(<PatientRegistration />)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: caseId } })
  fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
  return screen.findByRole('heading', { level: 1, name: `Case ${caseId}` })
}
const actions = () => screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
const savedRecord = () => screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement

describe('who can open Patient registration', () => {
  it.each([
    ['without identity registration write', 'hospital' as const, [APPROVE]],
    ['without a facility', 'none' as const, [WRITE, APPROVE]],
  ])('%s: today\'s refusal, and nothing is read', (_name, facility, permissions) => {
    session.facility = facility
    session.permissions = permissions
    renderDept(<PatientRegistration />)
    expect(heading().textContent).toBe('Registration unavailable')
    expect(screen.getByText('This facility membership needs identity registration write permission.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(api.registrationCapabilities).not.toHaveBeenCalled()
  })
})

describe('the list view', () => {
  it('has the design\'s heading with Create record, today\'s words under it, and the availability as a notice', async () => {
    renderDept(<PatientRegistration />)
    expect(heading().textContent).toBe('Patient registration')
    expect(screen.getByText('Identity operations')).toBeTruthy()
    expect(screen.getByText('Verify a NIN, review possible matches, and link the verified identity to a governed Health ID. Every step is tied to your active facility and recorded by the backend.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
    expect(screen.getByText('Verification availability')).toBeTruthy()
    expect(screen.getByText('Checking the backend’s registration capability…')).toBeTruthy()
    expect(await screen.findByText('NIN verification is enabled in test-only mode.')).toBeTruthy()
    expect(api.registrationCapabilities).toHaveBeenCalledWith(DEMO_HOSPITAL_ID)
    expect(screen.getByRole('heading', { name: 'Find registration case' })).toBeTruthy()
    expect(screen.getByText('Use the case ID supplied when verification completed. The backend does not provide a searchable case list.')).toBeTruthy()
    expect(screen.getByText('No registration cases opened yet')).toBeTruthy()
    expect(screen.getByText('Cases you load or create here are listed until you leave this page.')).toBeTruthy()
  })

  it('says verification is off in today\'s words', async () => {
    api.registrationCapabilities.mockResolvedValue(DEFERRED)
    renderDept(<PatientRegistration />)
    expect(await screen.findByText('NIN verification is deferred. New cases cannot be started here until the backend enables a verification provider.')).toBeTruthy()
  })

  it.each([
    ['a refusal, in plain words', new HidApiError(403, 'This membership cannot verify identities.', { code: 'FORBIDDEN' }), SAID_REFUSED],
    ['anything else, in today\'s fallback', new Error('network down'), 'Registration capabilities could not be loaded.'],
  ])('a capability read that fails: %s', async (_name, failure, words) => {
    api.registrationCapabilities.mockRejectedValue(failure)
    renderDept(<PatientRegistration />)
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(document.body.textContent).not.toContain(failure.message)
  })

  it('Check again reads once, stays focusable while it reads, and keeps focus', async () => {
    renderDept(<PatientRegistration />)
    await screen.findByText('NIN verification is enabled in test-only mode.')
    const reading = deferred<unknown>()
    api.registrationCapabilities.mockReturnValueOnce(reading.promise)
    const button = screen.getByRole('button', { name: 'Check again' })
    await press(button)
    expect(api.registrationCapabilities).toHaveBeenCalledTimes(2)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.textContent).toBe('Checking…')
    expect(document.activeElement).toBe(button)
    await act(async () => { fireEvent.click(button) })
    expect(api.registrationCapabilities).toHaveBeenCalledTimes(2)
    await act(async () => { reading.resolve(DEFERRED) })
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull())
    expect(document.activeElement).toBe(button)
    expect(screen.getByText(/NIN verification is deferred/)).toBeTruthy()
  })
})

describe('the new record form', () => {
  it('opens on its heading with today\'s live fields and the design\'s others shown, disabled, not collected', async () => {
    const nin = await openNew()
    expect(heading().textContent).toBe('New patient registration')
    expect(document.activeElement).toBe(heading())
    expect(screen.getByRole('heading', { name: 'Start with verified identity' })).toBeTruthy()
    expect(nin.type).toBe('password')
    expect(nin.name).toBe('nin')
    expect(nin.maxLength).toBe(11)
    expect(nin.getAttribute('autocomplete')).toBe('off')
    for (const [label, name] of [[/^First name/, 'firstName'], [/^Last name/, 'lastName'], [/^Date of birth/, 'dateOfBirth']] as const) {
      expect((screen.getByLabelText(label) as HTMLInputElement).name).toBe(name)
    }
    const gender = screen.getByRole('combobox', { name: 'Gender (optional)' }) as HTMLSelectElement
    expect([...gender.options].map(option => [option.value, option.textContent]))
      .toEqual([['', 'Not supplied'], ['female', 'Female'], ['male', 'Male'], ['intersex', 'Intersex'], ['other', 'Other'], ['unknown', 'Unknown']])
    for (const label of ['Phone', 'Address', 'Recorded allergies', 'Existing Health ID (optional)', 'Provisional local identity']) {
      const control = screen.getByLabelText(label) as HTMLInputElement
      expect(control.disabled).toBe(true)
      expect(control.getAttribute('name')).toBeNull()
      expect(described(control)).toBe('Not collected by Health ID yet')
    }
    expect(screen.getByText('Enter the NIN and matching demographic claims. The NIN is sent directly to the identity service and is cleared from this form after a successful response.')).toBeTruthy()
    const distinct = screen.getByRole('button', { name: 'Register reviewed duplicate as distinct person' }) as HTMLButtonElement
    expect(distinct.disabled).toBe(true)
    expect(described(distinct)).toBe('This API does not support overriding the match review to create a new identity.')
    expect(screen.getByRole('button', { name: 'Verify and create case' })).toBeTruthy()
  })

  it('without NIN verification enabled, says so in today\'s words and sends nothing', async () => {
    api.registrationCapabilities.mockResolvedValue(DEFERRED)
    const nin = await openNew()
    expect(screen.getByText('NIN verification is deferred. New cases cannot be started here until the backend enables a verification provider.')).toBeTruthy()
    // The whole fieldset is disabled, so none of it can be used or sent.
    expect(nin.matches(':disabled')).toBe(true)
    expect(screen.getByLabelText(/^First name/).matches(':disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Verify and create case' }).matches(':disabled')).toBe(true)
    fireEvent.submit(nin.closest('form')!)
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('while the capability is read, shows the design\'s skeleton saying so', async () => {
    api.registrationCapabilities.mockReturnValue(new Promise(() => {}))
    renderDept(<PatientRegistration />)
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(screen.getAllByText('Checking the backend’s registration capability…').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/^National Identity Number/)).toBeNull()
  })

  it('refuses every field at once in today\'s words, focus on the first, and sends nothing', async () => {
    const nin = await openNew()
    fireEvent.input(nin, { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expectRefused(nin, 'Enter the 11 digit NIN.'))
    for (const label of [/^First name/, /^Last name/, /^Date of birth/]) expectRefused(screen.getByLabelText(label), 'Enter the patient’s name and date of birth.')
    expect(document.activeElement).toBe(nin)
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('puts focus on the first refused field in the form\'s order: the date of birth, beside the NIN, before the names', async () => {
    await openNew()
    fillNin({ first: '', dob: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    const dob = screen.getByLabelText(/^Date of birth/)
    await waitFor(() => expectRefused(dob, 'Enter the patient’s name and date of birth.'))
    expectRefused(screen.getByLabelText(/^First name/), 'Enter the patient’s name and date of birth.')
    expect(screen.getByLabelText(/^National Identity Number/).getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByLabelText(/^Last name/).getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(dob)
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('opens afresh: a form left refused is not shown refused when it is opened again, empty', async () => {
    const nin = await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expectRefused(nin, 'Enter the 11 digit NIN.'))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    const again = await screen.findByLabelText(/^National Identity Number/)
    expect(again.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByText('Enter the 11 digit NIN.')).toBeNull()
    expect(screen.queryByText('Enter the patient’s name and date of birth.')).toBeNull()
  })

  it('after a failed capability read, Check again keeps focus while it reads, and the form takes focus to its heading', async () => {
    api.registrationCapabilities.mockRejectedValueOnce(new Error('network down'))
    renderDept(<PatientRegistration />)
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Registration capabilities could not be loaded.')
    const reading = deferred<unknown>()
    api.registrationCapabilities.mockReturnValueOnce(reading.promise)
    const button = screen.getByRole('button', { name: 'Check again' })
    await press(button)
    expect(button.isConnected).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.textContent).toBe('Checking…')
    expect(document.activeElement).toBe(button)
    expect(screen.getByText('Checking the backend’s registration capability…')).toBeTruthy()
    await act(async () => { reading.resolve(ENABLED) })
    const nin = await screen.findByLabelText(/^National Identity Number/)
    expect(nin.matches(':disabled')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Start with verified identity' }))
  })

  it('refused from Enter in the field itself, says so as an alert there', async () => {
    const nin = await openNew()
    fillNin({ nin: '1234567890' })
    nin.focus()
    fireEvent.submit(nin.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the 11 digit NIN.')
    expect(document.activeElement).toBe(nin)
  })

  it('sends today\'s request, keeps its key for an unchanged retry, clears the NIN and opens the case made', async () => {
    api.resolveNin.mockRejectedValueOnce(new Error('request failed')).mockResolvedValueOnce(pending())
    api.registrationCase.mockResolvedValue(pending())
    const nin = await openNew()
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    expect(await screen.findByText('NIN verification could not be completed.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [first, second] = api.resolveNin.mock.calls
    expect(first?.[0]).toBe(DEMO_HOSPITAL_ID)
    expect(first?.[1]).toEqual({ nin: NIN, firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02' })
    expect(first?.[2]).toBeTruthy()
    expect(second?.[2]).toBe(first?.[2])
    expect(nin.value).toBe('')
    expect(await screen.findByRole('heading', { level: 1, name: `Case ${CASE}` })).toBeTruthy()
    expect(api.registrationCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, CASE)
    expect(status().textContent).toBe('NIN verification created a governed registration case. Review its status before continuing.')
    expect(document.activeElement).toBe(heading())
    // The NIN is in no field on the page now.
    expect([...document.querySelectorAll('input')].map(input => input.value)).not.toContain(NIN)
  })

  it('gives a changed form a new key, and sends the gender when one is chosen', async () => {
    api.resolveNin.mockRejectedValueOnce(new HidApiError(422, 'The identity claims did not match.', { code: 'NIN_MISMATCH' }))
      .mockResolvedValueOnce(pending())
    api.registrationCase.mockResolvedValue(pending())
    await openNew()
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    expect(await screen.findByText('The details don’t match the NIN record. Check the name and date of birth, then try again.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/identity claims|NIN_MISMATCH/)
    fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: 'Patient A' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Gender (optional)' }), { target: { value: 'female' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [first, second] = api.resolveNin.mock.calls
    expect(second?.[1]).toEqual({ nin: NIN, firstName: 'Patient A', lastName: 'One', dateOfBirth: '1990-01-02', gender: 'female' })
    expect(second?.[2]).not.toBe(first?.[2])
  })

  it('keeps its button focusable while verifying, and the form read-only and its way back unavailable', async () => {
    const verifying = deferred<unknown>()
    api.resolveNin.mockReturnValueOnce(verifying.promise)
    api.registrationCase.mockResolvedValue(pending())
    const nin = await openNew()
    fillNin()
    status()
    const button = screen.getByRole('button', { name: 'Verify and create case' })
    await press(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.textContent).toBe('Verifying…')
    expect(document.activeElement).toBe(button)
    expect(nin.readOnly).toBe(true)
    await act(async () => { fireEvent.click(button) })
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(heading().textContent).toBe('New patient registration')
    expect(api.resolveNin).toHaveBeenCalledTimes(1)
    await act(async () => { verifying.resolve(pending()) })
    await waitFor(() => expect(status().textContent).toBe('NIN verification created a governed registration case. Review its status before continuing.'))
  })

  it('a case made whose details cannot be read: today\'s words, and its ID ready to load', async () => {
    api.resolveNin.mockResolvedValueOnce(pending())
    api.registrationCase.mockRejectedValueOnce(new Error('timeout'))
    await openNew()
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(status().textContent).toBe('Case created. Reload its details before reviewing it.'))
    const field = screen.getByRole('textbox', { name: 'Registration case ID' }) as HTMLInputElement
    expect(heading().textContent).toBe('Patient registration')
    expect(field.value).toBe(CASE)
    expect(document.activeElement).toBe(field)
  })
})

describe('Find registration case', () => {
  it('refuses an ID that is not a case ID, at its field, and sends nothing', async () => {
    renderDept(<PatientRegistration />)
    const field = await screen.findByRole('textbox', { name: 'Registration case ID' })
    fireEvent.change(field, { target: { value: 'not-a-case' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    await waitFor(() => expectRefused(field, 'Enter a valid registration case ID.'))
    expect(document.activeElement).toBe(field)
    expect(api.registrationCase).not.toHaveBeenCalled()
  })

  it.each([
    ['a refusal, in plain words', new HidApiError(404, 'Registration case not found.', { code: 'NOT_FOUND' }), SAID_NOT_FOUND],
    ['anything else, in today\'s fallback', new Error('network down'), 'The registration case could not be loaded.'],
  ])('a load that fails: %s, at the card', async (_name, failure, words) => {
    api.registrationCase.mockRejectedValue(failure)
    renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: `  ${CASE} ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(document.body.textContent).not.toContain(failure.message)
    expect(api.registrationCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, CASE)
    expect(heading().textContent).toBe('Patient registration')
  })

  it('a case found after the user went on to Create record is listed, not opened over the form', async () => {
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    expect(screen.getByRole('button', { name: 'Loading…' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    const first = await screen.findByLabelText(/^First name/) as HTMLInputElement
    fireEvent.input(first, { target: { value: 'Patient' } })
    first.focus()
    await act(async () => { reading.resolve(approved) })
    expect(heading().textContent).toBe('New patient registration')
    expect(first.isConnected).toBe(true)
    expect(first.value).toBe('Patient')
    expect(document.activeElement).toBe(first)
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const table = await screen.findByRole('region', { name: 'Registration cases' })
    expect(within(table).getByText(CASE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Load case' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('a load refused after the user went on is not said on the list shown since', async () => {
    const reading = deferred<unknown>()
    // The find left behind, then the details of the case verification made, which cannot be read.
    api.registrationCase.mockReturnValueOnce(reading.promise).mockRejectedValueOnce(new Error('timeout'))
    api.resolveNin.mockResolvedValueOnce(pending(OTHER_CASE))
    renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    await screen.findByLabelText(/^National Identity Number/)
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(status().textContent).toBe('Case created. Reload its details before reviewing it.'))
    expect(heading().textContent).toBe('Patient registration')
    await act(async () => { reading.reject(new Error('network down')) })
    expect(screen.queryByText('The registration case could not be loaded.')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Registration case ID' }) as HTMLInputElement).value).toBe(OTHER_CASE)
  })

  it('opens the case loaded, and lists each case found this visit, in memory', async () => {
    api.registrationCase.mockResolvedValueOnce(pending()).mockResolvedValueOnce(approved).mockResolvedValueOnce(pending(OTHER_CASE, 5))
    const title = await findCase()
    expect(document.activeElement).toBe(title)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current case' }))
    await waitFor(() => expect(screen.getAllByText('New patient approved').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const table = await screen.findByRole('region', { name: 'Registration cases' })
    const open = within(table).getByRole('button', { name: 'Case c0000000' })
    expect(document.activeElement).toBe(open)
    const row = open.closest('tr') as HTMLElement
    expect(within(row).getByText(CASE)).toBeTruthy()
    expect(within(row).getByText('Health ID: HID-ZDEMAAA2')).toBeTruthy()
    expect(within(row).getByText('New patient approved')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Registration case ID' }), { target: { value: OTHER_CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    await screen.findByRole('heading', { level: 1, name: `Case ${OTHER_CASE}` })
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const rows = within(await screen.findByRole('region', { name: 'Registration cases' })).getAllByRole('row').slice(1)
    expect(rows.map(item => item.querySelector('.hid-ehr-dept-reference')?.textContent)).toEqual([OTHER_CASE, CASE])
    expect(within(rows[0]!).getByText('No possible existing patients reported.')).toBeTruthy()
    // Opened from the list, a case is shown as it was last read: nothing is read again.
    fireEvent.click(within(rows[1]!).getByRole('button', { name: /^Open/ }))
    expect(await screen.findByRole('heading', { level: 1, name: `Case ${CASE}` })).toBeTruthy()
    expect(api.registrationCase).toHaveBeenCalledTimes(3)
  })
})

describe('the case record', () => {
  it('shows the case as the design\'s saved record, in today\'s words', async () => {
    api.registrationCase.mockResolvedValue({ ...review, candidateCount: 2, candidates: [...review.candidates,
      { patientId: 'a0000000-0000-4000-8000-000000000002', fullName: 'Patient Two', dateOfBirth: null }] })
    await findCase()
    const facts = within(savedRecord())
    expect(facts.getByText('Case ID').nextElementSibling?.textContent).toBe(CASE)
    expect(facts.getByText('Status').nextElementSibling?.textContent).toBe('Possible existing patient review')
    expect(facts.getByText('Version').nextElementSibling?.textContent).toBe('3')
    expect(facts.getByText('Candidates').nextElementSibling?.textContent).toBe('2 possible existing patients.')
    expect(facts.queryByText('Health ID')).toBeNull()
    expect(facts.getByText('Patient One')).toBeTruthy()
    expect(facts.getByText(`Date of birth: 1990-01-02 · Patient ID: ${PATIENT}`)).toBeTruthy()
    expect(facts.getByText('Date of birth: Not provided · Patient ID: a0000000-0000-4000-8000-000000000002')).toBeTruthy()
    expect(screen.getByText('A possible existing patient was found. Only a listed candidate may be linked. This API does not support overriding the match review to create a new identity.')).toBeTruthy()
    expect(screen.getByText('Version 3')).toBeTruthy()
    const correct = within(actions()).getByRole('button', { name: 'Correct demographics' }) as HTMLButtonElement
    expect(correct.disabled).toBe(true)
    expect(described(correct)).toBe('Health ID does not take demographic corrections on a registration case yet.')
  })

  it.each([
    ['pending_new_identity_approval', 'Awaiting new patient approval'],
    ['review_required', 'Possible existing patient review'],
    ['resolved_existing_identity', 'Verified existing patient'],
    ['linked_existing', 'Linked to existing patient'],
    ['approved_new_identity', 'New patient approved'],
    ['rejected', 'Rejected'],
    ['cancelled', 'Cancelled'],
  ])('says %s as "%s"', async (state, words) => {
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: state, version: 1, candidateCount: 0 })
    await findCase()
    expect(within(savedRecord()).getByText('Status').nextElementSibling?.textContent).toBe(words)
  })

  it('says when a case to review has no candidate details, and offers no link', async () => {
    api.registrationCase.mockResolvedValue({ ...review, candidates: [] })
    await findCase()
    expect(screen.getByText('Candidate details are unavailable. Refresh this case before reviewing it.')).toBeTruthy()
    expect(within(actions()).queryByRole('button', { name: 'Link selected patient' })).toBeNull()
    expect(within(actions()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
  })

  it.each([
    ['a case to review', review],
    ['a case awaiting approval', pending()],
    ['a completed case', approved],
  ])('without the approve permission, offers no decision or enrollment on %s', async (_name, item) => {
    session.permissions = [WRITE]
    api.registrationCase.mockResolvedValue(item)
    await findCase()
    for (const name of ['Link selected patient', 'Approve new Health ID', 'Enroll patient account']) {
      expect(within(actions()).queryByRole('button', { name })).toBeNull()
    }
    expect(within(actions()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
  })

  it.each([
    ['rejected', 'Rejected'],
    ['cancelled', 'Cancelled'],
  ])('offers no decision or enrollment on a %s case', async (state) => {
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: state, version: 2, candidateCount: 0 })
    await findCase()
    expect(within(actions()).queryByRole('button', { name: 'Enroll patient account' })).toBeNull()
    expect(within(actions()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
  })

  it('draws the chosen action\'s form under all of its action buttons, as the design does', async () => {
    api.registrationCase.mockResolvedValue(approved)
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Enroll patient account' }))
    const form = screen.getByRole('form', { name: 'Enroll patient account' })
    const correct = within(actions()).getByRole('button', { name: 'Correct demographics' })
    expect(correct.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(actions()).getByRole('button', { name: 'Enroll patient account' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('a changed review gets a new key; a review reason of 7 characters is refused and one of 8 is sent', async () => {
    api.registrationCase.mockResolvedValue(pending(CASE, 1))
    api.approveNewRegistration.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(approved)
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Approve new Health ID' }))
    const reason = screen.getByRole('textbox', { name: 'Approval reason' })
    const submit = within(screen.getByRole('form', { name: 'Approve new Health ID' })).getByRole('button', { name: 'Approve new Health ID' })
    fireEvent.change(reason, { target: { value: '1234567' } })
    fireEvent.click(submit)
    await waitFor(() => expectRefused(reason, 'Enter a review reason between 8 and 500 characters.'))
    expect(api.approveNewRegistration).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: '12345678' } })
    fireEvent.click(submit)
    expect((await screen.findByRole('alert')).textContent).toBe('The case review could not be completed. Refresh the case before changing its decision.')
    fireEvent.change(reason, { target: { value: 'x'.repeat(500) } })
    await press(submit)
    await waitFor(() => expect(api.approveNewRegistration).toHaveBeenCalledTimes(2))
    const [first, second] = api.approveNewRegistration.mock.calls
    expect(first?.[2]).toBe('12345678')
    expect(second?.[2]).toBe('x'.repeat(500))
    expect(second?.[3]).not.toBe(first?.[3])
  })

  it('links only a listed candidate, with the case version and a key kept for an unchanged retry', async () => {
    api.registrationCase.mockResolvedValue(review)
    api.linkExistingRegistration.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(linked)
    await findCase()
    expect(screen.queryByRole('combobox', { name: 'Candidate to link' })).toBeNull()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Link selected patient' }))
    const candidate = screen.getByRole('combobox', { name: 'Candidate to link' })
    expect(within(candidate).getAllByRole('option').map(option => option.textContent)).toEqual(['Select a candidate', 'Patient One · 1990-01-02'])
    const reason = screen.getByRole('textbox', { name: 'Review reason' })
    fireEvent.click(within(screen.getByRole('form', { name: 'Link selected patient' })).getByRole('button', { name: 'Link selected patient' }))
    await waitFor(() => expectRefused(candidate, 'Select a candidate returned by this registration case.'))
    expectRefused(reason, 'Enter a review reason between 8 and 500 characters.')
    expect(api.linkExistingRegistration).not.toHaveBeenCalled()

    fireEvent.change(candidate, { target: { value: PATIENT } })
    fireEvent.change(reason, { target: { value: 'Identity match reviewed with patient' } })
    const submit = within(screen.getByRole('form', { name: 'Link selected patient' })).getByRole('button', { name: 'Link selected patient' })
    fireEvent.click(submit)
    expect((await screen.findByRole('alert')).textContent).toBe('The case review could not be completed. Refresh the case before changing its decision.')
    await press(submit)
    await waitFor(() => expect(api.linkExistingRegistration).toHaveBeenCalledTimes(2))
    const [first, second] = api.linkExistingRegistration.mock.calls
    expect(first?.slice(0, 4)).toEqual([DEMO_HOSPITAL_ID, expect.objectContaining({ caseId: CASE, version: 3 }), PATIENT, 'Identity match reviewed with patient'])
    expect(second?.[4]).toBe(first?.[4])
    await waitFor(() => expect(status().textContent).toBe('The verified identity was linked to the selected patient.'))
    // The form went with the decision: focus is on the case.
    expect(document.activeElement).toBe(heading())
    expect(screen.queryByRole('combobox', { name: 'Candidate to link' })).toBeNull()
    expect(within(savedRecord()).getByText('Health ID').nextElementSibling?.textContent).toBe('HID-ZDEMAAA2')
    expect(api.approveNewRegistration).not.toHaveBeenCalled()
  })

  it('approves a new Health ID with a reason of 8 to 500 characters', async () => {
    api.registrationCase.mockResolvedValue(pending(CASE, 1))
    api.approveNewRegistration.mockResolvedValue(approved)
    await findCase()
    expect(screen.getByText('Verification found no candidate. An authorized reviewer may approve a new Health ID.')).toBeTruthy()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Approve new Health ID' }))
    const reason = screen.getByRole('textbox', { name: 'Approval reason' })
    fireEvent.change(reason, { target: { value: 'short' } })
    reason.focus()
    fireEvent.submit(reason.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a review reason between 8 and 500 characters.')
    fireEvent.change(reason, { target: { value: 'x'.repeat(501) } })
    fireEvent.submit(reason.closest('form')!)
    await waitFor(() => expect(api.approveNewRegistration).not.toHaveBeenCalled())
    fireEvent.change(reason, { target: { value: '  No candidate after verification  ' } })
    await press(within(screen.getByRole('form', { name: 'Approve new Health ID' })).getByRole('button', { name: 'Approve new Health ID' }))
    await waitFor(() => expect(api.approveNewRegistration).toHaveBeenCalledWith(DEMO_HOSPITAL_ID,
      expect.objectContaining({ caseId: CASE, version: 1 }), 'No candidate after verification', expect.any(String)))
    await waitFor(() => expect(status().textContent).toBe('A new Health ID was approved.'))
    expect(document.activeElement).toBe(heading())
  })

  it('a decision refused in plain words, never Identity\'s', async () => {
    api.registrationCase.mockResolvedValue(pending())
    api.approveNewRegistration.mockRejectedValue(new HidApiError(409, 'The case changed. Refresh it.', { code: 'VERSION_CONFLICT' }))
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Approve new Health ID' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Approval reason' }), { target: { value: 'No candidate after verification' } })
    fireEvent.click(within(screen.getByRole('form', { name: 'Approve new Health ID' })).getByRole('button', { name: 'Approve new Health ID' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain('The case changed. Refresh it.')
    expect(screen.getByRole('form', { name: 'Approve new Health ID' }).contains(alert)).toBe(true)
  })

  it('enrolls a patient account for a completed case, in today\'s words, with its own key', async () => {
    api.registrationCase.mockResolvedValue(approved)
    api.enrollRegistration.mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ patientId: PATIENT, hid: 'HID-ZDEMAAA2', contactVerificationRequired: true, replayed: false })
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Enroll patient account' }))
    expect(screen.getByText('This creates a pending account for a patient who does not already have one. The email must belong to the patient; contact verification and password setup follow separately.')).toBeTruthy()
    const email = screen.getByRole('textbox', { name: 'Patient email' })
    const reason = screen.getByRole('textbox', { name: 'Enrollment reason' })
    const submit = within(screen.getByRole('form', { name: 'Enroll patient account' })).getByRole('button', { name: 'Create pending patient account' })
    fireEvent.change(email, { target: { value: 'not an email' } })
    fireEvent.change(reason, { target: { value: 'Patient asked for an account' } })
    fireEvent.click(submit)
    await waitFor(() => expectRefused(email, 'Enter a valid email and an enrollment reason between 8 and 500 characters.'))
    expect(api.enrollRegistration).not.toHaveBeenCalled()
    fireEvent.change(email, { target: { value: ' Patient.One@Example.TEST ' } })
    fireEvent.click(submit)
    expect((await screen.findByRole('alert')).textContent).toBe('Account enrollment could not be completed. The patient may already have an account.')
    await press(submit)
    await waitFor(() => expect(api.enrollRegistration).toHaveBeenCalledTimes(2))
    const [first, second] = api.enrollRegistration.mock.calls
    expect(first?.slice(0, 4)).toEqual([DEMO_HOSPITAL_ID, expect.objectContaining({ caseId: CASE, version: 2 }), 'patient.one@example.test', 'Patient asked for an account'])
    expect(second?.[4]).toBe(first?.[4])
    expect(await screen.findByText('Pending account created for HID-ZDEMAAA2. Contact verification is required.')).toBeTruthy()
    expect(status().textContent).toBe('A pending patient account was created. Contact ownership and password setup still require verification.')
    expect(document.activeElement).toBe(heading())
    expect(within(actions()).queryByRole('button', { name: 'Enroll patient account' })).toBeNull()
  })

  it('refuses an enrollment without an email, or with a reason under 8 characters, at its field, and a changed email gets a new key', async () => {
    api.registrationCase.mockResolvedValue(approved)
    api.enrollRegistration.mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ patientId: PATIENT, hid: 'HID-ZDEMAAA2', contactVerificationRequired: true, replayed: false })
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Enroll patient account' }))
    const email = screen.getByRole('textbox', { name: 'Patient email' })
    const reason = screen.getByRole('textbox', { name: 'Enrollment reason' })
    const submit = within(screen.getByRole('form', { name: 'Enroll patient account' })).getByRole('button', { name: 'Create pending patient account' })
    fireEvent.change(reason, { target: { value: 'Patient asked for an account' } })
    fireEvent.click(submit)
    await waitFor(() => expectRefused(email, 'Enter a valid email and an enrollment reason between 8 and 500 characters.'))
    expect(reason.getAttribute('aria-invalid')).toBeNull()
    fireEvent.change(email, { target: { value: 'patient.one@example.test' } })
    fireEvent.change(reason, { target: { value: '1234567' } })
    fireEvent.click(submit)
    await waitFor(() => expectRefused(reason, 'Enter a valid email and an enrollment reason between 8 and 500 characters.'))
    expect(email.getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(reason)
    expect(api.enrollRegistration).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: 'Patient asked for an account' } })
    fireEvent.click(submit)
    expect((await screen.findByRole('alert')).textContent).toBe('Account enrollment could not be completed. The patient may already have an account.')
    fireEvent.change(email, { target: { value: 'patient.two@example.test' } })
    await press(submit)
    await waitFor(() => expect(api.enrollRegistration).toHaveBeenCalledTimes(2))
    const [first, second] = api.enrollRegistration.mock.calls
    expect(second?.[2]).toBe('patient.two@example.test')
    expect(second?.[4]).not.toBe(first?.[4])
  })

  it('Refresh current case reads it again by its ID and keeps focus', async () => {
    api.registrationCase.mockResolvedValue(pending())
    await findCase()
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    const button = screen.getByRole('button', { name: 'Refresh current case' })
    await press(button)
    expect(api.registrationCase).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, CASE)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    await act(async () => { fireEvent.click(button) })
    expect(api.registrationCase).toHaveBeenCalledTimes(2)
    await act(async () => { reading.reject(new Error('timeout')) })
    expect((await screen.findByRole('alert')).textContent).toBe('The registration case could not be loaded.')
    expect(document.activeElement).toBe(button)
    expect(heading().textContent).toBe(`Case ${CASE}`)
  })

  it('a refusal in one case\'s form does not follow to the next case opened', async () => {
    api.registrationCase.mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending(OTHER_CASE))
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Approve new Health ID' }))
    const reason = screen.getByRole('textbox', { name: 'Approval reason' })
    fireEvent.submit(reason.closest('form')!)
    await waitFor(() => expectRefused(reason, 'Enter a review reason between 8 and 500 characters.'))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Registration case ID' }), { target: { value: OTHER_CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    await screen.findByRole('heading', { level: 1, name: `Case ${OTHER_CASE}` })
    fireEvent.click(within(actions()).getByRole('button', { name: 'Approve new Health ID' }))
    expect(screen.getByRole('textbox', { name: 'Approval reason' }).getAttribute('aria-invalid')).toBeNull()
  })

  it('offers Next steps only where they lead to a live page: none outside the frame', async () => {
    api.registrationCase.mockResolvedValue(approved)
    await findCase()
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('what the page keeps', () => {
  it('puts nothing about a case or a NIN in the address', async () => {
    const before = window.location.href
    api.registrationCase.mockResolvedValue(pending())
    await findCase()
    expect(window.location.href).toBe(before)
    expect(window.location.href).not.toContain(CASE)
  })

  it('starts afresh at another facility: its own capability, no case from the last one', async () => {
    api.registrationCase.mockResolvedValue(pending())
    const view = renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    await screen.findByRole('heading', { level: 1, name: `Case ${CASE}` })
    session.facility = 'other'
    view.rerender(<MemoryRouter><div className="hid-ehr"><PatientRegistration /></div></MemoryRouter>)
    expect(heading().textContent).toBe('Patient registration')
    await waitFor(() => expect(api.registrationCapabilities).toHaveBeenLastCalledWith('98d00002-0000-4000-8000-000000000004'))
    expect(screen.getByText('No registration cases opened yet')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Registration case ID' }) as HTMLInputElement).value).toBe('')
  })

  it('takes no answer for the facility it left', async () => {
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    const view = renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    session.facility = 'other'
    view.rerender(<MemoryRouter><div className="hid-ehr"><PatientRegistration /></div></MemoryRouter>)
    await act(async () => { reading.resolve(pending()) })
    expect(heading().textContent).toBe('Patient registration')
    expect(screen.queryByText(CASE)).toBeNull()
    expect((api.registrationCase as Mock).mock.calls).toHaveLength(1)
  })
})
