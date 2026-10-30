/**
 * A status pill, drawn as the design draws every badge: tint fill, brand-dark text, 5px radius, 11px. Its words carry
 * the status: colour never speaks alone. `tone` names what the status means (data-tone, for tests and assistive
 * styling later) without changing the colour, since the screenshots show one badge colour (owner decision).
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
  return <span className={cx('hid-ehr-badge', className)} data-tone={tone}>{children}</span>
}
