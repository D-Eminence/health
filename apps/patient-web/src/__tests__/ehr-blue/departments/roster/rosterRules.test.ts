import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import type { RosterShift } from '../../../../staff/api'
import {
  NOT_AVAILABLE, addDays, attendanceOpen, cancelOffered, clashDates, dayText, dutyStarted, dutyWindow, firstClash, forgetDutyRosterServed,
  dutyRosterServed, learnFrom, leaveDatesProblem, leaveDatesText, leaveOn, leaveTypeText, mondayOf, notServed, personText, refusalWords,
  refusedDuty, ruleText, sameEntries, shiftTimes, timeRangeText, weekDays, weekInRange, weekText,
} from '../../../../ehr-blue/departments/roster/rosterRules'

/*
 * The duty roster's rules (hid-system ROS-1) as the pages use them: Lagos weeks and shift times whatever the device's
 * zone, the clashes the database refuses, leave dates, and each refusal in words that never name a permission. Every
 * id here is fictional.
 */
beforeAll(() => { process.env.TZ = 'America/New_York' })
afterEach(() => { forgetDutyRosterServed() })

const MORNING: RosterShift = { shiftId: 's-morning', name: 'Morning', startsAt: '07:30', endsAt: '14:30', active: true }
const AFTERNOON: RosterShift = { shiftId: 's-afternoon', name: 'Afternoon', startsAt: '14:00', endsAt: '21:00', active: true }
const NIGHT: RosterShift = { shiftId: 's-night', name: 'Night', startsAt: '20:30', endsAt: '08:00', active: true }
const LATE: RosterShift = { shiftId: 's-late', name: 'Late', startsAt: '16:00', endsAt: '23:30', active: true }
const SHIFTS = [MORNING, AFTERNOON, NIGHT, LATE]
const ADA = 'a0000000-0000-4000-8000-0000000000a1'
const BOLA = 'b0000000-0000-4000-8000-0000000000b2'
const problem = (status: number, code: string, details?: unknown) => new HidApiError(status, 'A refusal naming a permission', { code, details })

describe('Lagos weeks', () => {
  it('starts every week on its Monday and lists its seven days', () => {
    expect(mondayOf('2026-12-07')).toBe('2026-12-07')
    expect(mondayOf('2026-12-13')).toBe('2026-12-07')
    expect(mondayOf('2026-12-10')).toBe('2026-12-07')
    expect(weekDays('2026-12-07')).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'])
    expect(weekText('2026-12-07')).toBe('7 Dec 2026 to 13 Dec 2026')
    expect(dayText('2026-12-07')).toBe('Monday 7 Dec 2026')
  })

  it('takes a week from 8 weeks ago to 26 weeks ahead, and only a Monday', () => {
    const today = '2026-12-09'
    expect(weekInRange('2026-12-07', today)).toBe(true)
    expect(weekInRange(addDays('2026-12-07', -56), today)).toBe(true)
    expect(weekInRange(addDays('2026-12-07', -63), today)).toBe(false)
    expect(weekInRange(addDays('2026-12-07', 26 * 7), today)).toBe(true)
    expect(weekInRange(addDays('2026-12-07', 27 * 7), today)).toBe(false)
    expect(weekInRange('2026-12-08', today)).toBe(false)
  })
})

describe('shift times', () => {
  it('says a shift in Lagos time, and a night shift ending the next day', () => {
    expect(shiftTimes(MORNING)).toBe('07:30 to 14:30')
    expect(shiftTimes(NIGHT)).toBe('20:30 to 08:00 next day')
  })

  it('works out a duty from the shift\'s Lagos times, whatever the device\'s zone', () => {
    const night = dutyWindow('2026-12-07', NIGHT)!
    expect(new Date(night.start).toISOString()).toBe('2026-12-07T19:30:00.000Z')
    expect(new Date(night.end).toISOString()).toBe('2026-12-08T07:00:00.000Z')
    expect(timeRangeText({ startsAt: '2026-12-07T19:30:00.000Z', endsAt: '2026-12-08T07:00:00.000Z' })).toBe('20:30 to 08:00 next day')
    expect(dutyStarted('2026-12-07', MORNING, Date.parse('2026-12-07T06:29:00.000Z'))).toBe(false)
    expect(dutyStarted('2026-12-07', MORNING, Date.parse('2026-12-07T06:30:00.000Z'))).toBe(true)
  })

  it('opens attendance from 1 hour before the shift until 7 days after it ends', () => {
    const duty = { startsAt: '2026-12-07T06:30:00.000Z', endsAt: '2026-12-07T13:30:00.000Z' }
    expect(attendanceOpen(duty, Date.parse('2026-12-07T05:29:00.000Z'))).toBe(false)
    expect(attendanceOpen(duty, Date.parse('2026-12-07T05:30:00.000Z'))).toBe(true)
    expect(attendanceOpen(duty, Date.parse('2026-12-14T13:30:00.000Z'))).toBe(true)
    expect(attendanceOpen(duty, Date.parse('2026-12-14T13:31:00.000Z'))).toBe(false)
  })
})

describe('the clashes the database refuses', () => {
  const duty = (membershipId: string, shiftId: string, dutyDate: string) => ({ membershipId, shiftId, dutyDate })

  it('refuses overlapping duties and a rest shorter than the rule, for one person only', () => {
    // Morning then Afternoon the same day overlap (14:00 before 14:30).
    expect(firstClash([duty(ADA, 's-morning', '2026-12-07'), duty(ADA, 's-afternoon', '2026-12-07')], SHIFTS, 8))
      .toEqual({ kind: 'overlap', entry: duty(ADA, 's-afternoon', '2026-12-07') })
    // Two people on overlapping shifts is fine.
    expect(firstClash([duty(ADA, 's-morning', '2026-12-07'), duty(BOLA, 's-afternoon', '2026-12-07')], SHIFTS, 8)).toBeNull()
    // Night ends 08:00 on Tuesday; Morning on Tuesday starts 07:30: an overlap across midnight.
    expect(firstClash([duty(ADA, 's-night', '2026-12-07'), duty(ADA, 's-morning', '2026-12-08')], SHIFTS, 8)?.kind).toBe('overlap')
    // Late ends 23:30; Morning the next day starts 07:30: 8 hours exactly is allowed, 9 hours refused.
    expect(firstClash([duty(ADA, 's-late', '2026-12-07'), duty(ADA, 's-morning', '2026-12-08')], SHIFTS, 8)).toBeNull()
    expect(firstClash([duty(ADA, 's-late', '2026-12-07'), duty(ADA, 's-morning', '2026-12-08')], SHIFTS, 9)?.kind).toBe('rest')
  })

  it('says the rule as the clinical lead has still to sign it', () => {
    expect(ruleText({ minRestHours: 8, status: 'draft' })).toBe('At least 8 hours between duties (draft, awaiting the clinical lead)')
    expect(ruleText({ minRestHours: 10, status: 'signed' })).toBe('At least 10 hours between duties')
  })

  it('compares a roster\'s duties in any order', () => {
    const a = [duty(ADA, 's-morning', '2026-12-07'), duty(BOLA, 's-night', '2026-12-08')]
    expect(sameEntries(a, [...a].reverse())).toBe(true)
    expect(sameEntries(a, a.slice(1))).toBe(false)
  })

  it('tells editors who is on leave, never the type', () => {
    const unavailable = [{ membershipId: ADA, from: '2026-12-09', to: '2026-12-11', kind: 'leave_approved' },
      { membershipId: BOLA, from: '2026-12-09', to: '2026-12-09', kind: 'leave_requested' }]
    expect(leaveOn(unavailable, ADA, '2026-12-10')).toBe('leave_approved')
    expect(leaveOn(unavailable, ADA, '2026-12-12')).toBeNull()
    expect(leaveOn(unavailable, BOLA.toUpperCase(), '2026-12-09')).toBe('leave_requested')
  })
})

describe('leave', () => {
  it('takes dates from 30 days ago, ending on or after the start, for up to 365 days', () => {
    const today = '2026-12-09'
    expect(leaveDatesProblem('2026-12-14', '2026-12-18', today)).toBeNull()
    expect(leaveDatesProblem('2026-11-09', '2026-11-10', today)).toBeNull()
    expect(leaveDatesProblem('2026-11-08', '2026-11-10', today)).toMatch(/up to 30 days ago/)
    expect(leaveDatesProblem('2026-12-14', '2026-12-13', today)).toMatch(/on or after its start/)
    expect(leaveDatesProblem('2026-12-14', '2027-12-14', today)).toBeNull()
    expect(leaveDatesProblem('2026-12-14', '2027-12-15', today)).toMatch(/365 days/)
    expect(leaveDatesProblem('', '2026-12-18', today)).toBe('Choose the first and last day of the leave.')
  })

  it('offers cancel before a decision, and for approved leave before it starts', () => {
    expect(cancelOffered({ status: 'requested', startsOn: '2026-12-01' }, '2026-12-09')).toBe(true)
    expect(cancelOffered({ status: 'approved', startsOn: '2026-12-10' }, '2026-12-09')).toBe(true)
    expect(cancelOffered({ status: 'approved', startsOn: '2026-12-09' }, '2026-12-09')).toBe(false)
    expect(cancelOffered({ status: 'declined', startsOn: '2026-12-10' }, '2026-12-09')).toBe(false)
  })

  it('says the type and dates in words', () => {
    expect(leaveTypeText('maternity')).toBe('Maternity leave')
    expect(leaveTypeText(null)).toBe('Leave')
    expect(leaveDatesText({ startsOn: '2026-12-14', endsOn: '2026-12-18', days: 5 })).toBe('14 Dec 2026 to 18 Dec 2026 (5 days)')
    expect(leaveDatesText({ startsOn: '2026-12-14', endsOn: '2026-12-14', days: 1 })).toBe('14 Dec 2026 (1 day)')
  })
})

describe('refusals', () => {
  it('says each in the contract\'s words, never a permission or an id', () => {
    expect(refusalWords(problem(409, 'ROSTER_REST_TOO_SHORT'), 'x', 8)).toBe('This person needs at least 8 hours between duties.')
    expect(refusalWords(problem(409, 'LEAVE_OWN_DECISION_NOT_ALLOWED'), 'x')).toBe('Someone else must approve or decline your own leave.')
    expect(refusalWords(problem(403, 'PERMISSION_DENIED'), 'x')).toBe('Only staff of this facility can see its duty roster.')
    expect(refusalWords(problem(403, 'SOMETHING_NEW'), 'x')).not.toMatch(/permission/i)
    expect(refusalWords(problem(503, 'DUTY_ROSTER_NOT_AVAILABLE'), 'x')).toBe(NOT_AVAILABLE)
    expect(refusalWords(problem(500, 'INTERNAL'), 'The fallback.')).toBe('The fallback.')
    expect(refusalWords(new Error('boom'), 'The fallback.')).toBe('The fallback.')
  })

  it('reads the duty a roster refusal names, and the days a leave approval clashes with', () => {
    expect(refusedDuty(problem(409, 'ROSTER_OVERLAP', { membershipId: ADA, dutyDate: '2026-12-08', shiftId: 's-night' })))
      .toEqual({ membershipId: ADA, dutyDate: '2026-12-08', shiftId: 's-night' })
    expect(refusedDuty(problem(409, 'ROSTER_OVERLAP'))).toBeNull()
    expect(clashDates(problem(409, 'LEAVE_CLASHES_WITH_ROSTER', { dates: ['2026-12-15', 'not a day'] }))).toEqual(['2026-12-15'])
  })

  it('learns per facility whether the roster is served: 404 or the flag off says not, any other answer says it is', () => {
    expect(notServed(problem(404, 'NOT_FOUND'))).toBe(true)
    expect(notServed(problem(404, 'ROSTER_NOT_FOUND'))).toBe(false)
    learnFrom('facility-one', problem(503, 'DUTY_ROSTER_NOT_AVAILABLE'))
    expect(dutyRosterServed('facility-one')).toBe(false)
    expect(dutyRosterServed('facility-two')).toBeNull()
    learnFrom('facility-two')
    learnFrom('facility-two', problem(503, 'DUTY_ROSTER_NOT_AVAILABLE'))
    expect(dutyRosterServed('facility-two')).toBe(true)
    // A dropped connection says nothing either way.
    learnFrom('facility-three', new HidApiError(0, 'offline', { code: 'NETWORK_ERROR' }))
    expect(dutyRosterServed('facility-three')).toBeNull()
  })

  it('names people, never by id', () => {
    const names = new Map<string, string | null>([[ADA, 'Ada Fictional'], [BOLA, null]])
    expect(personText(ADA.toUpperCase(), names)).toBe('Ada Fictional')
    expect(personText(BOLA, names)).toBe('Former staff member')
    expect(personText('c0000000-0000-4000-8000-0000000000c3', names)).toBe('A staff member here')
    expect(personText(ADA, names, ADA)).toBe('You')
  })
})
