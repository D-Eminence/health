import { isHidApiError, plainErrorText } from '@hid/http'
import type { PatientSearchAnswer } from '../../../staff/patientSearch'

/**
 * The words of staff patient search and emergency search (hid-system 0132), in plain English: what an answer without a
 * card says, and each refusal the contract lists. The server's own words are never shown as they are: a refusal about
 * the role says what the role can't do, never a permission's name.
 */

export const SEARCH_FAILED = 'We couldn’t search for the patient. Please try again.'
export const SEARCH_EXPIRED = 'This search result has expired. Search again.'

/** What a search that found no card says, by its outcome and reach (INTERFACE_CONTRACT 0132). */
export function noCardText(answer: PatientSearchAnswer): string {
  switch (answer.outcome) {
    case 'no_such_patient': return 'No patient has this Health ID.'
    case 'too_many': return answer.mode === 'emergency'
      ? 'More than 5 people match. Ask for a phone number or the Health ID.'
      : 'Too many matches. Add the date of birth or phone.'
    default: return answer.reach === 'here'
      ? 'No patient of this facility matches. To search every facility, add the full name and date of birth.'
      : 'No patient matches these details.'
  }
}

const REFUSALS: Readonly<Record<string, string>> = {
  PATIENT_SEARCH_TOO_BROAD: 'Add more details. Search with the first name, last name and date of birth, the Health ID with '
    + 'the last name or date of birth, or the phone with the last name.',
  PATIENT_SEARCH_PHONE_INVALID: 'Enter the phone number with its country code, or a Nigerian number starting with 0.',
  PATIENT_SEARCH_DATE_INVALID: 'Check the date of birth. It can’t be in the future.',
  PATIENT_SEARCH_LIMITED: 'Too many searches. Please wait a few minutes and try again.',
  PATIENT_SEARCH_UNAVAILABLE: 'Patient search is not available right now. Please try again in a minute.',
  EMERGENCY_SEARCH_REASON_REQUIRED: 'Say why you need an emergency search, in 8 to 500 characters.',
  BREAK_GLASS_DISABLED: 'Emergency access is switched off right now, so nobody was searched for. Ask Health ID support.',
  VALIDATION_FAILED: 'Check the details and try again.',
}

/** A refused or failed search in plain words. */
export function searchRefusal(caught: unknown, emergency = false): string {
  if (isHidApiError(caught) && caught.status === 403) {
    return emergency ? 'Your role at this facility can’t search for patients in an emergency. Ask your facility administrator.'
      : 'Your role at this facility can’t search for patients by name. Ask your facility administrator.'
  }
  // An Identity before Release A answers 404: the search is not offered there yet.
  if (isHidApiError(caught) && caught.status === 404) return 'Search by name isn’t available yet. Use the patient’s Health ID.'
  return plainErrorText(caught, SEARCH_FAILED, { codes: REFUSALS, audience: 'facility' })
}

/** Today's date as the date field takes it (YYYY-MM-DD, local), the latest date of birth. */
export function today(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** "Female", "Male" or the word given, for a card's sex. */
export function sexWord(sex: string | null): string {
  if (!sex) return ''
  const words = sex.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
