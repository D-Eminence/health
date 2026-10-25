import { describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import type { OrderRouteSummary } from './api'
import {
  acceptRefusal, fillAttestation, routedElsewhere, routeStatusText, sendRefusal, unavailableText, withdrawRefusal,
} from './orderRoutes'

/**
 * What a clinician reads under an order sent to another facility (Novu, P4c, SPEC-FINAL §13.1), by the route's effective
 * state and how it ended, and the refusals' words (§11). The services decide; these only say it.
 */
const route = (overrides: Partial<OrderRouteSummary> = {}): OrderRouteSummary => ({ id: 'r1', reference: '9C1B2D3E',
  kind: 'lab_request', version: 1, effectiveState: 'sent', receivingFacility: { id: 'f1', name: 'Yaba Diagnostics', available: true },
  createdAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptedAt: null, completedAt: null, endedAt: null,
  endedKind: null, declineReason: null, acceptLocked: false, resendAllowed: false, ...overrides })

describe('the line under an order sent to another facility', () => {
  it.each([
    [{}, /^Sent to Yaba Diagnostics: waiting for it to accept, until 27 Oct 2026, 10:00\.$/],
    [{ acceptLocked: true }, /^Yaba Diagnostics could not confirm the patient’s identity, so it can’t accept this\. Withdraw it and send it again or elsewhere\.$/],
    [{ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z' }, /^Accepted by Yaba Diagnostics on 21 Oct 2026\.$/],
    [{ effectiveState: 'completed', completedAt: '2026-10-22T10:00:00.000Z' }, /^Results released by Yaba Diagnostics on 22 Oct 2026\.$/],
    [{ kind: 'prescription', effectiveState: 'completed', completedAt: '2026-10-22T10:00:00.000Z' }, /^Dispensed by Yaba Diagnostics on 22 Oct 2026\.$/],
    [{ effectiveState: 'declined', declineReason: 'cannot_meet_priority' }, /^Declined by Yaba Diagnostics: It can’t be done at this priority\. Send it elsewhere\.$/],
    [{ effectiveState: 'declined', declineReason: 'patient_not_seen' }, /The patient didn’t come/],
    [{ effectiveState: 'withdrawn', endedKind: 'orderer' }, /^Withdrawn\.$/],
    [{ effectiveState: 'withdrawn', endedKind: 'patient' }, /^Ada Patient stopped it in the Health ID app\.$/],
    [{ effectiveState: 'withdrawn', endedKind: 'order_changed' }, /^Withdrawn because the order changed\. Send it again\.$/],
    [{ effectiveState: 'withdrawn', endedKind: 'receiving_released' }, /^Withdrawn: Yaba Diagnostics is no longer on Health ID\.$/],
    [{ effectiveState: 'withdrawn', endedKind: 'support' }, /^Withdrawn by Health ID support\.$/],
    [{ effectiveState: 'withdrawn', endedKind: 'order_in_work' }, /^Withdrawn: this order is already being worked on here\.$/],
    [{ effectiveState: 'expired' }, /^Not accepted by Yaba Diagnostics within 7 days\. Send it elsewhere\.$/],
    [{ effectiveState: 'expired', acceptedAt: '2026-09-01T10:00:00.000Z' }, /^Accepted by Yaba Diagnostics on 1 Sept 2026; nothing came back within 30 days\.$/],
    [{ effectiveState: 'cancelled', endedKind: 'order_changed' }, /^Cancelled at Yaba Diagnostics because the order changed\.$/],
    [{ effectiveState: 'cancelled', endedKind: 'entered_in_error' }, /^Cancelled at Yaba Diagnostics because the order was marked entered in error\.$/],
    [{ effectiveState: 'cancelled', endedKind: 'receiving_released' }, /^Cancelled: Yaba Diagnostics is no longer on Health ID\.$/],
    [{ effectiveState: 'cancelled', endedKind: 'support' }, /^Cancelled at Yaba Diagnostics by Health ID support\.$/],
  ] as Array<[Partial<OrderRouteSummary>, RegExp]>)('says %o', (overrides, says) => {
    expect(routeStatusText(route(overrides), 'Ada Patient').text).toMatch(says)
  })

  it('says when the receiving facility is not available now, only while the route is in force', () => {
    expect(unavailableText(route({ receivingFacility: { id: 'f1', name: 'Yaba Diagnostics', available: false } })))
      .toBe('Yaba Diagnostics is not available on Health ID at the moment.')
    expect(unavailableText(route({ effectiveState: 'declined', receivingFacility: { id: 'f1', name: 'Yaba Diagnostics', available: false } }))).toBeNull()
  })

  it('counts an order as sent elsewhere while its route is in force, or once it was accepted (the EHR’s rule)', () => {
    expect(routedElsewhere(route())).toBe(true)
    expect(routedElsewhere(route({ effectiveState: 'cancelled', acceptedAt: '2026-10-21T10:00:00.000Z' }))).toBe(true)
    expect(routedElsewhere(route({ effectiveState: 'expired' }))).toBe(false)
    expect(routedElsewhere(route({ effectiveState: 'declined' }))).toBe(false)
    expect(routedElsewhere(null)).toBe(false)
  })

  it('fills every name of the attestation', () => {
    expect(fillAttestation('{patient} agreed that {orderingFacility} sends it to {receivingFacility}; {receivingFacility} sees it.',
      { patient: 'Ada Patient', orderingFacility: 'General Hospital', receivingFacility: 'Yaba Diagnostics' }))
      .toBe('Ada Patient agreed that General Hospital sends it to Yaba Diagnostics; Yaba Diagnostics sees it.')
  })
})

describe('the refusals’ words', () => {
  const problem = (status: number, code: string) => new HidApiError(status, 'Refused', { code })

  it('says every send refusal of §11 in words, never its code', () => {
    const codes: Array<[number, string]> = [[409, 'ORDER_ROUTE_DESTINATION_INELIGIBLE'], [409, 'ORDER_ROUTE_ORDER_NOT_ELIGIBLE'],
      [409, 'ORDER_ROUTE_ORDER_IN_WORK'], [409, 'ORDER_ROUTE_ALREADY_SENT'], [409, 'ORDER_ROUTE_RESEND_LIMIT'],
      [409, 'ORDER_ROUTE_DESTINATION_BUSY'], [409, 'ORDER_ROUTE_PATIENT_DENIED'], [409, 'ORDER_ROUTE_PATIENT_APP_REQUIRED'],
      [409, 'ORDER_ROUTE_ATTESTATION_OUTDATED'], [409, 'IDEMPOTENCY_KEY_REUSED'], [412, 'VERSION_CONFLICT'],
      [423, 'CROSS_FACILITY_ORDERS_UNAVAILABLE'], [429, 'ORDER_ROUTE_SEND_LIMIT'], [429, 'ORDER_ROUTE_PAIR_LIMIT'],
      [403, 'PERMISSION_DENIED'], [403, 'CONSENT_REQUIRED'], [404, 'ORDER_NOT_FOUND'], [404, 'NOT_FOUND'], [400, 'ORDER_ROUTE_INVALID'],
      [503, 'UPSTREAM_UNAVAILABLE']]
    const said = new Set<string>()
    for (const [status, code] of codes) {
      const refusal = sendRefusal(problem(status, code), 'lab_request', 'Yaba Diagnostics', 'Ada Patient')
      expect(refusal.text, code).not.toMatch(/[A-Z]{3,}_[A-Z_]+/)
      said.add(refusal.text)
    }
    expect(said.size).toBe(codes.length)
    expect(sendRefusal(problem(409, 'ORDER_ROUTE_ATTESTATION_OUTDATED'), 'lab_request', 'Yaba', 'Ada').outdated).toBe(true)
    expect(sendRefusal(problem(503, 'UPSTREAM_UNAVAILABLE'), 'lab_request', 'Yaba', 'Ada')).toMatchObject({ reload: true,
      text: 'Health ID did not answer, so the order may or may not have been sent. Check the list before sending it again.' })
    expect(sendRefusal(problem(404, 'NOT_FOUND'), 'lab_request', 'Yaba', 'Ada').text).toBe('Sending orders to other facilities is not available yet.')
  })

  it('reloads after a withdrawal refused because it is no longer waiting', () => {
    expect(withdrawRefusal(problem(409, 'ORDER_ROUTE_NOT_PENDING'))).toMatchObject({ reload: true })
    expect(withdrawRefusal(problem(404, 'NOT_FOUND')).text).toBe('Sending orders to other facilities is not available yet.')
  })

  it('counts down the tries left from the problem’s attemptsLeft', () => {
    const mismatch = new HidApiError(409, 'No match', { code: 'ORDER_ROUTE_PATIENT_MISMATCH', attemptsLeft: 1 })
    expect(acceptRefusal(mismatch, 'General Hospital', 'Yaba Diagnostics')).toMatchObject({ field: 'identifier', reload: true,
      text: 'That doesn’t match this order’s patient. 1 try left.' })
    expect(acceptRefusal(problem(409, 'ORDER_ROUTE_PATIENT_MISMATCH'), 'General Hospital', 'Yaba Diagnostics').text)
      .toBe('That doesn’t match this order’s patient. Check it with the patient and try again.')
  })
})
