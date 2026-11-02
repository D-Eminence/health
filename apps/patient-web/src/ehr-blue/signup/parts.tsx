import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { facilitySignInHref, STAFF_SIGN_IN_PATH } from '../../productHostname'
import { supportAddress, type Support } from './enrollmentRules'
import type { EnrollmentError } from './useEnrollment'

/**
 * "Contact Health ID support …", with the address when the build has it. Ported verbatim from
 * staff/routes/ProviderEnrollment.tsx:265-277 (not exported there); only the link's class is the blue one.
 */
export function SupportContact({ purpose }: { purpose: Support | 'register' | 'finish' | 'inline' | 'persist' }) {
  const address = supportAddress()
  const lead = purpose === 'register' ? 'To register your facility, contact Health ID support'
    : purpose === 'inline' ? 'contact Health ID support'
      : purpose === 'persist' ? 'If this keeps happening, contact Health ID support'
        : purpose === 'held' ? 'If it belongs to another company, tell Health ID support'
          : purpose === 'help' ? 'If you need help, contact Health ID support'
            : purpose === 'cac-otherwise' ? 'Otherwise, contact Health ID support' : 'Contact Health ID support'
  const tail = purpose === 'cac' || purpose === 'cac-otherwise' ? ', and give your CAC registration number.' : purpose === 'finish'
    ? ' to finish setting up your facility.' : purpose === 'held' ? ', and give that number, so they can free it.' : '.'
  return <>{lead}{address ? <> at <a className="hid-ehr-signup-link" href={`mailto:${address}`}>{address}</a></> : null}{tail}</>
}

/**
 * Where this administrator signs in next time: the facility's own site's staff sign-in (facilitySignInHref), which on
 * a product site is this site's own. Ported from staff/routes/ProviderEnrollment.tsx SignInLink, drawn as the design's
 * primary button.
 */
export function SignInLink({ organizationType, children }: { organizationType?: string | null; children: ReactNode }) {
  const href = facilitySignInHref(organizationType, window.location.hostname)
  return href === STAFF_SIGN_IN_PATH ? <Link className="hid-ehr-button hid-ehr-signup-wide" to={href}>{children}</Link>
    : <a className="hid-ehr-button hid-ehr-signup-wide" href={href}>{children}</a>
}

/**
 * A screen's h1 that takes focus in the commit that shows it, as today's FocusedHeading (ProviderEnrollment.tsx:286-291)
 * does for a panel that replaces the step before it.
 */
export function ScreenHeading({ id, children }: { id: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  return <h1 id={id} ref={heading} tabIndex={-1} className="hid-ehr-page-title hid-ehr-signup-title">{children}</h1>
}

/** A required field's label: the design's " *", which the control's own `required` says to assistive technology. */
export function Required({ children }: { children: ReactNode }) {
  return <>{children}<span className="hid-ehr-signup-required" aria-hidden="true"> *</span></>
}

/** An error's words, ending with support's address when it has one (today's alert, ProviderEnrollment.tsx:990-991). */
export function ErrorWords({ error }: { readonly error: EnrollmentError }) {
  return <>{error.text}{error.support ? <> <SupportContact purpose={error.support} /></> : null}</>
}
