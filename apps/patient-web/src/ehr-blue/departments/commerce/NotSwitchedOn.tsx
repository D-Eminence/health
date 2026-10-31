import { Info } from 'lucide-react'
import { cx } from '../../../kasuwa/ui'

/**
 * What a point-of-care screen says when an action's route answers 404 (or 501): plain, and nothing pretends to save. It
 * is said only once the staff member acts; a list that answers 404 shows its normal empty state instead.
 */
export const NOT_SWITCHED_ON = 'This isn’t set up for your facility. Contact support.'
/** The same, after a write: nothing was saved. */
export const NOT_SET_UP_UNSAVED = 'This isn’t set up for your facility, so nothing was saved. Contact support.'

/** The notice for a 404 from a point-of-care route (docs/POINT_OF_CARE_SPEC.md), once the staff member has acted. */
export function NotSwitchedOn({ message = NOT_SWITCHED_ON, compact = false, className }: {
  readonly message?: string; readonly compact?: boolean; readonly className?: string
}) {
  return (
    <p role="status" className={cx('m-0 flex items-start gap-2.5 rounded-lg bg-subtle text-ink-2 ring-1 ring-inset ring-line',
      compact ? 'px-3 py-2 text-[13px]' : 'px-4 py-3.5 text-sm', className)}>
      <Info className={cx('shrink-0 text-ink-3', compact ? 'mt-px size-4' : 'mt-0.5 size-[18px]')} aria-hidden />
      <span>{message}</span>
    </p>
  )
}
