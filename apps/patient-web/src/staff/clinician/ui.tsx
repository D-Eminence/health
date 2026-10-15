import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '../../BrandLogo'
import { useDocumentTitle } from '../../authSteps'
import type { ClinicianPagePath } from '../../productHostname'
import './clinician.css'

/**
 * The frame and small pieces the clinician pages share. They sit outside the
 * provider workspace, drawn as provider enrollment is: one card, one h1, a
 * heading per step that takes focus when the step opens.
 */

export function ClinicianFrame({ labelledBy, children }: { labelledBy?: string; children: ReactNode }) {
  return <main className="patient-auth-page">
    <section className="patient-auth-card patient-enroll-card clinician-card" aria-labelledby={labelledBy}>
      <Link to="/provider/sign-in" className="patient-auth-brand"><BrandLogo /></Link>
      <p className="patient-eyebrow">Provider portal</p>
      {children}
    </section>
  </main>
}

/**
 * A step's heading. It takes focus as the step opens (`focus`), since the step
 * before it, and the control used there, are gone; the first step of a page
 * just opened leaves focus where it is.
 */
export function StepHeading({ id, focus, children }: { id: string; focus: boolean; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  // On mount only: each step's heading is a new element.
  const focusOnMount = useRef(focus)
  useEffect(() => { if (focusOnMount.current) heading.current?.focus() }, [])
  return <h2 id={id} ref={heading} tabIndex={-1} className="clinician-heading">{children}</h2>
}

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="patient-primary-button" {...props} />
}

export function TextButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="patient-text-button" {...props} />
}

/** A refusal said as it appears. A new `id` for each refusal makes the same words new again. */
export function StepError({ error }: { error: { id: number; message: string } | null }) {
  return error ? <p key={error.id} role="alert" className="patient-inline-error">{error.message}</p> : null
}

let refusals = 0
/** One refusal to show: each has its own id, so the same words are announced again. */
export function shownError(message: string): { id: number; message: string } {
  refusals += 1
  return { id: refusals, message }
}

export interface Problem { field: string; message: string }

/**
 * The fields a step refused before sending, each linked to its field. It takes
 * focus when shown (`focusKey` changes with each refusal), and is an alert.
 */
export function ErrorSummary({ problems, focusKey }: { problems: readonly Problem[]; focusKey: number }) {
  const summary = useRef<HTMLDivElement>(null)
  useEffect(() => { if (problems.length > 0) summary.current?.focus() }, [focusKey, problems.length])
  if (problems.length === 0) return null
  return <div ref={summary} tabIndex={-1} role="alert" aria-labelledby="clinician-error-summary-title" className="clinician-error-summary">
    <h3 id="clinician-error-summary-title">Check these details</h3>
    <ul>{problems.map(problem => <li key={problem.field}>
      <a href={`#${problem.field}`} onClick={event => { event.preventDefault(); document.getElementById(problem.field)?.focus() }}>
        {problem.message}</a></li>)}</ul>
  </div>
}

/** A refused field's message, by its control's id, for the control's aria-describedby. */
export function fieldError(problems: readonly Problem[], field: string): string | undefined {
  return problems.find(problem => problem.field === field)?.message
}

/**
 * A clinician page opened on a staff product host or the admin site: their
 * security checks are accepted only on the main site, so the page links there
 * instead of showing a form that would be refused.
 */
export function MainSiteOnly({ href, path }: { href: string; path: ClinicianPagePath }) {
  const signUp = path === '/provider/join'
  useDocumentTitle(signUp ? 'Clinician sign-up · Health ID Provider' : 'Clinician application · Health ID Provider')
  return <ClinicianFrame labelledBy="clinician-main-site-title">
    <h1 id="clinician-main-site-title" className="patient-page-title">
      {signUp ? 'Apply as a doctor or nurse' : 'Check your clinician application'}</h1>
    <p className="patient-page-copy">{signUp ? 'Clinician sign-up is on the main Health ID site.'
      : 'Clinician applications are checked on the main Health ID site.'}</p>
    <a className="patient-primary-button" href={href}>Continue on the Health ID site</a>
  </ClinicianFrame>
}
