import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  BP_PAIR, OXYGEN_RULE, asNeededReasons, balanceText, doseDiffers, gcsText, lagosInput, lagosInputToIso, meanArterialPressure, memberText, notServed,
  observationLines, oneLine, patientFacts, patientName, refusalWords, isChartAccessRefusal,
} from '../../../../ehr-blue/departments/nursing/nursingRules'
import { BOTH_BP } from '../../../../ehr-blue/clinical/triage/vitals'
import { observationBody } from '../../../../ehr-blue/departments/nursing/Observations'
import { fluidBody } from '../../../../ehr-blue/departments/nursing/FluidBalance'
import { currentShift } from '../../../../ehr-blue/departments/nursing/Handover'
import { COLLEAGUE, ME, card, hiddenCard, shift } from './nursingFixtures'

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

  it('says a one-year-old is 1 year old', () => {
    expect(patientFacts(card({ sex: 'male', ageYears: 1 }) as never)).toBe('Male · 1 year · NIN Verified')
    expect(patientFacts(card({ sex: 'male', ageYears: 1, ageEstimated: true }) as never)).toBe('Male · about 1 year · NIN Verified')
    expect(patientFacts(card({ ageYears: 0 }) as never)).toBe('Female · 0 years · NIN Verified')
  })
})

describe('who a member is (SX-9)', () => {
  it('says "Former staff member" where SX-9 answered no name, and "A staff member here" only while no name is read', () => {
    const names = new Map<string, string | null>([[COLLEAGUE, null], ['70000000-0000-4000-8000-000000000072', 'Ngozi Nurseone']])
    expect(memberText(COLLEAGUE, ME, names)).toBe('Former staff member')
    expect(memberText(COLLEAGUE.toUpperCase(), ME, names)).toBe('Former staff member')
    expect(memberText('70000000-0000-4000-8000-000000000072', ME, names)).toBe('Ngozi Nurseone')
    expect(memberText('70000000-0000-4000-8000-000000000073', ME, names)).toBe('A staff member here')
    expect(memberText(ME, ME, names)).toBe('You')
    expect(memberText(null, ME, names)).toBe('Not assigned')
  })
})

describe('free text kept on one line (0175, 0176: no control character)', () => {
  it('turns each run of line breaks, tabs, spaces and other control characters into one space', () => {
    expect(oneLine('BP 85/50.\nRecheck at 10:00')).toBe('BP 85/50. Recheck at 10:00')
    expect(oneLine('  Wrong bag\r\n\r\n charted\t here\u0007 ')).toBe('Wrong bag charted here')
    expect(oneLine('\n\n')).toBe('')
    // Nothing the database refuses is left: 0175 and 0176 test '[[:cntrl:]]'.
    expect(oneLine('a\u0000b\u001fc\u007fd\u0085e')).not.toMatch(/\p{Cc}/u)
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
    expect(observationBody(draft({ device: 'room_air', flow: '2' }))).toEqual({ problem: OXYGEN_RULE })
    expect(observationBody(draft({ device: 'room_air', fio2: '40' }))).toEqual({ problem: OXYGEN_RULE })
    expect(observationBody(draft({ fio2: '40' }))).toEqual({ problem: OXYGEN_RULE })
    expect(observationBody(draft({ flow: '2' }))).toEqual({ problem: OXYGEN_RULE })
    expect(observationBody(draft({ device: 'venturi_mask', fio2: '18' }))).toEqual({ problem: 'FiO2 is 21% to 100%.' })
    expect(observationBody(draft({ eye: '3', motor: '5' }))).toEqual({ problem: 'Enter all three GCS parts, or mark the verbal part as not testable.' })
    expect(observationBody(draft({ pain: '11' }))).toEqual({ problem: 'Check pain: 0 to 10.' })
    expect(observationBody(draft({ glucose: '6.2', device: 'room_air', fio2: '21', eye: '4', verbal: '5', motor: '6' }))).toEqual({
      values: { bloodGlucoseMmolL: 6.2, oxygenDevice: 'room_air', fio2Percent: 21, gcsEye: 4, gcsMotor: 6, gcsVerbal: 5 },
      recordedAt: '2026-12-03T09:15:00.000Z',
    })
  })

  it('asks for both parts of a blood pressure, or neither, in Triage & Vitals’ words (BLOOD_PRESSURE_INCOMPLETE)', () => {
    expect(observationBody(draft({ systolic: '120' }))).toEqual({ problem: BOTH_BP })
    expect(observationBody(draft({ diastolic: '80', pulse: '72' }))).toEqual({ problem: BOTH_BP })
    expect(BOTH_BP).toBe('Enter both systolic and diastolic blood pressure, or leave both blank.')
    // The refusal's words are Triage & Vitals' own.
    expect(BP_PAIR).toBe(BOTH_BP)
    expect(observationBody(draft({ systolic: '120', diastolic: '80' }))).toEqual({ values: { systolicMmhg: 120, diastolicMmhg: 80 },
      recordedAt: '2026-12-03T09:15:00.000Z' })
  })

  it('takes every reading the backend and Triage & Vitals take: critical values, and an oxygen device on its own', () => {
    const at = '2026-12-03T09:15:00.000Z'
    expect(observationBody(draft({ saturation: '45' }))).toEqual({ values: { oxygenSaturationPercent: 45 }, recordedAt: at })
    expect(observationBody(draft({ saturation: '0' }))).toEqual({ values: { oxygenSaturationPercent: 0 }, recordedAt: at })
    expect(observationBody(draft({ temperature: '29' }))).toEqual({ values: { temperatureC: 29 }, recordedAt: at })
    expect(observationBody(draft({ temperature: '20' }))).toEqual({ values: { temperatureC: 20 }, recordedAt: at })
    expect(observationBody(draft({ pulse: '15', breathing: '95' }))).toEqual({ values: { pulseBpm: 15, respiratoryRate: 95 }, recordedAt: at })
    expect(observationBody(draft({ systolic: '320', diastolic: '230' }))).toEqual({ values: { systolicMmhg: 320, diastolicMmhg: 230 }, recordedAt: at })
    expect(observationBody(draft({ device: 'ventilator' }))).toEqual({ values: { oxygenDevice: 'ventilator' }, recordedAt: at })
    expect(observationBody(draft({ device: 'nasal_cannula' }))).toEqual({ values: { oxygenDevice: 'nasal_cannula' }, recordedAt: at })
    expect(observationBody(draft({ device: 'ventilator', fio2: '40' }))).toEqual({ values: { oxygenDevice: 'ventilator', fio2Percent: 40 }, recordedAt: at })
    // Past the backend's limits (VitalMeasurementsDto), each named.
    expect(observationBody(draft({ saturation: '101' }))).toEqual({ problem: 'Check oxygen saturation: 0 to 100.' })
    expect(observationBody(draft({ temperature: '19.9' }))).toEqual({ problem: 'Check temperature: 20 to 50.' })
    expect(observationBody(draft({ pulse: '351' }))).toEqual({ problem: 'Check pulse: 10 to 350.' })
    expect(observationBody(draft({ breathing: '0' }))).toEqual({ problem: 'Check breathing rate: 1 to 100.' })
    expect(observationBody(draft({ systolic: '29', diastolic: '20' }))).toEqual({ problem: 'Check systolic: 30 to 350.' })
    expect(observationBody(draft({ systolic: '120', diastolic: '251' }))).toEqual({ problem: 'Check diastolic: 10 to 250.' })
  })

  it('checks the decimals the backend takes, naming the field, before it is sent', () => {
    expect(observationBody(draft({ pulse: '72.5' }))).toEqual({ problem: 'Enter pulse as a whole number.' })
    expect(observationBody(draft({ breathing: '18.5' }))).toEqual({ problem: 'Enter breathing rate as a whole number.' })
    expect(observationBody(draft({ systolic: '120.5', diastolic: '80' }))).toEqual({ problem: 'Enter systolic as a whole number.' })
    expect(observationBody(draft({ pain: '3.5' }))).toEqual({ problem: 'Enter pain as a whole number.' })
    expect(observationBody(draft({ temperature: '36.65' }))).toEqual({ problem: 'Enter temperature to one decimal place.' })
    expect(observationBody(draft({ glucose: '6.25' }))).toEqual({ problem: 'Enter blood glucose to one decimal place.' })
    expect(observationBody(draft({ saturation: '93.555' }))).toEqual({ problem: 'Enter oxygen saturation to two decimal places.' })
    expect(observationBody(draft({ device: 'nasal_cannula', flow: '2.25' }))).toEqual({ problem: 'Enter oxygen flow to one decimal place.' })
    expect(observationBody(draft({ device: 'venturi_mask', fio2: '40.5' }))).toEqual({ problem: 'Enter FiO2 as a whole number.' })
    expect(observationBody(draft({ temperature: '36.6', saturation: '93.25', device: 'nasal_cannula', flow: '1.5' }))).toEqual({
      values: { temperatureC: 36.6, oxygenSaturationPercent: 93.25, oxygenDevice: 'nasal_cannula', oxygenFlowLPerMin: 1.5 },
      recordedAt: '2026-12-03T09:15:00.000Z' })
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
    // A note over two lines goes on one: 0176 ehr.fluid_balance_record refuses a line break.
    expect(fluidBody(entry({ note: 'Sipped slowly.\nTolerated well.' }), now))
      .toEqual({ direction: 'in', kind: 'oral', volumeMl: 200, recordedAt: '2026-12-03T11:30:00.000Z', note: 'Sipped slowly. Tolerated well.' })
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
    expect(refusalWords(fail(400, 'BLOOD_PRESSURE_INCOMPLETE'), 'x')).toBe('Enter both systolic and diastolic blood pressure, or leave both blank.')
    expect(refusalWords(fail(400, 'OXYGEN_FIELDS_INVALID'), 'x')).toBe(OXYGEN_RULE)
    expect(isChartAccessRefusal(fail(403, 'CHART_ACCESS_REQUIRED'))).toBe(true)
    expect(isChartAccessRefusal(fail(403, 'ADMISSION_CHART_ACCESS_REQUIRED'))).toBe(true)
    expect(isChartAccessRefusal(fail(403, 'NURSING_NOT_ALLOWED'))).toBe(false)
    for (const code of ['NURSING_NOT_ALLOWED', 'SHIFT_SETUP_NOT_ALLOWED', 'SHIFT_ASSIGN_NOT_ALLOWED', 'CHART_ACCESS_REQUIRED', 'HANDOVER_NOT_YOURS']) {
      expect(refusalWords(fail(403, code), 'x')).not.toMatch(/permission/i)
    }
  })
})
