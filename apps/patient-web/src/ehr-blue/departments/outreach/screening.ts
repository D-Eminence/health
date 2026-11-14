import type {
  OutreachGlucoseTiming, OutreachGlucoseUnit, OutreachHearing, OutreachMalariaRdt, OutreachScreening, OutreachScreeningInput,
} from '../../../staff/api'

/*
 * Health checks at an outreach event (outreach-api 0118): the form's words and checks, apart from the page so they can be
 * tested alone. The form checks every range Outreach checks, so a volunteer hears what to fix before anything is sent.
 */

/** The most medicines one screening lists. */
export const MEDICINES_LIMIT = 10

type YesNo = '' | 'yes' | 'no'

export interface MedicineRow {
  /** A key for the row while it is on the page, never sent. */
  readonly key: string
  readonly name: string
  readonly dose: string
}

/** The form as typed: text for numbers, '' for a choice not made. */
export interface ScreeningForm {
  readonly bpSystolic: string
  readonly bpDiastolic: string
  readonly pulseBpm: string
  readonly temperatureC: string
  readonly weightKg: string
  readonly heightCm: string
  readonly glucoseValue: string
  readonly glucoseUnit: '' | OutreachGlucoseUnit
  readonly glucoseTiming: '' | OutreachGlucoseTiming
  readonly malariaRdt: '' | OutreachMalariaRdt
  readonly hearingLeft: '' | OutreachHearing
  readonly hearingRight: '' | OutreachHearing
  /** Genotype and blood group (owner, 14 Nov 2026), kept at the start of "Outcome or advice" until Outreach has their own. */
  readonly genotype: '' | Genotype
  readonly bloodGroup: '' | BloodGroup
  readonly mainComplaint: string
  readonly seenByClinician: YesNo
  readonly clinicianName: string
  readonly outcome: string
  readonly medicines: readonly MedicineRow[]
  readonly referred: YesNo
  readonly referredTo: string
}

/** Genotypes and blood groups (owner, 14 Nov 2026: "we should collect genotype and blood group"). */
export const GENOTYPES = ['AA', 'AS', 'AC', 'SS', 'SC', 'CC', 'Not known'] as const
export type Genotype = typeof GENOTYPES[number]
export const BLOOD_GROUPS = ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−', 'Not known'] as const
export type BloodGroup = typeof BLOOD_GROUPS[number]

/**
 * Until Outreach keeps them in their own fields, genotype and blood group are saved at the start of "Outcome or advice",
 * always written the same way ("Genotype: AS. Blood group: O+."), so the form reads them back and they can be moved
 * into their own fields later without guessing.
 */
const BLOOD_TESTS = new RegExp(`^(?:Genotype: (${GENOTYPES.map(escape).join('|')})\\.\\s*)?(?:Blood group: (${BLOOD_GROUPS.map(escape).join('|')})\\.\\s*)?`)
function escape(value: string) { return value.replace(/[+.]/g, match => `\\${match}`) }
export function readBloodTests(outcome: string): { genotype: '' | Genotype; bloodGroup: '' | BloodGroup; rest: string } {
  const match = BLOOD_TESTS.exec(outcome)
  return { genotype: (match?.[1] ?? '') as '' | Genotype, bloodGroup: (match?.[2] ?? '') as '' | BloodGroup, rest: outcome.slice(match?.[0].length ?? 0) }
}
export function bloodTestsText(genotype: '' | Genotype, bloodGroup: '' | BloodGroup): string {
  return [genotype ? `Genotype: ${genotype}.` : '', bloodGroup ? `Blood group: ${bloodGroup}.` : ''].filter(Boolean).join(' ')
}

/** A field of the form an error is said on: one of the form's own, or a medicine row's name or dose. */
export type ScreeningField = Exclude<keyof ScreeningForm, 'medicines'> | `medicine-${string}-name` | `medicine-${string}-dose`

/** The order fields are checked in, for focus on the first refused (medicine rows follow `outcome`). */
export const FIELD_ORDER: readonly Exclude<keyof ScreeningForm, 'medicines'>[] = [
  'bpSystolic', 'bpDiastolic', 'pulseBpm', 'temperatureC', 'weightKg', 'heightCm', 'glucoseValue', 'glucoseUnit', 'glucoseTiming',
  'malariaRdt', 'hearingLeft', 'hearingRight', 'mainComplaint', 'seenByClinician', 'clinicianName', 'outcome', 'referred', 'referredTo',
]

/** What each of Outreach's fields is called on the page, for a refusal that names one (422 OUTREACH_SCREENING_OUT_OF_RANGE). */
export const FIELD_LABELS: Readonly<Record<Exclude<keyof OutreachScreeningInput, 'medicinesGiven'>, string>> = {
  bpSystolic: 'Blood pressure, top number', bpDiastolic: 'Blood pressure, bottom number', pulseBpm: 'Pulse',
  temperatureC: 'Temperature', weightKg: 'Weight', heightCm: 'Height', glucoseValue: 'Blood sugar reading',
  glucoseUnit: 'Blood sugar unit', glucoseTiming: 'Fasting or random', malariaRdt: 'Malaria rapid test',
  hearingLeft: 'Left ear', hearingRight: 'Right ear', mainComplaint: 'Main complaint', seenByClinician: 'Seen by a clinician',
  clinicianName: 'Clinician’s name', outcome: 'Outcome or advice', referred: 'Referred', referredTo: 'Referred to',
}

let rowSeq = 0
/** A new, empty medicine row. */
export function medicineRow(name = '', dose = ''): MedicineRow {
  rowSeq += 1
  return { key: `m${rowSeq}`, name, dose }
}

/** A medicine as written, for comparing: its name and dose, ignoring case and spacing. The row's key is never compared. */
const medicineId = (row: Pick<MedicineRow, 'name' | 'dose'>) =>
  `${row.name.trim().replace(/\s+/g, ' ').toLowerCase()}\u0000${row.dose.trim().replace(/\s+/g, ' ').toLowerCase()}`

/**
 * Whether one field holds the same in two forms. Medicines are compared by name and dose, in order: each read of a
 * screening gives its rows new keys, so comparing keys would make every saved medicine look like a change.
 */
export function sameField<K extends keyof ScreeningForm>(key: K, a: ScreeningForm[K], b: ScreeningForm[K]): boolean {
  if (key === 'medicines') {
    const left = a as readonly MedicineRow[]
    const right = b as readonly MedicineRow[]
    return left.length === right.length && left.every((row, index) => medicineId(row) === medicineId(right[index]!))
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Whether two forms hold the same health checks (see sameField). */
export function sameForm(a: ScreeningForm, b: ScreeningForm): boolean {
  return (Object.keys(a) as (keyof ScreeningForm)[]).every(key => sameField(key, a[key], b[key]))
}

/**
 * The medicines after someone else saved: theirs, without those this volunteer removed since the last read, and with those
 * this volunteer added, so neither station's medicines are lost.
 */
export function mergeMedicines(theirs: readonly MedicineRow[], mine: readonly MedicineRow[], before: readonly MedicineRow[]): MedicineRow[] {
  const ids = (rows: readonly MedicineRow[]) => new Set(rows.map(medicineId))
  const mineIds = ids(mine)
  const beforeIds = ids(before)
  const removed = new Set([...beforeIds].filter(id => !mineIds.has(id)))
  const merged = theirs.filter(row => !removed.has(medicineId(row)))
  const present = ids(merged)
  for (const row of mine) {
    const id = medicineId(row)
    if (!beforeIds.has(id) && !present.has(id)) { merged.push(row); present.add(id) }
  }
  return merged
}

/** Text as Outreach keeps it: trimmed, each run of spaces and line breaks one space. */
const squeeze = (value: string) => value.trim().replace(/\s+/g, ' ')

const text = (value: number | null | undefined) => value === null || value === undefined ? '' : String(value)
const yesNo = (value: boolean | null | undefined): YesNo => value === true ? 'yes' : value === false ? 'no' : ''

/** The form for a saved screening, or an empty one. */
export function screeningForm(saved: OutreachScreening | null): ScreeningForm {
  return {
    bpSystolic: text(saved?.bpSystolic), bpDiastolic: text(saved?.bpDiastolic), pulseBpm: text(saved?.pulseBpm),
    temperatureC: text(saved?.temperatureC), weightKg: text(saved?.weightKg), heightCm: text(saved?.heightCm),
    glucoseValue: text(saved?.glucoseValue), glucoseUnit: saved?.glucoseUnit ?? '', glucoseTiming: saved?.glucoseTiming ?? '',
    malariaRdt: saved?.malariaRdt ?? '', hearingLeft: saved?.hearingLeft ?? '', hearingRight: saved?.hearingRight ?? '',
    mainComplaint: saved?.mainComplaint ?? '', seenByClinician: yesNo(saved?.seenByClinician), clinicianName: saved?.clinicianName ?? '',
    ...(() => { const tests = readBloodTests(saved?.outcome ?? ''); return { genotype: tests.genotype, bloodGroup: tests.bloodGroup, outcome: tests.rest } })(),
    medicines: (saved?.medicinesGiven ?? []).map(medicine => medicineRow(medicine.name, medicine.dose ?? '')),
    referred: yesNo(saved?.referred), referredTo: saved?.referredTo ?? '',
  }
}

/**
 * A number as typed, or undefined when it is not one: digits with at most `decimals` decimal places (a comma is taken
 * as the decimal point, as many phones type it).
 */
export function parseNumber(typed: string, decimals: number): number | undefined {
  const value = typed.trim().replace(',', '.')
  const pattern = decimals > 0 ? new RegExp(`^\\d{1,4}(\\.\\d{1,${decimals}})?$`) : /^\d{1,4}$/
  return pattern.test(value) ? Number(value) : undefined
}

/**
 * Whether a reading typed is outside the usual range, so a clinician should see the person before they leave. Not a
 * diagnosis and never saved: a prompt only (clinical owner, 13 Nov). Blood pressure 180 or more over anything, or 110 or
 * more underneath, or a top number under 90; pulse over 120 or under 50; temperature 38.0 °C or more, or under 35.5 °C;
 * blood sugar under 3.9 or 11.1 mmol/L or more (under 70 or 200 mg/dL or more).
 */
export function outsideUsualRange(form: ScreeningForm): boolean {
  // Only readings Outreach takes are judged, so a number part-typed ("1" on the way to "120") never prompts.
  const value = (typed: string, decimals: number, low: number, high: number) => {
    const read = parseNumber(typed, decimals)
    return read !== undefined && read >= low && read <= high ? read : undefined
  }
  const top = value(form.bpSystolic, 0, 50, 300)
  const bottom = value(form.bpDiastolic, 0, 20, 200)
  const pulse = value(form.pulseBpm, 0, 20, 250)
  const temperature = value(form.temperatureC, 1, 30, 45)
  const mmol = form.glucoseUnit === 'mmol/L' ? value(form.glucoseValue, 1, 1, 40) : undefined
  const mgdl = form.glucoseUnit === 'mg/dL' ? value(form.glucoseValue, 1, 18, 720) : undefined
  return (top !== undefined && (top >= 180 || top < 90)) || (bottom !== undefined && bottom >= 110)
    || (pulse !== undefined && (pulse > 120 || pulse < 50))
    || (temperature !== undefined && (temperature >= 38 || temperature < 35.5))
    || (mmol !== undefined && (mmol < 3.9 || mmol >= 11.1))
    || (mgdl !== undefined && (mgdl < 70 || mgdl >= 200))
}

/** Whether weight and height give a BMI no one has (under 10 or over 70): most likely swapped or mistyped. */
export function implausibleBmi(form: Pick<ScreeningForm, 'weightKg' | 'heightCm'>): boolean {
  const bmi = bmiOf(form)
  return bmi !== null && (Number(bmi) < 10 || Number(bmi) > 70)
}

/** BMI from weight and height, to one decimal place, when both are typed and in range; for display only. */
export function bmiOf(form: Pick<ScreeningForm, 'weightKg' | 'heightCm'>): string | null {
  const weight = parseNumber(form.weightKg, 1)
  const height = parseNumber(form.heightCm, 0)
  if (weight === undefined || height === undefined || weight < 0.5 || weight > 400 || height < 30 || height > 250) return null
  return (weight / (height / 100) ** 2).toFixed(1)
}

const within = (value: number | undefined, low: number, high: number) => value !== undefined && value >= low && value <= high

/** The glucose range of each unit. */
const GLUCOSE_RANGE: Readonly<Record<OutreachGlucoseUnit, { low: number; high: number; words: string }>> = {
  'mmol/L': { low: 1, high: 40, words: 'from 1.0 to 40.0 mmol/L' },
  'mg/dL': { low: 18, high: 720, words: 'from 18 to 720 mg/dL' },
}

export const NOTHING_RECORDED = 'Enter at least one health check before saving.'

/**
 * The form checked as Outreach checks it: the screening to send, or the errors by field (and a form-level error when
 * nothing at all is recorded). Choices that only go with another answer (the clinician's name, where they were referred,
 * a blood sugar's unit and timing) are sent only with it.
 */
export function checkScreening(form: ScreeningForm): { input: OutreachScreeningInput; errors: Partial<Record<ScreeningField, string>>; empty: boolean } {
  const errors: Partial<Record<ScreeningField, string>> = {}
  const number = (field: keyof ScreeningForm & string, decimals: number, low: number, high: number, words: string) => {
    const typed = (form[field] as string).trim()
    if (!typed) return null
    const value = parseNumber(typed, decimals)
    if (!within(value, low, high)) { errors[field as ScreeningField] = words; return null }
    return value!
  }
  const systolic = number('bpSystolic', 0, 50, 300, 'Enter the top number, from 50 to 300, in whole numbers.')
  const diastolic = number('bpDiastolic', 0, 20, 200, 'Enter the bottom number, from 20 to 200, in whole numbers.')
  if (form.bpSystolic.trim() && !form.bpDiastolic.trim()) errors.bpDiastolic = 'Enter both blood pressure numbers, or neither.'
  if (!form.bpSystolic.trim() && form.bpDiastolic.trim()) errors.bpSystolic = 'Enter both blood pressure numbers, or neither.'
  if (systolic !== null && diastolic !== null && diastolic >= systolic) errors.bpDiastolic = 'The bottom number must be lower than the top number.'
  const pulseBpm = number('pulseBpm', 0, 20, 250, 'Enter a pulse from 20 to 250 beats a minute, in whole numbers.')
  const temperatureC = number('temperatureC', 1, 30, 45, 'Enter a temperature from 30.0 to 45.0 °C, with one decimal place at most.')
  const weightKg = number('weightKg', 1, 0.5, 400, 'Enter a weight from 0.5 to 400 kg, with one decimal place at most.')
  const heightCm = number('heightCm', 0, 30, 250, 'Enter a height from 30 to 250 cm, in whole numbers. In centimetres: 1.65 m is 165.')

  let glucoseValue: number | null = null
  const glucoseTyped = form.glucoseValue.trim()
  if (glucoseTyped) {
    if (!form.glucoseUnit) errors.glucoseUnit = 'Choose the unit of the blood sugar reading.'
    if (!form.glucoseTiming) errors.glucoseTiming = 'Choose fasting or random.'
    const value = parseNumber(glucoseTyped, 1)
    const range = form.glucoseUnit ? GLUCOSE_RANGE[form.glucoseUnit] : undefined
    if (value === undefined) errors.glucoseValue = 'Enter the reading as a number, with one decimal place at most.'
    else if (range && !within(value, range.low, range.high)) errors.glucoseValue = `Enter a reading ${range.words}.`
    else glucoseValue = value
  }

  // Text is sent as Outreach keeps it: trimmed, with each run of spaces and line breaks made one space. Otherwise, after a
  // lost answer, what Outreach holds never matches what was sent, and the next save looks like someone else's.
  const words = (field: 'mainComplaint' | 'clinicianName' | 'outcome' | 'referredTo', limit: number) => {
    const value = squeeze(form[field])
    if (value.length > limit) errors[field] = `Keep this to ${limit} characters.`
    return value || null
  }
  const mainComplaint = words('mainComplaint', 200)
  const seen = form.seenByClinician === '' ? null : form.seenByClinician === 'yes'
  const clinicianName = seen ? words('clinicianName', 100) : null
  // Genotype and blood group go first in "Outcome or advice" (see readBloodTests), within its 500 characters.
  const tests = bloodTestsText(form.genotype, form.bloodGroup)
  const advice = squeeze(form.outcome)
  const room = 500 - (tests ? tests.length + 1 : 0)
  if (advice.length > room) errors.outcome = `Keep this to ${room} characters.`
  const outcome = [tests, advice].filter(Boolean).join(' ') || null
  const referred = form.referred === '' ? null : form.referred === 'yes'
  const referredTo = referred ? words('referredTo', 200) : null

  const medicines = form.medicines.filter(row => squeeze(row.name) || squeeze(row.dose))
  for (const row of medicines) {
    if (!squeeze(row.name)) errors[`medicine-${row.key}-name`] = 'Enter the medicine’s name, as given.'
    else if (squeeze(row.name).length > 100) errors[`medicine-${row.key}-name`] = 'Keep the name to 100 characters.'
    if (squeeze(row.dose).length > 200) errors[`medicine-${row.key}-dose`] = 'Keep the dose to 200 characters.'
  }

  const input: OutreachScreeningInput = {
    bpSystolic: systolic, bpDiastolic: diastolic, pulseBpm, temperatureC, weightKg, heightCm,
    glucoseValue, glucoseUnit: glucoseTyped && form.glucoseUnit ? form.glucoseUnit : null,
    glucoseTiming: glucoseTyped && form.glucoseTiming ? form.glucoseTiming : null,
    malariaRdt: form.malariaRdt || null, hearingLeft: form.hearingLeft || null, hearingRight: form.hearingRight || null,
    mainComplaint, seenByClinician: seen, clinicianName, outcome,
    medicinesGiven: medicines.length ? medicines.map(row => ({ name: squeeze(row.name), dose: squeeze(row.dose) || null })) : null,
    referred, referredTo,
  }
  // Nothing to record unless some value reaches Outreach: a unit, timing or hidden clinician name alone is not a check.
  const recorded = Object.values(input).some(value => value !== null && value !== false)
  return { input, errors, empty: !recorded }
}

/** The groups of fields saved together: a blood pressure is both numbers, a blood sugar is its reading, unit and timing. */
const SCREENING_GROUPS: readonly (readonly (keyof OutreachScreeningInput)[])[] = [
  ['bpSystolic', 'bpDiastolic'], ['glucoseValue', 'glucoseUnit', 'glucoseTiming'], ['seenByClinician', 'clinicianName'], ['referred', 'referredTo'],
]

/** The fields of the form (and of what Outreach keeps) that a refusal on `field` leaves unsaved. */
export function skippedFields(field: string): readonly (keyof OutreachScreeningInput)[] {
  if (field.startsWith('medicine-')) return ['medicinesGiven']
  return SCREENING_GROUPS.find(group => (group as readonly string[]).includes(field)) ?? [field as keyof OutreachScreeningInput]
}

/**
 * Save anyway (owner, 14 Nov 2026: "without input info like this they should be able continue"): the screening with
 * every part the volunteer left unfinished or wrong (a blood sugar without its unit, one blood pressure number, a value out
 * of range, an over-long note) kept as it was saved before, or empty when it never was, so the rest is saved and nothing
 * already saved is lost. Returns the screening to send and the form fields left for the volunteer to finish.
 */
export function withUnfinishedLeftOut(input: OutreachScreeningInput, errors: Partial<Record<ScreeningField, string>>,
  saved: OutreachScreeningInput | null): { input: OutreachScreeningInput; left: readonly (keyof OutreachScreeningInput)[] } {
  const left = [...new Set(Object.keys(errors).flatMap(field => skippedFields(field)))]
  const kept: Record<string, unknown> = { ...input }
  for (const field of left) kept[field] = saved ? saved[field] : null
  return { input: kept as unknown as OutreachScreeningInput, left }
}

/** The page's field a refusal's detail names (422 OUTREACH_SCREENING_OUT_OF_RANGE), when it names one. */
export function fieldNamedIn(detail: string | null): Exclude<keyof OutreachScreeningInput, 'medicinesGiven'> | null {
  if (!detail) return null
  const names = Object.keys(FIELD_LABELS) as Exclude<keyof OutreachScreeningInput, 'medicinesGiven'>[]
  // Longest first, so that "referredTo" is not read as "referred".
  return [...names].sort((a, b) => b.length - a.length).find(name => new RegExp(`\\b${name}\\b`).test(detail)) ?? null
}
