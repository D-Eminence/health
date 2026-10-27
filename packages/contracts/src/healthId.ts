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
  // The alphabet has no I, so "HID" never begins what follows the prefix: every leading HID and hyphen is a prefix.
  return `${HEALTH_ID_PREFIX}${value.toUpperCase().replace(/\s+/g, '').replace(/^(?:HID|-)+/, '')}`
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
  if (value.startsWith(HEALTH_ID_PREFIX) && value.includes('@')) return value.slice(HEALTH_ID_PREFIX.length)
  return value.replace(/^(?:HID-)+(?=HID-)/, '')
}

/** What a field that takes an email or a Health ID sends: an email as typed, anything else as a normalized Health ID. */
export function emailOrHealthId(value: string): string {
  const typed = value.trim()
  return typed.includes('@') ? typed : normalizeHealthIdInput(typed)
}
