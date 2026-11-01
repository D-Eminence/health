import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createTestSessionValue, SessionContext } from '../session'
import { GOOGLE_LINK_REQUIRED, GOOGLE_NOT_REGISTERED, SignIn } from '../routes/SignIn'
import { Enrollment } from '../routes/Enrollment'
import { json, patientApi, problem, shownText, type Handler } from './portalHarness'

/**
 * Google sign-in for a registered patient whose Google account is not linked yet (hid-1.0 parity B2, owner decision
 * 2026-10-28). Identity links it when Google says the email is verified and exactly one patient account has that
 * verified email, and signs in as a linked Google sign-in does. Otherwise: 404 GOOGLE_NOT_REGISTERED (no account has
 * it: the page offers the sign-up), 409 GOOGLE_LINK_REQUIRED (more than one: the website's own words, since Identity's name Settings, which is gone), and 403
 * ACCOUNT_SUSPENDED as before. On the sign-up, 409 GOOGLE_ACCOUNT_EXISTS says to sign in with Google instead.
 */
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential, disabled }: { onCredential: (token: string) => Promise<void>; disabled: boolean }) =>
    <button type="button" disabled={disabled} onClick={() => void onCredential('google-id-token')}>Google</button>,
}))
afterEach(() => { vi.unstubAllEnvs() })

const SESSION = { actor: { kind: 'patient', subject: 'patient:ada', patientId: 'patient-1', accountId: 'account-1', authenticationMethod: 'oidc' } }

function openSignIn(handler: Handler) {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
  const { api, sent } = patientApi(handler)
  const acceptGoogleSession = vi.fn()
  render(<MemoryRouter initialEntries={['/sign-in']}><SessionContext.Provider value={{ ...createTestSessionValue(null, api), acceptGoogleSession }}>
    <Routes><Route path="/sign-in" element={<SignIn />} /><Route path="/" element={<p>Signed in</p>} /></Routes>
  </SessionContext.Provider></MemoryRouter>)
  return { sent, acceptGoogleSession }
}
async function google() {
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Google' })) })
}
const exchange = (answer: () => Response): Handler => path => path === '/auth/oidc/exchange' ? answer() : problem(500, 'UNEXPECTED', path)

describe('Google sign-in for an account not linked yet', () => {
  it('signs in when Identity links it by the verified email, as a linked Google sign-in does', async () => {
    const { sent, acceptGoogleSession } = openSignIn(exchange(() => json(SESSION)))
    await google()
    expect(acceptGoogleSession).toHaveBeenCalledWith(SESSION)
    expect(await screen.findByText('Signed in')).toBeTruthy()
    expect(sent).toEqual([{ path: '/auth/oidc/exchange', method: 'POST',
      body: { idToken: 'google-id-token', turnstileToken: 'turnstile-token', turnstileAction: 'patient-login', intent: 'sign_in' } }])
  })

  it('offers the sign-up when no Health ID has that Google email (404 GOOGLE_NOT_REGISTERED)', async () => {
    openSignIn(exchange(() => problem(404, 'GOOGLE_NOT_REGISTERED', GOOGLE_NOT_REGISTERED)))
    await google()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('This Google account has no Health ID yet. Sign up first.')
    expect(within(alert).getByRole('link', { name: 'Sign up for a Health ID' }).getAttribute('href')).toBe('/enroll')
    expect(screen.queryByText(/Didn't finish signing up\?/)).toBeNull()
  })

  it('says to sign in with the password, and not to go to Settings, when more than one account has it (409 GOOGLE_LINK_REQUIRED)', async () => {
    // Identity's own words name Settings, which the portal no longer has: the page says its own.
    openSignIn(exchange(() => problem(409, 'GOOGLE_LINK_REQUIRED', 'Sign in with your password, then link Google from Settings.')))
    await google()
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe('This Google account can’t be linked automatically. Sign in with your email or Health ID and password.')
    expect(shownText(alert)).toBe(GOOGLE_LINK_REQUIRED)
    expect(alert.textContent).not.toMatch(/Settings/)
    expect(within(alert).queryByRole('link')).toBeNull()
  })

  it('stands in its own words when a refusal came without Identity\'s', async () => {
    openSignIn(exchange(() => new Response(JSON.stringify({ code: 'GOOGLE_NOT_REGISTERED' }), { status: 404, headers: { 'content-type': 'application/json' } })))
    await google()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(GOOGLE_NOT_REGISTERED)
    expect(within(alert).getByRole('link', { name: 'Sign up for a Health ID' })).toBeTruthy()
  })

  it('says an older Identity\'s refusal as it did (401 GOOGLE_SIGN_IN_DENIED)', async () => {
    openSignIn(exchange(() => problem(401, 'GOOGLE_SIGN_IN_DENIED', 'Google sign-in could not be completed for this HID account')))
    await google()
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe('Google sign-in could not be completed for this HID account')
    expect(within(alert).queryByRole('link')).toBeNull()
  })
})

describe('Google on the NIN-first enrollment for an email that already has a Health ID', () => {
  it('says to sign in with Google instead, with the link (409 GOOGLE_ACCOUNT_EXISTS)', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
    const { api } = patientApi((path, method) => {
      if (path === '/identity/patient-enrollments/availability') return json({ open: true, online: true, facility: false })
      if (path === '/identity/patient-enrollments/current') return problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment')
      if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'None')
      if (path === '/auth/oidc/exchange' && method === 'POST') {
        return problem(409, 'GOOGLE_ACCOUNT_EXISTS', 'You already have a Health ID. Sign in with Google instead.')
      }
      return problem(500, 'UNEXPECTED', path)
    })
    render(<MemoryRouter initialEntries={['/enroll']}><SessionContext.Provider value={createTestSessionValue(null, api)}>
      <Enrollment />
    </SessionContext.Provider></MemoryRouter>)
    await screen.findByLabelText('National Identification Number (NIN)')
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Complete check' }).at(-1)!)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Google' })) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('You already have a Health ID. Sign in with Google instead.')
    expect(within(alert).getByRole('link', { name: 'Sign in with Google' }).getAttribute('href')).toBe('/sign-in')
  })
})
