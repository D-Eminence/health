import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { HID_ENDPOINTS, findEndpoint } from '../registry'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'

/**
 * Step 8 (hid-system 0118, switched off until legal signs off): the patient sends their card by email, and whoever has
 * the link opens it with a one-time code emailed to the same address. The patient's three routes stay under
 * identity/me; everything the person who received it calls is under one gateway prefix, /api/v1/card-share/, so the
 * view cookie can be scoped to it (critique fix 2). The link's secret is never in a path: it goes in POST bodies only.
 */
const PATIENT = [
  ['identity.myCardShares', 'GET', '/api/v1/identity/me/card-shares'],
  ['identity.myCardShares', 'POST', '/api/v1/identity/me/card-shares'],
  ['identity.myCardShareEnd', 'POST', '/api/v1/identity/me/card-shares/3f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f/end'],
] as const

const RECEIVER = [
  ['identity.cardShareAvailability', 'GET', '/api/v1/card-share/availability', 'identity'],
  ['identity.cardShareCode', 'POST', '/api/v1/card-share/code', 'identity'],
  ['identity.cardShareVerify', 'POST', '/api/v1/card-share/verify', 'identity'],
  ['identity.cardShareView', 'GET', '/api/v1/card-share/view', 'identity'],
  ['identity.cardShareEndView', 'POST', '/api/v1/card-share/end-view', 'identity'],
  ['identity.cardShareStop', 'POST', '/api/v1/card-share/stop', 'identity'],
  ['ehr.cardShareRecords', 'GET', '/api/v1/card-share/records', 'ehr'],
] as const

describe('sending the card by email, for the patient', () => {
  it.each(PATIENT)('%s %s is proposed, for a signed-in patient, and matched by its path', (name, method, path) => {
    expect(findEndpoint(name)).toMatchObject({ service: 'identity', status: 'proposed', auth: { kind: 'authenticated' } })
    expect(assertRegisteredBrowserRequest(method, path).name).toBe(name)
  })

  it('says the routes answer 404 NOT_FOUND while switched off, and what the patient sends', () => {
    const note = findEndpoint('identity.myCardShares')?.note ?? ''
    expect(note).toContain('hid-system 0118')
    expect(note).toContain('404 NOT_FOUND while off')
    expect(note).toContain('Idempotency-Key')
    expect(note).toMatch(/scope: card \| card_and_records/)
    expect(note).toMatch(/duration: 24h \| 7d/)
    // The body the backend's CreateCardShareDto allows, and nothing more (review F1): it refuses unknown fields.
    expect(note).toContain('{ email, label?, scope: card | card_and_records, duration: 24h | 7d }')
    expect(note).not.toContain('consentVersion')
  })
})

describe('opening a card sent by email, for whoever has the link', () => {
  it.each(RECEIVER)('%s %s is proposed, public, and under the one card-share prefix', (name, method, path, service) => {
    expect(findEndpoint(name)).toMatchObject({ service, status: 'proposed', auth: { kind: 'public' } })
    expect(findEndpoint(name)?.path.startsWith('/api/v1/card-share/')).toBe(true)
    expect(assertRegisteredBrowserRequest(method, path).name).toBe(name)
  })

  it('has no photo route: the backend shares no photo (review F5)', () => {
    expect(findEndpoint('identity.cardSharePhoto')).toBeUndefined()
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/card-share/photo', undefined, 'download')).toThrow(BrowserRouteError)
    expect(findEndpoint('identity.cardShareVerify')?.note).toContain('sharedByFirstName')
    expect(findEndpoint('identity.cardShareVerify')?.note).not.toContain('hasPhoto')
  })

  it('stops the emails with the separate stop token at POST stop, and the old stop-emails route is gone (review F2)', () => {
    const note = findEndpoint('identity.cardShareStop')?.note ?? ''
    expect(note).toContain('{ stopToken }')
    expect(note).toContain('204')
    expect(note.toLowerCase()).not.toContain('turnstile')
    expect(findEndpoint('identity.cardShareStopEmails')).toBeUndefined()
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/card-share/stop-emails')).toThrow(BrowserRouteError)
  })

  it('names the records answer\'s health fields as ehr-api sends them (review F3)', () => {
    expect(findEndpoint('ehr.cardShareRecords')?.note).toContain('{ bloodGroup, genotype, allergies, chronicConditions, medications, notes }')
  })

  it('says a right code from another browser counts as wrong, and the wait is in the body (review F6)', () => {
    const verify = findEndpoint('identity.cardShareVerify')?.note ?? ''
    expect(verify).toContain('another browser counts as wrong')
    expect(findEndpoint('identity.cardShareCode')?.note).toContain('CARD_SHARE_CODE_LIMITED { retryAfterSeconds }')
  })

  it('never takes the link\'s secret in a path, and no card-share path has a parameter', () => {
    for (const endpoint of HID_ENDPOINTS.filter(item => item.path.startsWith('/api/v1/card-share/'))) {
      expect(endpoint.path, endpoint.name).not.toContain(':')
    }
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/card-share/view/abc')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/shared-cards/k3Jx9QpLm2Vt7RwYz5NcBd8FgHs4Ae6U')).toThrow(BrowserRouteError)
  })

  it('retires the old open read that carried the secret in its path', () => {
    expect(findEndpoint('identity.sharedCard')).toBeUndefined()
  })

  it('says one view per link (X-Card-View), no 401, and the same answer for unknown and ended links', () => {
    const verify = findEndpoint('identity.cardShareVerify')?.note ?? ''
    expect(verify).toContain('viewId')
    expect(findEndpoint('identity.cardShareView')?.note).toContain('X-Card-View')
    expect(findEndpoint('identity.cardShareView')?.note).toContain('409 CARD_SHARE_VIEW_CHANGED')
    expect(findEndpoint('ehr.cardShareRecords')?.note).toContain('X-Card-View')
    expect(findEndpoint('identity.cardShareCode')?.note).toContain('410 CARD_SHARE_ENDED')
    expect(findEndpoint('identity.cardShareCode')?.note).toContain('card-share-code')
    for (const name of RECEIVER.map(([name]) => name)) expect(findEndpoint(name)?.note, name).toContain('never 401')
  })
})

describe('who may call them', () => {
  const names = [...new Set([...PATIENT.map(([name]) => name), ...RECEIVER.map(([name]) => name)])]

  it('is the patient portal alone', () => {
    for (const name of names) {
      expect(() => assertEndpointAllowed('patient-web', name), name).not.toThrow()
      for (const app of ['staff-web', 'admin-web', 'public-web'] as const) {
        expect(() => assertEndpointAllowed(app, name), `${app}: ${name}`).toThrow(BoundaryViolationError)
      }
    }
  })
})
