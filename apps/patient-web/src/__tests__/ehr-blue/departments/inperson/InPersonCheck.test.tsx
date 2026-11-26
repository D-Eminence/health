import { useEffect, type ReactElement } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { BluePagesProvider } from '../../../../ehr-blue/frame/pageContext'
import type { EhrBluePage } from '../../../../ehr-blue/frame/types'
import { InPersonCheck, InPersonUnavailable } from '../../../../ehr-blue/departments/inperson/InPersonCheck'
import { inPersonCheckPage } from '../../../../ehr-blue/departments/inperson/page'
import { normalizeDeskCode } from '../../../../ehr-blue/departments/inperson/inPersonRules'
import { SAID_FIELDS_REFUSED } from '../../../said'

/*
 * The blue In-person check: the classic check (staff/routes/InPersonCheck.tsx and InPersonCheck.test.tsx as they are on
 * main now) in the design's form and record pattern. Every request, rule, step and word is classic's (parity report
 * 3.3-18 to 3.3-26); each is pinned here word for word.
 * Every person, code and facility is fictional.
 */

const session = vi.hoisted(() => ({
  permissions: ['identity.patient.assisted_registration'] as string[],
  facilityId: '98d00002-0000-4000-8000-000000000001' as string | null,
  signOut: vi.fn(),
}))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => ({
      ...staffContext(session.facilityId === null ? undefined : fakeFacility(session.permissions, {
        id: session.facilityId, name: 'Demo Hospital', roles: ['clinician'],
      })),
      signOut: session.signOut,
    }),
  }
})

const api = vi.hoisted(() => ({ assistedVerification: vi.fn() }))
// Any other staff API member the page reached for: it must reach for none.
const unprovided = vi.hoisted(() => new Set<string>())
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, {
    get(target, property) {
      if (typeof property === 'string' && !(property in target)) unprovided.add(property)
      return Reflect.get(target, property)
    },
  }),
}))

const HOSPITAL = '98d00002-0000-4000-8000-000000000001'
const OTHER_FACILITY = '98d00002-0000-4000-8000-000000000004'

const problem = (status: number, code: string, detail: string, extra: { fields?: Record<string, string>; details?: unknown } = {}) =>
  new HidApiError(status, detail, { code, requestId: `corr-${status}`, ...extra })

// Classic's words, as the classic page (staff/routes/InPersonCheck.tsx) gives them.
const ATTESTATIONS = [
  'The patient is here in person.',
  'I’ve seen the original ID, not a copy or photo.',
  'The photo on the ID is this person.',
  'The code is on their own phone.',
  'They agree to this check against their NIN.',
]
const UNAVAILABLE_TITLE = 'You can’t check patients in person here'
const UNAVAILABLE = 'Doctors and nurses at a taking-part facility can. Ask your administrator.'
const PAGE_TITLE = 'Check a patient in person'
const DESCRIPTION = 'For patients who can’t get a code on their NIN phone. You check their photo ID.'
const DESK_CODE_ENTRY = 'Type the 10-character code on their phone.'
const DESK_CODE_NOT_FOUND = 'No sign-up is waiting for this code. Ask them to show the code again.'
const VERIFIED = 'Checked'
const VERIFIED_NEXT = 'They can finish on their phone now. If it still shows the code, ask them to open their sign-up again.'
const REGISTERED = 'They already have a Health ID'
const REGISTERED_NEXT = 'Don’t register them again. They can get back into their account with “Forgot password”.'
const MISMATCH = 'The details don’t match their NIN'
const MISMATCH_NEXT = 'If only a space or hyphen differs, type it as the ID shows and check again. Otherwise, don’t register them.'
const RETRY = 'That didn’t go through. Press Check again without changes. It won’t count twice.'
const RETRY_PROOF = 'Saved, but their sign-up didn’t move on. Press Check again within 10 minutes, without changes.'
const STALE = 'That code has changed. Ask for the code on their phone now, then check again.'
const CHECK = 'Check details'
/** Classic's alert title over every answer the alert says. */
const ERROR_TITLE = 'That didn’t work'

// Fictional: what the staff member types from the document.
const FIRST = 'Demo-Patient'
const LAST = 'Fictional-One'
const CODE_TYPED = '7k3m-9q2x wd'
const CODE_SENT = '7K3M9Q2XWD'

/** The address and router state the page leaves, as each render sees them. */
const seen: { pathname: string; search: string; hash: string; state: unknown }[] = []
function Probe() {
  const location = useLocation()
  useEffect(() => { seen.push({ pathname: location.pathname, search: location.search, hash: location.hash, state: location.state }) }, [location])
  return null
}

const patientsPage = (entry: Partial<EhrBluePage> = {}): EhrBluePage =>
  ({ path: 'patients/*', group: 'Clinical', label: 'Patients', permission: 'identity.patient.read', status: 'live', element: <p>Patients</p>, ...entry })

function tree(ui: ReactElement, pages: readonly EhrBluePage[]) {
  return (
    <MemoryRouter initialEntries={['/provider/in-person-check']}>
      <Probe />
      <BluePagesProvider value={pages}><div className="hid-ehr">{ui}</div></BluePagesProvider>
    </MemoryRouter>
  )
}

function renderPage({ pages = [] as readonly EhrBluePage[] } = {}) {
  return render(tree(<InPersonCheck />, pages))
}

const deskCode = () => screen.getByRole('textbox', { name: 'Code' }) as HTMLInputElement
const dateOfBirth = () => screen.getByLabelText('Date of birth') as HTMLInputElement
const documentType = () => screen.getByRole('combobox', { name: 'Which ID?' }) as HTMLSelectElement
/** The alert's words under its title. */
const alertText = (alert: HTMLElement) => alert.querySelector('.hid-ehr-dept-notice-body')?.textContent

function fill(values: { code?: string; type?: string; first?: string; last?: string; dob?: string; attest?: number } = {}) {
  fireEvent.change(deskCode(), { target: { value: values.code ?? CODE_TYPED } })
  fireEvent.change(documentType(), { target: { value: values.type ?? 'national_id_card' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: values.first ?? ` ${FIRST} ` } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), { target: { value: values.last ?? LAST } })
  fireEvent.change(dateOfBirth(), { target: { value: values.dob ?? '1990-04-02' } })
  for (const label of ATTESTATIONS.slice(0, values.attest ?? 5)) {
    const box = screen.getByRole('checkbox', { name: label }) as HTMLInputElement
    if (!box.checked) fireEvent.click(box)
  }
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /^Check (details|again)$/ }))
const sentKeys = () => api.assistedVerification.mock.calls.map(call => call[2] as string)

/** The error a control is described by (its field's hint describes it too). */
function errorOf(control: Element) {
  const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  return ids.map(id => document.getElementById(id)).find(element => element?.classList.contains('hid-ehr-error'))?.textContent
}

let storageWrites: string[]
beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks keeps queued answers (mockRejectedValueOnce…): a test that stopped early would hand its unused
  // answers to the next one. Each test starts with none.
  api.assistedVerification.mockReset()
  unprovided.clear()
  seen.length = 0
  session.permissions = ['identity.patient.assisted_registration']
  session.facilityId = HOSPITAL
  storageWrites = []
  for (const storage of [localStorage, sessionStorage]) {
    vi.spyOn(storage, 'setItem').mockImplementation((key: string) => { storageWrites.push(key) })
  }
})
afterEach(() => {
  // Nothing typed or answered is kept in storage, in the address or in router state, and no other request is made.
  expect(storageWrites).toEqual([])
  expect(window.location.search).toBe('')
  expect(window.location.hash).toBe('')
  for (const location of seen) {
    expect(location.search).toBe('')
    expect(location.hash).toBe('')
    expect(location.state).toBeNull()
  }
  expect([...unprovided]).toEqual([])
  vi.restoreAllMocks()
})

describe('the page entry', () => {
  it('replaces the frame’s live stand-in in place: its path, group, label and permission, partial, with classic’s refusal', () => {
    expect(inPersonCheckPage).toMatchObject({
      path: 'in-person-check', group: 'Clinical', label: 'In-person check', permission: 'identity.patient.assisted_registration', status: 'partial',
    })
    expect(inPersonCheckPage.icon).toBeDefined()
    expect(inPersonCheckPage.refusal?.type).toBe(InPersonUnavailable)
    expect(inPersonCheckPage.element.type).toBe(InPersonCheck)
  })
})

describe('the blue in-person check (hid-system #85, ADR-063)', () => {
  it('refuses someone this facility does not let check patients in classic’s words, naming no permission, and sends nothing', () => {
    session.permissions = ['identity.patient.read']
    renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UNAVAILABLE_TITLE)
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/permission|platform administrator/i)
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('is unavailable without a working facility too', () => {
    session.facilityId = null
    renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UNAVAILABLE_TITLE)
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy()
  })

  it('says the same as the refusal the frame shows at its address', () => {
    render(tree(<InPersonUnavailable />, []))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(UNAVAILABLE_TITLE)
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy()
  })

  it('has classic’s heading and line, and classic’s three steps in the form card, with no Method choice', () => {
    const { container } = renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(PAGE_TITLE)
    expect(screen.getByText(DESCRIPTION)).toBeTruthy()
    expect(screen.queryByText('Identity operations')).toBeNull()
    const card = screen.getByRole('region', { name: 'Check a patient' })
    expect(card.classList.contains('hid-ehr-card')).toBe(true)
    // Classic's steps (InPersonCheck.tsx:291-326), each an h3, numbered.
    expect(within(card).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['The code on their phone', 'Their photo ID', 'Confirm'])
    expect([...card.querySelectorAll('.hid-ehr-dept-inperson-n')].map(n => n.textContent)).toEqual(['1', '2', '3'])
    expect(screen.getByText('The original, not a copy or a photo of it.')).toBeTruthy()
    // The method is fixed, so it is never offered as a choice (classic says none).
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Method' })).toBeNull()
    expect(document.body.textContent).not.toContain('Original government photo ID')
    // The names beside each other, then the date of birth.
    const grids = [...card.querySelectorAll('.hid-ehr-dept-form-grid')]
    expect(grids).toHaveLength(1)
    expect(within(grids[0] as HTMLElement).getAllByRole('textbox').map(input => input.getAttribute('name'))).toEqual(['firstName', 'lastName'])
    expect(grids[0]!.contains(dateOfBirth())).toBe(true)
    // A required field is marked as the design marks it; the mark is not read as part of the name.
    for (const name of ['Code', 'Which ID?', 'First name', 'Last name']) {
      const label = [...container.querySelectorAll('label')].find(element => element.textContent === `${name} *`)
      expect(label?.querySelector('[aria-hidden="true"]')?.textContent).toBe(' *')
    }
    // The page's own rules, under .hid-ehr with its prefix: nothing of the staff portal's look.
    expect(container.querySelector('.hid-ehr-dept-inperson')).not.toBeNull()
    expect(container.querySelector('[class*="staff-"]')).toBeNull()
  })

  it('asks for the code, the ID, the names, an optional date of birth and five statements, in classic’s words', () => {
    renderPage()
    expect(deskCode().getAttribute('maxlength')).toBe('20')
    expect(deskCode().getAttribute('autocomplete')).toBe('off')
    expect(deskCode().getAttribute('autocapitalize')).toBe('characters')
    expect(deskCode().getAttribute('spellcheck')).toBe('false')
    expect(deskCode().getAttribute('placeholder')).toBe('ABCD-EFGH-JK')
    expect(screen.getByText('10 letters and numbers. Spaces and dashes don’t matter.')).toBeTruthy()
    const documents = within(documentType()).getAllByRole('option')
    expect(documents.map(option => option.textContent)).toEqual(['Choose',
      'National ID card', 'International passport', 'Driver’s licence', 'Voter’s card'])
    expect(documents.map(option => (option as HTMLOptionElement).value)).toEqual(['',
      'national_id_card', 'international_passport', 'drivers_licence', 'voters_card'])
    const written = screen.getByRole('group', { name: 'Type the details exactly as they are on the ID.' })
    // Classic's limits, and nothing typed offered to the browser's autofill or spelling service.
    for (const name of ['First name', 'Last name']) {
      const control = within(written).getByRole('textbox', { name })
      expect(control.getAttribute('maxlength')).toBe('100')
      expect(control.getAttribute('autocomplete')).toBe('off')
      expect(control.getAttribute('spellcheck')).toBe('false')
    }
    expect(dateOfBirth().type).toBe('date')
    expect(dateOfBirth().required).toBe(false)
    expect(dateOfBirth().getAttribute('autocomplete')).toBe('off')
    expect(screen.getByText('If the ID shows one. Without it, the check may not match.')).toBeTruthy()
    // The design's checkbox list: each statement a box before its words, in classic's order.
    const statements = screen.getByRole('group', { name: 'Confirm each statement' })
    expect(within(statements).getAllByRole('checkbox').map(box => box.closest('label')?.textContent)).toEqual(ATTESTATIONS)
    expect(screen.getByRole('button', { name: CHECK }).getAttribute('type')).toBe('submit')
  })

  it('sends the desk code as the phone shows it, the typed names and each statement, with a submission key', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    const [facilityId, input, key] = api.assistedVerification.mock.calls[0]!
    expect(facilityId).toBe(HOSPITAL)
    expect(input).toEqual({
      deskCode: CODE_SENT, method: 'government_photo_id_in_person', documentType: 'national_id_card',
      document: { firstName: FIRST, lastName: LAST, dateOfBirth: '1990-04-02' },
      attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true,
        codeShownOnPatientsOwnDevice: true, patientConsents: true },
    })
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads the desk code as Identity does: spaces, hyphens and case ignored, O as zero, I and L as one', async () => {
    expect(normalizeDeskCode('olio 7k3m-9q')).toBe('01107K3M9Q')
    expect(normalizeDeskCode('7K3M9Q2XWU')).toBeNull()
    expect(normalizeDeskCode('7K3M9')).toBeNull()
    expect(normalizeDeskCode('7K3M9Q2XWD1')).toBeNull()
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    renderPage()
    fill({ code: 'olio 7k3m-9q' })
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    expect(api.assistedVerification.mock.calls[0]![1].deskCode).toBe('01107K3M9Q')
  })

  it('leaves the date of birth out when none was typed', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    renderPage()
    fill({ dob: '' })
    submit()
    await waitFor(() => expect(api.assistedVerification).toHaveBeenCalledOnce())
    expect(api.assistedVerification.mock.calls[0]![1].document).toEqual({ firstName: FIRST, lastName: LAST })
  })

  it.each([
    ['no desk code', { code: '' }, 'in-person-desk-code', DESK_CODE_ENTRY],
    ['a desk code with a U', { code: '7K3M9Q2XWU' }, 'in-person-desk-code', DESK_CODE_ENTRY],
    ['a short desk code', { code: '7K3M9' }, 'in-person-desk-code', DESK_CODE_ENTRY],
    ['no ID', { type: '' }, 'in-person-document-type', 'Choose which ID you looked at.'],
    ['no first name', { first: '  ' }, 'in-person-first-name', 'Type the first name as it is on the ID.'],
    ['no last name', { last: '' }, 'in-person-last-name', 'Type the last name as it is on the ID.'],
  ])('refuses %s at its field before sending, in classic’s words', async (_label, values, field, message) => {
    renderPage()
    fill(values)
    submit()
    const control = document.getElementById(field)!
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(errorOf(control)).toBe(message)
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('refuses a partly typed date of birth at its field before sending, rather than leaving it out', async () => {
    // A date control holding an unfinished or impossible date reports no value, and says so only in its validity.
    renderPage()
    fill({ dob: '' })
    const date = dateOfBirth()
    Object.defineProperty(date, 'validity', { configurable: true, value: { ...date.validity, badInput: true, valid: false } })
    submit()
    await waitFor(() => expect(document.activeElement).toBe(date))
    expect(date.getAttribute('aria-invalid')).toBe('true')
    expect(errorOf(date)).toBe('Type the full date as it is on the ID, or leave it empty if there isn’t one.')
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('refuses a check until every statement is confirmed, and says why', async () => {
    renderPage()
    fill({ attest: 3 })
    submit()
    const fourth = screen.getByRole('checkbox', { name: ATTESTATIONS[3]! })
    await waitFor(() => expect(document.activeElement).toBe(fourth))
    const statements = screen.getByRole('group', { name: 'Confirm each statement' })
    expect(document.getElementById(statements.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Tick all five. If any isn’t true, stop here.')
    expect(api.assistedVerification).not.toHaveBeenCalled()
  })

  it('says the patient continues on their phone after a match, as classic does, with no record value, and starts afresh', async () => {
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    const heading = await screen.findByRole('heading', { level: 2, name: VERIFIED })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(PAGE_TITLE)
    expect(screen.getByText(VERIFIED_NEXT)).toBeTruthy()
    // Parity 3.3-22: classic's "Checked" card (staff/routes/InPersonCheck.tsx:271-278), its heading, its line and
    // "Check another patient" only. No status badge, no "ID checked" fact, no "Available actions", no "Next steps".
    const outcome = screen.getByRole('region', { name: VERIFIED })
    expect([...outcome.querySelectorAll('p')].map(line => line.textContent)).toEqual([VERIFIED_NEXT])
    expect(within(outcome).getAllByRole('button').map(button => button.textContent)).toEqual(['Check another patient'])
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Check another patient'])
    expect(document.querySelector('.hid-ehr-dept-context, .hid-ehr-badge, dt')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Available actions' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/ID checked|National ID card|verified|Open patients/)
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
    expect(document.body.textContent).not.toMatch(new RegExp(`${FIRST}|${LAST}|${CODE_SENT}|1990-04-02`))
    fireEvent.click(screen.getByRole('button', { name: 'Check another patient' }))
    const form = await screen.findByRole('heading', { name: 'Check a patient' })
    await waitFor(() => expect(document.activeElement).toBe(form))
    expect(deskCode().value).toBe('')
    expect(documentType().value).toBe('')
    expect((screen.getByRole('checkbox', { name: ATTESTATIONS[0]! }) as HTMLInputElement).checked).toBe(false)
    // The answer ended that submission: the same details typed again are a new check, under a new key.
    fill()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(api.assistedVerification.mock.calls[1]![1]).toEqual(api.assistedVerification.mock.calls[0]![1])
    expect(second).not.toBe(first)
  })

  it.each([
    ['where Patients is a live page this member may open', ['identity.patient.assisted_registration', 'identity.patient.read'], patientsPage()],
    ['without the permission to read patients', ['identity.patient.assisted_registration'], patientsPage()],
    ['where Patients is a sample', ['identity.patient.assisted_registration', 'identity.patient.read'], patientsPage({ status: 'sample' })],
  ])('offers no next step %s, as classic offers none', async (_label, permissions, page) => {
    // Parity 3.3-22: classic's outcome (InPersonCheck.tsx:271-278) has no "Next steps" and no "Open patients".
    api.assistedVerification.mockResolvedValue({ outcome: 'verified' })
    session.permissions = permissions
    renderPage({ pages: [page] })
    fill()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open patients' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows which field differed, never a record value, and checks a correction with a new key', async () => {
    api.assistedVerification
      .mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'The details on the document do not match the NIN record.',
        { fields: { firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' } }))
      .mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    const heading = await screen.findByRole('heading', { name: MISMATCH })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const results = screen.getByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'First name: matches',
      'Last name: doesn’t match',
      'Date of birth: not on their NIN, so not checked',
    ])
    expect(screen.getByText(MISMATCH_NEXT)).toBeTruthy()
    // Classic's note says nothing of a daily limit.
    expect(document.body.textContent).not.toContain('daily limit')
    // The typed details stay for correction.
    expect((screen.getByRole('textbox', { name: 'Last name' }) as HTMLInputElement).value).toBe(LAST)
    fill({ last: `${LAST}-Two` })
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('shows no result, never the value, for a field whose answer is not one of the three result words', async () => {
    // The contract sends only match, no_match or not_in_record; anything else, such as a record value, is not shown.
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.',
      { fields: { firstName: 'match', lastName: 'FICTIONAL-RECORD', dateOfBirth: '1988-01-15' } }))
    renderPage()
    fill()
    submit()
    const results = await screen.findByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'First name: matches',
      'Last name: no result given',
      'Date of birth: no result given',
    ])
    expect(document.body.textContent).not.toMatch(/FICTIONAL-RECORD|1988-01-15/)
  })

  it('says a date of birth was needed when none was typed and the record has one', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.',
      { fields: { firstName: 'match', lastName: 'match', dateOfBirth: 'no_match' } }))
    renderPage()
    fill({ dob: '' })
    submit()
    const results = await screen.findByRole('list', { name: 'Result for each detail' })
    expect(within(results).getAllByRole('listitem')[2]!.textContent)
      .toBe('Date of birth: doesn’t match. None was typed; type the date on the ID.')
  })

  it.each([
    ['503 ASSISTED_VERIFICATION_UNAVAILABLE', problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'The in-person check could not be completed. Try again.'), RETRY],
    ['503 ENROLLMENT_RECONCILIATION_REQUIRED', problem(503, 'ENROLLMENT_RECONCILIATION_REQUIRED', 'The service could not complete the request.'), RETRY_PROOF],
    ['503 ENROLLMENT_UNAVAILABLE', problem(503, 'ENROLLMENT_UNAVAILABLE', 'The service could not complete the request.'), RETRY_PROOF],
    ['a lost connection', new HidApiError(0, 'We could not reach the service.', { code: 'NETWORK_ERROR' }), RETRY],
    ['a 408', problem(408, 'REQUEST_TIMEOUT', 'The request took too long.'), RETRY],
    ['a 502', problem(502, 'BAD_GATEWAY', 'The service could not be reached.'), RETRY],
    // Not an answer from Health ID at all: whether the check was recorded is unknown.
    ['an error that is not Health ID’s answer', new TypeError('Failed to fetch'), RETRY],
  ])('after %s, checks again with the same key and never signs out', async (_label, failure, guidance) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    const button = screen.getByRole('button', { name: CHECK })
    button.focus()
    fireEvent.click(button)
    const alert = await screen.findByRole('alert')
    expect(alertText(alert)).toBe(guidance)
    expect(alert.querySelector('.hid-ehr-dept-notice-title')?.textContent).toBe(ERROR_TITLE)
    // The design's ErrorBox, in the form above its submit.
    expect(alert.closest('form')).not.toBeNull()
    // Focus stays on the button the check was sent from, which now says to check again.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Check again' }))
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).toBe(first)
    expect(session.signOut).not.toHaveBeenCalled()
  })

  it('takes a new key once the details change after a 503', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    await screen.findByRole('alert')
    fill({ first: 'Demo' })
    expect(screen.getByRole('button', { name: CHECK })).toBeTruthy()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('keeps the same key when only a statement is ticked again after a 503, as classic', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    await screen.findByRole('alert')
    const box = screen.getByRole('checkbox', { name: ATTESTATIONS[0]! })
    fireEvent.click(box)
    fireEvent.click(box)
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).toBe(first)
  })

  it('counts the statements confirmed as part of the submission: one unticked after a 503 is not the same check', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
    renderPage()
    fill()
    submit()
    await screen.findByRole('button', { name: 'Check again' })
    const box = screen.getByRole('checkbox', { name: ATTESTATIONS[2]! })
    fireEvent.click(box)
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(screen.getByRole('button', { name: CHECK })).toBeTruthy()
    fireEvent.click(box)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
  })

  it('clears the last answer as the next check is sent: the alert, the result for each detail and a field’s refusal', async () => {
    let answer: (value: unknown) => void = () => {}
    api.assistedVerification
      .mockRejectedValueOnce(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'Not matched.',
        { fields: { firstName: 'match', lastName: 'no_match', dateOfBirth: 'match' } }))
      .mockRejectedValueOnce(problem(429, 'ASSISTED_VERIFICATION_LIMITED', 'The daily limit of in-person checks is reached. Try again later.'))
      .mockRejectedValueOnce(problem(404, 'DESK_CODE_NOT_FOUND', ''))
      .mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    renderPage()
    fill()
    submit()
    await screen.findByRole('heading', { name: MISMATCH })
    submit()
    expect(alertText(await screen.findByRole('alert'))).toBe('The daily limit of in-person checks has been reached. Try again later.')
    expect(screen.queryByRole('heading', { name: MISMATCH })).toBeNull()
    submit()
    await waitFor(() => expect(errorOf(deskCode())).toBe(DESK_CODE_NOT_FOUND))
    expect(screen.queryByRole('alert')).toBeNull()
    fill({ code: 'ABCDEFGHJK' })
    submit()
    await screen.findByRole('button', { name: 'Checking…' })
    expect(deskCode().getAttribute('aria-invalid')).toBeNull()
    expect(errorOf(deskCode())).toBeUndefined()
    await act(async () => { answer({ outcome: 'verified' }) })
    await screen.findByRole('heading', { name: VERIFIED })
    expect(api.assistedVerification).toHaveBeenCalledTimes(4)
  })

  it('says the route is closed while it is switched off, and never signs out', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_REGISTRATION_DISABLED', 'Registration at a facility is not available.'))
    renderPage()
    fill()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alertText(alert)).toBe('Registration at a facility is not available. Nothing was recorded.')
    // A final answer: nothing suggests checking again, and the next check is a new submission.
    expect(screen.getByRole('button', { name: CHECK })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(session.signOut).not.toHaveBeenCalled()
  })

  it('says the route is closed in classic’s own words when Identity gives none', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_REGISTRATION_DISABLED', ''))
    renderPage()
    fill()
    submit()
    expect(alertText(await screen.findByRole('alert'))).toBe('Registration at a facility is not available. Nothing was recorded.')
  })

  it('sends a check after the route was closed as a new submission', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_REGISTRATION_DISABLED', 'Registration at a facility is not available.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    await screen.findByRole('alert')
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it.each([
    // Identity gives one answer for four causes (INTERFACE_CONTRACT.md at f9dbaf0): classic sends them to Health ID support.
    ['ASSISTED_REGISTRATION_NOT_AUTHORIZED', 'You cannot register patients in person at this facility.',
      'You can’t check patients in person here. Ask Health ID support to set you up.'],
    ['PERMISSION_DENIED', 'Required permission is missing',
      'Your role here can’t check patients in person. Ask your administrator.'],
  ])('explains 403 %s in classic’s words without signing out', async (code, detail, shown) => {
    api.assistedVerification.mockRejectedValueOnce(problem(403, code, detail))
    renderPage()
    fill()
    submit()
    const alert = await screen.findByRole('alert')
    expect(alertText(alert)).toBe(shown)
    expect(alert.textContent).not.toMatch(/permission|platform administrator/i)
    expect(session.signOut).not.toHaveBeenCalled()
  })

  it('directs a person who already has a Health ID to account recovery, in plain words, and shows no Health ID or reference', async () => {
    const detail = 'This person already has a Health ID. Direct them to account recovery. If they say they never registered, ask Health ID support to review, quoting reference corr-original.'
    api.assistedVerification.mockRejectedValueOnce(problem(409, 'NIN_ALREADY_REGISTERED', detail))
    renderPage()
    fill({ type: 'international_passport' })
    submit()
    const heading = await screen.findByRole('heading', { level: 2, name: REGISTERED })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    // Identity's own words and its reference are never shown (owner's rule, 1 Nov 2026).
    expect(screen.queryByText(detail)).toBeNull()
    expect(document.body.textContent).not.toContain('corr-original')
    expect(screen.getByText(REGISTERED_NEXT)).toBeTruthy()
    // Parity 3.3-24: classic's card (staff/routes/InPersonCheck.tsx:280-287), its heading, its line and "Check another
    // patient" only. No "already registered" badge, no "ID checked" fact, no "Available actions", no "Next steps".
    const outcome = screen.getByRole('region', { name: REGISTERED })
    // Identity sends no detail for it, so no empty line stands for one: only the next step is said.
    expect([...outcome.querySelectorAll('p')].map(line => line.textContent)).toEqual([REGISTERED_NEXT])
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Check another patient'])
    expect(document.querySelector('.hid-ehr-dept-context, .hid-ehr-badge, dt')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Available actions' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/ID checked|International passport|already registered|Open patients/)
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
    expect(document.body.textContent).not.toMatch(new RegExp(`HID-|${FIRST}|${LAST}|${CODE_SENT}`))
    fireEvent.click(screen.getByRole('button', { name: 'Check another patient' }))
    await screen.findByRole('heading', { name: 'Check a patient' })
    expect(deskCode().value).toBe('')
  })

  it.each([
    ['404 DESK_CODE_NOT_FOUND', problem(404, 'DESK_CODE_NOT_FOUND', 'Identity: no assisted registration for code'), DESK_CODE_NOT_FOUND],
    ['404 DESK_CODE_NOT_FOUND with no detail', problem(404, 'DESK_CODE_NOT_FOUND', ''), DESK_CODE_NOT_FOUND],
    ['400 DESK_CODE_INVALID', problem(400, 'DESK_CODE_INVALID', 'deskCode must match /^[A-Z0-9]{10}$/'), DESK_CODE_ENTRY],
    ['400 DESK_CODE_INVALID with no detail', problem(400, 'DESK_CODE_INVALID', ''), DESK_CODE_ENTRY],
    ['409 ASSISTED_VERIFICATION_STALE', problem(409, 'ASSISTED_VERIFICATION_STALE', 'Stale.'), STALE],
  ])('reports %s at the desk code, and checks a new code with a new key', async (_label, failure, message) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    const code = deskCode()
    await waitFor(() => expect(document.activeElement).toBe(code))
    expect(errorOf(code)).toBe(message)
    expect(document.body.textContent).not.toContain(failure.message || 'no server words')
    fill({ code: 'ABCDEFGHJK' })
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it.each([
    ['429 ASSISTED_VERIFICATION_LIMITED', problem(429, 'ASSISTED_VERIFICATION_LIMITED', 'Assisted verification rate limit exceeded'),
      'The daily limit of in-person checks has been reached. Try again later.'],
    ['409 IDEMPOTENCY_KEY_REUSED', problem(409, 'IDEMPOTENCY_KEY_REUSED', 'This retry key belongs to a different request'),
      'This was already sent with different details. Check them and try again.'],
    ['a refusal with no detail', problem(409, 'SOMETHING_ELSE', ''), 'The check could not be completed.'],
  ])('reports %s and sends the next check with a new key', async (_label, failure, shown) => {
    api.assistedVerification.mockRejectedValueOnce(failure).mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    expect(alertText(await screen.findByRole('alert'))).toBe(shown)
    if (failure.message) expect(document.body.textContent).not.toContain(failure.message)
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('marks the fields Identity refused, says each, and sends the next check with a new key', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(400, 'VALIDATION_FAILED', 'Some details were refused.',
      { details: [{ field: 'firstName', messages: ['firstName must be shorter than or equal to 100 characters'] }] }))
      .mockResolvedValueOnce({ outcome: 'verified' })
    renderPage()
    fill()
    submit()
    expect(alertText(await screen.findByRole('alert'))).toBe(SAID_FIELDS_REFUSED)
    expect(document.body.textContent).not.toMatch(/firstName|First name must be|Some details were refused/)
    const first = screen.getByRole('textbox', { name: 'First name' })
    expect(first.getAttribute('aria-invalid')).toBe('true')
    expect(errorOf(first)).toBe('Use 100 characters or fewer.')
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [one, two] = sentKeys()
    expect(two).not.toBe(one)
  })

  it('says nothing more when the check is cancelled as the page is left', async () => {
    api.assistedVerification.mockRejectedValueOnce(new HidApiError(0, 'Cancelled', { code: 'REQUEST_CANCELLED' }))
    renderPage()
    fill()
    submit()
    await waitFor(() => expect(screen.getByRole('button', { name: CHECK }).getAttribute('aria-busy')).toBeNull())
    expect(api.assistedVerification).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the button focusable and says it is checking while the check runs; a second press sends nothing', async () => {
    let answer: (value: unknown) => void = () => {}
    api.assistedVerification.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    renderPage()
    fill()
    submit()
    const button = await screen.findByRole('button', { name: 'Checking…' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    // The typed details cannot change under the check being sent.
    for (const control of [deskCode(), screen.getByRole('textbox', { name: 'First name' }), screen.getByRole('textbox', { name: 'Last name' }), dateOfBirth()]) {
      expect((control as HTMLInputElement).readOnly).toBe(true)
    }
    fireEvent.click(button)
    fireEvent.submit(button.closest('form')!)
    expect(api.assistedVerification).toHaveBeenCalledOnce()
    await act(async () => { answer({ outcome: 'verified' }) })
    await screen.findByRole('heading', { name: VERIFIED })
  })

  it('starts afresh at another facility', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    const { rerender } = renderPage()
    fill()
    submit()
    await screen.findByRole('alert')
    session.facilityId = OTHER_FACILITY
    rerender(tree(<InPersonCheck />, []))
    expect(deskCode().value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    fill()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    expect(api.assistedVerification.mock.calls[1]![0]).toBe(OTHER_FACILITY)
    const [first, second] = sentKeys()
    expect(second).not.toBe(first)
  })

  it('keeps nothing typed once the page is left: opened again, it is empty and checks with a new key', async () => {
    api.assistedVerification.mockRejectedValueOnce(problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'Try again.'))
      .mockResolvedValueOnce({ outcome: 'verified' })
    const first = renderPage()
    fill()
    submit()
    await screen.findByRole('alert')
    first.unmount()
    renderPage()
    expect(deskCode().value).toBe('')
    expect((screen.getByRole('textbox', { name: 'First name' }) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: CHECK })).toBeTruthy()
    fill()
    submit()
    await screen.findByRole('heading', { name: VERIFIED })
    const [one, two] = sentKeys()
    expect(two).not.toBe(one)
    // The address never held anything typed.
    expect(seen.every(location => location.pathname === '/provider/in-person-check')).toBe(true)
  })
})
