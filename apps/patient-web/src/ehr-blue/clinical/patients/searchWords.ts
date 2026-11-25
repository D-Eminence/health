import { isHidApiError, plainErrorText } from '@hid/http'
import { ageInYears as lagosAge, lagosDay } from '@hid/ui/display'
import type { PatientSearchAnswer } from '../../../staff/patientSearch'

/**
 * The words of staff patient search and emergency search (hid-system 0132), in plain English: what an answer without a
 * card says, and each refusal the contract lists. The server's own words are never shown as they are: a refusal about
 * the role says what the role can't do, never a permission's name.
 */

export const SEARCH_FAILED = 'We couldn’t search for the patient. Please try again.'
export const SEARCH_EXPIRED = 'This search result has expired. Search again.'

/** Said after a search that reached every facility but was narrowed by more than the name and date of birth. */
export const WIDEN_SEARCH = 'To search more widely, search with only the first name, last name and date of birth.'

/**
 * What a search that found no card says, by its outcome and reach (INTERFACE_CONTRACT 0132). `narrowed`: the search
 * reached every facility with keys other than exactly the first name, last name and date of birth, so a patient whose
 * phone or Health ID differs could still be registered: it points to the wider search.
 */
export function noCardText(answer: PatientSearchAnswer, narrowed = false): string {
  switch (answer.outcome) {
    case 'no_such_patient': return 'No patient has this Health ID.'
    case 'too_many': return answer.mode === 'emergency'
      ? 'More than 5 people match. Ask for a phone number or the Health ID.'
      : 'Too many matches. Add the date of birth or phone.'
    default: return answer.reach === 'here'
      ? 'No patient of this facility matches. To search every facility, add the full name and date of birth.'
      : narrowed ? `No patient matches these details. ${WIDEN_SEARCH}` : 'No patient matches these details.'
  }
}

/**
 * The search limits identity-api keeps (patient-search.service.ts): 30 standard searches per person in 10 minutes and
 * 300 per facility in an hour; 5 emergency searches per person in an hour. A limit reached stays for its whole window
 * (auth/rate-limit.ts), so a standard search may be stopped for up to an hour.
 */
export const PATIENT_SEARCH_LIMITED = 'You’ve reached the search limit: 30 searches in 10 minutes for each person, and 300 '
  + 'an hour for this facility. Try again later (it can take up to an hour), or use the patient’s Health ID.'
export const EMERGENCY_SEARCH_LIMITED = 'You’ve reached the limit of 5 emergency searches an hour. Use the patient’s Health ID instead.'

const REFUSALS: Readonly<Record<string, string>> = {
  PATIENT_SEARCH_TOO_BROAD: 'Add more details. Search with the first name, last name and date of birth, the Health ID with '
    + 'the last name or date of birth, or the phone with the last name.',
  PATIENT_SEARCH_PHONE_INVALID: 'Enter the phone number with its country code, or a Nigerian number starting with 0.',
  PATIENT_SEARCH_DATE_INVALID: 'Check the date of birth. It can’t be in the future.',
  PATIENT_SEARCH_LIMITED,
  PATIENT_SEARCH_UNAVAILABLE: 'Patient search is not available right now. Please try again in a minute.',
  EMERGENCY_SEARCH_REASON_REQUIRED: 'Say why you need an emergency search, in 8 to 500 characters.',
  BREAK_GLASS_DISABLED: 'Emergency access is switched off right now, so nobody was searched for. Ask Health ID support.',
  VALIDATION_FAILED: 'Check the details and try again.',
}

/** An emergency search's own words: its limit is 5 an hour. */
const EMERGENCY_REFUSALS: Readonly<Record<string, string>> = { ...REFUSALS, PATIENT_SEARCH_LIMITED: EMERGENCY_SEARCH_LIMITED }

/** A refused or failed search in plain words. */
export function searchRefusal(caught: unknown, emergency = false): string {
  if (isHidApiError(caught) && caught.status === 403) {
    return emergency ? 'Your role at this facility can’t search for patients in an emergency. Ask your facility administrator.'
      : 'Your role at this facility can’t search for patients by name. Ask your facility administrator.'
  }
  // An Identity before Release A answers 404: the search is not offered there yet.
  if (isHidApiError(caught) && caught.status === 404) return 'Search by name isn’t available yet. Use the patient’s Health ID.'
  return plainErrorText(caught, SEARCH_FAILED, { codes: emergency ? EMERGENCY_REFUSALS : REFUSALS, audience: 'facility' })
}

/** Today's date in Lagos as the date field takes it (YYYY-MM-DD), the latest date of birth (owner decision Q181 A). */
export function today(now = new Date()): string {
  return lagosDay(now)
}

/**
 * Age in whole years from a YYYY-MM-DD date of birth, on the Lagos calendar day of `now`; null when the date is not one.
 * Worked on the calendar figures: someone born on 29 February is a year older on 1 March.
 */
export function ageInYears(dateOfBirth: string | null | undefined, now = new Date()): number | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth ?? '') ? lagosAge(dateOfBirth, now) : null
}

/** "Female", "Male" or the word given, for a card's sex. */
export function sexWord(sex: string | null): string {
  if (!sex) return ''
  const words = sex.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
