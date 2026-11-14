import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SessionProvider, useSession } from '../session'
import type { BrowserPushSubscription } from '../pushDevice'

/**
 * Signing out turns notifications off on this device (B6, contract b6-contract.md D5 and §11.6): where the browser holds
 * a push subscription, Identity is told to remove it and the browser unsubscribes, before the sign-out; best effort, at
 * most 2 seconds, and never a reason for the sign-out to fail. With no subscription (today: nobody has one) nothing
 * is sent, as PatientSignOut.test.tsx shows for every sign-out path.
 */
const environment = vi.hoisted(() => ({ name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))

const fake = vi.hoisted(() => ({ subscription: null as BrowserPushSubscription | null, calls: [] as string[] }))
vi.mock('../pushDevice', () => ({
  browserSubscription: async () => { fake.calls.push('browserSubscription'); return fake.subscription },
  turnOffBrowser: async () => { fake.calls.push('turnOffBrowser'); fake.subscription = null },
}))

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-token-1'
const SESSION = 'GET /api/v1/auth/session'
const LOGOUT = 'POST /api/v1/auth/logout'
const REFRESH = 'POST /api/v1/auth/refresh'
const REMOVE = 'POST /api/v1/identity/me/web-push/subscription/remove'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const patient = () => json({ actor: { kind: 'patient', subject: 'subject-a', patientId: 'patient-a', accountId: 'account-a' }, expiresAt: '2026-10-28T12:00:00.000Z' })
const problem = (status: number, code: string) => json({ status, code, title: code, detail: code }, status)
const noContent = () => new Response(null, { status: 204 })

/** Serves each route's answers in order and records every request, as `METHOD /path`, with its body. */
function serve(routes: Record<string, Array<() => Response | Promise<Response>>>) {
  const calls: string[] = []
  const bodies: Record<string, unknown> = {}
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push(route)
    fake.calls.push(route)
    if (init?.body) bodies[route] = JSON.parse(String(init.body))
    const next = routes[route]?.shift()
    return next ? next() : problem(418, 'UNEXPECTED_REQUEST')
  }))
  return { calls, bodies }
}

function Probe() {
  const { state, signOut } = useSession()
  const [failure, setFailure] = useState<string | null>(null)
  return <>
    <output data-testid="status">{state.status}</output>
    <button type="button" onClick={() => { setFailure(null); void signOut().catch((error: Error) => setFailure(error.message)) }}>Sign out</button>
    {failure && <p role="alert">{failure}</p>}
  </>
}

async function signedIn(routes: Record<string, Array<() => Response | Promise<Response>>>) {
  const served = serve({ [SESSION]: Array.from({ length: 3 }, () => patient), ...routes })
  render(<SessionProvider><Probe /></SessionProvider>)
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
  fake.calls.length = 0
  return served
}

async function signOut() {
  await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click() })
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'), { timeout: 5000 })
}

beforeEach(() => { fake.subscription = null; fake.calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('signing out with notifications on this device', () => {
  it('tells Identity to remove this browser\'s subscription and unsubscribes it, then signs out', async () => {
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: 'ab'.repeat(32), keyId: 'a1b2c3d4e5f60718' }
    const { bodies } = await signedIn({ [REMOVE]: [() => json({ removed: true })], [LOGOUT]: [noContent] })
    await signOut()
    expect(fake.calls.filter(call => call !== SESSION)).toEqual(['browserSubscription', REMOVE, 'turnOffBrowser', LOGOUT])
    expect(bodies[REMOVE]).toEqual({ endpoint: ENDPOINT })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['Identity does not serve push (404, today\'s backend)', () => problem(404, 'NOT_FOUND')],
    ['Identity is unavailable', () => problem(503, 'UPSTREAM_UNAVAILABLE')],
  ])('still unsubscribes and signs out once when %s, asking only once', async (_name, answer) => {
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: 'ab'.repeat(32), keyId: null }
    await signedIn({ [REMOVE]: [answer], [LOGOUT]: [noContent] })
    await signOut()
    expect(fake.calls.filter(call => call !== SESSION)).toEqual(['browserSubscription', REMOVE, 'turnOffBrowser', LOGOUT])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('neither refreshes nor signs the tab out on the removal\'s 401: the sign-out deals with the session', async () => {
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: 'ab'.repeat(32), keyId: null }
    await signedIn({ [REMOVE]: [() => problem(401, 'AUTHENTICATION_REQUIRED')], [LOGOUT]: [noContent] })
    await signOut()
    expect(fake.calls.filter(call => call !== SESSION)).toEqual(['browserSubscription', REMOVE, 'turnOffBrowser', LOGOUT])
    expect(fake.calls).not.toContain(REFRESH)
  })

  it('waits at most 2 seconds for Identity, then signs out', async () => {
    fake.subscription = { endpoint: ENDPOINT, endpointDigest: 'ab'.repeat(32), keyId: null }
    await signedIn({ [REMOVE]: [() => new Promise<Response>(() => {})], [LOGOUT]: [noContent] })
    const started = Date.now()
    await signOut()
    expect(Date.now() - started).toBeLessThan(4_000)
    expect(fake.calls.filter(call => call !== SESSION).at(-1)).toBe(LOGOUT)
  })

  it('sends nothing more where this browser has no subscription', async () => {
    const { calls } = await signedIn({ [LOGOUT]: [noContent] })
    await signOut()
    expect(calls.filter(call => call !== SESSION).slice(-1)).toEqual([LOGOUT])
    expect(fake.calls.filter(call => call !== SESSION)).toEqual(['browserSubscription', LOGOUT])
  })
})
