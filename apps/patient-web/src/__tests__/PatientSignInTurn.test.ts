import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient, RequestSpec } from '@hid/http'
import { createPatientApi } from '../api'

afterEach(() => { Reflect.deleteProperty(navigator, 'locks') })

/** Another window of the portal holding the refresh lock until released. */
function lockHeldElsewhere() {
  let release: () => void = () => {}
  const held = new Promise<void>(done => { release = done })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    if (options.ifAvailable) return callback(null)
    await held
    return callback({})
  }) } })
  return { release }
}

function recordingClient() {
  const sent: string[] = []
  const client = { request: vi.fn(async (spec: RequestSpec) => { sent.push(`${spec.method} ${spec.path}`); return { actor: { kind: 'patient' } } }) }
  return { client: client as unknown as ApiClient, sent }
}

/**
 * The patient portal shares the provider portal's cookies. A sign-in sent while
 * another window's refresh is in flight could have that refresh's answer land
 * after it and replace the new session's cookies, so sign-in waits its turn.
 */
describe('a patient sign-in while another window refreshes', () => {
  it.each([
    ['password', (api: ReturnType<typeof createPatientApi>) => api.login('ada@example.test', 'secret', 'turnstile'), 'POST /api/v1/auth/patient/login'],
    ['Google', (api: ReturnType<typeof createPatientApi>) => api.googleExchange('id-token', 'turnstile', 'sign_in'), 'POST /api/v1/auth/oidc/exchange'],
    // An activation may sign the patient in (`signedIn: true`, hid-system, owner decision 2026-10-28), on either route.
    ['an activation', (api: ReturnType<typeof createPatientApi>) => api.enrollmentActivate('a-long-enough-password'),
      'POST /api/v1/identity/patient-enrollments/activate'],
  ])('with %s is sent only once that refresh has finished', async (_label, signIn, request) => {
    const other = lockHeldElsewhere()
    const { client, sent } = recordingClient()
    const signedIn = signIn(createPatientApi(client))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sent).toEqual([])

    other.release()
    await signedIn
    expect(sent).toEqual([request])
  })
})
