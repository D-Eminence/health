import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  asNeededReasons, balanceText, doseDiffers, gcsText, lagosInput, lagosInputToIso, meanArterialPressure, notServed, observationLines,
  patientFacts, patientName, refusalWords, isChartAccessRefusal,
} from '../../../../ehr-blue/departments/nursing/nursingRules'
import { observationBody } from '../../../../ehr-blue/departments/nursing/Observations'
import { fluidBody } from '../../../../ehr-blue/departments/nursing/FluidBalance'
import { currentShift } from '../../../../ehr-blue/departments/nursing/Handover'
import { card, hiddenCard, shift } from './nursingFixtures'

vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

/* The nursing pages' rules on their own: Lagos time both ways, names under Q190 A, observations and fluid entries as the
 * backend checks them, the shift on now, and refusals in plain words. Every value here is fictional. */
const fail = (status: number, code: string) => new HidApiError(status, 'Refused', { code, retryable: false })
const draft = (overrides: Record<string, unknown> = {}) => ({ time: '2026-12-03T10:15', systolic: '', diastolic: '', pulse: '', breathing: '',
  saturation: '', temperature: '', pain: '', avpu: '', glucose: '', device: '', flow: '', fio2: '', eye: '', verbal: '', motor: '',
  verbalNotTestable: false, ...overrides })

describe('Lagos time', () => {
  it('reads a datetime field as Lagos time (UTC+1) and writes a moment back the same way, whatever the device zone', () => {
    expect(lagosInputToIso('2026-12-03T00:30')).toBe('2026-12-02T23:30:00.000Z')
    expect(lagosInputToIso('2026-12-31T23:59')).toBe('2026-12-31T22:59:00.000Z')
    expect(lagosInput('2026-12-02T23:30:00.000Z')).toBe('2026-12-03T00:30')
    expect(lagosInputToIso('2026-02-30T10:00')).toBeNull()
    expect(lagosInputToIso('3/12/2026 10:00')).toBeNull()
    expect(lagosInputToIso('')).toBeNull()
  })
})

describe('names on ward lists (Q190 A)', () => {
  it('shows the full name only where the chart can be read, else the initials, sex, age and NIN status', () => {
    expect(patientName(card())).toBe('Ada Wardone')
    expect(patientName(hiddenCard())).toBe('B T')
    expect(patientFacts(card() as never)).toBe('Female · 54 years · NIN Verified')
    expect(patientFacts({ ...hiddenCard(), ageEstimated: true } as never)).toBe('Female · about 61 years · NIN Not Verified')
  })
})

describe('an "as needed" dose (0175 ehr.mar_record)', () => {
  const prn = (overrides: Record<string, unknown> = {}) => ({ asNeeded: { reason: 'Pain or fever', minIntervalMinutes: 240, maxDosesPer24h: 4,
    givenLast24h: 1 }, lastGivenAt: '2026-12-03T07:00:00.000Z', ...overrides })
  const at = (time: string) => `2026-12-03T${time}:00.000Z`

  it('is sooner than ordered from the time entered, either side of a dose given, not from now', () => {
    // Last given 08:00 Lagos (07:00Z), 4-hourly: a dose entered for 11:00 Lagos is inside the gap even when it is 13:00 now.
    expect(asNeededReasons(prn(), [at('07:00')], at('10:00')).insideGap).toBe(true)
    expect(asNeededReasons(prn(), [at('07:00')], at('11:00')).insideGap).toBe(false)
    // A dose entered before one already given is inside its gap too (the server looks both ways).
    expect(asNeededReasons(prn({ lastGivenAt: at('10:00') }), [at('10:00')], at('07:00')).insideGap).toBe(true)
    // The order's last given time counts even when the dose is older than the page read.
    expect(asNeededReasons(prn({ lastGivenAt: at('08:00') }), [], at('10:00')).insideGap).toBe(true)
    expect(asNeededReasons(prn(), [at('07:00')], null)).toEqual({ insideGap: false, overMax: false })
    expect(asNeededReasons({ asNeeded: null, lastGivenAt: at('07:00') }, [at('07:00')], at('07:30'))).toEqual({ insideGap: false, overMax: false })
  })

  it('is more often than ordered only with the most doses given in the 24 hours up to the time entered', () => {
    const four = ['2026-12-02T10:30:00.000Z', at('00:00'), at('04:00'), at('08:00')]
    // At 10:00Z yesterday's 10:30Z dose is still in the 24 hours; at 10:45Z it is not, whatever the read counted.
    expect(asNeededReasons(prn({ lastGivenAt: at('08:00'), asNeeded: { ...prn().asNeeded, givenLast24h: 4 } }), four, at('12:00')).overMax).toBe(false)
    expect(asNeededReasons(prn({ lastGivenAt: at('08:00') }), four, '2026-12-03T10:00:00.000Z').overMax).toBe(true)
    expect(asNeededReasons(prn({ lastGivenAt: at('08:00') }), four, '2026-12-03T10:45:00.000Z').overMax).toBe(false)
  })

  it('compares a dose given with the order as the server does: the unit in any case', () => {
    const order = { dose: { quantity: 500, unit: 'mg' } }
    expect(doseDiffers(order, '500', ' MG ')).toBe(false)
    expect(doseDiffers(order, '250', 'mg')).toBe(true)
    expect(doseDiffers(order, '500', 'g')).toBe(true)
    expect(doseDiffers({ dose: null }, '1', 'tablet')).toBe(false)
  })
})

describe('observations (Q199 A: values only, no score)', () => {
  it('works out MAP and the GCS total as plain arithmetic, VT with no total', () => {
    expect(meanArterialPressure({ systolicMmhg: 120, diastolicMmhg: 80 })).toBe(93)
    expect(meanArterialPressure({ systolicMmhg: 120 })).toBeNull()
    expect(gcsText({ gcsEye: 4, gcsVerbal: 5, gcsMotor: 6 })).toBe('E4 V5 M6 (15)')
    expect(gcsText({ gcsEye: 2, gcsVerbalNotTestable: true, gcsMotor: 4 })).toBe('E2 VT M4')
    expect(gcsText({ gcsEye: 2 })).toBeNull()
    expect(observationLines({ oxygenDevice: 'room_air', fio2Percent: 21, temperatureC: 37.8 }).map(line => line.text))
      .toEqual(['37.8 °C', 'Room air (FiO2 21%)'])
  })

  it('checks a reading as the backend does before it is sent', () => {
    expect(observationBody(draft())).toEqual({ problem: 'Enter at least one value.' })
    expect(observationBody(draft({ time: '' }))).toEqual({ problem: 'Enter the time of the reading.' })
    expect(observationBody(draft({ device: 'room_air', flow: '2' }))).toEqual({ problem: 'Enter the flow or FiO2 with an oxygen device, or 21% on room air.' })
    expect(observationBody(draft({ device: 'room_air', fio2: '40' }))).toEqual({ problem: 'Enter the flow or FiO2 with an oxygen device, or 21% on room air.' })
    expect(observationBody(draft({ fio2: '40' }))).toEqual({ problem: 'Enter the flow or FiO2 with an oxygen device, or 21% on room air.' })
    expect(observationBody(draft({ device: 'venturi_mask', fio2: '18' }))).toEqual({ problem: 'FiO2 is 21% to 100%.' })
    expect(observationBody(draft({ eye: '3', motor: '5' }))).toEqual({ problem: 'Enter all three GCS parts, or mark the verbal part as not testable.' })
    expect(observationBody(draft({ pain: '11' }))).toEqual({ problem: 'Check pain: 0 to 10.' })
    expect(observationBody(draft({ glucose: '6.25', device: 'room_air', fio2: '21', eye: '4', verbal: '5', motor: '6' }))).toEqual({
      values: { bloodGlucoseMmolL: 6.3, oxygenDevice: 'room_air', fio2Percent: 21, gcsEye: 4, gcsMotor: 6, gcsVerbal: 5 },
      recordedAt: '2026-12-03T09:15:00.000Z',
    })
  })
})

describe('fluid entries (FLUID_ENTRY_INVALID)', () => {
  const now = Date.parse('2026-12-03T12:00:00.000Z')
  const entry = (overrides: Record<string, unknown> = {}) => ({ direction: 'in' as const, kind: 'oral', volume: '200', notMeasured: false,
    time: '2026-12-03T12:30', note: '', ...overrides })
  it('takes an amount in mL or "not measured", within the last 24 hours', () => {
    expect(fluidBody(entry(), now)).toEqual({ direction: 'in', kind: 'oral', volumeMl: 200, recordedAt: '2026-12-03T11:30:00.000Z' })
    expect(fluidBody(entry({ volume: '', notMeasured: true, note: ' Spilt ' }), now))
      .toEqual({ direction: 'in', kind: 'oral', notMeasured: true, recordedAt: '2026-12-03T11:30:00.000Z', note: 'Spilt' })
    expect(fluidBody(entry({ volume: '0' }), now)).toEqual({ problem: 'Enter the amount in mL, or mark it as not measured.' })
    expect(fluidBody(entry({ volume: '12.5' }), now)).toEqual({ problem: 'Enter the amount in mL, or mark it as not measured.' })
    expect(fluidBody(entry({ kind: 'urine' }), now)).toEqual({ problem: 'Choose what it was.' })
    expect(fluidBody(entry({ time: '2026-12-02T10:00' }), now)).toEqual({ problem: 'The time can be up to 24 hours ago, and not in the future.' })
    expect(fluidBody(entry({ time: '2026-12-03T15:00' }), now)).toEqual({ problem: 'The time can be up to 24 hours ago, and not in the future.' })
    expect(balanceText(-250)).toBe('−250 mL')
    expect(balanceText(0)).toBe('0 mL')
    expect(balanceText(120)).toBe('+120 mL')
  })
})

describe('the shift on now', () => {
  const night = shift({ shiftId: 'night', name: 'Night', startsAt: '20:30', endsAt: '08:00', crossesMidnight: true })
  const morning = shift()
  it('finds the shift on now in Lagos, and a night shift after midnight started the day before', () => {
    // 09:00 UTC is 10:00 in Lagos: the morning shift, today.
    expect(currentShift([night, morning], Date.parse('2026-12-03T09:00:00.000Z'))).toEqual({ shiftId: morning.shiftId, date: '2026-12-03' })
    // 01:00 UTC is 02:00 in Lagos on 3 Dec: the night that started on 2 Dec.
    expect(currentShift([night, morning], Date.parse('2026-12-03T01:00:00.000Z'))).toEqual({ shiftId: 'night', date: '2026-12-02' })
    // 22:00 UTC on 2 Dec is 23:00 in Lagos: the night that started that day.
    expect(currentShift([night, morning], Date.parse('2026-12-02T22:00:00.000Z'))).toEqual({ shiftId: 'night', date: '2026-12-02' })
    // 14:00 UTC is 15:00 in Lagos: no shift is on.
    expect(currentShift([night, morning], Date.parse('2026-12-03T14:00:00.000Z'))).toBeNull()
    expect(currentShift([{ ...morning, active: false }], Date.parse('2026-12-03T09:00:00.000Z'))).toBeNull()
  })
})

describe('refusals', () => {
  it('knows when nursing is not served (an ehr-api before it, or a flag off) from a record that is not found', () => {
    expect(notServed(fail(503, 'NURSING_NOT_AVAILABLE'))).toBe(true)
    expect(notServed(fail(503, 'INPATIENT_NOT_AVAILABLE'))).toBe(true)
    expect(notServed(fail(404, 'NOT_FOUND'))).toBe(true)
    expect(notServed(fail(404, 'API_ROUTE_NOT_FOUND'))).toBe(true)
    expect(notServed(fail(404, 'TASK_NOT_FOUND'))).toBe(false)
    expect(notServed(fail(503, 'SERVICE_UNAVAILABLE'))).toBe(false)
    expect(notServed(new Error('offline'))).toBe(false)
  })

  it('says every refusal in plain words, never "permission"', () => {
    expect(refusalWords(fail(503, 'NURSING_NOT_AVAILABLE'), 'x')).toBe('The medicine round and nursing tasks are not switched on yet.')
    expect(refusalWords(fail(503, 'INPATIENT_NOT_AVAILABLE'), 'x')).toBe('Inpatient care is not switched on yet.')
    expect(refusalWords(fail(412, 'NURSING_VERSION_CONFLICT'), 'x')).toBe('Someone else changed this. Reload it and try again.')
    expect(refusalWords(fail(403, 'MAR_RECORD_NOT_ALLOWED'), 'x')).toBe('Only nurses, clinicians and doctors can record doses.')
    expect(refusalWords(fail(403, 'SOMETHING_NEW'), 'x')).toBe('Only nurses, clinicians and doctors of this facility can use the medicine round and nursing tasks.')
    expect(refusalWords(fail(409, 'ADMISSION_NOT_OPEN'), 'x')).toBe('This patient has been discharged. The record can still be read.')
    expect(refusalWords(fail(409, 'SHIFT_NAME_TAKEN'), 'x')).toBe('This name is already used. Choose another.')
    expect(isChartAccessRefusal(fail(403, 'CHART_ACCESS_REQUIRED'))).toBe(true)
    expect(isChartAccessRefusal(fail(403, 'ADMISSION_CHART_ACCESS_REQUIRED'))).toBe(true)
    expect(isChartAccessRefusal(fail(403, 'NURSING_NOT_ALLOWED'))).toBe(false)
    for (const code of ['NURSING_NOT_ALLOWED', 'SHIFT_SETUP_NOT_ALLOWED', 'SHIFT_ASSIGN_NOT_ALLOWED', 'CHART_ACCESS_REQUIRED', 'HANDOVER_NOT_YOURS']) {
      expect(refusalWords(fail(403, code), 'x')).not.toMatch(/permission/i)
    }
  })
})
