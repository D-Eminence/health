import type { FormEvent } from 'react'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { NIN_STILL_CHECKING } from '../../../ninCheck'
import type { Availability } from './registrationModel'
import { ErrorBox, type FormProblems } from './registrationParts'
import { CAPABILITY_LOADING, CHECK_AGAIN, CHECKING } from './registrationText'
import {
  VERIFY_NIN, VERIFY_NIN_LABEL, VERIFY_NIN_OFF, VERIFY_NIN_SENDING, VERIFY_NIN_TEXT, VERIFY_NIN_UNKNOWN, type VerifyNinOffer,
} from './verifyNinLater'

/*
 * "Verify NIN later" (hid-system 0138, ID-6) in a record's Available actions: the inline form, in the design's action form
 * style, and the line said in its place while NIN checks are off or not known. The page sends the request (its key, its
 * hold, its refusals: verifyNinLater.ts), so the Patients page can offer the same form later.
 */

/** The NIN form, under its toggle. The field is cleared as the NIN is sent, so the number is never shown again. */
export function VerifyNinForm({ id, controlId, busy, held, stillChecking, problems, error, onSubmit }: {
  readonly id: string
  readonly controlId: string
  readonly busy: boolean
  /** Identity named a time to try again: the button is off until then, and nothing is sent by itself. */
  readonly held: boolean
  /** The check has been waiting a few seconds: the form says it is still checking. */
  readonly stillChecking: boolean
  readonly problems: FormProblems
  /** What the last request's refusal said. */
  readonly error: string
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form id={id} className="hid-ehr-dept-action-form" noValidate aria-label={VERIFY_NIN} onSubmit={onSubmit}>
      <p className="hid-ehr-dept-muted">{VERIFY_NIN_TEXT}</p>
      <EhrField label={VERIFY_NIN_LABEL} controlId={controlId} error={problems.error(controlId)}>
        {/* A password field, as the NIN check's own: the number is not shown on screen while it is typed. */}
        <EhrInput name="nin" type="password" inputMode="numeric" autoComplete="off" maxLength={20} readOnly={busy} required />
      </EhrField>
      <ErrorBox message={error} />
      {/* Kept mounted, so the line is a change of a live region, not a new one. */}
      <div role="status">{stillChecking ? <p className="hid-ehr-dept-muted">{NIN_STILL_CHECKING}</p> : null}</div>
      <EhrButton type="submit" busy={busy} disabled={held}>{busy ? VERIFY_NIN_SENDING : VERIFY_NIN}</EhrButton>
    </form>
  )
}

/**
 * In place of the Verify NIN button, while it cannot be offered yet: NIN checks are being read, could not be read (with
 * Check again), or are off (registration-capabilities nin.available is not true). Nothing for any other state.
 */
export function VerifyNinNotOffered({ offer, availability }: { readonly offer: VerifyNinOffer; readonly availability: Availability }) {
  if (offer === 'loading') return <p className="hid-ehr-dept-muted">{CAPABILITY_LOADING}</p>
  if (offer === 'off') return <p className="hid-ehr-dept-muted">{VERIFY_NIN_OFF}</p>
  if (offer !== 'unknown') return null
  return (
    <div className="hid-ehr-dept-registration-availability-row">
      <p className="hid-ehr-dept-muted">{VERIFY_NIN_UNKNOWN}</p>
      {/* Unavailable while it reads, not disabled: a disabled button would lose the focus it has. */}
      <EhrButton variant="secondary" size="sm" busy={availability.loading} onClick={availability.refresh}>
        {availability.loading ? CHECKING : CHECK_AGAIN}
      </EhrButton>
    </div>
  )
}
