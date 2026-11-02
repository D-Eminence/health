import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { useLayoutEffect } from 'react'
import { App, SESSION_ENDED_MESSAGES, SessionWarning } from '../App'
import { clearSessionWindow, recordSessionWindow, reportSessionEnded } from '../session-window'

const api = vi.hoisted(() => ({
  session: vi.fn(), mfaStatus: vi.fn(), logout: vi.fn(), refresh: vi.fn(), overview: vi.fn(),
  approvals: vi.fn(), applications: vi.fn(), demos: vi.fn(), integrations: vi.fn(),
  clinicianApplications: vi.fn(), clinicianApplication: vi.fn(),
}))
const account = vi.hoisted(() => ({ id: null as string | null }))
vi.mock('../api', () => ({ adminApi: api, newIdempotencyKey: () => 'key-1',
  adminSessionAccount: () => account.id, setAdminSessionAccount: (id: string | null) => { account.id = id },
  closeAdminSession: () => { account.id = null } }))
vi.mock('../env', () => ({ environment: () => ({ name: 'local', turnstileSiteKey: null, apiBaseUrl: 'https://gateway.example.test' }) }))

const actor = (permissions: string[]) => ({ actor: { accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada Admin',
  email: 'ada@example.test', platformRoles: ['platform_super_admin'], platformPermissions: permissions } })
const ALL = ['platform.admin.access', 'platform.principal.read', 'platform.role.manage', 'platform.audit.read']

function open(path = '/admin/overview') {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a test that ends before using every queued answer (a slow machine) must not
  // hand its leftover sessions to the next test. Every default is set again below.
  vi.resetAllMocks()
  clearSessionWindow()
  api.mfaStatus.mockResolvedValue({ enrolled: true, session: null })
  api.overview.mockResolvedValue({ registeredPatients: 3, facilities: 2, verifiedFacilities: 1, suspendedFacilities: 0,
    activeStaffMemberships: 4, pendingIdentityReviews: 0 })
  api.approvals.mockResolvedValue({ items: [] })
  api.applications.mockResolvedValue({ items: [] })
  api.demos.mockResolvedValue({ items: [] })
  api.integrations.mockResolvedValue({ items: [], capabilities: [] })
})
afterEach(() => clearSessionWindow())

/**
 * OCR-A11Y-09 (the platform workspace's own state screens). A role on <main>
 * replaces the main landmark, so each screen is a main landmark holding its
 * status or its alert.
 */
describe('platform session state screens', () => {
  it('checking the session: a main landmark holding the status', () => {
    api.session.mockReturnValueOnce(new Promise(() => {}))
    open()
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe('Checking your sign-in…')
  })

  it('a session that cannot be checked: a main landmark with an h1, and an alert saying why', async () => {
    api.session.mockRejectedValueOnce(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    open()
    const heading = await screen.findByRole('heading', { level: 1, name: 'Couldn’t check your sign-in' })
    const main = screen.getByRole('main')
    expect(main.contains(heading)).toBe(true)
    expect(within(main).getByRole('alert').textContent).toBe('We could not check your platform session. Try again.')
  })
})

describe('platform administration session', () => {
  it('opens the workspace only for a platform session the server accepts', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open()
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'My security' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Approvals' }).length).toBeGreaterThan(0)
    expect(api.mfaStatus).toHaveBeenCalledTimes(1)
  })

  it('lets a keyboard skip the navigation to the page', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    // The first thing a keyboard reaches, before the navigation.
    expect(screen.getAllByRole('link')[0]).toBe(skip)
    fireEvent.click(skip)
    expect(document.activeElement).toBe(screen.getByRole('main'))
    expect(screen.getByRole('main').contains(screen.getByRole('heading', { level: 1, name: 'Overview' }))).toBe(true)
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
    expect(await screen.findByText('This account can’t use platform administration.')).toBeTruthy()
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
    expect(screen.queryByText(/You’ll be signed out at/)).toBeNull()
    act(() => recordSessionWindow({ idleExpiresAt: inMinutes(1), absoluteExpiresAt: inMinutes(300) }))
    expect(await screen.findByText(/You’ll be signed out at .* if you stay idle/)).toBeTruthy()
    expect(api.refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
    await waitFor(() => expect(screen.queryByText(/You’ll be signed out at/)).toBeNull())
    expect(api.refresh).toHaveBeenCalledTimes(1)
  })

  it('tells the administrator when the 8-hour limit cannot be extended', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    const limit = inMinutes(1)
    act(() => recordSessionWindow({ idleExpiresAt: limit, absoluteExpiresAt: limit }))
    expect(await screen.findByText(/You’ll be signed out at/)).toBeTruthy()
    expect(screen.getByText('Sessions last at most 8 hours. Save your work.')).toBeTruthy()
    expect(screen.queryByText(/if you stay idle/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stay signed in' })).toBeNull()
  })

  it('signs out through the platform session and clears the workspace', async () => {
    // Opening, then the check of whose session the browser holds before signing out.
    api.session.mockResolvedValueOnce(actor(ALL)).mockResolvedValueOnce(actor(ALL))
    api.logout.mockResolvedValueOnce(undefined)
    open()
    await screen.findByRole('heading', { name: 'Overview' })
    // Let the overview finish loading first: a late answer re-renders the shell and would close an open menu.
    await screen.findByText('Registered patients')
    fireEvent.click(screen.getByRole('button', { name: 'Ada Admin: account' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('You’ve signed out.')).toBeTruthy()
    expect(api.logout).toHaveBeenCalledTimes(1)
  })
})

describe('consolidated admin routing', () => {
  const SUPPORT = ['platform.admin.access', 'platform.principal.read', 'platform.session.revoke']

  it('refuses deep links to areas the administrator cannot use, before any data request', async () => {
    for (const path of ['/admin/facilities?status=suspended', '/admin/facilities/0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f', '/admin/audit?actor=x']) {
      api.session.mockResolvedValueOnce(actor(SUPPORT))
      const view = render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
      expect(await screen.findByRole('heading', { level: 1, name: 'You can’t open this page' })).toBeTruthy()
      expect(screen.getByRole('alert').textContent).toContain('Ask a Super Admin if you need it.')
      expect(screen.getByRole('link', { name: 'Go to overview' })).toBeTruthy()
      view.unmount()
    }
  })

  it('opens the clinician queue for workforce managers and refuses its links to anyone else, before any request', async () => {
    const id = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
    for (const path of ['/admin/clinicians', `/admin/clinicians/${id}`]) {
      api.session.mockResolvedValueOnce(actor(SUPPORT))
      const view = render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/*" element={<App />} /></Routes></MemoryRouter>)
      expect(await screen.findByRole('heading', { level: 1, name: 'You can’t open this page' })).toBeTruthy()
      expect(screen.getByText('You can’t open Clinician applications')).toBeTruthy()
      view.unmount()
    }
    expect(api.clinicianApplications).not.toHaveBeenCalled()
    expect(api.clinicianApplication).not.toHaveBeenCalled()

    api.session.mockResolvedValueOnce(actor(['platform.admin.access', 'platform.workforce.manage']))
    api.clinicianApplications.mockResolvedValueOnce({ items: [], nextCursor: null })
    open('/admin/clinicians')
    expect(await screen.findByRole('heading', { level: 1, name: 'Clinician applications' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Clinician applications' }).length).toBeGreaterThan(0)
    expect(document.title).toBe('Clinician applications · Health ID Platform')
    await waitFor(() => expect(api.clinicianApplications).toHaveBeenCalledWith('open', {}, expect.any(AbortSignal)))
  })

  it('shows a not-found page for an unknown admin path', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open('/admin/no-such-area')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })

  it('names the browser tab after the open area', async () => {
    api.session.mockResolvedValueOnce(actor(ALL))
    open('/admin/overview')
    await screen.findByRole('heading', { name: 'Overview', level: 1 })
    expect(document.title).toBe('Overview · Health ID Platform')
  })

  it('asks the overview only for the counts the administrator may open', async () => {
    api.session.mockResolvedValueOnce(actor(SUPPORT))
    open()
    expect(await screen.findByRole('heading', { name: 'Platform totals' })).toBeTruthy()
    // The heading renders before the page's effects request anything; the totals
    // render only once the overview has answered, after every count was requested.
    expect(await screen.findByText('Registered patients')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Waiting for attention' })).toBeNull()
    expect(api.overview).toHaveBeenCalledTimes(1)
    expect(api.approvals).not.toHaveBeenCalled()
    expect(api.applications).not.toHaveBeenCalled()
    expect(api.demos).not.toHaveBeenCalled()
    expect(api.integrations).not.toHaveBeenCalled()
  })
})

describe('session warning', () => {
  it('shows a window recorded after it rendered but before it subscribed', () => {
    // A layout effect runs after the warning rendered and before its subscription effect.
    function RecordDuringCommit() {
      useLayoutEffect(() => recordSessionWindow({ idleExpiresAt: inMinutes(1), absoluteExpiresAt: inMinutes(300) }), [])
      return null
    }
    render(<><SessionWarning /><RecordDuringCommit /></>)
    expect(screen.getByText(/You’ll be signed out at .* if you stay idle/)).toBeTruthy()
  })
})
