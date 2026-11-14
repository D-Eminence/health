import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * PEHR-11 (WCAG 2.4.3 Focus Order). A step that opens another page removed the
 * control that ran it, and focus fell to the document: opening a patient from
 * Patient access, and a facility switch to the overview. The workspace now moves
 * focus to the new page's heading when that happens, and leaves it alone on a
 * control still on screen.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read', 'ehr.document.read']
const facility = (id: string, name: string) => ({ id, membershipId: `member-${id}`, organizationId: 'org-1', name, roles: ['clinician'], permissions: PERMISSIONS, isPrimary: id === 'facility-1' })
const LAGOS = facility('facility-1', 'Lagos General'), IKEJA = facility('facility-2', 'Ikeja Clinic')
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const session = (current: typeof LAGOS) => json({ actor: { id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician',
  roles: ['clinician'], permissions: [], facilities: [LAGOS, IKEJA], facility: current }, expiresAt: '2026-10-12T12:00:00.000Z' })
const lookup = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_records' },
  patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: 'Chidi Okafor' } })

function serve(routes: Record<string, Array<() => Response>>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    return routes[route]?.shift()?.() ?? (route === 'GET /api/v1/identity/access-requests' ? json([]) : json({ items: [], nextCursor: null }))
  }))
}

function Where() { return <output data-testid="where">{useLocation().pathname}</output> }

async function open(path: string) {
  const { App } = await import('./App')
  render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

describe('PEHR-11: focus after a step that opens another page', () => {
  it('opening a patient with Verify access moves focus to the clinical record\'s heading', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session(LAGOS)], 'POST /api/v1/identity/patient-lookup': [lookup, lookup] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    const verify = screen.getByRole('button', { name: 'Verify access' })
    verify.focus()
    fireEvent.click(verify)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/clinical'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Chidi Okafor' })))
  })

  it('a facility switch made from the overview, which stays on the same path, moves focus to its heading', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session(LAGOS)], 'POST /api/v1/auth/facility': [() => session(IKEJA)] })
    await open('/provider')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    const confirm = screen.getByRole('button', { name: 'Switch facility' })
    confirm.focus()
    fireEvent.click(confirm)
    expect(await screen.findByText(/Working at Ikeja Clinic\./)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: /Good to see you/ })))
  })

  it('a facility switch made from another page moves focus to the overview\'s heading, never to the old page\'s', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session(LAGOS)], 'POST /api/v1/auth/facility': [() => session(IKEJA)] })
    await open('/provider/patients')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Working at' }), { target: { value: 'facility-2' } })
    const stops: string[] = []
    const record = (event: FocusEvent) => { stops.push((event.target as HTMLElement).textContent?.trim() ?? '') }
    document.addEventListener('focusin', record)
    const confirm = screen.getByRole('button', { name: 'Switch facility' })
    confirm.focus()
    fireEvent.click(confirm)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: /Good to see you/ })))
    document.removeEventListener('focusin', record)
    expect(stops).not.toContain('Open a patient record.')
  })

  it('a navigation link, still on screen after it is followed, keeps focus', async () => {
    serve({ 'GET /api/v1/auth/session': [() => session(LAGOS)] })
    await open('/provider')
    const link = await screen.findByRole('link', { name: 'Patient access' })
    link.focus()
    fireEvent.click(link)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/patients'))
    expect(document.activeElement).toBe(link)
  })
})
