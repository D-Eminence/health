import type { ReactNode } from 'react'
import { EhrBackButton, EhrPageHeading } from '@hid/ui/ehr'
import '../departments.css'

export interface DeptPageProps {
  /** A short label above the title, such as "Hospital memberships". */
  readonly eyebrow?: string
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly primaryAction?: ReactNode
  readonly secondaryActions?: ReactNode
  /** A detail or form view's way back to its list: an arrow just before the title, named by `backLabel`. */
  readonly onBack?: () => void
  readonly backLabel?: string
  /**
   * While something is being sent the way back holds (a press does nothing), and says so: it stays focusable,
   * marked aria-disabled, so the outcome is still said where it was asked for.
   */
  readonly backUnavailable?: boolean
  readonly children?: ReactNode
  readonly className?: string
}

/**
 * One department page in the blue EHR: the page's one h1 with an optional eyebrow
 * and line on what it is for, its actions (or "Back to list" on a detail view), and
 * its sections. The frame supplies the shell; this is the content of its main.
 */
export function DeptPage({ eyebrow, title, description, primaryAction, secondaryActions, onBack, backLabel = 'Back to list',
  backUnavailable, children, className }: DeptPageProps) {
  const back = !onBack ? undefined : backUnavailable === undefined ? <EhrBackButton label={backLabel} onClick={onBack} />
    : <DeptBackButton label={backLabel} unavailable={backUnavailable} onClick={onBack} />
  return (
    <div className={['hid-ehr-dept', className].filter(Boolean).join(' ')}>
      {eyebrow ? <p className="hid-ehr-dept-eyebrow">{eyebrow}</p> : null}
      <EhrPageHeading
        className={eyebrow ? 'hid-ehr-dept-heading-after-eyebrow' : undefined}
        title={title}
        description={description}
        back={back}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />
      {children}
    </div>
  )
}

/** EhrBackButton, also saying when it holds (aria-disabled) while something is sent. */
function DeptBackButton({ label, unavailable, onClick }: { readonly label: string; readonly unavailable: boolean; readonly onClick: () => void }) {
  return (
    <button type="button" className="hid-ehr-back-button" aria-label={label} title={label} aria-disabled={unavailable || undefined} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
      </svg>
    </button>
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
