import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { parse } from '../__tests__/cssRules'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * The second step of staff sign-in, as the provider portal shows it
 * (hid-system #71, ADR-054, 0088): the authenticator code or a recovery code
 * after the password, or, on a first sign-in, the emailed code, the
 * authenticator's setup and its recovery codes. The real staff App, API module
 * and HTTP client run; only the network is replaced.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// Provider sign-in also asks whether clinician self sign-up is open (hid-system ADR-066); that has tests of its own.
vi.mock('./clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGIN = 'POST /api/v1/auth/login'
const VERIFY = 'POST /api/v1/auth/mfa/verify'
const EMAIL_CODE = 'POST /api/v1/auth/mfa/enroll/email-code'
const START = 'POST /api/v1/auth/mfa/enroll/start'
const ACTIVATE = 'POST /api/v1/auth/mfa/enroll/activate'
const REQUESTS = 'GET /api/v1/identity/access-requests'

type Answer = () => Response | Promise<Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = 'Identity detail') => () =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })
const ended = problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General', roles: ['clinician'],
  permissions: ['identity.consent.write'], isPrimary: true }
const sessionBody = { actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: ['clinician'],
  permissions: [], facilities: [facility], facility }, expiresAt: '2026-10-14T12:00:00.000Z', facilitySelection: 'default' }
const challenge = (status: 'mfa_required' | 'mfa_enrollment_required') => () => json({ status, expiresAt: '2026-10-14T09:05:00.000Z' })
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const OTPAUTH = `otpauth://totp/Health%20ID:ada%40example.test?secret=${SECRET}&issuer=Health+ID&algorithm=SHA1&digits=6&period=30`
const enrollment = () => json({ secret: SECRET, otpauthUri: OTPAUTH, algorithm: 'SHA1', digits: 6, periodSeconds: 30,
  expiresAt: '2026-10-14T09:10:00.000Z' })
const codeSent = () => json({ accepted: true, channel: 'email', expiresAt: '2026-10-14T09:10:00.000Z' })
const RECOVERY_CODES = ['ABCDE-FGHJK', 'MNPQR-STVWX', '01234-56789']
const activated = () => json({ ...sessionBody, recoveryCodes: RECOVERY_CODES })

const CHALLENGE_SPENT = 'This sign-in step expired or ran out of attempts. Sign in again.'
const FACTOR_UNPROVEN = 'This authenticator was set up for Health ID admin sign-in, so it can’t be used here. '
  + 'Ask Health ID support to reset it, then sign in here to set it up again.'
const MFA_UNAVAILABLE = 'Staff sign-in with an authenticator is temporarily unavailable. '
  + 'Try again later, or contact your administrator if this continues.'

/** Serves each `METHOD /path` from its own queue and records every request with its body. */
function serve(routes: Record<string, Answer[]>) {
  const calls: string[] = []
  const bodies: Array<[string, unknown]> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push(route)
    bodies.push([route, typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body])
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return { calls, sent: (route: string) => bodies.filter(([name]) => name === route).map(([, body]) => body) }
}

/** The portal's other tabs, as BroadcastChannel would connect them; `posted` is what this tab told them. */
class TabChannel extends EventTarget {
  static open = new Set<TabChannel>()
  static posted: unknown[] = []
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage(message: unknown) { TabChannel.posted.push(message) }
  close() { TabChannel.open.delete(this) }
}

beforeEach(() => { TabChannel.open.clear(); TabChannel.posted = []; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

async function openSignIn(path = '/provider/sign-in') {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
}

function signIn() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'ada@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct horse battery staple' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

/** The step now shown, found by its heading, which has taken focus. */
async function stepShown(name: string) {
  const heading = await screen.findByRole('heading', { name })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  return heading
}

/** A code field, by its accessible name (its label, without the required mark). */
const field = (label: string) => screen.getByRole('textbox', { name: label }) as HTMLInputElement

function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } })
}
const alertText = async () => (await screen.findByRole('alert')).textContent

/**
 * The sign-in page's own stylesheets. Neither is in a layer, so each of their
 * rules wins over Tailwind's utilities (Field's `text-critical`, say) whatever
 * its specificity; jsdom applies neither, so the rules are read.
 */
// A path, not a URL: jsdom replaces the global URL class, which Node's file API refuses.
const here = dirname(fileURLToPath(import.meta.url))
const pageRules = [resolve(here, 'style.css'), resolve(here, '../mfa/mfa.css')].flatMap(path => parse(readFileSync(path, 'utf8')))

/** What the page's own rules that match `element` declare for `property`, in source order. */
function pageDeclares(element: Element, property: string): string[] {
  const matches = (selector: string) => { try { return element.matches(selector) } catch { return false } }
  return pageRules.filter(rule => rule.selectors.some(matches))
    .flatMap(rule => [...rule.body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1]!.trim()))
}

/** A refused code's error, as Field draws it: `${field}-error`, in the error colour and size, which the page leaves alone. */
function expectFieldError(id: string, message: string) {
  const error = document.getElementById(`${id}-error`)!
  expect(error.tagName).toBe('P')
  expect(error.textContent).toBe(message)
  expect([...error.classList]).toEqual(expect.arrayContaining(['text-critical', 'text-[12px]']))
  expect(document.getElementById(id)?.getAttribute('aria-describedby')).toBe(`${id}-error`)
  expect(pageDeclares(error, 'color')).toEqual([])
  expect(pageDeclares(error, 'font-size')).toEqual([])
  return error
}

describe('the authenticator code (mfa_required)', () => {
  it('asks for the code after the password, verifies it and opens the workspace', async () => {
    const { calls, sent } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
      [VERIFY]: [() => json(sessionBody)], [REQUESTS]: [() => json([])] })
    await openSignIn('/provider/sign-in?returnTo=%2Fprovider%2Frequests')
    signIn()

    await stepShown('Verify it’s you')
    expect(screen.getByText('Enter the 6-digit code from your authenticator app.')).toBeTruthy()
    expect(screen.getByText(/^This step expires at /)).toBeTruthy()
    expect(screen.queryByLabelText(/^Password/)).toBeNull()
    type('Authenticator code', '12a34 56')
    expect(field('Authenticator code').value).toBe('123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/requests'))
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(sent(VERIFY)).toEqual([{ code: '123456' }])
    expect(calls).toEqual([SESSION, REFRESH, LOGIN, VERIFY, REQUESTS])
    expect(TabChannel.posted).toEqual(['changed'])
  })

  it('takes one recovery code instead, trimmed', async () => {
    const { sent } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
      [VERIFY]: [() => json(sessionBody)], [REQUESTS]: [() => json([])] })
    await openSignIn()
    signIn()
    await stepShown('Verify it’s you')

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }))
    await waitFor(() => expect(document.activeElement).toBe(field('Recovery code')))
    expect(screen.getByText('Enter one of your recovery codes. Each recovery code works once.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true)
    type('Recovery code', ' abcde-fghjk ')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(sent(VERIFY)).toEqual([{ recoveryCode: 'abcde-fghjk' }])
  })

  it('clears a refused code, says each code works once, moves focus to the field and stays', async () => {
    const { calls } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
      [VERIFY]: [problem(401, 'MFA_INVALID_CODE', 'The code is not valid')] })
    await openSignIn()
    signIn()
    await stepShown('Verify it’s you')
    type('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    const message = 'That code was not accepted. Each code works once: wait for the next code in your authenticator app, then try again.'
    expect(await screen.findByText(message)).toBeTruthy()
    const code = field('Authenticator code')
    expect(code.value).toBe('')
    expect(code.getAttribute('aria-invalid')).toBe('true')
    const described = (code.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
    expect(described).toContain(message)
    // Said in the field's error colour, not the step's grey. Focus moving to the field says it, so it is no live region.
    expect(expectFieldError('staff-mfa-code', message).getAttribute('role')).toBeNull()
    expect(pageDeclares(screen.getByText('Enter the 6-digit code from your authenticator app.'), 'color')).toEqual(['var(--color-muted)'])
    await waitFor(() => expect(document.activeElement).toBe(code))
    // A 401 on a sign-in step is never refreshed, nor taken for the end of a session.
    expect(calls).toEqual([SESSION, REFRESH, LOGIN, VERIFY])
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('says a code refused from Enter in its field as an alert, focus staying there', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
      [VERIFY]: [problem(401, 'MFA_INVALID_CODE')] })
    await openSignIn()
    signIn()
    await stepShown('Verify it’s you')
    const code = field('Authenticator code')
    code.focus()
    type('Authenticator code', '123456')
    fireEvent.submit(code)

    const message = 'That code was not accepted. Each code works once: wait for the next code in your authenticator app, then try again.'
    expect(await alertText()).toBe(message)
    expect(document.activeElement).toBe(code)
    // The alert is the field's error, in its error colour.
    expect(screen.getByRole('alert').parentElement).toBe(expectFieldError('staff-mfa-code', message))
  })

  it('says verification is locked for up to 15 minutes after too many codes (429), and stays', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
      [VERIFY]: [problem(429, 'MFA_RATE_LIMITED')] })
    await openSignIn()
    signIn()
    await stepShown('Verify it’s you')
    type('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await alertText()).toBe('Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.')
    expect(screen.getByRole('heading', { name: 'Verify it’s you' })).toBeTruthy()
  })

  it.each([
    ['MFA_CHALLENGE_INVALID', 401, CHALLENGE_SPENT],
    ['STAFF_MFA_FACTOR_UNPROVEN', 403, FACTOR_UNPROVEN],
  ])('goes back to the password step on %s, saying why, with focus on its heading', async (code, status, message) => {
    const { calls } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
      [VERIFY]: [problem(status, code)] })
    await openSignIn()
    signIn()
    await stepShown('Verify it’s you')
    type('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    await stepShown('Welcome back.')
    expect(await alertText()).toBe(message)
    // The work email is kept; the password is asked for again.
    expect((screen.getByRole('textbox', { name: 'Work email' }) as HTMLInputElement).value).toBe('ada@example.test')
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('')
    expect(calls).toEqual([SESSION, REFRESH, LOGIN, VERIFY])
  })

  it('stays on the step when staff MFA is unavailable (503): a 503 ends nothing', async () => {
    const { calls } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
      [VERIFY]: [problem(503, 'MFA_UNAVAILABLE')] })
    await openSignIn()
    signIn()
    await stepShown('Verify it’s you')
    type('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await alertText()).toBe(MFA_UNAVAILABLE)
    expect(screen.getByRole('heading', { name: 'Verify it’s you' })).toBeTruthy()
    expect(calls).toEqual([SESSION, REFRESH, LOGIN, VERIFY])
  })

  it('explains a lost authenticator, and starts again on request', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')] })
    await openSignIn()
    signIn()
    await stepShown('Verify it’s you')

    expect(screen.getByText(/^Lost your authenticator and your recovery codes\? Ask Health ID support to reset it/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await stepShown('Welcome back.')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('a first sign-in: setting up an authenticator (mfa_enrollment_required)', () => {
  it('emails a code only when asked, sets up the app, shows the recovery codes once, then opens the workspace', async () => {
    const { calls, sent } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [codeSent], [START]: [enrollment], [ACTIVATE]: [activated], [REQUESTS]: [() => json([])] })
    await openSignIn('/provider/sign-in?returnTo=%2Fprovider%2Frequests')
    signIn()

    await stepShown('Set up an authenticator app')
    expect(screen.getByText('You can ask for up to 5 codes in 15 minutes.')).toBeTruthy()
    expect(screen.getByText(/^Finish setting up by /)).toBeTruthy()
    // Nothing is sent until asked: each code counts against the account's budget.
    expect(calls).toEqual([SESSION, REFRESH, LOGIN])
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))

    await stepShown('Enter the code we emailed you')
    expect(sent(EMAIL_CODE)).toEqual([undefined])
    type('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await stepShown('Add Health ID to your authenticator app')
    expect(sent(START)).toEqual([{ emailCode: '654321' }])
    expect(screen.getByRole('img', { name: 'QR code of the setup key, for your authenticator app' })).toBeTruthy()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'open it in your authenticator app' }).getAttribute('href')).toBe(OTPAUTH)
    expect(screen.getByText(/Time-based · SHA1 · 6 digits · every 30 seconds\./)).toBeTruthy()
    type('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))

    await stepShown('Save your recovery codes')
    expect(sent(ACTIVATE)).toEqual([{ code: '123456' }])
    // The browser holds the new session while the codes are shown: the other tabs are told at once.
    expect(TabChannel.posted).toEqual(['changed'])
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(RECOVERY_CODES)
    expect(document.body.textContent).not.toContain(SECRET)
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    const proceed = screen.getByRole('button', { name: 'Continue' })
    expect(proceed).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText('I have stored these recovery codes somewhere safe'))
    fireEvent.click(proceed)

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/requests'))
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(document.body.textContent).not.toContain(RECOVERY_CODES[0])
    expect(calls).toEqual([SESSION, REFRESH, LOGIN, EMAIL_CODE, START, ACTIVATE, REQUESTS])
    // Nothing of the sign-in is kept in the browser.
    expect([localStorage.length, sessionStorage.length]).toEqual([0, 0])
  })

  it('sends a new code on request and says so', async () => {
    const { sent } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [codeSent, codeSent] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')

    expect(screen.getByRole('status').textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('A new code was sent.'))
    expect(sent(EMAIL_CODE)).toHaveLength(2)
  })

  it('keeps the step for a wrong emailed code, clearing it', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [codeSent], [START]: [problem(401, 'MFA_INVALID_CODE')] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    type('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const message = 'That code was not accepted. Check the latest email from Health ID (each new code replaces the one before), then try again.'
    expect(await screen.findByText(message)).toBeTruthy()
    expectFieldError('staff-mfa-email-code', message)
    expect(field('Email code').value).toBe('')
    expect(screen.getByRole('heading', { name: 'Enter the code we emailed you' })).toBeTruthy()
  })

  it('says a code could not be sent (503 MFA_ENROLLMENT_CODE_UNDELIVERABLE), and sends on the next press', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [problem(503, 'MFA_ENROLLMENT_CODE_UNDELIVERABLE'), codeSent] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))

    expect(await alertText()).toBe('The code could not be sent to your work email. Try again in a few minutes; '
      + 'if this continues, contact your administrator.')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
  })

  it('says too many codes were asked for (429) on a send', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [problem(429, 'MFA_RATE_LIMITED')] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))

    expect(await alertText()).toBe('Too many codes were asked for. You can ask for up to 5 in 15 minutes; try again later.')
  })

  it('stops, offering no send, for an account without an email address (409 MFA_ENROLLMENT_PROOF_UNAVAILABLE)', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [problem(409, 'MFA_ENROLLMENT_PROOF_UNAVAILABLE')] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))

    expect(await alertText()).toBe('There is no work email address on this account to send a code to, so an authenticator '
      + 'cannot be set up here. Contact your facility administrator.')
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start again' })).toBeTruthy()
  })

  it('goes on to setup with no code once the email is already confirmed (409 MFA_ENROLLMENT_PROOF_COMPLETE)', async () => {
    const { sent } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [problem(409, 'MFA_ENROLLMENT_PROOF_COMPLETE')], [START]: [enrollment] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))

    await waitFor(() => expect(screen.getByText('Your work email address is confirmed for this setup. '
      + 'Continue to add Health ID to your authenticator app.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }))
    await stepShown('Add Health ID to your authenticator app')
    expect(sent(START)).toEqual([{}])
  })

  it('goes back to the email step when Identity asks for the proof first (403 MFA_ENROLLMENT_PROOF_REQUIRED)', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [codeSent], [START]: [problem(403, 'MFA_ENROLLMENT_PROOF_REQUIRED')] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    type('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await stepShown('Set up an authenticator app')
    expect(await alertText()).toBe('Confirm it is you first: ask for a code by email, then enter it.')
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeTruthy()
  })

  it('keeps the setup key for a wrong first code, clearing the field', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [codeSent], [START]: [enrollment], [ACTIVATE]: [problem(401, 'MFA_INVALID_CODE')] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    type('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await stepShown('Add Health ID to your authenticator app')
    type('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))

    const message = 'That code was not accepted. Check that you added the setup key shown here, then enter the next code the app shows.'
    expect(await screen.findByText(message)).toBeTruthy()
    expectFieldError('staff-mfa-activation-code', message)
    expect(field('Authenticator code').value).toBe('')
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy()
    expect(TabChannel.posted).toEqual([])
  })

  it('goes back to the password step when the setup window has passed (401 MFA_CHALLENGE_INVALID)', async () => {
    serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_enrollment_required')],
      [EMAIL_CODE]: [codeSent], [START]: [enrollment], [ACTIVATE]: [problem(401, 'MFA_CHALLENGE_INVALID')] })
    await openSignIn()
    signIn()
    await stepShown('Set up an authenticator app')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    await stepShown('Enter the code we emailed you')
    type('Email code', '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await stepShown('Add Health ID to your authenticator app')
    type('Authenticator code', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Activate authenticator' }))

    await stepShown('Welcome back.')
    expect(await alertText()).toBe(CHALLENGE_SPENT)
    expect(document.body.textContent).not.toContain('JBSW Y3DP')
  })
})

describe('the password step\'s own refusals', () => {
  it.each([
    ['STAFF_MFA_FACTOR_UNPROVEN', 403, FACTOR_UNPROVEN],
    ['MFA_UNAVAILABLE', 503, MFA_UNAVAILABLE],
  ])('says what %s means for staff sign-in, and stays', async (code, status, message) => {
    const { calls } = serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [problem(status, code)] })
    await openSignIn()
    signIn()

    expect(await alertText()).toBe(message)
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(calls).toEqual([SESSION, REFRESH, LOGIN])
  })
})

it('opens nothing when the workspace cannot take the session verify answered with', async () => {
  serve({ [SESSION]: [ended], [REFRESH]: [ended], [LOGIN]: [challenge('mfa_required')],
    [VERIFY]: [() => json({ actor: { kind: 'patient', id: 'patient-1', roles: [], permissions: [], facilities: [] } })] })
  await openSignIn()
  signIn()
  await stepShown('Verify it’s you')
  type('Authenticator code', '123456')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify' })) })

  await stepShown('Welcome back.')
  expect(await alertText()).toBe('A staff account is required for this portal.')
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
})
