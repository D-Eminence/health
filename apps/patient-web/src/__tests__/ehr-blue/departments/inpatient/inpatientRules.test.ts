import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  INPATIENT_REFUSALS, NOT_AVAILABLE, ageText, canAllocate, canDecide, canManageWards, canPrintBand, canReadWards, canSetBedStatus,
  cardName, censusRange, daysText, forgetInpatientServed, inpatientServed, lagosInputToUtc, learnFrom, lengthProblem,
  memberText, movementText, ninText, notServed, outcomeText, refusalWords, utcToLagosInput,
} from '../../../../ehr-blue/departments/inpatient/inpatientRules'
import { bedMoves } from '../../../../ehr-blue/departments/inpatient/BedBoard'
import {
  dischargeBody, dischargeMedicines, freeBeds, needsPreparing, needsSummary, sexDiffers,
} from '../../../../ehr-blue/departments/inpatient/AdmissionRecord'
import type { Ward } from '../../../../staff/api'

vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

/*
 * The inpatient pages' rules (hid-system ADT-1): who may do what, names on ward lists (Q190 A), Lagos time whatever the
 * device's zone, the discharge's checks, the free beds and the refusals in plain words. Every name and id is fictional.
 */

const problem = (status: number, code: string) => new HidApiError(status, code, { code, retryable: false })

const NURSE = ['ehr.ward.read', 'ehr.admission.read', 'ehr.bed.allocate', 'ehr.wristband.print']
const DOCTOR = [...NURSE, 'ehr.admission.decide']
const ADMIN = ['ehr.ward.manage']

describe('who may do what (0173)', () => {
  it('lets nurses give beds and print bands, doctors and clinicians also decide, and admins set up wards', () => {
    expect([canReadWards(NURSE), canAllocate(NURSE), canPrintBand(NURSE), canDecide(NURSE)]).toEqual([true, true, true, false])
    expect(canDecide(DOCTOR)).toBe(true)
    expect([canReadWards(ADMIN), canManageWards(ADMIN), canSetBedStatus(ADMIN), canDecide(ADMIN)]).toEqual([false, true, true, false])
    expect(canSetBedStatus(NURSE)).toBe(true)
    // Front desk, lab, pharmacy, cashier: nothing.
    expect(canReadWards(['ehr.encounter.read', 'lab.work-item.read'])).toBe(false)
    expect(canSetBedStatus(['ehr.ward.read'])).toBe(false)
  })
})

describe('names on ward lists (Q190 A)', () => {
  const base = { fullName: 'Ada Wardone', nameHidden: false, initials: 'A W', unknownLabel: null }
  it('shows the name only where the card gives it, else the initials, and an unknown record by its label', () => {
    expect(cardName(base)).toBe('Ada Wardone')
    expect(cardName({ ...base, fullName: null, nameHidden: true })).toBe('A W')
    expect(cardName({ ...base, fullName: 'Unknown patient U-0007', unknownLabel: 'Unknown patient U-0007' })).toBe('Unknown patient U-0007')
    expect(cardName({ ...base, fullName: null, nameHidden: true, initials: '' })).toBe('Patient')
  })
  it('says age, an estimate, the NIN status in its own words and the day of the stay', () => {
    expect(ageText({ ageYears: 54, ageEstimated: false })).toBe('54 years')
    expect(ageText({ ageYears: 1, ageEstimated: true })).toBe('About 1 year')
    expect(ageText({ ageYears: null, ageEstimated: false })).toBe('')
    expect(ninText('verified')).toBe('NIN Verified')
    expect(ninText('not_verified')).toBe('NIN Not Verified')
    expect(ninText(null)).toBe('')
    expect(daysText(0)).toBe('Day 1')
    expect(daysText(2)).toBe('Day 3')
    expect(daysText(null)).toBe('')
  })
  it('names staff by SX-9’s names, "You" for the member, never an id', () => {
    const names = new Map([['m-2', 'Dr Ngozi Fiction']])
    expect(memberText('M-1', 'm-1', names)).toBe('You')
    expect(memberText('m-2', 'm-1', names)).toBe('Dr Ngozi Fiction')
    expect(memberText('m-3', 'm-1', names)).toBe('A staff member here')
    expect(memberText(null, 'm-1', names)).toBe('')
  })
})

describe('Lagos time, whatever the device’s zone (P2-4)', () => {
  it('reads a field as Lagos time (UTC+1, no daylight saving) and writes one back', () => {
    expect(lagosInputToUtc('2026-12-03T14:05')).toBe('2026-12-03T13:05:00.000Z')
    expect(lagosInputToUtc('2026-12-01T00:30')).toBe('2026-11-30T23:30:00.000Z')
    expect(lagosInputToUtc('2026-02-30T10:00')).toBeNull()
    expect(lagosInputToUtc('soon')).toBeNull()
    expect(utcToLagosInput('2026-11-30T23:30:00.000Z')).toBe('2026-12-01T00:30')
  })
  it('lets the census go up to 90 Lagos days back', () => {
    // 23:30 UTC on 30 Nov is already 1 Dec in Lagos.
    expect(censusRange(Date.parse('2026-11-30T23:30:00.000Z'))).toEqual({ min: '2026-09-02', max: '2026-12-01' })
  })
})

describe('the bed board’s hand moves (route 9)', () => {
  it('turns over a cleaning bed, takes an available one out of use or to cleaning, and releases one from maintenance', () => {
    expect(bedMoves('cleaning')).toEqual(['turnover'])
    expect(bedMoves('available')).toEqual(['maintenance', 'clean'])
    expect(bedMoves('maintenance')).toEqual(['release'])
    expect(bedMoves('occupied')).toEqual([])
  })
})

describe('choosing a free bed', () => {
  const ward = (wardId: string, name: string, extra: Partial<Ward> = {}): Ward => ({
    wardId, name, wardType: 'general', takes: 'any', active: true, bedCount: 2, overflowCount: 1, occupied: 1, available: 1, cleaning: 0,
    maintenance: 0, overflowInUse: 0, staffCount: 3, rowVersion: 1, ...extra,
    beds: extra.beds ?? [
      { bedId: `${wardId}-1`, name: 'Bed 1', kind: 'bed', status: 'available', active: true, rowVersion: 1 },
      { bedId: `${wardId}-2`, name: 'Bed 2', kind: 'bed', status: 'occupied', active: true, rowVersion: 1 },
      { bedId: `${wardId}-3`, name: 'Extra mattress 1', kind: 'overflow', status: 'available', active: true, rowVersion: 1 },
      { bedId: `${wardId}-4`, name: 'Bed 4', kind: 'bed', status: 'available', active: false, rowVersion: 1 },
    ],
  })
  it('lists only free beds of open wards, the ward asked for first, overflow spaces named so, and never the current bed', () => {
    const choices = freeBeds([ward('w1', 'Male Ward'), ward('w2', 'ICU A', { wardType: 'icu' }), ward('w3', 'Old Ward', { active: false })],
      { requestedWardId: 'w2', bedId: 'w2-1' })
    expect(choices.map(choice => choice.label)).toEqual(['Overflow: Extra mattress 1 (ICU A)', 'Bed 1 (Male Ward)', 'Overflow: Extra mattress 1 (Male Ward)'])
    expect(choices[1]!.place).toBe('Male Ward, Bed 1')
  })
  it('asks to confirm a ward that takes the other sex only', () => {
    expect(sexDiffers({ takes: 'female' }, 'male')).toBe(true)
    expect(sexDiffers({ takes: 'female' }, 'Female')).toBe(false)
    expect(sexDiffers({ takes: 'any' }, 'male')).toBe(false)
    expect(sexDiffers({ takes: 'male' }, null)).toBe(false)
  })
})

describe('the discharge (route 16)', () => {
  const summary = { presentingProblem: 'Fever and cough', courseInHospital: 'Treated with antibiotics; improved.', proceduresDone: '',
    conditionAtDischarge: 'improved' as const, followUpPlan: '', patientAdvice: 'Finish the tablets.' }
  const empty = { ...summary, presentingProblem: '', courseInHospital: '', conditionAtDischarge: '' as const, patientAdvice: '' }
  const extra = { dischargedAt: '', diedAt: '', referredTo: '', signature: 'SIGN' }
  const now = Date.parse('2026-12-03T12:00:00.000Z')

  it('needs preparing for routine and referred out, and a summary for routine, DAMA and referred out', () => {
    expect(['routine', 'dama', 'referred_out', 'absconded', 'died'].map(value => needsPreparing(value as never))).toEqual([true, false, true, false, false])
    expect(['routine', 'dama', 'referred_out', 'absconded', 'died'].map(value => needsSummary(value as never))).toEqual([true, true, true, false, false])
  })
  it('sends the summary, a Lagos discharge time as UTC, and SIGN', () => {
    expect(dischargeBody('routine', summary, { ...extra, dischargedAt: '2026-12-03T10:15' }, now)).toEqual({
      outcome: 'routine', signature: 'SIGN', dischargedAt: '2026-12-03T09:15:00.000Z',
      summary: { presentingProblem: 'Fever and cough', courseInHospital: 'Treated with antibiotics; improved.', conditionAtDischarge: 'improved',
        patientAdvice: 'Finish the tablets.' },
    })
  })
  it('refuses before sending: no summary, no signature, a time in the future, no time of death, no facility', () => {
    expect(dischargeBody('dama', empty, extra, now)).toBe('Enter the presenting problem.')
    expect(dischargeBody('routine', summary, { ...extra, signature: 'sign' }, now)).toBe('Type SIGN to sign.')
    expect(dischargeBody('routine', summary, { ...extra, dischargedAt: '2026-12-03T14:00' }, now))
      .toBe('The discharge time must be after admission, and not in the future.')
    expect(dischargeBody('died', empty, extra, now)).toBe('Enter the time of death.')
    expect(dischargeBody('died', empty, { ...extra, diedAt: '2026-12-03T13:30' }, now)).toBe('The time of death cannot be in the future.')
    expect(dischargeBody('referred_out', summary, { ...extra, referredTo: 'x' }, now)).toBe('Enter the facility’s name of at least 2 characters.')
  })
  it('sends a death with its time and no summary, and a referral with the facility', () => {
    expect(dischargeBody('died', empty, { ...extra, diedAt: '2026-12-03T05:40' }, now))
      .toEqual({ outcome: 'died', signature: 'SIGN', diedAt: '2026-12-03T04:40:00.000Z' })
    expect(dischargeBody('referred_out', summary, { ...extra, referredTo: ' Fictional Teaching Hospital ' }, now))
      .toMatchObject({ outcome: 'referred_out', referredToFacilityName: 'Fictional Teaching Hospital' })
    expect(dischargeBody('absconded', empty, extra, now)).toEqual({ outcome: 'absconded', signature: 'SIGN' })
  })
  it('offers the stay’s prescriptions but none in error, cancelled or still a draft', () => {
    const records = ['active', 'completed', 'on_hold', 'draft', 'cancelled', 'entered_in_error']
      .map((status, index) => ({ id: `p${index}`, patientId: 'p', encounterId: 'e', createdAt: '', status }))
    expect(dischargeMedicines(records).map(record => record.status)).toEqual(['active', 'completed', 'on_hold'])
  })
})

describe('words', () => {
  it('names the five outcomes and each movement, a reprint with its reason', () => {
    expect(outcomeText('dama')).toBe('Discharged against medical advice')
    expect(outcomeText('unknown')).toBe('Outcome not known')
    expect(movementText({ kind: 'transferred', outcome: null, printNumber: null, reprintReason: null })).toBe('Moved bed')
    expect(movementText({ kind: 'discharged', outcome: 'died', printNumber: null, reprintReason: null })).toBe('Discharged: died')
    expect(movementText({ kind: 'wristband_printed', outcome: null, printNumber: 2, reprintReason: 'lost' }))
      .toBe('Wristband printed again (print 2): the band was lost')
  })
  it('checks lengths and control characters', () => {
    expect(lengthProblem(' ', 1, 300, 'the reason')).toBe('Enter the reason.')
    expect(lengthProblem('abc', 8, 500, 'why')).toBe('Enter why of at least 8 characters.')
    expect(lengthProblem('a'.repeat(81), 2, 80, 'a ward name')).toBe('Keep a ward name to 80 characters.')
    expect(lengthProblem('Ward\u0007', 2, 80, 'a ward name')).toBe('Use letters, numbers and punctuation only.')
    expect(lengthProblem('Line one\nLine two', 1, 2000, 'the plan', true)).toBe('')
  })
})

describe('refusals and whether the routes are served', () => {
  it('says "not switched on yet" for a 503 or an older ehr-api’s 404, but not for an admission not found', () => {
    expect(notServed(problem(503, 'INPATIENT_NOT_AVAILABLE'))).toBe(true)
    expect(notServed(problem(404, 'API_ROUTE_NOT_FOUND'))).toBe(true)
    expect(notServed(problem(404, 'ADMISSION_NOT_FOUND'))).toBe(false)
    expect(refusalWords(problem(503, 'INPATIENT_NOT_AVAILABLE'), 'x')).toBe(NOT_AVAILABLE)
    expect(refusalWords(problem(404, 'ADMISSION_NOT_FOUND'), 'x')).toBe('This ward, bed or admission is not at this facility.')
  })
  it('puts every refusal in plain words, never "permission", and a bare 403 as who can use the wards', () => {
    for (const text of Object.values(INPATIENT_REFUSALS)) expect(text).not.toMatch(/permission/i)
    expect(refusalWords(problem(403, 'PERMISSION_DENIED'), 'x')).toBe('Only nurses, clinicians and doctors of this facility can use the wards.')
    expect(refusalWords(problem(400, 'VALIDATION_FAILED'), 'x', 'Check the bed.')).toBe('Check the bed.')
    expect(refusalWords(problem(409, 'WARD_SEX_MISMATCH'), 'x')).toBe('This ward takes only men (or only women). Confirm to admit this patient here.')
    expect(refusalWords(new Error('boom'), 'Try again.')).toBe('Try again.')
  })
  it('learns from answers: not served only until anything says otherwise', () => {
    forgetInpatientServed()
    expect(inpatientServed()).toBeNull()
    learnFrom(problem(503, 'INPATIENT_NOT_AVAILABLE'))
    expect(inpatientServed()).toBe(false)
    learnFrom(problem(0, 'NETWORK_ERROR'))
    expect(inpatientServed()).toBe(false)
    learnFrom()
    expect(inpatientServed()).toBe(true)
    learnFrom(problem(404, 'API_ROUTE_NOT_FOUND'))
    expect(inpatientServed()).toBe(true)
    forgetInpatientServed()
  })
})
