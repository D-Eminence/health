import { Info } from 'lucide-react'
import { cx } from '../../../kasuwa/ui'

/** The one line every point-of-care screen shows when its routes answer 404: calm, and nothing pretends to save. */
export const NOT_SWITCHED_ON = 'Payments aren’t switched on for this facility yet.'

/**
 * The honest notice for a 404 from any point-of-care route (docs/POINT_OF_CARE_SPEC.md). `message` replaces the line
 * when the thing that isn't on is not payments ("Stock isn’t switched on…").
 */
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
