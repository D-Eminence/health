import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '../../BrandLogo'
import { STAFF_INVITATION_PATH, STAFF_RECOVERY_PATH, STAFF_SIGN_IN_PATH, staffInvitationHref, staffRecoveryHref } from '../../productHostname'
import { ClinicianSignUpEntry } from '../../staff/clinician/ClinicianSignUpEntry'

/** A link to this site's own page, or to the main site's from a staff product host (the fixed addresses productHostname gives). */
function PageLink({ path, href, children }: { path: string; href: string; children: ReactNode }) {
  return href === path ? <Link to={path}>{children}</Link> : <a href={href}>{children}</a>
}

/**
 * The design's registration shell (screens 02-09): the form panel on the left, with the logo, the content and the row
 * of other ways in, and the brand panel on the right (hidden on narrow screens). `centered` draws the narrower,
 * vertically centred column of the screens after the registration (08 Registration submitted, 09 the code). Its own
 * `.hid-ehr` root carries the blue tokens and fonts: the sign-up runs before any session, outside the blue frame.
 */
export function SignupShell({ children, centered = false, onMainSite = true }: {
  readonly children: ReactNode
  readonly centered?: boolean
  /** False on a staff product host, which offers only Sign in, as today's page there does. */
  readonly onMainSite?: boolean
}) {
  const hostname = window.location.hostname
  return (
    <div className="hid-ehr hid-ehr-signup">
      <main id="main-content" className={centered ? 'hid-ehr-signup-panel hid-ehr-signup-panel-centered' : 'hid-ehr-signup-panel'}>
        <Link to={STAFF_SIGN_IN_PATH} className="hid-ehr-signup-brand" aria-label="Health ID provider sign in">
          <BrandLogo className="hid-ehr-signup-logo" />
        </Link>
        <div className={centered ? 'hid-ehr-signup-content hid-ehr-signup-centered' : 'hid-ehr-signup-content'}>
          {children}
          <p className="hid-ehr-signup-links">
            <Link to={STAFF_SIGN_IN_PATH}>Sign in</Link>
            {onMainSite ? <>
              <PageLink path={STAFF_RECOVERY_PATH} href={staffRecoveryHref(hostname)}>Recover access</PageLink>
              <PageLink path={STAFF_INVITATION_PATH} href={staffInvitationHref(hostname)}>Accept invitation</PageLink>
            </> : null}
          </p>
        </div>
        {onMainSite ? <div className="hid-ehr-signup-footer">
          {/* Today's footer (ProviderEnrollment.tsx:1176-1183, Novu), where the design has its footer line. */}
          <p>Provider enrollment sets up a facility and its administrator’s account. Once Health ID support has checked the
            facility, its administrator adds the doctors, nurses and other staff on the Staff page.</p>
          <ClinicianSignUpEntry className="hid-ehr-signup-footer-line" />
        </div> : null}
      </main>
      <div className="hid-ehr-signup-visual">
        <div className="hid-ehr-signup-story">
          <p className="hid-ehr-signup-story-eyebrow">Health ID — Hospital EHR</p>
          <p className="hid-ehr-signup-story-title">More connected care.<br />More time for people.</p>
          <p className="hid-ehr-signup-story-text">Your hospital, patients and team in one connected workspace.</p>
        </div>
      </div>
    </div>
  )
}
