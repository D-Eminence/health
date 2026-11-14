import type { ReactNode } from 'react'

/**
 * Holds a part of today's provider workspace that a blue page reuses as it is (an
 * order from another facility to accept, "Correct an order that has ended", "Can't
 * complete this order"), so its checks, refusals and wording stay exactly today's.
 * departments.css restyles it in the blue look inside this wrapper only.
 */
export function DeptEmbedded({ children, className, label }: {
  readonly children: ReactNode
  readonly className?: string
  /** Names the region when it stands alone. */
  readonly label?: string
}) {
  return (
    <div className={['hid-ehr-dept-embedded', className].filter(Boolean).join(' ')} role={label ? 'region' : undefined} aria-label={label}>
      {children}
    </div>
  )
}
