import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, createTestSessionValue, useSession } from '../session'
import type { PatientApi } from '../api'

/**
 * A patient whose sign-in ends while they use the portal (a request answers 401 and the refresh is refused) is sent to
 * sign-in. The session says so (`sessionEnded`), so sign-in can tell them why in plain words and take them back to the
 * page they were on: a sign-out they asked for, or a first visit with no sign-in, is not that. Fictional people only.
 */
vi.mock('../env', () => {
  const environment = { name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }
  return { getEnvironment: () => environment }
})

afterEach(() => { vi.unstubAllGlobals() })

const SESSION = 'GET /api/v1/auth/session'
const PROFILE = 'GET /api/v1/identity/me'
const REFRESH = 'POST /api/v1/auth/refresh'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => json({ status, code, title: code, detail: code }, status)
const patient = () => json({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' }, expiresAt: '2026-12-11T12:00:00.000Z' })

function serve(routes: Record<string, Array<() => Response>>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const next = routes[`${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`]?.shift()
    return next ? next() : problem(418, 'UNEXPECTED_REQUEST')
  }))
}

function Probe() {
  const { state, sessionEnded, api } = useSession()
  return <>
    <output data-testid="status">{state.status}</output>
    <output data-testid="ended">{String(sessionEnded)}</output>
    <button type="button" onClick={() => { void api.profile().catch(() => undefined) }}>Read profile</button>
  </>
}

const shown = (id: string) => screen.getByTestId(id).textContent

describe('a sign-in that ends while the patient uses the portal', () => {
  it('is marked as ended, for sign-in to explain', async () => {
    serve({ [SESSION]: [patient], [PROFILE]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    render(<SessionProvider><Probe /></SessionProvider>)
    await waitFor(() => expect(shown('status')).toBe('authenticated'))
    expect(shown('ended')).toBe('false')
    await act(async () => { screen.getByRole('button', { name: 'Read profile' }).click() })
    await waitFor(() => expect(shown('status')).toBe('anonymous'))
    expect(shown('ended')).toBe('true')
  })

  it('is not marked when the portal opens with no sign-in to end', async () => {
    serve({ [SESSION]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [REFRESH]: [() => problem(403, 'CSRF_VALIDATION_FAILED')] })
    render(<SessionProvider><Probe /></SessionProvider>)
    await waitFor(() => expect(shown('status')).toBe('anonymous'))
    expect(shown('ended')).toBe('false')
  })

  it('is not marked in the session a test or a page builds by hand', () => {
    expect(createTestSessionValue(null, {} as PatientApi).sessionEnded).toBe(false)
  })
})
