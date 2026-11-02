import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { BrandLogo } from './BrandLogo'
import { ThemeToggle } from './kasuwa/interactive'
import './authLayout.css'

export interface AuthStep {
  readonly label: string
  readonly current: boolean
}

interface AuthLayoutProps {
  /** Where the logo leads: a page of this site, or an address on another Health ID site, which is a plain link. */
  readonly brandTo: string
  readonly brandLabel?: string
  /**
   * The one link in the top bar: the other way in (sign in, or sign up). `to`
   * stays in this site, unless it is a full address; `href` leaves it (another
   * host of the portal). An address on another site is a plain link.
   */
  readonly headerLink?: { readonly to: string; readonly label: string } | { readonly href: string; readonly label: string }
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
  /** The panel's own label, when the title is not the panel's heading. */
  readonly panelLabelledBy?: string
  readonly children: ReactNode
}

/** A link in the top bar: within this site, or a plain link to a full address on another (the EHR site's sign-in). */
function BarLink({ to, className, children, 'aria-label': label }: {
  readonly to: string; readonly className: string; readonly children: ReactNode; readonly 'aria-label'?: string
}) {
  return /^https?:\/\//.test(to)
    ? <a href={to} className={className} aria-label={label}>{children}</a>
    : <Link to={to} className={className} aria-label={label}>{children}</Link>
}

/**
 * The shared shell for signing in, signing up and recovery, rebuilt from paytrail's AuthLayout (its source of truth):
 * the landing's warm-paper world with a dot field, a display headline and, on wide screens, a Health ID card that
 * prints out of its slot listing what an account gives; the form sits on a paper card. Blue stays the one action.
 * The props, ids and headings are unchanged, so every sign-in, sign-up and recovery screen takes it as it is.
 */
export function AuthLayout({
  brandTo, brandLabel = 'Health ID', headerLink, title, titleId, titleAs = 'h1', titleRef, titleFocusable,
  lede, steps, stepsLabel, panelLabelledBy, children,
}: AuthLayoutProps) {
  const Title = titleAs
  const current = steps?.findIndex(step => step.current) ?? -1
  return (
    <main className="auth-page auth-skin">
      <div aria-hidden="true" className="auth-dots" />
      <div className="auth-columns">
        <aside className="auth-aside" aria-hidden="true">
          <span className="auth-brand"><BrandLogo /></span>
          <div className="auth-aside-body">
            <p className="auth-aside-overline">One record · Every hospital · Your consent</p>
            <p className="auth-aside-headline">Your health, one ID.</p>
            <PrintedCard />
          </div>
        </aside>
        <div className="auth-main">
          <header className="auth-bar">
            <BarLink to={brandTo} className="auth-brand auth-brand-mobile" aria-label={brandLabel}><BrandLogo /></BarLink>
            <span className="auth-bar-spacer" />
            {headerLink && ('href' in headerLink
              ? <a href={headerLink.href} className="auth-bar-link">{headerLink.label}</a>
              : <BarLink to={headerLink.to} className="auth-bar-link">{headerLink.label}</BarLink>)}
            <ThemeToggle className="auth-theme" />
          </header>
          <div className="auth-center">
            <div className="auth-card">
              <div className="auth-intro">
                {steps && steps.length > 0 && (
                  <ol className="auth-steps" aria-label={stepsLabel}>
                    {steps.map((step, index) => <li key={step.label} aria-current={step.current ? 'step' : undefined}
                      data-done={current > index ? 'true' : undefined}><span className="auth-step-dot" aria-hidden="true">{current > index ? '✓' : index + 1}</span>{step.label}</li>)}
                  </ol>
                )}
                <Title id={titleId} ref={titleRef} tabIndex={titleFocusable ? -1 : undefined} className="auth-title">{title}</Title>
                {lede && <p className="auth-lede">{lede}</p>}
              </div>
              <section className="auth-panel" aria-labelledby={panelLabelledBy ?? titleId}>
                {children}
              </section>
            </div>
            <p className="auth-trust"><Lock aria-hidden="true" size={14} />Your records are shared only with the facilities you approve.</p>
          </div>
        </div>
      </div>
    </main>
  )
}

const CARD_LINES = ['Your records from every hospital', 'You approve who sees them', 'Emergency contacts', 'Lab results and prescriptions', 'A log of every view']

/** paytrail's welcome receipt, as a Health ID card: it prints out of its slot once, listing what an account includes. */
function PrintedCard() {
  return (
    <div className="auth-printer">
      <div className="auth-printer-slot"><span>Health ID</span><span className="auth-printer-status"><span className="auth-printer-led" />Issuing</span></div>
      <div className="auth-printer-out">
        <div className="auth-print">
          <div className="auth-print-card">
            <div className="auth-print-head"><span className="auth-print-chip" /><span>HEALTH ID</span></div>
            <p className="auth-print-id">HID-•••• ••••</p>
            <ul>{CARD_LINES.map(line => <li key={line}><span>{line}</span><span className="auth-print-leader" /><span className="auth-print-tick">✓</span></li>)}</ul>
            <div className="auth-print-foot"><span>Works at</span><span>Every Health ID facility</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
