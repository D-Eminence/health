import type {
  AnswerValue, AppliesTo, FindingLevel, OutcomeKind, QuestionDefinition, ResultFlag, ScreeningFocus, ScreeningPackage,
  TestDefinition, Urgency, VitalDefinition, VitalId,
} from './campaignTypes'

/*
 * The default screening package for each focus (owner decisions of 13 November 2026): plain names, units, usual ranges
 * and the rules that flag a reading, and the short yes/no questions. The plan screen starts from these and the
 * coordinator may change them; packageFor() merges the focuses a campaign picks with no vital, test or question twice.
 *
 * suggestOutcome() reads a visit's readings, results and answers and suggests Normal, Follow up, or Refer (urgent or
 * routine), with its reasons in plain words. It only suggests: a counsellor or clinician confirms the outcome.
 *
 * The thresholds are screening thresholds for a community outreach, not a diagnosis: a high reading means "see a
 * clinic", and the words say so.
 */

// ------------------------------------------------------------------------------------------------------- vitals --

export const VITALS: Readonly<Record<VitalId, VitalDefinition>> = {
  bp_systolic: { id: 'bp_systolic', name: 'Blood pressure, top number (systolic)', unit: 'mmHg', min: 60, max: 260, decimals: 0,
    normalText: 'Under 140' },
  bp_diastolic: { id: 'bp_diastolic', name: 'Blood pressure, bottom number (diastolic)', unit: 'mmHg', min: 30, max: 160, decimals: 0,
    normalText: 'Under 90' },
  pulse: { id: 'pulse', name: 'Pulse', unit: 'bpm', min: 25, max: 220, decimals: 0, normalText: '60 to 100' },
  temperature: { id: 'temperature', name: 'Temperature', unit: '°C', min: 32, max: 43, decimals: 1, normalText: 'Under 37.5' },
  weight: { id: 'weight', name: 'Weight', unit: 'kg', min: 2, max: 300, decimals: 1, normalText: '' },
  height: { id: 'height', name: 'Height', unit: 'cm', min: 40, max: 230, decimals: 0, normalText: '' },
  bmi: { id: 'bmi', name: 'BMI', unit: 'kg/m²', min: 8, max: 80, decimals: 1, normalText: '18.5 to 24.9', derived: true,
    note: 'Worked out from weight and height.' },
  spo2: { id: 'spo2', name: 'Oxygen level (SpO2)', unit: '%', min: 50, max: 100, decimals: 0, normalText: '95 or more' },
  blood_sugar: { id: 'blood_sugar', name: 'Blood sugar', unit: 'mmol/L', min: 1, max: 35, decimals: 1,
    normalText: 'Random under 7.8; fasting under 5.6',
    note: 'A meter in mg/dL: divide by 18 (198 mg/dL is 11.0 mmol/L). Say whether they have eaten in the last 8 hours.' },
}

/** The order vitals are taken in, whatever the focuses. */
const VITAL_ORDER: readonly VitalId[] = ['bp_systolic', 'bp_diastolic', 'pulse', 'temperature', 'spo2', 'weight', 'height', 'bmi', 'blood_sugar']

/** A meter reading in mg/dL as mmol/L, to one decimal place. */
export function mgPerDlToMmolPerL(mgPerDl: number): number {
  return Math.round((mgPerDl / 18) * 10) / 10
}

/** BMI from weight (kg) and height (cm), to one decimal place; null when either is missing or can't be right. */
export function bmiFrom(weightKg: number | undefined, heightCm: number | undefined): number | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm < 40) return null
  const metres = heightCm / 100
  return Math.round((weightKg / (metres * metres)) * 10) / 10
}

/** How one reading reads: its level, a word for the badge, and a plain reason when it isn't normal. */
export interface VitalFlag {
  readonly level: FindingLevel
  readonly label: 'Normal' | 'High' | 'Very high' | 'Low' | 'Very low' | 'Check'
  readonly reason?: string
}

const NORMAL: VitalFlag = { level: 'normal', label: 'Normal' }

/**
 * The flag of one reading. Blood pressure is judged as a pair (bloodPressureFlag); here each number alone, so a screen
 * can colour each field as it is typed.
 */
export function flagVital(id: VitalId, value: number, options: { fasting?: boolean } = {}): VitalFlag {
  switch (id) {
    case 'bp_systolic':
      if (value >= 180) return { level: 'refer_urgent', label: 'Very high', reason: `Blood pressure is very high (top number ${value}). Needs to be seen today.` }
      if (value >= 140) return { level: 'refer_routine', label: 'High', reason: `Blood pressure is high (top number ${value}). Needs a check at a clinic.` }
      if (value < 90) return { level: 'follow_up', label: 'Low', reason: `Blood pressure is low (top number ${value}).` }
      return NORMAL
    case 'bp_diastolic':
      if (value >= 120) return { level: 'refer_urgent', label: 'Very high', reason: `Blood pressure is very high (bottom number ${value}). Needs to be seen today.` }
      if (value >= 90) return { level: 'refer_routine', label: 'High', reason: `Blood pressure is high (bottom number ${value}). Needs a check at a clinic.` }
      if (value < 60) return { level: 'follow_up', label: 'Low', reason: `Blood pressure is low (bottom number ${value}).` }
      return NORMAL
    case 'pulse':
      if (value > 130 || value < 40) return { level: 'refer_urgent', label: value > 130 ? 'Very high' : 'Very low', reason: `Pulse is ${value} a minute. Needs to be seen today.` }
      if (value > 100) return { level: 'follow_up', label: 'High', reason: `Pulse is fast (${value} a minute). Check it again after a rest.` }
      if (value < 50) return { level: 'follow_up', label: 'Low', reason: `Pulse is slow (${value} a minute). Check it again.` }
      return NORMAL
    case 'temperature':
      if (value >= 40) return { level: 'refer_urgent', label: 'Very high', reason: `Very high fever (${value} °C). Needs to be seen today.` }
      if (value >= 37.5) return { level: 'follow_up', label: 'High', reason: `Has a fever (${value} °C).` }
      if (value < 35) return { level: 'refer_urgent', label: 'Very low', reason: `Body temperature is very low (${value} °C). Needs to be seen today.` }
      return NORMAL
    case 'spo2':
      if (value < 90) return { level: 'refer_urgent', label: 'Very low', reason: `Oxygen level is very low (${value}%). Needs to be seen today.` }
      if (value < 95) return { level: 'refer_routine', label: 'Low', reason: `Oxygen level is low (${value}%). Needs a check at a clinic.` }
      return NORMAL
    case 'bmi':
      if (value >= 30) return { level: 'follow_up', label: 'High', reason: `BMI is ${value}: obesity. Advice on diet and exercise, and a check of blood pressure and sugar.` }
      if (value >= 25) return { level: 'normal', label: 'High', reason: `BMI is ${value}: overweight.` }
      if (value < 16) return { level: 'refer_routine', label: 'Very low', reason: `BMI is ${value}: severely underweight. Needs a check at a clinic.` }
      if (value < 18.5) return { level: 'follow_up', label: 'Low', reason: `BMI is ${value}: underweight.` }
      return NORMAL
    case 'blood_sugar': {
      const kind = options.fasting ? 'Fasting' : 'Random'
      if (value < 3.0) return { level: 'refer_urgent', label: 'Very low', reason: `Blood sugar is very low (${value} mmol/L). Give sugar now, and needs to be seen today.` }
      if (value >= 20) return { level: 'refer_urgent', label: 'Very high', reason: `Blood sugar is very high (${value} mmol/L). Needs to be seen today.` }
      if (value < 3.9) return { level: 'follow_up', label: 'Low', reason: `Blood sugar is low (${value} mmol/L). Give them something sweet to eat.` }
      if (options.fasting) {
        if (value >= 7.0) return { level: 'refer_routine', label: 'High', reason: `${kind} blood sugar is high (${value} mmol/L): possible diabetes. Needs a check at a clinic.` }
        if (value >= 5.6) return { level: 'follow_up', label: 'High', reason: `${kind} blood sugar is a little high (${value} mmol/L). Check again on another day.` }
        return NORMAL
      }
      if (value >= 11.1) return { level: 'refer_routine', label: 'High', reason: `${kind} blood sugar is high (${value} mmol/L): possible diabetes. Needs a check at a clinic.` }
      if (value >= 7.8) return { level: 'follow_up', label: 'High', reason: `${kind} blood sugar is a little high (${value} mmol/L). Check it fasting on another day.` }
      return NORMAL
    }
    case 'weight':
    case 'height':
      return NORMAL
  }
}

// -------------------------------------------------------------------------------------------------------- tests --

const POS_NEG_INVALID = (positive = 'Positive', negative = 'Negative') => [
  { value: 'positive', label: positive, flag: 'abnormal' as const },
  { value: 'negative', label: negative, flag: 'normal' as const },
  { value: 'invalid', label: 'Invalid (test again)', flag: 'invalid' as const },
]

const ACUITY = ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60']
const acuityOptions = () => [
  ...ACUITY.map(value => ({ value, label: value, flag: (['6/6', '6/9', '6/12'].includes(value) ? 'normal' : 'abnormal') as ResultFlag })),
  { value: 'worse_than_6_60', label: 'Worse than 6/60', flag: 'abnormal' as const },
]

export const TESTS: Readonly<Record<string, TestDefinition>> = {
  hbsag: { id: 'hbsag', name: 'Hepatitis B rapid test (HBsAg)', focus: 'hepatitis_b', kind: 'choice', results: POS_NEG_INVALID(),
    sensitive: true, usesKit: true, note: 'Read at the time on the kit. No control line means invalid: test again with a new kit.' },
  hiv_rapid: { id: 'hiv_rapid', name: 'HIV rapid test', focus: 'hiv', kind: 'choice', results: POS_NEG_INVALID('Reactive', 'Non-reactive'),
    sensitive: true, usesKit: true, separateConsent: true, counselling: true,
    note: 'Needs its own consent and counselling before the test, and counselling with the result.' },
  malaria_rdt: { id: 'malaria_rdt', name: 'Malaria rapid test (mRDT)', focus: 'malaria', kind: 'choice', results: POS_NEG_INVALID(),
    sensitive: false, usesKit: true },
  breast_exam: { id: 'breast_exam', name: 'Clinical breast exam', focus: 'breast_cancer', kind: 'choice', sensitive: false, usesKit: false,
    appliesTo: { sex: 'female' },
    results: [{ value: 'normal', label: 'Normal', flag: 'normal' }, { value: 'lump', label: 'Lump found', flag: 'abnormal' }] },
  via: { id: 'via', name: 'Cervical check with acetic acid (VIA)', focus: 'cervical_cancer', kind: 'choice', sensitive: false, usesKit: false,
    appliesTo: { sex: 'female', minAge: 25 },
    results: [
      { value: 'negative', label: 'Negative', flag: 'normal' },
      { value: 'positive', label: 'Positive', flag: 'abnormal' },
      { value: 'suspicious', label: 'Suspicious for cancer', flag: 'urgent' },
    ] },
  psa: { id: 'psa', name: 'PSA blood test (if available)', focus: 'prostate_cancer', kind: 'number', unit: 'ng/mL', abnormalFrom: 4,
    results: [], sensitive: false, usesKit: true, appliesTo: { sex: 'male', minAge: 40 },
    note: 'Only where the campaign has PSA kits. 4 ng/mL or more needs a check at a clinic.' },
  acuity_right: { id: 'acuity_right', name: 'Distance vision, right eye', focus: 'eye_health', kind: 'choice', results: acuityOptions(),
    sensitive: false, usesKit: false, note: 'With their glasses on if they have them. Cover the left eye.' },
  acuity_left: { id: 'acuity_left', name: 'Distance vision, left eye', focus: 'eye_health', kind: 'choice', results: acuityOptions(),
    sensitive: false, usesKit: false, note: 'With their glasses on if they have them. Cover the right eye.' },
  near_vision: { id: 'near_vision', name: 'Near vision', focus: 'eye_health', kind: 'choice', sensitive: false, usesKit: false,
    results: [{ value: 'normal', label: 'Reads small print', flag: 'normal' }, { value: 'needs_glasses', label: 'Needs reading glasses', flag: 'abnormal' }] },
}

// ---------------------------------------------------------------------------------------------------- questions --

const q = (focus: ScreeningFocus, id: string, text: string, flag?: { level: FindingLevel; reason: string }, appliesTo?: AppliesTo): QuestionDefinition => ({
  id, text, kind: 'yesno', focus, ...(flag ? { flagWhen: 'yes', flagLevel: flag.level, flagReason: flag.reason } : {}), ...(appliesTo ? { appliesTo } : {}),
})

export const QUESTIONS: Readonly<Record<ScreeningFocus, readonly QuestionDefinition[]>> = {
  hypertension: [
    q('hypertension', 'htn_known', 'Has a health worker ever told you that you have high blood pressure?'),
    q('hypertension', 'htn_medicine', 'Do you take medicine for blood pressure?'),
    q('hypertension', 'htn_warning', 'Do you have a bad headache, chest pain or trouble seeing right now?',
      { level: 'refer_urgent', reason: 'Has a bad headache, chest pain or trouble seeing now.' }),
  ],
  diabetes: [
    q('diabetes', 'dm_known', 'Has a health worker ever told you that you have diabetes?'),
    q('diabetes', 'dm_medicine', 'Do you take medicine for diabetes?'),
    q('diabetes', 'dm_symptoms', 'Are you very thirsty, or passing urine much more than usual?',
      { level: 'follow_up', reason: 'Is very thirsty or passing a lot of urine.' }),
  ],
  hepatitis_b: [
    q('hepatitis_b', 'hbv_tested', 'Have you been tested for hepatitis B before?'),
    q('hepatitis_b', 'hbv_vaccine', 'Have you had the hepatitis B vaccine?'),
    q('hepatitis_b', 'hbv_jaundice', 'Are your eyes or skin yellow now?',
      { level: 'refer_routine', reason: 'Has yellow eyes or skin.' }),
  ],
  hiv: [
    q('hiv', 'hiv_tested', 'Have you had an HIV test before?'),
    q('hiv', 'hiv_on_treatment', 'Are you taking HIV medicine now?'),
    q('hiv', 'hiv_pregnant', 'Are you pregnant?', undefined, { sex: 'female', minAge: 12 }),
  ],
  malaria: [
    q('malaria', 'mal_fever', 'Have you had a fever in the last 2 days?'),
    q('malaria', 'mal_danger', 'Any danger signs: confusion, fits, can’t drink, or very weak?',
      { level: 'refer_urgent', reason: 'Has a danger sign (confusion, fits, can’t drink or very weak).' }),
    q('malaria', 'mal_net', 'Did you sleep under a treated net last night?'),
  ],
  breast_cancer: [
    q('breast_cancer', 'brca_change', 'Have you noticed a lump, a change or discharge in a breast?',
      { level: 'refer_routine', reason: 'Has noticed a lump, change or discharge in a breast.' }, { sex: 'female' }),
    q('breast_cancer', 'brca_family', 'Has a close relative had breast cancer?', undefined, { sex: 'female' }),
  ],
  cervical_cancer: [
    q('cervical_cancer', 'cx_bleeding', 'Do you bleed after sex or between periods?',
      { level: 'refer_routine', reason: 'Bleeds after sex or between periods.' }, { sex: 'female' }),
    q('cervical_cancer', 'cx_screened', 'Have you had a cervical check in the last 3 years?', undefined, { sex: 'female' }),
  ],
  prostate_cancer: [
    q('prostate_cancer', 'pr_night', 'Do you get up more than twice at night to pass urine?',
      { level: 'follow_up', reason: 'Gets up more than twice at night to pass urine.' }, { sex: 'male' }),
    q('prostate_cancer', 'pr_stream', 'Is your urine flow weak, or hard to start?',
      { level: 'follow_up', reason: 'Urine flow is weak or hard to start.' }, { sex: 'male' }),
    q('prostate_cancer', 'pr_blood', 'Have you seen blood in your urine?',
      { level: 'refer_routine', reason: 'Has seen blood in the urine.' }, { sex: 'male' }),
    q('prostate_cancer', 'pr_bone', 'Do you have pain in your back, hips or bones that won’t go away?',
      { level: 'refer_routine', reason: 'Has bone, back or hip pain that won’t go away.' }, { sex: 'male' }),
  ],
  eye_health: [
    q('eye_health', 'eye_glasses', 'Do you wear glasses?'),
    q('eye_health', 'eye_sudden', 'Have you suddenly lost sight, or have eye pain or a red eye now?',
      { level: 'refer_urgent', reason: 'Has sudden loss of sight, eye pain or a red eye.' }),
  ],
  general_check: [
    q('general_check', 'gen_treated', 'Are you being treated for any illness now?'),
    q('general_check', 'gen_smoke', 'Do you smoke?', { level: 'follow_up', reason: 'Smokes: advice on stopping.' }),
    q('general_check', 'gen_alcohol', 'Do you drink alcohol most days?', { level: 'follow_up', reason: 'Drinks alcohol most days: advice.' }),
  ],
}

// ---------------------------------------------------------------------------------------------- per-focus package --

/** What each focus brings: its vitals and tests (by id); its questions are QUESTIONS[focus]. */
export const FOCUS_TEMPLATES: Readonly<Record<ScreeningFocus, { readonly vitals: readonly VitalId[]; readonly tests: readonly string[] }>> = {
  hypertension: { vitals: ['bp_systolic', 'bp_diastolic', 'pulse'], tests: [] },
  diabetes: { vitals: ['weight', 'height', 'bmi', 'blood_sugar'], tests: [] },
  hepatitis_b: { vitals: [], tests: ['hbsag'] },
  hiv: { vitals: [], tests: ['hiv_rapid'] },
  malaria: { vitals: ['temperature'], tests: ['malaria_rdt'] },
  breast_cancer: { vitals: [], tests: ['breast_exam'] },
  cervical_cancer: { vitals: [], tests: ['via'] },
  prostate_cancer: { vitals: [], tests: ['psa'] },
  eye_health: { vitals: [], tests: ['acuity_right', 'acuity_left', 'near_vision'] },
  general_check: { vitals: ['bp_systolic', 'bp_diastolic', 'pulse', 'temperature', 'weight', 'height', 'bmi', 'spo2'], tests: [] },
}

const TEST_ORDER = Object.keys(TESTS)
const FOCUS_ORDER: readonly ScreeningFocus[] = ['hypertension', 'diabetes', 'hepatitis_b', 'hiv', 'malaria', 'breast_cancer',
  'cervical_cancer', 'prostate_cancer', 'eye_health', 'general_check']

/** One focus's package. */
export function templateFor(focus: ScreeningFocus): ScreeningPackage {
  return packageFor([focus])
}

/**
 * The package for the focuses picked, merged: each vital, test and question once, vitals in the order they are taken
 * (blood pressure first), tests and questions in the focuses' order. BMI comes with weight and height only.
 */
export function packageFor(focuses: readonly ScreeningFocus[]): ScreeningPackage {
  const picked = FOCUS_ORDER.filter(focus => focuses.includes(focus))
  const vitalIds = new Set(picked.flatMap(focus => FOCUS_TEMPLATES[focus].vitals))
  if (!(vitalIds.has('weight') && vitalIds.has('height'))) vitalIds.delete('bmi')
  const testIds = new Set(picked.flatMap(focus => FOCUS_TEMPLATES[focus].tests))
  return mergePackages([{
    vitals: VITAL_ORDER.filter(id => vitalIds.has(id)).map(id => VITALS[id]),
    tests: TEST_ORDER.filter(id => testIds.has(id)).map(id => TESTS[id]!),
    questions: picked.flatMap(focus => QUESTIONS[focus]),
  }])
}

/** Merges packages (a template and the coordinator's own additions, say): the first of each id wins, nothing twice. */
export function mergePackages(packages: readonly ScreeningPackage[]): ScreeningPackage {
  const once = <T extends { id: string }>(items: readonly T[]) => {
    const seen = new Set<string>()
    return items.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)))
  }
  const vitals = once(packages.flatMap(item => item.vitals))
  return {
    vitals: [...vitals].sort((a, b) => order(VITAL_ORDER, a.id) - order(VITAL_ORDER, b.id)),
    tests: once(packages.flatMap(item => item.tests)),
    questions: once(packages.flatMap(item => item.questions)),
  }
}

function order<T>(list: readonly T[], item: T): number {
  const index = list.indexOf(item)
  return index < 0 ? list.length : index
}

/** Whether a test or question is for this person (sex and age). Unknown sex or age never leaves one out. */
export function appliesToPerson(item: { readonly appliesTo?: AppliesTo }, person: { readonly sex?: string | null; readonly ageYears?: number | null }): boolean {
  const rule = item.appliesTo
  if (!rule) return true
  if (rule.sex && (person.sex === 'female' || person.sex === 'male') && person.sex !== rule.sex) return false
  if (rule.minAge !== undefined && typeof person.ageYears === 'number' && person.ageYears < rule.minAge) return false
  return true
}

// -------------------------------------------------------------------------------------------------- the outcome --

/** One reason behind a suggestion. `sensitive` reasons (HIV, hepatitis B) are shown only to counsellors and clinicians. */
export interface Finding {
  readonly level: FindingLevel
  readonly reason: string
  readonly sensitive: boolean
  readonly source: { readonly kind: 'vital' | 'test' | 'question'; readonly id: string }
}

export interface OutcomeSuggestion {
  readonly kind: OutcomeKind
  /** Set for 'refer'. */
  readonly urgency?: Urgency
  /** Plain-word reasons, most serious first (all of them; use visibleReasons to hide sensitive ones). */
  readonly reasons: readonly string[]
  readonly findings: readonly Finding[]
  /** Tests still to do again (invalid, no valid retest yet). */
  readonly retests: readonly string[]
}

/** What suggestOutcome reads: the latest readings, every test result (retests too), and the answers. */
export interface OutcomeInputs {
  readonly vitals?: Partial<Record<VitalId, number>>
  readonly fasting?: boolean
  readonly tests?: ReadonlyArray<{ readonly testId: string; readonly result?: string; readonly value?: number; readonly attempt?: number }>
  readonly answers?: ReadonlyArray<{ readonly questionId: string; readonly value: AnswerValue }>
  /** The campaign's package, when it changed the templates; the default tests and questions otherwise. */
  readonly package?: ScreeningPackage
}

const LEVEL_RANK: Readonly<Record<FindingLevel, number>> = { normal: 0, follow_up: 1, refer_routine: 2, refer_urgent: 3 }

/** The plain words for a positive (or abnormal) result of each default test. */
const TEST_REASONS: Readonly<Record<string, Partial<Record<string, { level: FindingLevel; reason: string }>>>> = {
  hbsag: { positive: { level: 'refer_routine', reason: 'Hepatitis B test is positive. Needs care at a clinic that treats hepatitis B.' } },
  hiv_rapid: { positive: { level: 'refer_routine', reason: 'HIV test is reactive. Needs a confirming test and care at an HIV clinic.' } },
  malaria_rdt: { positive: { level: 'refer_routine', reason: 'Malaria test is positive. Needs malaria treatment.' } },
  breast_exam: { lump: { level: 'refer_routine', reason: 'A breast lump was found. Needs a check at a clinic.' } },
  via: {
    positive: { level: 'refer_routine', reason: 'Cervical check (VIA) is positive. Needs treatment at a clinic.' },
    suspicious: { level: 'refer_urgent', reason: 'Cervical check (VIA) looks like possible cancer. Needs to be seen soon.' },
  },
  near_vision: { needs_glasses: { level: 'follow_up', reason: 'Needs reading glasses.' } },
}

function testFinding(test: TestDefinition | undefined, testId: string, result: { result?: string; value?: number }): Finding | null {
  const source = { kind: 'test' as const, id: testId }
  const sensitive = test?.sensitive ?? false
  if (test?.kind === 'number' || (result.value !== undefined && result.result === undefined)) {
    const from = test?.abnormalFrom
    if (result.value === undefined || from === undefined || result.value < from) return null
    return { level: 'refer_routine', reason: `${test?.name ?? 'Test'} is ${result.value}${test?.unit ? ` ${test.unit}` : ''}. Needs a check at a clinic.`, sensitive, source }
  }
  const value = result.result
  if (value === undefined) return null
  const known = TEST_REASONS[testId]?.[value]
  if (known) return { ...known, sensitive, source }
  const option = test?.results.find(item => item.value === value)
  if (!option || option.flag === 'normal' || option.flag === 'invalid') return null
  if (testId === 'acuity_right' || testId === 'acuity_left') {
    const eye = testId === 'acuity_right' ? 'right' : 'left'
    const poor = value === '6/60' || value === 'worse_than_6_60'
    return { level: poor ? 'refer_routine' : 'follow_up', reason: `Distance vision in the ${eye} eye is ${option.label}. ${poor ? 'Needs an eye clinic.' : 'Needs an eye test for glasses.'}`, sensitive, source }
  }
  return { level: option.flag === 'urgent' ? 'refer_urgent' : 'refer_routine', reason: `${test?.name ?? 'Test'}: ${option.label}.`, sensitive, source }
}

/**
 * Suggests the outcome of a visit from its readings, results and answers: Refer urgent if anything needs to be seen
 * today, Refer routine if anything needs a clinic, Follow up if anything needs another look, otherwise Normal. Blood
 * pressure is judged on both numbers. A test that was invalid and not yet done again makes it at least Follow up, and is
 * listed in `retests`. Pure: the same inputs always give the same suggestion. A person confirms it.
 */
export function suggestOutcome(inputs: OutcomeInputs): OutcomeSuggestion {
  const findings: Finding[] = []
  const tests = inputs.package?.tests ?? Object.values(TESTS)
  const questions = inputs.package?.questions ?? Object.values(QUESTIONS).flat()

  // Vitals: blood pressure as one finding (the worse of the two numbers), the rest one each; BMI worked out if missing.
  const vitals = { ...inputs.vitals }
  if (vitals.bmi === undefined) {
    const bmi = bmiFrom(vitals.weight, vitals.height)
    if (bmi !== null) vitals.bmi = bmi
  }
  const pressure = [vitals.bp_systolic !== undefined ? flagVital('bp_systolic', vitals.bp_systolic) : null,
    vitals.bp_diastolic !== undefined ? flagVital('bp_diastolic', vitals.bp_diastolic) : null]
    .filter((flag): flag is VitalFlag => flag !== null && flag.level !== 'normal')
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0]
  if (pressure?.reason) {
    const both = vitals.bp_systolic !== undefined && vitals.bp_diastolic !== undefined ? ` (${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg)` : ''
    const reason = both ? pressure.reason.replace(/ \((top|bottom) number \d+\)/, both) : pressure.reason
    findings.push({ level: pressure.level, reason, sensitive: false, source: { kind: 'vital', id: 'blood_pressure' } })
  }
  for (const id of VITAL_ORDER) {
    const value = vitals[id]
    if (value === undefined || id === 'bp_systolic' || id === 'bp_diastolic') continue
    const flag = flagVital(id, value, { fasting: inputs.fasting ?? false })
    if (flag.level !== 'normal' && flag.reason) findings.push({ level: flag.level, reason: flag.reason, sensitive: false, source: { kind: 'vital', id } })
  }

  // Tests: the latest attempt of each counts; an invalid one with no later valid result asks for a retest.
  const latest = new Map<string, { result?: string; value?: number; attempt: number }>()
  for (const entry of inputs.tests ?? []) {
    const attempt = entry.attempt ?? 1
    const before = latest.get(entry.testId)
    if (!before || attempt >= before.attempt) latest.set(entry.testId, { ...entry, attempt })
  }
  const retests: string[] = []
  for (const [testId, entry] of latest) {
    const test = tests.find(item => item.id === testId)
    if (entry.result === 'invalid') {
      retests.push(testId)
      findings.push({ level: 'follow_up', reason: `${test?.name ?? 'A test'} was invalid and needs to be done again.`, sensitive: test?.sensitive ?? false,
        source: { kind: 'test', id: testId } })
      continue
    }
    const finding = testFinding(test, testId, entry)
    if (finding) findings.push(finding)
  }

  // Answers: a question's own flag.
  for (const answer of inputs.answers ?? []) {
    const question = questions.find(item => item.id === answer.questionId)
    if (!question?.flagWhen || question.flagWhen !== answer.value || !question.flagLevel) continue
    findings.push({ level: question.flagLevel, reason: question.flagReason ?? question.text, sensitive: question.focus === 'hiv' || question.focus === 'hepatitis_b',
      source: { kind: 'question', id: question.id } })
  }

  findings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])
  const worst = findings[0]?.level ?? 'normal'
  const reasons = findings.length ? findings.map(item => item.reason) : ['Everything checked today is in the usual range.']
  switch (worst) {
    case 'refer_urgent': return { kind: 'refer', urgency: 'urgent', reasons, findings, retests }
    case 'refer_routine': return { kind: 'refer', urgency: 'routine', reasons, findings, retests }
    case 'follow_up': return { kind: 'follow_up', reasons, findings, retests }
    case 'normal': return { kind: 'normal', reasons, findings, retests }
  }
}

/** The reasons someone may read: all of them for counsellors and clinicians, without the sensitive ones for anyone else. */
export function visibleReasons(suggestion: OutcomeSuggestion, seesSensitive: boolean): string[] {
  const shown = suggestion.findings.filter(item => seesSensitive || !item.sensitive).map(item => item.reason)
  if (shown.length === suggestion.findings.length) return [...suggestion.reasons]
  return [...shown, 'Some results can be shared only by a counsellor or clinician.']
}

export const OUTCOME_LABELS: Readonly<Record<OutcomeKind, string>> = { normal: 'Normal', follow_up: 'Follow up', refer: 'Refer' }

/** The outcome in words: "Normal", "Follow up", "Refer (urgent)", "Refer (routine)". */
export function outcomeText(kind: OutcomeKind, urgency?: Urgency): string {
  return kind === 'refer' ? `Refer (${urgency === 'urgent' ? 'urgent' : 'routine'})` : OUTCOME_LABELS[kind]
}

/** How a result flag reads on a badge. */
export function resultFlagText(flag: ResultFlag): string {
  return flag === 'normal' ? 'Normal' : flag === 'invalid' ? 'Test again' : flag === 'urgent' ? 'Needs to be seen soon' : 'Needs attention'
}
