import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'

/**
 * The patient portal and the provider portal share one origin and the browser's
 * session cookies: a patient signing in replaces a staff session open in another
 * tab. The patient portal says so on the origin's session-change channel, naming
 * no one, so a provider tab can lock itself and ask the server.
 */
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }) }))
const api = vi.hoisted(() => ({ session: vi.fn(), refresh: vi.fn(), login: vi.fn(), logout: vi.fn() }))
vi.mock('../api', () => ({ createPatientApi: () => api }))

const patient = { actor: { kind: 'patient', subject: 'patient-subject-1', patientId: 'patient-1', accountId: 'account-9' } }

class TabChannel {
  static posted: Array<{ name: string; message: unknown }> = []
  static open = new Set<TabChannel>()
  constructor(readonly name: string) { TabChannel.open.add(this) }
  postMessage(message: unknown) { TabChannel.posted.push({ name: this.name, message }) }
  close() { TabChannel.open.delete(this) }
}

beforeEach(() => {
  vi.clearAllMocks()
  TabChannel.posted = []
  TabChannel.open.clear()
  vi.stubGlobal('BroadcastChannel', TabChannel)
  api.session.mockRejectedValue(Object.assign(new Error('Valid authentication is required'), { name: 'HidApiError', status: 401 }))
})
afterEach(() => vi.unstubAllGlobals())

function Probe() {
  const session = useSession()
  return <>
    <output>{session.state.status}</output>
    <button type="button" onClick={() => { void session.signIn('patient@example.test', 'correct horse', 'token').catch(() => undefined) }}>Sign in</button>
    <button type="button" onClick={() => session.acceptGoogleSession(patient as never)}>Google</button>
    <button type="button" onClick={() => { void session.signOut() }}>Sign out</button>
  </>
}

it('tells the other tabs, naming no one, when a patient signs in, signs in with Google or signs out', async () => {
  api.login.mockResolvedValue(patient)
  api.logout.mockResolvedValue(undefined)
  render(<SessionProvider><Probe /></SessionProvider>)

  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('authenticated'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })) })
  await waitFor(() => expect(TabChannel.posted).toHaveLength(2))
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Google' })) })

  expect(TabChannel.posted).toEqual([
    { name: 'hid-session-change', message: 'changed' },
    { name: 'hid-session-change', message: 'changed' },
    { name: 'hid-session-change', message: 'changed' },
  ])
  expect(TabChannel.open.size).toBe(0)
})

it('says nothing when a patient sign-in fails', async () => {
  api.login.mockRejectedValue(new Error('Wrong password'))
  render(<SessionProvider><Probe /></SessionProvider>)

  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(api.login).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })

  expect(TabChannel.posted).toEqual([])
})

it.each([
  ['the channel cannot be opened', class { constructor() { throw new DOMException('The operation is insecure.', 'SecurityError') } }],
  ['a message cannot be posted', class { postMessage() { throw new DOMException('The operation is insecure.', 'SecurityError') } close() {} }],
])('still signs in and signs out when %s', async (_label, Refusing) => {
  vi.stubGlobal('BroadcastChannel', Refusing)
  api.login.mockResolvedValue(patient)
  api.logout.mockResolvedValue(undefined)
  render(<SessionProvider><Probe /></SessionProvider>)

  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('authenticated'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })) })
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('anonymous'))
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Google' })) })
  expect(screen.getByRole('status').textContent).toBe('authenticated')
})
