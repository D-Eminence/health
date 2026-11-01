import { Link } from 'react-router-dom'
import { fallbackMessageForStatus, isHidApiError } from '@hid/http'
import { Alert } from '../../kasuwa/ui'

/**
 * Google on the sign-up page (POST auth/oidc/exchange with intent `enroll`) for a Google email that already belongs to
 * a patient account: 409 GOOGLE_ACCOUNT_EXISTS (hid-system, owner decision 2026-10-28), instead of a new sign-up. The
 * patient signs in with Google, which links that account when its email is verified. An Identity before it answers
 * 409 GOOGLE_EXISTING_ACCOUNT_LINK_REQUIRED, for which the website's own words are shown.
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
    // Identity's words send the patient to link Google, which the website no longer has: its own text instead.
    return { text: 'You already have a Health ID. Sign in with your email or Health ID and password.', link: 'Sign in' }
  }
  return null
}

/** The refusal, with the way to sign in, as one alert. */
export function ExistingAccountAlert({ account }: { account: ExistingAccount }) {
  return <Alert intent="error">{account.text} <Link to="/sign-in">{account.link}</Link></Alert>
}
