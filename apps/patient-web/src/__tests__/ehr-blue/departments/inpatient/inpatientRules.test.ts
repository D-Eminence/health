import { describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import {
  DISCHARGE_TIME_WORDS, INPATIENT_REFUSALS, NOT_AVAILABLE, ageText, canAllocate, canDecide, canManageWards, canPrintBand, canReadWards,
  canSetBedStatus, cardName, censusRange, daysText, dischargeTimeRange, dischargedText, forgetInpatientServed, inpatientServed, lagosInputToUtc, learnFrom, lengthProblem,
  memberText, movementText, ninText, notServed, outcomeText, refusalWords, utcToLagosInput,
} from '../../../../ehr-blue/departments/inpatient/inpatientRules'
import { bedMoves } from '../../../../ehr-blue/departments/inpatient/BedBoard'
import {
  dischargeBody, dischargeMedicines, expectedDayProblem, expectedDayRange, freeBeds, needsPreparing, needsSummary, sexDiffers,
} from '../../../../ehr-blue/departments/inpatient/AdmissionRecord'
import { goneText, staffNotRead, teamChoice, teamStaffOf } from '../../../../ehr-blue/departments/inpatient/WardConfig'
import { motherChoices } from '../../../../ehr-blue/departments/inpatient/NewAdmission'
import type { AdmissionCard, FacilityStaffMember, Ward } from '../../../../staff/api'

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
  it('limits an expected discharge to Lagos days, from the admission’s day to a year from today', () => {
    const now = Date.parse('2026-12-03T12:00:00.000Z')
    // 23:30 UTC on 1 Dec is 00:30 on 2 Dec in Lagos: the UTC day (1 Dec) would be refused by the backend.
    const range = expectedDayRange({ admittedAt: '2026-12-01T23:30:00.000Z', requestedAt: '2026-12-01T21:00:00.000Z' }, now)
    expect(range).toEqual({ min: '2026-12-02', max: '2027-12-03' })
    // Waiting for a bed: the request's Lagos day.
    expect(expectedDayRange({ admittedAt: null, requestedAt: '2026-11-30T23:15:00.000Z' }, now).min).toBe('2026-12-01')
    expect(expectedDayProblem('', range)).toBe('')
    expect(expectedDayProblem('2026-12-02', range)).toBe('')
    expect(expectedDayProblem('2026-12-01', range)).toBe('Choose an expected discharge date from 2 Dec 2026 to 3 Dec 2027.')
    expect(expectedDayProblem('2027-12-04', range)).toBe('Choose an expected discharge date from 2 Dec 2026 to 3 Dec 2027.')
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

  it('never assumes an outcome: none chosen is refused before anything else', () => {
    expect(dischargeBody('', summary, extra, now)).toBe('Choose the outcome.')
    expect(dischargeBody('', empty, { ...extra, signature: '' }, now)).toBe('Choose the outcome.')
  })
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
      .toBe('The discharge time must be after admission, within the last 24 hours, and not in the future.')
    expect(dischargeBody('died', empty, extra, now)).toBe('Enter the time of death.')
    expect(dischargeBody('died', empty, { ...extra, diedAt: '2026-12-03T13:30' }, now)).toBe('The time of death cannot be in the future.')
    expect(dischargeBody('referred_out', summary, { ...extra, referredTo: 'x' }, now)).toBe('Enter the facility’s name of at least 2 characters.')
  })
  it('takes a discharge time only after admission and within the last 24 hours, as route 16 does, and says so', () => {
    const admitted = { ...extra, admittedAt: '2026-12-01T23:30:00.000Z' }
    // 27 hours ago, though after admission: route 16 refuses it, so the page does before sending.
    expect(dischargeBody('absconded', empty, { ...admitted, dischargedAt: '2026-12-02T10:00' }, now)).toBe(DISCHARGE_TIME_WORDS)
    // Exactly 24 hours ago is taken; a minute more is not.
    expect(dischargeBody('absconded', empty, { ...admitted, dischargedAt: '2026-12-02T13:00' }, now))
      .toEqual({ outcome: 'absconded', signature: 'SIGN', dischargedAt: '2026-12-02T12:00:00.000Z' })
    expect(dischargeBody('absconded', empty, { ...admitted, dischargedAt: '2026-12-02T12:59' }, now)).toBe(DISCHARGE_TIME_WORDS)
    // Before admission (admitted at 09:00 Lagos today).
    const today = { ...extra, admittedAt: '2026-12-03T08:00:00.000Z' }
    expect(dischargeBody('absconded', empty, { ...today, dischargedAt: '2026-12-03T08:30' }, now)).toBe(DISCHARGE_TIME_WORDS)
    expect(dischargeBody('absconded', empty, { ...today, dischargedAt: '2026-12-03T09:00' }, now))
      .toEqual({ outcome: 'absconded', signature: 'SIGN', dischargedAt: '2026-12-03T08:00:00.000Z' })
    // The field's limits in Lagos: the later of admission and 24 hours ago (to the next whole minute), and now.
    expect(dischargeTimeRange('2026-12-01T23:30:00.000Z', now + 30_000)).toMatchObject({ min: '2026-12-02T13:01', max: '2026-12-03T13:00' })
    expect(dischargeTimeRange('2026-12-03T08:00:00.000Z', now)).toMatchObject({ min: '2026-12-03T09:00', max: '2026-12-03T13:00' })
    expect(dischargeTimeRange(null, now)).toMatchObject({ min: '2026-12-02T13:00' })
    // The refusal itself names the 24-hour limit too.
    expect(refusalWords(problem(400, 'DISCHARGE_TIME_INVALID'), 'x')).toBe(DISCHARGE_TIME_WORDS)
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
    // The outcome alone, never "Discharged: died" or "Discharged: discharged against medical advice".
    expect(movementText({ kind: 'discharged', outcome: 'died', printNumber: null, reprintReason: null })).toBe('Died')
    expect(movementText({ kind: 'discharged', outcome: 'dama', printNumber: null, reprintReason: null })).toBe('Discharged against medical advice')
    expect(movementText({ kind: 'discharged', outcome: 'routine', printNumber: null, reprintReason: null })).toBe('Routine discharge')
    expect(movementText({ kind: 'discharged', outcome: null, printNumber: null, reprintReason: null })).toBe('Discharged')
    expect(movementText({ kind: 'wristband_printed', outcome: null, printNumber: 2, reprintReason: 'lost' }))
      .toBe('Wristband printed again (print 2): the band was lost')
  })
  it('says each discharge in one plain sentence', () => {
    expect(dischargedText('Ada Wardone', 'routine')).toBe('Ada Wardone is discharged.')
    expect(dischargedText('Ada Wardone', 'dama')).toBe('Ada Wardone left against medical advice. The discharge is recorded.')
    expect(dischargedText('Ada Wardone', 'referred_out', ' Fictional Teaching Hospital ')).toBe('Ada Wardone is discharged to Fictional Teaching Hospital.')
    expect(dischargedText('Ada Wardone', 'referred_out')).toBe('Ada Wardone is discharged to another facility.')
    expect(dischargedText('Ada Wardone', 'absconded')).toBe('Ada Wardone is recorded as having left without notice.')
    expect(dischargedText('Ada Wardone', 'died')).toBe('Ada Wardone’s death is recorded.')
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

describe('a ward’s team (route 6)', () => {
  const member = (membershipId: string, name: string, roles: string[]): FacilityStaffMember => ({ membershipId, version: 1, accountId: 'a',
    name, email: 'x@example.test', roles, isAdministrator: false, isSelf: false, joinedAt: null, licence: null })
  const staff = teamStaffOf([member('m-1', 'Nurse Bisi Fiction', ['nurse']), member('m-2', 'Dr Femi Fiction', ['doctor']),
    member('m-3', 'Tolu Fiction', ['cashier'])]) as Extract<ReturnType<typeof teamStaffOf>, { state: 'ready' }>
  it('offers nurses, clinicians and doctors, and sends only them: a member who left or changed role is dropped and named', () => {
    expect(staff.members.map(item => item.name)).toEqual(['Nurse Bisi Fiction', 'Dr Femi Fiction'])
    const choice = teamChoice(['M-1', 'm-3', 'm-9'], new Set(['m-1', 'm-3', 'm-9', 'm-2']), staff)
    expect(choice.send).toEqual(['m-1', 'm-2'])
    expect(choice.gone).toEqual(['m-3', 'm-9'])
    expect(goneText(choice.gone, staff.names)).toBe('Tolu Fiction and 1 former staff member')
    expect(goneText(['m-9', 'm-8'], staff.names)).toBe('2 former staff members')
    expect(goneText(['m-3'], staff.names)).toBe('Tolu Fiction')
    expect(teamChoice(undefined, new Set(), staff)).toEqual({ send: [], gone: [] })
  })
  it('tells a staff list Identity does not read here (support manages the staff, or no route) from one that failed', () => {
    expect(staffNotRead(problem(403, 'STAFF_MANAGEMENT_NOT_AVAILABLE'), 'Fictional Hospital'))
      .toBe('Health ID support manages who works at Fictional Hospital, so a ward’s team cannot be set here yet.')
    expect(staffNotRead(problem(404, 'NOT_FOUND'), 'Fictional Hospital')).toBe('The staff list is not switched on yet, so a ward’s team cannot be set now.')
    // Worth reading again: Refresh.
    expect(staffNotRead(problem(503, 'UPSTREAM_UNAVAILABLE'), 'Fictional Hospital')).toBeNull()
    expect(staffNotRead(problem(0, 'NETWORK_ERROR'), 'Fictional Hospital')).toBeNull()
  })
})

describe('a newborn’s mother (Q-ADT-17)', () => {
  const open = (admissionId: string, patientId: string, status: string, wardId: string | null, requestedWardId: string | null = null) =>
    ({ admissionId, patientId, status, wardId, requestedWardId }) as unknown as AdmissionCard
  it('offers any other patient’s open admission here, on any ward or none, maternity first', () => {
    const wards = [{ wardId: 'w-maternity', wardType: 'maternity' as const }, { wardId: 'w-icu', wardType: 'icu' as const }]
    const cards = [
      open('a-icu', 'p-1', 'admitted', 'w-icu'), open('a-waiting', 'p-2', 'requested', null), open('a-labour', 'p-3', 'discharge_ready', 'w-maternity'),
      open('a-wanted', 'p-4', 'requested', null, 'w-maternity'), open('a-own', 'p-baby', 'requested', null), open('a-gone', 'p-5', 'discharged', 'w-maternity'),
    ]
    expect(motherChoices(cards, 'p-baby', wards).map(card => card.admissionId)).toEqual(['a-labour', 'a-wanted', 'a-icu', 'a-waiting'])
  })
})
