import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { described, json, press, problem, renderPortal, type Handler, type Sent, shownText } from './portalHarness'
import { codeValue, enterCode as enterCodeInto } from './codeBoxes'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

vi.mock('../GoogleButton', () => ({
  GoogleButton: () => <button type="button">Sign up with Google</button>,
}))

afterEach(() => { vi.restoreAllMocks() })

const BASE = '/identity/patient-enrollments'
const NIN = '12345678901'
const CHALLENGE = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
const HOLDER_ROUTE_UNAVAILABLE = 'We cannot send a code to the phone on your NIN record. Use a participating facility to register.'
const HOLDER_ROUTE_LIMITED = 'Use a participating facility to register.'
/** The page's own words for NIN_HOLDER_ROUTE_UNAVAILABLE, never Identity's (owner's rule, 1 Nov 2026). */
const HOLDER_ROUTE_SAID = 'We can’t send a code to the phone on your NIN record. Register at a participating facility instead.'
const CODE_REFUSED = 'That code is wrong or has expired. Check the latest text message, or ask for a new code.'

/** The start's answer since hid-system #84: every NIN alike, nothing about the record but whether a code can be texted. */
const holder = (online: Record<string, unknown> = { available: true }, facility: Record<string, unknown> = { available: true }) =>
  ({ stage: 'verify_holder', expiresAt: '2026-10-16T10:00:00.000Z', googleOnboardingRequired: false, online, facility })
const withReference = (status: number, code: string, detail: string, correlationId = 'corr-7f3a') =>
  json({ type: 'about:blank', title: code, status, code, detail, correlationId }, status)

interface Routes { current?: () => Response; start?: Handler; post?: Record<string, Handler> }
function gateway({ current = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found'),
  start = () => json(holder()), post = {} }: Routes = {}): Handler {
  return (path, method, body) => {
    if (path === `${BASE}/availability`) return json({ open: true, online: true, facility: true })
    if (path === `${BASE}/current`) return current()
    if (path === `${BASE}/participating-facilities`) return json({ facilities: [], whatToBring: ['Your own phone with this registration open'] })
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    if (path === BASE && method === 'POST') return start(path, method, body)
    const handler = method === 'POST' ? post[path.slice(BASE.length + 1)] : undefined
    return handler ? handler(path, method, body) : problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}
/** The Idempotency-Key of each start, in order. */
const startKeys = (headers: Array<{ path: string; method: string; headers: Headers }>) =>
  headers.filter(request => request.path === BASE && request.method === 'POST').map(request => request.headers.get('Idempotency-Key'))
const sentTo = (sent: Sent[], step: string) => sent.filter(request => request.path === `${BASE}/${step}` && request.method === 'POST')
const choice = () => screen.findByRole('heading', { name: 'Prove this NIN is yours' })
const codeStep = () => screen.findByRole('heading', { name: 'Enter the code we texted you' })

async function startHolder() {
  fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: NIN } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
  return choice()
}
async function toCode() {
  await startHolder()
  await press(screen.getByRole('button', { name: 'Text me a code' }))
  return codeStep()
}
/** The sixth digit sends the code (CodeBoxes.tsx). */
async function enterCode(code = '123456') {
  await enterCodeInto(screen.getByLabelText('Verification code'), code)
}
const sending = { holder: () => json({ challengeId: CHALLENGE, expiresInSeconds: 600, resendAfterSeconds: 60 }) }

/**
 * hid-system main f9dbaf0 (#84, ADR-062): every start answers `verify_holder`,
 * and the patient proves they hold the NIN before a contact or a password: a
 * code texted to the phone on the NIN record (POST .../holder, then
 * .../holder/verify), or in person at a participating facility. The page
 * showed the contact form at `verify_holder`, which Identity refuses
 * (Health-id alignment row 2; owner decision 2026-10-14, steps 2, 3 and 5).
 */
describe('the NIN holder step: choosing a route', () => {
  it('offers both routes after the NIN, focused on the stage heading, and sends nothing until asked', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { sent } = renderPortal(<Enrollment />, gateway(), anonymous)
    const heading = await startHolder()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const online = screen.getByRole('region', { name: 'Get a code by text message' })
    expect(online.textContent).toContain('We\'ll text a 6-digit code to the phone number linked to your NIN.')
    const facility = screen.getByRole('region', { name: 'Register at a healthcare facility' })
    expect(facility.textContent).toContain('lost their SIM, changed their number, have no phone linked to their NIN, or can\'t get the code')
    expect(within(facility).getByRole('button', { name: 'Register at a facility' })).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
    expect(document.body.textContent).not.toContain(NIN)
    expect(document.body.textContent).not.toMatch(/identity (is |has been )?verified|NIN verified/i)
    expect(sent.filter(request => request.method === 'POST').map(request => request.path)).toEqual([BASE])
    expect(screen.getByRole('list', { name: 'Enrollment steps' }).querySelector('[aria-current="step"]')?.lastChild?.textContent).toBe('Prove it\'s yours')
    expect(setItem).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain(NIN)
  })

  it('says why a code cannot be texted for this record, and offers the facility', async () => {
    renderPortal(<Enrollment />, gateway({ start: () => json(holder({ available: false })) }), anonymous)
    await startHolder()
    const online = screen.getByRole('region', { name: 'Get a code by text message' })
    expect(online.textContent).toContain('We can\'t send a code to the phone on your NIN record.')
    expect(within(online).queryByRole('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Register at a facility' })).toBeTruthy()
  })

  it('says registering at a facility is not available yet when that route is closed', async () => {
    renderPortal(<Enrollment />, gateway({ start: () => json(holder({ available: true }, { available: false })) }), anonymous)
    await startHolder()
    const facility = screen.getByRole('region', { name: 'Register at a healthcare facility' })
    expect(facility.textContent).toContain('Registering at a healthcare facility isn\'t available right now.')
    expect(within(facility).queryByRole('button')).toBeNull()
  })

  it('opens the code step again after a reload while a code is open', async () => {
    renderPortal(<Enrollment />, gateway({ current: () => json(holder({ available: true, challengeId: CHALLENGE, expiresInSeconds: 300, resendAfterSeconds: 0 })) }), anonymous)
    await codeStep()
    expect(described(screen.getByLabelText('Verification code'))).toContain('It expires in 5 minutes.')
  })

  it('starts again with a new key after "Use a different NIN"', async () => {
    const { headers } = renderPortal(<Enrollment />, gateway(), anonymous)
    await startHolder()
    await press(screen.getByRole('button', { name: 'Use a different NIN' }))
    const nin = await screen.findByLabelText('National Identification Number (NIN)')
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect((nin as HTMLInputElement).value).toBe('')
    await startHolder()
    const keys = startKeys(headers)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })
})

describe('the NIN holder step: the code texted to the phone on the NIN record', () => {
  it('sends the code with no body, then asks for it, explaining the resend wait', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway({ post: sending }), anonymous)
    const heading = await toCode()
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(sentTo(sent, 'holder')).toEqual([{ path: `${BASE}/holder`, method: 'POST', body: null }])
    const code = screen.getByLabelText('Verification code')
    expect(described(code)).toContain('We sent a 6-digit code to the phone number linked to your NIN. It expires in 10 minutes.')
    const resend = screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
    expect(resend.disabled).toBe(true)
    expect(described(resend)).toBe('A new code can be sent 60 seconds after the last one.')
    const verify = screen.getByRole('button', { name: 'Verify code' }) as HTMLButtonElement
    expect(verify.disabled).toBe(true)
    expect(described(verify)).toBe('Enter the 6-digit code to continue.')
    expect(screen.getByText('This registration can get up to 3 codes.')).toBeTruthy()
  })

  it('continues to the contact step after a correct code, carrying the fields the NIN record lacks to the password step', async () => {
    let current = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    const { sent } = renderPortal(<Enrollment />, gateway({ current: () => current(), post: { ...sending,
      'holder/verify': () => json({ stage: 'verify_contact', requiredProfileFields: ['gender'] }),
      contact: () => json({ challengeId: 'contact-challenge', expiresInSeconds: 600, resendAfterSeconds: 60 }),
      'contact/verify': () => json({ stage: 'set_password' }) } }), anonymous)
    await toCode()
    await enterCode()
    expect(sentTo(sent, 'holder/verify').map(request => request.body)).toEqual([{ challengeId: CHALLENGE, code: '123456' }])
    const contact = await screen.findByLabelText('Phone number')
    await waitFor(() => expect(document.activeElement).toBe(contact))
    current = () => json({ stage: 'verify_contact', requiredProfileFields: ['gender'] })
    fireEvent.change(contact, { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send code' }))
    // The contact's code, in its own boxes (named "Code"; the holder's are "Verification code").
    await enterCodeInto(await screen.findByLabelText('Code'), '654321')
    expect(await screen.findByLabelText('Gender')).toBeTruthy()
    expect(screen.queryByLabelText('Date of birth')).toBeNull()
  })

  it('says a wrong or expired code at the field, with focus there', async () => {
    renderPortal(<Enrollment />, gateway({ post: { ...sending,
      'holder/verify': () => problem(422, 'OTP_INVALID', 'The verification code is invalid or expired') } }), anonymous)
    await toCode()
    await enterCode('000000')
    const code = screen.getByLabelText('Verification code')
    await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('true'))
    expect(described(code)).toContain(CODE_REFUSED)
    await waitFor(() => expect(document.activeElement).toBe(code))
  })

  it('waits as Retry-After says on 429 OTP_RESEND_COOLDOWN, keeping the open code', async () => {
    // The open code's wait has passed here, but another tab sent one since.
    renderPortal(<Enrollment />, gateway({ current: () => json(holder({ available: true, challengeId: CHALLENGE, expiresInSeconds: 500, resendAfterSeconds: 0 })),
      post: { holder: () => new Response(JSON.stringify({ type: 'about:blank', title: 'OTP_RESEND_COOLDOWN', status: 429, code: 'OTP_RESEND_COOLDOWN',
        detail: 'Wait before requesting another code' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '42' } }) } }), anonymous)
    await codeStep()
    const resend = screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
    await waitFor(() => expect(resend.disabled).toBe(false))
    expect(screen.getByText('You can ask for a new code now.').getAttribute('role')).toBe('status')
    await press(resend)
    expect(shownText(await screen.findByRole('alert'))).toBe('A code was sent recently. You can ask for a new code in 42 seconds.')
    expect((screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByLabelText('Verification code')).toBeTruthy()
  })

  it('reads the wait from the enrollment on 429 OTP_RESEND_COOLDOWN without Retry-After', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway({
      current: () => json(holder({ available: true, challengeId: CHALLENGE, expiresInSeconds: 500, resendAfterSeconds: 25 })),
      start: () => json(holder()),
      post: { holder: () => problem(429, 'OTP_RESEND_COOLDOWN', 'Wait before requesting another code') } }), anonymous)
    // A code was sent from this enrollment in another tab: this one is still at the choice.
    await codeStep()
    await press(screen.getByRole('button', { name: 'I can\'t get the code' }))
    await choice()
    await press(screen.getByRole('button', { name: 'Text me a code' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('A code was sent recently. You can ask for a new code in 25 seconds.')
    expect(await codeStep()).toBeTruthy()
    expect(sentTo(sent, 'holder')).toHaveLength(1)
  })

  it.each([
    ['409', 409, 'there is no usable phone on the record'],
    ['503', 503, 'the online route is off'],
  ])('says it in plain words and offers the facility on %s NIN_HOLDER_ROUTE_UNAVAILABLE when %s', async (_status, status) => {
    const signOut = vi.fn()
    let current = () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    renderPortal(<Enrollment />, gateway({ current: () => current(),
      post: { holder: () => {
        current = () => json(holder({ available: false }))
        return problem(status, 'NIN_HOLDER_ROUTE_UNAVAILABLE', HOLDER_ROUTE_UNAVAILABLE)
      } } }), { ...anonymous, signOut })
    await startHolder()
    await press(screen.getByRole('button', { name: 'Text me a code' }))
    expect(shownText(await screen.findByRole('alert'))).toBe(HOLDER_ROUTE_SAID)
    const online = screen.getByRole('region', { name: 'Get a code by text message' })
    expect(within(online).queryByRole('button', { name: 'Text me a code' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Register at a facility' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Prove this NIN is yours' })))
    expect(signOut).not.toHaveBeenCalled()
  })

  it('leads to the facility on 429 NIN_HOLDER_ROUTE_LIMITED when sending', async () => {
    renderPortal(<Enrollment />, gateway({ post: { holder: () => problem(429, 'NIN_HOLDER_ROUTE_LIMITED', HOLDER_ROUTE_LIMITED) } }), anonymous)
    await startHolder()
    await press(screen.getByRole('button', { name: 'Text me a code' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('This NIN can\'t be proved by a text message code now. Use a participating facility to register.')
    expect(within(screen.getByRole('region', { name: 'Get a code by text message' })).queryByRole('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Register at a facility' })).toBeTruthy()
  })

  it('says the text could not be sent on 503 OTP_DELIVERY_UNAVAILABLE, keeping the route to try again and the facility', async () => {
    const signOut = vi.fn()
    const { sent } = renderPortal(<Enrollment />, gateway({ post: { holder: () => problem(503, 'OTP_DELIVERY_UNAVAILABLE', 'The service could not complete the request.') } }),
      { ...anonymous, signOut })
    await startHolder()
    await press(screen.getByRole('button', { name: 'Text me a code' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('We couldn\'t send the code just now. Try again later, or register at a participating facility. Each try counts toward this registration\'s 3 codes.')
    expect(screen.getByRole('button', { name: 'Text me a code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Register at a facility' })).toBeTruthy()
    expect(signOut).not.toHaveBeenCalled()
    expect(sent.filter(request => request.path.startsWith('/auth/') && request.path !== '/auth/google/onboarding')).toEqual([])
  })

  /**
   * hid-system 0094 answers 'facility_conflict' only when another registration
   * of this NIN was already checked in person (holder_method facility_in_person,
   * at verify_contact or set_password, unexpired); a desk code still waiting is
   * replaced by the phone proof. That registration is finished on the phone used
   * at the facility. A desk code for this one would only cost a second check,
   * which deletes the one already done.
   */
  it('says on 409 NIN_HOLDER_PROOF_CONFLICT that the NIN was already checked in person, and stays at the choice without a desk code', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway({ post: { ...sending,
      'holder/verify': () => problem(409, 'NIN_HOLDER_PROOF_CONFLICT', 'Registration for this NIN is in progress at a facility.') } }), anonymous)
    await toCode()
    await enterCode()
    const heading = await choice()
    expect(shownText(await screen.findByRole('alert'))).toBe('This NIN was already checked in person at a facility, in another registration. Finish that registration on the phone used at the facility: add a contact and choose a password there. Only if you can\'t, register at a facility and be checked again.')
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.queryByRole('heading', { level: 2, name: 'Register at a healthcare facility' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/desk code/)
    // A text message code can't help while that registration is open.
    const online = screen.getByRole('region', { name: 'Get a code by text message' })
    expect(within(online).queryByRole('button')).toBeNull()
    expect(online.textContent).toContain('A code by text message can\'t prove this NIN while the registration checked at a facility is open.')
    expect(screen.getByRole('button', { name: 'Register at a facility' })).toBeTruthy()
    expect(sentTo(sent, 'facility-code')).toEqual([])
  })

  it.each([
    ['429 NIN_HOLDER_ROUTE_LIMITED', () => problem(429, 'NIN_HOLDER_ROUTE_LIMITED', HOLDER_ROUTE_LIMITED), 'This NIN can\'t be proved by a text message code now. Use a participating facility to register.'],
    ['503 NIN_HOLDER_ROUTE_UNAVAILABLE', () => problem(503, 'NIN_HOLDER_ROUTE_UNAVAILABLE', HOLDER_ROUTE_UNAVAILABLE), HOLDER_ROUTE_SAID],
  ])('goes back to the choice, offering the facility, on %s after a code', async (_case, refusal, text) => {
    renderPortal(<Enrollment />, gateway({ post: { ...sending, 'holder/verify': refusal } }), anonymous)
    await toCode()
    await enterCode()
    expect(await choice()).toBeTruthy()
    expect(shownText(await screen.findByRole('alert'))).toBe(text)
    expect(screen.getByRole('button', { name: 'Register at a facility' })).toBeTruthy()
  })

  it.each([
    ['503 ENROLLMENT_RECONCILIATION_REQUIRED', () => problem(503, 'ENROLLMENT_RECONCILIATION_REQUIRED', 'The service could not complete the request.')],
    ['a lost connection', () => { throw new TypeError('Failed to fetch') }],
  ])('keeps the code step, and the session, on %s', async (_case, refusal) => {
    const signOut = vi.fn()
    renderPortal(<Enrollment />, gateway({ post: { ...sending, 'holder/verify': refusal } }), { ...anonymous, signOut })
    await toCode()
    await enterCode()
    expect(shownText(await screen.findByRole('alert'))).toBe('Registration is temporarily unavailable. Try again in a few minutes.')
    expect(codeValue(screen.getByLabelText('Verification code'))).toBe('123456')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('goes back to the NIN step when the enrollment is gone (404)', async () => {
    renderPortal(<Enrollment />, gateway({ post: { holder: () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found') } }), anonymous)
    await startHolder()
    await press(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByLabelText('National Identification Number (NIN)')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})

describe('a NIN that already has a Health ID, said only after a correct code (row 8)', () => {
  it('leads to account recovery, sign-in and support with the reference, not back to the NIN step', async () => {
    renderPortal(<Enrollment />, gateway({ post: { ...sending,
      'holder/verify': () => withReference(409, 'NIN_ALREADY_REGISTERED', 'This NIN already has a Health ID. Use account recovery to sign in.') } }), anonymous)
    await toCode()
    await enterCode()
    const heading = await screen.findByRole('heading', { name: 'This NIN already has a Health ID' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const outcome = heading.closest('section')!
    expect(within(outcome).getByRole('link', { name: 'Recover your account' }).getAttribute('href')).toBe('/recover')
    expect(within(outcome).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
    expect(outcome.textContent).toContain('If you have never registered for a Health ID, contact Health ID support.')
    // The correlation id is never shown (owner's rule, 1 Nov 2026), nor Identity's own words.
    expect(document.body.textContent).not.toContain('corr-7f3a')
    expect(document.body.textContent).not.toContain('Use account recovery to sign in.')
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
    expect(screen.queryByLabelText('Verification code')).toBeNull()
    expect(document.body.textContent).not.toContain(NIN)
  })
})

describe('the holder step after review', () => {
  it('goes where Identity has the registration, without a resend wait, when a cooldown finds it proved in another tab', async () => {
    let current = () => json(holder({ available: true, challengeId: CHALLENGE, expiresInSeconds: 500, resendAfterSeconds: 0 }))
    renderPortal(<Enrollment />, gateway({ current: () => current(), post: { holder: () => {
      current = () => json({ stage: 'verify_contact', requiredProfileFields: [] })
      return problem(429, 'OTP_RESEND_COOLDOWN', 'Wait before requesting another code')
    } } }), anonymous)
    await codeStep()
    const resend = screen.getByRole('button', { name: 'Send a new code' }) as HTMLButtonElement
    await waitFor(() => expect(resend.disabled).toBe(false))
    await press(resend)
    expect(await screen.findByLabelText('Phone number')).toBeTruthy()
    expect(screen.queryByText(/A code was sent recently/)).toBeNull()
  })

  it('goes back to the NIN step when the registration is gone behind a 409 NIN_HOLDER_ROUTE_UNAVAILABLE', async () => {
    renderPortal(<Enrollment />, gateway({ post: { holder: () => problem(409, 'NIN_HOLDER_ROUTE_UNAVAILABLE', HOLDER_ROUTE_UNAVAILABLE) } }), anonymous)
    await startHolder()
    await press(screen.getByRole('button', { name: 'Text me a code' }))
    expect(await screen.findByLabelText('National Identification Number (NIN)')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/This registration is no longer open on this device/)
  })

  it('offers Google sign-up only where it can be bound to a proved registration, not while the NIN is being proved', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
    try {
      renderPortal(<Enrollment />, gateway({ post: { ...sending, 'holder/verify': () => json({ stage: 'verify_contact', requiredProfileFields: [] }) } }), anonymous)
      expect(await screen.findByRole('region', { name: 'Google enrollment' })).toBeTruthy()
      fireEvent.change(screen.getByLabelText('National Identification Number (NIN)'), { target: { value: NIN } })
      // The NIN step's security check comes first; the second is Google's.
      fireEvent.click(screen.getAllByRole('button', { name: 'Complete check' })[0]!)
      await press(screen.getByRole('button', { name: 'Continue' }))
      await choice()
      expect(screen.queryByRole('region', { name: 'Google enrollment' })).toBeNull()
      await press(screen.getByRole('button', { name: 'Text me a code' }))
      await codeStep()
      expect(screen.queryByRole('region', { name: 'Google enrollment' })).toBeNull()
      await enterCode()
      await screen.findByLabelText('Phone number')
      expect(screen.getByRole('region', { name: 'Google enrollment' })).toBeTruthy()
    } finally { vi.unstubAllEnvs() }
  })
})
