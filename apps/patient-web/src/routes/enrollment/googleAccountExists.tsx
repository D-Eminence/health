import { Link } from 'react-router-dom'
import { fallbackMessageForStatus, isHidApiError } from '@hid/http'

/**
 * Google on the sign-up page (POST auth/oidc/exchange with intent `enroll`) for a Google email that already belongs to
 * a patient account: 409 GOOGLE_ACCOUNT_EXISTS (hid-system, owner decision 2026-10-28), instead of a new sign-up. The
 * patient signs in with Google, which links that account when its email is verified. An Identity before it answers
 * 409 GOOGLE_EXISTING_ACCOUNT_LINK_REQUIRED, whose own words are shown.
 */
export const GOOGLE_ACCOUNT_EXISTS = 'You already have a Health ID. Sign in with Google instead.'

export interface ExistingAccount { readonly text: string; readonly link: string }

const own = (reason: { message: string; status: number }, standIn: string) =>
  reason.message && reason.message !== fallbackMessageForStatus(reason.status) ? reason.message : standIn

/** What to say for a Google sign-up refused because the account exists, or null for any other answer. */
export function existingAccount(reason: unknown): ExistingAccount | null {
  if (!isHidApiError(reason) || reason.status !== 409) return null
  if (reason.code === 'GOOGLE_ACCOUNT_EXISTS') return { text: own(reason, GOOGLE_ACCOUNT_EXISTS), link: 'Sign in with Google' }
  if (reason.code === 'GOOGLE_EXISTING_ACCOUNT_LINK_REQUIRED') {
    return { text: own(reason, 'Sign in to your existing Health ID account to link Google.'), link: 'Sign in' }
  }
  return null
}

/** The refusal, with the way to sign in, as one alert. */
export function ExistingAccountAlert({ account }: { account: ExistingAccount }) {
  return <div role="alert" className="auth-alert">
    <p className="patient-inline-error">{account.text}</p>
    <p className="patient-field-hint"><Link to="/sign-in">{account.link}</Link></p>
  </div>
}
