import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { facility, json, REQUESTS, serve, sessionAt } from '../ehr-blue/frame/blueHarness'
import { backToTestSite, onSite } from '../sites/siteHarness'

/**
 * A staff sign-out with single sign-on on, the staff hand-off's switch as it ships (sso/staffHandOffSwitch.ts, not
 * stood in for). Today's staff sign-out (staff/App.tsx, staff/api.ts) ends the workspace's sign-in but not the
 * provider's session on auth., so a hand-off after it would sign the same person straight back in, without a word, on
 * a shared workstation. Until the staff owner's change ends the provider's session and switches the hand-off on, the
 * staff sites keep today's sign-in, whatever VITE_HID_SSO says. Identity is a fake; the tab's departure is the test's
 * stand-in for sso/leave.ts. Every account, facility and host is fictional.
 */
const environment = vi.hoisted(() => ({
  name: 'production', apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, ssoEnabled: true,
  patientChatEnabled: false, supportChatEnabled: false, supportContact: null,
}))
vi.mock('../../env', () => ({ getEnvironment: () => environment }))
vi.mock('../../staff/env', () => ({ getEnvironment: () => environment }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
vi.mock('../../openSite', () => ({ openSite: vi.fn() }))
const left = vi.hoisted(() => vi.fn())
vi.mock('../../sso/leave', () => ({ leavePage: left }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { left.mockClear(); environment.ssoEnabled = true; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const LOGOUT = 'POST /api/v1/auth/logout'
const clinic = facility('f0000000-0000-4000-8000-0000000051e5', 'Fictional Clinic', ['identity.patient.read', 'identity.consent.write'])

function Address() {
  const { pathname, search } = useLocation()
  return <span data-testid="address" hidden>{pathname + search}</span>
}

describe('a staff sign-out with single sign-on on, before the staff sign-out ends the provider’s session', () => {
  it.each(['ehr.healthidentitydirectory.com'])(
    'on %s, comes back to today’s sign-in form and never hands off', async host => {
      const sent = serve({ 'GET /api/v1/auth/session': [sessionAt(clinic, [clinic])], [REQUESTS]: [() => json([])],
        [LOGOUT]: [() => new Response(null, { status: 204 })] })
      onSite(host, '/provider/requests')
      const { App } = await import('../../App')
      render(<MemoryRouter initialEntries={['/provider/requests']}><Address /><App /></MemoryRouter>)
      await screen.findByRole('complementary', { name: 'Provider navigation' })
      await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!) })
      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe('/provider/sign-in?returnTo=%2Fprovider%2Frequests'))
      expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
      expect(left).not.toHaveBeenCalled()
      expect(sent.some(request => request.route === LOGOUT)).toBe(true)
      expect(sent.filter(request => request.route.includes('/auth/sso/'))).toEqual([])
      expect(screen.queryByText('Opening Health ID sign-in…')).toBeNull()
    })
})
