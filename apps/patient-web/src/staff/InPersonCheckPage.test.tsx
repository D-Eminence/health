import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * The in-person check of facility-assisted registration (hid-system main
 * f9dbaf0: #85, ADR-063) has its own page in the provider workspace, next to
 * patient registration, for a role holding identity.patient.assisted_registration
 * (doctor, clinician and nurse).
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const facility = (permissions: string[]) => ({ id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General',
  roles: ['nurse'], permissions, isPrimary: true })
const session = (permissions: string[]) => json({ actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Nurse',
  roles: ['nurse'], permissions: [], facilities: [facility(permissions)], facility: facility(permissions) }, expiresAt: '2026-10-12T12:00:00.000Z' })

function serve(permissions: string[]) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push(route)
    return route === 'GET /api/v1/auth/session' ? session(permissions) : json([])
  }))
  return calls
}

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

describe('the in-person check page', () => {
  it('is in the navigation after patient registration for a role with the permission, and opens', async () => {
    serve(['identity.registration.write', 'identity.patient.assisted_registration'])
    await open('/provider')
    const navigation = await screen.findByRole('complementary', { name: 'Provider navigation' })
    const links = within(navigation).getAllByRole('link').map(link => link.textContent)
    expect(links.indexOf('In-person check')).toBe(links.indexOf('Patient registration') + 1)
    fireEvent.click(within(navigation).getByRole('link', { name: 'In-person check' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'In-person check' })).toBeTruthy()
    await waitFor(() => expect(document.title).toBe('In-person check · Health ID Provider'))
  })

  it('is not offered to a role without the permission, and says why when opened', async () => {
    const calls = serve(['identity.patient.read'])
    await open('/provider/in-person-check')
    expect(await screen.findByRole('heading', { level: 1, name: 'In-person check unavailable' })).toBeTruthy()
    const navigation = screen.getByRole('complementary', { name: 'Provider navigation' })
    expect(within(navigation).queryByRole('link', { name: 'In-person check' })).toBeNull()
    expect(calls.some(call => call.includes('assisted-verifications'))).toBe(false)
  })

  it('is a page a sign-in may return to', async () => {
    const { staffReturnPath } = await import('./session')
    expect(staffReturnPath('/provider/in-person-check')).toBe('/provider/in-person-check')
  })
})
