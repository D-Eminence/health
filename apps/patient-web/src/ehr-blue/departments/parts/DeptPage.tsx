import type { ReactNode } from 'react'
import { EhrButton, EhrPageHeading } from '@hid/ui/ehr'
import '../departments.css'

export interface DeptPageProps {
  /** A short label above the title, such as "Hospital memberships". */
  readonly eyebrow?: string
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly primaryAction?: ReactNode
  readonly secondaryActions?: ReactNode
  /** A detail or form view's way back to its list: "Back to list" beside the title. */
  readonly onBack?: () => void
  readonly backLabel?: string
  readonly children?: ReactNode
  readonly className?: string
}

/**
 * One department page in the blue EHR: the page's one h1 with an optional eyebrow
 * and line on what it is for, its actions (or "Back to list" on a detail view), and
 * its sections. The frame supplies the shell; this is the content of its main.
 */
export function DeptPage({ eyebrow, title, description, primaryAction, secondaryActions, onBack, backLabel = 'Back to list',
  children, className }: DeptPageProps) {
  const back = onBack ? <EhrButton variant="secondary" onClick={onBack}>{backLabel}</EhrButton> : undefined
  return (
    <div className={['hid-ehr-dept', className].filter(Boolean).join(' ')}>
      {eyebrow ? <p className="hid-ehr-dept-eyebrow">{eyebrow}</p> : null}
      <EhrPageHeading
        className={eyebrow ? 'hid-ehr-dept-heading-after-eyebrow' : undefined}
        title={title}
        description={description}
        primaryAction={primaryAction ?? back}
        secondaryActions={primaryAction !== undefined && back ? <>{secondaryActions}{back}</> : secondaryActions}
      />
      {children}
    </div>
  )
}

/**
 * A page this membership cannot use here: its heading and today's message, word for
 * word. Identity would refuse the reads anyway; this only says so first.
 */
export function DeptUnavailable({ title, message }: { readonly title: string; readonly message: ReactNode }) {
  return (
    <DeptPage title={title}>
      <div className="hid-ehr-empty-state hid-ehr-dept-unavailable">
        <p className="hid-ehr-state-message">{message}</p>
      </div>
    </DeptPage>
  )
}

/** A titled section of a page: the target's card, with an h2. */
export function DeptSection({ title, actions, children, className, id, headingId }: {
  readonly title?: ReactNode
  readonly actions?: ReactNode
  readonly children?: ReactNode
  readonly className?: string
  readonly id?: string
  /** An id for the h2, for focus or aria-labelledby. */
  readonly headingId?: string
}) {
  return (
    <section id={id} className={['hid-ehr-card', 'hid-ehr-dept-section', className].filter(Boolean).join(' ')} aria-labelledby={title !== undefined ? headingId : undefined}>
      {title !== undefined || actions !== undefined ? (
        <div className="hid-ehr-card-header">
          {title !== undefined ? <h2 id={headingId} className="hid-ehr-card-title" tabIndex={headingId ? -1 : undefined}>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}
