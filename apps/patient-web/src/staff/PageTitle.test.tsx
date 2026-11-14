import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * PEHR-05 (WCAG 2.4.2 Page Titled). index.html names the browser tab for the
 * patient portal, and nothing in the provider workspace changed it, so every
 * provider page, from sign-in to the clinical record and the session-ended
 * screen, was titled "Health ID: Patient". Each now names itself. A title never
 * carries a patient's name or Health ID: it ends up in browser history, tab
 * previews and shared screens.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
beforeEach(() => { document.title = 'Health ID: Patient' })

const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read', 'lab.work-item.read', 'pharmacy.work-item.read']
const LAGOS = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General', roles: ['clinician'],
  permissions: PERMISSIONS, isPrimary: true }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code, detail: code }),
  { status, headers: { 'Content-Type': 'application/problem+json' } })
const session = (facilities = [LAGOS]) => json({ actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician',
  roles: ['clinician'], permissions: [], facilities, facility: facilities[0] }, expiresAt: '2026-10-12T12:00:00.000Z' })
const lookup = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_records' },
  patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: 'Chidi Okafor' } })

function serve(routes: Record<string, Array<() => Response>>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    return routes[route]?.shift()?.() ?? (route === 'GET /api/v1/identity/access-requests' ? json([]) : json({ items: [], nextCursor: null }))
  }))
}

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

const titled = (page: string) => waitFor(() => expect(document.title).toBe(`${page} · Health ID Provider`))

describe('PEHR-05: each provider page names the browser tab', () => {
  it('names the page opened', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider/laboratory')
    await screen.findByRole('heading', { level: 1, name: 'Laboratory' })
    await titled('Laboratory')
  })

  // The router matches a path in any case, so the page it shows is named whatever the case typed.
  it('names a page whose address is typed in another case', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider/Laboratory')
    await screen.findByRole('heading', { level: 1, name: 'Laboratory' })
    await titled('Laboratory')
  })

  it('follows the page as the clinician moves through the workspace', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider')
    await titled('Overview')
    fireEvent.click(await screen.findByRole('link', { name: 'Pharmacy' }))
    await titled('Pharmacy')
    fireEvent.click(screen.getByRole('link', { name: 'Patient access' }))
    await titled('Patient access')
  })

  it('names the clinical record without the patient', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()], 'POST /api/v1/identity/patient-lookup': [lookup, lookup] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    await screen.findByRole('heading', { level: 1, name: 'Chidi Okafor' })
    await titled('Clinical record')
    expect(document.title).not.toContain('Chidi')
    expect(document.title).not.toContain('HID-ABCDEF23')
  })

  it('names provider sign-in when there is no session', async () => {
    serve({ 'GET /api/v1/auth/session': [() => problem(401, 'AUTHENTICATION_REQUIRED')],
      'POST /api/v1/auth/refresh': [() => problem(401, 'AUTHENTICATION_REQUIRED')] })
    await open('/provider/clinical')
    await screen.findByRole('textbox', { name: /Work email/ }, { timeout: 5000 })
    await titled('Sign in')
  })

  it('names the gate screens: session unavailable and no facility assignment', async () => {
    const unavailable = () => problem(503, 'UPSTREAM_UNAVAILABLE')
    serve({ 'GET /api/v1/auth/session': [unavailable, unavailable, unavailable, unavailable] })
    await open('/provider')
    await screen.findByText('Session unavailable', {}, { timeout: 5000 })
    await titled('Session unavailable')
  })

  it('names a workspace with no facility assignment', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session([])] })
    await open('/provider')
    await screen.findByText('No facility assignment')
    await titled('No facility assignment')
  })

  it('names a page that does not exist', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session()] })
    await open('/provider/nope')
    await screen.findByText('Page not found')
    await titled('Page not found')
  })
})
