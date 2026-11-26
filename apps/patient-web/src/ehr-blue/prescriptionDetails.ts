import { isHidApiError } from '@hid/http'
import { refusedFields } from '../staff/fieldProblem'
import { priorityLabel } from '../staff/orderRoutes'
import type { FieldDef, FieldErrors, FormValues } from './clinical/parts/RecordForm'

/**
 * A prescription's dispensing details (hid-system 0125, Ola's request): its strength and form as the prescriber means
 * them, how long it is for, how much to hand over, and how soon. The EHR takes them on a new prescription only while
 * its setting is on, and then says so on the prescriptions list (`dispensingDetails: true`, beside the items). Until a
 * list has said so, the prescribe form shows and sends exactly what it does today: a backend without the setting
 * refuses any of these fields (400, "property priority should not exist").
 *
 * The request names, values and limits are ehr-api's CreatePrescriptionWithDetailsDto (clinical.dto.ts):
 * `priority` routine, urgent, asap or stat; `strength` 1 to 80 characters; `doseForm` tablet, capsule, liquid,
 * injection, cream, inhaler, drops or other; `durationValue` a whole number 1 to 3650 with `durationUnit` day, week or
 * month; `quantityToDispense` above 0 with up to 4 decimal places, at most 99999999.9999, with `quantityUnit` 1 to 80
 * characters. Each pair goes together (400 DURATION_INCOMPLETE, QUANTITY_INCOMPLETE). The pharmacist still confirms
 * the quantity handed over (decision D9).
 */

/** Whether a prescriptions list answer says the EHR takes the details: only an explicit `true`. */
export function takesDispensingDetails(answer: unknown): boolean {
  return typeof answer === 'object' && answer !== null && (answer as { dispensingDetails?: unknown }).dispensingDetails === true
}

export const DOSE_FORMS = [
  { value: 'tablet', label: 'Tablet' }, { value: 'capsule', label: 'Capsule' }, { value: 'liquid', label: 'Liquid' },
  { value: 'injection', label: 'Injection' }, { value: 'cream', label: 'Cream' }, { value: 'inhaler', label: 'Inhaler' },
  { value: 'drops', label: 'Drops' }, { value: 'other', label: 'Other' },
] as const

export const DURATION_UNITS = [
  { value: 'day', label: 'Days' }, { value: 'week', label: 'Weeks' }, { value: 'month', label: 'Months' },
] as const

/** The EHR's priorities, in the words the rest of the app uses for them (staff orderRoutes' priorityLabel). */
export const PRESCRIPTION_PRIORITIES: readonly { value: string; label: string }[] = ['routine', 'urgent', 'asap', 'stat']
  .map(value => ({ value, label: priorityLabel(value) ?? value }))

export const STRENGTH_HINT = 'As written on the pack, for example 500 mg.'
export const QUANTITY_HINT = 'The pharmacist checks this before handing it over.'
export const PRIORITY_HINT = 'This facility’s Pharmacy sees this on the prescription. It does not alert them, so phone if it cannot wait.'
export const DURATION_NUMBER_TEXT = 'Enter how long as a whole number from 1 to 3650.'
export const DURATION_PAIR = 'Enter both how long and days, weeks or months, or leave both blank.'
export const QUANTITY_NUMBER_TEXT = 'Enter the quantity as a number above 0, like 21 or 2.5 (up to 8 digits and 4 decimal places).'
export const QUANTITY_PAIR = 'Enter both the quantity to dispense and its unit, or leave both blank.'
export const DETAILS_NOT_TAKEN = 'This prescription was not saved. Health ID is not taking strength, form, how long for, '
  + 'quantity to dispense or priority at the moment, so those fields have been taken off the form. Check the prescription and save it again.'
/**
 * Said where a prescription that carries any of the details is sent to a pharmacy at another facility, and beside the
 * prescribe form's hint on sending it there once one is filled in: what goes there carries none of them (the backend
 * contract, item 4b), only the instructions.
 */
export const ROUTED_DETAILS_NOT_SENT = 'A pharmacy at another facility will not see the strength, form, how long for, quantity to dispense '
  + 'or priority. Write them in the instructions.'
/** After it, on the send itself: a saved prescription's instructions can't be changed (Ola, clinical owner). */
export const ROUTED_DETAILS_REWRITE = 'If the instructions don’t already say them, cancel this prescription and write a new one with them in the instructions.'

/** The details' fields, by their request names (a refusal naming one is then marked at it). */
export const DETAIL_FIELDS: readonly FieldDef[] = [
  { key: 'strength', label: 'Strength', placeholder: '500 mg', maxLength: 80, row: 'strength', hint: STRENGTH_HINT },
  { key: 'doseForm', label: 'Form', row: 'strength', choices: DOSE_FORMS },
  { key: 'durationValue', label: 'How long for', inputMode: 'numeric', placeholder: '7', maxLength: 4, row: 'duration' },
  { key: 'durationUnit', label: 'Days, weeks or months', row: 'duration', choices: DURATION_UNITS },
  { key: 'quantityToDispense', label: 'Quantity to dispense', inputMode: 'decimal', placeholder: '21', maxLength: 13, row: 'quantity',
    hint: QUANTITY_HINT, normalise: value => value.replace(/^\s*\./, '0.') },
  { key: 'quantityUnit', label: 'Quantity unit', placeholder: 'capsules', maxLength: 80, row: 'quantity' },
  { key: 'priority', label: 'Priority', choices: PRESCRIPTION_PRIORITIES, hint: PRIORITY_HINT },
]

const DETAIL_KEYS: ReadonlySet<string> = new Set(DETAIL_FIELDS.map(field => field.key))

/** Today's fields with the details before the last one (the instructions), or today's fields unchanged. */
export function withDetailFields(fields: readonly FieldDef[], details: boolean): readonly FieldDef[] {
  if (!details) return fields
  return [...fields.slice(0, -1), ...DETAIL_FIELDS, ...fields.slice(-1)]
}

function text(values: FormValues, key: string): string {
  const entry = values[key]
  return typeof entry === 'string' ? entry.trim() : ''
}

/** Whether any of the details is filled in; never while the EHR does not take them (the form then has none). */
export function fillsDetails(values: FormValues, details: boolean): boolean {
  return details && DETAIL_FIELDS.some(field => text(values, field.key) !== '')
}

const WHOLE = /^\d{1,4}$/
const QUANTITY = /^\d{1,8}(\.\d{1,4})?$/

/** The details' checks, as the EHR makes them; nothing while it does not take them. */
export function checkDetails(values: FormValues, details: boolean): FieldErrors {
  if (!details) return {}
  const errors: Record<string, string> = {}
  const duration = text(values, 'durationValue')
  const durationUnit = text(values, 'durationUnit')
  if (duration && (!WHOLE.test(duration) || Number(duration) < 1 || Number(duration) > 3650)) errors.durationValue = DURATION_NUMBER_TEXT
  else if (!duration !== !durationUnit) errors[duration ? 'durationUnit' : 'durationValue'] = DURATION_PAIR
  const quantity = text(values, 'quantityToDispense')
  const quantityUnit = text(values, 'quantityUnit')
  if (quantity && (!QUANTITY.test(quantity) || Number(quantity) <= 0)) errors.quantityToDispense = QUANTITY_NUMBER_TEXT
  else if (!quantity !== !quantityUnit) errors[quantity ? 'quantityUnit' : 'quantityToDispense'] = QUANTITY_PAIR
  return errors
}

/** The details to add to the create body: each one given, by the EHR's names; nothing while it does not take them. */
export function detailsBody(values: FormValues, details: boolean): Record<string, string | number> {
  if (!details) return {}
  const body: Record<string, string | number> = {}
  for (const key of ['priority', 'strength', 'doseForm', 'durationUnit', 'quantityUnit']) {
    const value = text(values, key)
    if (value) body[key] = value
  }
  const duration = text(values, 'durationValue')
  if (duration) body.durationValue = Number(duration)
  const quantity = text(values, 'quantityToDispense')
  if (quantity) body.quantityToDispense = Number(quantity)
  return body
}

/**
 * A create refused over the details, in plain words: a pair the EHR found incomplete, marked at its field; or a
 * detail it no longer takes (its setting turned off since the list said it did), `notTaken`. Null for any other
 * refusal, which the form says as today.
 */
export function detailsRefusal(caught: unknown): { formError: string; fieldErrors: FieldErrors; notTaken?: true } | null {
  if (!isHidApiError(caught)) return null
  if (caught.code === 'DURATION_INCOMPLETE') return { formError: DURATION_PAIR, fieldErrors: { durationValue: DURATION_PAIR } }
  if (caught.code === 'QUANTITY_INCOMPLETE') return { formError: QUANTITY_PAIR, fieldErrors: { quantityToDispense: QUANTITY_PAIR } }
  const notTaken = refusedFields(caught).some(item => DETAIL_KEYS.has(item.field)
    && item.messages.some(message => /should not exist/.test(message)))
  return notTaken ? { formError: DETAILS_NOT_TAKEN, fieldErrors: {}, notTaken: true } : null
}

function labelOf(choices: readonly { value: string; label: string }[], value: string): string {
  return choices.find(choice => choice.value === value)?.label ?? value
}

function numberText(value: unknown): string {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? String(number) : ''
}

const UNIT_WORDS: Readonly<Record<string, readonly [string, string]>> = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'] }

/**
 * The details a saved prescription carries, as its page shows them: only those the EHR answered (a prescription
 * written without them, or a backend without the setting, shows none of these lines).
 */
export function detailLines(record: Record<string, unknown>): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = []
  const word = (key: string) => typeof record[key] === 'string' ? (record[key] as string).trim() : ''
  if (word('strength')) lines.push({ label: 'Strength', value: word('strength') })
  if (word('doseForm')) lines.push({ label: 'Form', value: labelOf(DOSE_FORMS, word('doseForm')) })
  const duration = numberText(record.durationValue)
  if (duration && word('durationUnit')) {
    const unit = UNIT_WORDS[word('durationUnit')]
    lines.push({ label: 'How long for', value: `${duration} ${unit ? unit[Number(duration) === 1 ? 0 : 1] : word('durationUnit')}` })
  }
  const quantity = numberText(record.quantityToDispense)
  if (quantity) lines.push({ label: 'Quantity to dispense', value: word('quantityUnit') ? `${quantity} ${word('quantityUnit')}` : quantity })
  if (word('priority')) lines.push({ label: 'Priority', value: labelOf(PRESCRIPTION_PRIORITIES, word('priority')) })
  return lines
}
