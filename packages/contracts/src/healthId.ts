/**
 * A Health ID as people type it (owner decision, 2026-10-27): "HID-" and 6 characters, as hid-1.0 issued them, from
 * an alphabet without 0, 1, I or O; older Health IDs of up to 32 characters stay valid. Identity checks it
 * case-sensitively, in capitals only, so a field puts what was typed in capitals before it is sent. Every field a
 * Health ID is typed into starts with the prefix filled in (hid-1.0 src/lib/hidInput.ts).
 */
export const HEALTH_ID_PREFIX = 'HID-'

/** A complete Health ID, as Identity stores and checks it (identity 0002, patient sign-in). */
export const HEALTH_ID_PATTERN = /^HID-[A-HJ-NP-Z2-9]{6,32}$/

/**
 * What a field that takes only a Health ID holds after a change (hid-1.0 normalizeHidInput): capitals, no spaces, and
 * the prefix once. A pasted "HID-HID-ABC234" or "hid-abc234" becomes "HID-ABC234"; a field emptied, or cut back into
 * the prefix, holds "HID-" again.
 */
export function normalizeHealthIdInput(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, '')
  // The alphabet has no I or hyphen, so "HID" never begins what follows the prefix and a hyphen is only ever the
  // prefix's: every leading HID and every hyphen goes.
  return `${HEALTH_ID_PREFIX}${(aroundPrefix(compact) ?? compact).replace(/^(?:HID|-)+/, '').replace(/-/g, '')}`
}

/**
 * What was typed around the prefilled prefix, wherever the caret was (a tap on "HID-" on a phone puts it inside or
 * before the prefix): "HID-abc", "HIDabc-", "HIabcD-" and "abcHID-" all give "abc". Null when the prefix is gone.
 */
function aroundPrefix(value: string): string | null {
  for (let cut = HEALTH_ID_PREFIX.length; cut >= 0; cut -= 1) {
    const head = HEALTH_ID_PREFIX.slice(0, cut), tail = HEALTH_ID_PREFIX.slice(cut)
    const at = value.startsWith(head) ? value.indexOf(tail, head.length) : -1
    if (at >= 0) return value.slice(head.length, at) + value.slice(at + tail.length)
  }
  return null
}

/** Whether a value is a complete Health ID once normalized. */
export function isCompleteHealthId(value: string): boolean {
  return HEALTH_ID_PATTERN.test(normalizeHealthIdInput(value))
}

/** Whether nothing but the prefix was typed: a field holding only "HID-", or emptied, is as empty as before it was filled in. */
export function isBlankHealthIdInput(value: string): boolean {
  return normalizeHealthIdInput(value) === HEALTH_ID_PREFIX
}

/**
 * What a field that takes a Health ID or something else (an email, an order reference) holds after a change. It starts
 * at "HID-" too, but the prefix may be deleted to type the other, and an email typed after it ("HID-ada@") drops it.
 * Nothing is put in capitals while typing, so an email keeps its case; a Health ID pasted after the prefix keeps one.
 */
export function healthIdOrOtherInput(value: string): string {
  const typed = aroundPrefix(value)
  if (typed === null) return value
  if (typed.includes('@')) return typed
  return `${HEALTH_ID_PREFIX}${typed.replace(/^(?:HID-)+/i, '')}`
}

/** What a field that takes an email or a Health ID sends: an email as typed, anything else as a normalized Health ID. */
export function emailOrHealthId(value: string): string {
  const typed = value.trim()
  return typed.includes('@') ? typed : normalizeHealthIdInput(typed)
}

/**
 * Whether what was typed starts as a phone number does: "+" (E.164, any country) or "0" (a Nigerian number written
 * locally). A Health ID's alphabet has no 0, and no "+", so neither can begin one; a number written with spaces,
 * dashes or brackets ("(0803) 123-4567") counts too.
 */
function startsAsPhone(value: string): boolean {
  return /^[+0]/.test(value.replace(/[\s()-]/g, ''))
}

/**
 * What a sign-in or password reset field holds after a change (hid-1.0 parity B2, owner decision 2026-10-28): it takes
 * an email, a phone number or a Health ID, and starts at "HID-" as every Health ID field does. The prefix drops as an
 * email is typed after it ("HID-ada@"), and as a phone number is: when what follows it starts with "+" or "0".
 */
export function signInPrincipalInput(value: string): string {
  const typed = aroundPrefix(value)
  if (typed !== null && startsAsPhone(typed)) return typed
  return healthIdOrOtherInput(value)
}

/**
 * What a sign-in or password reset field sends (POST auth/patient/login `email`, POST auth/otp/start `identifier`): an
 * email as typed; a phone number as typed without its spaces, dashes and brackets, which Identity normalizes ("0803…"
 * as +234803…); anything else as a normalized Health ID.
 */
export function signInPrincipal(value: string): string {
  const typed = value.trim()
  if (typed.includes('@')) return typed
  if (startsAsPhone(typed)) return typed.replace(/[\s()-]/g, '')
  return normalizeHealthIdInput(typed)
}
