import { AuthLayout } from '../AuthLayout'
import type { RecoveryAudience } from '../recoveryApi'
import { STAFF_RECOVERY_PATH, staffRecoveryHref, staffSignInHref } from '../productHostname'
import { OpenStaffPage } from '../staffSignIn'
import { WorkEmailRecovery, type WorkEmailRecoveryLayoutProps } from './WorkEmailRecovery'

/** Where a staff account signs in from this site: its own sign-in, or the EHR site's where staff pages are not served. */
const staffSignIn = () => staffSignInHref(window.location.hostname) ?? '/provider/sign-in'

/** The shared auth look around each reset, its logo leading to that reset's sign-in. Module-level, so it never remounts. */
function StaffLayout({ title, titleId, steps, stepsLabel, children }: WorkEmailRecoveryLayoutProps) {
  return <AuthLayout brandTo={staffSignIn()} title={title} titleId={titleId} steps={steps} stepsLabel={stepsLabel}>{children}</AuthLayout>
}
function AdminLayout({ title, titleId, steps, stepsLabel, children }: WorkEmailRecoveryLayoutProps) {
  return <AuthLayout brandTo="/admin/sign-in" title={title} titleId={titleId} steps={steps} stepsLabel={stepsLabel}>{children}</AuthLayout>
}

/**
 * The platform administrators' password reset at /admin/recover (and today's staff reset where the clinic switch is
 * off), looking and working as app.'s does (owner's answer to Q89, 17 Nov 2026; WorkEmailRecovery.tsx), with the
 * shared AuthLayout. Recovery uses only component memory for the challenge and completion token.
 */
export function PrincipalRecovery({ audience }: { audience: RecoveryAudience }) {
  // On the production portal or an admin site, staff sign in on the EHR site (staffSignInHref).
  const signInHref = audience === 'staff' ? staffSignIn() : '/admin/sign-in'
  // Each product site has its own staff reset, which hid-system accepts there (staff-reset). Opened on a site that
  // serves no staff pages (the production portal, an admin site), the page opens the EHR site's at once.
  const elsewhere = audience === 'staff' ? staffRecoveryHref(window.location.hostname) : STAFF_RECOVERY_PATH
  if (elsewhere !== STAFF_RECOVERY_PATH) return <OpenStaffPage href={elsewhere} />
  return <WorkEmailRecovery audience={audience} signInHref={signInHref}
    documentTitle={`Reset your password · Health ID ${audience === 'staff' ? 'Provider' : 'Platform'}`} Layout={audience === 'staff' ? StaffLayout : AdminLayout} />
}
