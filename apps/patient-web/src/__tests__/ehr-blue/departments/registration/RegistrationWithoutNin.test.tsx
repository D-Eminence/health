import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { PatientRegistration } from '../../../../ehr-blue/departments/registration/Registration'
import {
  isChild, offersWithoutNin, withoutNinFirst, withoutNinInput, withoutNinProblems, type WithoutNinForm,
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
const APPROVE = 'identity.registration.approve'
const CASE = 'c0000000-0000-4000-8000-000000000031'
const PATIENT = 'a0000000-0000-4000-8000-000000000031'
const LISTED = 'a0000000-0000-4000-8000-000000000032'
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
/** The dead end, in classic's words under "NIN checks are off". */
const OLD_DEAD_END = 'New registrations can’t start until they’re back on.'

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

  it('names only the button there is: Create record opens the form without a NIN straight away', async () => {
    renderDept(<PatientRegistration />)
    expect(await screen.findByText('NIN checks are not available right now. You can still register a new patient without a NIN: '
      + 'choose Create record. Their record will show NIN Not Verified.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    const drawer = within(await screen.findByRole('dialog'))
    expect(await drawer.findByRole('heading', { name: 'Register without a NIN' })).toBeTruthy()
    expect(drawer.queryByRole('button', { name: 'Register without a NIN' })).toBeNull()
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
    expect(drawer.queryByLabelText(/^NIN \(11 digits\)/)).toBeNull()
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
    expect(await drawer.findByLabelText(/^NIN \(11 digits\)/)).toBeTruthy()
    expect(drawer.queryByRole('heading', { name: 'Register without a NIN' })).toBeNull()
  })

  it('offers registration without a NIN next to the NIN form while NIN checks work, for a child or someone with no NIN', async () => {
    api.registrationCapabilities.mockResolvedValue(NIN_ON)
    api.registerWithoutNin.mockResolvedValue({ caseId: CASE, status: 'approved_new_identity', version: 1, outcome: 'registered',
      identityEvidence: 'none', ninStatus: 'not_verified', replayed: false, patient: { patientId: PATIENT, hid: 'HID-ZDEMAAB2' } })
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'approved_new_identity', version: 1, candidateCount: 0,
      identityEvidence: 'none', ninStatus: 'not_verified', patient: { patientId: PATIENT, hid: 'HID-ZDEMAAB2' } })
    const drawer = await openNew()
    await drawer.findByLabelText(/^National Identity Number/)
    // Not the notice for NIN checks being off: they work.
    expect(drawer.queryByText(/NIN checks are not available/)).toBeNull()
    fireEvent.click(drawer.getByRole('button', { name: 'Register without a NIN' }))
    const heading = drawer.getByRole('heading', { name: 'Register without a NIN' })
    expect(document.activeElement).toBe(heading)
    expect(drawer.queryByLabelText(/^National Identity Number/)).toBeNull()
    expect(drawer.queryByText(/NIN checks are not available/)).toBeNull()
    // And back to the NIN form.
    fireEvent.click(drawer.getByRole('button', { name: 'Check a NIN instead' }))
    expect(drawer.getByLabelText(/^National Identity Number/)).toBeTruthy()
    fireEvent.click(drawer.getByRole('button', { name: 'Register without a NIN' }))
    fill({ first: 'Child', last: 'Two', dob: '2020-03-04', reason: 'child', contact: false })
    await register()
    expect(api.registerWithoutNin).toHaveBeenCalledTimes(1)
    expect(api.registerWithoutNin.mock.calls[0]![1]).toEqual({ firstName: 'Child', lastName: 'Two', dateOfBirth: '2020-03-04',
      noNinReason: 'child', hasExistingHealthId: false })
    expect(api.resolveNin).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Child Two' })).toBeTruthy()
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

  it('offers it whenever Identity takes it, as the new form itself only while NIN checks are off', () => {
    expect(offersWithoutNin(NIN_OFF)).toBe(true)
    expect(offersWithoutNin(NIN_ON)).toBe(true)
    expect(offersWithoutNin(NEITHER)).toBe(false)
    expect(offersWithoutNin({ nin: { enabled: false, state: 'deferred' }, newPatientRegistrationRequiresNin: true })).toBe(false)
    expect(offersWithoutNin(null)).toBe(false)
    expect(withoutNinFirst(NIN_OFF)).toBe(true)
    expect(withoutNinFirst(NIN_ON)).toBe(false)
    expect(withoutNinFirst(NEITHER)).toBe(false)
    expect(withoutNinFirst(null)).toBe(false)
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

  it('refuses a date of birth Identity refuses: before 1900, or a day that does not exist', () => {
    // 0130 identity.register_patient_without_nin: requested_dob < 1900-01-01 is NO_NIN_REGISTRATION_INVALID; the DTO's
    // IsDateString is strict.
    expect(withoutNinProblems(form({ dateOfBirth: '1899-12-31' }), '2026-11-23').map(([field]) => field)).toEqual(['dateOfBirth'])
    expect(withoutNinProblems(form({ dateOfBirth: '1990-02-30' }), '2026-11-23').map(([field]) => field)).toEqual(['dateOfBirth'])
    expect(withoutNinProblems(form({ dateOfBirth: '1900-01-01' }), '2026-11-23')).toEqual([])
    expect(withoutNinProblems(form({ dateOfBirth: '2000-02-29' }), '2026-11-23')).toEqual([])
  })

  it('sends the gender only when given, and no existing Health ID unless the patient has one', () => {
    expect(withoutNinInput(form({ gender: 'female' }))).toMatchObject({ gender: 'female', hasExistingHealthId: false })
    expect(withoutNinInput(form())).not.toHaveProperty('existingHealthId')
    expect(withoutNinInput(form())).not.toHaveProperty('gender')
  })
})

/*
 * Deciding a registration without a NIN (0130 identity.review_patient_without_nin): an approver other than the person who
 * started it gives a new Health ID or links a listed patient. The NIN case's rule ("a new Health ID cannot be given once a
 * possible match has been found") is not this one's, and would push an approver to put two people on one record.
 */
describe('a registration without a NIN, as an approver reads it', () => {
  const NO_NIN_REVIEW = { caseId: CASE, status: 'review_required', version: 3, candidateCount: 1, identityEvidence: 'none',
    ninStatus: 'not_verified', candidates: [{ patientId: LISTED, fullName: 'Patient Four', dateOfBirth: '1990-01-02' }] }
  /** identity-api ReviewedWithoutNin: no candidateCount, no candidates. */
  const decided = (status: string, patientId: string, hid: string) => ({ caseId: CASE, status, version: 4, identityEvidence: 'none',
    ninStatus: 'not_verified', replayed: false, patient: { patientId, hid } })
  const NEEDS_NIN = 'A patient account can be set up once the patient’s NIN has been checked.'

  beforeEach(() => { session.permissions = [WRITE, APPROVE] })

  async function findCase() {
    renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Reference' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    return screen.findByRole('heading', { level: 1, name: 'Earlier registration' })
  }
  const actions = () => screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
  const savedRecord = () => screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement
  async function decide(name: string, reason: string) {
    fireEvent.click(within(actions()).getByRole('button', { name }))
    const form = screen.getByRole('form', { name })
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: reason } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name })) })
  }

  it('with a listed patient: offers a new Health ID and the link, and never says a new one cannot be given', async () => {
    api.registrationCase.mockResolvedValue(NO_NIN_REVIEW)
    api.approveNewRegistration.mockResolvedValue(decided('approved_new_identity', PATIENT, 'HID-ZDEMAAB3'))
    await findCase()
    expect(document.body.textContent).not.toMatch(/cannot be given/)
    expect(screen.queryByText(/Only a listed patient may be linked/)).toBeNull()
    expect(screen.getByText('This may be someone already registered. Link them only if they are the same person. '
      + 'Otherwise give them a new Health ID.')).toBeTruthy()
    expect(within(savedRecord()).getByText('Patient Four')).toBeTruthy()
    expect(within(actions()).getByRole('button', { name: 'Link selected patient' })).toBeTruthy()
    await decide('Give a new Health ID', '  Not the same person: a twin seen today  ')
    expect(api.approveNewRegistration).toHaveBeenCalledTimes(1)
    const [facility, item, reason, key] = api.approveNewRegistration.mock.calls[0]!
    expect(facility).toBe(DEMO_HOSPITAL_ID)
    expect(item).toMatchObject({ caseId: CASE, version: 3 })
    expect(reason).toBe('Not the same person: a twin seen today')
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(api.linkExistingRegistration).not.toHaveBeenCalled()
    await waitFor(() => expect(within(savedRecord()).getByText('Health ID').nextElementSibling?.textContent).toBe('HID-ZDEMAAB3'))
    expect(screen.getAllByText('A new Health ID was approved.').length).toBeGreaterThan(0)
  })

  it('with nobody listed (it matched another registration waiting for review): offers a new Health ID, not "an approver will decide"', async () => {
    api.registrationCase.mockResolvedValue({ ...NO_NIN_REVIEW, candidateCount: 0, candidates: [] })
    api.approveNewRegistration.mockResolvedValue(decided('approved_new_identity', PATIENT, 'HID-ZDEMAAB3'))
    await findCase()
    expect(screen.queryByText(/will decide/)).toBeNull()
    expect(screen.queryByText(/possible matches could not be shown/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/cannot be given/)
    expect(screen.getByText(/the same person as another registration waiting for review\. Give them a new Health ID only if/)).toBeTruthy()
    expect(within(actions()).queryByRole('button', { name: 'Link selected patient' })).toBeNull()
    expect(within(actions()).queryByText('Nothing else to do here.')).toBeNull()
    await decide('Give a new Health ID', 'No existing patient is the same person')
    expect(api.approveNewRegistration).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, expect.objectContaining({ caseId: CASE, version: 3 }),
      'No existing patient is the same person', expect.any(String))
  })

  it.each([
    ['REGISTRATION_REVIEW_SECOND_PERSON_REQUIRED', 403, 'Another approver must decide this registration, because you started it.'],
    ['REGISTRATION_CASE_ALREADY_DECIDED', 409, 'This registration has already been decided. Refresh it to see the decision.'],
  ])('says Identity’s %s refusal of the decision in plain words', async (code, status, words) => {
    api.registrationCase.mockResolvedValue({ ...NO_NIN_REVIEW, candidateCount: 0, candidates: [] })
    api.approveNewRegistration.mockRejectedValue(new HidApiError(status, 'Identity’s own text', { code }))
    await findCase()
    await decide('Give a new Health ID', 'No existing patient is the same person')
    const form = screen.getByRole('form', { name: 'Give a new Health ID' })
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe(words))
    expect(document.body.textContent).not.toContain('Identity’s own text')
  })

  it('started on this visit by an approver: waits for another approver, and offers no decision', async () => {
    api.registerWithoutNin.mockResolvedValue({ caseId: CASE, status: 'review_required', version: 1, outcome: 'sent_for_review',
      identityEvidence: 'none', ninStatus: 'not_verified', replayed: false })
    api.registrationCase.mockResolvedValue({ ...NO_NIN_REVIEW, version: 1, candidates: [] })
    await openNew()
    await screen.findByRole('heading', { name: 'Register without a NIN' })
    fill()
    await register()
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })).toBeTruthy()
    expect(screen.getByText(/^Sent for review\. This may be someone who is already registered/)).toBeTruthy()
    expect(within(actions()).queryByRole('button', { name: 'Give a new Health ID' })).toBeNull()
    expect(within(actions()).getByText('Nothing else to do here.')).toBeTruthy()
  })

  it('after a link, still says how many possible matches there were', async () => {
    api.registrationCase.mockResolvedValue(NO_NIN_REVIEW)
    api.linkExistingRegistration.mockResolvedValue(decided('linked_existing', LISTED, 'HID-ZDEMAAB4'))
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Link selected patient' }))
    const form = screen.getByRole('form', { name: 'Link selected patient' })
    fireEvent.change(within(form).getByRole('combobox'), { target: { value: LISTED } })
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Same person: confirmed with the patient' } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Link selected patient' })) })
    expect(api.linkExistingRegistration).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, expect.objectContaining({ caseId: CASE, version: 3 }),
      LISTED, 'Same person: confirmed with the patient', expect.any(String))
    await waitFor(() => expect(within(savedRecord()).getByText('Health ID').nextElementSibling?.textContent).toBe('HID-ZDEMAAB4'))
    expect(within(savedRecord()).getByText('Possible matches').nextElementSibling?.textContent).toBe('1 possible existing patient.')
    expect(screen.queryByText('No possible existing patients reported.')).toBeNull()
  })

  it('registered without a NIN: offers no patient account, and says when one can be set up', async () => {
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'approved_new_identity', version: 1, candidateCount: 0,
      identityEvidence: 'none', ninStatus: 'not_verified', patient: { patientId: PATIENT, hid: 'HID-ZDEMAAB2' } })
    await findCase()
    expect(within(actions()).queryByRole('button', { name: 'Enroll patient account' })).toBeNull()
    expect(within(actions()).getByText(NEEDS_NIN)).toBeTruthy()
    expect(within(actions()).queryByText('Nothing else to do here.')).toBeNull()
    expect(api.enrollRegistration).not.toHaveBeenCalled()
  })

  it('a NIN case’s enrollment refused as PATIENT_ENROLLMENT_CONFLICT is said in its own words, not as "changed somewhere else"', async () => {
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'approved_new_identity', version: 2, candidateCount: 0,
      identityEvidence: 'nin', ninStatus: 'verified', patient: { patientId: PATIENT, hid: 'HID-ZDEMAAB2' } })
    api.enrollRegistration.mockRejectedValue(new HidApiError(409, 'Registration or account state changed', { code: 'PATIENT_ENROLLMENT_CONFLICT' }))
    await findCase()
    expect(within(actions()).queryByText(NEEDS_NIN)).toBeNull()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Enroll patient account' }))
    const form = screen.getByRole('form', { name: 'Enroll patient account' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Patient email' }), { target: { value: 'patient.one@example.test' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Enrollment reason' }), { target: { value: 'Patient asked for an account' } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Create pending patient account' })) })
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe('A patient account could not be set up for this '
      + 'registration. The patient may already have one, or their NIN has not been checked. Refresh this registration before trying again.'))
    expect(document.body.textContent).not.toMatch(/changed somewhere else|account state changed/)
  })
})
