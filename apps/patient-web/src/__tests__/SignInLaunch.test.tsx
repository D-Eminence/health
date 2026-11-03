import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { createTestSessionValue, SessionContext } from '../session'
import { SignIn } from '../routes/SignIn'
import { Recovery } from '../routes/Recovery'
import { described, json, patientApi, problem, type Handler } from './portalHarness'

/**
 * The sign-in page for a full launch (launch audit, signed-out area): a refusal leaves focus somewhere useful and marks
 * the fields; sign-in returns the patient to the page they asked for, and never to another site; the main button says
 * why it is disabled while the security check runs; a session that ended says so; a failed session check offers Try
 * again; the placeholder fits a 320px phone.
 */
let token: ((value: string | null) => void) | null = null
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (value: string | null) => void }) => {
    token = onTokenChange
    return <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>
  },
}))
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential }: { onCredential: (value: string) => Promise<void> }) =>
    <button type="button" onClick={() => void onCredential('google-id-token')}>Sign in with Google</button>,
}))
afterEach(() => { vi.unstubAllEnvs(); token = null })

const PATIENT = { actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' }, expiresAt: '2026-11-03T12:00:00.000Z' }
const invalid = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Invalid credentials')

/** Shows where the router went, so a test can read the page sign-in opened. */
function Landed() {
  const location = useLocation()
  return <p data-testid="landed">{`${location.pathname}${location.search}${location.hash}`}</p>
}

function openSignIn(handler: Handler, { from, session = {} }: { from?: unknown; session?: Partial<ReturnType<typeof createTestSessionValue>> } = {}) {
  const { api, sent } = patientApi(handler)
  const value = { ...createTestSessionValue(null, api),
    signIn: async (email: string, password: string, turnstileToken: string) => { await api.login(email, password, turnstileToken) },
    ...session }
  const view = render(<MemoryRouter initialEntries={[{ pathname: '/sign-in', state: from === undefined ? null : { from } }]}>
    <SessionContext.Provider value={value}>
      <Routes><Route path="/sign-in" element={<SignIn />} /><Route path="*" element={<Landed />} /></Routes>
    </SessionContext.Provider></MemoryRouter>)
  return { sent, view }
}

function fill(email = 'ada@example.com', password = 'typed-secret-123') {
  fireEvent.change(screen.getByLabelText('Email, phone or Health ID'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
}
/** Sign in pressed as a pointer or a keyboard user on the button does: focus on it, which is disabled while busy. */
async function pressSignIn() {
  const button = screen.getByRole('button', { name: 'Sign in' })
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
/** Sign in sent with Enter in the password field, where focus stays. */
async function enterInPassword() {
  const password = screen.getByLabelText('Password')
  password.focus()
  await act(async () => { fireEvent.submit(password.closest('form')!) })
}

describe('a refused sign-in (SO-03)', () => {
  it('moves focus to the password and marks both fields, described by the refusal, when Sign in was pressed', async () => {
    openSignIn(path => path === '/auth/patient/login' ? invalid() : problem(500, 'UNEXPECTED', path))
    fill()
    await pressSignIn()
    const password = screen.getByLabelText('Password')
    const principal = screen.getByLabelText('Email, phone or Health ID')
    expect(document.activeElement).toBe(password)
    for (const field of [principal, password]) {
      expect(field.getAttribute('aria-invalid')).toBe('true')
      expect(described(field)).toContain('That email, phone, Health ID or password isn’t right. Try again.')
    }
    // Read once, as the field's description, not again as an alert.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps focus in the field and says the refusal as an alert when it was sent with Enter there', async () => {
    openSignIn(path => path === '/auth/patient/login' ? invalid() : problem(500, 'UNEXPECTED', path))
    fill()
    await enterInPassword()
    expect(document.activeElement).toBe(screen.getByLabelText('Password'))
    expect(within(screen.getByRole('alert')).getByText(/isn’t right/)).toBeTruthy()
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true')
  })

  it('moves focus to the refusal itself when it is not about what was typed', async () => {
    openSignIn(path => path === '/auth/patient/login' ? problem(503, 'IDENTITY_SERVICE_UNAVAILABLE', 'down') : problem(500, 'UNEXPECTED', path))
    fill()
    await pressSignIn()
    const focused = document.activeElement as HTMLElement
    expect(focused.getAttribute('tabindex')).toBe('-1')
    expect(focused.textContent).toMatch(/Please try again|could not be completed|Try again/)
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBeNull()
  })

  it('drops the marks once another sign-in is tried and accepted', async () => {
    let answer = invalid
    openSignIn(path => path === '/auth/patient/login' ? answer() : problem(500, 'UNEXPECTED', path))
    fill()
    await pressSignIn()
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true')
    answer = () => json(PATIENT)
    fill()
    await pressSignIn()
    expect(screen.getByTestId('landed').textContent).toBe('/')
  })
})

describe('the page sign-in returns to (SO-04, HCS-06)', () => {
  const accepted = (path: string) => path === '/auth/patient/login' ? json(PATIENT) : problem(500, 'UNEXPECTED', path)

  it.each([
    ['/notifications', '/notifications'],
    [{ pathname: '/records', search: '?q=malaria', hash: '#visits' }, '/records?q=malaria#visits'],
    ['/a-page-that-does-not-exist', '/a-page-that-does-not-exist'],
    ['/card/preview', '/card/preview'],
  ])('returns to %j after a password sign-in', async (from, landed) => {
    openSignIn(accepted, { from })
    fill()
    await pressSignIn()
    expect(screen.getByTestId('landed').textContent).toBe(landed)
  })

  it.each([
    ['//evil.example/records'], ['/\\evil.example'], ['https://evil.example/'], ['javascript:alert(1)'], ['records'],
    ['/sign-in'], ['/enroll'], ['/recover'], ['/provider/patients'], ['/admin'], ['/card/some-token'], ['/login'],
    [{ pathname: '//evil.example' }], [42], [null],
  ])('opens Home instead of %j', async from => {
    openSignIn(accepted, { from })
    fill()
    await pressSignIn()
    expect(screen.getByTestId('landed').textContent).toBe('/')
  })

  it('returns there after a Google sign-in too', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
    openSignIn(path => path === '/auth/oidc/exchange' ? json(PATIENT) : problem(500, 'UNEXPECTED', path), { from: '/access' })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' })) })
    expect(screen.getByTestId('landed').textContent).toBe('/access')
  })

  it('opens the page asked for when the patient is already signed in', () => {
    const { api } = patientApi(path => problem(500, 'UNEXPECTED', path))
    render(<MemoryRouter initialEntries={[{ pathname: '/sign-in', state: { from: '/notifications' } }]}>
      <SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'subject-a', appRole: 'patient', assuranceLevel: 'aal1' }, api)}>
        <Routes><Route path="/sign-in" element={<SignIn />} /><Route path="*" element={<Landed />} /></Routes>
      </SessionContext.Provider></MemoryRouter>)
    expect(screen.getByTestId('landed').textContent).toBe('/notifications')
  })
})

describe('a session that ended (HCS-06)', () => {
  it('says the patient was signed out because the session ended, as an alert', () => {
    openSignIn(path => problem(500, 'UNEXPECTED', path), { session: { sessionEnded: true } })
    expect(within(screen.getByRole('alert')).getByText('You were signed out because your session ended. Sign in again to continue.')).toBeTruthy()
  })

  it('says it once: another tab\'s sign-out is said instead when that is why', () => {
    openSignIn(path => problem(500, 'UNEXPECTED', path), { session: { sessionEnded: true, signedOutElsewhere: true } })
    expect(screen.queryByText(/because your session ended/)).toBeNull()
    expect(screen.getByText(/signed out because this browser's Health ID sign-in changed in another tab/)).toBeTruthy()
  })

  it('says nothing of it on a sign-in nobody was sent to', () => {
    openSignIn(path => problem(500, 'UNEXPECTED', path))
    expect(screen.queryByText(/because your session ended/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('a session check that failed (SO-20)', () => {
  it('offers Try again, which checks the session again', () => {
    const retrySessionCheck = vi.fn()
    openSignIn(path => problem(500, 'UNEXPECTED', path), { session: { sessionError: 'We could not check your session. Try again.', retrySessionCheck } })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/couldn’t check whether you’re signed in/)
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(retrySessionCheck).toHaveBeenCalledTimes(1)
  })
})

describe('the main button while the security check runs (SO-16)', () => {
  it('says why Sign in is disabled until the check is done', () => {
    openSignIn(path => problem(500, 'UNEXPECTED', path))
    const button = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(described(button)).toBe('Complete the security check to continue.')
    act(() => { token?.('turnstile-token') })
    expect(button.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText('Complete the security check to continue.')).toBeNull()
  })

  it('says it on the password reset\'s first step too', () => {
    const { api } = patientApi(path => problem(500, 'UNEXPECTED', path))
    render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue(null, api)}><Recovery /></SessionContext.Provider></MemoryRouter>)
    const button = screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(described(button)).toBe('Complete the security check to continue.')
  })
})

describe('the identifier field on a 320px phone (SO-17)', () => {
  // 212px of text fit in the field at 320px (14px Figtree): about 26 characters of this size.
  it.each([['sign-in', 'Email, phone or Health ID'], ['recovery', 'Email, phone or Health ID']])('the %s placeholder is short enough not to be cut off', (page, label) => {
    const { api } = patientApi(path => problem(500, 'UNEXPECTED', path))
    render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue(null, api)}>{page === 'sign-in' ? <SignIn /> : <Recovery />}</SessionContext.Provider></MemoryRouter>)
    const placeholder = screen.getByLabelText(label).getAttribute('placeholder') ?? ''
    expect(placeholder.length).toBeLessThanOrEqual(26)
    expect(placeholder).toMatch(/HID-/)
  })
})

describe('the Forgot password link (SO-13)', () => {
  it('is at least 44px tall to tap, keeping its text style', () => {
    openSignIn(path => problem(500, 'UNEXPECTED', path))
    const link = screen.getByRole('link', { name: 'Forgot password?' })
    expect(link.className.split(' ')).toEqual(expect.arrayContaining(['inline-flex', 'min-h-11', 'items-center', 'text-[13px]']))
  })
})
