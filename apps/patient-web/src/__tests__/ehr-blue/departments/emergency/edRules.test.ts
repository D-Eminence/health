import { describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  ADMIT_DEPARTMENTS, ED_REFUSALS, NOT_AVAILABLE, arrivalMoment, canArrive, canDecide, canRead, canTriage, cardName, complaintProblem,
  complaintText, historyText, lagosTime, leaveLabel, minutesText, notServed, reasonProblem, refusalWords, statusWords, unknownRefusal,
} from '../../../../ehr-blue/departments/emergency/edRules'
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
    expect(complaintText({ presentingComplaint: null, complaintHidden: true })).toBe('Shown to nurses, clinicians and doctors only')
    expect(complaintText({ presentingComplaint: null, complaintHidden: false })).toBe('None recorded')
    expect(ADMIT_DEPARTMENTS.map(([code]) => code)).not.toContain('emergency')
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
})
