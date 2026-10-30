/**
 * The loading state of one section: pulsing bars hidden from assistive
 * technology, and a visually hidden status that says what is loading.
 */

import { cx } from '../primitives'

export interface EhrSkeletonProps {
  /** Read out in place of the bars. */
  readonly label?: string
  /** How many bars to draw; the second is the tall one. */
  readonly bars?: number
  readonly className?: string
}

export function EhrSkeleton({ label = 'Loading', bars = 3, className }: EhrSkeletonProps) {
  return (
    <div className={cx('hid-ehr-skeleton', className)}>
      <div aria-hidden="true">
        {Array.from({ length: Math.max(1, bars) }, (_, index) => <span key={index} className="hid-ehr-skeleton-bar" />)}
      </div>
      <p role="status" className="hid-ehr-sr-only">{label}</p>
    </div>
  )
}
