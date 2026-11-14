import type { ReactNode } from 'react'

export type DeptNoticeTone = 'info' | 'caution' | 'critical' | 'positive'

export interface DeptNoticeProps {
  readonly tone?: DeptNoticeTone
  /** `alert` for a refusal after an action; `status` for a result that should be read out. */
  readonly role?: 'alert' | 'status'
  /**
   * The design's two shapes: `banner`, its Banner for a persistent condition (a 4px rule on the left); `box`, its
   * ErrorBox or info box for what an action just answered. An alert is a box unless told otherwise.
   */
  readonly variant?: 'banner' | 'box'
  readonly id?: string
  /** Set to -1 when focus is moved here. */
  readonly tabIndex?: number
  readonly title?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

/**
 * A notice inside a page, in the design's Banner or ErrorBox look. Its words carry the
 * meaning; the tone only adds colour.
 */
export function DeptNotice({ tone = 'info', role, variant, id, tabIndex, title, children, className }: DeptNoticeProps) {
  const shape = variant ?? (role === 'alert' ? 'box' : 'banner')
  return (
    <div id={id} role={role} tabIndex={tabIndex}
      className={['hid-ehr-dept-notice', `hid-ehr-dept-notice-${shape}`, `hid-ehr-dept-notice-${tone}`, className].filter(Boolean).join(' ')}>
      {title !== undefined ? <strong className="hid-ehr-dept-notice-title">{title}</strong> : null}
      <div className="hid-ehr-dept-notice-body">{children}</div>
    </div>
  )
}
