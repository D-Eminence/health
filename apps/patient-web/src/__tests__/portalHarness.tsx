import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type PatientProfile } from '../api'
import { createTestSessionValue, SessionContext } from '../session'

/** A signed-in patient's portal pages against a fake gateway; each request is recorded. */
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

export const problem = (status: number, code: string, detail: string) => json({ type: 'about:blank', title: code, status, code, detail }, status)

export type Handler = (path: string, method: string, body: unknown) => Response | Promise<Response>
export interface Sent { path: string; method: string; body: unknown }

export const profile: PatientProfile = {
  patientId: 'patient-1', hid: 'HID-ABC234', firstName: 'Ada', lastName: 'Example', fullName: 'Ada Example',
  dateOfBirth: '1991-03-04', gender: null, country: 'NG', state: null,
  assuranceState: 'NIN_VERIFIED', accessPinConfigured: false, version: 1,
}

/**
 * Reads the portal makes that the gateways in these tests were written before (hid-1.0 parity B2, hid-system 0093:
 * the bell's count and the access log; and the hid-1.0 notifications, which the bell counts). Unless a test serves
 * them (`parityB2`), they answer 404, as an Identity before 0093 does for the first two, and are not recorded in `sent`.
 */
export const PARITY_B2_PATHS = ['/identity/me/notifications/unread-count', '/identity/me/access-log', '/identity/me/imported-notifications'] as const
const isParityB2 = (path: string) => PARITY_B2_PATHS.some(served => path === served || path.startsWith(`${served}/`))
/**
 * The same for hid-1.0 parity B3 (hid-system 0094): the profile's coverage, photo and contact changes, and the
 * health information the patient enters. Unless a test serves them (`parityB3`), they answer 404, as a backend before
 * 0094 does, and are not recorded in `sent`.
 */
export const PARITY_B3_PATHS = ['/identity/me/profile-details', '/identity/me/photo', '/identity/me/contact-changes', '/ehr/me/health-profile'] as const
const isParityB3 = (path: string) => PARITY_B3_PATHS.some(served => path === served || path.startsWith(`${served}/`))
/**
 * The same for hid-1.0 parity B4 (hid-system 0095): sharing, whose probe (the invitations list) Overview and Access and
 * consent read. Unless a test serves them (`parityB4`), they answer 404, as a backend before 0095 does, and are not
 * recorded in `sent`.
 */
export const PARITY_B4_PATHS = ['/identity/me/share-invitations', '/identity/me/share-providers', '/identity/me/shares'] as const
const isParityB4 = (path: string) => PARITY_B4_PATHS.some(served => path === served || path.startsWith(`${served}/`))

export function patientApi(handler: Handler, { parityB2 = false, parityB3 = false, parityB4 = false }:
  { parityB2?: boolean; parityB3?: boolean; parityB4?: boolean } = {}) {
  const sent: Sent[] = []
  // Each request's headers, in the order sent, apart from `sent` so its entries stay comparable as they are.
  const headers: Array<{ path: string; method: string; headers: Headers }> = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/api/v1/', '/')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null
    if (!parityB2 && isParityB2(path)) return problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
    if (!parityB3 && isParityB3(path)) return problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
    if (!parityB4 && isParityB4(path)) return problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
    sent.push({ path, method, body })
    headers.push({ path, method, headers: new Headers(init?.headers) })
    return handler(path, method, body)
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  return { api, sent, headers }
}

type SessionValue = ReturnType<typeof createTestSessionValue>

/** Renders `ui` for a signed-in patient. Paths are recorded without the /api/v1 prefix. */
export function renderPortal(ui: ReactElement, handler: Handler, session: Partial<SessionValue> = {},
  options: { parityB2?: boolean; parityB3?: boolean; parityB4?: boolean; at?: string } = {}) {
  const { api, sent, headers } = patientApi(handler, options)
  const view = render(<MemoryRouter initialEntries={[options.at ?? '/']}><SessionContext.Provider value={{ ...createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api), ...session }}>{ui}</SessionContext.Provider></MemoryRouter>)
  return { sent, view, headers }
}

/** Presses a button the way a keyboard user does: focused, then activated. */
export async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/**
 * Presses the button named `name` the moment it is on the page: after the render
 * that shows it commits and before React runs that render's effects, as a fast
 * click can. Returns whether it has been pressed yet.
 */
export function pressOnArrival(name: string) {
  let pressed = false
  const observer = new MutationObserver(() => {
    const button = screen.queryByRole('button', { name })
    if (!button) return
    observer.disconnect()
    button.focus()
    fireEvent.click(button)
    pressed = true
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => pressed
}

/** The text an element's aria-describedby points to. */
export const described = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' | ')

export const heading = (name: string | RegExp) => screen.getByRole('heading', { name })
