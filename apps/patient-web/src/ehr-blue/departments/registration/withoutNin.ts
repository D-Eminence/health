import { lagosDay } from '@hid/ui/display'
import type { NoNinReason, RegisterWithoutNinInput, RegistrationCapabilities } from '../../../staff/api'
import { deskFieldProblem, deskValues, type DeskField, type DeskForm } from '../../collected/deskFields'

/*
 * Registration at the desk without a NIN (hid-system 0130, owner Q106 of 18 November 2026; identity-api
 * dto/register-without-nin.dto.ts and docs/INTERFACE_CONTRACT.md ID-2): the names, date of birth, gender, why there is
 * no NIN, the patient's phone and address (required unless the patient is a child) and the Health ID they say they
 * already have. Each rule here is Identity's own, checked before sending so a refusal is shown at its field.
 */

/** Each reason in plain words, in the order Identity lists them. */
export const NO_NIN_REASON_LABELS: Readonly<Record<NoNinReason, string>> = {
  nin_service_unavailable: 'NIN checks are not working right now',
  no_nin: 'The patient does not have a NIN',
  not_carried: 'The patient does not have their NIN with them',
  child: 'The patient is a child (under 18) without a NIN',
  foreign_national: 'The patient is a foreign national without a NIN',
}

function isReason(value: string): value is NoNinReason {
  return Object.prototype.hasOwnProperty.call(NO_NIN_REASON_LABELS, value)
}

/**
 * Whether the desk is offered registration without a NIN: whenever Identity says it takes one (INTERFACE_CONTRACT.md
 * ID-2, "Do not offer registration without a NIN until withoutNin.enabled is true"), NIN checks on or off, as a child or
 * someone with no NIN is registered either way.
 */
export function offersWithoutNin(capabilities: RegistrationCapabilities | null): boolean {
  return capabilities !== null && capabilities.withoutNin?.enabled === true && withoutNinReasons(capabilities).length > 0
}

/** Whether it is the new form itself: while NIN checks are off. While they work, the NIN form comes first. */
export function withoutNinFirst(capabilities: RegistrationCapabilities | null): boolean {
  return offersWithoutNin(capabilities) && capabilities?.nin.enabled !== true
}

/** The reasons Identity takes, in its order: only those this page can put in plain words. */
export function withoutNinReasons(capabilities: RegistrationCapabilities | null): readonly NoNinReason[] {
  return (capabilities?.withoutNin?.reasons ?? []).filter(isReason)
}

/** The form as typed, read from its controls (FormData). */
export interface WithoutNinForm {
  readonly firstName: string
  readonly lastName: string
  readonly dateOfBirth: string
  readonly gender: string
  readonly noNinReason: string
  readonly desk: DeskForm
}

export type WithoutNinField = 'firstName' | 'lastName' | 'dateOfBirth' | 'noNinReason' | DeskField

export const NAME_REFUSED = 'Enter the patient’s name, up to 100 characters.'
export const DOB_REFUSED = 'Enter the patient’s date of birth. It must be a real date, from 1900 on, and not in the future.'
export const REASON_REFUSED = 'Choose why the patient is registered without a NIN.'
/** identity-api WITHOUT_NIN_MESSAGES.notAChild, at the reason. */
export const NOT_A_CHILD = 'This date of birth makes the patient 18 or older. Choose another reason.'
/** For a child, the phone and address go together or not at all. */
export const CHILD_CONTACT_PARTIAL = 'For a child, give the whole phone and address, or leave them all empty.'

const CONTACT: readonly DeskField[] = ['phone', 'addressLine', 'city', 'stateCode', 'lga']
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** identity.register_patient_without_nin (0130) refuses a date of birth before this. */
export const EARLIEST_DOB = '1900-01-01'

/** A real calendar day (YYYY-MM-DD) from EARLIEST_DOB to `today`, as Identity takes it (strict, not after today in Lagos). */
function dateOfBirthValid(value: string, today: string): boolean {
  if (!DATE.test(value) || value < EARLIEST_DOB || value > today) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Today's date (YYYY-MM-DD) in Lagos, where Identity checks a date of birth. */
export function lagosToday(now: Date = new Date()): string {
  return lagosDay(now)
}

/** Whether a patient born on `dateOfBirth` is under 18 on `today` (both YYYY-MM-DD). */
export function isChild(dateOfBirth: string, today: string): boolean {
  const [year, month, day] = dateOfBirth.split('-').map(Number) as [number, number, number]
  const eighteenth = `${String(year + 18).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return eighteenth > today
}

function hasContact(desk: DeskForm): boolean {
  return CONTACT.some(field => desk[field].trim() !== '')
}

/** Whether the phone and address must be given: always, except for a child who has none of them. */
export function contactRequired(form: Pick<WithoutNinForm, 'noNinReason'>): boolean {
  return form.noNinReason !== 'child'
}

/** Each field's problem, in the form's order (names, date of birth, reason, then the desk's fields). */
export function withoutNinProblems(form: WithoutNinForm, today: string = lagosToday()): Array<readonly [WithoutNinField, string]> {
  const found: Array<readonly [WithoutNinField, string]> = []
  const first = form.firstName.trim()
  const last = form.lastName.trim()
  if (!first || first.length > 100) found.push(['firstName', NAME_REFUSED])
  if (!last || last.length > 100) found.push(['lastName', NAME_REFUSED])
  const dateValid = dateOfBirthValid(form.dateOfBirth, today)
  if (!dateValid) found.push(['dateOfBirth', DOB_REFUSED])
  if (!isReason(form.noNinReason)) found.push(['noNinReason', REASON_REFUSED])
  else if (form.noNinReason === 'child' && dateValid && !isChild(form.dateOfBirth, today)) found.push(['noNinReason', NOT_A_CHILD])
  const checkContact = contactRequired(form) || hasContact(form.desk)
  for (const field of CONTACT) {
    if (!checkContact) break
    const problem = deskFieldProblem(field, form.desk)
    if (!problem) continue
    // A child's partly given contact: what is missing is refused as missing from the set.
    found.push([field, !contactRequired(form) && form.desk[field].trim() === '' ? CHILD_CONTACT_PARTIAL : problem])
  }
  for (const field of ['hasExistingHealthId', 'existingHealthId'] as const) {
    const problem = deskFieldProblem(field, form.desk)
    if (problem) found.push([field, problem])
  }
  return found
}

/** The request body (without `purpose`, which the call adds). Only call once withoutNinProblems finds nothing. */
export function withoutNinInput(form: WithoutNinForm): RegisterWithoutNinInput {
  const desk = deskValues(form.desk)
  const gender = form.gender as RegisterWithoutNinInput['gender'] | ''
  const contact = contactRequired(form) || hasContact(form.desk)
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    dateOfBirth: form.dateOfBirth,
    ...(gender ? { gender } : {}),
    noNinReason: form.noNinReason as NoNinReason,
    ...(contact ? { phone: desk.phone, addressLine: desk.addressLine, city: desk.city, stateCode: desk.stateCode, lga: desk.lga } : {}),
    hasExistingHealthId: desk.hasExistingHealthId,
    ...(desk.hasExistingHealthId ? { existingHealthId: desk.existingHealthId } : {}),
  }
}
