import { useRef } from 'react'
import { plainErrorText } from '@hid/http'
import type { RegistrationCase, ResolveNinInput } from './api'
import { NIN_DETAILS_CHECK, NIN_HELD_FEW_MINUTES, NIN_IN_PROGRESS, NIN_NOT_VERIFIED_TEXT, NIN_TAKING_LONGER } from '../ninCheck'

/*
 * The parts of facility registration (NIN check → case → approve or link → enroll) that more than one screen uses:
 * the Registration page and a walk-in's "New Health ID" at the pharmacy or the lab. Each screen keeps its own form.
 */

/** A case that has a Health ID: made new, linked to the one they had, or found already on Health ID. */
export const REGISTRATION_COMPLETED: ReadonlySet<RegistrationCase['status']> =
  new Set<RegistrationCase['status']>(['approved_new_identity', 'linked_existing', 'resolved_existing_identity'])

/** The gender values Identity takes on a NIN check, in the order they are offered. */
export const REGISTRATION_GENDERS: ReadonlyArray<{ value: NonNullable<ResolveNinInput['gender']>; label: string }> = [
  { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'intersex', label: 'Intersex' },
  { value: 'other', label: 'Other' }, { value: 'unknown', label: 'Unknown' },
]

/** Plain words for the refusals registration knows; never Identity's own text. */
const REGISTRATION_REFUSALS: Readonly<Record<string, string>> = {
  NIN_ALREADY_REGISTERED: 'This person already has a Health ID. Search for them instead.',
  NIN_MISMATCH: 'The details don’t match the NIN record. Check the name and date of birth, then try again.',
  // The NIN check's own answers (ninCheck.ts); a screen that can say when a held NIN may be checked says that instead.
  NIN_CHECK_IN_PROGRESS: NIN_IN_PROGRESS,
  NIN_CHECK_HELD: NIN_HELD_FEW_MINUTES,
  QOREID_TIMEOUT: NIN_TAKING_LONGER,
  NIN_DETAILS_INVALID: NIN_DETAILS_CHECK,
  NIN_NOT_VERIFIED: NIN_NOT_VERIFIED_TEXT,
}

/** A registration step's refusal in plain words (plainErrorText), or the step's own `fallback`. Never Identity's text. */
export function registrationErrorText(error: unknown, fallback: string) {
  return plainErrorText(error, fallback, { codes: REGISTRATION_REFUSALS, audience: 'facility' })
}

/** Idempotency keys stay in component memory only and are reused for an unchanged retry. */
export function useCommandKey() {
  const previous = useRef<{ signature: string; key: string } | null>(null)
  return {
    forInput(signature: string) {
      if (previous.current?.signature !== signature) previous.current = { signature, key: crypto.randomUUID() }
      return previous.current.key
    },
    clear() { previous.current = null },
  }
}
