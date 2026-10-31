/**
 * The support assistant is anonymous and outside the record: staff must not type a patient into it. The notice says
 * so above the question, and a question holding a Health ID, a NIN, an email address or a phone number is refused
 * before anything is sent.
 */

export const SUPPORT_PRIVACY_NOTICE = 'For questions about using Health ID. Do not enter patient names, Health IDs, NINs or clinical details.'

export const PERSONAL_DETAILS_REFUSAL = 'Remove patient or personal details before sending.'

const PERSONAL_DETAILS: readonly RegExp[] = [
  // A Health ID: HID- and its letters and digits.
  /\bHID-[A-Z0-9]/i,
  // A NIN: eleven digits together.
  /(?<!\d)\d{11}(?!\d)/,
  // An email address.
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  // A phone number: 10 to 15 digits, with spaces, dots, dashes or brackets between them and a + before (a date's
  // eight digits, or a price, are not one).
  /(?<![\d+])\+?\s?\(?\d(?:[\s().-]{0,2}\d){9,14}(?!\d)/,
]

/** Whether a question holds a patient's or a person's details, which the support assistant must never receive. */
export function holdsPersonalDetails(text: string): boolean {
  return PERSONAL_DETAILS.some(pattern => pattern.test(text))
}
