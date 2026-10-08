import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { App, SESSION_ENDED_MESSAGES } from '../App'
import { clearSessionWindow, recordSessionWindow, reportSessionEnded } from '../session-window'

const api = vi.hoisted(() => ({
  session: vi.fn(), mfaStatus: vi.fn(), logout: vi.fn(), refresh: vi.fn(), overview: vi.fn(),
}))
vi.mock('../api', () => ({ adminApi: api, newIdempotencyKey: () => 'key-1' }))
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const actor = (permissions: string[]) => ({ actor: { accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada Admin',
  email: 'ada@example.test', platformRoles: ['platform_super_admin'], platformPermissions: permissions } })
const ALL = ['platform.admin.access', 'platform.principal.read', 'platform.role.manage', 'platform.audit.read']

function open(path = '/admin/overview') {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  clearSessionWindow()
  api.mfaStatus.mockResolvedValue({ enrolled: true, session: null })
  api.overview.mockResolvedValue({ activeAccounts: 3 })
})
afterEach(() => clearSessionWindow())

describe('platform administration session', () => {
  it('opens the workspace only for a platform session the server accepts', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open()
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'My security' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Approvals' }).length).toBeGreaterThan(0)
    expect(api.mfaStatus).toHaveBeenCalledTimes(1)
  })

  it('hides approvals from an administrator who cannot list them', async () => {
    api.session.mockResolvedValueOnce(actor(['platform.admin.access']))
    open()
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Approvals' })).toBeNull()
  })

  it('asks for sign-in without a session notice when there was no platform session', async () => {
    api.session.mockRejectedValueOnce(new HidApiError(401, 'Valid authentication is required', { code: 'AUTHENTICATION_REQUIRED' }))
    open()
    expect(await screen.findByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('refuses an account without platform administration access', async () => {
    api.session.mockResolvedValueOnce(actor(['platform.audit.read']))
    open()
    expect(await screen.findByText('This account has no platform administration access.')).toBeTruthy()
  })

  it('reports an expired session when the server refuses it after its reported idle expiry', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    act(() => { recordSessionWindow({ idleExpiresAt: inMinutes(-1) }); reportSessionEnded() })
    expect(await screen.findByText(SESSION_ENDED_MESSAGES.expired)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Administration sign in' })).toBeTruthy()
  })

  it('reports a revoked session when the server refuses it before its reported expiry', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    act(() => { recordSessionWindow({ idleExpiresAt: inMinutes(10), absoluteExpiresAt: inMinutes(300) }); reportSessionEnded() })
    expect(await screen.findByText(SESSION_ENDED_MESSAGES.revoked)).toBeTruthy()
  })

  it('warns before the idle expiry and extends the session only when asked', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    api.refresh.mockImplementationOnce(async () => { recordSessionWindow({ idleExpiresAt: inMinutes(15) }) })
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    expect(screen.queryByText(/your session ends at/)).toBeNull()
    act(() => recordSessionWindow({ idleExpiresAt: inMinutes(1), absoluteExpiresAt: inMinutes(300) }))
    expect(await screen.findByText(/For security, your session ends at .* unless you continue working/)).toBeTruthy()
    expect(api.refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
    await waitFor(() => expect(screen.queryByText(/your session ends at/)).toBeNull())
    expect(api.refresh).toHaveBeenCalledTimes(1)
  })

  it('tells the administrator when the 8-hour limit cannot be extended', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    const limit = inMinutes(1)
    act(() => recordSessionWindow({ idleExpiresAt: limit, absoluteExpiresAt: limit }))
    expect(await screen.findByText(/reaches its 8-hour limit/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stay signed in' })).toBeNull()
  })

  it('signs out through the platform session and clears the workspace', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    api.logout.mockResolvedValueOnce(undefined)
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!)
    expect(await screen.findByText('You have signed out of platform administration.')).toBeTruthy()
    expect(api.logout).toHaveBeenCalledTimes(1)
  })
})
