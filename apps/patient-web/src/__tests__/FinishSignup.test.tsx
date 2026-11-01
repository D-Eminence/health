import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { createTestSessionValue, SessionContext } from '../session'
import { SignIn } from '../routes/SignIn'
import { Enrollment } from '../routes/Enrollment'
import { signupEmailOf, signupHandoff } from '../routes/enrollment/signupHandoff'
import { json, patientApi, problem, type Handler, shownText } from './portalHarness'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
afterEach(() => { vi.unstubAllEnvs() })

/**
 * hid-1.0 sent a patient whose sign-in failed as "email not confirmed" back to finish signing up (PatientAuth.tsx
 * 352-357). Identity answers an unfinished account's sign-in as any wrong one, 401 "Invalid credentials"
 * (local-auth.provider.ts), so after that refusal sign-in offers to finish the sign-up, carrying the email typed in
 * router state, never the URL, and the sign-up starts with it.
 */
const BASE = '/identity/patient-enrollments'
const enrollment: Handler = (path, method) => {
  if (path === `${BASE}/availability` && method === 'GET') return json({ open: true, online: true, facility: false, signup: true })
  if (path === `${BASE}/current`) return problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
  if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
  return problem(500, 'UNEXPECTED', `${method} ${path}`)
}

/** Where the page is: the address and what its history entry carries. */
function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname}${location.search} ${JSON.stringify(location.state)}`}</output>
}

function open(refusal: unknown) {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', '')
  const { api } = patientApi(enrollment)
  const signIn = vi.fn().mockRejectedValue(refusal)
  render(<MemoryRouter initialEntries={['/sign-in']}><SessionContext.Provider value={{ ...createTestSessionValue(null, api), signIn }}>
    <Routes><Route path="/sign-in" element={<SignIn />} /><Route path="/enroll" element={<Enrollment />} /></Routes><Where />
  </SessionContext.Provider></MemoryRouter>)
  return signIn
}
async function signInWith(principal: string) {
  fireEvent.change(screen.getByLabelText('Email, phone or Health ID'), { target: { value: principal } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-secret-123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
}
const invalid = () => new HidApiError(401, 'Invalid credentials', { code: 'AUTHENTICATION_REQUIRED' })
const finish = () => screen.queryByRole('link', { name: 'Finish creating your Health ID' })

describe('"Finish your sign-up" after a refused sign-in', () => {
  it('is offered under the error, and opens the sign-up with the email typed, carried outside the address', async () => {
    open(invalid())
    await signInWith('Ada@Example.com')
    // The refusal, then the way to finish, in one line of the alert.
    expect(screen.getByText(/Didn't finish signing up\?/).textContent).toBe('Invalid credentials Didn\'t finish signing up? Finish creating your Health ID')
    expect(finish()?.getAttribute('href')).toBe('/enroll')
    // In the same alert as the refusal, so a screen reader reads the way to finish with it.
    expect(shownText(screen.getByRole('alert'))).toBe('Invalid credentials Didn\'t finish signing up? Finish creating your Health ID')
    expect(screen.getByRole('alert').contains(finish())).toBe(true)

    await act(async () => { fireEvent.click(finish()!) })
    const email = await screen.findByLabelText('Email address') as HTMLInputElement
    expect(email.value).toBe('Ada@Example.com')
    // Taken into memory, and out of the history entry it came in; never in the address.
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/enroll null'))
    expect(screen.getByLabelText('First name')).toBeTruthy()
  })

  it('opens an empty sign-up when a Health ID was typed', async () => {
    open(invalid())
    await signInWith('HID-ABC234')
    await act(async () => { fireEvent.click(finish()!) })
    expect((await screen.findByLabelText('Email address') as HTMLInputElement).value).toBe('')
  })

  it.each([
    ['the security check', new HidApiError(400, 'Complete the security check and try again.', { code: 'TURNSTILE_REQUIRED' })],
    ['an outage', new HidApiError(503, 'A required platform service is temporarily unavailable.', { code: 'UPSTREAM_UNAVAILABLE' })],
    ['an error from the browser', new Error('offline')],
    // The right password for a suspended account (hid-system, owner decision 2026-10-28): there is no sign-up to finish.
    ['a suspended account', new HidApiError(403, 'This account is suspended. Contact support@healthidentitydirectory.com.', { code: 'ACCOUNT_SUSPENDED' })],
  ])('is not offered after a refusal for %s', async (_reason, refusal) => {
    open(refusal)
    await signInWith('ada@example.com')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(finish()).toBeNull()
  })

  it('goes once another sign-in is tried', async () => {
    const signIn = open(invalid())
    await signInWith('ada@example.com')
    expect(finish()).toBeTruthy()
    signIn.mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    expect(finish()).toBeNull()
  })
})

describe('what sign-in hands the sign-up', () => {
  it('is only an email, trimmed', () => {
    expect(signupHandoff('  ada@example.com ')).toEqual({ signupEmail: 'ada@example.com' })
    expect(signupHandoff('HID-ABC234')).toBeUndefined()
    expect(signupHandoff(`${'a'.repeat(250)}@b.co`)).toBeUndefined()
  })

  it('is read back only from a state that holds a valid email', () => {
    expect(signupEmailOf({ signupEmail: 'ada@example.com' })).toBe('ada@example.com')
    expect(signupEmailOf({ signupEmail: 'not an email' })).toBe('')
    expect(signupEmailOf({ signupEmail: 7 })).toBe('')
    expect(signupEmailOf(null)).toBe('')
    expect(signupEmailOf('ada@example.com')).toBe('')
  })
})
