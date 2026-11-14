/**
 * The page heading: the page's one h1 (the display face, 600: 30px, 28px at
 * 760px of content and below, 24px at 640px), an optional line on what the page is
 * for, one primary action and any secondary ones, over a bottom rule.
 */

import type { ReactNode } from 'react'
import { cx } from '../primitives'

export interface EhrPageHeadingProps {
  readonly title: ReactNode
  /** A short line above the title, in capitals ("Platform administration", "Step 9 of 9 · Launch"). */
  readonly eyebrow?: ReactNode
  readonly description?: ReactNode
  /** One primary action, usually an EhrButton. */
  readonly primaryAction?: ReactNode
  /** Filters, export and the like, shown before the primary action. */
  readonly secondaryActions?: ReactNode
  /** Back, as an arrow button placed just before the title on the same line (EhrBackButton). */
  readonly back?: ReactNode
  readonly className?: string
}

export function EhrPageHeading({ title, eyebrow, description, primaryAction, secondaryActions, back, className }: EhrPageHeadingProps) {
  const actions = primaryAction !== undefined || secondaryActions !== undefined

  return (
    <div className={cx('hid-ehr-page-heading', className)}>
      <div className="hid-ehr-page-heading-text">
        {eyebrow !== undefined ? <p className="hid-ehr-page-eyebrow">{eyebrow}</p> : null}
        {back !== undefined
          ? <div className="hid-ehr-page-title-row">{back}<h1 className="hid-ehr-page-title">{title}</h1></div>
          : <h1 className="hid-ehr-page-title">{title}</h1>}
        {description !== undefined ? <p className="hid-ehr-page-description">{description}</p> : null}
      </div>
      {actions ? (
        <div className="hid-ehr-page-actions">
          {secondaryActions}
          {primaryAction}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Back as an arrow (owner, 2026-10-31): a 44px button at the top-left, just before the page title. `label` names where
 * it goes ("Back to list"), since the arrow has no words.
 */
export function EhrBackButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" className="hid-ehr-back-button" aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
      </svg>
    </button>
  )
}
