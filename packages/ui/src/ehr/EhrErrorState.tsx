/**
 * The error state of one section: a calm title, a message the caller writes
 * (never raw error text), and an optional Retry.
 *
 * It is an alert only when it replaces content after an action the user took
 * (`announce`); a section that fails as the page loads is read in place.
 */

import type { ReactNode } from 'react'
import { cx } from '../primitives'
import { EhrButton } from './EhrButton'

export interface EhrErrorStateProps {
  readonly title: string
  /** Plain-language copy: what happened and what to do. Never an exception message. */
  readonly message: string
  readonly onRetry?: () => void | Promise<unknown>
  readonly retryLabel?: string
  /** Set when this replaces content after an action, so it is announced. */
  readonly announce?: boolean
  readonly className?: string
}

export function EhrErrorState({ title, message, onRetry, retryLabel = 'Try again', announce = false, className }: EhrErrorStateProps) {
  const retry: ReactNode = onRetry ? (
    <div className="hid-ehr-state-action">
      <EhrButton variant="secondary" onClick={onRetry}>{retryLabel}</EhrButton>
    </div>
  ) : null

  return (
    <div className={cx('hid-ehr-error-state', className)} role={announce ? 'alert' : undefined}>
      <p className="hid-ehr-state-title">{title}</p>
      <p className="hid-ehr-state-message">{message}</p>
      {retry}
    </div>
  )
}
