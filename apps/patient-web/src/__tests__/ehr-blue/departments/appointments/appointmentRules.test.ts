import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  APPOINTMENT_REFUSALS, CHECK_IN_REFUSED, NOT_AVAILABLE, READ_REFUSED, SETTINGS_REFUSED, WRITE_REFUSED, addDays,
  appointmentsServed, canCheckIn, canRead, canWrite, changeReasonProblem, checkInOffered, clinicianText, dayText,
  departmentText, forgetAppointmentsServed, handPatient, hasStarted, historyText, isDay, lagosParts, lagosStartsAt,
  lagosTime, lagosToday, learnFrom, notServed, refusalWords, statusText, takeHandedPatient, timeProblem, timeRangeText,
  visitTypeText, whenText,
} from '../../../../ehr-blue/departments/appointments/appointmentRules'

/*
 * Appointments' plain words and Lagos times (hid-system APPT-1). The device here is set to New York, far from Lagos:
 * every day and time must still be Lagos's. Every id and name is fictional.
 */
beforeAll(() => { process.env.TZ = 'America/New_York' })
afterEach(() => forgetAppointmentsServed())

const refused = (status: number, code: string) => new HidApiError(status, 'Refused.', { code })

describe('Lagos time, whatever the device’s zone', () => {
  it('books a Lagos day and time as the right moment in UTC', () => {
    expect(new Date('2026-12-03T12:00:00Z').getTimezoneOffset()).toBe(300)
    expect(lagosStartsAt('2026-12-03', '09:00')).toBe('2026-12-03T08:00:00.000Z')
    expect(lagosStartsAt('2026-12-03', '00:30')).toBe('2026-12-02T23:30:00.000Z')
    expect(lagosStartsAt('2026-02-30', '09:00')).toBeNull()
    expect(lagosStartsAt('2026-12-03', '9:00')).toBeNull()
  })

  it('shows a moment as its Lagos day and time', () => {
    expect(lagosTime('2026-12-03T08:00:00.000Z')).toBe('09:00')
    expect(lagosParts('2026-12-02T23:30:00.000Z')).toEqual({ day: '2026-12-03', time: '00:30' })
    expect(timeRangeText({ startsAt: '2026-12-03T08:00:00.000Z', endsAt: '2026-12-03T08:30:00.000Z' })).toBe('09:00 to 09:30')
    expect(whenText('2026-12-03T08:00:00.000Z')).toBe('Thursday 3 Dec 2026, 09:00')
    expect(dayText('2026-12-03')).toBe('Thursday 3 Dec 2026')
    expect(lagosToday(new Date('2026-12-02T23:30:00.000Z'))).toBe('2026-12-03')
  })

  it('steps days and checks the form’s time', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(isDay('2026-12-03')).toBe(true)
    expect(isDay('2026-13-03')).toBe(false)
    expect(timeProblem('')).toBe('missing')
    expect(timeProblem('09:07')).toBe('step')
    expect(timeProblem('09:05')).toBeNull()
  })

  it('offers check-in only on the appointment’s own Lagos day, from booked or a no-show', () => {
    expect(checkInOffered({ status: 'booked', appointmentDay: '2026-12-03' }, '2026-12-03')).toBe(true)
    expect(checkInOffered({ status: 'no_show', appointmentDay: '2026-12-03' }, '2026-12-03')).toBe(true)
    expect(checkInOffered({ status: 'booked', appointmentDay: '2026-12-04' }, '2026-12-03')).toBe(false)
    expect(checkInOffered({ status: 'cancelled', appointmentDay: '2026-12-03' }, '2026-12-03')).toBe(false)
    expect(checkInOffered({ status: 'checked_in', appointmentDay: '2026-12-03' }, '2026-12-03')).toBe(false)
    expect(hasStarted({ startsAt: '2026-12-03T08:00:00.000Z' }, new Date('2026-12-03T08:00:01.000Z'))).toBe(true)
    expect(hasStarted({ startsAt: '2026-12-03T08:00:00.000Z' }, new Date('2026-12-03T07:59:00.000Z'))).toBe(false)
  })
})

describe('who may do what', () => {
  it('follows the backend’s codes: the front desk, clinicians and doctors book; nurses see', () => {
    const desk = ['ehr.appointment.read', 'ehr.appointment.write', 'ehr.encounter.read', 'ehr.encounter.write']
    expect(canRead(desk) && canWrite(desk) && canCheckIn(desk)).toBe(true)
    expect(canWrite(['ehr.appointment.read'])).toBe(false)
    expect(canCheckIn(['ehr.appointment.write', 'ehr.encounter.read'])).toBe(false)
    expect(canRead(['organization.manage'])).toBe(false)
  })
})

describe('plain words', () => {
  it('names statuses, visit types and departments, never by their codes', () => {
    expect(statusText('no_show')).toBe('No-show')
    expect(statusText('checked_in')).toBe('Checked in')
    expect(statusText('something_new')).toBe('Status not known')
    expect(visitTypeText('results_review')).toBe('Results review')
    expect(departmentText('general_outpatient')).toBe('General Outpatient')
    expect(departmentText('eye_clinic')).toBe('Eye clinic')
  })

  it('says every refusal in the contract’s words, and never “permission”', () => {
    for (const text of [...Object.values(APPOINTMENT_REFUSALS), READ_REFUSED, WRITE_REFUSED, CHECK_IN_REFUSED, SETTINGS_REFUSED]) {
      expect(text).not.toMatch(/permission/i)
    }
    expect(refusalWords(refused(409, 'APPOINTMENT_CLINICIAN_CLASH'), 'x'))
      .toBe('This clinician already has an appointment at this time. Choose another time or clinician.')
    expect(refusalWords(refused(403, 'APPOINTMENT_NOT_ALLOWED'), 'x', 'write')).toBe(WRITE_REFUSED)
    expect(refusalWords(refused(403, 'PERMISSION_DENIED'), 'x', 'check-in')).toBe(CHECK_IN_REFUSED)
    expect(refusalWords(refused(403, 'APPOINTMENT_NOT_ALLOWED'), 'x', 'settings')).toBe(SETTINGS_REFUSED)
    expect(refusalWords(refused(503, 'APPOINTMENTS_NOT_AVAILABLE'), 'x')).toBe(NOT_AVAILABLE)
    expect(refusalWords(refused(500, 'SOMETHING_ELSE'), 'The fallback.')).toBe('The fallback.')
    expect(refusalWords(new Error('boom'), 'The fallback.')).toBe('The fallback.')
  })

  it('tells "not served" from an appointment that does not exist', () => {
    expect(notServed(refused(404, 'NOT_FOUND'))).toBe(true)
    expect(notServed(refused(503, 'APPOINTMENTS_NOT_AVAILABLE'))).toBe(true)
    expect(notServed(refused(404, 'APPOINTMENT_NOT_FOUND'))).toBe(false)
    expect(notServed(refused(503, 'SERVICE_UNAVAILABLE'))).toBe(false)
  })

  it('asks for a change reason of 8 to 500 characters, counted trimmed', () => {
    expect(changeReasonProblem('  short  ')).toMatch(/at least 8/)
    expect(changeReasonProblem('Patient asked to come later')).toBeNull()
    expect(changeReasonProblem('x'.repeat(501))).toMatch(/500/)
  })

  it('says history and who in words, never a membership id', () => {
    expect(historyText({ kind: 'rescheduled', at: '', byMembershipId: null, fromStartsAt: '2026-12-03T08:00:00.000Z',
      toStartsAt: '2026-12-04T09:30:00.000Z', fromClinicianMembershipId: null, toClinicianMembershipId: null, reason: null }))
      .toBe('Moved from Thursday 3 Dec 2026, 09:00 to Friday 4 Dec 2026, 10:30')
    expect(historyText({ kind: 'no_show_undone', at: '', byMembershipId: null, fromStartsAt: null, toStartsAt: null,
      fromClinicianMembershipId: null, toClinicianMembershipId: null, reason: null })).toMatch(/No-show undone/)
    const names = new Map<string, string | null>([['m-1', 'Dr Fiction Ade'], ['m-2', null]])
    expect(clinicianText('M-1', names, 'm-9')).toBe('Dr Fiction Ade')
    expect(clinicianText('m-2', names, 'm-9')).toBe('Former staff member')
    expect(clinicianText('m-3', names, 'm-9')).toBe('A staff member here')
    expect(clinicianText('m-9', names, 'm-9')).toBe('You')
    expect(clinicianText(null, names, 'm-9')).toBe('Any clinician in the clinic')
  })
})

describe('what the page learns and hands on, in memory only', () => {
  it('learns "not served" from a 404 or 503 only until an answer says served', () => {
    expect(appointmentsServed()).toBeNull()
    learnFrom(refused(503, 'APPOINTMENTS_NOT_AVAILABLE'))
    expect(appointmentsServed()).toBe(false)
    learnFrom()
    expect(appointmentsServed()).toBe(true)
    learnFrom(refused(404, 'NOT_FOUND'))
    expect(appointmentsServed()).toBe(true)
  })

  it('hands a patient to New appointment once, for the same facility only', () => {
    handPatient({ patientId: 'b0000000-0000-4000-8000-00000000b001', fullName: 'Testa Bookperson', facilityId: 'f-1' })
    expect(takeHandedPatient('f-2')).toBeNull()
    expect(takeHandedPatient('f-1')).toBeNull()
    handPatient({ patientId: 'b0000000-0000-4000-8000-00000000b001', fullName: 'Testa Bookperson', facilityId: 'f-1' })
    expect(takeHandedPatient('f-1')?.fullName).toBe('Testa Bookperson')
    expect(takeHandedPatient('f-1')).toBeNull()
  })
})
