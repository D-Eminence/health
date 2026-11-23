import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { PatientRegistration } from '../../../../ehr-blue/departments/registration/Registration'
import {
  isChild, offersWithoutNin, withoutNinInput, withoutNinProblems, type WithoutNinForm,
} from '../../../../ehr-blue/departments/registration/withoutNin'
import { emptyDeskForm } from '../../../../ehr-blue/collected/deskFields'

/*
 * Registration without a NIN in the blue Registration department (hid-system 0130, owner Q106 of 18 November 2026;
 * identity-api nin-registration.controller.ts POST identity/registration-cases/without-nin). Every person, case and
 * number here is fictional: Patient One, Child Two, example.test.
 */

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital', roles: ['records_officer'] })),
  }
})

const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), registrationCase: vi.fn(), resolveNin: vi.fn(), registerWithoutNin: vi.fn(),
  linkExistingRegistration: vi.fn(), approveNewRegistration: vi.fn(), enrollRegistration: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const WRITE = 'identity.registration.write'
const CASE = 'c0000000-0000-4000-8000-000000000031'
const PATIENT = 'a0000000-0000-4000-8000-000000000031'
const REASONS = ['nin_service_unavailable', 'no_nin', 'not_carried', 'child', 'foreign_national']
/** What the live backend (identity-api 4c843270) answers while NIN checks are off. */
const NIN_OFF = {
  nin: { enabled: false, state: 'deferred', available: false },
  withoutNin: { enabled: true, phoneRequiredUnlessChild: true, reasons: REASONS },
  newPatientRegistrationRequiresNin: false,
}
const NIN_ON = { ...NIN_OFF, nin: { enabled: true, state: 'test-only', available: true } }
/** A backend before 0130: no registration without a NIN. */
const NEITHER = { nin: { enabled: false, state: 'deferred' }, withoutNin: { enabled: false }, newPatientRegistrationRequiresNin: true }
const OLD_DEAD_END = 'NIN checks are not available right now, so new registrations cannot be started here. Try again later.'

beforeEach(() => {
  vi.clearAllMocks()
  session.permissions = [WRITE]
  api.registrationCapabilities.mockResolvedValue(NIN_OFF)
})
afterEach(() => {
  // The word the owner ruled out is never on screen.
  expect(document.body.textContent ?? '').not.toMatch(/unverified/i)
})

async function openNew() {
  renderDept(<PatientRegistration />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create record' }))
  return within(await screen.findByRole('dialog'))
}
function fill({ first = 'Patient', last = 'One', dob = '1990-01-02', reason = 'no_nin', contact = true, hid = '' } = {}) {
  fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: first } })
  fireEvent.input(screen.getByLabelText(/^Last name/), { target: { value: last } })
  fireEvent.input(screen.getByLabelText(/^Date of birth/), { target: { value: dob } })
  fireEvent.change(screen.getByLabelText(/^Why is there no NIN/), { target: { value: reason } })
  if (contact) {
    fireEvent.input(screen.getByLabelText(/^Phone/), { target: { value: '0803 123 4567' } })
    fireEvent.input(screen.getByLabelText(/^Address/), { target: { value: '3 Example Street' } })
    fireEvent.input(screen.getByLabelText(/^City or town/), { target: { value: 'Ikeja' } })
    fireEvent.change(screen.getByLabelText(/^State/), { target: { value: 'LA' } })
    fireEvent.input(screen.getByLabelText(/^Local government area/), { target: { value: 'Ikeja' } })
  }
  fireEvent.change(screen.getByLabelText(/^Does the patient already have a Health ID/), { target: { value: hid ? 'yes' : 'no' } })
  if (hid) fireEvent.input(screen.getByLabelText(/^Existing Health ID/), { target: { value: hid } })
}
async function register() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Register patient' })) })
}
function described(control: Element) {
  return (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

describe('the list while NIN checks are off', () => {
  it('points to registering without a NIN instead of the dead end', async () => {
    renderDept(<PatientRegistration />)
    expect(await screen.findByText(/You can still register a new patient without a NIN/)).toBeTruthy()
    expect(screen.queryByText(OLD_DEAD_END)).toBeNull()
  })

  it('keeps the dead end only where Identity takes no registration without a NIN', async () => {
    api.registrationCapabilities.mockResolvedValue(NEITHER)
    renderDept(<PatientRegistration />)
    expect(await screen.findByText(OLD_DEAD_END)).toBeTruthy()
  })
})

describe('Register without a NIN', () => {
  it('replaces the NIN form while NIN checks are off, with Identity’s reasons in plain words', async () => {
    const drawer = await openNew()
    expect(await drawer.findByRole('heading', { name: 'Register without a NIN' })).toBeTruthy()
    expect(drawer.queryByLabelText(/^National Identity Number/)).toBeNull()
    expect(drawer.queryByText(OLD_DEAD_END)).toBeNull()
    expect(drawer.getByText(/this patient is registered without a NIN\. Their record will show NIN Not Verified\./)).toBeTruthy()
    const reason = drawer.getByLabelText(/^Why is there no NIN/) as HTMLSelectElement
    expect([...reason.options].map(option => option.value)).toEqual(['', ...REASONS])
    expect([...reason.options].map(option => option.textContent)).not.toContain('no_nin')
    expect((drawer.getByLabelText(/^Phone/) as HTMLInputElement).required).toBe(true)
  })

  it('keeps the NIN form while NIN checks work', async () => {
    api.registrationCapabilities.mockResolvedValue(NIN_ON)
    const drawer = await openNew()
    expect(await drawer.findByLabelText(/^National Identity Number/)).toBeTruthy()
    expect(drawer.queryByRole('heading', { name: 'Register without a NIN' })).toBeNull()
  })

  it('sends the details with an Idempotency-Key, and opens the registered patient’s record as NIN Not Verified', async () => {
    api.registerWithoutNin.mockResolvedValue({
      caseId: CASE, status: 'approved_new_identity', version: 1, outcome: 'registered', identityEvidence: 'none',
      ninStatus: 'not_verified', replayed: false, patient: { patientId: PATIENT, hid: 'HID-ZDEMAAB2' },
      message: 'Server words that are never shown.',
    })
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'approved_new_identity', version: 1, candidateCount: 0,
      identityEvidence: 'none', ninStatus: 'not_verified', patient: { patientId: PATIENT, hid: 'HID-ZDEMAAB2' } })
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    fill({ hid: ' hid-abc234 ' })
    await register()
    expect(api.registerWithoutNin).toHaveBeenCalledTimes(1)
    const [facility, body, key] = api.registerWithoutNin.mock.calls[0]!
    expect(facility).toBe(DEMO_HOSPITAL_ID)
    expect(body).toEqual({ firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02', noNinReason: 'no_nin',
      phone: '+2348031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
      hasExistingHealthId: true, existingHealthId: 'HID-ABC234' })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })).toBeTruthy()
    expect(screen.getAllByText('The patient was registered and given a Health ID. Their record shows NIN Not Verified.').length).toBeGreaterThan(0)
    expect(screen.getByText('NIN Not Verified')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Server words')
  })

  it('says a possible duplicate was sent for review, with nobody else’s details', async () => {
    api.registerWithoutNin.mockResolvedValue({
      caseId: CASE, status: 'review_required', version: 1, outcome: 'sent_for_review', identityEvidence: 'none',
      ninStatus: 'not_verified', replayed: false,
    })
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'review_required', version: 1, candidateCount: 1,
      identityEvidence: 'none', ninStatus: 'not_verified', candidates: [] })
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    fill()
    await register()
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })).toBeTruthy()
    expect(screen.getAllByText(/so it was sent for review\. An approver at this facility will decide/).length).toBeGreaterThan(0)
    expect(screen.getByText(/^Sent for review\. This may be someone who is already registered/)).toBeTruthy()
    expect(screen.queryByText(/possible matches could not be shown/)).toBeNull()
    expect(screen.queryByText(/A possible existing patient was found/)).toBeNull()
  })

  it('refuses missing details at their fields before sending', async () => {
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    await register()
    expect(api.registerWithoutNin).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^First name/).getAttribute('aria-invalid')).toBe('true')
    expect(described(screen.getByLabelText(/^Why is there no NIN/))).toContain('Choose why the patient is registered without a NIN.')
    expect(screen.getByLabelText(/^Phone/).getAttribute('aria-invalid')).toBe('true')
  })

  it('lets a child be registered without a phone or address, and sends none', async () => {
    api.registerWithoutNin.mockResolvedValue({ caseId: CASE, status: 'review_required', version: 1, outcome: 'sent_for_review',
      identityEvidence: 'none', ninStatus: 'not_verified', replayed: false })
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'review_required', version: 1, candidateCount: 0, identityEvidence: 'none' })
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    fireEvent.change(screen.getByLabelText(/^Why is there no NIN/), { target: { value: 'child' } })
    const phone = screen.getByLabelText(/^Phone/) as HTMLInputElement
    expect(phone.required).toBe(false)
    expect(screen.getByText('Phone (optional)')).toBeTruthy()
    fill({ first: 'Child', last: 'Two', dob: '2020-03-04', reason: 'child', contact: false })
    await register()
    expect(api.registerWithoutNin.mock.calls[0]![1]).toEqual({ firstName: 'Child', lastName: 'Two', dateOfBirth: '2020-03-04',
      noNinReason: 'child', hasExistingHealthId: false })
  })

  it('refuses the child reason for an adult before sending', async () => {
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    fill({ reason: 'child', contact: false })
    await register()
    expect(api.registerWithoutNin).not.toHaveBeenCalled()
    expect(described(screen.getByLabelText(/^Why is there no NIN/)))
      .toContain('This date of birth makes the patient 18 or older. Choose another reason.')
  })

  it.each([
    ['PHONE_REQUIRED', 400, 'Enter the patient’s phone number and address. Only a child can be registered without them.'],
    ['REGISTRATION_WITHOUT_NIN_NOT_AVAILABLE', 403, 'Registration without a NIN is not available at a demonstration or test facility.'],
    ['REGISTRATION_WITHOUT_NIN_DENIED', 403, 'You cannot register patients at this facility.'],
    ['REGISTRATION_WITHOUT_NIN_UNAVAILABLE', 503, 'Registration without a NIN is not available right now. Try again in a minute.'],
    ['IDEMPOTENCY_KEY_REUSED', 409, 'This request was already sent with different details. Start a new registration.'],
  ])('says Identity’s %s refusal in plain words, and keeps the form', async (code, status, words) => {
    api.registerWithoutNin.mockRejectedValue(new HidApiError(status, 'Identity’s own text', { code }))
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    fill()
    await register()
    const drawer = within(screen.getByRole('dialog'))
    await waitFor(() => expect(drawer.getAllByRole('alert').map(alert => alert.textContent)).toContain(words))
    expect(document.body.textContent).not.toContain('Identity’s own text')
    expect((screen.getByLabelText(/^First name/) as HTMLInputElement).value).toBe('Patient')
    expect(api.registrationCase).not.toHaveBeenCalled()
  })

  it('an unchanged retry reuses its key; changed details get a new one', async () => {
    api.registerWithoutNin.mockRejectedValue(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' }))
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    fill()
    await register()
    await register()
    fireEvent.input(screen.getByLabelText(/^Last name/), { target: { value: 'Three' } })
    await register()
    const keys = api.registerWithoutNin.mock.calls.map(call => call[2])
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })
})

describe('the rules before sending', () => {
  const form = (overrides: Partial<WithoutNinForm> = {}): WithoutNinForm => ({
    firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02', gender: '', noNinReason: 'no_nin',
    desk: { ...emptyDeskForm(), phone: '08031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
      hasExistingHealthId: 'no' },
    ...overrides,
  })

  it('offers it only while NIN checks are off and Identity takes it', () => {
    expect(offersWithoutNin(NIN_OFF)).toBe(true)
    expect(offersWithoutNin(NIN_ON)).toBe(false)
    expect(offersWithoutNin(NEITHER)).toBe(false)
    expect(offersWithoutNin({ nin: { enabled: false, state: 'deferred' }, newPatientRegistrationRequiresNin: true })).toBe(false)
    expect(offersWithoutNin(null)).toBe(false)
  })

  it('counts a child as under 18 on the day', () => {
    expect(isChild('2008-11-24', '2026-11-23')).toBe(true)
    expect(isChild('2008-11-23', '2026-11-23')).toBe(false)
  })

  it('refuses a date of birth in the future, and a child’s partly given contact', () => {
    expect(withoutNinProblems(form({ dateOfBirth: '2026-11-24' }), '2026-11-23').map(([field]) => field)).toEqual(['dateOfBirth'])
    const child = form({ noNinReason: 'child', dateOfBirth: '2020-03-04', desk: { ...emptyDeskForm(), phone: '08031234567', hasExistingHealthId: 'no' } })
    expect(withoutNinProblems(child, '2026-11-23').map(([field]) => field)).toEqual(['addressLine', 'city', 'stateCode', 'lga'])
  })

  it('sends the gender only when given, and no existing Health ID unless the patient has one', () => {
    expect(withoutNinInput(form({ gender: 'female' }))).toMatchObject({ gender: 'female', hasExistingHealthId: false })
    expect(withoutNinInput(form())).not.toHaveProperty('existingHealthId')
    expect(withoutNinInput(form())).not.toHaveProperty('gender')
  })
})
