import type { ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'

/*
 * Small pieces of the Laboratory page in the target's look: a field whose control keeps the id today's focus and field
 * refusals use, the "Available actions" card that holds a form opened from it, and an action button in that card.
 */

/**
 * A labelled field, as the target draws one. Unlike EhrField it takes the control's id, so a refusal made by
 * useFieldProblems (which names the control and renders its error as `${id}-error`) and focus after a step both find it.
 */
export function LabField({ label, htmlFor, hint, error, required = false, children }: {
  readonly label: string
  readonly htmlFor: string
  readonly hint?: ReactNode
  readonly error?: ReactNode
  readonly required?: boolean
  readonly children: ReactNode
}) {
  return (
    <div className="hid-ehr-field">
      <label className="hid-ehr-label" htmlFor={htmlFor}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint !== undefined && !error ? <p id={`${htmlFor}-hint`} className="hid-ehr-hint">{hint}</p> : null}
      {error ? <p id={`${htmlFor}-error`} className="hid-ehr-error">{error}</p> : null}
    </div>
  )
}

/** useFieldProblems' control props (`invalid`, `aria-describedby`) for an EhrInput, EhrSelect or EhrTextarea. */
export function fieldControl(props: { readonly invalid?: boolean; readonly 'aria-describedby'?: string }) {
  return props.invalid ? { 'aria-invalid': true as const, 'aria-describedby': props['aria-describedby'] } : {}
}

/** Said in an actions card that offers nothing. */
export const NO_ACTIONS = 'No further actions for your permission and this record state.'

/**
 * The target's "Available actions" card: its actions stacked full width, the form of the one opened under them, or a line
 * saying there is nothing to do. `title` may carry a visually hidden part, so each card on the page has its own name.
 */
export function LabActions({ title, none, children }: {
  readonly title?: ReactNode
  readonly none: boolean
  readonly children?: ReactNode
}) {
  return (
    <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-actions-card">
      <h2 className="hid-ehr-card-title">{title ?? 'Available actions'}</h2>
      {none ? <p className="hid-ehr-dept-muted">{NO_ACTIONS}</p> : <div className="hid-ehr-dept-action-stack">{children}</div>}
    </section>
  )
}

/** One action of the card: a full-width secondary button that opens its form under the card's actions. */
export function LabActionButton({ id, open, onToggle, children }: {
  readonly id?: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}) {
  return <EhrButton id={id} variant="secondary" aria-expanded={open} onClick={onToggle}>{children}</EhrButton>
}

/** A status in the target's words: lower case, without underscores. */
export function statusWord(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}
