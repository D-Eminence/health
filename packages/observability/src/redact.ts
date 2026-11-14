/**
 * PHI redaction for anything that leaves the application as text: console
 * output, breadcrumbs, error reports, analytics.
 *
 * The rule this encodes is that identifying and clinical fields never appear
 * in telemetry. Redaction is deny-list driven on field names, plus a small set
 * of value patterns for identifiers that travel without a helpful key.
 *
 * A redactor is a last line of defence. The first is not putting PHI into a
 * log call in the first place.
 */

export const REDACTED = '[redacted]'

/**
 * Field names whose values are patient-identifying or clinical.
 * Matched case-insensitively against normalised keys (`hid_code`, `hidCode`
 * and `HID-CODE` all match `hidcode`).
 */
const SENSITIVE_FIELD_NAMES: readonly string[] = [
  // Identity
  'hidcode', 'hid', 'nin', 'ninlast4', 'ninhash', 'ninciphertext', 'nationalid',
  'firstname', 'lastname', 'fullname', 'name', 'displayname', 'patientname',
  'dob', 'dateofbirth', 'birthdate', 'gender', 'photourl', 'avatarurl',
  'phone', 'phonee164', 'phonenumber', 'email', 'emailaddress', 'address',
  // Clinical
  'allergies', 'chronicconditions', 'currentmedications', 'medications',
  'bloodgroup', 'genotype', 'diagnosis', 'diagnoses', 'medicalnotes', 'notes',
  'symptoms', 'treatment', 'prescription', 'labresult', 'labresults',
  'observation', 'observations', 'vitals', 'recordbody', 'recordcontent',
  'content', 'summary', 'history',
  // Contacts
  'emergencycontactname', 'emergencycontactphone', 'emergencycontactaddress',
  'emergencycontactrelationship', 'hmoorganization',
  // Credentials and session material
  'accesstoken', 'refreshtoken', 'idtoken', 'token', 'authorization', 'apikey',
  'password', 'pin', 'accesspin', 'otp', 'code', 'secret',
]

const SENSITIVE_FIELD_SET = new Set(SENSITIVE_FIELD_NAMES)

/** Identifier shapes that must be masked even under an innocuous key. */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\bHID-[A-Z0-9-]{3,}\b/gi,          // Health ID codes
  /\b\+?[0-9][0-9 ().-]{7,}[0-9]\b/g, // Phone numbers in any common formatting
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,    // Email addresses
  /\b\d{4}-\d{2}-\d{2}\b/g,           // Dates of birth (and any other bare date)
]

/** Query parameters stripped from any URL before it is logged. */
const SENSITIVE_QUERY_KEYS = new Set([
  'hid', 'hidcode', 'hid_code', 'token', 'access_token', 'refresh_token',
  'code', 'otp', 'pin', 'email', 'phone', 'name', 'dob', 'q', 'query', 'search',
])

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isSensitiveFieldName(key: string): boolean {
  return SENSITIVE_FIELD_SET.has(normalizeKey(key))
}

/** Masks identifier-shaped substrings inside free text. */
export function redactText(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, REDACTED),
    value,
  )
}

/**
 * Rewrites a URL so it is safe to log: path segments that look like
 * identifiers are masked and sensitive query parameters are dropped.
 */
export function redactUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value, 'https://placeholder.invalid')
  } catch {
    return redactText(value)
  }

  const segments = parsed.pathname.split('/').map(segment => {
    if (segment === '') return segment
    if (/^HID-/i.test(segment)) return REDACTED
    // UUIDs and long opaque ids are resource identifiers, not free identifiers,
    // but they still correlate to a person, so they do not belong in telemetry.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return REDACTED
    return redactText(segment)
  })

  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.set(key, REDACTED)
  }

  const path = segments.join('/')
  const search = parsed.searchParams.toString()
  const query = search === '' ? '' : `?${decodeURIComponent(search)}`

  return parsed.origin === 'https://placeholder.invalid'
    ? `${path}${query}`
    : `${parsed.origin}${path}${query}`
}

/**
 * Deep-redacts an arbitrary value for logging.
 * Objects keep their shape so a log line stays diagnostically useful; only the
 * sensitive leaves are replaced.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED
  if (value === null || value === undefined) return value

  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return REDACTED

  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) }
  }

  if (value instanceof Date) return value.toISOString().slice(0, 7) // year-month only

  if (Array.isArray(value)) return value.map(entry => redact(entry, depth + 1))

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveFieldName(key) ? REDACTED : redact(entry, depth + 1)
    }
    return output
  }

  return REDACTED
}
