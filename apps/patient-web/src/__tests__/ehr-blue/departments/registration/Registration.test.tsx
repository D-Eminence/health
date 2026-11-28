import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { DEMO_HOSPITAL_ID, renderDept, type FakeFacility } from '../harness'
import { PatientRegistration } from '../../../../ehr-blue/departments/registration/Registration'
import { Drawer } from '../../../../kasuwa/interactive'
import { registrationPage } from '../../../../ehr-blue/departments/registration/page'
import { BluePagesProvider, OpenPagesProvider } from '../../../../ehr-blue/frame/pageContext'
import type { EhrBluePage } from '../../../../ehr-blue/frame/types'
import { SAID_CHANGED, SAID_NOT_FOUND, SAID_REFUSED } from '../../../said'

/*
 * The blue Patient registration page: the design's patients workspace (list, "New patients" form, saved record with
 * Available actions) on today's page, staff/routes/Registration.tsx, its requests, keys, checks and words
 * (staff/routes/Registration.test.tsx, __tests__/RegistrationOutreachFocus, RefreshFocus and FieldProblemsPerForm).
 * Every person, case and number here is fictional: Patient One, NIN 00000000000, example.test.
 */

const session = vi.hoisted(() => ({
  permissions: [] as string[], facility: 'hospital' as 'hospital' | 'other' | 'none',
  // Set only for a facility that signed itself up (P4b): where it stands with Health ID support, and its kind.
  selfService: undefined as FakeFacility['selfService'],
  // The member's roles there: a records officer, who registers patients, unless a case says otherwise.
  roles: ['records_officer'],
}))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => staffContext(session.facility === 'none' ? undefined : fakeFacility(session.permissions, {
      id: session.facility === 'other' ? '98d00002-0000-4000-8000-000000000004' : hospital, name: 'Demo Hospital', roles: session.roles,
      ...(session.selfService ? { selfService: session.selfService } : {}),
    })),
  }
})

const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), listRegistrationCases: vi.fn(), registrationCase: vi.fn(), resolveNin: vi.fn(), linkExistingRegistration: vi.fn(),
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
  session.selfService = undefined
  session.roles = ['records_officer']
  api.registrationCapabilities.mockResolvedValue(ENABLED)
  api.listRegistrationCases.mockResolvedValue({ view: 'mine', cases: [], nextCursor: null })
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
// The new form opens in a side drawer over the list: its heading is then the drawer's own title (the last drawer's).
function drawerTitle() {
  const id = screen.queryAllByRole('dialog').at(-1)?.getAttribute('aria-labelledby')
  return id ? document.getElementById(id) : null
}
const heading = () => drawerTitle() ?? screen.getByRole('heading', { level: 1 })
const drawer = () => within(screen.getByRole('dialog'))
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
  return screen.findByLabelText(/^NIN \(11 digits\)/) as Promise<HTMLInputElement>
}
function fillNin({ nin = NIN, first = 'Patient', last = 'One', dob = '1990-01-02', desk = true } = {}) {
  fireEvent.input(screen.getByLabelText(/^NIN \(11 digits\)/), { target: { value: nin } })
  fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: first } })
  fireEvent.input(screen.getByLabelText(/^Last name/), { target: { value: last } })
  fireEvent.input(screen.getByLabelText(/^Date of birth/), { target: { value: dob } })
  if (desk) fillDesk()
}
/** The desk's contact for the patient and whether they have a Health ID (hid-system 0114): fictional. */
function fillDesk({ hid = '' } = {}) {
  fireEvent.input(screen.getByLabelText(/^Phone/), { target: { value: '0803 123 4567' } })
  fireEvent.input(screen.getByLabelText(/^Address/), { target: { value: '3 Example Street' } })
  fireEvent.input(screen.getByLabelText(/^City or town/), { target: { value: 'Ikeja' } })
  fireEvent.change(screen.getByLabelText(/^State/), { target: { value: 'LA' } })
  fireEvent.input(screen.getByLabelText(/^Local government area/), { target: { value: 'Ikeja' } })
  fireEvent.change(screen.getByLabelText(/^Does the patient already have a Health ID/), { target: { value: hid ? 'yes' : 'no' } })
  if (hid) fireEvent.input(screen.getByLabelText(/^Existing Health ID/), { target: { value: hid } })
}
/** What fillDesk sends with the NIN check (hid-system docs/INTERFACE_CONTRACT.md section 43.3). */
const DESK = { phone: '+2348031234567', addressLine: '3 Example Street', city: 'Ikeja', stateCode: 'LA', lga: 'Ikeja',
  hasExistingHealthId: false, existingHealthId: null }
/** The Registration ID field and its Open button (classic's "Continue a registration", Registration.tsx 219-226). */
const caseIdField = () => screen.getByRole('textbox', { name: 'Registration ID' }) as HTMLInputElement
const openButton = () => within(caseIdField().closest('form') as HTMLElement).getByRole('button')
async function findCase(caseId = CASE) {
  renderDept(<PatientRegistration />)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: caseId } })
  fireEvent.click(openButton())
  return screen.findByRole('heading', { level: 1, name: 'Earlier registration' })
}
const actions = () => screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
/** Classic's title over every refusal after a step or a read (Registration.tsx 301; parity 3.3-60 to 3.3-63). */
const ERROR_TITLE = 'That didn’t work'
/** A step's or a read's refusal: the words under classic's title, which it always carries. */
function refusal(alert: HTMLElement) {
  expect(alert.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe(ERROR_TITLE)
  return alert.querySelector('.hid-ehr-dept-notice-body')?.textContent
}
/** Classic's summary that opens the account form (Registration.tsx 295), word for word (parity 3.3-63). */
const ENROLL_OPENER = 'No phone or app? Create their account · optional'
const savedRecord = () => screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement

/**
 * The refusal for a role that doesn't register patients, at a facility Health ID support manages or for anyone else. It
 * names the two roles that do, by their words in the role list (owner's answer, 2 Nov 2026).
 */
const REFUSAL = 'Your role at this facility doesn’t include registering patients. Ask your facility administrator for the Receptionist or Records officer role.'
/** A permission's name, Identity's code or the old "membership needs … permission" words: none belongs on a screen. */
const PERMISSION_WORDS = /permission|membership|registration write|identity\.registration\.write/i
/** A role code such as records_officer: the roles are named by their words, never their codes. */
const ROLE_CODES = /\b[a-z]+(?:_[a-z]+)+\b/

describe('who can open Patient registration', () => {
  // Refused as a nurse: a role that does not register patients, so being told which roles do could help.
  beforeEach(() => { session.roles = ['nurse'] })

  it.each([
    ['without identity registration write', 'hospital' as const, [APPROVE]],
    ['without a facility', 'none' as const, [WRITE, APPROVE]],
  ])('%s: a plain refusal that names no permission, and nothing is read', (_name, facility, permissions) => {
    session.facility = facility
    session.permissions = permissions
    renderDept(<PatientRegistration />)
    expect(heading().textContent).toBe('You can’t register patients here')
    expect(screen.getByText(REFUSAL)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(PERMISSION_WORDS)
    expect(document.body.textContent).not.toMatch(ROLE_CODES)
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(api.registrationCapabilities).not.toHaveBeenCalled()
  })

  it('refuses at its address in the frame in the same words', () => {
    session.permissions = [APPROVE]
    renderDept(<>{registrationPage.refusal}</>)
    expect(heading().textContent).toBe('You can’t register patients here')
    expect(screen.getByText(REFUSAL)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(PERMISSION_WORDS)
    expect(document.body.textContent).not.toMatch(ROLE_CODES)
  })

  /*
   * Who reads what (#104's rule, shared as refusedWorkText): the administrator of a facility that signed itself up is
   * never told to ask the facility administrator, which they are. Only a hospital or a clinic is promised registration:
   * a laboratory or pharmacy never gets it (it stays in the EHR, the owner's rule), and an "other" facility agrees its
   * access with Health ID support. Every facility here is fictional.
   */
  describe('by who reads it', () => {
    /** A self-signed-up facility's administrator whose role holds no registration (it manages the facility's staff). */
    const ADMINISTRATOR = ['organization.manage', 'workforce.manage', 'audit.read', 'outreach.registration.read', 'outreach.campaign.read']
    /** What the same administrator holds while Health ID support checks the facility (staff/refusedWork's tests). */
    const AWAITING_REVIEW = ['workforce.manage', 'audit.read', 'outreach.registration.read', 'outreach.registration.write',
      'outreach.campaign.read', 'outreach.campaign.write']
    const ROLE_SENTENCE = 'Your role at this facility doesn’t include registering patients.'
    /** Told to ask, naming no role: where neither role would help. */
    const ASK_ONLY = `${ROLE_SENTENCE} Ask your facility administrator.`
    beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
    afterEach(() => { vi.unstubAllEnvs() })

    /** The refusal as `permissions` reads it, on the page and at its address, the same both times; nothing is read. */
    function refusalAs(permissions: string[], selfService?: FakeFacility['selfService']) {
      session.permissions = permissions
      session.selfService = selfService
      const said = ([<PatientRegistration key="page" />, registrationPage.refusal] as ReactElement[]).map(element => {
        const { unmount } = renderDept(element)
        expect(heading().textContent).toBe('You can’t register patients here')
        expect(document.body.textContent).not.toMatch(PERMISSION_WORDS)
        expect(document.body.textContent).not.toMatch(ROLE_CODES)
        const text = document.querySelector('.hid-ehr-state-message')?.textContent
        unmount()
        return text
      })
      expect(said[1]).toBe(said[0])
      expect(api.registrationCapabilities).not.toHaveBeenCalled()
      return said[0]
    }

    // Both roles register patients (owner's answer, 2 Nov 2026), so the administrator may add either.
    it.each(['hospital', 'clinic'])('the administrator of a checked %s: the role sentence and the step that is theirs, adding a receptionist or a records officer', organizationType => {
      expect(refusalAs(ADMINISTRATOR, { review: 'reviewed', organizationType }))
        .toBe(`${ROLE_SENTENCE} Add a receptionist or a records officer on the Staff page.`)
    })

    it.each([
      ['checked', 'laboratory', 'reviewed', ADMINISTRATOR], ['checked', 'pharmacy', 'reviewed', ADMINISTRATOR],
      ['checked', 'other', 'reviewed', ADMINISTRATOR],
      ['being checked', 'laboratory', 'pending', AWAITING_REVIEW], ['being checked', 'pharmacy', 'pending', AWAITING_REVIEW],
      ['being checked', 'other', 'pending', AWAITING_REVIEW],
    ])('the administrator of a %s %s, which is not promised registration: the role sentence only', (_checked, organizationType, review, permissions) => {
      expect(refusalAs(permissions, { review, organizationType })).toBe(ROLE_SENTENCE)
    })

    it.each(['hospital', 'clinic'])('the administrator of a %s Health ID support is still checking: registration opens after the check', organizationType => {
      expect(refusalAs(AWAITING_REVIEW, { review: 'pending', organizationType })).toBe('Patient registration opens once Health ID support has checked your facility.')
    })

    it.each(['hospital', 'clinic'])('anyone else at a %s Health ID support is still checking: registration opens after the check', organizationType => {
      expect(refusalAs([APPROVE], { review: 'pending', organizationType })).toBe('Patient registration opens once Health ID support has checked your facility.')
    })

    it.each(['hospital', 'clinic'])('anyone else at a checked %s: told to ask its administrator for either role', organizationType => {
      expect(refusalAs([APPROVE], { review: 'reviewed', organizationType })).toBe(REFUSAL)
    })

    it('anyone else at a facility Health ID support manages: told to ask its administrator for either role', () => {
      expect(refusalAs([APPROVE])).toBe(REFUSAL)
    })

    // Neither role brings registration to a laboratory, pharmacy or "other" facility, so nobody there is sent to ask for one.
    it.each([
      ['checked', 'laboratory', 'reviewed'], ['checked', 'pharmacy', 'reviewed'], ['checked', 'other', 'reviewed'],
      ['being checked', 'laboratory', 'pending'], ['being checked', 'pharmacy', 'pending'], ['being checked', 'other', 'pending'],
    ])('anyone else at a %s %s, which is not promised registration: told to ask its administrator, naming no role', (_checked, organizationType, review) => {
      expect(refusalAs([APPROVE], { review, organizationType })).toBe(ASK_ONLY)
    })

    // A records officer without the work (a facility's own grants can differ) is not told to ask for the role they hold.
    it.each([
      ['at a checked hospital', { review: 'reviewed', organizationType: 'hospital' }],
      ['at a facility Health ID support manages', undefined],
    ])('a records officer who does not hold registration, %s: told to ask its administrator, naming no role', (_where, selfService) => {
      session.roles = ['records_officer']
      expect(refusalAs([APPROVE], selfService)).toBe(ASK_ONLY)
    })

    it('an administrator at a facility Health ID support manages: told to ask its administrator for either role', () => {
      expect(refusalAs(ADMINISTRATOR)).toBe(REFUSAL)
    })

    // Only Novu checks self-signed-up facilities (P4b), so on today's backend nobody is that facility's administrator.
    it.each(['', 'main-v1'])('the administrator of a checked hospital on today’s backend (%j): told to ask its administrator for either role', contract => {
      vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
      expect(refusalAs(ADMINISTRATOR, { review: 'reviewed', organizationType: 'hospital' })).toBe(REFUSAL)
    })
  })
})

describe('the list view', () => {
  it('has the design\'s heading with Create record, and no NIN check card while NIN checks work, as classic', async () => {
    const reading = deferred<unknown>()
    api.registrationCapabilities.mockReturnValueOnce(reading.promise)
    renderDept(<PatientRegistration />)
    expect(heading().textContent).toBe('Patient registration')
    expect(screen.getByText('Patients')).toBeTruthy()
    expect(screen.getByText('Check a patient’s NIN, look at possible matches, then give them a new Health ID or link them to the one they already have. Every step is saved for your facility.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
    // Classic's loading line (Registration.tsx 229), then nothing at all once NIN checks are found working.
    expect(screen.getByText('Checking NIN checks are working…').getAttribute('role')).toBe('status')
    await act(async () => { reading.resolve(ENABLED) })
    expect(screen.queryByText('Checking NIN checks are working…')).toBeNull()
    expect(screen.queryByText('Verification availability')).toBeNull()
    expect(screen.queryByText(/NIN checks are/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(api.registrationCapabilities).toHaveBeenCalledWith(DEMO_HOSPITAL_ID)
    // Parity 3.3-60: the card is classic's "Continue a registration" (Registration.tsx 221).
    expect(screen.getByRole('heading', { name: 'Continue a registration' })).toBeTruthy()
    expect(screen.queryByText('Find registration case')).toBeNull()
    // Classic's "Continue a registration" field, hint and button.
    expect(described(caseIdField())).toBe('Shown on the registration when it was started.')
    expect(openButton().textContent).toBe('Open')
    // The registration list (SX-10) is empty, and nothing was opened on this visit.
    expect(await screen.findByText('No registrations yet')).toBeTruthy()
    expect(screen.getByText('Patients you register at this facility are listed here.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Opened on this visit' })).toBeNull()
  })

  it('says NIN checks are off in classic\'s words', async () => {
    api.registrationCapabilities.mockResolvedValue(DEFERRED)
    renderDept(<PatientRegistration />)
    expect(await screen.findByText('New registrations can’t start until they’re back on.')).toBeTruthy()
    expect(screen.getByText('NIN checks are off')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    // Never the server's own word for the state.
    expect(screen.queryByText(/deferred/)).toBeNull()
  })

  it.each([
    ['a refusal, in plain words', new HidApiError(403, 'This membership cannot verify identities.', { code: 'FORBIDDEN' }), SAID_REFUSED],
    ['anything else, in classic\'s fallback', new Error('network down'), 'We couldn’t check whether NIN checks are working.'],
  ])('a capability read that fails: %s, under classic\'s title, with Try again', async (_name, failure, words) => {
    api.registrationCapabilities.mockRejectedValue(failure)
    renderDept(<PatientRegistration />)
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(screen.getByText('Can’t check NINs right now')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(document.body.textContent).not.toContain(failure.message)
  })

  it('Check again reads once, stays focusable while it reads, keeps focus, and the card goes once NIN checks work', async () => {
    api.registrationCapabilities.mockResolvedValueOnce(DEFERRED)
    renderDept(<PatientRegistration />)
    await screen.findByText('New registrations can’t start until they’re back on.')
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
    await act(async () => { reading.resolve(ENABLED) })
    await waitFor(() => expect(screen.queryByText('NIN checks are off')).toBeNull())
    expect(button.isConnected).toBe(false)
  })
})

describe('the new record form', () => {
  it('in a drawer over another drawer, focuses its own drawer’s title, not the one under it', async () => {
    renderDept(<Drawer open onClose={() => {}} title="Find a patient"><PatientRegistration /></Drawer>)
    fireEvent.click(await screen.findByRole('button', { name: 'Create record' }))
    await screen.findByLabelText(/^NIN \(11 digits\)/)
    const [outer, inner] = screen.getAllByRole('dialog')
    expect(outer!.getAttribute('aria-labelledby')).not.toBe(inner!.getAttribute('aria-labelledby'))
    const own = document.getElementById(inner!.getAttribute('aria-labelledby')!)
    expect(own?.textContent).toBe('New patient registration')
    expect(inner!.contains(own)).toBe(true)
    expect(document.activeElement).toBe(own)
  })

  it('opens on its heading with today\'s live fields, the desk\'s contact and existing Health ID required, and no allergies', async () => {
    const nin = await openNew()
    expect(heading().textContent).toBe('New patient registration')
    expect(document.activeElement).toBe(heading())
    expect(screen.getByRole('heading', { name: 'Check their NIN' })).toBeTruthy()
    expect(nin.type).toBe('password')
    expect(nin.name).toBe('nin')
    expect(nin.maxLength).toBe(11)
    expect(nin.getAttribute('autocomplete')).toBe('off')
    for (const [label, name] of [[/^First name/, 'firstName'], [/^Last name/, 'lastName'], [/^Date of birth/, 'dateOfBirth']] as const) {
      expect((screen.getByLabelText(label) as HTMLInputElement).name).toBe(name)
    }
    const gender = screen.getByRole('combobox', { name: 'Gender (optional)' }) as HTMLSelectElement
    expect([...gender.options].map(option => [option.value, option.textContent]))
      .toEqual([['', 'Not given'], ['female', 'Female'], ['male', 'Male'], ['intersex', 'Intersex'], ['other', 'Other'], ['unknown', 'Unknown']])
    for (const [label, name] of [[/^Phone/, 'phone'], [/^Address/, 'addressLine'], [/^City or town/, 'city'], [/^State/, 'stateCode'],
      [/^Local government area/, 'lga'], [/^Does the patient already have a Health ID/, 'hasExistingHealthId']] as const) {
      const control = screen.getByLabelText(label) as HTMLInputElement
      expect(control.disabled, name).toBe(false)
      expect(control.required, name).toBe(true)
      expect(control.getAttribute('name')).toBe(name)
    }
    expect(described(screen.getByLabelText(/^Phone/))).toBe('Kept by this facility to reach the patient. It is not used to sign in.')
    // The existing Health ID only once the patient says they have one; allergies and "provisional local identity" are
    // not asked here (owner decisions D11, D12), not even disabled.
    expect(screen.queryByLabelText(/^Existing Health ID/)).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Does the patient already have a Health ID/), { target: { value: 'yes' } })
    expect((screen.getByLabelText(/^Existing Health ID/) as HTMLInputElement).required).toBe(true)
    expect(screen.queryByLabelText(/allerg/i)).toBeNull()
    expect(screen.queryByText(/Provisional local identity/)).toBeNull()
    expect(document.body.textContent).not.toContain('Not collected by Health ID yet')
    expect(screen.getByText('Type it as it is on their NIN slip. It isn’t kept here.')).toBeTruthy()
    const distinct = screen.getByRole('button', { name: 'Register reviewed duplicate as distinct person' }) as HTMLButtonElement
    expect(distinct.disabled).toBe(true)
    expect(described(distinct)).toBe('A new Health ID cannot be given once a possible match has been found.')
    expect(screen.getByRole('button', { name: 'Check NIN' })).toBeTruthy()
  })

  it('with NIN checks off, shows no form, as classic, only its words with Check again, and sends nothing', async () => {
    api.registrationCapabilities.mockResolvedValue(DEFERRED)
    renderDept(<PatientRegistration />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create record' }))
    expect(await drawer().findByText('New registrations can’t start until they’re back on.')).toBeTruthy()
    expect(drawer().getByText('NIN checks are off')).toBeTruthy()
    // Parity 3.3-61: classic shows no NIN form while NIN checks are off (Registration.tsx 230, 232), not a greyed one.
    expect(drawer().queryByLabelText(/^NIN \(11 digits\)/)).toBeNull()
    expect(drawer().queryByLabelText(/^First name/)).toBeNull()
    expect(drawer().queryByRole('button', { name: 'Check NIN' })).toBeNull()
    expect(drawer().queryByRole('group')).toBeNull()
    expect(document.querySelector('fieldset')).toBeNull()
    // Classic's Check again, which brings the form once NIN checks work again.
    api.registrationCapabilities.mockResolvedValue(ENABLED)
    await press(drawer().getByRole('button', { name: 'Check again' }))
    expect(await drawer().findByLabelText(/^NIN \(11 digits\)/)).toBeTruthy()
    expect(drawer().queryByText('NIN checks are off')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Check their NIN' }))
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('while the capability is read, shows the design\'s skeleton saying so', async () => {
    api.registrationCapabilities.mockReturnValue(new Promise(() => {}))
    renderDept(<PatientRegistration />)
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(screen.getAllByText('Checking NIN checks are working…').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/^NIN \(11 digits\)/)).toBeNull()
  })

  it('refuses every field at once in today\'s words, focus on the first, and sends nothing', async () => {
    const nin = await openNew()
    fireEvent.input(nin, { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expectRefused(nin, 'Enter the 11 digit NIN.'))
    for (const label of [/^First name/, /^Last name/, /^Date of birth/]) expectRefused(screen.getByLabelText(label), 'Enter the patient’s name and date of birth.')
    expect(document.activeElement).toBe(nin)
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('puts focus on the first refused field in the form\'s order: the date of birth, beside the NIN, before the names', async () => {
    await openNew()
    fillNin({ first: '', dob: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    const dob = screen.getByLabelText(/^Date of birth/)
    await waitFor(() => expectRefused(dob, 'Enter the patient’s name and date of birth.'))
    expectRefused(screen.getByLabelText(/^First name/), 'Enter the patient’s name and date of birth.')
    expect(screen.getByLabelText(/^NIN \(11 digits\)/).getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByLabelText(/^Last name/).getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(dob)
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('opens afresh: a form left refused is not shown refused when it is opened again, empty', async () => {
    const nin = await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expectRefused(nin, 'Enter the 11 digit NIN.'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    const again = await screen.findByLabelText(/^NIN \(11 digits\)/)
    expect(again.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByText('Enter the 11 digit NIN.')).toBeNull()
    expect(screen.queryByText('Enter the patient’s name and date of birth.')).toBeNull()
  })

  it('after a failed capability read, Try again keeps focus while it reads, and the form takes focus to its heading', async () => {
    api.registrationCapabilities.mockRejectedValueOnce(new Error('network down'))
    renderDept(<PatientRegistration />)
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    const alert = await drawer().findByRole('alert')
    expect(alert.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe('Can’t check NINs right now')
    expect(alert.querySelector('.hid-ehr-dept-notice-body')?.textContent).toBe('We couldn’t check whether NIN checks are working.')
    const reading = deferred<unknown>()
    api.registrationCapabilities.mockReturnValueOnce(reading.promise)
    const button = drawer().getByRole('button', { name: 'Try again' })
    await press(button)
    expect(button.isConnected).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.textContent).toBe('Checking…')
    expect(document.activeElement).toBe(button)
    expect(drawer().getByText('Checking NIN checks are working…')).toBeTruthy()
    await act(async () => { reading.resolve(ENABLED) })
    const nin = await screen.findByLabelText(/^NIN \(11 digits\)/)
    expect(nin.matches(':disabled')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Check their NIN' }))
  })

  it('refuses a missing or wrong desk field in plain words, at the field, and sends nothing', async () => {
    await openNew()
    fillNin({ desk: false })
    fireEvent.input(screen.getByLabelText(/^Phone/), { target: { value: '123' } })
    fireEvent.change(screen.getByLabelText(/^Does the patient already have a Health ID/), { target: { value: 'yes' } })
    fireEvent.input(screen.getByLabelText(/^Existing Health ID/), { target: { value: 'HID-OOOOOO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    const phone = screen.getByLabelText(/^Phone/)
    await waitFor(() => expectRefused(phone, 'Enter a phone number, for example 0803 123 4567 or +234 803 123 4567. '
      + 'Kept by this facility to reach the patient. It is not used to sign in.'))
    expectRefused(screen.getByLabelText(/^State/), 'Choose the state.')
    expectRefused(screen.getByLabelText(/^Existing Health ID/),
      'Enter the Health ID as written: HID-, then 6 to 32 letters and digits. Starts with HID-, for example HID-ABC234. Health IDs never use 0, 1, I or O.')
    expect(document.activeElement).toBe(phone)
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('sends the Health ID the patient says they have, in capitals', async () => {
    api.resolveNin.mockResolvedValueOnce(pending())
    api.registrationCase.mockResolvedValue(pending())
    await openNew()
    fillNin({ desk: false })
    fillDesk({ hid: ' hid-abc234 ' })
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(1))
    expect(api.resolveNin.mock.calls[0]?.[1]).toEqual({ nin: NIN, firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02',
      ...DESK, hasExistingHealthId: true, existingHealthId: 'HID-ABC234' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    expect(await screen.findByText('We couldn’t check that NIN. Try again.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [first, second] = api.resolveNin.mock.calls
    expect(first?.[0]).toBe(DEMO_HOSPITAL_ID)
    expect(first?.[1]).toEqual({ nin: NIN, firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-01-02', ...DESK })
    expect(first?.[2]).toBeTruthy()
    expect(second?.[2]).toBe(first?.[2])
    expect(nin.value).toBe('')
    // Shown by the person's name as typed, never by its ID.
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })).toBeTruthy()
    expect(api.registrationCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, CASE)
    expect(status().textContent).toBe('NIN checked. See the result below.')
    expect(document.activeElement).toBe(heading())
    // The NIN is in no field on the page now.
    expect([...document.querySelectorAll('input')].map(input => input.value)).not.toContain(NIN)
  })

  it('lists a case started here by the person\'s name and when it was started, with no ID or version', async () => {
    api.resolveNin.mockResolvedValueOnce(pending())
    api.registrationCase.mockResolvedValue(pending())
    await openNew()
    fillNin({ first: 'Amaka', last: 'Obi' })
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await screen.findByRole('heading', { level: 1, name: 'Registration for Amaka Obi' })
    expect(within(savedRecord()).getByText('Started').nextElementSibling?.textContent).toMatch(/^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/)
    expect(screen.getByText(/^Started \d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/)).toBeTruthy()
    // A refresh keeps the name: Identity sends none with a case.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(api.registrationCase).toHaveBeenCalledTimes(2))
    expect(heading().textContent).toBe('Registration for Amaka Obi')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const table = await screen.findByRole('region', { name: 'Opened on this visit' })
    const open = within(table).getByRole('button', { name: 'Registration for Amaka Obi' })
    expect(within(open.closest('tr') as HTMLElement).getByText(/^Started /)).toBeTruthy()
    expect(within(table).queryByText(new RegExp(CASE.slice(0, 8)))).toBeNull()
  })

  it('gives a changed form a new key, and sends the gender when one is chosen', async () => {
    api.resolveNin.mockRejectedValueOnce(new HidApiError(422, 'The identity claims did not match.', { code: 'NIN_MISMATCH' }))
      .mockResolvedValueOnce(pending())
    api.registrationCase.mockResolvedValue(pending())
    await openNew()
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    expect(await screen.findByText('The details don’t match the NIN record. Check the name and date of birth, then try again.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/identity claims|NIN_MISMATCH/)
    fireEvent.input(screen.getByLabelText(/^First name/), { target: { value: 'Patient A' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Gender (optional)' }), { target: { value: 'female' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [first, second] = api.resolveNin.mock.calls
    expect(second?.[1]).toEqual({ nin: NIN, firstName: 'Patient A', lastName: 'One', dateOfBirth: '1990-01-02', gender: 'female', ...DESK })
    expect(second?.[2]).not.toBe(first?.[2])
  })

  it('keeps its button focusable while verifying, and the form read-only and its way back unavailable', async () => {
    const verifying = deferred<unknown>()
    api.resolveNin.mockReturnValueOnce(verifying.promise)
    api.registrationCase.mockResolvedValue(pending())
    const nin = await openNew()
    fillNin()
    status()
    const button = screen.getByRole('button', { name: 'Check NIN' })
    await press(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button.textContent).toBe('Checking…')
    expect(document.activeElement).toBe(button)
    expect(nin.readOnly).toBe(true)
    await act(async () => { fireEvent.click(button) })
    // The drawer stays open while the NIN is checked, so its answer is not lost.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(heading().textContent).toBe('New patient registration')
    expect(api.resolveNin).toHaveBeenCalledTimes(1)
    await act(async () => { verifying.resolve(pending()) })
    await waitFor(() => expect(status().textContent).toBe('NIN checked. See the result below.'))
  })

  it('a case made whose details cannot be read: today\'s words, and its ID ready to load', async () => {
    api.resolveNin.mockResolvedValueOnce(pending())
    api.registrationCase.mockRejectedValueOnce(new Error('timeout'))
    await openNew()
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expect(status().textContent).toBe('NIN checked. Refresh to see the result.'))
    const field = caseIdField()
    expect(heading().textContent).toBe('Patient registration')
    expect(field.value).toBe(CASE)
    expect(document.activeElement).toBe(field)
  })

  it('a case made whose details cannot be read keeps the typed name when Open opens it', async () => {
    api.resolveNin.mockResolvedValueOnce(pending())
    api.registrationCase.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(pending())
    await openNew()
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expect(status().textContent).toBe('NIN checked. Refresh to see the result.'))
    fireEvent.click(openButton())
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })).toBeTruthy()
    expect(screen.queryByText('Earlier registration')).toBeNull()
    expect(screen.getAllByText(/^Started \d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Reopened/)).toBeNull()
  })
})

describe('Continue a registration', () => {
  it('refuses an ID that is not a case ID, at its field, and sends nothing', async () => {
    renderDept(<PatientRegistration />)
    const field = await screen.findByRole('textbox', { name: 'Registration ID' })
    fireEvent.change(field, { target: { value: 'not-a-case' } })
    fireEvent.click(openButton())
    await waitFor(() => expectRefused(field, 'Enter a valid registration case ID. Shown on the registration when it was started.'))
    expect(document.activeElement).toBe(field)
    expect(api.registrationCase).not.toHaveBeenCalled()
  })

  it.each([
    ['a refusal, in plain words', new HidApiError(404, 'Registration case not found.', { code: 'NOT_FOUND' }), SAID_NOT_FOUND],
    ['anything else, in today\'s fallback', new Error('network down'), 'We couldn’t open that registration.'],
  ])('a load that fails: %s, at the card', async (_name, failure, words) => {
    api.registrationCase.mockRejectedValue(failure)
    renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: `  ${CASE} ` } })
    fireEvent.click(openButton())
    // Parity 3.3-60: under classic's title (Registration.tsx 301).
    expect(refusal(await screen.findByRole('alert'))).toBe(words)
    expect(document.body.textContent).not.toContain(failure.message)
    expect(api.registrationCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, CASE)
    expect(heading().textContent).toBe('Patient registration')
  })

  it('a case found after the user went on to Create record is listed, not opened over the form', async () => {
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(openButton())
    expect(screen.getByRole('button', { name: 'Opening…' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    const first = await screen.findByLabelText(/^First name/) as HTMLInputElement
    fireEvent.input(first, { target: { value: 'Patient' } })
    first.focus()
    await act(async () => { reading.resolve(approved) })
    expect(heading().textContent).toBe('New patient registration')
    expect(first.isConnected).toBe(true)
    expect(first.value).toBe('Patient')
    expect(document.activeElement).toBe(first)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const table = await screen.findByRole('region', { name: 'Opened on this visit' })
    // Listed by when it was reopened, never by its ID.
    expect(within(table).getByRole('button', { name: 'Earlier registration' })).toBeTruthy()
    expect(within(table).queryByText(CASE)).toBeNull()
    expect(openButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('a load refused after the user went on is not said on the list shown since', async () => {
    const reading = deferred<unknown>()
    // The find left behind, then the details of the case verification made, which cannot be read.
    api.registrationCase.mockReturnValueOnce(reading.promise).mockRejectedValueOnce(new Error('timeout'))
    api.resolveNin.mockResolvedValueOnce(pending(OTHER_CASE))
    renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(openButton())
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    await screen.findByLabelText(/^NIN \(11 digits\)/)
    fillNin()
    fireEvent.click(screen.getByRole('button', { name: 'Check NIN' }))
    await waitFor(() => expect(status().textContent).toBe('NIN checked. Refresh to see the result.'))
    expect(heading().textContent).toBe('Patient registration')
    await act(async () => { reading.reject(new Error('network down')) })
    expect(screen.queryByText('We couldn’t open that registration.')).toBeNull()
    expect(caseIdField().value).toBe(OTHER_CASE)
  })

  it('opens the case loaded, and lists each case found this visit, in memory', async () => {
    api.registrationCase.mockResolvedValueOnce(pending()).mockResolvedValueOnce(approved).mockResolvedValueOnce(pending(OTHER_CASE, 5))
    const title = await findCase()
    expect(document.activeElement).toBe(title)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getAllByText('New Health ID').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const table = await screen.findByRole('region', { name: 'Opened on this visit' })
    const open = within(table).getByRole('button', { name: 'Earlier registration' })
    expect(document.activeElement).toBe(open)
    const row = open.closest('tr') as HTMLElement
    // By when it was reopened here, never by its ID or version.
    expect(within(row).getByText(/^Reopened \d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/)).toBeTruthy()
    expect(within(table).queryByText(CASE)).toBeNull()
    expect(within(table).queryByRole('columnheader', { name: 'Version' })).toBeNull()
    expect(within(row).getByText('Health ID: HID-ZDEMAAA2')).toBeTruthy()
    expect(within(row).getByText('New Health ID')).toBeTruthy()
    fireEvent.change(caseIdField(), { target: { value: OTHER_CASE } })
    fireEvent.click(openButton())
    await screen.findByRole('heading', { level: 1, name: 'Earlier registration' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const rows = within(await screen.findByRole('region', { name: 'Opened on this visit' })).getAllByRole('row').slice(1)
    expect(rows.map(item => item.querySelector('.hid-ehr-dept-reference')?.textContent?.startsWith('Reopened '))).toEqual([true, true])
    expect(within(rows[0]!).getByText('No possible existing patients reported.')).toBeTruthy()
    expect(within(rows[1]!).getByText('Health ID: HID-ZDEMAAA2')).toBeTruthy()
    // Opened from the list, a case is shown as it was last read: nothing is read again.
    fireEvent.click(within(rows[1]!).getByRole('button', { name: /^Open/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Earlier registration' })).toBeTruthy()
    expect(screen.getByText('Health ID HID-ZDEMAAA2')).toBeTruthy()
    expect(api.registrationCase).toHaveBeenCalledTimes(3)
  })
})

describe('the case record', () => {
  it('shows the case as the design\'s saved record, in today\'s words', async () => {
    api.registrationCase.mockResolvedValue({ ...review, candidateCount: 2, candidates: [...review.candidates,
      { patientId: 'a0000000-0000-4000-8000-000000000002', fullName: 'Patient Two', dateOfBirth: null }] })
    await findCase()
    const facts = within(savedRecord())
    // No case ID or version among its facts: when it was reopened instead, and its reference under More details.
    expect(facts.queryByText('Case ID')).toBeNull()
    expect(facts.queryByText('Version')).toBeNull()
    expect(facts.getByText('Status').nextElementSibling?.textContent).toBe('Possible match')
    expect(facts.getByText('Reopened').nextElementSibling?.textContent).toMatch(/^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/)
    expect(facts.getByText('Possible matches').nextElementSibling?.textContent).toBe('2 possible existing patients.')
    expect(facts.queryByText('Health ID')).toBeNull()
    expect(facts.getByText('Patient One')).toBeTruthy()
    expect(facts.getByText('Born 1990-01-02')).toBeTruthy()
    expect(facts.getByText('Born unknown')).toBeTruthy()
    expect(facts.queryByText(new RegExp(PATIENT))).toBeNull()
    const more = facts.getByText('More details').closest('details') as HTMLElement
    expect(within(more).getByText('Registration ID').nextElementSibling?.textContent).toBe(CASE)
    expect(within(more).getByText('Note this down to reopen this registration on a later visit.')).toBeTruthy()
    expect(screen.getByText('This person may already be on Health ID. Pick the right one to link them.')).toBeTruthy()
    expect(screen.queryByText(/Version/)).toBeNull()
    const correct = within(actions()).getByRole('button', { name: 'Correct demographics' }) as HTMLButtonElement
    expect(correct.disabled).toBe(true)
    expect(described(correct)).toBe('Health ID does not take demographic corrections on a registration case yet.')
  })

  it.each([
    ['pending_new_identity_approval', 'Needs approval'],
    ['review_required', 'Possible match'],
    ['resolved_existing_identity', 'Already on Health ID'],
    ['linked_existing', 'Linked'],
    ['approved_new_identity', 'New Health ID'],
    ['rejected', 'Rejected'],
    ['cancelled', 'Cancelled'],
  ])('says %s as "%s"', async (state, words) => {
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: state, version: 1, candidateCount: 0 })
    await findCase()
    expect(within(savedRecord()).getByText('Status').nextElementSibling?.textContent).toBe(words)
    // Classic's status words (Registration.tsx 19-29): never "unverified".
    expect(document.body.textContent).not.toMatch(/unverified/i)
  })

  it.each([
    ['who may approve', [WRITE, APPROVE], 'No match found. You can give them a new Health ID.'],
    ['who may not approve', [WRITE], 'No match found. Someone with approval rights must give them a new Health ID.'],
  ])('says a case with no match in classic\'s words to someone %s', async (_who, permissions, words) => {
    session.permissions = permissions
    api.registrationCase.mockResolvedValue(pending())
    await findCase()
    expect(screen.getByText(words)).toBeTruthy()
  })

  it('says when a case to review has no candidate details, and offers no link', async () => {
    api.registrationCase.mockResolvedValue({ ...review, candidates: [] })
    await findCase()
    // Parity 3.3-62: classic's warning, its title and its line (Registration.tsx 279).
    const unavailable = screen.getByText('Can’t show the matches').closest('.hid-ehr-dept-notice') as HTMLElement
    expect(unavailable.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe('Can’t show the matches')
    expect(unavailable.querySelector('.hid-ehr-dept-notice-body')?.textContent).toBe('Refresh to try again.')
    expect(unavailable.classList.contains('hid-ehr-dept-notice-caution')).toBe(true)
    expect(within(actions()).queryByRole('button', { name: 'Link to this person' })).toBeNull()
    expect(within(actions()).getByText('Nothing else to do here.')).toBeTruthy()
  })

  it.each([
    ['a case to review', review],
    ['a case awaiting approval', pending()],
    ['a completed case', approved],
  ])('without the approve permission, offers no decision or enrollment on %s', async (_name, item) => {
    session.permissions = [WRITE]
    api.registrationCase.mockResolvedValue(item)
    await findCase()
    for (const name of ['Link to this person', 'Create Health ID', ENROLL_OPENER]) {
      expect(within(actions()).queryByRole('button', { name })).toBeNull()
    }
    expect(within(actions()).getByText('Nothing else to do here.')).toBeTruthy()
  })

  it.each([
    ['rejected', 'Rejected'],
    ['cancelled', 'Cancelled'],
  ])('offers no decision or enrollment on a %s case', async (state) => {
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: state, version: 2, candidateCount: 0 })
    await findCase()
    expect(within(actions()).queryByRole('button', { name: ENROLL_OPENER })).toBeNull()
    expect(within(actions()).getByText('Nothing else to do here.')).toBeTruthy()
  })

  it('draws the chosen action\'s form under all of its action buttons, as the design does', async () => {
    api.registrationCase.mockResolvedValue(approved)
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: ENROLL_OPENER }))
    const form = screen.getByRole('form', { name: ENROLL_OPENER })
    const correct = within(actions()).getByRole('button', { name: 'Correct demographics' })
    expect(correct.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(actions()).getByRole('button', { name: ENROLL_OPENER }).getAttribute('aria-expanded')).toBe('true')
  })

  it('a changed review gets a new key; a review reason of 7 characters is refused and one of 8 is sent', async () => {
    api.registrationCase.mockResolvedValue(pending(CASE, 1))
    api.approveNewRegistration.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(approved)
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Create Health ID' }))
    const reason = screen.getByRole('textbox', { name: 'Why (for the record)' })
    const submit = within(screen.getByRole('form', { name: 'Create Health ID' })).getByRole('button', { name: 'Create Health ID' })
    fireEvent.change(reason, { target: { value: '1234567' } })
    fireEvent.click(submit)
    await waitFor(() => expectRefused(reason, 'Enter a review reason between 8 and 500 characters.'))
    expect(api.approveNewRegistration).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: '12345678' } })
    fireEvent.click(submit)
    expect(refusal(await screen.findByRole('alert'))).toBe('That didn’t save. Refresh and try again.')
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
    expect(screen.queryByRole('combobox', { name: 'Which person is it?' })).toBeNull()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Link to this person' }))
    const candidate = screen.getByRole('combobox', { name: 'Which person is it?' })
    expect(within(candidate).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose', 'Patient One · 1990-01-02'])
    const reason = screen.getByRole('textbox', { name: 'Why (for the record)' })
    fireEvent.click(within(screen.getByRole('form', { name: 'Link to this person' })).getByRole('button', { name: 'Link to this person' }))
    await waitFor(() => expectRefused(candidate, 'Select a candidate returned by this registration case.'))
    expectRefused(reason, 'Enter a review reason between 8 and 500 characters.')
    expect(api.linkExistingRegistration).not.toHaveBeenCalled()

    fireEvent.change(candidate, { target: { value: PATIENT } })
    fireEvent.change(reason, { target: { value: 'Identity match reviewed with patient' } })
    const submit = within(screen.getByRole('form', { name: 'Link to this person' })).getByRole('button', { name: 'Link to this person' })
    fireEvent.click(submit)
    expect(refusal(await screen.findByRole('alert'))).toBe('That didn’t save. Refresh and try again.')
    await press(submit)
    await waitFor(() => expect(api.linkExistingRegistration).toHaveBeenCalledTimes(2))
    const [first, second] = api.linkExistingRegistration.mock.calls
    expect(first?.slice(0, 4)).toEqual([DEMO_HOSPITAL_ID, expect.objectContaining({ caseId: CASE, version: 3 }), PATIENT, 'Identity match reviewed with patient'])
    expect(second?.[4]).toBe(first?.[4])
    await waitFor(() => expect(status().textContent).toBe('Linked to the existing patient.'))
    // The form went with the decision: focus is on the case.
    expect(document.activeElement).toBe(heading())
    expect(screen.queryByRole('combobox', { name: 'Which person is it?' })).toBeNull()
    expect(within(savedRecord()).getByText('Health ID').nextElementSibling?.textContent).toBe('HID-ZDEMAAA2')
    expect(api.approveNewRegistration).not.toHaveBeenCalled()
  })

  it('approves a new Health ID with a reason of 8 to 500 characters', async () => {
    api.registrationCase.mockResolvedValue(pending(CASE, 1))
    api.approveNewRegistration.mockResolvedValue(approved)
    await findCase()
    expect(screen.getByText('No match found. You can give them a new Health ID.')).toBeTruthy()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Create Health ID' }))
    const reason = screen.getByRole('textbox', { name: 'Why (for the record)' })
    fireEvent.change(reason, { target: { value: 'short' } })
    reason.focus()
    fireEvent.submit(reason.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a review reason between 8 and 500 characters.')
    fireEvent.change(reason, { target: { value: 'x'.repeat(501) } })
    fireEvent.submit(reason.closest('form')!)
    await waitFor(() => expect(api.approveNewRegistration).not.toHaveBeenCalled())
    fireEvent.change(reason, { target: { value: '  No candidate after verification  ' } })
    await press(within(screen.getByRole('form', { name: 'Create Health ID' })).getByRole('button', { name: 'Create Health ID' }))
    await waitFor(() => expect(api.approveNewRegistration).toHaveBeenCalledWith(DEMO_HOSPITAL_ID,
      expect.objectContaining({ caseId: CASE, version: 1 }), 'No candidate after verification', expect.any(String)))
    await waitFor(() => expect(status().textContent).toBe('New Health ID created.'))
    expect(document.activeElement).toBe(heading())
  })

  it('a decision refused in plain words, never Identity\'s', async () => {
    api.registrationCase.mockResolvedValue(pending())
    api.approveNewRegistration.mockRejectedValue(new HidApiError(409, 'The case changed. Refresh it.', { code: 'VERSION_CONFLICT' }))
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Create Health ID' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why (for the record)' }), { target: { value: 'No candidate after verification' } })
    fireEvent.click(within(screen.getByRole('form', { name: 'Create Health ID' })).getByRole('button', { name: 'Create Health ID' }))
    const alert = await screen.findByRole('alert')
    // Parity 3.3-62: a failed decision under classic's title (Registration.tsx 301).
    expect(refusal(alert)).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain('The case changed. Refresh it.')
    expect(screen.getByRole('form', { name: 'Create Health ID' }).contains(alert)).toBe(true)
  })

  it('enrolls a patient account for a completed case, in today\'s words, with its own key', async () => {
    api.registrationCase.mockResolvedValue(approved)
    api.enrollRegistration.mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ patientId: PATIENT, hid: 'HID-ZDEMAAA2', contactVerificationRequired: true, replayed: false })
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: ENROLL_OPENER }))
    // Parity 3.3-63: classic's line under its summary, word for word (Registration.tsx 296).
    expect(screen.getByText('They get an email to set a password. Use their own email, not yours.')).toBeTruthy()
    expect(screen.queryByText(/^No phone or app\? They get an email/)).toBeNull()
    const email = screen.getByRole('textbox', { name: 'Their email' })
    const reason = screen.getByRole('textbox', { name: 'Why (for the record)' })
    const submit = within(screen.getByRole('form', { name: ENROLL_OPENER })).getByRole('button', { name: 'Create account' })
    fireEvent.change(email, { target: { value: 'not an email' } })
    fireEvent.change(reason, { target: { value: 'Patient asked for an account' } })
    fireEvent.click(submit)
    await waitFor(() => expectRefused(email, 'Enter a valid email and an enrollment reason between 8 and 500 characters.'))
    expect(api.enrollRegistration).not.toHaveBeenCalled()
    fireEvent.change(email, { target: { value: ' Patient.One@Example.TEST ' } })
    fireEvent.click(submit)
    expect(refusal(await screen.findByRole('alert'))).toBe('We couldn’t create the account. They may already have one.')
    await press(submit)
    await waitFor(() => expect(api.enrollRegistration).toHaveBeenCalledTimes(2))
    const [first, second] = api.enrollRegistration.mock.calls
    expect(first?.slice(0, 4)).toEqual([DEMO_HOSPITAL_ID, expect.objectContaining({ caseId: CASE, version: 2 }), 'patient.one@example.test', 'Patient asked for an account'])
    expect(second?.[4]).toBe(first?.[4])
    expect(await screen.findByText('Account created for HID-ZDEMAAA2. They’ll get an email to finish.')).toBeTruthy()
    expect(status().textContent).toBe('Account created. The patient will get an email to set their password.')
    expect(document.activeElement).toBe(heading())
    expect(within(actions()).queryByRole('button', { name: ENROLL_OPENER })).toBeNull()
  })

  it('refuses an enrollment without an email, or with a reason under 8 characters, at its field, and a changed email gets a new key', async () => {
    api.registrationCase.mockResolvedValue(approved)
    api.enrollRegistration.mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce({ patientId: PATIENT, hid: 'HID-ZDEMAAA2', contactVerificationRequired: true, replayed: false })
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: ENROLL_OPENER }))
    const email = screen.getByRole('textbox', { name: 'Their email' })
    const reason = screen.getByRole('textbox', { name: 'Why (for the record)' })
    const submit = within(screen.getByRole('form', { name: ENROLL_OPENER })).getByRole('button', { name: 'Create account' })
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
    expect(refusal(await screen.findByRole('alert'))).toBe('We couldn’t create the account. They may already have one.')
    fireEvent.change(email, { target: { value: 'patient.two@example.test' } })
    await press(submit)
    await waitFor(() => expect(api.enrollRegistration).toHaveBeenCalledTimes(2))
    const [first, second] = api.enrollRegistration.mock.calls
    expect(second?.[2]).toBe('patient.two@example.test')
    expect(second?.[4]).not.toBe(first?.[4])
  })

  it('Refresh reads it again by its ID and keeps focus', async () => {
    api.registrationCase.mockResolvedValue(pending())
    await findCase()
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    const button = screen.getByRole('button', { name: 'Refresh' })
    await press(button)
    expect(api.registrationCase).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, CASE)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    await act(async () => { fireEvent.click(button) })
    expect(api.registrationCase).toHaveBeenCalledTimes(2)
    await act(async () => { reading.reject(new Error('timeout')) })
    expect(refusal(await screen.findByRole('alert'))).toBe('We couldn’t open that registration.')
    expect(document.activeElement).toBe(button)
    expect(heading().textContent).toBe('Earlier registration')
  })

  it('a refusal in one case\'s form does not follow to the next case opened', async () => {
    api.registrationCase.mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending(OTHER_CASE))
    await findCase()
    fireEvent.click(within(actions()).getByRole('button', { name: 'Create Health ID' }))
    const reason = screen.getByRole('textbox', { name: 'Why (for the record)' })
    fireEvent.submit(reason.closest('form')!)
    await waitFor(() => expectRefused(reason, 'Enter a review reason between 8 and 500 characters.'))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.change(caseIdField(), { target: { value: OTHER_CASE } })
    fireEvent.click(openButton())
    await screen.findByRole('heading', { level: 1, name: 'Earlier registration' })
    fireEvent.click(within(actions()).getByRole('button', { name: 'Create Health ID' }))
    expect(screen.getByRole('textbox', { name: 'Why (for the record)' }).getAttribute('aria-invalid')).toBeNull()
  })

  it('offers a step that leads to a page only where it is live: outside the frame, only Register someone else', async () => {
    api.registrationCase.mockResolvedValue(approved)
    await findCase()
    // Parity 2.5: classic's "Register someone else" (Registration.tsx 291) needs no page; no link leads anywhere.
    const next = screen.getByRole('heading', { name: 'Next steps' }).parentElement as HTMLElement
    expect(within(next).getAllByRole('button').map(button => button.textContent)).toEqual(['Register someone else'])
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('Register someone else starts a new registration from a completed case, as classic (parity 2.5)', async () => {
    api.registrationCase.mockResolvedValue(approved)
    await findCase()
    fireEvent.click(screen.getByRole('button', { name: 'Register someone else' }))
    expect(await screen.findByLabelText(/^NIN \(11 digits\)/)).toBeTruthy()
    await waitFor(() => expect(heading().textContent).toBe('New patient registration'))
    expect(document.activeElement).toBe(heading())
    // Nothing of the case goes with it: a new, empty form.
    expect((screen.getByLabelText(/^First name/) as HTMLInputElement).value).toBe('')
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it.each([
    ['a case to review', review],
    ['a case awaiting approval', pending()],
    ['a rejected case, even one with a patient', { ...linked, status: 'rejected' }],
  ])('offers no Register someone else on %s, as classic offers it only once done', async (_name, item) => {
    api.registrationCase.mockResolvedValue(item)
    await findCase()
    expect(screen.queryByRole('button', { name: 'Register someone else' })).toBeNull()
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
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(openButton())
    await screen.findByRole('heading', { level: 1, name: 'Earlier registration' })
    session.facility = 'other'
    view.rerender(<MemoryRouter><div className="hid-ehr"><PatientRegistration /></div></MemoryRouter>)
    expect(heading().textContent).toBe('Patient registration')
    await waitFor(() => expect(api.registrationCapabilities).toHaveBeenLastCalledWith('98d00002-0000-4000-8000-000000000004'))
    // That facility's own list is read, and nothing opened at the last one is listed.
    await waitFor(() => expect(api.listRegistrationCases).toHaveBeenLastCalledWith('98d00002-0000-4000-8000-000000000004', { view: 'mine' }))
    expect(screen.queryByRole('region', { name: 'Opened on this visit' })).toBeNull()
    expect(caseIdField().value).toBe('')
  })

  it('takes no answer for the facility it left', async () => {
    const reading = deferred<unknown>()
    api.registrationCase.mockReturnValueOnce(reading.promise)
    const view = renderDept(<PatientRegistration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(openButton())
    session.facility = 'other'
    view.rerender(<MemoryRouter><div className="hid-ehr"><PatientRegistration /></div></MemoryRouter>)
    await act(async () => { reading.resolve(pending()) })
    expect(heading().textContent).toBe('Patient registration')
    expect(screen.queryByText(CASE)).toBeNull()
    expect((api.registrationCase as Mock).mock.calls).toHaveLength(1)
  })
})

describe('Find … and open their chart', () => {
  // Patients as the clinical registry has it (clinical/pages.ts): live, with patient lookup.
  const PATIENTS: EhrBluePage = { path: 'patients/*', group: 'Clinical', label: 'Patients', permission: 'identity.patient.read', status: 'live', element: <p>Patients</p> }
  const READ = 'identity.patient.read'

  /** What Patients was handed: the navigation state it reads the Health ID from (PatientsWorkspace.tsx). */
  function Handed() {
    const location = useLocation()
    return <p>Patients was handed {JSON.stringify(location.state)}</p>
  }

  /** Patient registration with `open` as the pages this product's site opens to this session (the frame's openHere). */
  async function findCaseWith(open: readonly EhrBluePage[]) {
    render(
      <MemoryRouter initialEntries={['/provider/registration']}>
        <BluePagesProvider value={[PATIENTS]}><OpenPagesProvider value={open}>
          <Routes>
            <Route path="/provider/registration" element={<div className="hid-ehr"><PatientRegistration /></div>} />
            <Route path="/provider/patients" element={<Handed />} />
          </Routes>
        </OpenPagesProvider></BluePagesProvider>
      </MemoryRouter>,
    )
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(openButton())
    return screen.findByRole('heading', { level: 1, name: 'Earlier registration' })
  }

  it('hands a patient whose case has a Health ID on to Patients, with only the Health ID', async () => {
    session.permissions = [WRITE, APPROVE, READ]
    api.registrationCase.mockResolvedValue(linked)
    await findCaseWith([PATIENTS])
    // Parity 2.5: classic's words and order (Registration.tsx 289-291), never the old "Open in Patients".
    const next = screen.getByRole('heading', { name: 'Next steps' }).parentElement as HTMLElement
    expect([...next.querySelectorAll('a, button')].map(control => control.textContent))
      .toEqual(['Find HID-ZDEMAAA2 and open their chart', 'Register someone else'])
    expect(screen.queryByText('Open in Patients')).toBeNull()
    const open = screen.getByRole('link', { name: 'Find HID-ZDEMAAA2 and open their chart' })
    expect(open.getAttribute('href')).toBe('/provider/patients')
    fireEvent.click(open)
    expect(await screen.findByText('Patients was handed {"hid":"HID-ZDEMAAA2"}')).toBeTruthy()
  })

  it('offers it once an account is made, with the Health ID the account was made for', async () => {
    session.permissions = [WRITE, APPROVE, READ]
    // A completed case read without its patient: only the account just made gives the Health ID.
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'approved_new_identity', version: 2, candidateCount: 0 })
    api.enrollRegistration.mockResolvedValue({ patientId: PATIENT, hid: 'HID-ZDEMAAA2', contactVerificationRequired: true, replayed: false })
    await findCaseWith([PATIENTS])
    expect(screen.queryByRole('link', { name: 'Find HID-ZDEMAAA2 and open their chart' })).toBeNull()
    fireEvent.click(within(actions()).getByRole('button', { name: ENROLL_OPENER }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Their email' }), { target: { value: 'patient.one@example.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Why (for the record)' }), { target: { value: 'Patient asked for an account' } })
    fireEvent.click(within(screen.getByRole('form', { name: ENROLL_OPENER })).getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Account created for HID-ZDEMAAA2. They’ll get an email to finish.')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Find HID-ZDEMAAA2 and open their chart' }))
    expect(await screen.findByText('Patients was handed {"hid":"HID-ZDEMAAA2"}')).toBeTruthy()
  })

  it('is not offered for a rejected case, even one with a patient', async () => {
    session.permissions = [WRITE, APPROVE, READ]
    api.registrationCase.mockResolvedValue({ ...linked, status: 'rejected' })
    await findCaseWith([PATIENTS])
    expect(screen.queryByRole('link', { name: 'Find HID-ZDEMAAA2 and open their chart' })).toBeNull()
  })

  it('is not offered to a role that cannot open Patients', async () => {
    session.permissions = [WRITE, APPROVE]
    api.registrationCase.mockResolvedValue(linked)
    await findCaseWith([PATIENTS])
    expect(screen.queryByRole('link', { name: 'Find HID-ZDEMAAA2 and open their chart' })).toBeNull()
  })

  it('is not offered where this product\'s site does not open Patients', async () => {
    session.permissions = [WRITE, APPROVE, READ]
    api.registrationCase.mockResolvedValue(linked)
    await findCaseWith([])
    expect(screen.queryByRole('link', { name: 'Find HID-ZDEMAAA2 and open their chart' })).toBeNull()
  })
})
