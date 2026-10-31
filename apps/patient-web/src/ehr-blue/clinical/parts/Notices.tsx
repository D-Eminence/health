import { EhrButton, EhrPageHeading, EhrSkeleton } from '@hid/ui/ehr'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

/** The design's generic failure line, for an operation whose own message would be technical. */
export const ACTION_FAILED = 'That didn’t work. What you saved is safe; please try again.'
export const NO_ACTIONS = 'Nothing more to do here.'

/**
 * The design's Banner: a strong title on its own line, then the message. Info and warning are status regions;
 * critical is an alert. Live states the design does not draw (access ended, a server refusal) use it.
 */
export function Banner({ tone = 'info', title, children, actions }: {
  tone?: 'info' | 'warning' | 'critical'
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  const toneClass = tone === 'info' ? '' : ` hid-ehr-clinical-banner-${tone}`
  return (
    <section className={`hid-ehr-clinical-banner${toneClass}`} role={tone === 'critical' ? 'alert' : 'status'}>
      <strong className="hid-ehr-clinical-banner-title">{title}</strong>
      {typeof children === 'string' ? <p>{children}</p> : children}
      {actions ? <div className="hid-ehr-clinical-banner-actions">{actions}</div> : null}
    </section>
  )
}

/** The design's operation error box (`.error`, role alert). */
export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="hid-ehr-clinical-alert" role="alert">{typeof children === 'string' ? <p>{children}</p> : children}</div>
}

/** A loading placeholder; its label is announced. */
export function Loading({ label }: { label: string }) {
  return <EhrSkeleton label={label} />
}

/** A list page's heading: the workspace title and, when allowed, its "New …" button. */
export function ListHeading({ title, createHref, createLabel = 'New record' }: { title: string; createHref?: string; createLabel?: string }) {
  const navigate = useNavigate()
  return (
    <EhrPageHeading
      title={title}
      primaryAction={createHref ? <EhrButton onClick={() => navigate(createHref)}>{createLabel}</EhrButton> : undefined}
    />
  )
}

/** A record or create page's heading: its title and "Back to list". */
export function RecordHeading({ title, backHref, backLabel = 'Back to list' }: { title: ReactNode; backHref: string; backLabel?: string }) {
  const navigate = useNavigate()
  const mark = useRef<HTMLSpanElement>(null)
  // The frame moves focus to the page's h1 as the address changes (pageFocus.ts); a record still loading has none, so
  // focus waits on the frame's page wrapper. The heading takes it from that container once the record shows.
  useLayoutEffect(() => {
    const heading = mark.current?.closest('h1')
    const active = document.activeElement
    if (!heading || !(active instanceof HTMLElement) || active === document.body || active === heading || !active.contains(heading)) return
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    heading.focus()
  }, [])
  return (
    <EhrPageHeading
      title={<span ref={mark}>{title}</span>}
      primaryAction={<EhrButton variant="secondary" onClick={() => navigate(backHref)}>{backLabel}</EhrButton>}
    />
  )
}

/**
 * "No further actions for your permission and this record state.", where the design puts it: after the (empty) action
 * list, so it sits 28px under the card title as in the design.
 */
export function NoActions() {
  return (
    <>
      <div className="hid-ehr-clinical-action-list" />
      <p className="hid-ehr-clinical-note">{NO_ACTIONS}</p>
    </>
  )
}

/** The design's missing-record page. */
export function RecordNotFound({ backHref, message = 'This record doesn’t exist, or it belongs to another facility.' }: {
  backHref: string
  message?: string
}) {
  return (
    <>
      <RecordHeading title="Record not found" backHref={backHref} />
      <p>{message}</p>
    </>
  )
}
