/**
 * The page heading: the page's one h1 (Playfair Display 400: 40px, 34px at
 * 1000px and below, 24px on phones), an optional line on what the page is
 * for, one primary action and any secondary ones, over a bottom rule.
 */

import type { ReactNode } from 'react'
import { cx } from '../primitives'

export interface EhrPageHeadingProps {
  readonly title: ReactNode
  readonly description?: ReactNode
  /** One primary action, usually an EhrButton. */
  readonly primaryAction?: ReactNode
  /** Filters, export and the like, shown before the primary action. */
  readonly secondaryActions?: ReactNode
  readonly className?: string
}

export function EhrPageHeading({ title, description, primaryAction, secondaryActions, className }: EhrPageHeadingProps) {
  const actions = primaryAction !== undefined || secondaryActions !== undefined

  return (
    <div className={cx('hid-ehr-page-heading', className)}>
      <div className="hid-ehr-page-heading-text">
        <h1 className="hid-ehr-page-title">{title}</h1>
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
