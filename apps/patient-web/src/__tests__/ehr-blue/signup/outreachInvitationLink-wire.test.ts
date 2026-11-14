import { findEndpoint } from '@hid/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/**
 * What the invitation page sends to join by the link alone (passwordless plan, phase 1; identity-api accept-link,
 * proposed), through the real staff client with only the network stubbed (on example.test). Fictional ids and tokens.
 */
interface Sent { url: URL; method: string; body: unknown; credentials: RequestCredentials | undefined }

async function staffClient(answers: readonly { status: number; body: unknown }[]) {
  const sent: Sent[] = []
  let next = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    sent.push({ url: new URL(String(url)), method: String(init.method), credentials: init.credentials,
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    const answer = answers[Math.min(next++, answers.length - 1)]!
    const type = answer.status >= 400 ? 'application/problem+json' : 'application/json'
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': type } })
  }))
  const { outreachOrganiserApi } = await import('../../../staff/api')
  return { sent, outreachOrganiserApi }
}

const LINK = { invitationId: 'b1000000-0000-4000-8000-000000000001', token: 'A'.repeat(43) }
const PATH = '/api/v1/identity/outreach-invitations/accept-link'

describe('joining by the invitation link on the wire', () => {
  it('posts the link, the phone choice and the security check to the registered, proposed route', async () => {
    const answer = { accepted: true, signedIn: true, facilityId: 'f-1', membershipId: 'm-1', roleCode: 'outreach_volunteer',
      expiresAt: '2026-12-14T08:00:00.000Z', deviceTrust: 'own_device' }
    const { sent, outreachOrganiserApi } = await staffClient([{ status: 200, body: answer }])
    await expect(outreachOrganiserApi.acceptInvitationByLink(LINK, 'own', 'turnstile-1')).resolves.toEqual(answer)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.method).toBe('POST')
    expect(sent[0]!.url.pathname).toBe(PATH)
    expect(sent[0]!.body).toEqual({ ...LINK, device: 'own', turnstileAction: 'outreach-invitation', turnstileToken: 'turnstile-1' })
    expect(findEndpoint('enrollment.outreachInvitationAcceptLink')).toMatchObject({ path: PATH, status: 'proposed' })
  })

  it('sends "shared", and no token member when there is none', async () => {
    const { sent, outreachOrganiserApi } = await staffClient([{ status: 200, body: { accepted: true, signedIn: false, facilityId: 'f-1', roleCode: 'outreach_volunteer' } }])
    await outreachOrganiserApi.acceptInvitationByLink(LINK, 'shared')
    expect(sent[0]!.body).toEqual({ ...LINK, device: 'shared', turnstileAction: 'outreach-invitation' })
  })

  it('is never sent again by itself: one request for an outage, and a 404 reaches the page with its code', async () => {
    const down = await staffClient([{ status: 503, body: { status: 503, code: 'UPSTREAM_UNAVAILABLE', detail: 'x' } }])
    await expect(down.outreachOrganiserApi.acceptInvitationByLink(LINK, 'own', 't')).rejects.toMatchObject({ status: 503 })
    expect(down.sent).toHaveLength(1)
    vi.unstubAllGlobals(); vi.resetModules()
    const missing = await staffClient([{ status: 404, body: { status: 404, code: 'API_ROUTE_NOT_FOUND', detail: 'x' } }])
    await expect(missing.outreachOrganiserApi.acceptInvitationByLink(LINK, 'own', 't')).rejects.toMatchObject({ status: 404, code: 'API_ROUTE_NOT_FOUND' })
    expect(missing.sent).toHaveLength(1)
  })
})
