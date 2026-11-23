import { describe, expect, it } from 'vitest'
import {
  PHARMACY_WITHDRAWN, PROGRESS_UNAVAILABLE, SENT_ELSEWHERE, ownProgressText, progressDetail, progressTime,
} from '../../../ehr-blue/clinical/consult/orders/progress'
import { ENCOUNTER_ID, PATIENT_ID } from './harness'

/**
 * ORD-3 (live contract, hid-system 4c843270): each prescription and lab request's `ownProgress`, in the contract's
 * screen words, with times in West Africa Time. Everything is fictional.
 */

/** 23 Nov 2026, 12:00 in Lagos (11:00 UTC): "today" for these words. */
const NOW = new Date('2026-11-23T11:00:00.000Z')
/** 10:40, 10:52, 11:05 and 09:30 in Lagos on that day (UTC+1). */
const AT_1040 = '2026-11-23T09:40:00.000Z'
const AT_1052 = '2026-11-23T09:52:00.000Z'
const AT_1105 = '2026-11-23T10:05:00.000Z'
const AT_0930 = '2026-11-23T08:30:00.000Z'

const order = (fields: Record<string, unknown>) => ({ id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: AT_0930, ...fields })
const rx = (ownProgress: unknown, fields: Record<string, unknown> = {}) => ownProgressText('pharmacy', order({ status: 'active', ownProgress, ...fields }), NOW)
const lab = (ownProgress: unknown, fields: Record<string, unknown> = {}) => ownProgressText('laboratory', order({ status: 'active', ownProgress, ...fields }), NOW)
const pharmacy = (status: string, times: Record<string, unknown> = {}) => ({ status, receivedAt: null, dispensedAt: null, reversedAt: null, ...times })
const laboratory = (status: string, times: Record<string, unknown> = {}) => ({ status, receivedAt: null, collectedAt: null, lastResultAt: null, ...times })

describe('a prescription’s own pharmacy progress (ORD-3)', () => {
  it.each([
    ['received', pharmacy('received', { receivedAt: AT_1040 }), 'Received 10:40'],
    ['dispensed', pharmacy('dispensed', { receivedAt: AT_1040, dispensedAt: AT_1105 }), 'Dispensed 11:05'],
    ['dispensing_reversed', pharmacy('dispensing_reversed', { receivedAt: AT_1040, dispensedAt: AT_1052, reversedAt: AT_1105 }), 'Dispensing reversed 11:05'],
    ['withdrawn', pharmacy('withdrawn', { receivedAt: AT_1040 }), PHARMACY_WITHDRAWN],
    ['sent_elsewhere with no route', pharmacy('sent_elsewhere', { receivedAt: AT_1040 }), SENT_ELSEWHERE],
    ['unknown', pharmacy('unknown'), PROGRESS_UNAVAILABLE],
  ])('says %s in the contract’s words', (_name, progress, words) => {
    expect(rx(progress)).toBe(words)
  })

  it('names the pharmacy a prescription sent elsewhere went to, from its own route', () => {
    const orderRoute = { id: 'route-1', effectiveState: 'accepted', receivingFacility: { id: 'f-1', name: 'Demo Pharmacy', available: true } }
    expect(rx(pharmacy('sent_elsewhere', { receivedAt: AT_1040 }), { orderRoute })).toBe('Sent to Demo Pharmacy by the prescribing team, instead of this hospital’s pharmacy')
    // A route with no name says the contract's fallback.
    expect(rx(pharmacy('sent_elsewhere'), { orderRoute: { ...orderRoute, receivingFacility: { id: 'f-1', name: ' ', available: true } } })).toBe(SENT_ELSEWHERE)
  })

  it('says nothing for not_received: a draft never sent, or no work in this pharmacy', () => {
    expect(rx(pharmacy('not_received'), { status: 'draft' })).toBeNull()
    expect(rx(pharmacy('not_received'))).toBeNull()
  })

  it('says "Accepted 10:52" (ORD-4) only when its time is there, and otherwise what the pharmacy having it says', () => {
    expect(rx({ ...pharmacy('accepted', { receivedAt: AT_1040 }), acceptedAt: AT_1052 })).toBe('Accepted 10:52')
    // ORD-4's planned "Before this ships": never "Accepted" without a pharmacist's acceptance time.
    expect(rx(pharmacy('accepted', { receivedAt: AT_1040 }))).toBe('Received 10:40')
    expect(rx({ ...pharmacy('accepted'), acceptedAt: 'not a time' })).toBe('Received')
  })

  it('names no pharmacist: ownProgress carries none, and a name sent anyway is not said', () => {
    expect(rx({ ...pharmacy('dispensed', { dispensedAt: AT_1105 }), dispensedBy: 'Pharmacist One' })).toBe('Dispensed 11:05')
  })
})

describe('a lab request’s own laboratory progress (ORD-3)', () => {
  it.each([
    ['received', laboratory('received', { receivedAt: AT_1040 }), 'Received 10:40'],
    ['sample_collected', laboratory('sample_collected', { receivedAt: AT_0930, collectedAt: AT_0930 }), 'Sample taken 09:30'],
    ['some_results_ready', laboratory('some_results_ready', { collectedAt: AT_0930, lastResultAt: AT_1052 }), 'Some results ready 10:52'],
    ['results_ready', laboratory('results_ready', { collectedAt: AT_0930, lastResultAt: AT_1105 }), 'Results ready 11:05'],
    ['unknown', laboratory('unknown'), PROGRESS_UNAVAILABLE],
  ])('says %s in the contract’s words', (_name, progress, words) => {
    expect(lab(progress)).toBe(words)
  })

  it('says nothing for not_received on a draft', () => {
    expect(lab(laboratory('not_received'), { status: 'draft' })).toBeNull()
  })
})

describe('what a backend without ORD-3, or a malformed value, leaves on the screen', () => {
  it('says nothing when the backend sends no ownProgress (today’s behaviour)', () => {
    expect(ownProgressText('pharmacy', order({ status: 'active' }), NOW)).toBeNull()
    expect(ownProgressText('laboratory', order({ status: 'active' }), NOW)).toBeNull()
    expect(rx(null)).toBeNull()
    expect(progressDetail('pharmacy', order({ status: 'active' }))).toBeUndefined()
  })

  it.each([
    ['a string', 'dispensed'],
    ['a number', 3],
    ['a list', [pharmacy('dispensed')]],
    ['an object with no status', { receivedAt: AT_1040 }],
    ['a status that is not text', { status: 7 }],
    ['a status it does not know', pharmacy('teleported')],
    ['the other kind’s status', laboratory('results_ready')],
  ])('says progress is not available for %s, and never fails', (_name, progress) => {
    expect(rx(progress)).toBe(PROGRESS_UNAVAILABLE)
  })

  it('reads a pharmacy status on a lab request as not understood', () => {
    expect(lab(pharmacy('dispensed', { dispensedAt: AT_1105 }))).toBe(PROGRESS_UNAVAILABLE)
  })

  it('leaves the time off when it is missing or not a date', () => {
    expect(rx(pharmacy('dispensed'))).toBe('Dispensed')
    expect(rx(pharmacy('dispensed', { dispensedAt: 'yesterday' }))).toBe('Dispensed')
    expect(rx(pharmacy('dispensed', { dispensedAt: 1_700_000_000 }))).toBe('Dispensed')
    expect(lab(laboratory('sample_collected', { collectedAt: '' }))).toBe('Sample taken')
  })
})

describe('progress times', () => {
  it('says a time today in Lagos on the 24-hour clock, and another day with its date, never all in numbers', () => {
    expect(progressTime(AT_1105, NOW)).toBe('11:05')
    // 23:30 UTC on 22 Nov is 00:30 on 23 Nov in Lagos: today there.
    expect(progressTime('2026-11-22T23:30:00.000Z', NOW)).toBe('00:30')
    expect(progressTime('2026-11-21T10:05:00.000Z', NOW)).toBe('21 Nov 2026, 11:05')
    expect(progressTime(null, NOW)).toBe('')
  })
})
