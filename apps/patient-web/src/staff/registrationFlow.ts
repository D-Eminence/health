import { useRef } from 'react'
import { isHidApiError } from '@hid/http'
import type { RegistrationCase, ResolveNinInput } from './api'

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

/** Identity's own words for a refusal, or `fallback`. */
export function registrationErrorText(error: unknown, fallback: string) {
  return isHidApiError(error) ? error.message : fallback
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
