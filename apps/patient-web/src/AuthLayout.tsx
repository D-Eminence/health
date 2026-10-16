import type { ReactNode, Ref } from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo } from './BrandLogo'
import './authLayout.css'

export interface AuthStep {
  readonly label: string
  readonly current: boolean
}

interface AuthLayoutProps {
  /** Where the logo leads. */
  readonly brandTo: string
  readonly brandLabel?: string
  /** The one link in the top bar: the other way in (sign in, or sign up). */
  readonly headerLink?: { readonly to: string; readonly label: string }
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

/**
 * The shared shell for signing in, signing up and recovery: a quiet two-column
 * page with the title and step progress on the left and one form on the right,
 * no card around it. Blue is kept for the primary action and the selected
 * choice. Stacks to one column on narrow screens.
 */
export function AuthLayout({
  brandTo, brandLabel = 'Health ID', headerLink, title, titleId, titleAs = 'h1', titleRef, titleFocusable,
  lede, steps, stepsLabel, panelLabelledBy, children,
}: AuthLayoutProps) {
  const Title = titleAs
  return (
    <main className="auth-page">
      <header className="auth-bar">
        <Link to={brandTo} className="auth-brand" aria-label={brandLabel}><BrandLogo /></Link>
        {headerLink && <Link to={headerLink.to} className="auth-bar-link">{headerLink.label}</Link>}
      </header>

      <div className="auth-body">
        <div className="auth-intro">
          <Title id={titleId} ref={titleRef} tabIndex={titleFocusable ? -1 : undefined} className="auth-title">{title}</Title>
          {lede && <p className="auth-lede">{lede}</p>}
          {steps && steps.length > 0 && (
            <ol className="auth-steps" aria-label={stepsLabel}>
              {steps.map(step => <li key={step.label} aria-current={step.current ? 'step' : undefined}>{step.label}</li>)}
            </ol>
          )}
        </div>

        <section className="auth-panel" aria-labelledby={panelLabelledBy ?? titleId}>
          {children}
        </section>
      </div>
    </main>
  )
}
