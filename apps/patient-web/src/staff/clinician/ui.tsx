import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AuthLayout } from '../../AuthLayout'
import { buttonClass } from '../../kasuwa/ui'
import { staffSignInAddress } from '../../staffSignIn'
import './clinician.css'

/**
 * The frame and small pieces the clinician pages share. They sit outside the
 * provider workspace, in the sign-in layout (AuthLayout): its title is a plain
 * line, since each page carries its own h1, and a heading per step takes focus
 * when the step opens.
 */

export function ClinicianFrame({ labelledBy, children }: { labelledBy?: string; children: ReactNode }) {
  // Staff sign in on the EHR site from the production portal (staffSignIn.tsx), and on this site elsewhere.
  const signIn = staffSignInAddress()
  return <AuthLayout brandTo={signIn} brandLabel="Health ID provider sign in" headerLink={{ to: signIn, label: 'Sign in' }}
    title="For doctors and nurses" titleId="clinician-frame-title" titleAs="p" panelLabelledBy={labelledBy}>
    <div className="clinician-card flex flex-col gap-4">{children}</div>
  </AuthLayout>
}

/**
 * A step's heading. It takes focus as the step opens (`focus`), since the step
 * before it, and the control used there, are gone; the first step of a page
 * just opened leaves focus where it is. `level` 1 is a page's own heading.
 */
export function StepHeading({ id, focus, level = 2, children }: { id: string; focus: boolean; level?: 1 | 2; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  // On mount only: each step's heading is a new element.
  const focusOnMount = useRef(focus)
  // In the commit that shows the step, not an effect a task later: a check made as soon as it is shown finds the focus moved.
  useLayoutEffect(() => { if (focusOnMount.current) heading.current?.focus() }, [])
  const Heading = level === 1 ? 'h1' : 'h2'
  return <Heading id={id} ref={heading} tabIndex={-1} className={level === 1 ? 'm-0 text-title-1 text-ink clinician-heading' : 'm-0 text-title-2 text-ink clinician-heading'}>
    {children}</Heading>
}

export function PrimaryButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={buttonClass({ variant: 'primary', block: true, className })} {...props} />
}

export function SecondaryButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={buttonClass({ variant: 'secondary', className })} {...props} />
}

export function TextButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={buttonClass({ variant: 'link', className: `self-start ${className ?? ''}` })} {...props} />
}

/** A refusal said as it appears. A new `id` for each refusal makes the same words new again. */
export function StepError({ error }: { error: { id: number; message: string } | null }) {
  return error ? <p key={error.id} role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{error.message}</p> : null
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
  useLayoutEffect(() => { if (problems.length > 0) summary.current?.focus() }, [focusKey, problems.length])
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
