import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { InPersonCheck } from './InPersonCheck'

const api = vi.hoisted(() => ({ assistedVerification: vi.fn() }))
const staff = vi.hoisted(() => ({
  permissions: ['identity.patient.assisted_registration'] as string[],
  facilityId: 'facility-1',
  signOut: vi.fn(),
}))

vi.mock('../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { facility: { id: staff.facilityId, permissions: staff.permissions } } } },
    signOut: staff.signOut, lock: null,
  }),
}))
vi.mock('../api', () => ({ staffApi: api }))

const problem = (status: number, code: string, detail: string, fields?: Record<string, string>) =>
  new HidApiError(status, detail, { code, requestId: `corr-${status}`, ...(fields ? { fields } : {}) })

const ATTESTATIONS = [
  'The patient is here in person.',
  'I’ve seen the original ID, not a copy or photo.',
  'The photo on the ID is this person.',
  'The code is on their own phone.',
  'They agree to this check against their NIN.',
]
const DESK_CODE = /^Code/
const DOCUMENT = /^Which ID\?/
const VERIFIED = 'Checked'
/** An alert's words after its spoken intent and title. */
const alertBody = (alert: HTMLElement) => alert.textContent!.replace(/^Error: That didn’t work/, '')

function fill(values: { code?: string; type?: string; first?: string; last?: string; dob?: string; attest?: number } = {}) {
  fireEvent.change(screen.getByRole('textbox', { name: DESK_CODE }), { target: { value: values.code ?? '7k3m-9q2x wd' } })
  fireEvent.change(screen.getByRole('combobox', { name: DOCUMENT }), { target: { value: values.type ?? 'national_id_card' } })
  fireEvent.change(screen.getByRole('textbox', { name: /First name/ }), { target: { value: values.first ?? ' Synthetic-Ada ' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Last name/ }), { target: { value: values.last ?? 'Okafor' } })
  fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: values.dob ?? '1990-04-02' } })
  for (const label of ATTESTATIONS.slice(0, values.attest ?? 5)) {
    const box = screen.getByRole('checkbox', { name: label }) as HTMLInputElement
    if (!box.checked) fireEvent.click(box)
  }
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /^Check (details|again)$/ }))
const sentKeys = () => api.assistedVerification.mock.calls.map(call => call[2] as string)

let storageWrites: string[]
beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = ['identity.patient.assisted_registration']
  staff.facilityId = 'facility-1'
  storageWrites = []
  for (const storage of [localStorage, sessionStorage]) {
    vi.spyOn(storage, 'setItem').mockImplementation((key: string) => { storageWrites.push(key) })
  }
})
afterEach(() => {
  // Nothing typed or answered is kept in storage or in the address.
  expect(storageWrites).toEqual([])
  expect(window.location.search).toBe('')
  expect(window.location.hash).toBe('')
})

describe('the staff in-person check (hid-system #85, ADR-063)', () => {
  it('is unavailable to a role without the permission, and sends nothing', () => {
    staff.permissions = ['identity.patient.read']
    render(<InPersonCheck />)
    expect(screen.getByRole('heading', { level: 1, name: 'You can’t check patients in person here' })).toBeTruthy()
    expect(screen.getByText(/doctors and nurses/i)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: DESK_CODE })).toBeNull()
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('asks for the desk code, the document, the names, an optional date of birth and five statements; the method is fixed, not a choice', () => {
    // The redesign says the one method (an original photo ID seen in person) instead of offering it as a single radio;
    // the request still names it (see the next test).
    render(<InPersonCheck />)
    expect(screen.getByRole('heading', { level: 1, name: 'Check a patient in person' })).toBeTruthy()
    expect(screen.getByText(/You check their photo ID/)).toBeTruthy()
    expect(screen.getByText('The original, not a copy or a photo of it.')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('textbox', { name: DESK_CODE })).toBeTruthy()
    const documents = within(screen.getByRole('combobox', { name: DOCUMENT })).getAllByRole('option')
    expect(documents.map(option => option.textContent)).toEqual(['Choose',
      'National ID card', 'International passport', 'Driver’s licence', 'Voter’s card'])
    expect(screen.getByRole('textbox', { name: /First name/ })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Last name/ })).toBeTruthy()
    expect((screen.getByLabelText(/Date of birth/) as HTMLInputElement).required).toBe(false)
    for (const label of ATTESTATIONS) expect(screen.getByRole('checkbox', { name: label })).toBeTruthy()
  })

  it('sends the desk code as the phone shows it, the typed names and each statement, with a submission key', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    const [facilityId, input, key] = api.assistedVerification.mock.calls[0]!
    expect(facilityId).toBe('facility-1')
    expect(input).toEqual({
      deskCode: '7K3M9Q2XWD', method: 'government_photo_id_in_person', documentType: 'national_id_card',
      document: { firstName: 'Synthetic-Ada', lastName: 'Okafor', dateOfBirth: '1990-04-02' },
      attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true,
        codeShownOnPatientsOwnDevice: true, patientConsents: true },
    })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('leaves the date of birth out when none was typed', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill({ dob: '' })
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    expect(api.assistedVerification.mock.calls[0]![1].document).toEqual({ firstName: 'Synthetic-Ada', lastName: 'Okafor' })
  })

  it.each([
    ['no desk code', { code: '' }, DESK_CODE, 'Type the 10-character code on their phone.'],
    ['a desk code with a U', { code: '7K3M9Q2XWU' }, DESK_CODE, 'Type the 10-character code on their phone.'],
    ['a short desk code', { code: '7K3M9' }, DESK_CODE, 'Type the 10-character code on their phone.'],
    ['no document', { type: '' }, DOCUMENT, 'Choose which ID you looked at.'],
    ['no first name', { first: '  ' }, /First name/, 'Type the first name as it is on the ID.'],
    ['no last name', { last: '' }, /Last name/, 'Type the last name as it is on the ID.'],
  ])('refuses %s at its field before sending', async (_label, values, field, message) => {
    render(<InPersonCheck />)
    fill(values)
    submit()
    const control = screen.getByLabelText(field)
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe(message)
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('refuses a partly typed date of birth at its field before sending, rather than leaving it out', async () => {
    // A date control holding an unfinished or impossible date reports no value, and says so only in its validity.
    render(<InPersonCheck />)
    fill({ dob: '' })
    const date = screen.getByLabelText(/Date of birth/) as HTMLInputElement
    Object.defineProperty(date, 'validity', { configurable: true, value: { ...date.validity, badInput: true, valid: false } })
    submit()
    await waitFor(() => expect(document.activeElement).toBe(date))
    expect(date.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(date.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Type the full date as it is on the ID, or leave it empty if there isn’t one.')
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('refuses a check until every statement is confirmed, and says why', async () => {
    render(<InPersonCheck />)
    fill({ attest: 3 })
    submit()
    const fourth = screen.getByRole('checkbox', { name: ATTESTATIONS[3]! })
    await waitFor(() => expect(document.activeElement).toBe(fourth))
    expect(screen.getByText('Tick all five. If any isn’t true, stop here.')).toBeTruthy()
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('says the patient continues on their phone after a match, without any record value, and starts afresh', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    const heading = await screen.findByRole('heading', { name: VERIFIED })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText(/They can finish on their phone now/)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: DESK_CODE })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Synthetic-Ada|Okafor|7K3M9Q2XWD/)
    fireEvent.click(screen.getByRole('button', { name: 'Check another patient' }))
    const form = await screen.findByRole('heading', { name: 'Check a patient' })
    await waitFor(() => expect(document.activeElement).toBe(form))
    expect((screen.getByRole('textbox', { name: DESK_CODE }) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('checkbox', { name: ATTESTATIONS[0]! }) as HTMLInputElement).checked).toBe(false)
  })

  it('shows which field differed, never a record value, and checks a correction with a new key', async () => {
    api.assistedVerification
      .mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'The details on the document do not match the NIN record.',
        { firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' }))
      .mockResolvedValueOnce({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    // The result is a warning alert titled with the answer; focus moves to that title, said once to screen readers.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The details don’t match their NIN')
    await waitFor(() => expect(document.activeElement?.textContent).toBe('The details don’t match their NIN'))
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
    const results = screen.getByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'First name: matches',
      'Last name: doesn’t match',
      'Date of birth: not on their NIN, so not checked',
    ])
    expect(screen.getByText(/If only a space or hyphen differs/)).toBeTruthy()
    // The typed details stay for correction.
    expect((screen.getByRole('textbox', { name: /Last name/ }) as HTMLInputElement).value).toBe('Okafor')
    fill({ last: 'Okafor-Eze' })
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('shows no result, never the value, for a field whose answer is not one of the three result words', async () => {
    // The contract sends only match, no_match or not_in_record; anything else, such as a record value, is not shown.
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.',
      { firstName: 'match', lastName: 'OKAFOR', dateOfBirth: '1988-01-15' }))
    render(<InPersonCheck />)
    fill()
    submit()
    const results = await screen.findByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'First name: matches',
      'Last name: no result given',
      'Date of birth: no result given',
    ])
    expect(document.body.textContent).not.toMatch(/OKAFOR|1988-01-15/)
  })

  it('says a date of birth was needed when none was typed and the record has one', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.',
      { firstName: 'match', lastName: 'match', dateOfBirth: 'no_match' }))
    render(<InPersonCheck />)
    fill({ dob: '' })
    submit()
    const results = await screen.findByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem')[2]!.textContent)
      .toBe('Date of birth: doesn’t match. None was typed; type the date on the ID.')
  })

  it.each([
    ['503 ASSISTED_VERIFICATION_UNAVAILABLE', problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'The in-person check could not be completed. Try again.'),
      /didn’t go through\. Press Check again without changes/],
    ['503 ENROLLMENT_RECONCILIATION_REQUIRED', problem(503, 'ENROLLMENT_RECONCILIATION_REQUIRED', 'The service could not complete the request.'),
      /within 10 minutes/],
    ['503 ENROLLMENT_UNAVAILABLE', problem(503, 'ENROLLMENT_UNAVAILABLE', 'The service could not complete the request.'), /within 10 minutes/],
    ['a lost connection', new HidApiError(0, 'We could not reach the service.', { code: 'NETWORK_ERROR' }),
      /didn’t go through\. Press Check again without changes/],
  ])('after %s, checks again with the same key and never signs out', async (_label, failure, guidance) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(guidance)
    expect(alert.textContent).toMatch(/without changes/)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).toBe(first)
    expect(staff.signOut).not.toHaveBeenCalled()
  })

  it('takes a new key once the details change after a 503', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    await screen.findByRole('alert')
    fill({ first: 'Ada' })
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('says the route is closed while it is switched off, and never signs out', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_REGISTRATION_DISABLED', 'Registration at a facility is not available.'))
    render(<InPersonCheck />)
    fill()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alertBody(alert)).toBe('Registration at a facility is not available. Nothing was recorded.')
    // A final answer: nothing suggests checking again, and the next check is a new submission.
    expect(screen.getByRole('button', { name: 'Check details' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(staff.signOut).not.toHaveBeenCalled()
  })

  it('sends a check after the route was closed as a new submission', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_REGISTRATION_DISABLED', 'Registration at a facility is not available.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    await screen.findByRole('alert')
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it.each([
    ['ASSISTED_REGISTRATION_NOT_AUTHORIZED', 'You cannot register patients in person at this facility.',
      // Identity gives one answer for four causes (INTERFACE_CONTRACT.md at f9dbaf0); the redesign says it in one plain line.
      'You can’t check patients in person here. Ask Health ID support to set you up.'],
    ['PERMISSION_DENIED', 'Required permission is missing',
      'Your role here can’t check patients in person. Ask your administrator.'],
  ])('explains 403 %s without signing out', async (code, detail, shown) => {
    api.assistedVerification.mockRejectedValueOnce(problem(403, code, detail))
    render(<InPersonCheck />)
    fill()
    submit()
    expect(alertBody(await screen.findByRole('alert'))).toBe(shown)
    expect(staff.signOut).not.toHaveBeenCalled()
  })

  it('directs a person who already has a Health ID to account recovery, with the reference, and shows no Health ID', async () => {
    const detail = 'This person already has a Health ID. Direct them to account recovery. If they say they never registered, ask Health ID support to review, quoting reference corr-original.'
    api.assistedVerification.mockRejectedValueOnce(problem(409, 'NIN_ALREADY_REGISTERED', detail))
    render(<InPersonCheck />)
    fill()
    submit()
    const heading = await screen.findByRole('heading', { name: 'They already have a Health ID' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText(detail)).toBeTruthy()
    expect(screen.getByText(/Don’t register them again/)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: DESK_CODE })).toBeNull()
    expect(document.body.textContent).not.toMatch(/HID-|Synthetic-Ada|Okafor/)
    fireEvent.click(screen.getByRole('button', { name: 'Check another patient' }))
    await screen.findByRole('heading', { name: 'Check a patient' })
  })

  it.each([
    ['404 DESK_CODE_NOT_FOUND', problem(404, 'DESK_CODE_NOT_FOUND', 'No registration is waiting for this desk code. Ask the patient to show the code on their phone again.'),
      'No registration is waiting for this desk code. Ask the patient to show the code on their phone again.'],
    ['400 DESK_CODE_INVALID', problem(400, 'DESK_CODE_INVALID', 'Enter the 10-character desk code shown on the patient\'s phone.'),
      'Enter the 10-character desk code shown on the patient\'s phone.'],
    ['409 ASSISTED_VERIFICATION_STALE', problem(409, 'ASSISTED_VERIFICATION_STALE', 'Stale.'),
      'That code has changed. Ask for the code on their phone now, then check again.'],
  ])('reports %s at the desk code, and checks a new code with a new key', async (_label, failure, message) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    const code = screen.getByRole('textbox', { name: DESK_CODE })
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(document.getElementById(code.getAttribute('aria-describedby')!)?.textContent).toBe(message)
    fill({ code: 'ABCDEFGHJK' })
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it.each([
    ['429 ASSISTED_VERIFICATION_LIMITED', problem(429, 'ASSISTED_VERIFICATION_LIMITED', 'The daily limit of in-person checks is reached. Try again later.'),
      'The daily limit of in-person checks is reached. Try again later.'],
    ['409 IDEMPOTENCY_KEY_REUSED', problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This retry key belongs to a different request'),
      'This was already sent with different details. Check them and try again.'],
  ])('reports %s and sends the next check with a new key', async (_label, failure, shown) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    render(<InPersonCheck />)
    fill()
    submit()
    expect(alertBody(await screen.findByRole('alert'))).toBe(shown)
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('keeps the button focusable and says it is checking while the check runs; a second press sends nothing', async () => {
    let answer: (value: unknown) => void = () => {}
    api.assistedVerification.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    render(<InPersonCheck />)
    fill()
    submit()
    const button = await screen.findByRole('button', { name: 'Checking…' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(api.assistedVerification).toHaveBeenCalledOnce()
    await act(async () => { answer({ outcome: 'verified' }) })
    await screen.findByRole('heading', { name: VERIFIED })
  })

  it('starts afresh at another facility', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    const { rerender } = render(<InPersonCheck />)
    fill()
    submit()
    await screen.findByRole('alert')
    staff.facilityId = 'facility-2'
    rerender(<InPersonCheck />)
    expect((screen.getByRole('textbox', { name: DESK_CODE }) as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    fill()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    expect(api.assistedVerification.mock.calls[1]![0]).toBe('facility-2')
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })
})
