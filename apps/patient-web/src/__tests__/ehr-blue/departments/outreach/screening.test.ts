import { beforeEach, describe, expect, it } from 'vitest'
import {
  bmiOf, checkScreening, checksRecorded, extrasOf, FIELD_LABELS, fieldNamedIn, medicineRow, parseNumber, screeningForm, type ScreeningForm,
} from '../../../../ehr-blue/departments/outreach/screening'
import {
  forgetOutreachServed, noteOutreachRegistrations, noteOutreachScreening, recordedChecksServed, servedScreeningExtras,
} from '../../../../ehr-blue/departments/outreach/outreachServed'
import type { OutreachCase } from '../../../../staff/api'

/* The health checks' own rules, as outreach-api 0118 checks them. Fictional values only. */

const empty = screeningForm(null)
const form = (changes: Partial<ScreeningForm>): ScreeningForm => ({ ...empty, ...changes })

describe('checkScreening', () => {
  it('sends null for everything not recorded, and says when nothing is: nothing is required, so that is no error', () => {
    const { input, errors, empty: nothing } = checkScreening(empty)
    expect(errors).toEqual({})
    expect(nothing).toBe(true)
    expect(Object.values(input).every(value => value === null)).toBe(true)
  })

  it('takes every field in range, as Outreach takes them', () => {
    const { input, errors, empty: nothing } = checkScreening(form({
      bpSystolic: '120', bpDiastolic: '80', pulseBpm: '72', temperatureC: '36,8', weightKg: '64.5', heightCm: '165',
      glucoseValue: '5.6', glucoseUnit: 'mmol/L', glucoseTiming: 'fasting', malariaRdt: 'negative', hearingLeft: 'pass', hearingRight: 'refer',
      mainComplaint: ' Headache ', seenByClinician: 'yes', clinicianName: 'Dr Demo', outcome: 'Rest and fluids.',
      medicines: [medicineRow('Paracetamol', '500 mg'), medicineRow('ORS', ''), medicineRow('', '')], referred: 'yes', referredTo: 'General Hospital',
    }))
    expect(errors).toEqual({})
    expect(nothing).toBe(false)
    expect(input).toEqual({
      bpSystolic: 120, bpDiastolic: 80, pulseBpm: 72, temperatureC: 36.8, weightKg: 64.5, heightCm: 165,
      glucoseValue: 5.6, glucoseUnit: 'mmol/L', glucoseTiming: 'fasting', malariaRdt: 'negative', hearingLeft: 'pass', hearingRight: 'refer',
      mainComplaint: 'Headache', seenByClinician: true, clinicianName: 'Dr Demo', outcome: 'Rest and fluids.',
      medicinesGiven: [{ name: 'Paracetamol', dose: '500 mg' }, { name: 'ORS', dose: null }], referred: true, referredTo: 'General Hospital',
    })
  })

  it('needs both blood pressure numbers or neither, the bottom below the top', () => {
    expect(checkScreening(form({ bpSystolic: '120' })).errors).toEqual({ bpDiastolic: 'Enter both blood pressure numbers, or neither.' })
    expect(checkScreening(form({ bpDiastolic: '80' })).errors).toEqual({ bpSystolic: 'Enter both blood pressure numbers, or neither.' })
    expect(checkScreening(form({ bpSystolic: '90', bpDiastolic: '90' })).errors.bpDiastolic).toBe('The bottom number must be lower than the top number.')
  })

  it.each([
    ['bpSystolic', '49'], ['bpSystolic', '301'], ['bpSystolic', '120.5'], ['bpDiastolic', '19'], ['bpDiastolic', '201'],
    ['pulseBpm', '19'], ['pulseBpm', '251'], ['temperatureC', '29.9'], ['temperatureC', '45.1'], ['temperatureC', '36.55'],
    ['weightKg', '0.4'], ['weightKg', '400.1'], ['weightKg', '60.25'], ['heightCm', '29'], ['heightCm', '251'], ['heightCm', 'abc'],
  ] as const)('refuses %s = %s', (field, value) => {
    const changes: Partial<ScreeningForm> = field === 'bpSystolic' ? { bpSystolic: value, bpDiastolic: '10' }
      : field === 'bpDiastolic' ? { bpSystolic: '250', bpDiastolic: value } : { [field]: value }
    expect(checkScreening(form(changes)).errors[field]).toBeTruthy()
  })

  it.each([['bpSystolic', '50'], ['bpSystolic', '300'], ['temperatureC', '30.0'], ['temperatureC', '45'], ['weightKg', '0.5'], ['heightCm', '250']] as const)(
    'takes the edge %s = %s', (field, value) => {
      const changes: Partial<ScreeningForm> = field === 'bpSystolic' ? { bpSystolic: value, bpDiastolic: '40' } : { [field]: value }
      expect(checkScreening(form(changes)).errors).toEqual({})
    })

  it('needs a blood sugar reading’s unit and timing, in the unit’s range, and sends neither without a reading', () => {
    expect(checkScreening(form({ glucoseValue: '5.6' })).errors).toEqual({
      glucoseUnit: 'Choose the unit of the blood sugar reading.', glucoseTiming: 'Choose fasting or random.' })
    expect(checkScreening(form({ glucoseValue: '41', glucoseUnit: 'mmol/L', glucoseTiming: 'random' })).errors.glucoseValue)
      .toBe('Enter a reading from 1.0 to 40.0 mmol/L.')
    expect(checkScreening(form({ glucoseValue: '17', glucoseUnit: 'mg/dL', glucoseTiming: 'random' })).errors.glucoseValue)
      .toBe('Enter a reading from 18 to 720 mg/dL.')
    expect(checkScreening(form({ glucoseValue: '720', glucoseUnit: 'mg/dL', glucoseTiming: 'random' })).errors).toEqual({})
    expect(checkScreening(form({ glucoseValue: '5.65', glucoseUnit: 'mmol/L', glucoseTiming: 'random' })).errors.glucoseValue).toBeTruthy()
    const unitOnly = checkScreening(form({ glucoseUnit: 'mmol/L', glucoseTiming: 'fasting', malariaRdt: 'not_done' }))
    expect(unitOnly.errors).toEqual({})
    expect(unitOnly.input).toMatchObject({ glucoseValue: null, glucoseUnit: null, glucoseTiming: null })
  })

  it('sends the clinician’s name only when seen, and where to only when referred', () => {
    const { input } = checkScreening(form({ seenByClinician: 'no', clinicianName: 'Dr Demo', referred: 'no', referredTo: 'Clinic' }))
    expect(input).toMatchObject({ seenByClinician: false, clinicianName: null, referred: false, referredTo: null })
  })

  it('keeps words to Outreach’s lengths, and a medicine needs its name', () => {
    const row = medicineRow('', '1 tablet')
    const { errors } = checkScreening(form({ mainComplaint: 'x'.repeat(201), outcome: 'x'.repeat(501), seenByClinician: 'yes',
      clinicianName: 'x'.repeat(101), referred: 'yes', referredTo: 'x'.repeat(201), medicines: [row] }))
    expect(errors).toEqual({ mainComplaint: 'Keep this to 200 characters.', outcome: 'Keep this to 500 characters.',
      clinicianName: 'Keep this to 100 characters.', referredTo: 'Keep this to 200 characters.',
      [`medicine-${row.key}-name`]: 'Enter the medicine’s name, as given.' })
  })
})

describe('text as Outreach keeps it', () => {
  it('sends text trimmed, each run of spaces and line breaks one space, medicines too', () => {
    const form = { ...screeningForm(null), mainComplaint: '  Headache\n\nfor  3 days ', outcome: 'Rest.\r\nFluids.',
      seenByClinician: 'yes' as const, clinicianName: 'Dr  Ada\tTestperson', referred: 'yes' as const, referredTo: 'General\nHospital  Ilorin',
      medicines: [medicineRow('  Paracetamol\n500 mg ', '1  tablet\nthree times a day')] }
    const { input } = checkScreening(form)
    expect(input).toMatchObject({ mainComplaint: 'Headache for 3 days', outcome: 'Rest. Fluids.', clinicianName: 'Dr Ada Testperson',
      referredTo: 'General Hospital Ilorin', medicinesGiven: [{ name: 'Paracetamol 500 mg', dose: '1 tablet three times a day' }] })
  })
})

describe('the helpers', () => {
  it('works out BMI from weight and height, for display only', () => {
    expect(bmiOf({ weightKg: '64.5', heightCm: '165' })).toBe('23.7')
    expect(bmiOf({ weightKg: '64.5', heightCm: '' })).toBeNull()
    expect(bmiOf({ weightKg: '1000', heightCm: '165' })).toBeNull()
  })

  it('reads numbers with at most the decimals allowed', () => {
    expect(parseNumber('36.8', 1)).toBe(36.8)
    expect(parseNumber('36,8', 1)).toBe(36.8)
    expect(parseNumber('36.85', 1)).toBeUndefined()
    expect(parseNumber('120.0', 0)).toBeUndefined()
    expect(parseNumber('-5', 1)).toBeUndefined()
  })

  it('finds the field a refusal names, the longest name first', () => {
    expect(fieldNamedIn('referredTo must be at most 200 characters')).toBe('referredTo')
    expect(fieldNamedIn('bpDiastolic must be below bpSystolic')).toBe('bpDiastolic')
    expect(fieldNamedIn('something else')).toBeNull()
    expect(fieldNamedIn(null)).toBeNull()
  })

  it('fills the form from a saved screening', () => {
    const saved = screeningForm({ bpSystolic: 130, bpDiastolic: 85, pulseBpm: null, temperatureC: 37.2, weightKg: null, heightCm: null,
      glucoseValue: null, glucoseUnit: null, glucoseTiming: null, malariaRdt: 'positive', hearingLeft: null, hearingRight: null,
      mainComplaint: null, seenByClinician: true, clinicianName: 'Dr Demo', outcome: null, medicinesGiven: [{ name: 'ACT', dose: null }],
      referred: false, referredTo: null, caseId: 'case-1', version: 2, recordedAt: '', recordedByMembershipId: 'm', updatedAt: '' })
    expect(saved).toMatchObject({ bpSystolic: '130', bpDiastolic: '85', temperatureC: '37.2', malariaRdt: 'positive', seenByClinician: 'yes',
      referred: 'no', clinicianName: 'Dr Demo' })
    expect(saved.medicines.map(row => [row.name, row.dose])).toEqual([['ACT', '']])
  })
})

describe('genotype and blood group (0122)', () => {
  it('leaves both keys out unless Outreach is known to take them, so an earlier Outreach is never sent a field it refuses', () => {
    const { input } = checkScreening(form({ genotype: 'AS', bloodGroup: 'O-', pulseBpm: '72' }))
    expect('genotype' in input).toBe(false)
    expect('bloodGroup' in input).toBe(false)
    expect(extrasOf(input)).toEqual([])
  })

  it('sends both when taken: the code chosen, or null when not chosen', () => {
    expect(checkScreening(form({ genotype: 'AS', bloodGroup: 'O-' }), ['genotype', 'bloodGroup']).input).toMatchObject({ genotype: 'AS', bloodGroup: 'O-' })
    const blank = checkScreening(form({ pulseBpm: '72' }), ['genotype', 'bloodGroup'])
    expect(blank.errors).toEqual({})
    expect(blank.input).toMatchObject({ pulseBpm: 72, genotype: null, bloodGroup: null })
    expect(extrasOf(blank.input)).toEqual(['genotype', 'bloodGroup'])
    // Only the one taken is sent.
    const one = checkScreening(form({ genotype: 'SS', bloodGroup: 'A+' }), ['genotype']).input
    expect(one.genotype).toBe('SS')
    expect('bloodGroup' in one).toBe(false)
  })

  it('counts "Not known" as recorded, and blank ones as nothing', () => {
    expect(checkScreening(form({ genotype: 'unknown' }), ['genotype', 'bloodGroup']).empty).toBe(false)
    expect(checkScreening(empty, ['genotype', 'bloodGroup']).empty).toBe(true)
  })

  it('fills the form from a saved screening, and from one without the keys (an earlier Outreach)', () => {
    const saved = { ...checkScreening(empty).input, genotype: 'AC', bloodGroup: 'B-', caseId: 'case-1', version: 1, recordedAt: '', recordedByMembershipId: '', updatedAt: '' } as const
    expect(screeningForm(saved)).toMatchObject({ genotype: 'AC', bloodGroup: 'B-' })
    const { genotype: _g, bloodGroup: _b, ...older } = saved
    expect(screeningForm(older)).toMatchObject({ genotype: '', bloodGroup: '' })
  })

  it('names the field a refusal names, in plain words', () => {
    expect(fieldNamedIn('bloodGroup must be one of the following values')).toBe('bloodGroup')
    expect(fieldNamedIn('genotype must be one of the following values')).toBe('genotype')
    expect([FIELD_LABELS.genotype, FIELD_LABELS.bloodGroup]).toEqual(['Genotype', 'Blood group'])
  })
})

describe('what Outreach takes in health checks (outreachServed.ts)', () => {
  beforeEach(() => forgetOutreachServed())

  it('knows nothing from an answer with no screening and no accepts, or a screening without the keys', () => {
    noteOutreachScreening({ screening: null })
    noteOutreachScreening({ screening: { caseId: 'case-1', pulseBpm: 70 } })
    noteOutreachScreening(null)
    expect(servedScreeningExtras()).toEqual([])
  })

  it('learns from accepts or from a saved screening’s keys, and keeps it for the session; an empty accepts says nothing', () => {
    noteOutreachScreening({ screening: null, accepts: [] })
    expect(servedScreeningExtras()).toEqual([])
    noteOutreachScreening({ screening: null, accepts: ['bloodGroup', 'somethingElse'] })
    expect(servedScreeningExtras()).toEqual(['bloodGroup'])
    noteOutreachScreening({ screening: { genotype: null } })
    expect(servedScreeningExtras()).toEqual(['genotype', 'bloodGroup'])
    noteOutreachScreening({ screening: null })
    expect(servedScreeningExtras()).toEqual(['genotype', 'bloodGroup'])
  })

  it('never learns them from registrations (they carry no health value), but learns hasRecordedChecks there', () => {
    noteOutreachRegistrations([{ id: 'case-1', hasScreening: true, genotype: null, bloodGroup: 'A+' } as unknown as OutreachCase])
    expect(servedScreeningExtras()).toEqual([])
    expect(recordedChecksServed()).toBe(false)
    noteOutreachRegistrations([{ id: 'case-2', hasScreening: true, hasRecordedChecks: false } as unknown as OutreachCase])
    expect(recordedChecksServed()).toBe(true)
    noteOutreachRegistrations([{ id: 'case-3', hasScreening: true } as unknown as OutreachCase])
    expect(recordedChecksServed()).toBe(true)
    forgetOutreachServed()
    expect(recordedChecksServed()).toBe(false)
  })

  it('counts checks as recorded on hasRecordedChecks, else on hasScreening (an earlier Outreach)', () => {
    expect(checksRecorded({ hasScreening: true, hasRecordedChecks: false })).toBe(false)
    expect(checksRecorded({ hasScreening: true, hasRecordedChecks: true })).toBe(true)
    expect(checksRecorded({ hasScreening: true })).toBe(true)
    expect(checksRecorded({ hasScreening: false })).toBe(false)
    expect(checksRecorded({})).toBe(false)
  })
})
