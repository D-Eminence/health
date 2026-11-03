import type { MouseEventHandler, ReactNode, Ref } from 'react'
import { EhrBadge, type EhrBadgeTone } from '@hid/ui/ehr'

/**
 * The parts of the target's record views: the line under a record's title, its
 * "Saved record" fields, its "Available actions", and its preserved versions.
 */

/** A record's status and context, under its title: a badge, then short facts. */
export function DeptContextLine({ status, tone, items }: {
  readonly status?: string
  readonly tone?: EhrBadgeTone
  readonly items?: ReadonlyArray<ReactNode>
}) {
  const shown = (items ?? []).filter(item => item !== null && item !== undefined && item !== false && item !== '')
  return (
    <div className="hid-ehr-dept-context">
      {status ? <EhrBadge tone={tone}>{status}</EhrBadge> : null}
      {shown.map((item, index) => <span key={index} className="hid-ehr-dept-context-item">{item}</span>)}
    </div>
  )
}

export interface DeptFact {
  readonly label: string
  readonly value: ReactNode
}

/** Labelled facts as a definition list: "Saved record" and the like. */
export function DeptFacts({ facts, className }: { readonly facts: ReadonlyArray<DeptFact>; readonly className?: string }) {
  return (
    <dl className={['hid-ehr-dept-facts', className].filter(Boolean).join(' ')}>
      {facts.map(fact => (
        <div key={fact.label} className="hid-ehr-dept-fact">
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The record's own card ("Saved record") beside its actions ("Available actions"), as on the target. */
export function DeptRecordLayout({ main, aside }: { readonly main: ReactNode; readonly aside?: ReactNode }) {
  return (
    <div className={aside ? 'hid-ehr-dept-two-col' : undefined}>
      <div className="hid-ehr-dept-stack">{main}</div>
      {aside ? <div className="hid-ehr-dept-stack">{aside}</div> : null}
    </div>
  )
}

/** The "Available actions" card: its actions stacked full width, or a line saying there are none. */
export function DeptActions({ title = 'Available actions', children, empty = 'No actions are available to you on this record.' }: {
  readonly title?: string
  readonly children?: ReactNode
  readonly empty?: string
}) {
  const has = Array.isArray(children) ? children.some(Boolean) : Boolean(children)
  return (
    <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-actions-card">
      <h2 className="hid-ehr-card-title">{title}</h2>
      {has ? <div className="hid-ehr-dept-action-stack">{children}</div> : <p className="hid-ehr-dept-actions-empty">{empty}</p>}
    </section>
  )
}

/** One preserved version or event, collapsed to its summary line. */
export interface DeptHistoryEntry {
  readonly key: string
  readonly summary: ReactNode
  readonly detail?: ReactNode
}

/** "Preserved versions & amendments": each entry a native disclosure, so Enter and Space open it. */
export function DeptHistory({ title = 'Preserved versions & amendments', entries, empty }: {
  readonly title?: string
  readonly entries: ReadonlyArray<DeptHistoryEntry>
  readonly empty?: string
}) {
  if (entries.length === 0 && !empty) return null
  return (
    <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-history-card">
      <h2 className="hid-ehr-card-title">{title}</h2>
      {entries.length === 0 ? <p className="hid-ehr-dept-muted">{empty}</p> : entries.map(entry => (
        <details key={entry.key} className="hid-ehr-dept-history">
          <summary>{entry.summary}</summary>
          {entry.detail !== undefined ? <div className="hid-ehr-dept-history-detail">{entry.detail}</div> : null}
        </details>
      ))}
    </section>
  )
}

/**
 * A record's name in a list, or "Open": a button that opens the record in this page,
 * styled as the target's link. A button, not a link: it changes the view, not the URL,
 * so nothing about the record is put in the address or the history.
 */
export function DeptLinkButton({ children, onClick, id, describedBy, ref, className }: {
  readonly children: ReactNode
  readonly onClick: MouseEventHandler<HTMLButtonElement>
  readonly id?: string
  readonly describedBy?: string
  readonly ref?: Ref<HTMLButtonElement>
  readonly className?: string
}) {
  return (
    <button ref={ref} id={id} type="button" className={['hid-ehr-dept-link', className].filter(Boolean).join(' ')} aria-describedby={describedBy} onClick={onClick}>
      {children}
    </button>
  )
}

/** A record's name and a short reference under it, as the target's first list column. */
export function DeptRecordName({ name, reference, onOpen, id }: {
  readonly name: ReactNode
  readonly reference?: ReactNode
  readonly onOpen?: () => void
  readonly id?: string
}) {
  return (
    <div className="hid-ehr-dept-record-name">
      {onOpen ? <DeptLinkButton id={id} onClick={onOpen}>{name}</DeptLinkButton> : <span id={id} className="hid-ehr-dept-strong">{name}</span>}
      {reference !== undefined && reference !== null ? <span className="hid-ehr-dept-reference">{reference}</span> : null}
    </div>
  )
}
