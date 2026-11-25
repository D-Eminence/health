import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { PatientRegistration } from '../../../../ehr-blue/departments/registration/Registration'
import { ninForLink, verifyNinOffer, verifyNinRefusal, type VerifyNinFacts } from '../../../../ehr-blue/departments/registration/verifyNinLater'

/*
 * "Verify NIN later" on the blue Registration record (hid-system 0138, docs/INTERFACE_CONTRACT.md ID-6; identity-api
 * patient-nin-link.service.ts): a completed registration of a patient registered without a NIN, whose NIN the desk
 * checks and adds later. Every person, case and number here is fictional: Patient One, HID-ZDEMAAA2, Demo Hospital, and
 * the NINs 00000000000 and 00000000001.
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
  linkExistingRegistration: vi.fn(), approveNewRegistration: vi.fn(), enrollRegistration: vi.fn(), linkPatientNin: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const WRITE = 'identity.registration.write'
const APPROVE = 'identity.registration.approve'
const CASE = 'c0000000-0000-4000-8000-000000000061'
const PATIENT = 'a0000000-0000-4000-8000-000000000061'
const NIN = '00000000000'
const OTHER_NIN = '00000000001'
const REASONS = ['nin_service_unavailable', 'no_nin', 'not_carried', 'child', 'foreign_national']
const NIN_ON = {
  nin: { enabled: true, state: 'qoreid', available: true },
  withoutNin: { enabled: true, phoneRequiredUnlessChild: true, reasons: REASONS },
  newPatientRegistrationRequiresNin: false,
}
/** What deferred staging and the sealed demo and QA tenants answer. */
const NIN_OFF = { ...NIN_ON, nin: { enabled: false, state: 'deferred', available: false } }
/** A registration without a NIN that gave the patient a Health ID (0130). */
const REGISTERED = { caseId: CASE, status: 'approved_new_identity', version: 1, candidateCount: 0, identityEvidence: 'none',
  ninStatus: 'not_verified', patient: { patientId: PATIENT, hid: 'HID-ZDEMAAA2' } }
const LINKED = { patientId: PATIENT, outcome: 'nin_linked', ninStatus: 'verified', message: 'Server words that are never shown.', replayed: false }

const OFF_LINE = 'NIN checks are not available right now, so the NIN can be added later.'
const Q117 = 'This NIN could not be verified. Check the number and try again.'

beforeEach(() => {
  vi.clearAllMocks()
  session.permissions = [WRITE]
  api.registrationCapabilities.mockResolvedValue(NIN_ON)
  api.registrationCase.mockResolvedValue(REGISTERED)
})
afterEach(() => {
  const text = document.body.textContent ?? ''
  // The owner's words: never "unverified" or "permission", never a code, the patient's id or a NIN on screen.
  expect(text).not.toMatch(/unverified|permission/i)
  expect(text).not.toMatch(/\b[A-Z]+_[A-Z_]+\b/)
  expect(text).not.toContain(PATIENT)
  for (const nin of [NIN, OTHER_NIN]) {
    expect(text).not.toContain(nin)
    for (const input of document.querySelectorAll('input')) expect(input.value.replace(/\D/g, '')).not.toBe(nin)
  }
})

async function findCase() {
  renderDept(<PatientRegistration />)
  const field = await screen.findByRole('textbox', { name: 'Registration ID' })
  fireEvent.change(field, { target: { value: CASE } })
  fireEvent.click(within(field.closest('form') as HTMLElement).getByRole('button', { name: 'Open' }))
  return screen.findByRole('heading', { level: 1, name: 'Earlier registration' })
}
const actions = () => screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
const savedRecord = () => screen.getByRole('heading', { name: 'Saved record' }).closest('section') as HTMLElement
const ninFact = () => within(savedRecord()).getByText('NIN').nextElementSibling?.textContent
const form = () => screen.getByRole('form', { name: 'Verify NIN' })
const ninField = () => within(form()).getByLabelText(/^NIN \(11 digits\)/) as HTMLInputElement
function described(control: Element) {
  return (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}
async function openForm() {
  await findCase()
  await waitFor(() => expect(within(actions()).getByRole('button', { name: 'Verify NIN' })).toBeTruthy())
  fireEvent.click(within(actions()).getByRole('button', { name: 'Verify NIN' }))
  return form()
}
async function send(value: string) {
  fireEvent.input(ninField(), { target: { value } })
  await act(async () => { fireEvent.click(within(form()).getByRole('button', { name: 'Verify NIN' })) })
}

describe('Verify NIN on a registration without a NIN', () => {
  it('is offered for the registered patient whose NIN is not verified, while NIN checks are available', async () => {
    await openForm()
    expect(ninFact()).toBe('NIN Not Verified')
    expect(within(form()).getByText(/Type it as it is on the slip\. It isn’t kept here\./)).toBeTruthy()
    expect(ninField().type).toBe('password')
    expect(within(actions()).queryByText('Nothing else to do here.')).toBeNull()
  })

  it('adds the NIN: sends it with a key, clears it, and shows NIN Verified, which a refresh keeps', async () => {
    api.linkPatientNin.mockResolvedValue(LINKED)
    await openForm()
    await send('0000 0000-000')
    expect(api.linkPatientNin).toHaveBeenCalledTimes(1)
    const [facility, patientId, nin, key] = api.linkPatientNin.mock.calls[0]!
    expect(facility).toBe(DEMO_HOSPITAL_ID)
    expect(patientId).toBe(PATIENT)
    expect(nin).toBe(NIN)
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(ninFact()).toBe('NIN Verified'))
    expect(screen.getAllByText('NIN Verified. It is now on this patient’s record.').length).toBeGreaterThan(0)
    expect(screen.queryByRole('form', { name: 'Verify NIN' })).toBeNull()
    expect(within(actions()).queryByRole('button', { name: 'Verify NIN' })).toBeNull()
    expect(document.body.textContent).not.toContain('Server words')
    // Identity still reads the case as its own check left it: the NIN added here stays shown.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    expect(api.registrationCase).toHaveBeenCalledTimes(2)
    expect(ninFact()).toBe('NIN Verified')
    expect(within(actions()).queryByRole('button', { name: 'Verify NIN' })).toBeNull()
  })

  it('clears the number as it is sent, says it is still checking after a few seconds, and keeps the record while it waits', async () => {
    api.linkPatientNin.mockReturnValue(new Promise(() => {}))
    await openForm()
    await send(NIN)
    expect(ninField().value).toBe('')
    expect(within(form()).getByRole('button', { name: 'Checking…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' }).getAttribute('aria-disabled')).toBe('true')
    await waitFor(() => expect(within(form()).getByText('Still checking the NIN. This can take up to a minute.')).toBeTruthy(),
      { timeout: 6_000 })
    expect(api.linkPatientNin).toHaveBeenCalledTimes(1)
  })

  it('says so when the NIN was already on the record', async () => {
    api.linkPatientNin.mockResolvedValue({ ...LINKED, outcome: 'already_linked', replayed: true })
    await openForm()
    await send(NIN)
    await waitFor(() => expect(screen.getAllByText('NIN Verified. It is already on this patient’s record.').length).toBeGreaterThan(0))
    expect(ninFact()).toBe('NIN Verified')
  })

  it('refuses a number that is not 11 digits at its field, and sends nothing', async () => {
    await openForm()
    await send('0000000000')
    expect(api.linkPatientNin).not.toHaveBeenCalled()
    expect(ninField().getAttribute('aria-invalid')).toBe('true')
    expect(described(ninField())).toContain('Enter the 11 digit NIN.')
  })

  it('shows the Q117 words exactly on 422, marks the number, and never shows the NIN again', async () => {
    api.linkPatientNin.mockRejectedValue(new HidApiError(422, 'x', { code: 'NIN_VERIFICATION_FAILED', detail: Q117 }))
    await openForm()
    await send(NIN)
    await waitFor(() => expect(within(form()).getByRole('alert').textContent).toBe(Q117))
    expect(ninField().value).toBe('')
    expect(described(ninField())).toContain('Check this number.')
    expect(ninFact()).toBe('NIN Not Verified')
  })

  it('a retry of the same NIN sends the same key; another NIN gets a new one', async () => {
    api.linkPatientNin.mockRejectedValue(new HidApiError(408, 'x', { code: 'REQUEST_TIMEOUT' }))
    await openForm()
    await send(NIN)
    await waitFor(() => expect(within(form()).getByRole('alert').textContent)
      .toBe('The NIN check is taking longer than usual. Try again in a minute.'))
    expect(ninField().value).toBe('')
    await send(NIN)
    await send(OTHER_NIN)
    const keys = api.linkPatientNin.mock.calls.map(call => call[3])
    expect(api.linkPatientNin.mock.calls.map(call => call[2])).toEqual([NIN, NIN, OTHER_NIN])
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('makes a new key when Identity says the key was used for another request', async () => {
    api.linkPatientNin.mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'IDEMPOTENCY_KEY_REUSED' }))
    api.linkPatientNin.mockResolvedValueOnce(LINKED)
    await openForm()
    await send(NIN)
    await waitFor(() => expect(within(form()).getByRole('alert').textContent).toBe('That didn’t go through. Try again.'))
    await send(NIN)
    const keys = api.linkPatientNin.mock.calls.map(call => call[3])
    expect(keys[1]).not.toBe(keys[0])
    await waitFor(() => expect(ninFact()).toBe('NIN Verified'))
  })

  it('keeps the button off until the time Identity named for a held NIN, then offers it again without sending by itself', async () => {
    api.linkPatientNin.mockRejectedValue(new HidApiError(409, 'x', { code: 'NIN_CHECK_HELD', retryInSeconds: 1 }))
    await openForm()
    await send(NIN)
    await waitFor(() => expect(within(form()).getByRole('alert').textContent).toMatch(/^This NIN check is on hold\. Try again after /))
    const button = within(form()).getByRole('button', { name: 'Verify NIN' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await waitFor(() => expect(button.disabled).toBe(false), { timeout: 3_000 })
    expect(api.linkPatientNin).toHaveBeenCalledTimes(1)
  })

  it('a check still in progress keeps the button off for the minute Identity named', async () => {
    api.linkPatientNin.mockRejectedValue(new HidApiError(409, 'x', { code: 'NIN_CHECK_IN_PROGRESS', retryInSeconds: 60 }))
    await openForm()
    await send(NIN)
    await waitFor(() => expect(within(form()).getByRole('alert').textContent).toBe('We’re still checking this NIN. Wait a moment, then try again.'))
    expect((within(form()).getByRole('button', { name: 'Verify NIN' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.linkPatientNin).toHaveBeenCalledTimes(1)
  })

  it('reads whether NIN checks work again when the gateway says a service is unavailable, and stops offering it if they are off', async () => {
    api.linkPatientNin.mockRejectedValue(new HidApiError(503, 'x', { code: 'UPSTREAM_UNAVAILABLE' }))
    await openForm()
    api.registrationCapabilities.mockResolvedValue(NIN_OFF)
    await send(NIN)
    await waitFor(() => expect(api.registrationCapabilities).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(actions()).getByText(OFF_LINE)).toBeTruthy())
    expect(screen.getByRole('alert').textContent).toBe('NIN checks are not available right now. Try again in a minute.')
    expect(screen.queryByRole('form', { name: 'Verify NIN' })).toBeNull()
  })

  it('shows NIN Verified when Identity says the patient already has a verified NIN', async () => {
    api.linkPatientNin.mockRejectedValue(new HidApiError(409, 'x', { code: 'PATIENT_ALREADY_HAS_NIN',
      detail: 'This patient already has a verified NIN.' }))
    await openForm()
    await send(NIN)
    await waitFor(() => expect(ninFact()).toBe('NIN Verified'))
    expect(screen.getByRole('alert').textContent).toBe('This patient already has a verified NIN.')
  })

  it.each([
    [400, 'VALIDATION_FAILED', null, 'Enter the 11 digit NIN.'],
    [403, 'PERMISSION_DENIED', null, 'You can’t add a NIN for this patient here.'],
    [403, 'NIN_LINK_NOT_PERMITTED', null,
      'You can add a NIN only for this facility’s own patients. The patient can add their NIN on their own Health ID profile.'],
    [404, 'PATIENT_NOT_FOUND', null, 'We can’t find this patient’s record. Refresh and try again.'],
    [400, 'IDEMPOTENCY_KEY_REQUIRED', null, 'That didn’t go through. Try again.'],
    [400, 'PURPOSE_OF_USE_REQUIRED', null, 'That didn’t go through. Try again.'],
    [504, 'QOREID_TIMEOUT', null, 'The NIN check is taking longer than usual. Try again in a minute.'],
    [409, 'PATIENT_ALREADY_HAS_NIN', 'This patient\'s earlier records hold a different NIN. Ask Health ID support to review it.',
      'This patient’s earlier records hold a different NIN. Ask Health ID support to review it.'],
    [409, 'PATIENT_NOT_IDENTIFIED', null, 'Identify this patient before adding a NIN.'],
    [409, 'NIN_LINK_TRY_LATER', null, 'A NIN cannot be added until the earlier records’ NIN check is complete. Please try again later.'],
    [409, 'NIN_ON_ANOTHER_RECORD', null, 'This NIN is already on another patient record. Ask an approver to review the two records.'],
    [429, 'QOREID_RATE_LIMITED', null, 'Too many NIN checks right now. Try again in a minute.'],
  ])('says %s %s in plain words, and changes nothing', async (status, code, detail, words) => {
    api.linkPatientNin.mockRejectedValue(new HidApiError(status, 'Identity’s own text', { code, detail }))
    await openForm()
    await send(NIN)
    await waitFor(() => expect(within(form()).getAllByRole('alert').map(alert => alert.textContent)).toContain(words))
    expect(document.body.textContent).not.toContain('Identity’s own text')
    expect(ninFact()).toBe('NIN Not Verified')
    expect(ninField().value).toBe('')
  })
})

describe('when Verify NIN is not offered', () => {
  it('says NIN checks are not available right now, with no button', async () => {
    api.registrationCapabilities.mockResolvedValue(NIN_OFF)
    await findCase()
    await waitFor(() => expect(within(actions()).getByText(OFF_LINE)).toBeTruthy())
    expect(within(actions()).queryByRole('button', { name: 'Verify NIN' })).toBeNull()
  })

  it('offers it once NIN checks could be read again, after a read that failed', async () => {
    api.registrationCapabilities.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'UPSTREAM_UNAVAILABLE' }))
    await findCase()
    await waitFor(() => expect(within(actions()).getByText(/We couldn’t check whether NIN checks are working, so the NIN can’t be added yet\./))
      .toBeTruthy())
    expect(within(actions()).queryByRole('button', { name: 'Verify NIN' })).toBeNull()
    await act(async () => { fireEvent.click(within(actions()).getByRole('button', { name: 'Check again' })) })
    await waitFor(() => expect(within(actions()).getByRole('button', { name: 'Verify NIN' })).toBeTruthy())
  })

  it('offers nothing while NIN checks are still being read, and says so', async () => {
    api.registrationCapabilities.mockReturnValue(new Promise(() => {}))
    await findCase()
    expect(within(actions()).getByText('Checking NIN checks are working…')).toBeTruthy()
    expect(within(actions()).queryByRole('button', { name: 'Verify NIN' })).toBeNull()
  })

  it('is not offered for a patient whose NIN is verified', async () => {
    api.registrationCase.mockResolvedValue({ ...REGISTERED, identityEvidence: 'nin', ninStatus: 'verified' })
    await findCase()
    expect(within(actions()).queryByRole('button', { name: 'Verify NIN' })).toBeNull()
    expect(within(actions()).queryByText(OFF_LINE)).toBeNull()
  })

  it('is not offered on a registration that has no patient yet', async () => {
    api.registrationCase.mockResolvedValue({ caseId: CASE, status: 'review_required', version: 1, candidateCount: 1,
      identityEvidence: 'none', ninStatus: 'not_verified', candidates: [] })
    await findCase()
    expect(within(actions()).queryByRole('button', { name: 'Verify NIN' })).toBeNull()
  })

  it('an approver is told no patient account can be set up from a registration made without a NIN, before and after a NIN is added', async () => {
    session.permissions = [WRITE, APPROVE]
    api.linkPatientNin.mockResolvedValue(LINKED)
    const words = 'A patient account can’t be set up from a registration made without a NIN, even after a NIN is added.'
    await openForm()
    expect(within(actions()).getByText(words)).toBeTruthy()
    await send(NIN)
    await waitFor(() => expect(ninFact()).toBe('NIN Verified'))
    expect(within(actions()).getByText(words)).toBeTruthy()
    expect(within(actions()).queryByRole('button', { name: 'Create their account' })).toBeNull()
  })
})

describe('the rules', () => {
  const facts = (overrides: Partial<VerifyNinFacts> = {}): VerifyNinFacts => ({
    ninStatus: 'not_verified', recordKind: 'registered', canRegister: true, ownFacility: true, emergency: false,
    capabilities: NIN_ON, capabilitiesAnswered: true, ...overrides,
  })

  it('offers it only to staff who register patients, for this facility’s own identified patient without a verified NIN', () => {
    expect(verifyNinOffer(facts())).toBe('offer')
    expect(verifyNinOffer(facts({ ninStatus: 'verified' }))).toBe('none')
    expect(verifyNinOffer(facts({ ninStatus: undefined }))).toBe('none')
    expect(verifyNinOffer(facts({ recordKind: 'unknown' }))).toBe('none')
    expect(verifyNinOffer(facts({ canRegister: false }))).toBe('none')
    expect(verifyNinOffer(facts({ ownFacility: false }))).toBe('none')
    expect(verifyNinOffer(facts({ emergency: true }))).toBe('none')
  })

  it('waits for registration-capabilities, and is off unless nin.available is true', () => {
    expect(verifyNinOffer(facts({ capabilities: NIN_OFF }))).toBe('off')
    expect(verifyNinOffer(facts({ capabilities: { ...NIN_ON, nin: { enabled: true, state: 'qoreid' } } }))).toBe('off')
    expect(verifyNinOffer(facts({ capabilities: null, capabilitiesAnswered: false }))).toBe('loading')
    expect(verifyNinOffer(facts({ capabilities: null, capabilitiesAnswered: true }))).toBe('unknown')
  })

  it('reads the NIN as Identity does: spaces and hyphens removed, then 11 digits', () => {
    expect(ninForLink(' 0000 0000-000 ')).toBe(NIN)
    expect(ninForLink('0000000000')).toBeNull()
    expect(ninForLink('000000000000')).toBeNull()
    expect(ninForLink('0000000000a')).toBeNull()
  })

  it('treats every 502 and 503 as NIN checks being unavailable, and reads the capabilities again', () => {
    for (const status of [502, 503]) {
      expect(verifyNinRefusal(new HidApiError(status, 'x', { code: 'UPSTREAM_UNAVAILABLE' })))
        .toMatchObject({ text: 'NIN checks are not available right now. Try again in a minute.', recheck: true })
    }
  })

  it('never sends again by itself: a refusal holds the button until a time, and no more', () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0)
    expect(verifyNinRefusal(new HidApiError(409, 'x', { code: 'NIN_CHECK_IN_PROGRESS', retryInSeconds: 60 }), now).holdUntil).toBe(now + 60_000)
    expect(verifyNinRefusal(new HidApiError(409, 'x', { code: 'NIN_CHECK_HELD', retryInSeconds: 600 }), now).holdUntil).toBe(now + 600_000)
    expect(verifyNinRefusal(new HidApiError(409, 'x', { code: 'NIN_CHECK_HELD' }), now))
      .toMatchObject({ holdUntil: null, text: 'This NIN check is on hold. Try again in a few minutes.' })
  })
})
