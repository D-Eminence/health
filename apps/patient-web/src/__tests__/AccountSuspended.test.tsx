import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createTestSessionValue, SessionContext } from '../session'
import { ACCOUNT_SUSPENDED, SignIn } from '../routes/SignIn'
import { json, patientApi, problem, shownText, type Handler } from './portalHarness'

/**
 * A suspended account (hid-system, owner decision 2026-10-28). With the right password for an account or patient
 * that is suspended, blocked or disabled, POST /auth/patient/login answers 403 ACCOUNT_SUSPENDED with the detail
 * "This account is suspended. Contact support@healthidentitydirectory.com."; Google sign-in the same where it applies.
 * Sign-in shows that detail as the error, with the address to write to, and does not offer to finish a sign-up. A
 * wrong password still gets the usual 401, which is answered as before.
 */
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential }: { onCredential: (token: string) => Promise<void> }) =>
    <button type="button" onClick={() => void onCredential('google-id-token')}>Sign in with Google</button>,
}))
afterEach(() => { vi.unstubAllEnvs() })

const DETAIL = 'This account is suspended. Contact support@healthidentitydirectory.com.'
const suspendedProblem = () => problem(403, 'ACCOUNT_SUSPENDED', DETAIL)
const invalid = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Invalid credentials')

/** Sign-in against a fake gateway, its password sign-in through the patient API as the session provider sends it. */
function openSignIn(handler: Handler, { google = false } = {}) {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', google ? 'client-id.apps.googleusercontent.com' : '')
  const { api, sent } = patientApi(handler)
  render(<MemoryRouter initialEntries={['/sign-in']}><SessionContext.Provider value={{ ...createTestSessionValue(null, api),
    signIn: async (email, password, turnstileToken) => { await api.login(email, password, turnstileToken) } }}>
    <SignIn />
  </SessionContext.Provider></MemoryRouter>)
  return { sent }
}
async function signInWithPassword() {
  fireEvent.change(screen.getByLabelText('Email, phone or Health ID'), { target: { value: 'ada@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-secret-123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
}
const finishSignup = () => screen.queryByText(/Didn't finish signing up\?/)

describe('signing in to a suspended account', () => {
  it('says Identity\'s detail as the error, with the support address to write to, and offers no sign-up to finish', async () => {
    const { sent } = openSignIn(path => path === '/auth/patient/login' ? suspendedProblem() : problem(500, 'UNEXPECTED', path))
    await signInWithPassword()

    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe(DETAIL)
    expect(within(alert).getByRole('link', { name: 'support@healthidentitydirectory.com' }).getAttribute('href'))
      .toBe('mailto:support@healthidentitydirectory.com')
    expect(finishSignup()).toBeNull()
    expect(screen.queryByRole('link', { name: 'Finish creating your Health ID' })).toBeNull()
    expect(sent.map(request => `${request.method} ${request.path}`)).toEqual(['POST /auth/patient/login'])
  })

  it('says the suspension in its own words when the problem came without a detail', async () => {
    openSignIn(path => path === '/auth/patient/login'
      ? json({ type: 'about:blank', title: 'ACCOUNT_SUSPENDED', status: 403, code: 'ACCOUNT_SUSPENDED' }, 403) : problem(500, 'UNEXPECTED', path))
    await signInWithPassword()
    expect(shownText(await screen.findByRole('alert'))).toBe(ACCOUNT_SUSPENDED)
    expect(ACCOUNT_SUSPENDED).toBe(DETAIL)
    expect(finishSignup()).toBeNull()
  })

  it('answers a wrong password as before: the generic refusal, with the way to finish a sign-up', async () => {
    openSignIn(path => path === '/auth/patient/login' ? invalid() : problem(500, 'UNEXPECTED', path))
    await signInWithPassword()
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe('Invalid credentials Didn\'t finish signing up? Finish creating your Health ID')
    expect(within(alert).queryByRole('link', { name: 'support@healthidentitydirectory.com' })).toBeNull()
  })

  it('drops the suspension once another sign-in is tried and refused otherwise', async () => {
    let answer = suspendedProblem
    openSignIn(path => path === '/auth/patient/login' ? answer() : problem(500, 'UNEXPECTED', path))
    await signInWithPassword()
    expect(shownText(await screen.findByRole('alert'))).toBe(DETAIL)

    answer = invalid
    await signInWithPassword()
    expect(shownText(screen.getByRole('alert'))).toBe('Invalid credentials Didn\'t finish signing up? Finish creating your Health ID')
  })

  it('says the same after Google sign-in, where Identity refuses a suspended account so', async () => {
    const { sent } = openSignIn(path => path === '/auth/oidc/exchange' ? suspendedProblem() : problem(500, 'UNEXPECTED', path), { google: true })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' })) })

    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe(DETAIL)
    expect(within(alert).getByRole('link', { name: 'support@healthidentitydirectory.com' })).toBeTruthy()
    expect(finishSignup()).toBeNull()
    expect(sent.map(request => `${request.method} ${request.path}`)).toEqual(['POST /auth/oidc/exchange'])
  })
})
