import type {
  OutreachBloodGroup, OutreachGenotype, OutreachGlucoseTiming, OutreachGlucoseUnit, OutreachHearing, OutreachMalariaRdt, OutreachScreening,
  OutreachScreeningExtra, OutreachScreeningInput,
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
  readonly genotype: '' | OutreachGenotype
  readonly bloodGroup: '' | OutreachBloodGroup
  readonly mainComplaint: string
  readonly seenByClinician: YesNo
  readonly clinicianName: string
  readonly outcome: string
  readonly medicines: readonly MedicineRow[]
  readonly referred: YesNo
  readonly referredTo: string
}

/** A field of the form an error is said on: one of the form's own, or a medicine row's name or dose. */
export type ScreeningField = Exclude<keyof ScreeningForm, 'medicines'> | `medicine-${string}-name` | `medicine-${string}-dose`

/** The order fields are checked in, for focus on the first refused (medicine rows follow `outcome`). */
export const FIELD_ORDER: readonly Exclude<keyof ScreeningForm, 'medicines'>[] = [
  'bpSystolic', 'bpDiastolic', 'pulseBpm', 'temperatureC', 'weightKg', 'heightCm', 'glucoseValue', 'glucoseUnit', 'glucoseTiming',
  'malariaRdt', 'genotype', 'bloodGroup', 'hearingLeft', 'hearingRight', 'mainComplaint', 'seenByClinician', 'clinicianName', 'outcome', 'referred', 'referredTo',
]

/** What each of Outreach's fields is called on the page, for a refusal that names one (422 OUTREACH_SCREENING_OUT_OF_RANGE). */
export const FIELD_LABELS: Readonly<Record<Exclude<keyof OutreachScreeningInput, 'medicinesGiven'>, string>> = {
  bpSystolic: 'Blood pressure, top number', bpDiastolic: 'Blood pressure, bottom number', pulseBpm: 'Pulse',
  temperatureC: 'Temperature', weightKg: 'Weight', heightCm: 'Height', glucoseValue: 'Blood sugar reading',
  glucoseUnit: 'Blood sugar unit', glucoseTiming: 'Fasting or random', malariaRdt: 'Malaria rapid test',
  genotype: 'Genotype', bloodGroup: 'Blood group',
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
    genotype: saved?.genotype ?? '', bloodGroup: saved?.bloodGroup ?? '',
    mainComplaint: saved?.mainComplaint ?? '', seenByClinician: yesNo(saved?.seenByClinician), clinicianName: saved?.clinicianName ?? '',
    outcome: saved?.outcome ?? '', medicines: (saved?.medicinesGiven ?? []).map(medicine => medicineRow(medicine.name, medicine.dose ?? '')),
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

/** The fields an Outreach may not take yet (0122), in the order they are sent. */
export const SCREENING_EXTRAS: readonly OutreachScreeningExtra[] = ['genotype', 'bloodGroup']

/** The extra fields a screening as sent carries: those Outreach was known to take when it was made. */
export function extrasOf(input: OutreachScreeningInput): OutreachScreeningExtra[] {
  return SCREENING_EXTRAS.filter(key => key in input)
}

/**
 * The form checked as Outreach checks it: the screening to send, and the errors by field. Every field is optional: a
 * form with nothing in it is `empty`, which the page still saves the first time (owner, 14 Nov 2026). Choices that only
 * go with another answer (the clinician's name, where they were referred, a blood sugar's unit and timing) are sent only
 * with it. Genotype and blood group are sent only when `extras` names them (an Outreach known to take them), as null
 * when not chosen; otherwise their keys are left out, as an earlier Outreach refuses a field it does not know.
 */
export function checkScreening(form: ScreeningForm, extras: readonly OutreachScreeningExtra[] = []): {
  input: OutreachScreeningInput; errors: Partial<Record<ScreeningField, string>>; empty: boolean
} {
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
  const outcome = words('outcome', 500)
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
    ...(extras.includes('genotype') ? { genotype: form.genotype || null } : {}),
    ...(extras.includes('bloodGroup') ? { bloodGroup: form.bloodGroup || null } : {}),
  }
  // Nothing to record unless some value reaches Outreach: a unit, timing or hidden clinician name alone is not a check.
  const recorded = Object.values(input).some(value => value !== null && value !== false)
  return { input, errors, empty: !recorded }
}

/** The page's field a refusal's detail names (422 OUTREACH_SCREENING_OUT_OF_RANGE), when it names one. */
export function fieldNamedIn(detail: string | null): Exclude<keyof OutreachScreeningInput, 'medicinesGiven'> | null {
  if (!detail) return null
  const names = Object.keys(FIELD_LABELS) as Exclude<keyof OutreachScreeningInput, 'medicinesGiven'>[]
  // Longest first, so that "referredTo" is not read as "referred".
  return [...names].sort((a, b) => b.length - a.length).find(name => new RegExp(`\\b${name}\\b`).test(detail)) ?? null
}
