import { useState } from 'react'
import { HEALTH_DATA } from './healthData'
import { PATIENT_TERMS } from './patientTerms'
import { EMAIL_UPDATES } from './records'
import { missingConsents, type ConsentItem } from './ConsentChecks'

/**
 * The three boxes of a patient's sign-up, on both routes (the sign-up without a NIN, Signup.tsx, and the NIN route's
 * last step, PasswordStep.tsx): the terms of use and keeping and sharing health records, both required, and email
 * updates, which never stops anything.
 */
export const PATIENT_CONSENT_ITEMS: readonly ConsentItem[] = [
  { id: PATIENT_TERMS.id, label: 'I agree to the Terms of use', required: true, document: PATIENT_TERMS, readLabel: 'Read the full agreement' },
  { id: HEALTH_DATA.id, label: 'I agree to Health ID keeping my health records and sharing them only as I choose', required: true },
  { id: EMAIL_UPDATES, label: 'Send me occasional updates by email', required: false },
]

/** A page's boxes: what is ticked, the errors shown, and the request that moves focus to the first missing one. */
export function usePatientConsent() {
  const [checked, setChecked] = useState<Readonly<Record<string, boolean>>>({})
  const [errors, setErrors] = useState<readonly string[]>([])
  const [focusRequest, setFocusRequest] = useState(0)
  return {
    checked, errors, focusRequest,
    onChange: (id: string, value: boolean) => {
      setChecked(current => ({ ...current, [id]: value }))
      if (value) setErrors(current => current.filter(other => other !== id))
    },
    /** The required boxes not ticked, each marked; `focus` moves focus to the first. Empty when all are ticked. */
    check: (focus: boolean): string[] => {
      const missing = missingConsents(PATIENT_CONSENT_ITEMS, checked)
      setErrors(missing)
      if (focus && missing.length) setFocusRequest(value => value + 1)
      return missing
    },
  }
}
