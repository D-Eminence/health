import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SignIn } from './SignIn'
import type * as ProductHostname from '../../productHostname'

const calls = vi.hoisted(() => ({ login: vi.fn(), loginAction: vi.fn((_hostname: string) => 'staff-login'), servedOn: { hostname: '' } }))

vi.mock('../App', () => ({ useStaff: () => ({ state: { status: 'signed-out' }, login: calls.login }) }))
vi.mock('../env', () => ({ getEnvironment: () => ({ turnstileSiteKey: 'test-site-key' }) }))
vi.mock('../../productHostname', async importOriginal => {
  const real = await importOriginal<typeof ProductHostname>()
  return {
    ...real,
    staffLoginAction: calls.loginAction,
    // The real mapping, for the host a test says the portal is served on (jsdom's own is localhost).
    staffRecoveryHref: vi.fn((hostname: string) => real.staffRecoveryHref(calls.servedOn.hostname || hostname)),
  }
})

beforeEach(() => { vi.clearAllMocks(); calls.servedOn.hostname = '' })
afterEach(() => vi.unstubAllGlobals())

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
  calls.servedOn.hostname = hostname
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
