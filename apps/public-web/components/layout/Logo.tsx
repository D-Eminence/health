import Link from 'next/link'
import { cx } from '@hid/ui'

/**
 * The Health ID mark.
 *
 * Drawn as SVG rather than shipped as a bitmap so it stays sharp at any size
 * and inherits the surrounding text colour on inverted bands.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 24"
      aria-hidden="true"
      className={cx('h-6 w-8 shrink-0', className)}
      fill="none"
    >
      {[0, 1, 2, 3, 4, 5, 6].map(index => {
        const x = 2 + index * 4.6
        const inset = Math.abs(index - 3) * 2.4
        return (
          <line
            key={index}
            x1={x}
            y1={2 + inset}
            x2={x}
            y2={22 - inset}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

export interface LogoProps {
  readonly href?: string
  readonly tone?: 'brand' | 'inverse'
  readonly className?: string
}

export function Logo({ href = '/', tone = 'brand', className }: LogoProps) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand',
        tone === 'inverse' ? 'text-white' : 'text-brand',
        className,
      )}
    >
      <LogoMark />
      <span className="font-display text-[22px] leading-none">Health ID</span>
    </Link>
  )
}
