import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { findEndpoint } from '@hid/contracts'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InPersonCheckRefusal, InPersonCheckWorkspace, inPersonCheckStatus } from '../../../ehr-blue/clinical/in-person-check/InPersonCheckWorkspace'
import { ASSISTED_REGISTRATION_PERMISSION } from '../../../staff/routes/InPersonCheck'
import { BASE, DEMO_HOSPITAL_ID, FACILITY_ID, labelled, renderPage } from './harness'

/**
 * In-person check: today's staff/routes/InPersonCheck.tsx in the design's create form. Its one call, body, key rules,
 * refusals, answers, focus moves and privacy rules are today's; these tests pin them in the blue page, with fictional
 * values only (Patient One, a made-up desk code).
 */

const api = vi.hoisted(() => ({ assistedVerification: vi.fn() }))
const staff = vi.hoisted(() => ({
  permissions: [] as string[],
  activePatient: null as unknown,
  setActivePatient: vi.fn((_value: unknown) => true),
  facilityId: undefined as string | undefined,
  signOut: vi.fn(),
  ready: true,
}))

vi.mock('../../../staff/api', () => ({ staffApi: api }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return {
    useStaff: () => staff.ready
      ? { ...harness.staffValue(staff as never), signOut: staff.signOut }
      : { state: { status: 'signed-out' }, lock: null, activePatient: null, setActivePatient: staff.setActivePatient, signOut: staff.signOut },
  }
})

const PERMISSION = 'identity.patient.assisted_registration'
const ATTESTATIONS = [
  'The patient is here in person.',
  'I have seen the original document, not a copy or a photo of it.',
  'The photo on the document matches the person in front of me.',
  'The desk code is shown on the patient’s own phone.',
  'The patient agrees to this check against their NIN record.',
]
const DESCRIPTION = 'Check a patient registering on their own phone who cannot receive the code sent to the phone on their NIN record. You check one original photo ID; Health ID compares the details with the NIN record and never shows you the record.'
const DESK_HINT = 'As the patient’s own phone shows it: 10 letters and digits. Spaces, hyphens and case do not matter.'
const DOB_HINT = 'A check without it does not match a NIN record that has one.'
const DESK_CODE_ENTRY = 'Enter the 10-character desk code shown on the patient’s phone.'
const DATE_OF_BIRTH_ENTRY = 'Enter the whole date of birth as written on the document, or clear the field if the document shows none.'
const CONFIRM_ALL = 'Confirm all five statements. If any is not true, do not check this patient.'
const UNAVAILABLE = 'Your role at this facility cannot check patients in person. Doctors, clinicians and nurses at a facility that takes part in registration can. Ask a platform administrator if your role should.'
const RETRY = 'The check could not be completed. Press Check again without changing the details: it is sent as the same check, so it is not counted twice.'
const RETRY_PROOF = 'The check is recorded, but the patient’s registration could not be moved on. Press Check again without changing the details within 10 minutes: it is not counted twice.'
const VERIFIED = 'Checked. The patient can continue on their phone.'
const VERIFIED_NEXT = 'On their own phone they add a phone number or email, choose a password, and then see their Health ID. If the phone still shows the desk code, ask them to open their registration again on that phone.'
const MISMATCH = 'The details do not match the NIN record'
const MISMATCH_NEXT = 'Check the document. If only spelling or spacing differs, such as a hyphen or a space in a name, type it the way the document allows and check again; each check counts toward the daily limit. Otherwise do not register this patient.'
const REGISTERED = 'This person already has a Health ID'
const REGISTERED_NEXT = 'Do not start a new registration for them. Their registration on the phone has ended; account recovery lets them sign in to the Health ID they have.'
/** Fictional values: a made-up desk code as a phone might show it, and Patient One. */
const TYPED_CODE = '7k3m-9q2x wd'
const SENT_CODE = '7K3M9Q2XWD'
const TYPED = /\bPatient\b|\bOne\b|7K3M9Q2XWD|7k3m-9q2x wd|1990-04-12/

const problem = (status: number, code: string, detail: string, fields?: Record<string, string>) =>
  new HidApiError(status, detail, { code, requestId: `corr-${status}`, ...(fields ? { fields } : {}) })

let storageWrites: string[]
let seen: Array<{ pathname: string; search: string; hash: string; state: unknown }>

function Probe() {
  const location = useLocation()
  seen.push({ pathname: location.pathname, search: location.search, hash: location.hash, state: location.state })
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  api.assistedVerification.mockReset()
  staff.permissions = [PERMISSION]
  staff.facilityId = undefined
  staff.ready = true
  storageWrites = []
  seen = []
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => { storageWrites.push(key) })
})

afterEach(() => {
  // Nothing typed or answered is kept in storage, the address or router state, nor named in the tab.
  expect(storageWrites).toEqual([])
  for (const location of seen) {
    expect(location.pathname).toMatch(/^\/provider\/in-person-check(\/[a-z-]+)?$/)
    expect(location.search).toBe('')
    expect(location.hash).toBe('')
    expect(location.state).toBeNull()
  }
  expect(document.title).not.toMatch(TYPED)
})

function open(rest = '') {
  return renderPage(<><InPersonCheckWorkspace /><Probe /></>, 'in-person-check', rest)
}

/** The page in a router that a re-render keeps, so a facility change can be shown. */
function tree() {
  return (
    <MemoryRouter initialEntries={[`${BASE}/in-person-check`]}>
      <Routes><Route path={`${BASE}/in-person-check/*`} element={<><InPersonCheckWorkspace /><Probe /></>} /></Routes>
    </MemoryRouter>
  )
}

const deskCode = () => screen.getByRole('textbox', { name: labelled('Desk code') }) as HTMLInputElement
const documentType = () => screen.getByRole('combobox', { name: labelled('Document checked') }) as HTMLSelectElement
const firstName = () => screen.getByRole('textbox', { name: labelled('First name') }) as HTMLInputElement
const lastName = () => screen.getByRole('textbox', { name: labelled('Last name') }) as HTMLInputElement
const dateOfBirth = () => screen.getByLabelText('Date of birth (if the document shows one)') as HTMLInputElement
const statement = (label: string) => screen.getByRole('checkbox', { name: labelled(label) }) as HTMLInputElement
const checkButton = () => screen.getByRole('button', { name: /^Check (the details|again)$/ }) as HTMLButtonElement
const sentKeys = () => api.assistedVerification.mock.calls.map(call => call[2] as string)

function fill(values: { code?: string; type?: string; first?: string; last?: string; dob?: string; attest?: number } = {}) {
  fireEvent.change(deskCode(), { target: { value: values.code ?? TYPED_CODE } })
  fireEvent.change(documentType(), { target: { value: values.type ?? 'national_id_card' } })
  fireEvent.change(firstName(), { target: { value: values.first ?? ' Patient ' } })
  fireEvent.change(lastName(), { target: { value: values.last ?? 'One' } })
  fireEvent.change(dateOfBirth(), { target: { value: values.dob ?? '1990-04-12' } })
  for (const label of ATTESTATIONS.slice(0, values.attest ?? 5)) {
    const box = statement(label)
    if (!box.checked) fireEvent.click(box)
  }
}

function submit() {
  fireEvent.click(checkButton())
}

/** The text of what describes a control (aria-describedby), id by id. */
function descriptions(control: HTMLElement) {
  return (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent)
}

/** Everything on the page a person could read, typed values included. */
function shown() {
  const values = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].map(control => control.value)
  return [document.body.textContent ?? '', ...values].join(' ')
}

describe('the In-person check page: today’s page in the design', () => {
  it('is live, and asks the contracts registry for the permission today’s page and the sidebar use', () => {
    expect(inPersonCheckStatus).toBe('live')
    expect(findEndpoint('identity.assistedVerifications')?.permissions?.POST).toEqual([ASSISTED_REGISTRATION_PERMISSION])
    expect(ASSISTED_REGISTRATION_PERMISSION).toBe(PERMISSION)
  })

  it('shows today’s heading in the design’s page heading, and names the tab after the page only', () => {
    document.title = ''
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'In-person check' })).toBeTruthy()
    expect(screen.getByText('Identity operations').className).toContain('hid-ehr-page-eyebrow')
    expect(screen.getByText(DESCRIPTION).className).toContain('hid-ehr-page-description')
    expect(document.title).toBe('In-person check · Health ID EHR')
  })

  it('has no loading or empty state: the form shows at once and nothing is read or sent on open', () => {
    open()
    expect(screen.getByRole('heading', { level: 2, name: 'Check a patient' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it.each([
    ['a role without the permission', () => { staff.permissions = ['identity.patient.read'] }],
    ['no working facility', () => { staff.ready = false }],
  ])('refuses %s in today’s words, drawn as the frame’s refusal page, and sends nothing', (_label, arrange) => {
    arrange()
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'In-person check' })).toBeTruthy()
    const title = screen.getByText('In-person check unavailable')
    expect(title.className).toContain('hid-ehr-state-title')
    expect(screen.getByText(UNAVAILABLE).className).toContain('hid-ehr-state-message')
    expect(screen.queryByRole('textbox', { name: labelled('Desk code') })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('offers today’s refusal as a page of its own for the frame, which makes no request', () => {
    render(<MemoryRouter initialEntries={[`${BASE}/in-person-check`]}><InPersonCheckRefusal /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'In-person check' })).toBeTruthy()
    expect(screen.getByText('In-person check unavailable')).toBeTruthy()
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy()
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('has no page below its address: the design’s “Record not found”, back to the check', () => {
    open('/somewhere')
    expect(screen.getByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: labelled('Desk code') })).toBeNull()
  })

  it('asks for the desk code, the method, the document, the names, an optional date of birth and five statements', () => {
    open()
    const card = screen.getByRole('region', { name: 'Check a patient' })
    expect(card.className).toContain('hid-ehr-card')
    const form = card.querySelector('form')!
    expect(form.noValidate).toBe(true)
    expect(form.querySelector(':scope > .hid-ehr-clinical-form-grid')).toBeTruthy()

    const code = deskCode()
    expect(code.id).toBe('in-person-desk-code')
    expect(code.name).toBe('deskCode')
    expect(code.required).toBe(true)
    expect(code.maxLength).toBe(20)
    expect(code.getAttribute('autocomplete')).toBe('off')
    expect(code.getAttribute('autocapitalize')).toBe('characters')
    expect(code.getAttribute('spellcheck')).toBe('false')
    expect(descriptions(code)).toEqual([DESK_HINT])
    // The design's required marker, hidden from the accessible name.
    expect(screen.getByText('Desk code').closest('label')!.querySelector('[aria-hidden="true"]')!.textContent).toBe(' *')

    const method = within(screen.getByRole('group', { name: 'Method' })).getByRole('radio', { name: 'Original government photo ID, checked in person' }) as HTMLInputElement
    expect(method.checked).toBe(true)
    expect(method.value).toBe('government_photo_id_in_person')

    const documents = within(documentType()).getAllByRole('option')
    expect(documents.map(option => option.textContent)).toEqual(['Choose the document', 'National ID card', 'International passport', 'Driver’s licence', 'Voter’s card'])
    expect(documents.map(option => (option as HTMLOptionElement).value)).toEqual(['', 'national_id_card', 'international_passport', 'drivers_licence', 'voters_card'])
    expect(documentType().required).toBe(true)

    const written = screen.getByRole('group', { name: 'As written on the document' })
    expect(within(written).getByRole('textbox', { name: labelled('First name') })).toBe(firstName())
    expect(within(written).getByRole('textbox', { name: labelled('Last name') })).toBe(lastName())
    expect(within(written).getByLabelText('Date of birth (if the document shows one)')).toBe(dateOfBirth())
    for (const name of [firstName(), lastName()]) {
      expect(name.required).toBe(true)
      expect(name.maxLength).toBe(100)
      expect(name.getAttribute('autocomplete')).toBe('off')
      expect(name.getAttribute('spellcheck')).toBe('false')
    }
    expect(dateOfBirth().type).toBe('date')
    expect(dateOfBirth().required).toBe(false)
    expect(dateOfBirth().getAttribute('autocomplete')).toBe('off')
    expect(descriptions(dateOfBirth())).toEqual([DOB_HINT])

    const statements = screen.getByRole('group', { name: 'Confirm each statement' })
    expect(within(statements).getAllByRole('checkbox').map(box => box.closest('label')!.textContent)).toEqual(ATTESTATIONS.map(text => `${text} *`))
    for (const text of ATTESTATIONS) expect(statement(text).checked).toBe(false)
    // The design's checkbox: the text, then the box.
    const label = statement(ATTESTATIONS[0]!).closest('label')!
    expect(label.className).toBe('hid-ehr-clinical-checkbox')
    expect(label.lastElementChild).toBe(statement(ATTESTATIONS[0]!))

    const button = checkButton()
    expect(button.textContent).toBe('Check the details')
    expect(button.type).toBe('submit')
    expect(button.closest('.hid-ehr-clinical-form-footer')).toBeTruthy()
  })

  it('is used from the keyboard in today’s order, with only native controls and no positive tab stops', () => {
    open()
    const form = screen.getByRole('region', { name: 'Check a patient' }).querySelector('form')!
    const stops = [...form.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]')].filter(element => element.tabIndex >= 0)
    expect(stops).toEqual([
      deskCode(), screen.getByRole('radio'), documentType(), firstName(), lastName(), dateOfBirth(),
      ...ATTESTATIONS.map(statement), checkButton(),
    ])
    expect(document.querySelectorAll('[tabindex]:not([tabindex="-1"])').length).toBe(0)
    // Space on a statement ticks it (a native checkbox), and Enter in a field submits the form.
    fireEvent.click(statement(ATTESTATIONS[2]!))
    expect(statement(ATTESTATIONS[2]!).checked).toBe(true)
  })

  it('sends the desk code as the phone shows it, the typed names and each statement, with a submission key', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    open()
    fill()
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    const [facilityId, input, key] = api.assistedVerification.mock.calls[0]!
    expect(facilityId).toBe(FACILITY_ID)
    expect(input).toEqual({
      deskCode: SENT_CODE, method: 'government_photo_id_in_person', documentType: 'national_id_card',
      document: { firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-04-12' },
      attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true,
        codeShownOnPatientsOwnDevice: true, patientConsents: true },
    })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(api.assistedVerification.mock.calls[0]).toHaveLength(3)
  })

  it('reads the look-alike letters as Identity does and sends at the demo facility it works at', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    staff.facilityId = DEMO_HOSPITAL_ID
    open()
    fill({ code: 'o1il-abcde f' })
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    expect(api.assistedVerification.mock.calls[0]![0]).toBe(DEMO_HOSPITAL_ID)
    expect(api.assistedVerification.mock.calls[0]![1].deskCode).toBe('0111ABCDEF')
  })

  it('leaves the date of birth out when none was typed', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    open()
    fill({ dob: '' })
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    expect(api.assistedVerification.mock.calls[0]![1].document).toEqual({ firstName: 'Patient', lastName: 'One' })
  })

  it.each([
    ['no desk code', { code: '' }, deskCode, DESK_CODE_ENTRY],
    ['a desk code with a U', { code: '7K3M9Q2XWU' }, deskCode, DESK_CODE_ENTRY],
    ['a short desk code', { code: '7K3M9' }, deskCode, DESK_CODE_ENTRY],
    ['no document', { type: '' }, documentType, 'Choose the document you checked.'],
    ['no first name', { first: '  ' }, firstName, 'Enter the first name as written on the document.'],
    ['no last name', { last: '' }, lastName, 'Enter the last name as written on the document.'],
  ])('refuses %s at its field before sending, in the design’s field error', async (_label, values, field, message) => {
    open()
    fill(values)
    submit()
    const control = field()
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(control.getAttribute('aria-invalid')).toBe('true')
    // The error replaces the hint, as today: the control is described by the message alone.
    expect(descriptions(control)).toEqual([message])
    expect(document.getElementById(control.getAttribute('aria-describedby')!)!.className).toContain('hid-ehr-error')
    expect(screen.queryByText('Complete this field.')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('refuses a partly typed date of birth at its field before sending, rather than leaving it out', async () => {
    open()
    fill({ dob: '' })
    const date = dateOfBirth()
    Object.defineProperty(date, 'validity', { configurable: true, value: { ...date.validity, badInput: true, valid: false } })
    submit()
    await waitFor(() => expect(document.activeElement).toBe(date))
    expect(date.getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(date)).toEqual([DATE_OF_BIRTH_ENTRY])
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('refuses a check until every statement is confirmed, at the group, with focus on the first one left', async () => {
    open()
    fill({ attest: 3 })
    submit()
    const fourth = statement(ATTESTATIONS[3]!)
    await waitFor(() => expect(document.activeElement).toBe(fourth))
    const group = screen.getByRole('group', { name: 'Confirm each statement' })
    expect(group.id).toBe('in-person-attestations')
    expect(descriptions(group)).toEqual([CONFIRM_ALL])
    expect(document.getElementById('in-person-attestations-error')!.className).toBe('hid-ehr-clinical-field-error')
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('says one problem at a time, in today’s order, and the last one goes on the next press', async () => {
    open()
    submit()
    await waitFor(() => expect(document.activeElement).toBe(deskCode()))
    const order: Array<[() => HTMLElement, string, () => void]> = [
      [documentType, 'Choose the document you checked.', () => fireEvent.change(deskCode(), { target: { value: TYPED_CODE } })],
      [firstName, 'Enter the first name as written on the document.', () => fireEvent.change(documentType(), { target: { value: 'voters_card' } })],
      [lastName, 'Enter the last name as written on the document.', () => fireEvent.change(firstName(), { target: { value: 'Patient' } })],
      [statement.bind(null, ATTESTATIONS[0]!), CONFIRM_ALL, () => fireEvent.change(lastName(), { target: { value: 'One' } })],
    ]
    for (const [field, message, fix] of order) {
      fix()
      submit()
      await waitFor(() => expect(document.activeElement).toBe(field()))
      expect(screen.getByText(message)).toBeTruthy()
      expect(document.querySelectorAll('[aria-invalid="true"], .hid-ehr-clinical-field-error').length).toBe(1)
    }
    expect(deskCode().getAttribute('aria-invalid')).toBeNull()
    expect(descriptions(deskCode())).toEqual([DESK_HINT])
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it.each([
    ['the desk code', deskCode, { code: '' }, DESK_CODE_ENTRY],
    ['the date of birth', dateOfBirth, { dob: '' }, DATE_OF_BIRTH_ENTRY],
  ])('says a refusal from Enter in %s as a new alert there, without moving focus', async (_label, field, values, message) => {
    open()
    fill(values)
    const control = field()
    if (control === dateOfBirth()) {
      Object.defineProperty(control, 'validity', { configurable: true, value: { ...control.validity, badInput: true, valid: false } })
    }
    control.focus()
    fireEvent.submit(control.form!)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(message)
    expect(alert.closest('p')!.id).toBe(control.getAttribute('aria-describedby'))
    expect(document.activeElement).toBe(control)
    // Again: a new alert, so it is said again.
    fireEvent.submit(control.form!)
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(alert))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(document.activeElement).toBe(control)
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('says a statement refusal from Enter on a statement as an alert at the group, without moving focus', async () => {
    open()
    fill({ attest: 4 })
    const first = statement(ATTESTATIONS[0]!)
    first.focus()
    fireEvent.submit(first.form!)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(CONFIRM_ALL)
    expect(document.getElementById('in-person-attestations-error')!.contains(alert)).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('says the patient continues on their phone after a match, without any typed value, and starts afresh', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    open()
    fill()
    submit()
    const heading = await screen.findByRole('heading', { level: 2, name: VERIFIED })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    // The design's info Banner, with its title as the heading that takes focus.
    const banner = screen.getByRole('region', { name: VERIFIED })
    expect(banner.className).toContain('hid-ehr-clinical-banner')
    expect(banner.className).not.toContain('hid-ehr-clinical-banner-warning')
    expect(within(banner).getByText(VERIFIED_NEXT)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: labelled('Desk code') })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Check a patient' })).toBeNull()
    expect(shown()).not.toMatch(TYPED)
    fireEvent.click(within(banner).getByRole('button', { name: 'Check another patient' }))
    const form = await screen.findByRole('heading', { level: 2, name: 'Check a patient' })
    await waitFor(() => expect(document.activeElement).toBe(form))
    expect(deskCode().value).toBe('')
    expect(firstName().value).toBe('')
    expect(documentType().value).toBe('')
    expect(statement(ATTESTATIONS[0]!).checked).toBe(false)
    expect(checkButton().textContent).toBe('Check the details')
  })

  it('shows which field differed, never a record value, keeps the typed details and checks a correction with a new key', async () => {
    api.assistedVerification
      .mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'The details on the document do not match the NIN record.',
        { firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' }))
      .mockResolvedValueOnce({ outcome: 'verified' })
    open()
    fill()
    submit()
    const heading = await screen.findByRole('heading', { level: 2, name: MISMATCH })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const banner = screen.getByRole('region', { name: MISMATCH })
    expect(banner.className).toContain('hid-ehr-clinical-banner-warning')
    const results = within(banner).getByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'First name: matches',
      'Last name: does not match',
      'Date of birth: not on the NIN record, so not compared',
    ])
    expect(within(banner).getByText(MISMATCH_NEXT)).toBeTruthy()
    expect(document.body.textContent).not.toContain('The details on the document do not match the NIN record.')
    expect(screen.queryByRole('alert')).toBeNull()
    // The banner sits above the form, which keeps the typed details for correction.
    expect(banner.compareDocumentPosition(deskCode()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lastName().value).toBe('One')
    expect(deskCode().value).toBe(TYPED_CODE)
    fill({ last: 'One-Two' })
    submit()
    await waitFor(() => expect(screen.queryByRole('region', { name: MISMATCH })).toBeNull())
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('shows no result, never the value, for a field whose answer is not one of the three result words', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.',
      { firstName: 'match', lastName: 'ONE', dateOfBirth: '1988-01-15' }))
    open()
    fill()
    submit()
    const results = await screen.findByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'First name: matches',
      'Last name: no result given',
      'Date of birth: no result given',
    ])
    expect(document.body.textContent).not.toMatch(/ONE|1988-01-15/)
  })

  it('says no result for each field when the answer names none', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.'))
    open()
    fill()
    submit()
    const results = await screen.findByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'First name: no result given', 'Last name: no result given', 'Date of birth: no result given',
    ])
  })

  it('says a date of birth was needed when none was typed and the record has one', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.',
      { firstName: 'match', lastName: 'match', dateOfBirth: 'no_match' }))
    open()
    fill({ dob: '' })
    submit()
    const results = await screen.findByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem')[2]!.textContent)
      .toBe('Date of birth: does not match. None was typed; type the date of birth on the document.')
  })

  it.each([
    ['503 ASSISTED_VERIFICATION_UNAVAILABLE', problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'The in-person check could not be completed. Try again.'), RETRY],
    ['503 ENROLLMENT_RECONCILIATION_REQUIRED', problem(503, 'ENROLLMENT_RECONCILIATION_REQUIRED', 'The service could not complete the request.'), RETRY_PROOF],
    ['503 ENROLLMENT_UNAVAILABLE', problem(503, 'ENROLLMENT_UNAVAILABLE', 'The service could not complete the request.'), RETRY_PROOF],
    ['500 INTERNAL_ERROR', problem(500, 'INTERNAL_ERROR', 'Something went wrong.'), RETRY],
    ['a lost connection', new HidApiError(0, 'We could not reach the service. Check your connection and try again.', { code: 'NETWORK_ERROR' }), RETRY],
    ['a timeout', new HidApiError(408, 'The request took too long.', { code: 'REQUEST_TIMEOUT' }), RETRY],
    ['an unexpected failure', new TypeError('Failed to read the answer'), RETRY],
  ])('after %s, says so in the design’s error box, checks again with the same key and never signs out', async (_label, failure, shownText) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    open()
    fill()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(shownText)
    expect(alert.className).toBe('hid-ehr-clinical-alert')
    // The design's place: inside the form, before the footer; focus stays on the button.
    expect(alert.nextElementSibling!.className).toBe('hid-ehr-clinical-form-footer')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(checkButton().textContent).toBe('Check again')
    expect(deskCode().value).toBe(TYPED_CODE)
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).toBe(first)
    expect(staff.signOut).not.toHaveBeenCalled()
  })

  it('takes a new key once the details change after a 503, and says “Check the details” again', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    open()
    fill()
    submit()
    await screen.findByRole('alert')
    expect(checkButton().textContent).toBe('Check again')
    fill({ first: 'Pat' })
    expect(checkButton().textContent).toBe('Check the details')
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('says the route is closed while it is switched off, as a final answer, and never signs out', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_REGISTRATION_DISABLED', 'Registration at a facility is not available.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    open()
    fill()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Registration at a facility is not available. Nothing was recorded.')
    expect(checkButton().textContent).toBe('Check the details')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(staff.signOut).not.toHaveBeenCalled()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it.each([
    ['ASSISTED_REGISTRATION_NOT_AUTHORIZED', 'You cannot register patients in person at this facility.',
      'You cannot register patients in person at this facility. Ask a platform administrator: the facility must take part, and you need an active account, a sign-in confirmed with your authenticator, an attested clinical grant and an active membership here.'],
    ['PERMISSION_DENIED', 'Required permission is missing',
      'Your role at this facility cannot check patients in person. Ask a platform administrator.'],
  ])('explains 403 %s in today’s words without signing out, and keeps the details', async (code, detail, shownText) => {
    api.assistedVerification.mockRejectedValueOnce(problem(403, code, detail)).mockResolvedValueOnce({ outcome: 'verified' })
    open()
    fill()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe(shownText)
    expect(checkButton().textContent).toBe('Check the details')
    expect(firstName().value).toBe(' Patient ')
    expect(staff.signOut).not.toHaveBeenCalled()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('directs a person who already has a Health ID to account recovery, with the reference, and shows no Health ID', async () => {
    const detail = 'This person already has a Health ID. Direct them to account recovery. If they say they never registered, ask Health ID support to review, quoting reference corr-original.'
    api.assistedVerification.mockRejectedValueOnce(problem(409, 'NIN_ALREADY_REGISTERED', detail))
    open()
    fill()
    submit()
    const heading = await screen.findByRole('heading', { level: 2, name: REGISTERED })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const banner = screen.getByRole('region', { name: REGISTERED })
    expect(banner.className).toContain('hid-ehr-clinical-banner-warning')
    expect(within(banner).getByText(detail)).toBeTruthy()
    expect(within(banner).getByText(REGISTERED_NEXT)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: labelled('Desk code') })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(shown()).not.toMatch(/HID-/)
    expect(shown()).not.toMatch(TYPED)
    fireEvent.click(within(banner).getByRole('button', { name: 'Check another patient' }))
    const form = await screen.findByRole('heading', { name: 'Check a patient' })
    await waitFor(() => expect(document.activeElement).toBe(form))
    expect(deskCode().value).toBe('')
  })

  it.each([
    ['404 DESK_CODE_NOT_FOUND', problem(404, 'DESK_CODE_NOT_FOUND', 'No registration is waiting for this desk code. Ask the patient to show the code on their phone again.'),
      'No registration is waiting for this desk code. Ask the patient to show the code on their phone again.'],
    ['400 DESK_CODE_INVALID', problem(400, 'DESK_CODE_INVALID', 'Enter the 10-character desk code shown on the patient\'s phone.'),
      'Enter the 10-character desk code shown on the patient\'s phone.'],
    ['409 ASSISTED_VERIFICATION_STALE', problem(409, 'ASSISTED_VERIFICATION_STALE', 'Stale.'),
      'This desk code can no longer be checked: another check came first, or the patient has a new code. Ask the patient for the code on their phone now, then check again.'],
  ])('reports %s at the desk code, and checks a new code with a new key', async (_label, failure, message) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    open()
    fill()
    submit()
    const code = deskCode()
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(code.getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(code)).toEqual([message])
    expect(screen.queryByRole('alert')).toBeNull()
    fill({ code: 'ABCDEFGHJK' })
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('reports a desk code answer pressed with Enter in the desk code as an alert there, without moving focus', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(409, 'ASSISTED_VERIFICATION_STALE', 'Stale.'))
    open()
    fill()
    deskCode().focus()
    fireEvent.submit(deskCode().form!)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^This desk code can no longer be checked/)
    expect(document.activeElement).toBe(deskCode())
  })

  it.each([
    ['429 ASSISTED_VERIFICATION_LIMITED', problem(429, 'ASSISTED_VERIFICATION_LIMITED', 'The daily limit of in-person checks is reached. Try again later.'),
      'The daily limit of in-person checks is reached. Try again later.'],
    ['409 IDEMPOTENCY_KEY_REUSED', problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This retry key belongs to a different request'),
      'This check was already sent with other details. Check the details, then send them again.'],
    ['another refusal, in Identity’s words', problem(410, 'DESK_CODE_EXPIRED', 'This desk code has expired. Ask the patient for a new one.'),
      'This desk code has expired. Ask the patient for a new one.'],
  ])('reports %s and sends the next check with a new key', async (_label, failure, shownText) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    open()
    fill()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe(shownText)
    expect(checkButton().textContent).toBe('Check the details')
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('reports a 400 VALIDATION_FAILED with each refused field, marks the field it names and leaves focus where it was', async () => {
    api.assistedVerification.mockRejectedValueOnce(new HidApiError(400, 'Some details were not accepted.', {
      code: 'VALIDATION_FAILED',
      details: [{ field: 'deskCode', messages: ['deskCode must be shorter than or equal to 20 characters'] }, { field: 'document', messages: [] }],
    }))
    open()
    fill()
    const button = checkButton()
    button.focus()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Some details were not accepted. Desk code must be shorter than or equal to 20 characters. Document was refused.')
    expect(deskCode().getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(deskCode())).toEqual(['Desk code must be shorter than or equal to 20 characters.'])
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(document.activeElement).toBe(button)
    expect(checkButton().textContent).toBe('Check the details')
  })

  it('shows nothing when the session ends while the check runs', async () => {
    api.assistedVerification.mockRejectedValueOnce(new HidApiError(0, 'The request was cancelled.', { code: 'REQUEST_CANCELLED' }))
    open()
    fill()
    submit()
    await waitFor(() => expect(checkButton().textContent).toBe('Check the details'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { name: VERIFIED })).toBeNull()
    expect(deskCode().value).toBe(TYPED_CODE)
  })

  it('keeps the button focusable and says it is checking while the check runs; a second press sends nothing', async () => {
    let answer: (value: unknown) => void = () => {}
    api.assistedVerification.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    open()
    fill()
    submit()
    const button = await screen.findByRole('button', { name: 'Checking…' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    // As today: the typed fields are read-only while it runs; nothing is disabled.
    for (const control of [deskCode(), firstName(), lastName(), dateOfBirth()]) expect(control.readOnly).toBe(true)
    expect(document.querySelectorAll(':disabled').length).toBe(0)
    fireEvent.click(button)
    fireEvent.submit(button.closest('form')!)
    expect(api.assistedVerification).toHaveBeenCalledOnce()
    await act(async () => { answer({ outcome: 'verified' }) })
    await screen.findByRole('heading', { name: VERIFIED })
  })

  it('starts afresh at another facility', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    const { rerender } = render(tree())
    fill()
    submit()
    await screen.findByRole('alert')
    staff.facilityId = DEMO_HOSPITAL_ID
    rerender(tree())
    expect(deskCode().value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(checkButton().textContent).toBe('Check the details')
    fill()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    expect(api.assistedVerification.mock.calls[0]![0]).toBe(FACILITY_ID)
    expect(api.assistedVerification.mock.calls[1]![0]).toBe(DEMO_HOSPITAL_ID)
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('never puts a typed value in the address, router state, storage or tab title', async () => {
    document.title = ''
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.', { firstName: 'no_match' }))
    open()
    fill()
    submit()
    await screen.findByRole('list', { name: 'Result for each detail' })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(location => location.pathname === '/provider/in-person-check')).toBe(true)
    expect(document.title).toBe('In-person check · Health ID EHR')
  })
})
