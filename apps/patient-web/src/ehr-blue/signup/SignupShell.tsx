import type { ReactNode } from 'react'
import { AuthLayout } from '../../AuthLayout'
import { STAFF_SIGN_IN_PATH } from '../../productHostname'
import { ClinicianSignUpEntry } from '../../staff/clinician/ClinicianSignUpEntry'

/**
 * The registration's shell: the shared sign-in layout (AuthLayout, the same as every other signed-out page) with the
 * provider panel and "Sign in" in its top bar, and no title of its own: each screen carries its h1. Its `.hid-ehr` root
 * carries the blue kit's tokens for the controls inside: the sign-up runs before any session, outside the blue frame.
 * `centered` marks the short screens after the registration (the code, the password); the column is the same.
 */
export function SignupShell({ children, centered = false, onMainSite = true }: {
  readonly children: ReactNode
  readonly centered?: boolean
  /** False on a staff product host, which offers only Sign in, as today's page there does. */
  readonly onMainSite?: boolean
}) {
  return (
    <AuthLayout brandTo={STAFF_SIGN_IN_PATH} brandLabel="Health ID provider sign in" audience="provider"
      headerLink={{ to: STAFF_SIGN_IN_PATH, label: 'Sign in' }} title={null} titleId="hid-ehr-signup-title">
      <div id="main-content" className={centered ? 'hid-ehr hid-ehr-signup hid-ehr-signup-centered' : 'hid-ehr hid-ehr-signup'}>
        {children}
        {onMainSite ? <ClinicianSignUpEntry className="hid-ehr-signup-footer-line" /> : null}
      </div>
    </AuthLayout>
  )
}
