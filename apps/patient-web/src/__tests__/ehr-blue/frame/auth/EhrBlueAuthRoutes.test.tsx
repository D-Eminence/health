import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

/**
 * Where the blue sign-in, recovery and invitation pages open: in place of today's at the same addresses, only once the
 * clinic switch is on (BLUE_FOR_ALL). Until then today's pages serve them, and the blue ones are never downloaded.
 * Every account and facility here is fictional.
 */
const local = { name: 'local', apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }
vi.mock('../../../../env', () => ({ getEnvironment: () => local }))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => local }))
vi.mock('../../../../admin/env', () => ({ environment: () => local }))
vi.mock('../../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))

const loads = vi.hoisted(() => ({ signIn: 0, recovery: 0, invitation: 0 }))

function switchTo(on: boolean) {
  vi.doMock('../../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: on }))
}

beforeEach(() => {
  loads.signIn = 0; loads.recovery = 0; loads.invitation = 0
  // Registered afresh for each test: a vi.mock factory's module outlives vi.resetModules.
  vi.doMock('../../../../ehr-blue/frame/auth/BlueSignIn', async importOriginal => { loads.signIn += 1; return importOriginal() })
  vi.doMock('../../../../ehr-blue/frame/auth/BlueRecovery', async importOriginal => { loads.recovery += 1; return importOriginal() })
  vi.doMock('../../../../ehr-blue/frame/auth/BlueStaffInvitation', async importOriginal => { loads.invitation += 1; return importOriginal() })
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    const body = route === 'POST /api/v1/auth/login' ? SESSION : { code: 'UNAUTHENTICATED', detail: 'Sign in' }
    return new Response(JSON.stringify(body), { status: route === 'POST /api/v1/auth/login' ? 200 : 401,
      headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const SESSION = {
  actor: { id: 'staff-1', email: 'next.clinician@example.test', displayName: 'Demo Clinician', roles: ['clinician'], permissions: [],
    facilities: [{ id: 'f0000000-0000-4000-8000-000000000001', membershipId: 'm-1', organizationId: 'org-1',
      name: 'Riverside Teaching Hospital (fictional)', roles: ['clinician'], permissions: [], isPrimary: true }],
    facility: { id: 'f0000000-0000-4000-8000-000000000001', membershipId: 'm-1', organizationId: 'org-1',
      name: 'Riverside Teaching Hospital (fictional)', roles: ['clinician'], permissions: [], isPrimary: true } },
  expiresAt: '2026-11-30T12:00:00.000Z',
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

async function open(path: string) {
  const { App } = await import('../../../../App')
  return render(<MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter>)
}

const blueRoot = () => document.querySelector('.hid-ehr.hid-ehr-blue-auth')

describe('with the clinic switch off (as it ships)', () => {
  beforeEach(() => { switchTo(false) })

  it('signs in on today\'s page and never loads the blue one', async () => {
    await open('/provider/sign-in')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back.' })).toBeDefined()
    expect(blueRoot()).toBeNull()
    expect(loads.signIn).toBe(0)
  })

  it('recovers on today\'s page', async () => {
    await open('/provider/recover')
    expect(await screen.findByRole('heading', { level: 1, name: 'Reset your password.' })).toBeDefined()
    expect(blueRoot()).toBeNull()
    expect(loads.recovery).toBe(0)
  })

  it('opens an invitation on today\'s page (Novu)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    await open('/provider/invitation')
    expect(await screen.findByRole('heading', { level: 1, name: 'Join your facility.' })).toBeDefined()
    expect(blueRoot()).toBeNull()
    expect(loads.invitation).toBe(0)
  })
})

describe('with the clinic switch on', () => {
  beforeEach(() => { switchTo(true) })

  it('signs in on the blue page, with today\'s steps, into the blue EHR', async () => {
    await open('/provider/sign-in')
    expect(await screen.findByText('Sign in to your hospital workspace.')).toBeDefined()
    expect(blueRoot()).not.toBeNull()
    expect(loads.signIn).toBe(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'next.clinician@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional passphrase for tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
    expect(document.querySelector('.hid-ehr.hid-ehr-shell')).not.toBeNull()
  })

  it('recovers on the blue page', async () => {
    await open('/provider/recover')
    expect(await screen.findByRole('heading', { level: 1, name: 'Recover account access' })).toBeDefined()
    expect(blueRoot()).not.toBeNull()
    expect(loads.recovery).toBe(1)
  })

  it('opens an invitation on the blue page (Novu)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const { unmount } = await open('/provider/invitation')
    expect(await screen.findByRole('heading', { level: 1, name: 'Accept your invitation' })).toBeDefined()
    expect(blueRoot()).not.toBeNull()
    expect(loads.invitation).toBe(1)
    unmount()
  })
})
