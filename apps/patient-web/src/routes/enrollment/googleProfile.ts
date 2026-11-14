/** The name and email a Google credential names, for filling in the sign-up's details (as hid-1.0's prefillSignupWithGoogle). */
export interface GoogleProfile {
  firstName: string
  lastName: string
  email: string
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

/**
 * Reads the payload of a Google ID token in the browser: `given_name`,
 * `family_name`, `name` and `email`. Nothing is verified and nothing is sent:
 * the values only fill in fields the patient checks and can change, and
 * Identity checks the email itself with a code. Null when the token is not a
 * JWT with a JSON payload.
 */
export function googleProfileOf(idToken: string): GoogleProfile | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!claims || typeof claims !== 'object') return null
    const record = claims as Record<string, unknown>
    // A name without its parts: the first word is the first name, the rest the last name.
    const [first = '', ...rest] = text(record.name).split(/\s+/).filter(Boolean)
    return {
      firstName: text(record.given_name) || first,
      lastName: text(record.family_name) || rest.join(' '),
      email: text(record.email),
    }
  } catch {
    return null
  }
}
