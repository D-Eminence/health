import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// The console with its real API module and HTTP client; only the network is replaced.
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const refused = (code: string) => json({ code, detail: 'Valid authentication is required' }, 401)

/** Answers each `METHOD /path` from its own queue, in order, and records the calls. */
function serve(routes: Record<string, Response[]>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    calls.push(route)
    return routes[route]?.shift() ?? json({ code: 'UNEXPECTED_REQUEST' }, 418)
  }))
  return calls
}

async function open() {
  const { App, SESSION_ENDED_MESSAGES } = await import('../App')
  render(<MemoryRouter initialEntries={['/admin/overview']}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
  return SESSION_ENDED_MESSAGES
}

const SESSION = 'GET /api/v1/admin/session'
const REFRESH = 'POST /api/v1/auth/admin/refresh'

describe('session end reasons the server gives when the console opens (reload or new tab)', () => {
  it('states that the session was revoked when the refresh says so', async () => {
    const calls = serve({ [SESSION]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.getByText(messages.revoked)).toBeTruthy()
    expect(calls).toEqual([SESSION, REFRESH])
  })

  it('states that the session expired when the refresh says so', async () => {
    serve({ [SESSION]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [refused('PLATFORM_SESSION_EXPIRED')] })
    const messages = await open()
    expect(await screen.findByText(messages.expired)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
  })

  it('states the reason the session request itself was refused with', async () => {
    serve({ [SESSION]: [refused('PLATFORM_SESSION_REVOKED')], [REFRESH]: [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    expect(await screen.findByText(messages.revoked)).toBeTruthy()
  })

  it('shows no session notice on a first visit, when the server names no session', async () => {
    const calls = serve({ [SESSION]: [refused('AUTHENTICATION_REQUIRED')], [REFRESH]: [refused('AUTHENTICATION_REQUIRED')] })
    await open()
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(calls).toEqual([SESSION, REFRESH])
  })
})

describe('signing out of a session the server has already ended', () => {
  const signedIn = () => ({
    [SESSION]: [json({ actor: { accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada Admin', email: 'ada@example.test',
      platformRoles: [], platformPermissions: ['platform.admin.access'] } })],
    'GET /api/v1/admin/mfa': [json({ enrolled: true, factorType: 'totp', activatedAt: null, lastUsedAt: null,
      recoveryCodesRemaining: 10, session: null })],
    'GET /api/v1/admin/overview': [json({ registeredPatients: 0, facilities: 0, verifiedFacilities: 0, suspendedFacilities: 0,
      activeStaffMemberships: 0, pendingIdentityReviews: 0 })],
  })

  it('keeps the revoked notice instead of saying the administrator signed out', async () => {
    serve({ ...signedIn(), 'POST /api/v1/auth/admin/logout': [refused('PLATFORM_SESSION_REVOKED')] })
    const messages = await open()
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText(messages.revoked)).toBeTruthy()
    expect(screen.queryByText('You have signed out of platform administration.')).toBeNull()
  })

  it('says the administrator signed out when the server gives no reason', async () => {
    serve({ ...signedIn(), 'POST /api/v1/auth/admin/logout': [refused('AUTHENTICATION_REQUIRED')] })
    await open()
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    await waitFor(() => expect(screen.getByText('You have signed out of platform administration.')).toBeTruthy())
  })
})
