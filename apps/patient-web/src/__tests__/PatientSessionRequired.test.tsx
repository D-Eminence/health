import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../App'

/**
 * A patient page whose read is refused with 403 PATIENT_SESSION_REQUIRED
 * (hid-system#74 and #76, ADR-059: a patient-only route answers so for any other session)
 * shows no error about that page: the browser's shared cookies hold a provider's
 * sign-in now, so the portal asks the server whose session it is and, finding a
 * provider's, returns to sign-in and says the sign-in changed elsewhere.
 */
const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail: string) =>
  json({ type: 'about:blank', title: code, status, code, detail }, status)
const patient = () => json({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' },
  expiresAt: '2026-10-12T12:00:00.000Z' })
const provider = () => json({ actor: { id: 'staff-1', subject: 'staff-1', roles: ['clinician'] }, expiresAt: '2026-10-12T12:00:00.000Z' })
const REFUSAL = 'An active patient session is required'

function serve(routes: Record<string, Array<() => Response>>) {
  const sent: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    sent.push(route)
    return routes[route]?.shift()?.() ?? problem(418, 'UNEXPECTED_REQUEST', route)
  }))
  return sent
}

let shownRefusal = false
let observer: MutationObserver | null = null
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('hid_access_csrf=csrf-a')
  shownRefusal = false
  observer = new MutationObserver(() => { if (document.body.textContent?.includes(REFUSAL)) shownRefusal = true })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
})
afterEach(() => { observer?.disconnect(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('a patient page refused because the browser holds a provider\'s sign-in', () => {
  it('shows no records error, and returns to sign-in saying the sign-in changed elsewhere', async () => {
    const sent = serve({
      'GET /api/v1/auth/session': [patient, provider],
      'GET /api/v1/ehr/me/records': [() => problem(403, 'PATIENT_SESSION_REQUIRED', REFUSAL)],
    })
    render(<MemoryRouter initialEntries={['/records']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy()
    expect(screen.getByText(/signed out because someone signed in or out on this device in another tab\./)).toBeTruthy()
    // The records page also reads imported history (hid-system main, #94) beside the records, and the portal's shell the
    // bell's count (hid-system 0093) and the profile its avatar shows (parity B3); those reads are not what is checked here.
    expect(sent.filter(request => !request.includes('imported-history') && !request.includes('unread-count')
      && request !== 'GET /api/v1/identity/me'))
      .toEqual(['GET /api/v1/auth/session', 'GET /api/v1/ehr/me/records', 'GET /api/v1/auth/session'])
    expect(shownRefusal).toBe(false)
  })
})
