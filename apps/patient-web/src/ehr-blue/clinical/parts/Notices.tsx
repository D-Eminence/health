import { EhrButton, EhrPageHeading, EhrSkeleton } from '@hid/ui/ehr'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

/** The design's generic failure line, for an operation whose own message would be technical. */
export const ACTION_FAILED = 'This action could not be completed. Your saved work is safe. Please retry.'
export const NO_ACTIONS = 'No further actions for your permission and this record state.'

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

/** A list page's heading: the workspace title and, when allowed, "Create record". */
export function ListHeading({ title, createHref, createLabel = 'Create record' }: { title: string; createHref?: string; createLabel?: string }) {
  const navigate = useNavigate()
  return (
    <EhrPageHeading
      title={title}
      primaryAction={createHref ? <EhrButton onClick={() => navigate(createHref)}>{createLabel}</EhrButton> : undefined}
    />
  )
}

/** A record or create page's heading: its title and "Back to list". */
export function RecordHeading({ title, backHref, backLabel = 'Back to list' }: { title: string; backHref: string; backLabel?: string }) {
  const navigate = useNavigate()
  return (
    <EhrPageHeading
      title={title}
      primaryAction={<EhrButton variant="secondary" onClick={() => navigate(backHref)}>{backLabel}</EhrButton>}
    />
  )
}

/** The design's missing-record page. */
export function RecordNotFound({ backHref, message = 'The record is missing or outside your authorized hospital / branch.' }: {
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
