import type { ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'

/*
 * Small pieces of the Laboratory page in the target's look: the "Available actions" card that holds a form opened from
 * it, and an action button in that card. The page's fields are EhrFields given the control's id (controlId), so a refusal
 * made by useFieldProblems and focus after a step both find the control; the field ties its error to it.
 */

/** Said in an actions card that offers nothing. */
export const NO_ACTIONS = 'Nothing more to do here.'

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
      <h2 className="hid-ehr-card-title">{title ?? 'Actions'}</h2>
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
