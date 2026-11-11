/**
 * What facility sign-up, Facility setup and patient registration share now that Health ID collects their details
 * (hid-system 0122, owner: "allow trading name, all fields required"): Nigeria's states as Identity keeps them, the
 * phone rule, and the email rule.
 */

/** ISO 3166-2:NG, as identity.nigeria_states holds them (contract §5). The FCT is shown with its short name too. */
export const NIGERIA_STATES: ReadonlyArray<readonly [code: string, name: string]> = [
  ['AB', 'Abia'], ['AD', 'Adamawa'], ['AK', 'Akwa Ibom'], ['AN', 'Anambra'], ['BA', 'Bauchi'], ['BY', 'Bayelsa'],
  ['BE', 'Benue'], ['BO', 'Borno'], ['CR', 'Cross River'], ['DE', 'Delta'], ['EB', 'Ebonyi'], ['ED', 'Edo'],
  ['EK', 'Ekiti'], ['EN', 'Enugu'], ['FC', 'Federal Capital Territory (FCT)'], ['GO', 'Gombe'], ['IM', 'Imo'],
  ['JI', 'Jigawa'], ['KD', 'Kaduna'], ['KN', 'Kano'], ['KT', 'Katsina'], ['KE', 'Kebbi'], ['KO', 'Kogi'],
  ['KW', 'Kwara'], ['LA', 'Lagos'], ['NA', 'Nasarawa'], ['NI', 'Niger'], ['OG', 'Ogun'], ['ON', 'Ondo'],
  ['OS', 'Osun'], ['OY', 'Oyo'], ['PL', 'Plateau'], ['RI', 'Rivers'], ['SO', 'Sokoto'], ['TA', 'Taraba'],
  ['YO', 'Yobe'], ['ZA', 'Zamfara'],
]

const STATE_CODES: ReadonlySet<string> = new Set(NIGERIA_STATES.map(([code]) => code))

export function isStateCode(value: string): boolean {
  return STATE_CODES.has(value)
}

/** The state's name for a code, or the code itself when it is not one of the 37. */
export function stateName(code: string): string {
  return NIGERIA_STATES.find(([candidate]) => candidate === code)?.[1] ?? code
}

/**
 * A phone number as Identity takes it (COLLECTED_PHONE_E164): "+", a first digit of 1 to 9 and 7 to 14 more digits,
 * with spaces, dots, dashes and brackets ignored, and a Nigerian local number (0 and ten digits) read as +234. Null
 * when it is not one, so "+0803 123 4567" is refused here rather than by Identity.
 */
export function phoneE164(typed: string): string | null {
  const compact = typed.replace(/[\s().-]/g, '')
  const number = /^0\d{10}$/.test(compact) ? `+234${compact.slice(1)}` : compact
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : null
}

/**
 * An e-mail address as Identity takes it (class-validator IsEmail, which needs a top-level domain): a local part of
 * dot-separated words with no empty word (so no leading, trailing or doubled dot), 64 characters at most; a domain of
 * at least two labels, none starting or ending with a dash, the last one letters (or an xn-- name); 254 at most in all.
 */
const EMAIL_LOCAL_WORD = /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+$/
const EMAIL_LABEL = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
const EMAIL_TOP_LEVEL = /^(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9-]{2,})$/

export function emailAcceptable(value: string): boolean {
  const email = value.trim()
  if (email.length > 254) return false
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  const local = email.slice(0, at)
  const labels = email.slice(at + 1).split('.')
  return local.length <= 64 && local.split('.').every(word => EMAIL_LOCAL_WORD.test(word))
    && labels.length >= 2 && labels.every(label => EMAIL_LABEL.test(label)) && EMAIL_TOP_LEVEL.test(labels[labels.length - 1] ?? '')
}

export const REQUIRED = 'This field is required.'
export const PHONE_REFUSED = 'Enter a phone number, for example 0803 123 4567 or +234 803 123 4567.'
export const EMAIL_REFUSED = 'Enter a valid email address.'

/** A trimmed text between `min` and `max` characters: the message for it, or null when it is fine. */
export function textProblem(value: string, min: number, max: number): string | null {
  const text = value.trim()
  if (!text) return REQUIRED
  if (text.length < min) return `Enter at least ${min === 2 ? 'two' : min === 5 ? 'five' : min} characters.`
  if (text.length > max) return `Use ${max} characters or fewer.`
  return null
}
