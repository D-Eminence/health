import type { ReactNode } from 'react'

export type DeptNoticeTone = 'info' | 'caution' | 'critical' | 'positive'

export interface DeptNoticeProps {
  readonly tone?: DeptNoticeTone
  /** `alert` for a refusal after an action; `status` for a result that should be read out. */
  readonly role?: 'alert' | 'status'
  readonly id?: string
  /** Set to -1 when focus is moved here. */
  readonly tabIndex?: number
  readonly title?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

/**
 * A banner inside a page: a persistent condition, a result, or a refusal. Its words
 * carry the meaning; the tone only adds colour and a left rule.
 */
export function DeptNotice({ tone = 'info', role, id, tabIndex, title, children, className }: DeptNoticeProps) {
  return (
    <div id={id} role={role} tabIndex={tabIndex} className={['hid-ehr-dept-notice', `hid-ehr-dept-notice-${tone}`, className].filter(Boolean).join(' ')}>
      {title !== undefined ? <p className="hid-ehr-dept-notice-title">{title}</p> : null}
      <div className="hid-ehr-dept-notice-body">{children}</div>
    </div>
  )
}
