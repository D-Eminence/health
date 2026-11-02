import { describe, expect, it, vi } from 'vitest'
import { auditRow } from '../audit/auditRow'
import { facilityAuditPageFrom, isRequestLogEvent, type FacilityAuditPage } from './api'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

/**
 * The facility audit read leaves the request log out (owner, 2026-11-01): the events whose action starts 'api.' (an HTTP
 * method and route, "api.get./api/v1/…", or a route's own name), which sit beside the action each request carried out.
 * The blue Audit & Compliance page and today's facility audit page both read through staffApi.facilityAudit, which
 * returns facilityAuditPageFrom of the server's page, so neither shows a route. The resource "http-request" alone does
 * not hide an event (owner decision, docs/AUDIT_ACTION_LABELS.md note 8(i)): the security refusals carry it too, and a
 * facility sees them.
 */
const event = (sequenceId: string, action: string, resourceType: string | null) => ({
  sequenceId, occurredAt: '2026-11-01T03:21:00.868Z', correlationId: `hid_web_${sequenceId}`, actorType: 'staff',
  action, outcome: 'success' as const, resourceType,
})

describe('the facility audit read', () => {
  it('names request-log events by their action alone, never by their resource', () => {
    expect(isRequestLogEvent({ action: 'api.get./api/v1/ehr/patients/:patientId/encounters', resourceType: 'http-request' })).toBe(true)
    expect(isRequestLogEvent({ action: 'api.post./api/v1/identity/standard-access/pin', resourceType: null })).toBe(true)
    expect(isRequestLogEvent({ action: 'api.identity.authorization.check.request', resourceType: 'http-request' })).toBe(true)
    // The security refusals are written with resource "http-request" too: they are refusals, not the request log.
    expect(isRequestLogEvent({ action: 'security.authorization', resourceType: 'http-request' })).toBe(false)
    expect(isRequestLogEvent({ action: 'security.authorization.denied', resourceType: 'http-request' })).toBe(false)
    expect(isRequestLogEvent({ action: 'ehr.encounter.list', resourceType: 'encounter' })).toBe(false)
    expect(isRequestLogEvent({ action: 'identity.authorization.check', resourceType: 'patient' })).toBe(false)
    expect(isRequestLogEvent({ action: 'auth.session.read', resourceType: null })).toBe(false)
  })

  it('returns the page without its request-log events, keeping the rest, their seven fields and the cursor', () => {
    const server = {
      items: [
        event('6', 'api.get./api/v1/ehr/patients/:patientId/encounters', 'http-request'),
        event('5', 'ehr.encounter.list', 'encounter'),
        event('4', 'api.get./api/v1/identity/service/patients/:patientId/record-read-authorization', 'http-request'),
        event('3', 'identity.authorization.check', 'patient'),
        { ...event('2', 'auth.session.read', 'session'), patientId: 'patient-secret', details: { note: 'withheld' } },
      ],
      nextBeforeSequenceId: '2',
    } as FacilityAuditPage

    const page = facilityAuditPageFrom(server)

    expect(page.items.map(item => item.action)).toEqual(['ehr.encounter.list', 'identity.authorization.check', 'auth.session.read'])
    expect(page.items.some(item => item.action.includes('/api/'))).toBe(false)
    expect(Object.keys(page.items[2] ?? {}).sort()).toEqual(
      ['action', 'actorType', 'correlationId', 'occurredAt', 'outcome', 'resourceType', 'sequenceId'])
    expect(page.nextBeforeSequenceId).toBe('2')
  })

  it('keeps a refused access check, which the page then words as a plain sentence beside Refused', () => {
    const page = facilityAuditPageFrom({
      items: [
        event('8', 'api.get./api/v1/ehr/patients/:patientId/encounters', 'http-request'),
        { ...event('7', 'security.authorization.denied', 'http-request'), outcome: 'denied' },
        // Identity's refusal is written as it happens; its label carries the refusal.
        event('6', 'security.authorization', 'http-request'),
      ],
      nextBeforeSequenceId: '6',
    })

    expect(page.items.map(item => item.action)).toEqual(['security.authorization.denied', 'security.authorization'])
    for (const item of page.items) {
      const row = auditRow(item)
      expect(row).toEqual({ what: 'Their role here does not allow this action', who: 'Staff member', outcome: 'denied', outcomeText: 'Refused' })
      expect(`${row?.what} ${row?.who}`).not.toMatch(/security|authorization|http-request/i)
    }
  })

  it('keeps the cursor when a whole page was request log, so older events can still be read', () => {
    const page = facilityAuditPageFrom({ items: [event('9', 'api.get./api/v1/audit/events', 'http-request')], nextBeforeSequenceId: '9' })
    expect(page).toEqual({ items: [], nextBeforeSequenceId: '9' })
  })
})
