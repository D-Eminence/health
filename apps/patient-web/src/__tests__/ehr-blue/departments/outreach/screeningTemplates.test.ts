import { describe, expect, it } from 'vitest'
import {
  appliesToPerson, bmiFrom, flagVital, mergePackages, mgPerDlToMmolPerL, outcomeText, packageFor, suggestOutcome, TESTS,
  templateFor, visibleReasons,
} from '../../../../ehr-blue/departments/outreach/screeningTemplates'
import { canSeeSensitive, isVisitCode, normaliseVisitCode, SCREENING_FOCUSES } from '../../../../ehr-blue/departments/outreach/campaignTypes'

/** The default screening packages and the outcome suggestion (Outreach campaigns, owner decisions of 13 November 2026). */
describe('screening templates', () => {
  it('has a package for every focus, each with something to do', () => {
    for (const { value } of SCREENING_FOCUSES) {
      const pack = templateFor(value)
      expect(pack.vitals.length + pack.tests.length, value).toBeGreaterThan(0)
      expect(pack.questions.length, value).toBeGreaterThan(0)
    }
  })

  it('merges several focuses with no vital, test or question twice, blood pressure first', () => {
    const pack = packageFor(['general_check', 'hypertension', 'diabetes', 'hepatitis_b'])
    const ids = pack.vitals.map(vital => vital.id)
    expect(ids).toEqual(['bp_systolic', 'bp_diastolic', 'pulse', 'temperature', 'spo2', 'weight', 'height', 'bmi', 'blood_sugar'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(pack.tests.map(test => test.id)).toEqual(['hbsag'])
    const questionIds = pack.questions.map(question => question.id)
    expect(new Set(questionIds).size).toBe(questionIds.length)
    // The same package twice is the same package.
    expect(mergePackages([pack, pack])).toEqual(pack)
  })

  it('brings BMI only with weight and height, and the hypertension package has no BMI', () => {
    expect(templateFor('hypertension').vitals.map(vital => vital.id)).toEqual(['bp_systolic', 'bp_diastolic', 'pulse'])
    expect(templateFor('diabetes').vitals.map(vital => vital.id)).toContain('bmi')
  })

  it('marks HIV and hepatitis B sensitive, and HIV as needing its own consent and counselling', () => {
    expect(TESTS.hbsag!.sensitive).toBe(true)
    expect(TESTS.hiv_rapid).toMatchObject({ sensitive: true, separateConsent: true, counselling: true })
    expect(TESTS.malaria_rdt!.sensitive).toBe(false)
    expect(TESTS.hiv_rapid!.results.map(option => option.label)).toEqual(['Reactive', 'Non-reactive', 'Invalid (test again)'])
  })

  it('works out BMI and blood sugar units', () => {
    expect(bmiFrom(70, 175)).toBe(22.9)
    expect(bmiFrom(undefined, 175)).toBeNull()
    expect(mgPerDlToMmolPerL(198)).toBe(11)
  })

  it.each([
    ['bp_systolic', 139, 'normal'], ['bp_systolic', 140, 'refer_routine'], ['bp_systolic', 180, 'refer_urgent'],
    ['bp_diastolic', 89, 'normal'], ['bp_diastolic', 90, 'refer_routine'], ['bp_diastolic', 120, 'refer_urgent'],
    ['temperature', 37.4, 'normal'], ['temperature', 37.5, 'follow_up'],
    ['blood_sugar', 11.0, 'follow_up'], ['blood_sugar', 11.1, 'refer_routine'], ['blood_sugar', 6.0, 'normal'],
    ['spo2', 96, 'normal'], ['spo2', 93, 'refer_routine'], ['spo2', 88, 'refer_urgent'],
  ] as const)('%s %s reads %s', (id, value, level) => {
    expect(flagVital(id, value).level).toBe(level)
  })

  it('judges fasting blood sugar on its own thresholds', () => {
    expect(flagVital('blood_sugar', 7.2, { fasting: true }).level).toBe('refer_routine')
    expect(flagVital('blood_sugar', 7.2).level).toBe('normal')
  })

  it('leaves out tests and questions that are not for this person, and never one when sex or age is unknown', () => {
    expect(appliesToPerson(TESTS.via!, { sex: 'male', ageYears: 40 })).toBe(false)
    expect(appliesToPerson(TESTS.via!, { sex: 'female', ageYears: 20 })).toBe(false)
    expect(appliesToPerson(TESTS.via!, { sex: 'female', ageYears: 30 })).toBe(true)
    expect(appliesToPerson(TESTS.psa!, { sex: 'unknown', ageYears: null })).toBe(true)
  })
})

describe('suggestOutcome', () => {
  it('suggests Normal when everything is in range', () => {
    const suggestion = suggestOutcome({ vitals: { bp_systolic: 122, bp_diastolic: 78, pulse: 72 }, tests: [{ testId: 'hbsag', result: 'negative' }] })
    expect(suggestion).toMatchObject({ kind: 'normal', retests: [] })
    expect(suggestion.urgency).toBeUndefined()
    expect(suggestion.reasons).toEqual(['Everything checked today is in the usual range.'])
  })

  it('refers routine for high blood pressure, giving both numbers in one reason', () => {
    const suggestion = suggestOutcome({ vitals: { bp_systolic: 152, bp_diastolic: 96 } })
    expect(suggestion).toMatchObject({ kind: 'refer', urgency: 'routine' })
    expect(suggestion.reasons).toEqual(['Blood pressure is high (152/96 mmHg). Needs a check at a clinic.'])
  })

  it('refers urgently for very high blood pressure, whichever number is very high', () => {
    expect(suggestOutcome({ vitals: { bp_systolic: 150, bp_diastolic: 121 } })).toMatchObject({ kind: 'refer', urgency: 'urgent' })
    expect(suggestOutcome({ vitals: { bp_systolic: 185 } })).toMatchObject({ kind: 'refer', urgency: 'urgent' })
  })

  it('refers a positive hepatitis B test, as a sensitive reason others do not see', () => {
    const suggestion = suggestOutcome({ vitals: { bp_systolic: 120, bp_diastolic: 80 }, tests: [{ testId: 'hbsag', result: 'positive' }] })
    expect(suggestion).toMatchObject({ kind: 'refer', urgency: 'routine' })
    expect(suggestion.findings[0]).toMatchObject({ sensitive: true, source: { kind: 'test', id: 'hbsag' } })
    expect(visibleReasons(suggestion, true)).toEqual(suggestion.reasons)
    expect(visibleReasons(suggestion, false)).toEqual(['Some results can be shared only by a counsellor or clinician.'])
  })

  it('asks for a retest after an invalid result, and reads the retest when there is one', () => {
    expect(suggestOutcome({ tests: [{ testId: 'hiv_rapid', result: 'invalid', attempt: 1 }] }))
      .toMatchObject({ kind: 'follow_up', retests: ['hiv_rapid'] })
    expect(suggestOutcome({ tests: [{ testId: 'hiv_rapid', result: 'invalid', attempt: 1 }, { testId: 'hiv_rapid', result: 'negative', attempt: 2 }] }))
      .toMatchObject({ kind: 'normal', retests: [] })
  })

  it('takes the most serious finding, and lists every reason most serious first', () => {
    const suggestion = suggestOutcome({
      vitals: { temperature: 38.2, bp_systolic: 145, bp_diastolic: 85 },
      tests: [{ testId: 'malaria_rdt', result: 'positive' }],
      answers: [{ questionId: 'mal_danger', value: 'yes' }, { questionId: 'mal_net', value: 'no' }],
    })
    expect(suggestion).toMatchObject({ kind: 'refer', urgency: 'urgent' })
    expect(suggestion.reasons[0]).toMatch(/danger sign/)
    expect(suggestion.reasons).toHaveLength(4)
  })

  it('suggests follow-up from a flagged answer alone, and reads PSA and eye results', () => {
    expect(suggestOutcome({ answers: [{ questionId: 'pr_night', value: 'yes' }] })).toMatchObject({ kind: 'follow_up' })
    expect(suggestOutcome({ tests: [{ testId: 'psa', value: 6.2 }] })).toMatchObject({ kind: 'refer', urgency: 'routine' })
    expect(suggestOutcome({ tests: [{ testId: 'psa', value: 2.1 }] })).toMatchObject({ kind: 'normal' })
    expect(suggestOutcome({ tests: [{ testId: 'acuity_left', result: '6/18' }] })).toMatchObject({ kind: 'follow_up' })
    expect(suggestOutcome({ tests: [{ testId: 'via', result: 'suspicious' }] })).toMatchObject({ kind: 'refer', urgency: 'urgent' })
  })

  it('works out BMI from weight and height when it was not sent', () => {
    expect(suggestOutcome({ vitals: { weight: 110, height: 170 } }).findings[0]).toMatchObject({ source: { id: 'bmi' }, level: 'follow_up' })
  })

  it('says outcomes in words', () => {
    expect(outcomeText('refer', 'urgent')).toBe('Refer (urgent)')
    expect(outcomeText('follow_up')).toBe('Follow up')
  })
})

describe('campaign words and codes', () => {
  it('reads visit codes as typed, refusing ones that can’t be a code', () => {
    expect(normaliseVisitCode('k7 4f2')).toBe('K7-4F2')
    expect(normaliseVisitCode('K7-4F2')).toBe('K7-4F2')
    expect(normaliseVisitCode('K0-4F2')).toBeNull()
    expect(normaliseVisitCode('K7-4F')).toBeNull()
    expect(isVisitCode('K7-4F2')).toBe(true)
  })

  it('lets only counsellors and clinicians see sensitive results', () => {
    expect(canSeeSensitive(['registrar', 'counsellor'])).toBe(true)
    expect(canSeeSensitive(['coordinator', 'data_checker'])).toBe(false)
  })
})
