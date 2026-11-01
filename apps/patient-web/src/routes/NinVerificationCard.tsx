import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import type { PatientNinVerification, PatientProfile } from '../api'
import { useSession } from '../session'
import { describedBy, sentFromField, useStepFocus } from '../authSteps'
import { useActionFocus } from './actionFocus'
import { ProfileSection } from './ProfileSection'
import { Button, Field, Input } from '../kasuwa/ui'
import { Hint, InputR, Problem } from './profileParts'

/**
 * Why Identity refused POST /identity/me/verification/nin (hid-system
 * qoreid-verification.service.ts verifyPatientNin), said plainly. Each is about
 * the account or the service, not the number typed, except where marked.
 */
export const NIN_REFUSALS: Readonly<Record<string, string>> = {
  QOREID_PATIENT_NIN_BINDING_DISABLED: 'You can’t verify your NIN here right now. Try again later.',
  PATIENT_NIN_BINDING_CONFLICT: 'This NIN needs a review before it can be added to your account. Contact Health ID support.',
  PATIENT_NIN_DETAILS_MISMATCH: 'This NIN doesn’t match your name and date of birth. Check them and try again.',
  PATIENT_IDENTITY_PROFILE_INCOMPLETE: 'Your profile is missing details we need, like your date of birth. Contact Health ID support.',
  PATIENT_NIN_BINDING_UNAVAILABLE: 'We can’t check NINs right now. Try again later.',
  VERIFICATION_EVIDENCE_UNAVAILABLE: 'We can’t check NINs right now. Try again later.',
  QOREID_DISABLED: 'We can’t check NINs right now. Try again later.',
  QOREID_PROVIDER_RESPONSE_INVALID: 'We couldn’t check your NIN with the national ID service. Try again later.',
}
/** A check that ran and did not verify (200 with another state). */
export const NIN_STATES: Readonly<Record<Exclude<PatientNinVerification['state'], 'verified'>, string>> = {
  not_verified: 'This NIN doesn’t match the name and date of birth on your profile. Check the number and try again.',
  incomplete: 'We couldn’t finish checking this NIN. Try again later.',
  provider_error: 'We can’t check NINs right now. Try again later.',
  disabled: 'We can’t check NINs right now. Try again later.',
}
const NIN_RULE = 'Enter the 11 digits of your NIN.'
const NIN_FAILED = 'We couldn’t check your NIN. Try again later.'

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
 * signed up without a NIN adds it here; once verified, the card says so. The
 * date of birth starts from the profile's, so most people only type the number.
 */
export function NinVerificationCard({ profile, onVerified }: {
  profile: Pick<PatientProfile, 'ninVerified' | 'assuranceState'> & Partial<Pick<PatientProfile, 'dateOfBirth'>>
  /** Reads the profile again once Identity has verified the NIN. */
  onVerified: () => Promise<unknown> | void
}) {
  const { api } = useSession()
  const [nin, setNin] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState(() => (profile.dateOfBirth ?? '').slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [verifiedHere, setVerifiedHere] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  const [errorAlert, setErrorAlert] = useState(true)
  const fieldFocus = useStepFocus()
  const focusAfter = useActionFocus()
  const heading = useRef<HTMLHeadingElement>(null)
  const verified = verifiedHere || ninVerifiedOf(profile)
  // Dormant until Identity says whether the NIN is verified: the Identity before
  // it does not offer the check to a signed-in patient (it answers 503).
  if (typeof profile.ninVerified !== 'boolean') return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const fromField = sentFromField(event)
    if (busy || !/^\d{11}$/.test(nin) || !dateOfBirth) return
    setBusy(true); setError(null); setFieldError(false); setErrorAlert(true)
    try {
      const result = await api.verifyNin(nin, dateOfBirth)
      if (result?.state === 'verified') {
        setNin(''); setVerifiedHere(true)
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
      setError(aboutNumber ? NIN_RULE : Object.hasOwn(NIN_REFUSALS, code) ? NIN_REFUSALS[code] ?? NIN_FAILED : isHidApiError(reason) && reason.status < 500 ? reason.message : NIN_FAILED)
      setFieldError(aboutNumber); setErrorAlert(!aboutNumber || fromField)
    } finally { setBusy(false); fieldFocus.focus() }
  }

  // One section either way (#nin-verification), so it stays open, with focus on its heading, as the NIN is verified.
  if (verified) {
    return <ProfileSection id="nin-verification" title="NIN" state="Verified" headingRef={heading}>
      <p role="status" className="m-0 text-sm font-medium text-success-ink">Your NIN is verified.</p>
    </ProfileSection>
  }
  return <ProfileSection id="nin-verification" title="Verify your NIN" state="Optional" headingRef={heading}>
    <Hint id="nin-verify-hint">Your Health ID works without it.</Hint>
    <form onSubmit={event => void submit(event)} className="flex flex-col gap-4">
      <Field label="NIN (11 digits)" htmlFor="nin-verify-number" errorId="nin-verify-error"
        error={error && fieldError ? <span role={errorAlert ? 'alert' : undefined}>{error}</span> : undefined}>
        <InputR id="nin-verify-number" ref={fieldFocus.target} required inputMode="numeric" autoComplete="off" pattern="[0-9]{11}" maxLength={11}
          value={nin} onChange={event => { setNin(event.target.value.replace(/\D/g, '').slice(0, 11)); setFieldError(false) }}
          aria-invalid={fieldError || undefined} aria-describedby={describedBy('nin-verify-hint', fieldError && 'nin-verify-error')} />
      </Field>
      <Field label="Date of birth, as on your NIN" htmlFor="nin-verify-dob">
        <Input id="nin-verify-dob" type="date" required autoComplete="bday" value={dateOfBirth}
          max={new Date().toISOString().slice(0, 10)} onChange={event => setDateOfBirth(event.target.value)} />
      </Field>
      {error && !fieldError && <Problem id="nin-verify-error" alert={errorAlert}>{error}</Problem>}
      <Button type="submit" variant="primary" className="self-start" loading={busy} disabled={busy || nin.length !== 11 || !dateOfBirth}>{busy ? 'Verifying…' : 'Verify NIN'}</Button>
    </form>
  </ProfileSection>
}
