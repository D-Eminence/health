import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RegistrationWorkspace, registrationStatus } from '../../../ehr-blue/clinical/registration/RegistrationWorkspace'
import { FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, labelled, renderPage } from './harness'

/**
 * Patient registration: today's NIN verification, "Resume a registration case" and the case steps (link, approve,
 * enroll), drawn as the design's "New patients" create page and its record page. Everything is fictional: Patient One,
 * HID-ZDEMAAA2, the NIN 00000000001.
 */

const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), resolveNin: vi.fn(), registrationCase: vi.fn(),
  approveNewRegistration: vi.fn(), linkExistingRegistration: vi.fn(), enrollRegistration: vi.fn(),
}))
const staff = vi.hoisted(() => ({
  permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined,
}))

vi.mock('../../../staff/api', () => ({ staffApi: api }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

const WRITE = 'identity.registration.write'
const APPROVE = 'identity.registration.approve'
const READ = 'identity.patient.read'
const CASE_ID = 'c0ffee00-1234-4abc-8def-0123456789ab'
const OTHER_CASE_ID = 'c0ffee00-1234-4abc-8def-0123456789ac'
const NIN = '00000000001'
const OTHER_FACILITY = 'facility-other-hospital'

const ENABLED = { nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true }
const DEFERRED = { nin: { enabled: false, state: 'deferred' }, newPatientRegistrationRequiresNin: true }

const CREATED = 'NIN verification created a governed registration case. Review its status before continuing.'
const CREATED_UNREAD = 'Case created. Reload its details before reviewing it.'
const REVIEW_NOTICE = 'A possible existing patient was found. Only a listed candidate may be linked. This API does not support overriding the match review to create a new identity.'
const PENDING_NOTICE = 'Verification found no candidate. An authorized reviewer may approve a new Health ID.'
const NO_CANDIDATES = 'Candidate details are unavailable. Refresh this case before reviewing it.'
const REASON_PROBLEM = 'Enter a review reason between 8 and 500 characters.'
const ENROLL_PROBLEM = 'Enter a valid email and an enrollment reason between 8 and 500 characters.'

function caseOf(overrides: Record<string, unknown> = {}) {
  return { caseId: CASE_ID, status: 'pending_new_identity_approval', version: 1, candidateCount: 0, ...overrides }
}
const CANDIDATE = { patientId: PATIENT_ID, fullName: PATIENT_NAME, dateOfBirth: '1990-04-12' }
const REVIEW = caseOf({ status: 'review_required', version: 3, candidateCount: 1, candidates: [CANDIDATE] })
const LINKED = caseOf({ status: 'linked_existing', version: 4, candidateCount: 1, patient: { patientId: PATIENT_ID, hid: PATIENT_HID } })
const ENROLLMENT = { patientId: PATIENT_ID, hid: PATIENT_HID, contactVerificationRequired: true, replayed: false }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [WRITE, APPROVE, READ]
  staff.facilityId = undefined
  api.registrationCapabilities.mockResolvedValue(ENABLED)
  api.registrationCase.mockResolvedValue(REVIEW)
})

function open(rest = '') {
  return renderPage(<RegistrationWorkspace />, 'registration', rest)
}

/** Shows the address and router state, to check nothing identifying reaches them. */
function Where() {
  const location = useLocation()
  return <output data-testid="where" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</output>
}

function tree() {
  return (
    <MemoryRouter initialEntries={['/provider/registration']}>
      <Where />
      <Routes><Route path="/provider/registration/*" element={<RegistrationWorkspace />} /></Routes>
    </MemoryRouter>
  )
}

function field(label: string) {
  return screen.getByLabelText(labelled(label)) as HTMLInputElement
}

function errorOf(control: HTMLElement) {
  const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  return ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

async function fillNin(values: { nin?: string; first?: string; last?: string; dob?: string; gender?: string } = {}) {
  fireEvent.change(await screen.findByLabelText(labelled('National Identity Number')), { target: { value: values.nin ?? NIN } })
  fireEvent.change(field('First name'), { target: { value: values.first ?? 'Patient' } })
  fireEvent.change(field('Last name'), { target: { value: values.last ?? 'One' } })
  fireEvent.change(field('Date of birth'), { target: { value: values.dob ?? '1990-04-12' } })
  if (values.gender) fireEvent.change(screen.getByLabelText('Gender (optional)'), { target: { value: values.gender } })
}

function status() {
  const region = document.getElementById('registration-status')
  if (!region) throw new Error('Expected the status region to be mounted throughout.')
  expect(region.getAttribute('role')).toBe('status')
  return region
}

function availableActions() {
  return screen.getByRole('heading', { level: 2, name: 'Available actions' }).closest('section') as HTMLElement
}

function savedRecord() {
  return screen.getByRole('heading', { level: 2, name: 'Saved record' }).closest('section') as HTMLElement
}

describe('Patient registration: the first page', () => {
  it('is live at today’s address, named as the sidebar names it, with today’s fields in the design’s form', async () => {
    expect(registrationStatus).toBe('live')
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Patient registration' })).toBeTruthy()
    expect(screen.getByText('Verify a NIN, review possible matches, and link the verified identity to a governed Health ID. Every step is tied to your active facility and recorded by the backend.')).toBeTruthy()
    expect(document.title).toBe('Patient registration · Health ID EHR')
    // Reading: today's words in the design's notice, and "Check again" busy but focusable.
    expect(screen.getByText('Checking the backend’s registration capability…')).toBeTruthy()
    const checking = screen.getByRole('button', { name: 'Checking…' })
    expect(checking.getAttribute('aria-busy')).toBe('true')
    expect((checking as HTMLButtonElement).disabled).toBe(false)
    expect(await screen.findByText('NIN verification is enabled in test-only mode.')).toBeTruthy()
    expect(api.registrationCapabilities).toHaveBeenCalledWith(FACILITY_ID)
    expect(screen.getByText('Verification availability').closest('[role="status"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()

    expect(screen.getByRole('heading', { level: 2, name: 'Start with verified identity' })).toBeTruthy()
    expect(screen.getByText('Enter the NIN and matching demographic claims. The NIN is sent directly to the identity service and is cleared from this form after a successful response.')).toBeTruthy()
    const nin = field('National Identity Number')
    expect(nin.type).toBe('password')
    expect(nin.inputMode).toBe('numeric')
    expect(nin.getAttribute('autocomplete')).toBe('off')
    expect(nin.maxLength).toBe(11)
    expect(nin.getAttribute('pattern')).toBe('[0-9]{11}')
    expect(nin.id).toBe('registration-nin')
    expect(field('First name').maxLength).toBe(100)
    expect(field('Last name').maxLength).toBe(100)
    expect(field('Date of birth').type).toBe('date')
    const gender = screen.getByLabelText('Gender (optional)') as HTMLSelectElement
    expect(Array.from(gender.options, option => option.textContent)).toEqual(['Not supplied', 'Female', 'Male', 'Intersex', 'Other', 'Unknown'])
    expect(Array.from(gender.options, option => option.value)).toEqual(['', 'female', 'male', 'intersex', 'other', 'unknown'])
    // Today's order: the NIN first, then the names, then date of birth and gender.
    expect(nin.compareDocumentPosition(field('First name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(field('Last name').compareDocumentPosition(field('Date of birth')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Verify and create case' }) as HTMLButtonElement).type).toBe('submit')

    expect(screen.getByRole('heading', { level: 2, name: 'Resume a registration case' })).toBeTruthy()
    expect(screen.getByText('Use the case ID supplied when verification completed. The backend does not provide a searchable case list.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Registration case ID' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Load case' })).toBeTruthy()
    expect(api.resolveNin).not.toHaveBeenCalled()
    expect(api.registrationCase).not.toHaveBeenCalled()
  })

  it('offers Back to list (Patients) only to a role that may look patients up', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByTestId('elsewhere').textContent).toBe('/provider/patients')
  })

  it('does not offer Back to list without identity.patient.read', async () => {
    staff.permissions = [WRITE, APPROVE]
    open()
    await screen.findByText('NIN verification is enabled in test-only mode.')
    expect(screen.queryByRole('button', { name: 'Back to list' })).toBeNull()
  })

  it.each([['the first page', ''], ['a case', `/${CASE_ID}`]])('refuses %s without identity registration write permission, in today’s words, and reads nothing', (_name, rest) => {
    staff.permissions = [APPROVE, READ]
    open(rest)
    expect(screen.getByRole('heading', { level: 1, name: 'Patient registration' })).toBeTruthy()
    expect(screen.getByText('Registration unavailable')).toBeTruthy()
    expect(screen.getByText('This facility membership needs identity registration write permission.')).toBeTruthy()
    expect(api.registrationCapabilities).not.toHaveBeenCalled()
    expect(api.registrationCase).not.toHaveBeenCalled()
  })

  it('with NIN verification deferred, says why in a warning and offers only Resume a registration case', async () => {
    api.registrationCapabilities.mockResolvedValue(DEFERRED)
    open()
    const line = await screen.findByText('NIN verification is deferred. New cases cannot be started here until the backend enables a verification provider.')
    expect(line.closest('section')?.className).toContain('hid-ehr-clinical-banner-warning')
    expect(screen.queryByLabelText(labelled('National Identity Number'))).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Start with verified identity' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Verify and create case' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Load case' })).toBeTruthy()
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('says why capabilities could not be read; Check again keeps focus and the answer shown while it reads', async () => {
    api.registrationCapabilities.mockRejectedValueOnce(new HidApiError(503, 'The service is temporarily unavailable. Please try again shortly.'))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('The service is temporarily unavailable. Please try again shortly.')
    expect(screen.queryByText('Checking the backend’s registration capability…')).toBeNull()
    expect(screen.queryByLabelText(labelled('National Identity Number'))).toBeNull()

    const reading = deferred<unknown>()
    api.registrationCapabilities.mockReturnValueOnce(reading.promise)
    const again = screen.getByRole('button', { name: 'Check again' })
    await press(again)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(again.textContent).toBe('Checking…')
    expect(again.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(again)
    await act(async () => { fireEvent.click(again) })
    expect(api.registrationCapabilities).toHaveBeenCalledTimes(2)
    await act(async () => { reading.resolve(DEFERRED) })
    expect(screen.getByText(/^NIN verification is deferred\./)).toBeTruthy()
    expect(document.activeElement).toBe(again)

    // Refused again: today's own words when the answer is not the backend's, and the last answer stays.
    api.registrationCapabilities.mockRejectedValueOnce(new Error('offline'))
    await press(screen.getByRole('button', { name: 'Check again' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Registration capabilities could not be loaded.')
    expect(screen.getByText(/^NIN verification is deferred\./)).toBeTruthy()
  })
})

describe('Patient registration: verifying a NIN', () => {
  it('refuses before sending, one problem at a time at its field, and moves focus to it', async () => {
    open()
    const verify = await screen.findByRole('button', { name: 'Verify and create case' })
    await press(verify)
    const nin = field('National Identity Number')
    expect(nin.getAttribute('aria-invalid')).toBe('true')
    expect(errorOf(nin)).toBe('Enter the 11 digit NIN.')
    expect(document.activeElement).toBe(nin)
    // Today's refusals stay as the field changes; they go when the form is sent again.
    fireEvent.change(nin, { target: { value: '0000' } })
    expect(errorOf(nin)).toBe('Enter the 11 digit NIN.')
    await press(verify)
    expect(errorOf(nin)).toBe('Enter the 11 digit NIN.')

    fireEvent.change(nin, { target: { value: ` ${NIN} ` } })
    await press(verify)
    expect(nin.getAttribute('aria-invalid')).toBeNull()
    expect(errorOf(field('First name'))).toBe('Enter the patient’s name and date of birth.')
    expect(document.activeElement).toBe(field('First name'))
    fireEvent.change(field('First name'), { target: { value: 'Patient' } })
    await press(verify)
    expect(errorOf(field('Last name'))).toBe('Enter the patient’s name and date of birth.')
    expect(field('First name').getAttribute('aria-invalid')).toBeNull()
    fireEvent.change(field('Last name'), { target: { value: 'One' } })
    await press(verify)
    expect(errorOf(field('Date of birth'))).toBe('Enter the patient’s name and date of birth.')
    expect(document.activeElement).toBe(field('Date of birth'))
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('refused from Enter in the field, says it there as an alert and leaves focus where it is', async () => {
    open()
    const nin = await screen.findByLabelText(labelled('National Identity Number')) as HTMLInputElement
    fireEvent.change(nin, { target: { value: '123' } })
    nin.focus()
    await act(async () => { fireEvent.submit(nin.form!) })
    expect(document.activeElement).toBe(nin)
    expect(within(nin.closest('.hid-ehr-field') as HTMLElement).getByRole('alert').textContent).toBe('Enter the 11 digit NIN.')
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('sends today’s claims and key, keeps the button focusable while it runs, then clears the form and opens the case', async () => {
    const verifying = deferred<unknown>()
    api.resolveNin.mockReturnValueOnce(verifying.promise)
    api.registrationCase.mockResolvedValue(caseOf())
    open()
    await fillNin({ nin: ` ${NIN} `, first: ' Patient ', last: ' One ', gender: 'female' })
    const nin = field('National Identity Number')
    const verify = screen.getByRole('button', { name: 'Verify and create case' })
    await press(verify)
    expect(api.resolveNin).toHaveBeenCalledWith(FACILITY_ID,
      { nin: NIN, firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-04-12', gender: 'female' }, expect.any(String))
    expect(verify.textContent).toBe('Verifying…')
    expect(verify.getAttribute('aria-disabled')).toBe('true')
    expect((verify as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(verify)
    // Read-only, not disabled, while it runs; the gender select is left as today leaves it.
    expect(nin.readOnly).toBe(true)
    expect(field('First name').readOnly).toBe(true)
    expect(field('Date of birth').readOnly).toBe(true)
    await act(async () => { fireEvent.click(verify) })
    expect(api.resolveNin).toHaveBeenCalledTimes(1)
    // Load case waits too, as today's does while a step runs.
    fireEvent.change(screen.getByRole('textbox', { name: 'Registration case ID' }), { target: { value: OTHER_CASE_ID } })
    const load = screen.getByRole('button', { name: 'Load case' })
    expect(load.getAttribute('aria-disabled')).toBe('true')
    await press(load)
    expect(screen.getByRole('heading', { level: 1, name: 'Patient registration' })).toBeTruthy()

    await act(async () => { verifying.resolve(caseOf()) })
    expect(await screen.findByRole('heading', { level: 1, name: `Case ${CASE_ID}` })).toBeTruthy()
    expect(nin.value).toBe('')
    expect(nin.isConnected).toBe(false)
    expect(api.registrationCase).toHaveBeenCalledWith(FACILITY_ID, CASE_ID)
    await waitFor(() => expect(status().textContent).toBe(CREATED))
    expect(screen.getByText('Awaiting new patient approval')).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(NIN)
  })

  it('leaves out a gender that was not supplied', async () => {
    api.resolveNin.mockResolvedValue(caseOf())
    api.registrationCase.mockResolvedValue(caseOf())
    open()
    await fillNin()
    await press(screen.getByRole('button', { name: 'Verify and create case' }))
    expect(api.resolveNin).toHaveBeenCalledWith(FACILITY_ID, { nin: NIN, firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-04-12' }, expect.any(String))
  })

  it('reuses the key for an unchanged retry, takes a new one after a change, and keeps the fields when refused', async () => {
    api.resolveNin
      .mockRejectedValueOnce(new HidApiError(503, 'NIN verification is not available yet.', { code: 'NIN_PROVIDER_DEFERRED' }))
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new HidApiError(403, 'You do not have permission to do that.'))
    open()
    await fillNin()
    const verify = screen.getByRole('button', { name: 'Verify and create case' })
    await press(verify)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('NIN verification is not available yet.')
    // The design's error box, in the form, above its button.
    expect(alert.className).toContain('hid-ehr-clinical-alert')
    expect(alert.compareDocumentPosition(verify) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(field('National Identity Number').value).toBe(NIN)
    await press(verify)
    expect((await screen.findByRole('alert')).textContent).toBe('NIN verification could not be completed.')
    fireEvent.input(field('First name'), { target: { value: 'Patienta' } })
    await press(verify)
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to do that.')
    const keys = api.resolveNin.mock.calls.map(call => call[2])
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('a case it cannot read straight after verification says to reload it, and Load case reads it again', async () => {
    api.resolveNin.mockResolvedValue(caseOf())
    api.registrationCase.mockRejectedValueOnce(new HidApiError(503, 'Unavailable')).mockResolvedValueOnce(REVIEW)
    open()
    await fillNin()
    await press(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(status().textContent).toBe(CREATED_UNREAD))
    expect(screen.queryByRole('alert')).toBeNull()
    const input = screen.getByRole('textbox', { name: 'Registration case ID' }) as HTMLInputElement
    expect(input.value).toBe(CASE_ID)
    await press(screen.getByRole('button', { name: 'Load case' }))
    expect(await screen.findByText('Possible existing patient review')).toBeTruthy()
    expect(api.registrationCase).toHaveBeenCalledTimes(2)
    expect(status().textContent).toBe('')
  })
})

describe('Patient registration: resuming a case', () => {
  it('refuses an ID that is not a registration case ID, at its field, and reads nothing', async () => {
    open()
    const input = screen.getByRole('textbox', { name: 'Registration case ID' })
    fireEvent.change(input, { target: { value: 'not-a-case' } })
    await press(screen.getByRole('button', { name: 'Load case' }))
    expect(errorOf(input)).toBe('Enter a valid registration case ID.')
    expect(document.activeElement).toBe(input)
    // From Enter in the field: an alert there, focus stays.
    await act(async () => { fireEvent.submit((input as HTMLInputElement).form!) })
    expect(document.activeElement).toBe(input)
    expect(within(input.closest('.hid-ehr-field') as HTMLElement).getByRole('alert').textContent).toBe('Enter a valid registration case ID.')
    expect(api.registrationCase).not.toHaveBeenCalled()
  })

  it('opens a case by its ID, trimmed, from Enter in the field', async () => {
    open()
    const input = screen.getByRole('textbox', { name: 'Registration case ID' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: `  ${CASE_ID}  ` } })
    input.focus()
    await act(async () => { fireEvent.submit(input.form!) })
    expect(await screen.findByRole('heading', { level: 1, name: `Case ${CASE_ID}` })).toBeTruthy()
    expect(api.registrationCase).toHaveBeenCalledWith(FACILITY_ID, CASE_ID)
    expect(api.registrationCase).toHaveBeenCalledTimes(1)
  })

  it('says a case is loading, then why it could not be read; Load case keeps the ID and reads it again', async () => {
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    open(`/${CASE_ID}`)
    expect(screen.getByRole('heading', { level: 1, name: `Case ${CASE_ID}` })).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    await act(async () => { reading.reject(new HidApiError(404, 'We could not find what you were looking for.')) })
    expect(screen.getByRole('alert').textContent).toBe('We could not find what you were looking for.')
    const input = screen.getByRole('textbox', { name: 'Registration case ID' }) as HTMLInputElement
    expect(input.value).toBe(CASE_ID)

    const again = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(again.promise)
    const load = screen.getByRole('button', { name: 'Load case' })
    await press(load)
    expect(load.textContent).toBe('Loading…')
    expect(load.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(load)
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { again.reject(new Error('offline')) })
    expect(screen.getByRole('alert').textContent).toBe('The registration case could not be loaded.')

    api.registrationCase.mockResolvedValueOnce(REVIEW)
    await press(screen.getByRole('button', { name: 'Load case' }))
    expect(await screen.findByText('Possible existing patient review')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.registrationCase).toHaveBeenCalledTimes(3)
  })

  it('opens another case typed while none is shown on its own page', async () => {
    api.registrationCase.mockRejectedValueOnce(new HidApiError(404, 'Registration case not found')).mockResolvedValueOnce(caseOf({ caseId: OTHER_CASE_ID }))
    open(`/${CASE_ID}`)
    const input = await screen.findByRole('textbox', { name: 'Registration case ID' })
    fireEvent.change(input, { target: { value: OTHER_CASE_ID } })
    await press(screen.getByRole('button', { name: 'Load case' }))
    expect(await screen.findByRole('heading', { level: 1, name: `Case ${OTHER_CASE_ID}` })).toBeTruthy()
    expect(api.registrationCase).toHaveBeenLastCalledWith(FACILITY_ID, OTHER_CASE_ID)
  })

  it.each([['/not-a-case'], [`/${CASE_ID}/more`]])('shows the design’s missing record at %s, and reads nothing', rest => {
    open(rest)
    expect(screen.getByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText('The record is missing or outside your authorized hospital / branch.')).toBeTruthy()
    expect(api.registrationCase).not.toHaveBeenCalled()
  })
})

describe('Patient registration: a case', () => {
  it('shows the case in the design’s record layout, with today’s status, version and candidates', async () => {
    open(`/${CASE_ID}`)
    const badge = await screen.findByText('Possible existing patient review')
    expect(badge.getAttribute('data-tone')).toBe('brand')
    expect(screen.getByText('Version 3. 1 possible existing patient.')).toBeTruthy()
    const record = savedRecord()
    expect(within(record).getByText('Case ID').nextElementSibling?.textContent).toBe(CASE_ID)
    expect(within(record).queryByText('Health ID')).toBeNull()
    expect(within(record).getByText(PATIENT_NAME).tagName).toBe('STRONG')
    expect(within(record).getByText(`Date of birth: 1990-04-12 · Patient ID: ${PATIENT_ID}`)).toBeTruthy()
    const actions = availableActions()
    expect(within(actions).getByRole('button', { name: 'Refresh current case' })).toBeTruthy()
    expect(within(actions).getByText(REVIEW_NOTICE)).toBeTruthy()
    const candidate = within(actions).getByRole('combobox', { name: 'Candidate to link' }) as HTMLSelectElement
    expect(Array.from(candidate.options, option => option.textContent)).toEqual(['Select a candidate', 'Patient One · 1990-04-12'])
    expect(within(actions).getByRole('textbox', { name: 'Review reason' })).toBeTruthy()
    expect(within(actions).getByRole('button', { name: 'Link selected patient' })).toBeTruthy()
    // The case's ID names it; the patient never does, in the heading or the title.
    expect(document.title).toBe('Patient registration · Health ID EHR')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Patient registration' })).toBeTruthy()
  })

  it.each([
    ['pending_new_identity_approval', 'Awaiting new patient approval', 'brand', 'Approval reason'],
    ['review_required', 'Possible existing patient review', 'brand', 'Review reason'],
    ['resolved_existing_identity', 'Verified existing patient', 'positive', 'Enrollment reason'],
    ['linked_existing', 'Linked to existing patient', 'positive', 'Enrollment reason'],
    ['approved_new_identity', 'New patient approved', 'positive', 'Enrollment reason'],
    ['rejected', 'Rejected', 'brand', null],
    ['cancelled', 'Cancelled', 'brand', null],
  ])('names %s as today does and offers its one step', async (value, label, tone, reason) => {
    api.registrationCase.mockResolvedValue(caseOf({ status: value, candidateCount: value === 'review_required' ? 1 : 0, candidates: [CANDIDATE] }))
    open(`/${CASE_ID}`)
    expect((await screen.findByText(label)).getAttribute('data-tone')).toBe(tone)
    const actions = availableActions()
    const textboxes = within(actions).queryAllByRole('textbox').map(box => box.getAttribute('name'))
    if (reason) expect(within(actions).getByRole('textbox', { name: reason })).toBeTruthy()
    else expect(textboxes).toEqual([])
    expect(within(actions).queryByRole('heading', { name: 'Enroll patient account' }) !== null).toBe(reason === 'Enrollment reason')
    expect(within(actions).queryByText(PENDING_NOTICE) !== null).toBe(value === 'pending_new_identity_approval')
    expect(within(actions).queryByText(REVIEW_NOTICE) !== null).toBe(value === 'review_required')
  })

  it('counts the possible existing patients and shows the Health ID a case holds', async () => {
    api.registrationCase.mockResolvedValue(caseOf({ status: 'approved_new_identity', version: 2, candidateCount: 2, patient: { patientId: PATIENT_ID, hid: PATIENT_HID } }))
    open(`/${CASE_ID}`)
    expect(await screen.findByText('Version 2. 2 possible existing patients.')).toBeTruthy()
    expect(within(savedRecord()).getByText('Health ID').nextElementSibling?.textContent).toBe(PATIENT_HID)
  })

  it('says no possible existing patients were reported', async () => {
    api.registrationCase.mockResolvedValue(caseOf())
    open(`/${CASE_ID}`)
    expect(await screen.findByText('Version 1. No possible existing patients reported.')).toBeTruthy()
  })

  it.each([['no candidate details', undefined], ['an empty candidate list', []]])('with %s, says to refresh and offers no link', async (_name, candidates) => {
    api.registrationCase.mockResolvedValue({ ...REVIEW, candidates })
    open(`/${CASE_ID}`)
    expect(await screen.findByText(NO_CANDIDATES)).toBeTruthy()
    expect(screen.getByText(REVIEW_NOTICE)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Candidate to link' })).toBeNull()
  })

  it('names a candidate without a date of birth as today does', async () => {
    api.registrationCase.mockResolvedValue({ ...REVIEW, candidates: [{ ...CANDIDATE, dateOfBirth: null }] })
    open(`/${CASE_ID}`)
    expect(await screen.findByText(`Date of birth: Not provided · Patient ID: ${PATIENT_ID}`)).toBeTruthy()
    const candidate = screen.getByRole('combobox', { name: 'Candidate to link' }) as HTMLSelectElement
    expect(candidate.options[1]?.textContent).toBe('Patient One · date unknown')
  })

  it.each([['review_required', REVIEW], ['pending_new_identity_approval', caseOf()], ['linked_existing', LINKED]])(
    'without identity.registration.approve, shows a %s case and its notice but no decision or enrollment', async (_name, value) => {
      staff.permissions = [WRITE]
      api.registrationCase.mockResolvedValue(value)
      open(`/${CASE_ID}`)
      await screen.findByRole('heading', { level: 2, name: 'Saved record' })
      const actions = availableActions()
      expect(within(actions).queryAllByRole('textbox')).toEqual([])
      expect(within(actions).queryByRole('combobox')).toBeNull()
      expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Refresh current case'])
      if (value === REVIEW) expect(screen.getByText(`Date of birth: 1990-04-12 · Patient ID: ${PATIENT_ID}`)).toBeTruthy()
    })

  it('Refresh current case reads the case again, stays focusable, and keeps the case on a refusal', async () => {
    open(`/${CASE_ID}`)
    await screen.findByText('Version 3. 1 possible existing patient.')
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    const refresh = screen.getByRole('button', { name: 'Refresh current case' })
    await press(refresh)
    expect(refresh.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(refresh)
    await act(async () => { fireEvent.click(refresh) })
    expect(api.registrationCase).toHaveBeenCalledTimes(2)
    await act(async () => { reading.resolve({ ...REVIEW, version: 5 }) })
    expect(screen.getByText('Version 5. 1 possible existing patient.')).toBeTruthy()
    expect(document.activeElement).toBe(refresh)

    api.registrationCase.mockRejectedValueOnce(new HidApiError(403, 'You do not have permission to do that.'))
    await press(refresh)
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to do that.')
    expect(screen.getByText('Version 5. 1 possible existing patient.')).toBeTruthy()
  })
})

describe('Patient registration: case steps', () => {
  it('links only a candidate the case returned, with today’s reason rule, version and key; focus then moves to the case', async () => {
    const linking = deferred<unknown>()
    api.linkExistingRegistration.mockReturnValueOnce(linking.promise)
    open(`/${CASE_ID}`)
    const link = await screen.findByRole('button', { name: 'Link selected patient' })
    await press(link)
    const candidate = screen.getByRole('combobox', { name: 'Candidate to link' })
    expect(errorOf(candidate)).toBe('Select a candidate returned by this registration case.')
    expect(document.activeElement).toBe(candidate)
    fireEvent.change(candidate, { target: { value: PATIENT_ID } })
    const reason = screen.getByRole('textbox', { name: 'Review reason' })
    fireEvent.change(reason, { target: { value: ' short ' } })
    await press(link)
    expect(errorOf(reason)).toBe(REASON_PROBLEM)
    expect(document.activeElement).toBe(reason)
    fireEvent.change(reason, { target: { value: '  Identity match reviewed with patient  ' } })
    await press(link)
    expect(link.textContent).toBe('Saving…')
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(api.linkExistingRegistration).toHaveBeenCalledWith(FACILITY_ID, expect.objectContaining({ caseId: CASE_ID, status: 'review_required', version: 3 }),
      PATIENT_ID, 'Identity match reviewed with patient', expect.any(String))
    expect(api.approveNewRegistration).not.toHaveBeenCalled()
    // Refresh current case waits while the decision runs.
    const refresh = screen.getByRole('button', { name: 'Refresh current case' })
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(refresh)
    expect(api.registrationCase).toHaveBeenCalledTimes(1)
    link.focus()
    await act(async () => { linking.resolve(LINKED) })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: `Case ${CASE_ID}` })))
    expect(status().textContent).toBe('The verified identity was linked to the selected patient.')
    expect(screen.getByText('Linked to existing patient')).toBeTruthy()
    expect(within(savedRecord()).getByText(PATIENT_HID)).toBeTruthy()
    expect(within(availableActions()).getByRole('heading', { level: 3, name: 'Enroll patient account' })).toBeTruthy()
  })

  it('retries a refused decision with the same key and a changed one with a new key, in the backend’s words or today’s', async () => {
    api.linkExistingRegistration
      .mockRejectedValueOnce(new HidApiError(409, 'That action conflicts with the current state. Refresh and try again.'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(LINKED)
    open(`/${CASE_ID}`)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Candidate to link' }), { target: { value: PATIENT_ID } })
    const reason = screen.getByRole('textbox', { name: 'Review reason' })
    fireEvent.change(reason, { target: { value: 'Identity match reviewed with patient' } })
    const link = screen.getByRole('button', { name: 'Link selected patient' })
    await press(link)
    expect((await screen.findByRole('alert')).textContent).toBe('That action conflicts with the current state. Refresh and try again.')
    await press(link)
    expect((await screen.findByRole('alert')).textContent).toBe('The case review could not be completed. Refresh the case before changing its decision.')
    fireEvent.change(reason, { target: { value: 'Identity match reviewed in person' } })
    await press(link)
    await waitFor(() => expect(status().textContent).toBe('The verified identity was linked to the selected patient.'))
    const keys = api.linkExistingRegistration.mock.calls.map(call => call[4])
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('approves a new Health ID with today’s reason rule, and focus moves to the case', async () => {
    api.registrationCase.mockResolvedValue(caseOf({ version: 2 }))
    api.approveNewRegistration.mockResolvedValue(caseOf({ status: 'approved_new_identity', version: 3, patient: { patientId: PATIENT_ID, hid: PATIENT_HID } }))
    open(`/${CASE_ID}`)
    expect(await screen.findByText(PENDING_NOTICE)).toBeTruthy()
    const approve = screen.getByRole('button', { name: 'Approve new Health ID' })
    await press(approve)
    const reason = screen.getByRole('textbox', { name: 'Approval reason' })
    expect(errorOf(reason)).toBe(REASON_PROBLEM)
    expect(document.activeElement).toBe(reason)
    fireEvent.change(reason, { target: { value: 'x'.repeat(501) } })
    await press(approve)
    expect(errorOf(reason)).toBe(REASON_PROBLEM)
    fireEvent.change(reason, { target: { value: 'No candidate; identity verified by NIN' } })
    await press(approve)
    expect(api.approveNewRegistration).toHaveBeenCalledWith(FACILITY_ID, expect.objectContaining({ caseId: CASE_ID, version: 2 }), 'No candidate; identity verified by NIN', expect.any(String))
    await waitFor(() => expect(status().textContent).toBe('A new Health ID was approved.'))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: `Case ${CASE_ID}` }))
    expect(screen.getByText('New patient approved').getAttribute('data-tone')).toBe('positive')
    expect(api.linkExistingRegistration).not.toHaveBeenCalled()
  })

  it('enrolls a pending patient account: one message for both fields, the email lower-cased, then today’s account line', async () => {
    api.registrationCase.mockResolvedValue(LINKED)
    api.enrollRegistration.mockResolvedValue(ENROLLMENT)
    open(`/${CASE_ID}`)
    expect(await screen.findByText('This creates a pending account for a patient who does not already have one. The email must belong to the patient; contact verification and password setup follow separately.')).toBeTruthy()
    const create = screen.getByRole('button', { name: 'Create pending patient account' })
    const email = screen.getByRole('textbox', { name: 'Patient email' }) as HTMLInputElement
    expect(email.type).toBe('email')
    expect(email.maxLength).toBe(254)
    await press(create)
    expect(errorOf(email)).toBe(ENROLL_PROBLEM)
    expect(document.activeElement).toBe(email)
    fireEvent.change(email, { target: { value: '  Patient.One@Example.TEST ' } })
    await press(create)
    const reason = screen.getByRole('textbox', { name: 'Enrollment reason' })
    expect(errorOf(reason)).toBe(ENROLL_PROBLEM)
    expect(email.getAttribute('aria-invalid')).toBeNull()
    fireEvent.change(reason, { target: { value: ' Patient asked for an account ' } })
    await press(create)
    expect(api.enrollRegistration).toHaveBeenCalledWith(FACILITY_ID, expect.objectContaining({ caseId: CASE_ID, version: 4 }),
      'patient.one@example.test', 'Patient asked for an account', expect.any(String))
    expect(await screen.findByText('Pending account created for HID-ZDEMAAA2. Contact verification is required.')).toBeTruthy()
    expect(status().textContent).toBe('A pending patient account was created. Contact ownership and password setup still require verification.')
    expect(screen.queryByRole('button', { name: 'Create pending patient account' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: `Case ${CASE_ID}` }))

    // The same case read again keeps the account line, as today.
    await press(screen.getByRole('button', { name: 'Refresh current case' }))
    await waitFor(() => expect(api.registrationCase).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Pending account created for HID-ZDEMAAA2. Contact verification is required.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create pending patient account' })).toBeNull()
  })

  it('says why an enrollment was refused, reusing its key for an unchanged retry', async () => {
    api.registrationCase.mockResolvedValue(LINKED)
    api.enrollRegistration
      .mockRejectedValueOnce(new HidApiError(409, 'This patient already has an account.', { code: 'PATIENT_ACCOUNT_EXISTS' }))
      .mockRejectedValueOnce(new Error('offline'))
    open(`/${CASE_ID}`)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Patient email' }), { target: { value: 'patient.one@example.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Enrollment reason' }), { target: { value: 'Patient asked for an account' } })
    const create = screen.getByRole('button', { name: 'Create pending patient account' })
    await press(create)
    expect((await screen.findByRole('alert')).textContent).toBe('This patient already has an account.')
    await press(create)
    expect((await screen.findByRole('alert')).textContent).toBe('Account enrollment could not be completed. The patient may already have an account.')
    expect(screen.getByRole('button', { name: 'Create pending patient account' })).toBeTruthy()
    const keys = api.enrollRegistration.mock.calls.map(call => call[4])
    expect(keys[1]).toBe(keys[0])
  })
})

describe('Patient registration: nothing identifying kept, and another facility', () => {
  it('puts only the case ID in the address, only the facility in router state, and nothing in storage or the title', async () => {
    api.resolveNin.mockResolvedValue(caseOf({ status: 'review_required', version: 3, candidateCount: 1 }))
    api.linkExistingRegistration.mockResolvedValue(LINKED)
    render(tree())
    await fillNin()
    await press(screen.getByRole('button', { name: 'Verify and create case' }))
    await screen.findByRole('combobox', { name: 'Candidate to link' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Candidate to link' }), { target: { value: PATIENT_ID } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Review reason' }), { target: { value: 'Identity match reviewed with patient' } })
    await press(screen.getByRole('button', { name: 'Link selected patient' }))
    await screen.findByText('Linked to existing patient')
    const where = screen.getByTestId('where')
    expect(where.textContent).toBe(`/provider/registration/${CASE_ID}`)
    expect(JSON.parse(where.getAttribute('data-state') ?? 'null')).toEqual({ created: FACILITY_ID })
    for (const value of [NIN, 'Patient', 'One', '1990-04-12', PATIENT_ID, PATIENT_HID]) {
      expect(where.textContent).not.toContain(value)
      expect(where.getAttribute('data-state')).not.toContain(value)
    }
    // The title is the workspace's label only.
    expect(document.title).toBe('Patient registration · Health ID EHR')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('starts afresh for another facility and drops the answer the last one was waiting for', async () => {
    const verifying = deferred<unknown>()
    api.resolveNin.mockReturnValueOnce(verifying.promise)
    const view = render(tree())
    await fillNin()
    await press(screen.getByRole('button', { name: 'Verify and create case' }))
    staff.facilityId = OTHER_FACILITY
    view.rerender(tree())
    await waitFor(() => expect(api.registrationCapabilities).toHaveBeenLastCalledWith(OTHER_FACILITY))
    await act(async () => { verifying.resolve(caseOf()) })
    expect(screen.getByTestId('where').textContent).toBe('/provider/registration')
    expect(api.registrationCase).not.toHaveBeenCalled()
    const nin = await screen.findByLabelText(labelled('National Identity Number')) as HTMLInputElement
    expect(nin.value).toBe('')
    expect(screen.getByRole('button', { name: 'Verify and create case' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('leaves a case for the first page when the facility changes, reading nothing of it there', async () => {
    api.resolveNin.mockResolvedValue(caseOf())
    api.registrationCase.mockResolvedValue(caseOf())
    const view = render(tree())
    await fillNin()
    await press(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(status().textContent).toBe(CREATED))
    staff.facilityId = OTHER_FACILITY
    view.rerender(tree())
    expect(await screen.findByRole('heading', { level: 1, name: 'Patient registration' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/provider/registration')
    await waitFor(() => expect(api.registrationCapabilities).toHaveBeenLastCalledWith(OTHER_FACILITY))
    expect(api.registrationCase).toHaveBeenCalledTimes(1)
    expect(api.registrationCase).toHaveBeenCalledWith(FACILITY_ID, CASE_ID)
    expect((screen.getByRole('textbox', { name: 'Registration case ID' }) as HTMLInputElement).value).toBe('')
  })
})
