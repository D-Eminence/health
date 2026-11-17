import { STAFF_RECOVERY_PATH, staffRecoveryHref } from '../../../productHostname'
import { OpenStaffPage } from '../../../staffSignIn'
import { WorkEmailRecovery, type WorkEmailRecoveryLayoutProps } from '../../../routes/WorkEmailRecovery'
import { authHrefs, BlueAuthLayout, siteName } from './BlueAuthLayout'

/** The staff sites' auth look around the reset, without the row of other ways in: "Back to sign in" is the way back. */
function BlueResetLayout({ title, titleId, steps, stepsLabel, children }: WorkEmailRecoveryLayoutProps) {
  return <BlueAuthLayout title={title} titleId={titleId} steps={steps} stepsLabel={stepsLabel} links={false}>{children}</BlueAuthLayout>
}

/**
 * The staff password reset on each product site (ehr., lab., pharmacy., migrate., outreach.), looking and working as
 * app.'s does (owner's answer to Q89, 17 Nov 2026; routes/WorkEmailRecovery.tsx): the work email with Turnstile
 * (staff-reset, which hid-system accepts on each product site), a neutral answer whether or not the account exists, six
 * code boxes, then one new password of at least 12 characters. On a site that serves no staff pages (the production
 * patient portal, an admin site) it opens the EHR site's at once. App.tsx opens it at /provider/recover (BLUE_FOR_ALL).
 */
export function BlueRecovery() {
  const elsewhere = staffRecoveryHref(window.location.hostname)
  if (elsewhere !== STAFF_RECOVERY_PATH) return <OpenStaffPage href={elsewhere} />
  return <WorkEmailRecovery audience="staff" documentTitle={`Reset your password · ${siteName()}`} signInHref={authHrefs().signIn}
    Layout={BlueResetLayout} />
}
