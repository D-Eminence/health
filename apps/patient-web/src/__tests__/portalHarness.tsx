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

export function patientApi(handler: Handler) {
  const sent: Sent[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/api/v1/', '/')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null
    sent.push({ path, method, body })
    return handler(path, method, body)
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  return { api, sent }
}

type SessionValue = ReturnType<typeof createTestSessionValue>

/** Renders `ui` for a signed-in patient. Paths are recorded without the /api/v1 prefix. */
export function renderPortal(ui: ReactElement, handler: Handler, session: Partial<SessionValue> = {}) {
  const { api, sent } = patientApi(handler)
  const view = render(<MemoryRouter><SessionContext.Provider value={{ ...createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api), ...session }}>{ui}</SessionContext.Provider></MemoryRouter>)
  return { sent, view }
}

/** Presses a button the way a keyboard user does: focused, then activated. */
export async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** The text an element's aria-describedby points to. */
export const described = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? '').join(' | ')

export const heading = (name: string | RegExp) => screen.getByRole('heading', { name })
