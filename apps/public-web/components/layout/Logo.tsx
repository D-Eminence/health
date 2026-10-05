import Link from 'next/link'
import { cx } from '@hid/ui'

/**
 * The Health ID logo, exactly as supplied.
 *
 * Two assets, both transparent PNGs:
 *
 *   - `logo.png`      890×264  the wordmark lockup, shown at 26px in the
 *                              navigation and 44px in the footer
 *   - `logo-icon.png` 179×176  the mark, shown at 20px inside the dashboard
 *
 * They are rendered as the supplied files rather than redrawn, so there is
 * exactly one source of truth and no second interpretation of the mark. The
 * accessible names are the design's own.
 */

const LOGO_ALT = 'Health ID: Health Identity Directory'
const MARK_ALT = 'Health ID'

/** Intrinsic size of the lockup, so `height` alone drives the rendered width. */
const LOCKUP_WIDTH = 890
const LOCKUP_HEIGHT = 264

interface LockupProps {
  /** `nav` for the header lockup, `full` for the footer lockup. */
  readonly variant?: 'nav' | 'full'
  readonly className?: string
}

/** The supplied lockup image, unlinked, for places the design shows it bare. */
export function LogoImage({ variant = 'nav', className }: LockupProps) {
  const height = variant === 'full' ? 44 : 26

  return (
    <img
      src="/brand/logo.png"
      alt={LOGO_ALT}
      width={LOCKUP_WIDTH}
      height={LOCKUP_HEIGHT}
      style={{ height }}
      className={cx('block w-auto', className)}
    />
  )
}

export interface LogoProps extends LockupProps {
  readonly href?: string
}

/** The supplied lockup image, linked home. Used in the navigation and footer. */
export function Logo({ href = '/', variant = 'nav', className }: LogoProps) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand',
        className,
      )}
    >
      <LogoImage variant={variant} />
    </Link>
  )
}

/** The supplied mark used inside the dashboard chrome, at its designed size. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/logo-icon.png"
      alt={MARK_ALT}
      width={179}
      height={176}
      style={{ height: 20 }}
      className={cx('block w-auto', className)}
    />
  )
}
