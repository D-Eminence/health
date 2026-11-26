import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  ADMIT_DEPARTMENTS, BOARD_REFUSED, COLUMN_WORDS, ED_REFUSALS, NOT_AVAILABLE, VISIT_CHART_CLOSED, VISIT_FAILED, VISIT_NOT_FOUND,
  arrivalMoment, awaitsBoardCodes, canArrive, canDecide, canRead, canTriage, cardName, closedWords, complaintProblem, complaintText,
  historyText, lagosTime, lagosWhen, leaveLabel, minutesText, notServed, reasonProblem, refusalWords, statusWords, unknownRefusal,
  startEmergencyVisit, visitAttempt, visitRefusal, type VisitKeyBody,
} from '../../../../ehr-blue/departments/emergency/edRules'
import { lagosDay } from '@hid/ui/display'
import { TRIAGE_LEVELS, triageText, triageTone } from '../../../../ehr-blue/departments/parts/triageLevels'
import { triageText as waitingTriageText } from '../../../../ehr-blue/departments/waiting/waitingRules'

/* The emergency board's words and rules (hid-system ED-1). Every value here is fictional. */
const refused = (status: number, code: string) => new HidApiError(status, 'detail', { code })
const ED = ['ehr.ed.read', 'ehr.encounter.read', 'ehr.encounter.write']

describe('emergency board rules', () => {
  it('follows the backend’s role table: front desk views and adds, nurses triage, clinicians and doctors decide', () => {
    const desk = [...ED, 'ehr.ed.arrive']
    const nurse = [...desk, 'ehr.ed.triage']
    const doctor = [...nurse, 'ehr.ed.disposition']
    expect([canRead(desk), canArrive(desk), canTriage(desk), canDecide(desk)]).toEqual([true, true, false, false])
    expect([canRead(nurse), canArrive(nurse), canTriage(nurse), canDecide(nurse)]).toEqual([true, true, true, false])
    expect([canRead(doctor), canArrive(doctor), canTriage(doctor), canDecide(doctor)]).toEqual([true, true, true, true])
    // ED codes without 0135's pair (or the pair without an ED code) open nothing.
    expect(canRead(['ehr.ed.read'])).toBe(false)
    expect(canRead(['ehr.encounter.read', 'ehr.encounter.write'])).toBe(false)
  })

  it('tells a member the board is for that it is not available yet on a backend before 0169, not that it is not for them', () => {
    // Before 0169 no role holds an ED code: the front desk, nurses, clinicians and doctors hold only 0135's pair.
    expect(awaitsBoardCodes(['ehr.encounter.read', 'ehr.encounter.write'])).toBe(true)
    expect(awaitsBoardCodes(ED)).toBe(false)
    // Lab staff (read only) and pharmacists hold no pair: the board is not for them.
    expect(awaitsBoardCodes(['ehr.encounter.read', 'lab.work-item.read'])).toBe(false)
    expect(awaitsBoardCodes([])).toBe(false)
  })

  it('shares the waiting list’s five triage levels and tones: there is no second scale', () => {
    expect(TRIAGE_LEVELS).toEqual([1, 2, 3, 4, 5])
    expect(TRIAGE_LEVELS.map(level => triageText(level))).toEqual(['Level 1: most urgent', 'Level 2: very urgent', 'Level 3: urgent',
      'Level 4: less urgent', 'Level 5: not urgent'])
    expect(waitingTriageText).toBe(triageText)
    expect(triageText(null)).toBe('No triage level yet')
    expect([triageTone(1), triageTone(2), triageTone(3), triageTone(4), triageTone(null)]).toEqual(['critical', 'critical', 'caution', 'neutral', 'neutral'])
  })

  it('shows times in Lagos and the time in the department without colours', () => {
    expect(lagosTime('2026-12-03T08:10:00.000Z')).toBe('09:10')
    expect(lagosTime('not a time')).toBe('')
    // P2-4: a moment on an earlier Lagos day carries its date (a patient waiting for a ward stays for days).
    const now = new Date('2026-12-03T10:00:00.000Z')
    expect(lagosWhen('2026-12-03T08:10:00.000Z', now)).toBe('09:10')
    expect(lagosWhen('2026-12-01T13:05:00.000Z', now)).toBe('1 Dec 2026, 14:05')
    // 23:40 in Lagos the day before is not today's 23:40, though it is under a day ago.
    expect(lagosWhen('2026-12-02T22:40:00.000Z', now)).toBe('2 Dec 2026, 23:40')
    expect(lagosWhen(null, now)).toBe('')
    expect(minutesText(0)).toBe('0 min')
    expect(minutesText(59)).toBe('59 min')
    expect(minutesText(60)).toBe('1 h')
    expect(minutesText(125)).toBe('2 h 5 min')
    expect(minutesText(-1)).toBe('')
  })

  it('turns a typed Lagos time into the arrival moment, the evening before when it is later than now', () => {
    const now = new Date('2026-12-03T08:30:00.000Z') // 09:30 in Lagos
    expect(arrivalMoment('09:05', now)).toBe('2026-12-03T08:05:00.000Z')
    expect(arrivalMoment('09:31', now)).toBe('2026-12-03T08:31:00.000Z')
    expect(arrivalMoment('23:50', now)).toBe('2026-12-02T22:50:00.000Z')
    expect(arrivalMoment('9:5', now)).toBeNull()
  })

  it('names an unknown patient by their label, and the decision and leave words', () => {
    expect(cardName({ fullName: 'Unknown patient U-0007', recordKind: 'unknown', unknownLabel: 'U-0007' })).toBe('Unknown patient U-0007')
    expect(cardName({ fullName: 'Tunde Boardone', recordKind: 'standard', unknownLabel: null })).toBe('Tunde Boardone')
    const admit = { outcome: 'admit_requested' as const, decidedAt: '', decidedByMembershipId: null, admitToDepartmentCode: 'inpatient',
      admittingMembershipId: null, referredToFacilityName: null }
    expect(statusWords({ status: 'decided', disposition: admit })).toBe('Waiting for admission')
    expect(leaveLabel({ disposition: admit })).toBe('Handed over to the ward')
    expect(leaveLabel({ disposition: { ...admit, outcome: 'discharged' } })).toBe('Left the department')
    expect(statusWords({ status: 'open', disposition: null })).toBe('In the department')
    expect(statusWords({ status: 'closed', disposition: { ...admit, outcome: 'discharged' } })).toBe('Discharged home')
    expect(complaintText({ presentingComplaint: null, complaintHidden: true })).toBe('Shown to nurses, clinicians and doctors only')
    expect(complaintText({ presentingComplaint: null, complaintHidden: false })).toBe('None recorded')
    expect(ADMIT_DEPARTMENTS.map(([code]) => code)).not.toContain('emergency')
  })

  it('never says a closed record with no decision left the department: its history tells a cancelled arrival apart', () => {
    const closed = { status: 'closed' as const, disposition: null }
    const event = (kind: 'arrived' | 'cancelled' | 'closed_on_waiting_list' | 'triaged') => ({ kind })
    // The board card has no history: an arrival cancelled as made in error and one closed on the waiting list look alike.
    expect(statusWords(closed)).toBe('Closed')
    expect(COLUMN_WORDS.closed).toBe('Off the board today')
    expect(closedWords(closed, [event('arrived'), event('triaged'), event('cancelled')])).toBe('Arrival cancelled')
    expect(closedWords(closed, [event('arrived'), event('closed_on_waiting_list')])).toBe('Closed on the waiting list')
    expect(closedWords(closed, [])).toBe('Closed')
    expect(closedWords({ status: 'decided', disposition: null }, [event('cancelled')])).toBe(statusWords({ status: 'decided', disposition: null }))
    for (const words of [statusWords(closed), closedWords(closed, [event('cancelled')]), COLUMN_WORDS.closed]) expect(words).not.toMatch(/left the department/i)
  })

  it('writes the history without the complaint’s text', () => {
    const base = { at: '2026-12-03T08:10:00.000Z', byMembershipId: null, fromStage: null, toStage: null, triageLevel: null, outcome: null,
      reason: null, complaintChanged: false }
    expect(historyText({ ...base, kind: 'triaged', triageLevel: 2, complaintChanged: true })).toBe('Triaged (level 2). Complaint recorded')
    expect(historyText({ ...base, kind: 'moved', fromStage: 'ready', toStage: 'with_clinician' })).toBe('Moved to being seen')
    expect(historyText({ ...base, kind: 'disposition', outcome: 'discharged' })).toBe('Decision recorded: discharged home')
    expect(historyText({ ...base, kind: 'closed_on_waiting_list' })).toBe('Closed on the waiting list')
  })

  it('checks the complaint and reasons as the server does', () => {
    expect(complaintProblem('')).toBe('')
    expect(complaintProblem('x'.repeat(121))).toBe('Keep the complaint to 120 characters.')
    expect(complaintProblem('a\u0007b')).toBe('Use letters, numbers and punctuation only.')
    expect(reasonProblem('  short  ')).toBe('Say why in at least 8 characters.')
    expect(reasonProblem('Added in error')).toBe('')
    expect(reasonProblem('x'.repeat(501))).toBe('Keep the reason to 500 characters.')
  })

  it('says every refusal in plain words, never the word the guard uses, and knows when the board is not served', () => {
    expect(notServed(refused(503, 'ED_BOARD_NOT_AVAILABLE'))).toBe(true)
    expect(notServed(refused(404, 'NOT_FOUND'))).toBe(true)
    expect(notServed(refused(404, 'ED_ATTENDANCE_NOT_FOUND'))).toBe(false)
    expect(refusalWords(refused(503, 'ED_BOARD_NOT_AVAILABLE'), 'x')).toBe(NOT_AVAILABLE)
    expect(refusalWords(refused(403, 'PERMISSION_DENIED'), 'x')).toBe(ED_REFUSALS.ED_BOARD_NOT_ALLOWED)
    expect(refusalWords(refused(400, 'VALIDATION_FAILED'), 'x', 'Check the arrival.')).toBe('Check the arrival.')
    expect(refusalWords(refused(409, 'ED_ATTENDANCE_CLOSED'), 'x')).toBe('This patient has left the emergency department. Add them again if they are back.')
    expect(refusalWords(new Error('boom'), 'Fallback.')).toBe('Fallback.')
    for (const words of Object.values(ED_REFUSALS)) expect(words).not.toMatch(/permission/i)
    expect(unknownRefusal(refused(403, 'FORBIDDEN'))).toBe('Your role here can’t make an unknown patient’s record. Ask the front desk.')
    expect(unknownRefusal(refused(404, 'NOT_FOUND'))).toBe('Unknown patient records are not available yet. Try again later.')
  })

  it('keeps one start time and key body per attempt to link the visit, so a retry is the same request (review fix)', () => {
    const times = new Map<string, string>()
    const card = { attendanceId: 'e0000000-0000-4000-8000-0000000000e1', patientId: 'b0000000-0000-4000-8000-0000000000f1', encounterId: null }
    const first = visitAttempt(card, times, () => new Date('2026-12-03T08:20:00.123Z'))
    expect(first.startedAt).toBe('2026-12-03T08:20:00.000Z')
    // Tried again a minute later (after a 412 and a reload, or Refresh): the same body, so the same Idempotency-Key.
    const retry = visitAttempt(card, times, () => new Date('2026-12-03T08:21:30.000Z'))
    expect(retry).toEqual(first)
    expect(JSON.stringify(retry.keyBody)).toBe(JSON.stringify(first.keyBody))
    // Link again once a visit is linked: a new attempt with its own start time and key body.
    const again = visitAttempt({ ...card, encounterId: 'c0000000-0000-4000-8000-0000000000c1' }, times, () => new Date('2026-12-03T09:00:00.000Z'))
    expect(again.startedAt).toBe('2026-12-03T09:00:00.000Z')
    expect(again.keyBody).not.toEqual(first.keyBody)
  })

  describe('the visit link across Lagos midnight (REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY)', () => {
    const card = { attendanceId: 'e0000000-0000-4000-8000-0000000000e1', patientId: 'b0000000-0000-4000-8000-0000000000f1', encounterId: null }
    /** ehr-api's EHR-C1 check: a reuse visit must start on today's Lagos day ("today" is the clock below). */
    function ehrApi(clock: { now: Date }) {
      const sent: { startedAt: string; keyBody: VisitKeyBody }[] = []
      const send = vi.fn(async (startedAt: string, keyBody: VisitKeyBody) => {
        sent.push({ startedAt, keyBody })
        if (lagosDay(new Date(startedAt)) !== lagosDay(clock.now)) {
          throw new HidApiError(400, 'To use the open visit today, the visit must start today (Lagos time).', { code: 'REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY' })
        }
        return { id: `visit-${startedAt}` }
      })
      return { sent, send }
    }

    it('starts the attempt again with a new time and key when the first try was before midnight', async () => {
      const times = new Map<string, string>()
      const clock = { now: new Date('2026-12-03T22:58:00.000Z') } // 23:58 in Lagos
      const { sent, send } = ehrApi(clock)
      const forget = vi.fn()
      // 23:58: the visit is made, but the link answers a version conflict (a colleague triaged at that moment).
      await startEmergencyVisit(card, times, send, forget, () => clock.now)
      expect(sent[0]!.startedAt).toBe('2026-12-03T22:58:00.000Z')
      // 00:03 the next day in Lagos: the same attempt is tried again.
      clock.now = new Date('2026-12-03T23:03:00.000Z')
      const visit = await startEmergencyVisit(card, times, send, forget, () => clock.now)
      expect(sent.map(call => call.startedAt)).toEqual(['2026-12-03T22:58:00.000Z', '2026-12-03T22:58:00.000Z', '2026-12-03T23:03:00.000Z'])
      expect(visit).toEqual({ id: 'visit-2026-12-03T23:03:00.000Z' })
      // The refused body's key is dropped, and the new request has a body (so a key) of its own.
      expect(forget).toHaveBeenCalledOnce()
      expect(forget).toHaveBeenCalledWith(sent[1]!.keyBody)
      expect(sent[2]!.keyBody).not.toEqual(sent[1]!.keyBody)
      // A later retry of this attempt is the new request again, the same body.
      clock.now = new Date('2026-12-03T23:10:00.000Z')
      await startEmergencyVisit(card, times, send, forget, () => clock.now)
      expect(sent[3]).toEqual(sent[2])
    })

    it('within the same Lagos day sends the same request again (no new time)', async () => {
      const times = new Map<string, string>()
      const clock = { now: new Date('2026-12-03T08:20:00.000Z') }
      const { sent, send } = ehrApi(clock)
      const forget = vi.fn()
      await startEmergencyVisit(card, times, send, forget, () => clock.now)
      clock.now = new Date('2026-12-03T08:25:00.000Z')
      await startEmergencyVisit(card, times, send, forget, () => clock.now)
      expect(sent[1]).toEqual(sent[0])
      expect(forget).not.toHaveBeenCalled()
    })

    it('tries a new time only once, and says plainly when this device\'s clock is wrong', async () => {
      const send = vi.fn(async () => { throw refused(400, 'REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY') })
      const caught = await startEmergencyVisit(card, new Map(), send, vi.fn(), () => new Date('2026-12-03T08:20:00.000Z'))
        .catch((error: unknown) => error)
      expect(send).toHaveBeenCalledTimes(2)
      expect(refusalWords(caught, 'The emergency visit could not be started. Try again.'))
        .toBe('The emergency visit was not started. The date or time on this device looks wrong. Check it, then try again.')
    })

    it('says EHR-C1’s refusals of the visit as the chart’s, never as the board’s (review fix)', () => {
      // The approval the chart was opened under ended, was denied since, or allows reading only.
      expect(visitRefusal(refused(403, 'CONSENT_REQUIRED'))).toBe(VISIT_CHART_CLOSED)
      expect(visitRefusal(refused(403, 'ACCESS_DENIED'))).toBe(VISIT_CHART_CLOSED)
      expect(VISIT_CHART_CLOSED).toContain('Open their chart again on Patients')
      // EHR-C1's 404 is the patient, never "the board is not available yet".
      expect(visitRefusal(refused(404, 'CLINICAL_RESOURCE_NOT_FOUND'))).toBe(VISIT_NOT_FOUND)
      expect(visitRefusal(refused(404, 'NOT_FOUND'))).toBe(VISIT_NOT_FOUND)
      for (const code of ['CONSENT_REQUIRED', 'ACCESS_DENIED', 'PERMISSION_DENIED']) {
        expect(visitRefusal(refused(403, code))).not.toBe(BOARD_REFUSED)
        expect(visitRefusal(refused(403, code))).not.toMatch(/permission/i)
      }
      expect(visitRefusal(refused(404, 'CLINICAL_RESOURCE_NOT_FOUND'))).not.toBe(NOT_AVAILABLE)
      // Kept as before: the device's clock, and a key reused with another body.
      expect(visitRefusal(refused(400, 'REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY'))).toBe(ED_REFUSALS.REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY)
      expect(visitRefusal(refused(409, 'IDEMPOTENCY_KEY_REUSED'))).toBe(ED_REFUSALS.IDEMPOTENCY_KEY_REUSED)
      expect(visitRefusal(refused(400, 'VALIDATION_FAILED'))).toBe(VISIT_FAILED)
      expect(visitRefusal(new Error('boom'))).toBe(VISIT_FAILED)
    })

    it('passes any other refusal on without a second try', async () => {
      const send = vi.fn(async () => { throw refused(403, 'CONSENT_REQUIRED') })
      const forget = vi.fn()
      await expect(startEmergencyVisit(card, new Map(), send, forget)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' })
      expect(send).toHaveBeenCalledOnce()
      expect(forget).not.toHaveBeenCalled()
    })
  })
})
