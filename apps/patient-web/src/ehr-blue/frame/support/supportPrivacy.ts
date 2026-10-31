/**
 * The support assistant is anonymous and outside the record: staff must not type a patient into it. The notice says
 * so above the question, and a question holding a Health ID, a NIN, an email address or a phone number is refused
 * before anything is sent.
 */

export const SUPPORT_PRIVACY_NOTICE = 'For questions about using Health ID. Do not enter patient names, Health IDs, NINs or clinical details.'

export const PERSONAL_DETAILS_REFUSAL = 'Remove patient or personal details before sending.'

// Every dash a keyboard or a paste can give: hyphen, the Unicode hyphens and dashes, and minus.
const DASHES = '\\-\\u2010-\\u2015\\u2212'

/** Read against the whole question: a Health ID, with or without its hyphen. */
const IDENTIFIERS: readonly RegExp[] = [
  // A Health ID: HID- and its letters and digits.
  /\bHID-[A-Z0-9]/i,
  // HID (or "Health ID"), then a space, any dash, a colon or nothing, then its characters with a digit among them, in
  // any case: "HID ABC234", "hid abc234", "HIDABC234", "HID: ABC234", "HID – ABC234", as Health ID fields read them.
  new RegExp(`\\b(?:HID|Health\\s*ID)[\\s${DASHES}:_#./]{0,3}(?=[A-Z]*\\d)[A-Z0-9]{6,32}(?![A-Z0-9])`, 'i'),
  // Or all letters, in capitals as Health IDs are written: "HID ABCDEF".
  new RegExp(`\\bHID[\\s${DASHES}:_#./]{0,3}[A-HJ-NP-Z2-9]{6,32}(?![A-Za-z0-9])`),
]

/** Read once dates and clock times are taken out, so "2026-10-30 14:30" is not a phone number. */
const NUMBERS: readonly RegExp[] = [
  // A NIN: eleven digits together.
  /(?<!\d)\d{11}(?!\d)/,
  // An email address, a space either side of the @ included.
  /[^\s@]+\s?@\s?[^\s@]+\.[^\s@]+/,
  // A phone number: 10 to 15 digits, with spaces, dots, dashes, slashes or brackets between them and a + before (a
  // price's commas are not one).
  new RegExp(`(?<![\\d+])\\+?\\s?\\(?\\d(?:[\\s().${DASHES}/]{0,3}\\d){9,14}(?!\\d)`),
]

// A calendar date (year 19xx or 20xx, a real month and day, either order) or a clock time, standing alone: one that
// runs on into more digits ("0803.12.30.4567") is part of a number and stays.
const DAY = '(?:0?[1-9]|[12]\\d|3[01])', MONTH = '(?:0?[1-9]|1[0-2])', YEAR = '(?:19|20)\\d{2}'
const DATE_OR_TIME = new RegExp([
  `(?<!\\d[${DASHES}/.]?)(?:${YEAR}([${DASHES}/.])${MONTH}\\1${DAY}|${DAY}([${DASHES}/.])${MONTH}\\2${YEAR})(?![${DASHES}/.]?\\d)`,
  '(?<![\\d:])(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?(?![\\d:])',
].join('|'), 'g')

// Characters a paste can hide between digits or letters: soft hyphen, zero-width space and joiners, word joiner, BOM.
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g

/** Whether a question holds a patient's or a person's details, which the support assistant must never receive. */
export function holdsPersonalDetails(text: string): boolean {
  // Full-width letters, digits and signs as their plain forms, with nothing invisible between them.
  const plain = text.normalize('NFKC').replace(INVISIBLE, '')
  if (IDENTIFIERS.some(pattern => pattern.test(plain))) return true
  const undated = plain.replace(DATE_OR_TIME, ' ')
  return NUMBERS.some(pattern => pattern.test(undated))
}
