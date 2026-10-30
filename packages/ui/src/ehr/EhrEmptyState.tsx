/**
 * The empty state of one section (a list, a table, a card): what is missing,
 * one line on what to do next, and at most one action.
 */

import type { ReactNode } from 'react'
import { cx } from '../primitives'

export interface EhrEmptyStateProps {
  readonly title: ReactNode
  /** One line on what to do next. */
  readonly message: ReactNode
  /** A single action, usually an EhrButton. */
  readonly action?: ReactNode
  readonly className?: string
}

export function EhrEmptyState({ title, message, action, className }: EhrEmptyStateProps) {
  return (
    <div className={cx('hid-ehr-empty-state', className)}>
      <p className="hid-ehr-state-title">{title}</p>
      <p className="hid-ehr-state-message">{message}</p>
      {action !== undefined ? <div className="hid-ehr-state-action">{action}</div> : null}
    </div>
  )
}
