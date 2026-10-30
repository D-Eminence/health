/**
 * A status pill. The default tone is the target's single badge: tint fill,
 * brand-dark text. The other tones come from text and fill pairs of 4.5:1 or
 * more, and every badge carries a text label: colour never speaks alone.
 */

import { cx } from '../primitives'

export type EhrBadgeTone = 'brand' | 'positive' | 'caution' | 'critical' | 'neutral'

export interface EhrBadgeProps {
  /** The status in words. */
  readonly children: string
  readonly tone?: EhrBadgeTone
  readonly className?: string
}

export function EhrBadge({ children, tone = 'brand', className }: EhrBadgeProps) {
  return (
    <span className={cx('hid-ehr-badge', tone !== 'brand' && `hid-ehr-badge-${tone}`, className)}>{children}</span>
  )
}
