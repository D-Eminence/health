import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { OrderRouteSummary, WorkItemOrderRoute } from './api'
import {
  acceptedCheckText, acceptRefusal, correctableFindRefusal, correctableRoutes, fillAttestation, forgetReceiving, handOverCheckText,
  holdsReceivePermission, lagosDay, lateCorrectionLines, lateEndedText, lateWrongPatientRefusal, RECEIVING_MEMORY_MS,
  receivingAnswer, receivingHere, rememberedReceiving, rememberReceiving, returnedDays, routeClosedForWork, routedChangeWarning,
  routedElsewhere, routedWorkEndedText, routeStatusText, sampleCheckText, sendRefusal, unavailableText,
  withdrawRefusal, WRONG_PATIENT_REASONS, wrongPatientEndedLines, wrongPatientNotice, wrongPatientOffered, wrongPatientRefusal,
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

  it('marks a send that got no answer, which may have gone through, apart from every refusal', () => {
    for (const error of [problem(503, 'UPSTREAM_UNAVAILABLE'), problem(500, 'INTERNAL'), problem(408, 'REQUEST_TIMEOUT'),
      problem(0, 'NETWORK_ERROR'), problem(502, 'ORDER_ROUTE_UNAVAILABLE')]) {
      expect(sendRefusal(error, 'lab_request', 'Yaba', 'Ada').unanswered, error.code).toBe(true)
    }
    for (const error of [problem(409, 'ORDER_ROUTE_DESTINATION_INELIGIBLE'), problem(423, 'CROSS_FACILITY_ORDERS_UNAVAILABLE'),
      problem(412, 'VERSION_CONFLICT'), problem(400, 'ORDER_ROUTE_INVALID'), problem(403, 'PERMISSION_DENIED'), new Error('Read the record again.')]) {
      expect(sendRefusal(error, 'lab_request', 'Yaba', 'Ada').unanswered).toBeUndefined()
    }
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

  it('asks for the reference after a date of birth alone, which does not count down this order’s tries (P4c review)', () => {
    const mismatch = new HidApiError(409, 'No match', { code: 'ORDER_ROUTE_PATIENT_MISMATCH', attemptsLeft: 5 })
    const refusal = acceptRefusal(mismatch, 'General Hospital', 'Yaba Diagnostics', false)
    expect(refusal).toMatchObject({ field: 'identifier', reload: true })
    expect(refusal.text).toMatch(/ask for the reference shown with it in their Health ID app/)
    expect(refusal.text).not.toMatch(/tries? left/)
  })

  it('says another order’s reference is not this one’s, on the reference, without reloading', () => {
    const refusal = acceptRefusal(problem(409, 'ORDER_ROUTE_REFERENCE_MISMATCH'), 'General Hospital', 'Yaba Diagnostics', true)
    expect(refusal).toEqual({ field: 'reference',
      text: 'That reference is not this order’s. Check that you picked the patient’s own order: their Health ID app shows its reference.' })
    expect(acceptRefusal(problem(400, 'ORDER_ROUTE_INVALID'), 'General Hospital', 'Yaba Diagnostics').text)
      .toMatch(/a reference has 8 characters\.$/)
  })
})

/**
 * Item 3 (owner decisions D2-D19; SPEC-FINAL §9.1, §9.2): what everyone reads of an order the receiving laboratory or
 * pharmacy ended as accepted for someone who was not the patient, and what each refusal of that report means.
 */
describe('an order ended as accepted for the wrong person', () => {
  const problem = (status: number, code: string) => new HidApiError(status, 'Refused', { code })
  it.each([
    [{ effectiveState: 'cancelled', endedKind: 'wrong_patient', acceptedAt: '2026-10-21T10:00:00.000Z', endedAt: '2026-10-21T11:00:00.000Z' },
      'Yaba Diagnostics reports that it accepted this for someone who was not Ada Patient, and has ended it. Nothing came back from it.'],
    [{ kind: 'prescription', effectiveState: 'cancelled', endedKind: 'wrong_patient', endedAt: '2026-10-21T11:00:00.000Z' },
      'Yaba Diagnostics reports that it accepted this for someone who was not Ada Patient, and has ended it. Nothing came back from it.'],
    [{ effectiveState: 'completed', endedKind: 'wrong_patient', completedAt: '2026-10-22T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z' },
      'Yaba Diagnostics reports that the results it released belong to someone else, and has ended it. Do not use them.'],
    [{ kind: 'prescription', effectiveState: 'completed', endedKind: 'wrong_patient', completedAt: '2026-10-22T10:00:00.000Z',
      endedAt: '2026-10-23T10:00:00.000Z' },
    'Yaba Diagnostics reports that it dispensed this to someone who was not Ada Patient, and has ended it.'],
  ] as Array<[Partial<OrderRouteSummary>, string]>)('says what the receiving facility reports, as its report: %o', (overrides, says) => {
    const status = routeStatusText(route(overrides), 'Ada Patient')
    expect(status).toEqual({ tone: 'warning', text: says })
  })

  it('leaves the other ended kinds of a completed order as they were', () => {
    expect(routeStatusText(route({ effectiveState: 'completed', endedKind: 'support', completedAt: '2026-10-22T10:00:00.000Z' }), 'Ada Patient'))
      .toEqual({ tone: 'success', text: 'Results released by Yaba Diagnostics on 22 Oct 2026.' })
  })

  it('says in red that the order can’t be sent again, and, once something came back, what to do', () => {
    expect(wrongPatientNotice(route({ effectiveState: 'cancelled', endedKind: 'wrong_patient' }), 'Ada Patient'))
      .toEqual(['This order can’t be sent again. Write a new lab request if Ada Patient still needs it.'])
    expect(wrongPatientNotice(route({ effectiveState: 'completed', endedKind: 'wrong_patient' }), 'Ada Patient')).toEqual([
      'This order can’t be sent again. Write a new lab request if Ada Patient still needs it.',
      'Do not use any result from Yaba Diagnostics on this order: Yaba Diagnostics reports they are another person’s. Ada Patient '
        + 'has not been tested: repeat the test if it is still needed. If you acted on a result, review Ada Patient’s care. Tell '
        + 'Ada Patient that a result they may have seen was not theirs.'])
    expect(wrongPatientNotice(route({ kind: 'prescription', effectiveState: 'completed', endedKind: 'wrong_patient' }), 'Ada Patient')).toEqual([
      'This order can’t be sent again. Write a new prescription if Ada Patient still needs it.',
      'Yaba Diagnostics reports that Ada Patient did not receive this medicine from it. Check with Ada Patient before you prescribe '
        + 'it again, especially a controlled medicine.'])
  })

  it('asks the clinician to have it ended at the receiver first while the receiver may still work on it (C1)', () => {
    const change = 'Changing it withdraws it from Yaba Diagnostics, or cancels it there if Yaba Diagnostics has accepted it; a '
      + 'cancelled order can’t be resumed there.'
    const first = ' If Yaba Diagnostics accepted it for someone who was not Ada Patient, ask Yaba Diagnostics to end it from its '
      + 'work list first: once you change this order, Yaba Diagnostics can no longer withdraw a result or dispensing it sent back.'
    expect(routedChangeWarning(route({ effectiveState: 'accepted' }), 'Ada Patient', true)).toBe(change + first)
    expect(routedChangeWarning(route({ effectiveState: 'completed' }), 'Ada Patient', true)).toBe(change + first)
    // Not while it waits, nor once it ended (support, the window, or this report): the receiver can no longer withdraw.
    expect(routedChangeWarning(route(), 'Ada Patient', true)).toBe(change)
    expect(routedChangeWarning(route({ effectiveState: 'completed', endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'support' }), 'Ada Patient', true)).toBe(change)
    expect(routedChangeWarning(route({ effectiveState: 'cancelled', endedKind: 'wrong_patient' }), 'Ada Patient', true)).toBe(change)
    expect(routedChangeWarning(null, 'Ada Patient', true)).toBe('Changing it withdraws it from the other facility, or cancels it there if '
      + 'the other facility has accepted it; a cancelled order can’t be resumed there.')
  })

  it('keeps the earlier change warning until the backend lets the receiver end an order (D15)', () => {
    // Today's backend: the receiver can't end it, so the clinician is not sent to it, and changing the order stays the way
    // to stop it there.
    const change = 'Changing it withdraws it from Yaba Diagnostics, or cancels it there if Yaba Diagnostics has accepted it; a '
      + 'cancelled order can’t be resumed there.'
    expect(routedChangeWarning(route({ effectiveState: 'accepted' }), 'Ada Patient')).toBe(change)
    expect(routedChangeWarning(route({ effectiveState: 'completed' }), 'Ada Patient', false)).toBe(change)
  })

  it('says each refusal of the report in the receiver’s words, and when to read the order again', () => {
    const say = (error: unknown, service: 'lab' | 'pharmacy' = 'lab') => wrongPatientRefusal(error, service, 'General Hospital')
    expect(say(problem(409, 'ORDER_ROUTE_ALREADY_ENDED'))).toEqual({ reload: true, text: 'This order has already ended, so it can’t '
      + 'be ended here. If a result or dispensing had gone back, phone General Hospital and tell Health ID support.' })
    expect(say(problem(409, 'ORDER_ROUTE_NOT_ACCEPTED'))).toEqual({ reload: true,
      text: 'This order hasn’t been accepted, so there is nothing to end: decline it instead.' })
    expect(say(problem(412, 'VERSION_CONFLICT'))).toEqual({ stale: true,
      text: 'Something was recorded on this order a moment ago. It has been reloaded: check what will happen and try again.' })
    expect(say(problem(409, 'ORDER_ROUTE_CHANGED_CONCURRENTLY'))).toEqual({ text: 'Someone changed this order at the same moment. Try again.' })
    expect(say(problem(403, 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED')).text).toBe('Results were recorded on this order, and '
      + 'your role can’t mark results entered in error. Ask a laboratory scientist to end it.')
    expect(say(problem(403, 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED'), 'pharmacy').text).toBe('A dispensing was recorded on '
      + 'this order, and your role can’t reverse dispensings. Ask a pharmacist to end it.')
    expect(say(problem(403, 'PERMISSION_DENIED')).text).toBe('Your role can’t end orders from other facilities.')
    expect(say(problem(423, 'CROSS_FACILITY_ORDERS_UNAVAILABLE')).text).toBe('Health ID has paused work on orders from other '
      + 'facilities, so this can’t be done now. Try again when it resumes, and tell Health ID support now. Don’t ask support to '
      + 'close the order: closing it stops you withdrawing anything you sent back.')
    expect(say(problem(404, 'ORDER_ROUTE_NOT_FOUND'))).toEqual({ reload: true, text: 'This order was not found here. Refresh the list.' })
    expect(say(problem(404, 'API_ROUTE_NOT_FOUND'))).toEqual({ text: 'Ending an order for the wrong person isn’t available yet. '
      + 'Tell Health ID support, and phone General Hospital.' })
    expect(say(problem(404, 'NOT_FOUND')).text).toMatch(/^Ending an order for the wrong person isn’t available yet\./)
    expect(say(problem(409, 'IDEMPOTENCY_KEY_REUSED'))).toMatchObject({ reload: true })
    expect(say(problem(400, 'ORDER_ROUTE_INVALID')).text).toMatch(/^Check what you entered/)
    expect(say(problem(503, 'ORDER_ROUTE_UNAVAILABLE'))).toEqual({ reload: true, unanswered: true,
      text: 'Health ID did not answer, so it may or may not have ended. Refresh the list and check.' })
    expect(say(new TypeError('Failed to fetch'))).toEqual({ text: 'Failed to fetch' })
  })

  it('offers the report on a work row only while the order may be worked, from a backend that sends its version', () => {
    const card = (overrides: Partial<WorkItemOrderRoute> = {}): WorkItemOrderRoute => ({ id: 'r1', reference: '9C1B2D3E',
      effectiveState: 'accepted', access: 'work', orderingFacilityName: 'General Hospital', ordererName: 'Dr Ade Okon', version: 3,
      endedKind: null, ...overrides })
    const receiver = ['lab.work-item.read', 'lab.order-route.receive']
    expect(wrongPatientOffered(card(), receiver, 'lab')).toBe(true)
    expect(wrongPatientOffered(card({ effectiveState: 'completed' }), receiver, 'lab')).toBe(true)
    // An older backend's card has no version (B9: a string version is not a number either).
    const { version: _version, endedKind: _ended, ...old } = card()
    expect(wrongPatientOffered(old, receiver, 'lab')).toBe(false)
    expect(wrongPatientOffered(card({ version: '3' as unknown as number }), receiver, 'lab')).toBe(false)
    expect(wrongPatientOffered(card({ access: 'read' }), receiver, 'lab')).toBe(false)
    expect(wrongPatientOffered(card({ access: 'none' }), receiver, 'lab')).toBe(false)
    expect(wrongPatientOffered(card({ endedKind: 'wrong_patient' }), receiver, 'lab')).toBe(false)
    expect(wrongPatientOffered(card(), ['lab.work-item.read'], 'lab')).toBe(false)
    expect(wrongPatientOffered(card(), receiver, 'pharmacy')).toBe(false)
    expect(wrongPatientOffered(undefined, receiver, 'lab')).toBe(false)
  })

  it('hides a work row’s writes only where the services would refuse them as closed (B3)', () => {
    expect(routeClosedForWork({ effectiveState: 'cancelled', endedKind: 'order_changed' })).toBe(true)
    expect(routeClosedForWork({ effectiveState: 'expired' })).toBe(true)
    expect(routeClosedForWork({ effectiveState: 'completed', endedKind: 'wrong_patient' })).toBe(true)
    expect(routeClosedForWork({ effectiveState: 'completed', endedKind: 'support' })).toBe(false)
    expect(routeClosedForWork({ effectiveState: 'accepted', endedKind: null })).toBe(false)
    expect(routeClosedForWork(undefined)).toBe(false)
  })

  it('says on a work row who ended the order, by how it ended, never blaming the ordering facility for another’s end', () => {
    const line = (effectiveState: string, endedKind?: string | null) => routedWorkEndedText({ effectiveState, endedKind,
      orderingFacilityName: 'General Hospital' })
    expect(line('cancelled', 'wrong_patient')).toBe('You ended this order: it was accepted for someone who is not its patient. '
      + 'Nothing more can be recorded on it.')
    expect(line('completed', 'wrong_patient')).toMatch(/^You ended this order/)
    expect(line('cancelled', 'support')).toBe('Closed by Health ID support: stop work.')
    expect(line('cancelled', 'order_changed')).toBe('Cancelled by General Hospital: stop work.')
    expect(line('cancelled', 'entered_in_error')).toBe('Cancelled by General Hospital: stop work.')
    expect(line('cancelled', 'receiving_released')).toBe('General Hospital or this facility is no longer on Health ID: stop work.')
    expect(line('cancelled')).toBe('This order was cancelled: stop work.')
    expect(line('accepted', null)).toBeNull()
    expect(line('expired', null)).toBeNull()
  })

  it('asks the receiver to check the person against the patient before any work (C8)', () => {
    expect(acceptedCheckText({ fullName: 'Tunde Bello', dateOfBirth: '1985-03-12' }, true)).toBe('Check that the person in front of you '
      + 'is Tunde Bello, born 12 Mar 1985, before you take a sample or hand over any medicine. If they are not, end this order now.')
    // Until the backend lets the receiver end it (D15), the check stays, without sending them to an action nobody has.
    expect(acceptedCheckText({ fullName: 'Tunde Bello', dateOfBirth: '1985-03-12' })).toBe('Check that the person in front of you '
      + 'is Tunde Bello, born 12 Mar 1985, before you take a sample or hand over any medicine.')
    expect(acceptedCheckText(undefined)).toMatch(/^Check that the person in front of you is the order’s patient, named in the work list below,/)
    expect(sampleCheckText('Tunde Bello')).toBe('Check that the person is Tunde Bello before you take a sample.')
    expect(handOverCheckText('Tunde Bello')).toBe('Check that the person is Tunde Bello, or is collecting for them, before you hand anything over.')
  })

  it('tells the receiver to phone the ordering facility, and what to do with the specimen or medicine', () => {
    expect(wrongPatientEndedLines({ service: 'lab', title: 'Haemoglobin', reference: '9C1B2D3E', patient: 'Tunde Bello',
      ordering: 'General Hospital', returned: true, dateOfBirthOnly: true })).toEqual([
      'Ended: Haemoglobin, reference 9C1B2D3E. Tunde Bello is told in the Health ID app.',
      'Health ID shows this to General Hospital on the order but does not alert them. Phone General Hospital now: a result had '
        + 'already gone back to them.',
      'Set aside any specimen taken for it, following your laboratory’s procedure: it is not Tunde Bello’s.',
      'If any value was critical, tell the person or their clinician directly, following your laboratory’s procedure.',
      'The test can’t be reported to the other person through this order. If they have their own order, find it under Incoming '
        + 'with their Health ID.',
      'Next time, ask for the order’s reference with the date of birth: it shows in the patient’s Health ID app.',
      'This order leaves your work list when it refreshes.'])
    expect(wrongPatientEndedLines({ service: 'pharmacy', title: 'Amoxicillin', reference: null, patient: null,
      ordering: 'General Hospital', returned: false })).toEqual([
      'Ended: Amoxicillin. The patient is told in the Health ID app.',
      'Health ID shows this to General Hospital on the order but does not alert them. Phone General Hospital if the medicine is '
        + 'urgent, so they can send a new order.',
      'If medicine was handed over, try to get it back and follow your pharmacy’s incident procedure.',
      'If the person may have taken it, advise them to get medical advice.',
      'If they have their own prescription, find it under Incoming with their Health ID.',
      'This order leaves your work list when it refreshes.'])
  })

  it('names the four reasons the receiver chooses from, with "another reason" as the person not being the patient (D18)', () => {
    expect(WRONG_PATIENT_REASONS.map(item => [item.value, item.label])).toEqual([
      ['wrong_order_chosen', 'I picked another patient’s order from the list'],
      ['someone_elses_details', 'The person gave someone else’s Health ID or date of birth'],
      ['suspected_misuse', 'I think the person was pretending to be the patient'],
      ['other', 'The person was not the patient for another reason']])
  })
})

/**
 * Whether the working facility receives this service's orders from other facilities (item 4, hid-system 0089): the
 * backend's `receives` decides once the member's own receive permission is checked, and without it the session's facility
 * type, as before. What an answer said is remembered for 10 minutes per membership, facility and service (D3).
 */
describe('whether this facility receives orders from other facilities (item 4)', () => {
  const RECEIVER = ['lab.work-item.read', 'lab.order-route.receive', 'pharmacy.order-route.receive']
  const at = (selfService?: { review: string; organizationType: string }, permissions = RECEIVER) =>
    ({ permissions, ...(selfService ? { selfService } : {}) })
  const facility = { id: 'facility-1', membershipId: 'member-1' }
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1'); forgetReceiving() })
  afterEach(() => { vi.unstubAllEnvs(); forgetReceiving() })

  it('takes the backend’s receives once the member holds the receive permission, over the session’s type', () => {
    for (const selfService of [undefined, { review: 'reviewed', organizationType: 'laboratory' },
      { review: 'reviewed', organizationType: 'hospital' }, { review: 'pending', organizationType: 'laboratory' }]) {
      expect(receivingHere(at(selfService), 'lab', true)).toBe('yes')
      expect(receivingHere(at(selfService), 'lab', false)).toBe('no')
    }
  })

  it('answers no to a member without the receive permission, and on a main-v1 build, whatever receives says', () => {
    expect(receivingHere(at(undefined, ['lab.work-item.read']), 'lab', true)).toBe('no')
    expect(receivingHere(at(undefined, ['lab.order-route.receive']), 'pharmacy', true)).toBe('no')
    expect(holdsReceivePermission(at(undefined, ['lab.work-item.read']), 'lab')).toBe(false)
    expect(receivingHere(null, 'lab', true)).toBe('no')
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    expect(receivingHere(at(), 'lab', true)).toBe('no')
    expect(holdsReceivePermission(at(), 'lab')).toBe(false)
  })

  it('without receives, goes by the session as before', () => {
    expect(receivingHere(at({ review: 'reviewed', organizationType: 'laboratory' }), 'lab')).toBe('yes')
    expect(receivingHere(at({ review: 'reviewed', organizationType: 'laboratory' }), 'pharmacy')).toBe('no')
    expect(receivingHere(at({ review: 'pending', organizationType: 'laboratory' }), 'lab')).toBe('no')
    expect(receivingHere(at({ review: 'reviewed', organizationType: 'hospital' }), 'lab')).toBe('no')
    expect(receivingHere(at(), 'lab')).toBe('unknown')
    expect(receivingHere(at(), 'lab', undefined)).toBe('unknown')
  })

  it('reads receives and routesHere only in the right shape, and never makes one up', () => {
    expect(receivingAnswer({ items: [], receives: true, routesHere: { waiting: false, held: true } }))
      .toEqual({ receives: true, routesHere: { waiting: false, held: true } })
    expect(receivingAnswer({ items: [], receives: false })).toEqual({ receives: false })
    expect(receivingAnswer({ items: [], routesHere: { waiting: true, held: false, extra: 1 } })).toEqual({ routesHere: { waiting: true, held: false } })
    expect(receivingAnswer({ items: [], receives: 'true', routesHere: { waiting: 'yes', held: true } })).toBeNull()
    expect(receivingAnswer({ items: [], receives: null, routesHere: [true, true] })).toBeNull()
    expect(receivingAnswer({ items: [], crossFacilityOrders: true, crossFacilityWork: true })).toBeNull()
    expect(receivingAnswer(null)).toBeNull()
    expect(receivingAnswer('receives')).toBeNull()
  })

  it('remembers what an answer said for 10 minutes, per membership, facility and service', () => {
    const now = Date.parse('2026-10-26T09:00:00.000Z')
    rememberReceiving(facility, 'lab', { items: [], receives: false, routesHere: { waiting: true, held: false } }, now)
    expect(rememberedReceiving(facility, 'lab', now)).toEqual({ receives: false, routesHere: { waiting: true, held: false } })
    expect(rememberedReceiving(facility, 'lab', now + RECEIVING_MEMORY_MS - 1)).toEqual({ receives: false,
      routesHere: { waiting: true, held: false } })
    // Another sign-in in the tab, another facility, the other service: nothing.
    expect(rememberedReceiving({ ...facility, membershipId: 'member-2' }, 'lab', now)).toBeNull()
    expect(rememberedReceiving({ ...facility, id: 'facility-2' }, 'lab', now)).toBeNull()
    expect(rememberedReceiving(facility, 'pharmacy', now)).toBeNull()
    expect(rememberedReceiving(null, 'lab', now)).toBeNull()
    // An answer that says neither changes nothing; one that says something replaces what was remembered.
    rememberReceiving(facility, 'lab', { items: [], crossFacilityOrders: true }, now + 1000)
    expect(rememberedReceiving(facility, 'lab', now + 2000)?.receives).toBe(false)
    rememberReceiving(facility, 'lab', { items: [], receives: true }, now + 3000)
    expect(rememberedReceiving(facility, 'lab', now + 4000)).toEqual({ receives: true })
    // Ten minutes after it was said, it is forgotten.
    expect(rememberedReceiving(facility, 'lab', now + 3000 + RECEIVING_MEMORY_MS)).toBeNull()
    expect(rememberedReceiving(facility, 'lab', now + 4000)).toBeNull()
    expect(RECEIVING_MEMORY_MS).toBe(600_000)
  })

  it('forgets after 10 minutes by the clock, as the pages read it', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-26T09:00:00.000Z'))
      rememberReceiving(facility, 'pharmacy', { items: [], receives: false })
      vi.setSystemTime(new Date('2026-10-26T09:09:59.000Z'))
      expect(rememberedReceiving(facility, 'pharmacy')).toEqual({ receives: false })
      vi.setSystemTime(new Date('2026-10-26T09:10:00.000Z'))
      expect(rememberedReceiving(facility, 'pharmacy')).toBeNull()
    } finally { vi.useRealTimers() }
  })
})

/**
 * D17 (hid-system 0090; SPEC-FINAL §9.1): the receiving facility's late section: how an order it accepted ended, the
 * lookup's rows as read, its refusals and what follows a withdrawal, and item 3's refusals once the late correction is
 * served.
 */
describe('the receiving facility’s late correction words (D17)', () => {
  const problem = (status: number, code: string) => new HidApiError(status, 'Refused', { code })

  it('points item 3’s refusals to the late section once served, and keeps today’s words until then (CT10)', () => {
    const say = (error: unknown, late: { reference: string | null } | null) => wrongPatientRefusal(error, 'lab', 'General Hospital', late)
    expect(say(problem(409, 'ORDER_ROUTE_ALREADY_ENDED'), { reference: '9C1B2D3E' })).toEqual({ reload: true, text: 'This order '
      + 'has already ended, so it can’t be ended here. If a result or dispensing had gone back, use “Correct an order that has '
      + 'ended” above the work list, with reference 9C1B2D3E.' })
    expect(say(problem(423, 'CROSS_FACILITY_ORDERS_UNAVAILABLE'), { reference: '9C1B2D3E' }).text).toBe('Health ID has paused work '
      + 'on orders from other facilities, so this can’t be done now. Try again when it resumes, and tell Health ID support now. If '
      + 'the order is closed meanwhile, you can still withdraw it under “Correct an order that has ended”, until the date shown there.')
    expect(say(problem(409, 'ORDER_ROUTE_ALREADY_ENDED'), null).text).toMatch(/phone General Hospital and tell Health ID support\.$/)
    expect(say(problem(423, 'CROSS_FACILITY_ORDERS_UNAVAILABLE'), null).text).toMatch(/closing it stops you withdrawing anything you sent back\.$/)
  })

  it('says how an order this facility accepted ended, never blaming the ordering facility for another’s end (CT10)', () => {
    const ended = (effectiveState: string, endedKind: string | null, service: 'lab' | 'pharmacy' = 'lab') =>
      lateEndedText({ effectiveState, endedKind, orderingFacilityName: 'General Hospital' }, service)
    expect(ended('completed', null)).toBe('its time for work ended')
    expect(ended('expired', null)).toBe('nothing was released within 30 days')
    expect(ended('expired', null, 'pharmacy')).toBe('nothing was dispensed within 30 days')
    expect(ended('completed', 'support')).toBe('closed by Health ID support')
    expect(ended('cancelled', 'support')).toBe('closed by Health ID support')
    expect(ended('cancelled', 'order_changed')).toBe('cancelled by General Hospital')
    expect(ended('cancelled', 'entered_in_error')).toBe('cancelled by General Hospital')
    expect(ended('completed', 'entered_in_error')).toBe('General Hospital has since marked the order entered in error')
    expect(ended('completed', 'ordering_released')).toBe('General Hospital is no longer on Health ID')
    expect(ended('completed', 'receiving_released')).toBe('this facility was released from Health ID')
    expect(ended('cancelled', 'wrong_patient')).toBe('ended as accepted for the wrong person')
  })

  it('reads the lookup’s rows only when they read right, and never a patient', () => {
    const row = { id: 'r1', reference: '3F2A9C1B', kind: 'prescription', version: 9, effectiveState: 'completed',
      orderingFacilityName: 'General Hospital', acceptedAt: '2026-06-01T09:00:00.000Z', completedAt: null, endedAt: null, endedKind: null,
      returned: false, correction: 'correctable', correctableUntil: '2026-11-28T09:00:00.000Z', wrongPatient: null,
      details: { what: 'Amoxicillin', acceptedBy: 'Bola Ade', acceptedWith: 'health_id',
        returned: [{ at: '2026-06-03T12:00:00.000Z', withdrawn: false }, { at: 'later', withdrawn: false }, { at: '2026-06-04T12:00:00.000Z' }] },
      patient: { fullName: 'Tunde Bello' } }
    const [read] = correctableRoutes({ items: [row, { ...row, id: 'r2', version: '9' }, { ...row, id: 'r3', correction: 'maybe' },
      { ...row, id: 'r4', correction: 'reported' }, null] })
    expect(read).toEqual({ id: 'r1', reference: '3F2A9C1B', kind: 'prescription', version: 9, effectiveState: 'completed',
      orderingFacilityName: 'General Hospital', acceptedAt: '2026-06-01T09:00:00.000Z', completedAt: null, endedAt: null, endedKind: null,
      returned: false, correction: 'correctable', correctableUntil: '2026-11-28T09:00:00.000Z', wrongPatient: null,
      details: { what: 'Amoxicillin', acceptedBy: 'Bola Ade', acceptedWith: 'health_id',
        returned: [{ at: '2026-06-03T12:00:00.000Z', withdrawn: false }] } })
    expect(correctableRoutes({ items: [{ ...row, correction: 'reported' }] })[0]!.details).toBeNull()
    expect(correctableRoutes({ items: [row, { ...row, id: 'r2', version: '9' }] })).toHaveLength(1)
    expect(correctableRoutes(null)).toEqual([])
    expect(JSON.stringify(correctableRoutes({ items: [row] }))).not.toContain('Tunde')
  })

  it('says each refusal of a late withdrawal, and of a Find, in the receiver’s words', () => {
    const say = (error: unknown, service: 'lab' | 'pharmacy' = 'lab') => lateWrongPatientRefusal(error, service, 'General Hospital',
      '2026-11-28T09:00:00.000Z')
    expect(say(problem(409, 'ORDER_ROUTE_CORRECTION_TOO_LATE'))).toEqual({ reload: true, text: 'It is past 28 Nov 2026, 10:00, so it '
      + 'can’t be corrected here. Phone General Hospital, and tell Health ID support.' })
    expect(say(problem(409, 'ORDER_ROUTE_STILL_OPEN'))).toMatchObject({ reload: true })
    expect(say(problem(412, 'VERSION_CONFLICT'))).toMatchObject({ stale: true })
    expect(say(problem(409, 'ORDER_ROUTE_CHANGED_CONCURRENTLY')).text).toBe('Someone changed this order at the same moment. Try again.')
    expect(say(problem(409, 'IDEMPOTENCY_KEY_REUSED'))).toEqual({ reload: true, text: 'This report was already sent with other '
      + 'details. Find the order again and check whether it has been withdrawn.' })
    expect(say(problem(403, 'PERMISSION_DENIED')).text).toBe('Your role can’t withdraw orders from other facilities.')
    expect(say(problem(404, 'ORDER_ROUTE_NOT_FOUND'))).toEqual({ reload: true, text: 'This order was not found here. Find it again.' })
    expect(say(problem(429, 'ORDER_ROUTE_CORRECTION_LIMIT')).text).toBe('You have reached the limit for withdrawing ended orders. '
      + 'You can withdraw more later. If many orders are affected, phone Health ID support now so that they can tell the ordering '
      + 'facilities.')
    expect(say(problem(503, 'ORDER_ROUTE_UNAVAILABLE'))).toMatchObject({ reload: true, unanswered: true })
    expect(say(problem(400, 'IDEMPOTENCY_KEY_REQUIRED')).text).toMatch(/^Check what you entered/)
    expect(correctableFindRefusal(problem(404, 'API_ROUTE_NOT_FOUND'))).toMatchObject({ missing: true })
    expect(correctableFindRefusal(problem(404, 'ORDER_ROUTE_NOT_FOUND'))).not.toHaveProperty('missing')
  })

  it('says what follows a withdrawal, by whether anything had gone back (CT7)', () => {
    expect(lateCorrectionLines({ service: 'lab', title: 'Full blood count', reference: '3F2A9C1B', ordering: 'General Hospital',
      returned: false })).toEqual(['Withdrawn: Full blood count, reference 3F2A9C1B. The patient is told in the Health ID app.',
      'Nothing had gone back to General Hospital. Phone General Hospital if the patient still needs the test, so they can send a new order.',
      'Follow your laboratory’s procedure for a misidentified specimen. If a value was critical and you can tell who the person '
        + 'was, tell them or their clinician.'])
  })

  it('takes the Lagos day of a time, and lists days once each', () => {
    expect(lagosDay('2026-06-01T23:30:00.000Z')).toBe('2026-06-02')
    expect(lagosDay('nonsense')).toBeNull()
    expect(returnedDays(['2026-06-09T12:00:00.000Z', '2026-06-03T12:00:00.000Z', '2026-06-03T15:00:00.000Z'])).toBe('3 Jun 2026 and 9 Jun 2026')
    expect(returnedDays(['2026-06-03T12:00:00.000Z', '2026-06-05T12:00:00.000Z', '2026-06-09T12:00:00.000Z'])).toBe('3 Jun 2026, 5 Jun 2026 and 9 Jun 2026')
  })
})
