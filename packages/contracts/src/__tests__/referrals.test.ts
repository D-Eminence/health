import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Referrals between facilities (hid-system REF-1, migrations 0191-0193, Release D; on claude/sprint-referrals-backend,
 * not live), as the blue EHR's Referrals page, the visit, the patient page and the portal call them. Proposed until the
 * backend ships; no Health ID or NIN in any address.
 */
const SEND = '/api/v1/ehr/patients/b0000000-0000-4000-8000-00000000b001/encounters/e0000000-0000-4000-8000-00000000e001/referrals'
const ONE = '/api/v1/ehr/referrals/a0000000-0000-4000-8000-00000000a001'

const STAFF = ['ehr.referralAttestation', 'ehr.referralSend', 'ehr.referralsSent', 'ehr.referralsIncoming', 'ehr.referralsReceived',
  'ehr.referralsExpected', 'ehr.referral', 'ehr.referralWithdraw', 'ehr.referralLetter', 'ehr.referralAccept',
  'ehr.referralDecline', 'ehr.referralArrive', 'ehr.referralComplete', 'ehr.patientReferrals']
const PATIENT = ['ehr.myReferrals', 'ehr.myReferralWithdraw']

describe('referral routes (hid-system REF-1)', () => {
  it('registers every route as proposed, staff routes for the provider portal and the two patient routes for the portal only', () => {
    for (const name of [...STAFF, ...PATIENT]) expect(findEndpoint(name)?.status, name).toBe('proposed')
    for (const name of STAFF) {
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name), name).toThrow(BoundaryViolationError)
    }
    for (const name of PATIENT) {
      expect(() => assertEndpointAllowed('patient-web', name), name).not.toThrow()
      expect(() => assertEndpointAllowed('staff-web', name), name).toThrow(BoundaryViolationError)
      expect(() => assertEndpointAllowed('admin-web', name), name).toThrow(BoundaryViolationError)
    }
  })

  it('names the backend codes of each route', () => {
    expect(findEndpoint('ehr.referralSend')?.permissions).toEqual({ POST: ['ehr.referral.send', 'ehr.encounter.write'] })
    expect(findEndpoint('ehr.referralsIncoming')?.permissions).toEqual({ GET: ['ehr.referral.receive'] })
    expect(findEndpoint('ehr.referralsExpected')?.permissions).toEqual({ GET: ['ehr.referral.arrive'] })
    expect(findEndpoint('ehr.referralArrive')?.permissions).toEqual({ POST: ['ehr.referral.arrive', 'ehr.encounter.read', 'ehr.encounter.write'] })
    // One referral is read with either side's code: the registry lists required codes only.
    expect(findEndpoint('ehr.referral')?.permissions).toBeUndefined()
  })

  it('tells each list and action from one referral', () => {
    expect(assertRegisteredBrowserRequest('POST', SEND).name).toBe('ehr.referralSend')
    for (const [path, name] of [['sent', 'ehr.referralsSent'], ['incoming', 'ehr.referralsIncoming'], ['received', 'ehr.referralsReceived'],
      ['expected', 'ehr.referralsExpected']] as const) {
      expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/referrals/${path}`).name).toBe(name)
    }
    expect(assertRegisteredBrowserRequest('GET', ONE).name).toBe('ehr.referral')
    expect(assertRegisteredBrowserRequest('GET', `${ONE}/letter`).name).toBe('ehr.referralLetter')
    for (const action of ['withdraw', 'accept', 'decline', 'arrive', 'complete']) {
      expect(assertRegisteredBrowserRequest('POST', `${ONE}/${action}`).name).toBe(`ehr.referral${action[0]!.toUpperCase()}${action.slice(1)}`)
    }
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/referral-attestation', { destinationKind: 'printed' }).name).toBe('ehr.referralAttestation')
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/referral-attestation')).toThrow(BrowserRouteError)
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/me/referrals').name).toBe('ehr.myReferrals')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/me/referrals/a0000000-0000-4000-8000-00000000a001/withdraw').name)
      .toBe('ehr.myReferralWithdraw')
    // The directory's kind=referral is the order-destination route's own.
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/order-destinations', { kind: 'referral', query: 'Teaching' }).name)
      .toBe('identity.orderDestinations')
    // Writes are never GETs, and one referral is never written by a POST to its own address.
    expect(() => assertRegisteredBrowserRequest('GET', `${ONE}/accept`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('POST', ONE)).toThrow(BrowserRouteError)
  })

  it('refuses a Health ID or NIN in the address of a referral list, without repeating it', () => {
    for (const path of ['sent', 'incoming', 'received', 'expected']) {
      for (const query of [{ healthId: 'HID-7KQ2M9' }, { nin: '12345678901' }, { state: 'sent', 'healthId[]': 'HID-7KQ2M9' }]) {
        let caught: unknown
        try { assertRegisteredBrowserRequest('GET', `/api/v1/ehr/referrals/${path}`, query) } catch (error) { caught = error }
        expect(caught, path).toMatchObject({ code: 'FORBIDDEN_QUERY' })
        expect((caught as Error).message).not.toMatch(/HID-7KQ2M9|12345678901/)
      }
    }
  })
})
