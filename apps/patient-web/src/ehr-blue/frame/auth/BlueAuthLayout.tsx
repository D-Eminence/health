import '@hid/ui/ehr.css'
import './auth.css'
import { useState, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { EhrInput, type EhrInputProps } from '@hid/ui/ehr'
import { BrandLogo } from '../../../BrandLogo'
import {
  providerEnrollmentHref, STAFF_SIGN_IN_PATH, staffInvitationHref, staffRecoveryHref, staffSignInHref,
} from '../../../productHostname'

/**
 * The design's sign-in pages (screens/2-sign-in, 3-forgot-password, 4-staff-invitation): the form on the left, under
 * the logo, and the Hospital EHR's story on the right. The design's photograph is left out until its licence is known;
 * the story panel is drawn in the brand's blues. Not wired in yet (README.md).
 */
export interface BlueAuthLayoutProps {
  readonly title: ReactNode
  /** The small capitals over the title ("HOSPITAL EHR"). */
  readonly eyebrow?: string
  readonly lede?: ReactNode
  /** 'p' while a step below has the page's h1 (the authenticator steps). */
  readonly titleAs?: 'h1' | 'p'
  readonly titleRef?: Ref<HTMLHeadingElement & HTMLParagraphElement>
  /** The design's row of ways in under the form. */
  readonly links?: boolean
  /** The first sign-in screen's own layout: a narrower column and larger fields (auth.css). */
  readonly signIn?: boolean
  readonly children: ReactNode
}

export function BlueAuthLayout({ title, eyebrow, lede, titleAs = 'h1', titleRef, links = true, signIn = false, children }: BlueAuthLayoutProps) {
  const Title = titleAs
  return (
    <div className={signIn ? 'hid-ehr hid-ehr-blue-auth hid-ehr-blue-auth-signin' : 'hid-ehr hid-ehr-blue-auth'}>
      <main id="main-content" className="hid-ehr-blue-auth-panel">
        <Link to={STAFF_SIGN_IN_PATH} className="hid-ehr-blue-auth-brand" aria-label="Health ID provider sign in">
          <BrandLogo className="hid-ehr-blue-auth-logo" />
        </Link>
        <div className="hid-ehr-blue-auth-content">
          {eyebrow ? <p className="hid-ehr-blue-auth-eyebrow">{eyebrow}</p> : null}
          <Title ref={titleRef} tabIndex={-1} className="hid-ehr-blue-auth-title">{title}</Title>
          {lede ? <p className="hid-ehr-blue-auth-lede">{lede}</p> : null}
          {children}
          {links ? <BlueAuthLinks /> : null}
        </div>
      </main>
      <aside className="hid-ehr-blue-auth-story" aria-label="Health ID Hospital EHR">
        <p className="hid-ehr-blue-auth-eyebrow">Health ID — Hospital EHR</p>
        <p className="hid-ehr-blue-auth-story-title">More connected care.<br />More time for people.</p>
        <p>Your hospital, patients and team in one connected workspace.</p>
      </aside>
    </div>
  )
}

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

/** The design's row of ways in: Register a hospital · Sign in · Recover access · Accept invitation. */
export function BlueAuthLinks() {
  const hrefs = authHrefs()
  return (
    <nav className="hid-ehr-blue-auth-links" aria-label="Other ways in">
      <SiteLink href={hrefs.register}>Register a hospital</SiteLink>
      <SiteLink href={hrefs.signIn}>Sign in</SiteLink>
      <SiteLink href={hrefs.recover}>Recover access</SiteLink>
      <SiteLink href={hrefs.invitation}>Accept invitation</SiteLink>
    </nav>
  )
}

/** A password field with the design's show button, inside an EhrField like any other control. */
export function BluePasswordInput({ toggleLabel = 'Show password', ...props }: Omit<EhrInputProps, 'type'> & { readonly toggleLabel?: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="hid-ehr-blue-password">
      <EhrInput {...props} type={shown ? 'text' : 'password'} />
      <button type="button" className="hid-ehr-blue-password-toggle" aria-label={toggleLabel} aria-pressed={shown}
        onClick={() => setShown(value => !value)}>{shown ? 'Hide' : 'Show'}</button>
    </div>
  )
}
