/**
 * EHR cards. EhrCard is a plain section of a page. EhrStatCard shows one
 * figure with its label and an optional detail; given an href it has exactly
 * one link (its label), stretched over the card, and nothing else to press.
 */

import type { MouseEvent, ReactNode } from 'react'
import { cx } from '../primitives'

export interface EhrCardProps {
  readonly title?: ReactNode
  /** The title's heading level under the page's h1. */
  readonly titleLevel?: 2 | 3
  /** Shown beside the title. */
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

export function EhrCard({ title, titleLevel = 2, actions, children, className }: EhrCardProps) {
  const Title = titleLevel === 3 ? 'h3' : 'h2'

  return (
    <section className={cx('hid-ehr-card', className)}>
      {title !== undefined || actions !== undefined ? (
        <div className="hid-ehr-card-header">
          {title !== undefined ? <Title className="hid-ehr-card-title">{title}</Title> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface EhrStatCardProps {
  readonly label: string
  readonly value: ReactNode
  readonly detail?: ReactNode
  /** A decorative icon beside the label. */
  readonly icon?: ReactNode
  /** Makes the card one link, named by its label. */
  readonly href?: string
  readonly onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void
  readonly className?: string
}

export function EhrStatCard({ label, value, detail, icon, href, onNavigate, className }: EhrStatCardProps) {
  return (
    <div className={cx('hid-ehr-stat-card', className)}>
      <p className="hid-ehr-stat-label">
        {href !== undefined ? (
          <a className="hid-ehr-stat-card-link" href={href} onClick={onNavigate}>{label}</a>
        ) : (
          <span>{label}</span>
        )}
        {icon !== undefined ? <span className="hid-ehr-stat-icon" aria-hidden="true">{icon}</span> : null}
      </p>
      <p className="hid-ehr-stat-value">{value}</p>
      {detail !== undefined ? <p className="hid-ehr-stat-detail">{detail}</p> : null}
    </div>
  )
}
