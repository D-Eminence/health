import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SignIn } from './SignIn'

const calls = vi.hoisted(() => ({ login: vi.fn(), completeSignIn: vi.fn(), loginAction: vi.fn((_hostname: string) => 'staff-login'),
  state: { status: 'signed-out' } as { status: string; reason?: string } }))

vi.mock('../App', () => ({ useStaff: () => ({ state: calls.state, login: calls.login, completeSignIn: calls.completeSignIn }) }))
vi.mock('../env', () => ({ getEnvironment: () => ({ turnstileSiteKey: 'test-site-key' }) }))
vi.mock('../../productHostname', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  staffLoginAction: calls.loginAction,
}))

/** Serves the page from another host, as a product site would (jsdom's own is localhost). */
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
function serveFrom(hostname: string) { jsdom.reconfigure({ url: `https://${hostname}/provider/sign-in` }) }

beforeEach(() => { vi.clearAllMocks(); calls.state = { status: 'signed-out' } })
afterEach(() => { vi.unstubAllGlobals(); jsdom.reconfigure({ url: servedFrom }) })

it('renews the consumed provider login challenge while preserving credentials on failure', async () => {
  const challengeCallbacks: Array<(token: string) => void> = []
  const remove = vi.fn()
  const renderChallenge = vi.fn((_host: HTMLElement, options: Record<string, unknown>) => {
    challengeCallbacks.push(options.callback as (token: string) => void)
    return `widget-${challengeCallbacks.length}`
  })
  vi.stubGlobal('turnstile', { render: renderChallenge, remove, reset: vi.fn() })
  calls.login.mockRejectedValueOnce(new Error('Wrong password'))

  render(<MemoryRouter><SignIn /></MemoryRouter>)
  await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1))

  fireEvent.change(screen.getByRole('textbox', { name: 'Work email' }), { target: { value: 'clinician@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'saved-typed-password' } })
  act(() => challengeCallbacks[0]?.('first-token'))
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong password')
  await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(2))
  expect(remove).toHaveBeenCalledWith('widget-1')
  expect(calls.login).toHaveBeenCalledWith('clinician@example.test', 'saved-typed-password', 'first-token')
  expect((screen.getByRole('textbox', { name: 'Work email' }) as HTMLInputElement).value).toBe('clinician@example.test')
  expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('saved-typed-password')
  expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', true)

  act(() => challengeCallbacks[1]?.('fresh-token'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', false))
})

it('asks the challenge for the sign-in action of the host the portal is served on', async () => {
  calls.loginAction.mockReturnValue('ocr-login')
  const renderChallenge = vi.fn((_host: HTMLElement, _options: Record<string, unknown>) => 'widget-1')
  vi.stubGlobal('turnstile', { render: renderChallenge, remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)
  await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1))

  expect(renderChallenge.mock.calls[0]?.[1]).toMatchObject({ action: 'ocr-login' })
  expect(calls.loginAction).toHaveBeenCalledWith(window.location.hostname)
})

it.each([
  ['lab.healthidentitydirectory.com', 'https://www.healthidentitydirectory.com/provider/recover'],
  ['pharmacy.healthidentitydirectory.com', 'https://www.healthidentitydirectory.com/provider/recover'],
  ['migrate.healthidentitydirectory.com', 'https://www.healthidentitydirectory.com/provider/recover'],
  ['outreach.healthidentitydirectory.com', 'https://www.healthidentitydirectory.com/provider/recover'],
  ['ehr.healthidentitydirectory.com', 'https://www.healthidentitydirectory.com/provider/recover'],
  ['lab.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com/provider/recover'],
])('on %s, links password recovery to the main site, where hid-system accepts it', async (hostname, href) => {
  serveFrom(hostname)
  vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)

  const link = screen.getByRole('link', { name: 'Forgot your password?' })
  expect(link.getAttribute('href')).toBe(href)
  expect(screen.getByText(/Password resets are done on the main Health ID site/)).toBeTruthy()
})

it('keeps password recovery on this site where the portal is not a product site', async () => {
  vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })

  render(<MemoryRouter><SignIn /></MemoryRouter>)

  expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/provider/recover')
  expect(screen.queryByText(/Password resets are done on the main Health ID site/)).toBeNull()
})

it.each([
  [260, 'compact'],
  [320, 'normal'],
  [0, 'normal'],
])('fits the security check into a %ipx slot with the %s widget', async (slot, size) => {
  // Cloudflare's normal widget is 300px wide; at 320px the sign-in column leaves 280px.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => slot })
  const renderChallenge = vi.fn((_host: HTMLElement, _options: Record<string, unknown>) => 'widget-1')
  vi.stubGlobal('turnstile', { render: renderChallenge, remove: vi.fn(), reset: vi.fn() })
  try {
    render(<MemoryRouter><SignIn /></MemoryRouter>)
    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1))
    expect(renderChallenge.mock.calls[0]?.[1]).toMatchObject({ size })
  } finally { Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth') }
})

describe('a sign-in that Identity ended for want of an authenticator (403 STAFF_MFA_REQUIRED)', () => {
  const NOTICE = 'Health ID now asks staff for a code from an authenticator app at sign-in. Sign in again to set one up, or to use the one you have.'

  it.each([
    ['signed out at load', 'signed-out'],
    ['ended mid-session', 'ended'],
  ])('says an authenticator code is now needed when it was %s', (_label, status) => {
    calls.state = { status, reason: 'mfa-required' }
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)

    const notice = screen.getByRole('status')
    expect(notice.textContent).toBe(NOTICE)
    expect(notice.className).toBe('staff-notice')
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
  })

  it.each([['signed-out'], ['ended']])('says nothing of authenticators for a session %s otherwise', status => {
    calls.state = { status }
    vi.stubGlobal('turnstile', { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() })
    render(<MemoryRouter><SignIn /></MemoryRouter>)

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/authenticator/)).toBeNull()
  })
})
