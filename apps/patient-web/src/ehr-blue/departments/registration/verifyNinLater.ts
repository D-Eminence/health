import { isHidApiError } from '@hid/http'
import type { RegistrationCapabilities } from '../../../staff/api'
import { ninCheckProblem, NIN_NOT_VERIFIED_TEXT, NIN_TAKING_LONGER } from '../../../ninCheck'
import { NIN_NUMBER_FIELD, NIN_REFUSED, safeError } from './registrationText'

/*
 * "Verify NIN later" (hid-system 0138, docs/INTERFACE_CONTRACT.md ID-6; identity-api patient-nin-link.service.ts): the
 * desk checks the NIN on a patient's slip with QoreID and adds it to this facility's own patient who was registered
 * without one (ID-2). One synchronous request: the patient is NIN Verified after it, or nothing changed. Its rules and
 * every word it says are here, so the Patients page can offer it the same way later.
 *
 * Screens use plain words (the owner's rule): never a code, never the patient's id, and never the NIN once it is sent.
 */

export const VERIFY_NIN = 'Verify NIN'
export const VERIFY_NIN_TEXT = 'Check the NIN on the patient’s NIN slip and add it to this record. Type it as it is on the slip. It isn’t kept here.'
export const VERIFY_NIN_LABEL = 'NIN (11 digits)'
export const VERIFY_NIN_SENDING = 'Checking…'
/** registration-capabilities answers nin.available false: no button, and this line in its place. */
export const VERIFY_NIN_OFF = 'NIN checks are not available right now, so the NIN can be added later.'
/** The capabilities read failed: no button until it answers. */
export const VERIFY_NIN_UNKNOWN = 'We couldn’t check whether NIN checks are working, so the NIN can’t be added yet.'

/** 200, by outcome (patient-nin-link.service.ts MESSAGES), in this page's words. */
export const NIN_LINKED = 'NIN Verified. It is now on this patient’s record.'
export const NIN_ALREADY_LINKED = 'NIN Verified. It is already on this patient’s record.'

/** Each refusal Identity can answer, in plain words (patient-nin-link.service.ts, nin-check-once.ts). */
export const LINK_DENIED = 'You can’t add a NIN for this patient here.'
export const LINK_NOT_OWN_PATIENT = 'You can add a NIN only for this facility’s own patients. The patient can add their NIN on their own Health ID profile.'
export const LINK_PATIENT_NOT_FOUND = 'We can’t find this patient’s record. Refresh and try again.'
export const LINK_ALREADY_HAS_NIN = 'This patient already has a verified NIN.'
export const LINK_SOURCE_NIN_DIFFERS = 'This patient’s earlier records hold a different NIN. Ask Health ID support to review it.'
export const LINK_NOT_IDENTIFIED = 'Identify this patient before adding a NIN.'
export const LINK_TRY_LATER = 'A NIN cannot be added until the earlier records’ NIN check is complete. Please try again later.'
export const LINK_ON_ANOTHER_RECORD = 'This NIN is already on another patient record. Ask an approver to review the two records.'
export const LINK_RESEND = 'That didn’t go through. Try again.'
export const LINK_RATE_LIMITED = 'Too many NIN checks right now. Try again in a minute.'
export const LINK_PROVIDER_DOWN = 'NIN checks are not available right now. Try again in a minute.'
export const LINK_FAILED = 'We couldn’t check that NIN. Try again.'

/**
 * What a patient's record offers: the form ('offer'), the line that NIN checks are off ('off'), that their state is
 * not known yet ('loading') or could not be read ('unknown'), or nothing ('none').
 */
export type VerifyNinOffer = 'offer' | 'off' | 'loading' | 'unknown' | 'none'

export interface VerifyNinFacts {
  /** The patient's ID-0 NIN status; undefined when the answer did not say. */
  readonly ninStatus: 'verified' | 'not_verified' | undefined
  /** ID-7: an unknown patient is identified before a NIN is added. */
  readonly recordKind?: string | null
  /** The session holds identity.registration.write at this facility. */
  readonly canRegister: boolean
  /** The patient is this facility's own (registered here). The website cannot tell it for a PIN or approval opening. */
  readonly ownFacility: boolean
  /** Opened under emergency access: never offered. */
  readonly emergency?: boolean
  readonly capabilities: RegistrationCapabilities | null
  /** Whether a capabilities read has answered (a value or a refusal). */
  readonly capabilitiesAnswered: boolean
}

/** INTERFACE_CONTRACT.md ID-6 screen notes: who is offered "Verify NIN", and when. */
export function verifyNinOffer(facts: VerifyNinFacts): VerifyNinOffer {
  if (facts.ninStatus !== 'not_verified' || facts.recordKind === 'unknown' || !facts.canRegister || !facts.ownFacility
    || facts.emergency) return 'none'
  if (facts.capabilities) return facts.capabilities.nin.available === true ? 'offer' : 'off'
  // Before the first answer, a line that they are being checked; after a refusal, that they could not be (Check again).
  return facts.capabilitiesAnswered ? 'unknown' : 'loading'
}

/** The NIN as Identity reads it: spaces and hyphens removed, then exactly 11 digits; null when it is not one. */
export function ninForLink(value: string): string | null {
  const nin = value.replace(/[\s-]/g, '')
  return /^\d{11}$/.test(nin) ? nin : null
}

export interface VerifyNinRefusal {
  /** What the screen says. */
  readonly text: string
  /** The words marked at the NIN field, if any. */
  readonly field: string | null
  /** Until when the button stays off (ms since the epoch): the time Identity named. Never retried automatically. */
  readonly holdUntil: number | null
  /** The next request gets a new Idempotency-Key. */
  readonly newKey: boolean
  /** NIN checks may be off now: the capabilities are read again. */
  readonly recheck: boolean
  /** Identity says the patient holds a verified NIN already: the record shows it so. */
  readonly verified: boolean
}

function refusal(text: string, more: Partial<Omit<VerifyNinRefusal, 'text'>> = {}): VerifyNinRefusal {
  return { text, field: null, holdUntil: null, newKey: false, recheck: false, verified: false, ...more }
}

/** Identity's answer to a NIN that was not added, in plain words. */
export function verifyNinRefusal(caught: unknown, now = Date.now()): VerifyNinRefusal {
  if (!isHidApiError(caught)) return refusal(safeError(caught, LINK_FAILED))
  const seconds = caught.retryInSeconds
  const named = seconds !== null && seconds > 0 ? now + seconds * 1_000 : null
  switch (caught.code) {
    case 'VALIDATION_FAILED': return refusal(NIN_REFUSED, { field: NIN_REFUSED })
    case 'IDEMPOTENCY_KEY_REQUIRED':
    case 'PURPOSE_OF_USE_REQUIRED':
    case 'IDEMPOTENCY_KEY_REUSED': return refusal(LINK_RESEND, { newKey: true })
    case 'PERMISSION_DENIED': return refusal(LINK_DENIED)
    case 'NIN_LINK_NOT_PERMITTED': return refusal(LINK_NOT_OWN_PATIENT)
    case 'PATIENT_NOT_FOUND': return refusal(LINK_PATIENT_NOT_FOUND)
    // Two answers under one code: the second names the patient's earlier (migrated) records. Its words are read only to
    // choose between them, and are never shown.
    case 'PATIENT_ALREADY_HAS_NIN':
      return /earlier records/i.test(caught.detail ?? '') ? refusal(LINK_SOURCE_NIN_DIFFERS) : refusal(LINK_ALREADY_HAS_NIN, { verified: true })
    case 'PATIENT_NOT_IDENTIFIED':
    case 'UNKNOWN_PATIENT_NOT_IDENTIFIED': return refusal(LINK_NOT_IDENTIFIED)
    case 'NIN_LINK_TRY_LATER': return refusal(LINK_TRY_LATER)
    case 'NIN_ON_ANOTHER_RECORD': return refusal(LINK_ON_ANOTHER_RECORD)
    // Q117: the same sentence as every NIN check, and the number is marked.
    case 'NIN_VERIFICATION_FAILED':
    case 'NIN_NOT_VERIFIED': return refusal(NIN_NOT_VERIFIED_TEXT, { field: NIN_NUMBER_FIELD })
    default: break
  }
  const problem = ninCheckProblem(caught, now)
  // 409 NIN_CHECK_IN_PROGRESS or NIN_CHECK_HELD: the button is off until the time Identity named, then offered again.
  if (problem?.outcome === 'in_progress') return refusal(problem.text, { holdUntil: named })
  if (problem?.outcome === 'held') return refusal(problem.text, { holdUntil: problem.heldUntil })
  // This client's own wait ended (the gateway turns Identity's 504 into a 503): the same key picks the check up.
  if (problem?.outcome === 'taking_longer') return refusal(NIN_TAKING_LONGER, { holdUntil: named })
  if (caught.status === 429) return refusal(LINK_RATE_LIMITED, { holdUntil: named })
  // The gateway answers every 502, 503 and 504 as its own 503 UPSTREAM_UNAVAILABLE: NIN checks off, QoreID down or slow.
  if (caught.status === 503 || caught.status === 502) return refusal(LINK_PROVIDER_DOWN, { recheck: true })
  return refusal(safeError(caught, LINK_FAILED))
}
