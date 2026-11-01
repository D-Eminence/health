import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout, type AuthStep } from '../../../AuthLayout'
import {
  providerEnrollmentHref, STAFF_SIGN_IN_PATH, staffInvitationHref, staffRecoveryHref, staffSignInHref,
} from '../../../productHostname'

/**
 * The Hospital EHR's sign-in, recovery and invitation pages: the shared AuthLayout (the same shell as every other
 * sign-in), with the provider panel, and "Back to sign in" under the pages that are not the sign-in. `hid-ehr-blue-auth`
 * marks the pages as the EHR's (shown once the clinic switch is on, README.md); it adds no styles of its own.
 */
export interface BlueAuthLayoutProps {
  readonly title: ReactNode
  readonly titleId: string
  readonly lede?: ReactNode
  /** 'p' while a step below has the page's h1 (the authenticator steps). */
  readonly titleAs?: 'h1' | 'p'
  readonly titleRef?: Ref<HTMLHeadingElement & HTMLParagraphElement>
  /** A multi-step flow's steps, for the shared stepper. */
  readonly steps?: readonly AuthStep[]
  readonly stepsLabel?: string
  /** "Back to sign in" under the form. */
  readonly links?: boolean
  readonly children: ReactNode
}

export function BlueAuthLayout({ title, titleId, lede, titleAs = 'h1', titleRef, steps, stepsLabel, links = true, children }: BlueAuthLayoutProps) {
  return (
    <div className="hid-ehr-blue-auth contents">
      <AuthLayout brandTo={STAFF_SIGN_IN_PATH} brandLabel="Health ID provider sign in" audience="provider" title={title} titleId={titleId}
        titleAs={titleAs} titleRef={titleRef} titleFocusable={titleAs === 'h1'} lede={lede} steps={steps} stepsLabel={stepsLabel}>
        {children}
        {links ? <BackToSignIn /> : null}
      </AuthLayout>
    </div>
  )
}

/** Our plain body copy and quiet hints inside the auth panel. */
export const NOTE = 'm-0 text-sm text-ink-2'
export const HINT = 'm-0 text-[13px] text-ink-3'
/** A text link with a 44px target. */
export const LINK = 'inline-flex min-h-11 items-center font-medium text-brand-ink'

/** A page of this portal, or of another Health ID site where this host's rules send the person (productHostname.ts). */
export function SiteLink({ href, className, children }: { readonly href: string; readonly className?: string; readonly children: ReactNode }) {
  return /^https?:\/\//.test(href)
    ? <a className={className} href={href}>{children}</a>
    : <Link className={className} to={href}>{children}</Link>
}

/** Where each way in is for this host: today's rules, as today's pages link them. */
export function authHrefs(hostname = window.location.hostname) {
  return {
    register: providerEnrollmentHref(hostname),
    signIn: staffSignInHref(hostname) ?? STAFF_SIGN_IN_PATH,
    recover: staffRecoveryHref(hostname),
    invitation: staffInvitationHref(hostname),
  }
}

/** The way back from recovery and invitations: one link, "Back to sign in". */
export function BackToSignIn() {
  return <p className="m-0"><SiteLink className={LINK} href={authHrefs().signIn}>Back to sign in</SiteLink></p>
}
