import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { described, json, press, problem, renderPortal, type Handler, type Sent, shownText } from './portalHarness'
import { enterCode } from './codeBoxes'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

afterEach(() => { vi.restoreAllMocks() })

const BASE = '/identity/patient-enrollments'
const NIN = '12345678901'
const DESK_CODE = 'K7M2Q9X4PA'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
const WHAT_TO_BRING = ['Your own phone with this registration open',
  'One original photo ID: national ID card, international passport, driver\'s licence or voter\'s card',
  'A phone number or email that can receive codes now']

const holder = (online: Record<string, unknown> = { available: true }, facility: Record<string, unknown> = { available: true }) =>
  ({ stage: 'verify_holder', expiresAt: '2026-10-16T10:00:00.000Z', googleOnboardingRequired: false, online, facility })
const withCode = (code = DESK_CODE) => holder({ available: true }, { available: true, deskCode: code, deskCodeExpiresAt: '2026-10-16T10:00:00.000Z' })

interface Routes { current?: () => Response; start?: () => Response; post?: Record<string, Handler> }
function gateway({ current = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found'), start = () => json(holder()),
  post = {} }: Routes = {}): Handler {
  return (path, method, body) => {
    if (path === `${BASE}/availability`) return json({ open: true, online: true, facility: true })
    if (path === `${BASE}/current`) return current()
    if (path === `${BASE}/participating-facilities`) return json({ whatToBring: WHAT_TO_BRING,
      facilities: [{ name: 'Synthetic General Hospital', town: 'Ikeja', lga: 'Ikeja', state: 'Lagos' }] })
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    if (path === BASE && method === 'POST') return start()
    const handler = method === 'POST' ? post[path.slice(BASE.length + 1)] : undefined
    return handler ? handler(path, method, body) : problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}
const startKeys = (headers: Array<{ path: string; method: string; headers: Headers }>) =>
  headers.filter(request => request.path === BASE && request.method === 'POST').map(request => request.headers.get('Idempotency-Key'))
const deskCodes = (sent: Sent[]) => sent.filter(request => request.path === `${BASE}/facility-code`)
const facilityStage = () => screen.findByRole('heading', { level: 2, name: 'Register at a healthcare facility' })

async function toFacility() {
  fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: NIN } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Prove this NIN is yours' })
  await press(screen.getByRole('button', { name: 'Register at a facility' }))
  return facilityStage()
}

/**
 * The facility route on the patient's own device (hid-system #85, ADR-063): the
 * patient starts with their NIN, asks for a desk code (POST .../facility-code),
 * shows it to a staff member who checks one original photo ID, then reads
 * GET .../current again to continue at `verify_contact`. The code is shown
 * again after a reload and is not reissued; a 404 after the check follows the
 * staff member's direction (Health-id alignment row 3, P31; owner decision
 * 2026-10-14, steps 4 and 5).
 */
describe('registering at a healthcare facility', () => {
  it('explains that an in-person check is needed first, with what to bring and the facilities, focused on its heading', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway(), anonymous)
    const heading = await toFacility()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const stage = heading.closest('section')!
    expect(stage.textContent).toContain('A staff member at a participating facility must check your identity in person before your registration can be finished. Nothing has been verified yet.')
    expect(within(await screen.findByRole('region', { name: 'What to bring' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(WHAT_TO_BRING)
    expect(screen.getByRole('region', { name: 'Participating facilities' }).textContent).toContain('Synthetic General Hospital')
    expect(deskCodes(sent)).toEqual([])
    const get = screen.getByRole('button', { name: 'Get my desk code' })
    expect(described(get)).toContain('You\'ll show this code to the staff member at the facility.')
    expect(screen.queryByRole('button', { name: 'I have been checked' })).toBeNull()
  })

  it('shows the desk code it asked for, focused, and keeps it out of storage and the address', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { sent } = renderPortal(<Enrollment />, gateway({ post: { 'facility-code': () => json(withCode()) } }), anonymous)
    await toFacility()
    await press(screen.getByRole('button', { name: 'Get my desk code' }))
    const title = await screen.findByRole('heading', { name: 'Your desk code' })
    await waitFor(() => expect(document.activeElement).toBe(title))
    const code = title.closest('section')!
    expect(code.textContent).toContain('K7M2Q 9X4PA')
    expect(code.textContent).toContain('Show this code to the staff member.')
    expect(deskCodes(sent)).toEqual([{ path: `${BASE}/facility-code`, method: 'POST', body: null }])
    expect(setItem).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain(DESK_CODE)
    expect(window.history.state === null || !JSON.stringify(window.history.state).includes(DESK_CODE)).toBe(true)
  })

  it('shows the same desk code again after a reload, without asking for another', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway({ current: () => json(withCode()) }), anonymous)
    const title = await screen.findByRole('heading', { name: 'Your desk code' })
    expect(title.closest('section')!.textContent).toContain('K7M2Q 9X4PA')
    expect(deskCodes(sent)).toEqual([])
  })

  it('continues at the contact step once "I have been checked" finds the check recorded, with the fields the record lacks', async () => {
    let current = () => json(withCode())
    renderPortal(<Enrollment />, gateway({ current: () => current(), post: {
      contact: () => json({ challengeId: 'contact-challenge', expiresInSeconds: 600, resendAfterSeconds: 60 }),
      'contact/verify': () => json({ stage: 'set_password' }) } }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    current = () => json({ stage: 'verify_contact', expiresAt: '2026-10-16T10:00:00.000Z', googleOnboardingRequired: false, requiredProfileFields: ['dateOfBirth'] })
    await press(screen.getByRole('button', { name: 'I have been checked' }))
    const contact = await screen.findByLabelText('Phone number')
    await waitFor(() => expect(document.activeElement).toBe(contact))
    expect(screen.getByText('Your identity was checked at the facility. Now add a contact we can send a code to.').closest('[role="status"]')).toBeTruthy()
    expect(document.body.textContent).not.toContain('K7M2Q')
    fireEvent.change(contact, { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send code' }))
    await enterCode(await screen.findByLabelText('Code'), '654321')
    expect(await screen.findByLabelText('Date of birth')).toBeTruthy()
  })

  it('says the check is not recorded yet while the enrollment still waits at the facility', async () => {
    renderPortal(<Enrollment />, gateway({ current: () => json(withCode()) }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    await press(screen.getByRole('button', { name: 'I have been checked' }))
    const status = await screen.findByText('The facility has not recorded your check yet. Show the staff member your desk code, then select I have been checked again.')
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.getByRole('heading', { name: 'Your desk code' })).toBeTruthy()
  })

  it('follows the staff member\'s direction when the registration is gone after the check (P31), without asking for the same NIN', async () => {
    let current = () => json(withCode())
    const { sent, headers } = renderPortal(<Enrollment />, gateway({ current: () => current() }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    current = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    await press(screen.getByRole('button', { name: 'I have been checked' }))
    const heading = await screen.findByRole('heading', { name: 'This registration has ended' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const outcome = heading.closest('section')!
    expect(outcome.textContent).toContain('If the staff member told you this NIN already has a Health ID, reset your password to get back into it.')
    expect(within(outcome).getByRole('link', { name: 'Reset your password' }).getAttribute('href')).toBe('/recover')
    expect(within(outcome).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
    expect(document.body.textContent).not.toMatch(/same NIN/)
    await press(within(outcome).getByRole('button', { name: 'Start again' }))
    const nin = await screen.findByLabelText('National Identification Number (NIN)')
    expect((nin as HTMLInputElement).value).toBe('')
    fireEvent.change(nin, { target: { value: NIN } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Prove this NIN is yours' })
    expect(sent.filter(request => request.path === BASE)).toHaveLength(1)
    expect(startKeys(headers)[0]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('replaces the desk code only when asked, saying it replaces the last one', async () => {
    let issued = 0
    const { sent } = renderPortal(<Enrollment />, gateway({ current: () => json(withCode()),
      post: { 'facility-code': () => json(withCode(++issued === 1 ? 'B3N4M5P6Q7' : DESK_CODE)) } }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    const again = screen.getByRole('button', { name: 'Get a new desk code' })
    expect(described(again)).toContain('Only if the staff member asks for a new code. It replaces this one.')
    await press(again)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your desk code' }).closest('section')!.textContent).toContain('B3N4M 5P6Q7'))
    expect(deskCodes(sent)).toHaveLength(1)
  })

  it.each([
    ['409 ASSISTED_REGISTRATION_UNAVAILABLE', 409, 'ASSISTED_REGISTRATION_UNAVAILABLE', 'Registration at a facility is not available now.',
      'Registration at a facility is not available now. You can get a code by text message instead, or try again later.'],
    ['429 ASSISTED_DESK_CODE_LIMITED', 429, 'ASSISTED_DESK_CODE_LIMITED', 'Too many desk codes were issued for this registration. Start again or try later.',
      'Too many desk codes were issued for this registration. Start again or try later.'],
  ])('says so on %s', async (_case, status, code, detail, text) => {
    renderPortal(<Enrollment />, gateway({ post: { 'facility-code': () => problem(status, code, detail) } }), anonymous)
    await toFacility()
    await press(screen.getByRole('button', { name: 'Get my desk code' }))
    expect(shownText(await screen.findByRole('alert'))).toBe(text)
    expect(screen.queryByRole('heading', { name: 'Your desk code' })).toBeNull()
  })

  it('offers to start again after 429 ASSISTED_DESK_CODE_LIMITED, with a new key', async () => {
    const { headers } = renderPortal(<Enrollment />, gateway({ post: { 'facility-code': () => problem(429, 'ASSISTED_DESK_CODE_LIMITED',
      'Too many desk codes were issued for this registration. Start again or try later.') } }), anonymous)
    await toFacility()
    await press(screen.getByRole('button', { name: 'Get my desk code' }))
    await screen.findByRole('alert')
    await press(screen.getByRole('button', { name: 'Use a different NIN' }))
    fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: NIN } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Prove this NIN is yours' })
    const keys = startKeys(headers)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('goes where Identity has the enrollment on 409 ENROLLMENT_STAGE_INVALID (the holder step is done)', async () => {
    let current = () => json(holder())
    renderPortal(<Enrollment />, gateway({ current: () => current(), post: { 'facility-code': () => {
      current = () => json({ stage: 'verify_contact', requiredProfileFields: [] })
      return problem(409, 'ENROLLMENT_STAGE_INVALID', 'This registration is past the step that proves you hold the NIN')
    } } }), anonymous)
    await screen.findByRole('heading', { name: 'Prove this NIN is yours' })
    await press(screen.getByRole('button', { name: 'Register at a facility' }))
    await facilityStage()
    await press(screen.getByRole('button', { name: 'Get my desk code' }))
    expect(await screen.findByLabelText('Phone number')).toBeTruthy()
  })

  it('keeps the stage, and the session, when the desk code or the check cannot be read now', async () => {
    const signOut = vi.fn()
    let current = () => json(withCode())
    const { sent } = renderPortal(<Enrollment />, gateway({ current: () => current() }), { ...anonymous, signOut })
    await screen.findByRole('heading', { name: 'Your desk code' })
    current = () => problem(503, 'ENROLLMENT_UNAVAILABLE', 'The service could not complete the request.')
    await press(screen.getByRole('button', { name: 'I have been checked' }))
    expect(shownText(await screen.findByRole('alert', {}, { timeout: 5000 }))).toBe('Registration is temporarily unavailable. Try again in a few minutes.')
    expect(screen.getByRole('heading', { name: 'Your desk code' })).toBeTruthy()
    expect(signOut).not.toHaveBeenCalled()
    expect(sent.filter(request => request.path.startsWith('/auth/') && request.path !== '/auth/google/onboarding')).toEqual([])
  })

  it('offers the code by text message from the facility stage when that route is open', async () => {
    renderPortal(<Enrollment />, gateway({ current: () => json(withCode()) }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    await press(screen.getByRole('button', { name: 'Get a code by text message instead' }))
    expect(await screen.findByRole('heading', { name: 'Prove this NIN is yours' })).toBeTruthy()
  })
})

describe('the facility stage after review', () => {
  it('follows the staff member\'s direction when a new desk code finds the registration gone (P31)', async () => {
    renderPortal(<Enrollment />, gateway({ current: () => json(withCode()),
      post: { 'facility-code': () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found') } }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    await press(screen.getByRole('button', { name: 'Get a new desk code' }))
    expect(await screen.findByRole('heading', { name: 'This registration has ended' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Enter your NIN to start again/)
  })

  it('says the facility route closed when "I have been checked" finds it so, instead of saying nothing', async () => {
    let current = () => json(withCode())
    renderPortal(<Enrollment />, gateway({ current: () => current() }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    current = () => json(holder({ available: true }, { available: false }))
    await press(screen.getByRole('button', { name: 'I have been checked' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('Registration at a facility is not available now, so no check can be recorded. Try again later, or get a code by text message if you can.')
    expect(await screen.findByRole('heading', { name: 'Prove this NIN is yours' })).toBeTruthy()
  })
})

/**
 * A sign-in, refresh or sign-out in this browser expires the enrollment cookie
 * and leaves the registration as it was (hid-system `main` f9dbaf0,
 * auth.controller.ts clearEnrollmentCookie). A start with the same key and NIN
 * resumes it, the in-person check included, with no new NIN lookup
 * (patient-enrollment.service.ts resume); a new key is a new paid lookup and a
 * new registration that must be checked at the facility again. One that is
 * really gone starts afresh with either key. So a 404 at the facility stage
 * keeps the start key, as at every other stage.
 */
describe('the facility stage when the enrollment cookie is lost', () => {
  const NOT_FOUND = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
  const checked = () => json({ stage: 'verify_contact', expiresAt: '2026-10-16T10:00:00.000Z', googleOnboardingRequired: false, requiredProfileFields: [] })
  async function sameNinAgain() {
    fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: NIN } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
  }

  it('continues with the same key after the sign-out note and a 404, as the note says', async () => {
    let current = NOT_FOUND
    let start = () => json(holder())
    const { headers } = renderPortal(<Enrollment />, gateway({ current: () => current(), start: () => start(),
      post: { 'facility-code': () => json(withCode()) } }), anonymous)
    await toFacility()
    await press(screen.getByRole('button', { name: 'Get my desk code' }))
    await screen.findByRole('heading', { name: 'Your desk code' })
    // Someone signed in elsewhere in this browser: Identity refuses the step until they sign out.
    current = () => problem(409, 'PATIENT_ENROLLMENT_REQUIRES_SIGN_OUT', 'Sign out before starting or continuing a new Health ID enrollment')
    await press(screen.getByRole('button', { name: 'I have been checked' }))
    expect(await screen.findByText(/continue it by entering the same NIN before reloading this page/)).toBeTruthy()
    // Signing out expired the enrollment cookie; the staff member had recorded the check.
    current = NOT_FOUND
    await press(screen.getByRole('button', { name: 'Check again' }))
    const nin = await screen.findByLabelText('National Identification Number (NIN)')
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect(screen.getByRole('alert').textContent).toMatch(/ended when someone signed in or out in this browser\. Enter your NIN to start again\.$/)
    expect(screen.queryByRole('heading', { name: 'This registration has ended' })).toBeNull()
    start = checked
    await sameNinAgain()
    expect(await screen.findByLabelText('Phone number')).toBeTruthy()
    const keys = startKeys(headers)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it.each([
    ['"I have been checked"', 'I have been checked', {}],
    ['"Get a new desk code"', 'Get a new desk code', { 'facility-code': () => NOT_FOUND() }],
  ])('keeps the start key when %s finds the registration gone, so Start again with that NIN resumes one still open', async (_case, action, post) => {
    let current = NOT_FOUND
    let start = () => json(withCode())
    const { headers } = renderPortal(<Enrollment />, gateway({ current: () => current(), start: () => start(), post }), anonymous)
    fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: NIN } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Your desk code' })
    current = NOT_FOUND
    await press(screen.getByRole('button', { name: action }))
    const heading = await screen.findByRole('heading', { name: 'This registration has ended' })
    const outcome = heading.closest('section')!
    expect(outcome.textContent).toContain('Otherwise it may have expired after 24 hours, or ended when someone signed in or out in this browser.')
    expect(outcome.textContent).toContain('Select Start again and enter your NIN without reloading this page: a registration that is still open continues where it stopped.')
    await press(within(outcome).getByRole('button', { name: 'Start again' }))
    const nin = await screen.findByLabelText('National Identification Number (NIN)')
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect((nin as HTMLInputElement).value).toBe('')
    start = checked
    await sameNinAgain()
    expect(await screen.findByLabelText('Phone number')).toBeTruthy()
    const keys = startKeys(headers)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })
})

/**
 * A live region inserted with its text already in it is often not read, and
 * focus moving to the contact field at the same time speaks over it. The
 * page's notice region stays mounted and its text changes, as the portal's
 * other notices do; the contact field is also described by it, so the
 * confirmation is read where focus lands.
 */
describe('the facility check confirmation', () => {
  it('is said in a status region already on the page, and describes the contact field focus moves to', async () => {
    let current = () => json(withCode())
    renderPortal(<Enrollment />, gateway({ current: () => current(),
      post: { contact: () => json({ challengeId: 'contact-challenge', expiresInSeconds: 600, resendAfterSeconds: 60 }) } }), anonymous)
    await screen.findByRole('heading', { name: 'Your desk code' })
    const regions = screen.getAllByRole('status')
    current = () => json({ stage: 'verify_contact', expiresAt: '2026-10-16T10:00:00.000Z', googleOnboardingRequired: false, requiredProfileFields: [] })
    await press(screen.getByRole('button', { name: 'I have been checked' }))
    const contact = await screen.findByLabelText('Phone number')
    await waitFor(() => expect(document.activeElement).toBe(contact))
    const text = 'Your identity was checked at the facility. Now add a contact we can send a code to.'
    const region = screen.getByText(text).closest('[role="status"]')
    expect(regions).toContain(region)
    expect(described(contact)).toContain(text)
    // Said once: the next step clears it.
    fireEvent.change(contact, { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Code')
    expect(screen.queryByText(text)).toBeNull()
  })
})
