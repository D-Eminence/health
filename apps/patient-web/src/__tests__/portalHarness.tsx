import type { ReactElement } from 'react'
import { expect, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

/**
 * The same for B6 (hid-system 0097): "Notifications on this device", which the Notifications page reads. Unless a test serves it
 * (`webPush`), it answers 404, as a backend before 0097, or one whose push keys are not configured, does, and is not
 * recorded in `sent`.
 */
export const WEB_PUSH_PATHS = ['/identity/me/web-push'] as const
const isWebPush = (path: string) => WEB_PUSH_PATHS.some(served => path === served || path.startsWith(`${served}/`))

export function patientApi(handler: Handler, { parityB2 = false, parityB3 = false, parityB4 = false, webPush = false }:
  { parityB2?: boolean; parityB3?: boolean; parityB4?: boolean; webPush?: boolean } = {}) {
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
    if (!webPush && isWebPush(path)) return problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
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
  options: { parityB2?: boolean; parityB3?: boolean; parityB4?: boolean; webPush?: boolean; at?: string } = {}) {
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

/** The button in the heading of the profile's section named `name`, which opens and closes it (ProfileSection.tsx). */
export const sectionToggle = (name: string | RegExp) => within(heading(name)).getByRole('button')

/**
 * Opens the profile's section headed `name` once it is shown, as the patient does, with a click on its heading: each
 * starts closed (ProfileSection.tsx). Focus is left where it was, as a click leaves it in Safari, so what a test does
 * next starts from where it did before the sections closed. One already open is left open. Returns the section's card.
 */
export async function openSection(name: string | RegExp): Promise<HTMLElement> {
  await screen.findByRole('heading', { name, level: 2 })
  const toggle = sectionToggle(name)
  if (toggle.getAttribute('aria-expanded') !== 'true') await act(async () => { fireEvent.click(toggle) })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  return sectionCard(name)
}

/** The card of the profile's section headed `name` (a kasuwa Card holding its heading). */
export const sectionCard = (name: string | RegExp) => heading(name).closest('h2, h3')!.parentElement as HTMLElement

/**
 * The email and phone, at the end of the profile's About you (once Bio-data) with no heading of their own (ProfileContact.tsx): opens
 * Bio-data as the patient does, and returns the block (#contact-details) inside it.
 */
export async function openContactDetails(): Promise<HTMLElement> {
  const bio = await openSection('About you')
  const block = bio.querySelector<HTMLElement>('#contact-details')
  expect(block).not.toBeNull()
  return block as HTMLElement
}

/** The profile's completion card, always shown and never closed (ProfileCompletion.tsx), once it is shown. */
export async function completionCard(): Promise<HTMLElement> {
  // Headed "Finish your profile" until it is complete, then "Profile complete".
  const title = await screen.findByRole('heading', { name: /^(Finish your profile|Profile complete)$/, level: 2 })
  expect(within(title).queryByRole('button')).toBeNull()
  return title.closest('#profile-completion') as HTMLElement
}

/** What an alert shows: its text without the visually hidden intent label ("Error: ") a kasuwa Alert reads out first. */
export function shownText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove()
  return copy.textContent ?? ''
}
