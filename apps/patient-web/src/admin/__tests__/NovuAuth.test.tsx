import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const actor = { accountId: 'admin-1', platformPermissions: ['platform.admin.access'], platformRoles: ['platform_admin'] }
const unauthorized = { status: 401, code: 'AUTHENTICATION_REQUIRED', detail: 'Valid authentication is required' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

it('opens a clean first-visit sign-in screen without calling missing platform MFA or refresh endpoints', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(new URL(url).pathname); return json(unauthorized, 401) }))
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={['/admin/sign-in']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
  expect(screen.queryByText('Session unavailable')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(calls).toEqual(['/api/v1/admin/session'])
})

it('uses Novu login, refresh and logout with the generic CSRF cookie and still checks the protected admin session', async () => {
  const calls: { path: string; method: string; csrf: string | null; body: unknown }[] = []
  document.cookie = 'hid_access_csrf=novu-proof; path=/'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    calls.push({ path, method: String(init.method), csrf: new Headers(init.headers).get('x-csrf-token'),
      body: init.body ? JSON.parse(String(init.body)) : null })
    return json({ actor, expiresAt: '2026-10-19T10:00:00Z' })
  }))
  const { adminApi, setAdminSessionAccount } = await import('../api')
  await adminApi.novuLogin('admin@example.test', 'fictional-password', 'turnstile-proof')
  await adminApi.session()
  setAdminSessionAccount('admin-1')
  await adminApi.refresh()
  await adminApi.logout()
  expect(calls.map(c => c.path)).toEqual(['/api/v1/auth/login', '/api/v1/admin/session', '/api/v1/auth/refresh', '/api/v1/auth/logout'])
  expect(calls[0]!.body).toEqual({ email: 'admin@example.test', password: 'fictional-password', turnstileAction: 'admin-login', turnstileToken: 'turnstile-proof' })
  expect(calls[2]!.csrf).toBe('novu-proof')
  expect(calls[3]!.csrf).toBe('novu-proof')
})

it('does not restore an open admin workspace as a different account during a Novu refresh', async () => {
  document.cookie = 'hid_access_csrf=proof; path=/'
  vi.stubGlobal('fetch', vi.fn(async () => json({ actor: { accountId: 'another-account' } })))
  const { adminApi, setAdminSessionAccount } = await import('../api')
  setAdminSessionAccount('admin-1')
  await expect(adminApi.refresh()).rejects.toMatchObject({ status: 401, code: 'AUTHENTICATION_REQUIRED' })
})

it('opens the workspace only after the backend accepts its admin session and refuses users without permission', async () => {
  let signedIn = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(url).pathname
    if (path === '/api/v1/auth/login') { signedIn = true; return json({ actor }) }
    if (path === '/api/v1/admin/session') return signedIn ? json({ ...unauthorized, status: 403, code: 'FORBIDDEN', detail: 'This account has no platform administration access.' }, 403) : json(unauthorized, 401)
    throw new Error('Unexpected route: ' + path)
  }))
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={['/admin/sign-in']}><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Administration sign in' })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'staff@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('no platform administration access'))
  expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull()
})

it('completes Novu password sign-in into the permission-checked overview without calling MFA APIs', async () => {
  let signedIn = false
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(url).pathname; calls.push(path)
    if (path === '/api/v1/auth/login') { signedIn = true; return json({ actor }) }
    if (path === '/api/v1/admin/session') return signedIn ? json({ actor }) : json(unauthorized, 401)
    if (path === '/api/v1/admin/overview') return json({ registeredPatients: 3, facilities: 2, verifiedFacilities: 2,
      suspendedFacilities: 0, activeStaffMemberships: 1, pendingIdentityReviews: 0 })
    throw new Error('Unexpected route: ' + path)
  }))
  const { App } = await import('../App')
  render(<MemoryRouter initialEntries={['/admin/sign-in']}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Administration sign in' })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
  expect(calls).toContain('/api/v1/admin/session')
  expect(calls.some(path => path.includes('/mfa') || path.includes('/auth/admin/'))).toBe(false)
})
