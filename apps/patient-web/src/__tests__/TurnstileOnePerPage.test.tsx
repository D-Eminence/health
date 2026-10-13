import { StrictMode, useState, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Enrollment } from '../routes/Enrollment'
import { SignIn } from '../routes/SignIn'
import { Recovery } from '../routes/Recovery'
import { PrincipalRecovery } from '../routes/PrincipalRecovery'
import { Turnstile } from '../Turnstile'

/**
 * Each protected submission on a page is guarded by exactly one Cloudflare
 * Turnstile widget, and a page never shows two at once. The enrollment page
 * offers two submissions on its NIN step: the NIN start (hid-system
 * patient-enrollment.dto.ts accepts only 'patient-enrollment') and Google
 * sign-up (google-login.dto.ts: 'patient-login'). Tokens are single use
 * (turnstile.service.ts: 'timeout-or-duplicate' is 403
 * TURNSTILE_EXPIRED_OR_REPLAYED), so each needs its own widget, but only the
 * path the person chose is shown: both used to be on screen together.
 */
const api = vi.hoisted(() => ({
  enrollmentCurrent: vi.fn(), googleOnboarding: vi.fn(), enrollmentStart: vi.fn(), googleExchange: vi.fn(),
  enrollmentBindGoogle: vi.fn(), googleNonce: vi.fn(),
}))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production', turnstileSiteKey: 'site-key', apiBaseUrl: 'https://gateway.test' }) }))
vi.mock('../session', () => ({
  useSession: () => ({ api, state: { status: 'anonymous', principal: null }, acceptGoogleSession: vi.fn(),
    otherPortalSession: false, retrySessionCheck: vi.fn(), signedOutElsewhere: false, sessionError: null, signIn: vi.fn() }),
}))
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential, disabled }: { onCredential: (token: string) => Promise<void>; disabled: boolean }) =>
    <button type="button" disabled={disabled} onClick={() => { void onCredential('google-id-token') }}>Sign up with Google</button>,
}))

interface Widget { element: HTMLElement; options: Record<string, unknown> }
const widgets = new Map<string, Widget>()
let issued = 0
const turnstile = {
  render: vi.fn((container: HTMLElement, options: Record<string, unknown>) => {
    const id = `widget-${++issued}`
    const element = document.createElement('div')
    element.dataset.fakeTurnstile = String(options.action)
    container.appendChild(element)
    widgets.set(id, { element, options })
    return id
  }),
  remove: vi.fn((id: string) => { widgets.get(id)?.element.remove(); widgets.delete(id) }),
  reset: vi.fn(),
}

/** The actions of the widgets on the page, in document order. */
const shown = () => Array.from(document.querySelectorAll<HTMLElement>('[data-fake-turnstile]'), element => element.dataset.fakeTurnstile)
/** Completes the check of the widget on the page for `action`, as Cloudflare would. */
function solve(action: string, token: string) {
  const widget = [...widgets.values()].find(item => item.options.action === action && item.element.isConnected)
  if (!widget) throw new Error(`No ${action} widget on the page`)
  act(() => (widget.options.callback as (value: string) => void)(token))
}
const view = (page: ReactElement) => render(<StrictMode><MemoryRouter>{page}</MemoryRouter></StrictMode>)

beforeEach(() => {
  widgets.clear(); issued = 0
  window.turnstile = turnstile
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
  api.enrollmentCurrent.mockRejectedValue(new HidApiError(404, 'No enrollment', { code: 'ENROLLMENT_NOT_FOUND' }))
  api.googleOnboarding.mockRejectedValue(new HidApiError(404, 'No Google onboarding'))
})
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); Reflect.deleteProperty(window, 'turnstile') })

async function ninStep() {
  view(<Enrollment />)
  await screen.findByLabelText('National Identification Number')
  await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
}

describe('the enrollment NIN step with Google sign-up configured', () => {
  it('shows one security check, the NIN start’s, and offers Google without a second one', async () => {
    await ninStep()
    expect(shown()).toEqual(['patient-enrollment'])
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign up with Google' })).toBeNull()
  })

  it('choosing Google replaces the NIN form and its check with Google’s own', async () => {
    await ninStep()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(shown()).toEqual(['patient-login']))
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign up with Google' })).toBeTruthy()
    // The NIN start's widget was removed, not hidden.
    expect(turnstile.remove).toHaveBeenCalled()
    // Focus goes to where the chosen path starts, not to the page.
    expect(document.activeElement).toBe(screen.getByText('Continue with Google', { selector: '[tabindex="-1"]' }))
    expect(screen.getByText(/still verify your NIN/)).toBeTruthy()
  })

  it('going back to the NIN shows a fresh check, and the NIN start sends that check’s token', async () => {
    api.enrollmentStart.mockResolvedValue({ stage: 'contact_required' })
    await ninStep()
    const first = turnstile.render.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(shown()).toEqual(['patient-login']))
    fireEvent.click(screen.getByRole('button', { name: 'Verify your NIN without Google' }))
    await waitFor(() => expect(shown()).toEqual(['patient-enrollment']))
    expect(turnstile.render.mock.calls.length).toBeGreaterThan(first + 1)
    const nin = screen.getByLabelText('National Identification Number')
    expect(document.activeElement).toBe(nin)
    fireEvent.change(nin, { target: { value: '12345678901' } })
    expect(screen.getByRole('button', { name: 'Verify NIN' })).toHaveProperty('disabled', true)
    solve('patient-enrollment', 'nin-token')
    expect(screen.getByRole('button', { name: 'Verify NIN' })).toHaveProperty('disabled', false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify NIN' })) })
    expect(api.enrollmentStart).toHaveBeenCalledWith('12345678901', 'nin-token', expect.any(String))
  })

  it('Google sign-up sends its own check’s token, then the NIN step continues with one check', async () => {
    api.googleExchange.mockResolvedValue({ stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY', expiresAt: '2099-01-01T00:00:00.000Z' })
    await ninStep()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(shown()).toEqual(['patient-login']))
    solve('patient-login', 'google-token')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign up with Google' })) })
    expect(api.googleExchange).toHaveBeenCalledWith('google-id-token', 'google-token', 'enroll')
    expect(await screen.findByText('Google identity confirmed for this enrollment.')).toBeTruthy()
    await waitFor(() => expect(shown()).toEqual(['patient-enrollment']))
    expect(screen.getByLabelText('National Identification Number')).toBeTruthy()
  })

  it.each([['not configured', ''], ['blank', '   ']])('offers no Google path and one check when the Google client ID is %s', async (_case, clientId) => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', clientId)
    await ninStep()
    expect(shown()).toEqual(['patient-enrollment'])
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Google enrollment' })).toBeNull()
  })
})

describe('one security check on each other page', () => {
  it('the contact step of an enrollment in progress shows only Google’s', async () => {
    api.enrollmentCurrent.mockResolvedValue({ stage: 'contact_required' })
    view(<Enrollment />)
    expect(await screen.findByRole('heading', { name: 'Where should we send your code?' })).toBeTruthy()
    await waitFor(() => expect(shown()).toEqual(['patient-login']))
  })

  it.each([
    ['patient sign-in', <SignIn key="sign-in" />, 'patient-login'],
    ['patient recovery', <Recovery key="recover" />, 'patient-reset-start'],
    ['provider recovery', <PrincipalRecovery key="staff" audience="staff" />, 'staff-reset'],
    ['administrator recovery', <PrincipalRecovery key="admin" audience="admin" />, 'admin-reset'],
  ])('%s', async (_name, page, action) => {
    view(page)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    expect(shown()).toEqual([action])
  })
})

describe('a page that hands the check a new callback on each render', () => {
  it('keeps its one widget and the token it answered', async () => {
    function Host() {
      const [token, setToken] = useState<string | null>(null)
      return <><Turnstile action="patient-login" onTokenChange={value => setToken(value)} resetKey={0} /><output>{token ?? 'none'}</output></>
    }
    view(<Host />)
    await waitFor(() => expect(shown()).toEqual(['patient-login']))
    const renders = turnstile.render.mock.calls.length
    solve('patient-login', 'solved-token')
    expect(screen.getByText('solved-token')).toBeTruthy()
    expect(turnstile.render.mock.calls.length).toBe(renders)
    expect(shown()).toEqual(['patient-login'])
  })
})
