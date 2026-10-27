import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import type { PatientNinVerification, PatientProfile } from '../api'
import { useSession } from '../session'
import { describedBy, sentFromField, useStepFocus } from '../authSteps'
import { useActionFocus } from './actionFocus'

/**
 * Why Identity refused POST /identity/me/verification/nin (hid-system
 * qoreid-verification.service.ts verifyPatientNin), said plainly. Each is about
 * the account or the service, not the number typed, except where marked.
 */
export const NIN_REFUSALS: Readonly<Record<string, string>> = {
  QOREID_PATIENT_NIN_BINDING_DISABLED: 'Verifying a NIN from your account is not available yet. Try again later.',
  PATIENT_NIN_BINDING_CONFLICT: 'This NIN needs an identity review before it can be verified on your account. Contact Health ID support.',
  PATIENT_NIN_DETAILS_MISMATCH: 'This NIN does not match the name and date of birth given. Check them and try again.',
  PATIENT_IDENTITY_PROFILE_INCOMPLETE: 'Your profile is missing details needed to check a NIN, such as your date of birth. Contact Health ID support.',
  PATIENT_NIN_BINDING_UNAVAILABLE: 'NIN verification is temporarily unavailable. Try again later.',
  VERIFICATION_EVIDENCE_UNAVAILABLE: 'NIN verification is temporarily unavailable. Try again later.',
  QOREID_DISABLED: 'NIN verification is not available right now. Try again later.',
  QOREID_PROVIDER_RESPONSE_INVALID: 'We could not confirm your NIN with the national identity service. Try again later.',
}
/** A check that ran and did not verify (200 with another state). */
export const NIN_STATES: Readonly<Record<Exclude<PatientNinVerification['state'], 'verified'>, string>> = {
  not_verified: 'We could not match this NIN to the name and date of birth on your profile. Check the number and try again.',
  incomplete: 'The national identity service could not finish checking this NIN. Try again later.',
  provider_error: 'NIN verification is temporarily unavailable. Try again later.',
  disabled: 'NIN verification is not available right now. Try again later.',
}
const NIN_RULE = 'Enter the 11 digits of your NIN.'
const NIN_FAILED = 'We could not verify your NIN just now. Try again later.'

/**
 * Whether the account's NIN is verified: Identity's `ninVerified` when it sends
 * it; from an Identity before it, an account whose assurance is NIN_VERIFIED
 * (every NIN-first registration) is not asked for its NIN again.
 */
export function ninVerifiedOf(profile: Pick<PatientProfile, 'ninVerified' | 'assuranceState'>): boolean {
  return typeof profile.ninVerified === 'boolean' ? profile.ninVerified : profile.assuranceState === 'NIN_VERIFIED'
}

/**
 * "Verify your NIN" on the profile: optional, never blocking. A patient who
 * signed up without a NIN adds it here; once verified, the card says so.
 */
export function NinVerificationCard({ profile, onVerified }: {
  profile: Pick<PatientProfile, 'ninVerified' | 'assuranceState'>
  /** Reads the profile again once Identity has verified the NIN. */
  onVerified: () => Promise<unknown> | void
}) {
  const { api } = useSession()
  const [nin, setNin] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [busy, setBusy] = useState(false)
  const [verifiedHere, setVerifiedHere] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  const [errorAlert, setErrorAlert] = useState(true)
  const fieldFocus = useStepFocus()
  const focusAfter = useActionFocus()
  const heading = useRef<HTMLHeadingElement>(null)
  const verified = verifiedHere || ninVerifiedOf(profile)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy || !/^\d{11}$/.test(nin) || !dateOfBirth) return
    setBusy(true); setError(null); setFieldError(false); setErrorAlert(true)
    try {
      const result = await api.verifyNin(nin, dateOfBirth)
      if (result?.state === 'verified') {
        setNin(''); setDateOfBirth(''); setVerifiedHere(true)
        focusAfter(() => heading.current)
        void onVerified()
        return
      }
      const aboutNumber = result?.state === 'not_verified'
      setError(NIN_STATES[result?.state as keyof typeof NIN_STATES] ?? NIN_FAILED)
      setFieldError(aboutNumber); setErrorAlert(!aboutNumber || fromField)
    } catch (reason) {
      const aboutNumber = isHidApiError(reason) && reason.status === 400
      const code = isHidApiError(reason) ? reason.code : ''
      setError(aboutNumber ? NIN_RULE : Object.hasOwn(NIN_REFUSALS, code) ? NIN_REFUSALS[code] : isHidApiError(reason) && reason.status < 500 ? reason.message : NIN_FAILED)
      setFieldError(aboutNumber); setErrorAlert(!aboutNumber || fromField)
    } finally { setBusy(false); fieldFocus.focus() }
  }

  if (verified) {
    return <div className="patient-card"><h2 ref={heading} tabIndex={-1}>NIN verification</h2>
      <p role="status"><strong>NIN verified</strong></p>
    </div>
  }
  return <div className="patient-card"><h2 ref={heading} tabIndex={-1}>Verify your NIN</h2>
    <p id="nin-verify-hint" className="patient-field-hint">Optional. Add your 11-digit National Identification Number to verify your identity on your Health ID. Your Health ID works without it.</p>
    {error && <p id="nin-verify-error" role={errorAlert ? 'alert' : undefined} className="patient-inline-error">{error}</p>}
    <form onSubmit={event => void submit(event)} className="patient-form patient-inline-form">
      <label>National Identification Number<input ref={fieldFocus.target} required inputMode="numeric" autoComplete="off" pattern="[0-9]{11}" maxLength={11}
        value={nin} onChange={event => { setNin(event.target.value.replace(/\D/g, '').slice(0, 11)); setFieldError(false) }}
        aria-invalid={fieldError || undefined} aria-describedby={describedBy('nin-verify-hint', fieldError && 'nin-verify-error')} /></label>
      <label>Date of birth, as on your NIN record<input type="date" required autoComplete="bday" value={dateOfBirth}
        max={new Date().toISOString().slice(0, 10)} onChange={event => setDateOfBirth(event.target.value)} /></label>
      <button type="submit" className="patient-primary-button" disabled={busy || nin.length !== 11 || !dateOfBirth}>{busy ? 'Verifying…' : 'Verify NIN'}</button>
    </form>
  </div>
}
