import { afterEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ loginAction: vi.fn((_hostname: string) => 'staff-login') }))

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../productHostname', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  staffLoginAction: host.loginAction,
}))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/** The sign-in sends the Turnstile action that hid-system accepts on the portal's host. */
it('signs in with the action of the host the portal is served on', async () => {
  host.loginAction.mockReturnValue('ocr-login')
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
    actor: { kind: 'staff', id: 'staff-1', subject: 'staff-1', email: 'a@example.test', displayName: 'A', roles: [], permissions: [],
      facilities: [], facility: null },
    expiresAt: '2026-10-11T12:00:00.000Z',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  const { staffApi } = await import('./api')

  await staffApi.login('clinician@example.test', 'correct horse battery staple', 'turnstile-token')

  const [url, init] = fetch.mock.calls[0]!
  expect(new URL(String(url)).pathname).toBe('/api/v1/auth/login')
  expect(JSON.parse(String(init?.body))).toEqual({ email: 'clinician@example.test', password: 'correct horse battery staple',
    turnstileToken: 'turnstile-token', turnstileAction: 'ocr-login' })
  expect(host.loginAction).toHaveBeenCalledWith(window.location.hostname)
})
