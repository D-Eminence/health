/**
 * Code rules shared by the platform console and the provider portal, as Identity
 * applies them (hid-system platform-auth.dto.ts): an authenticator code, or an
 * emailed enrolment code, is exactly six digits, and a recovery code is 10 to 16
 * characters once trimmed. Nothing here keeps a code: it lives in the step's
 * state until the step is sent.
 */

/** Groups a base32 setup key for manual entry (`ABCD EFGH …`). */
export function formatSetupKey(secret: string) {
  return secret.replace(/(.{4})(?=.)/g, '$1 ')
}

/** What a six-digit code field keeps of what is typed or pasted: its digits, at most six. */
export function sixDigitCode(typed: string) {
  return typed.replace(/\D/g, '').slice(0, 6)
}

export function isSixDigitCode(code: string) {
  return /^[0-9]{6}$/.test(code)
}

export function isRecoveryCode(typed: string) {
  const code = typed.trim()
  return code.length >= 10 && code.length <= 16
}

/** A six-digit code field's attributes: a numeric keypad, and the one-time code the browser or phone offers. */
export const SIX_DIGIT_CODE_FIELD = { inputMode: 'numeric', autoComplete: 'one-time-code', pattern: '[0-9]{6}' } as const
