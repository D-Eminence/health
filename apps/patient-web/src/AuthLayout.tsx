import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import { ThemeToggle } from './kasuwa/interactive'
import { CardFace } from './routes/HealthIdCard'
import '@fontsource-variable/inter'
import './authLayout.css'

export interface AuthStep {
  readonly label: string
  readonly current: boolean
}

/** Who the page is for: it picks the panel beside the form on wide screens (patients and providers; admins get none). */
export type AuthAudience = 'patient' | 'provider' | 'admin'

interface AuthLayoutProps {
  /** Where the logo leads. */
  readonly brandTo: string
  readonly brandLabel?: string
  readonly audience?: AuthAudience
  /**
   * The one link in the top bar: the other way in (sign in, or sign up). `to`
   * stays in this site; `href` leaves it (another host of the portal) and is a
   * plain link.
   */
  readonly headerLink?: { readonly to: string; readonly label: string } | { readonly href: string; readonly label: string }
  /** The page's title; null when each step in the panel carries the page's h1 itself (platform sign-in), with `titleId` as its id. */
  readonly title: ReactNode
  readonly titleId: string
  /**
   * The page's heading, except while a step in the panel carries its own h1
   * (the staff authenticator steps): the title is then plain text.
   */
  readonly titleAs?: 'h1' | 'p'
  readonly titleRef?: Ref<HTMLHeadingElement & HTMLParagraphElement>
  readonly titleFocusable?: boolean
  readonly lede?: ReactNode
  readonly steps?: readonly AuthStep[]
  readonly stepsLabel?: string
  /** False when each step's own heading names it: the stepper then says only "Step 2 of 4" (said once). */
  readonly stepsNamed?: boolean
  /** The panel's own label, when the title is not the panel's heading (or there is none: then a step's own h1). */
  readonly panelLabelledBy?: string
  readonly children: ReactNode
}

/**
 * The one shell for signing in, signing up and recovery, in every portal (the app's final design): the page's own
 * white (black in dark mode), the brand top-left and the theme toggle top-right, and one centred column of at most
 * 26rem with the title on the form's edge, in the app's title style. A multi-step flow shows one compact stepper
 * ("Step 2 of 4 · Email" over a thin bar) above the title. From 1024px a quiet panel for the page's audience sits
 * beside the form: the patient's Health ID card, or what the provider portal is for; admin pages have none.
 */
export function AuthLayout({
  brandTo, brandLabel = 'Health ID', audience = 'patient', headerLink, title, titleId, titleAs = 'h1', titleRef, titleFocusable,
  lede, steps, stepsLabel, stepsNamed = true, panelLabelledBy, children,
}: AuthLayoutProps) {
  const Title = titleAs
  const aside = audience === 'admin' ? null : audience === 'provider' ? <ProviderPanel /> : <PatientPanel />
  return (
    <main className="auth-page" data-audience={audience}>
      <header className="auth-bar">
        <Link to={brandTo} className="auth-brand" aria-label={brandLabel}><BrandLogo /></Link>
        <span className="auth-bar-spacer" />
        {headerLink && ('href' in headerLink
          ? <a href={headerLink.href} className="auth-bar-link">{headerLink.label}</a>
          : <Link to={headerLink.to} className="auth-bar-link">{headerLink.label}</Link>)}
        <ThemeToggle className="size-11" />
      </header>
      <div className={aside ? 'auth-columns auth-columns-panel' : 'auth-columns'}>
        <div className="auth-center">
          <div className="auth-column">
            {(title !== null || lede || steps?.some(step => step.current)) && <div className="auth-intro">
              {steps && steps.length > 0 && <AuthStepper steps={steps} label={stepsLabel} named={stepsNamed} />}
              {title !== null && <Title id={titleId} ref={titleRef} tabIndex={titleFocusable ? -1 : undefined} className="auth-title">{title}</Title>}
              {lede && <p className="auth-lede">{lede}</p>}
            </div>}
            <section className="auth-panel" aria-labelledby={panelLabelledBy ?? (title === null ? undefined : titleId)}>
              {children}
            </section>
          </div>
        </div>
        {aside && <aside className="auth-aside" aria-hidden="true">{aside}</aside>}
      </div>
    </main>
  )
}

/**
 * Where a multi-step flow is, in one line that fits a phone: "Step 2 of 4 · Email", over a thin bar. The line is the
 * named group's text, so it is read once; the bar only draws it.
 */
export function AuthStepper({ steps, label, named = true }: {
  readonly steps: readonly AuthStep[]
  readonly label?: string
  /** False when the step's own heading says its name: then only "Step 2 of 4". */
  readonly named?: boolean
}) {
  const index = steps.findIndex(step => step.current)
  const current = steps[index]
  // Past the last step (the ending), there is no step to show.
  if (!current) return null
  return (
    <div className="auth-stepper" role="group" aria-label={label}>
      <p className="auth-stepper-text">{named ? `Step ${index + 1} of ${steps.length} · ${current.label}` : `Step ${index + 1} of ${steps.length}`}</p>
      <div className="auth-stepper-bar" aria-hidden="true"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
    </div>
  )
}

/** The patient's panel: the Health ID card itself, still and blank, and one line on what it does. */
function PatientPanel() {
  return (
    <div className="auth-aside-body">
      <CardFace still name="Your name" hid="HID-•••• ••••" verified={null} facts={[]} allergies={[]}
        face={<UserRound className="size-[9cqw] text-white/70" strokeWidth={1.4} />} />
      <p className="auth-aside-line">One Health ID for your records at every hospital. You choose who sees them.</p>
    </div>
  )
}

const PROVIDER_POINTS = [
  { icon: UsersRound, text: 'Find patients by their Health ID' },
  { icon: ClipboardList, text: 'See records patients share with you' },
  { icon: ShieldCheck, text: 'Every view is recorded' },
] as const

/** The provider portal's panel: what it is for, in three short lines. */
function ProviderPanel() {
  return (
    <div className="auth-aside-body">
      <p className="auth-aside-title">Health ID for facilities</p>
      <ul className="auth-aside-points">
        {PROVIDER_POINTS.map(({ icon: Icon, text }) => <li key={text}><span className="auth-aside-icon"><Icon className="size-[18px]" /></span>{text}</li>)}
      </ul>
    </div>
  )
}
