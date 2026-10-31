import { EhrCard, EhrDialog } from '@hid/ui/ehr'
import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatWhen } from './format'
import { KeyValueList, type KeyValue } from './KeyValueList'
import { StatusBadge } from './StatusBadge'

/** The line under a record's heading: status badge, a short note, "Name · Health ID", "Saved {time}". */
export function DetailMeta({ status, note, patient, saved, children }: {
  status?: string
  note?: string
  patient?: string
  saved?: string
  children?: ReactNode
}) {
  return (
    <div className="hid-ehr-clinical-meta">
      {status ? <StatusBadge status={status} /> : null}
      {note ? <span className="hid-ehr-clinical-sync-note">{note}</span> : null}
      {patient ? <span>{patient}</span> : null}
      {saved ? <span className="hid-ehr-clinical-meta-saved">Saved {formatWhen(saved)}</span> : null}
      {children}
    </div>
  )
}

/** "Saved record" (wider, left) beside "Available actions" (right); one column below 1000px. */
export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="hid-ehr-clinical-detail-grid">{children}</div>
}

/** The "Saved record" card. */
export function SavedRecord({ items, title = 'Saved record', children }: { items: readonly KeyValue[]; title?: string; children?: ReactNode }) {
  return (
    <EhrCard title={title}>
      {children}
      <KeyValueList items={items} />
    </EhrCard>
  )
}

/** The design's full-width outline action buttons, 8px apart. */
export function ActionList({ children }: { children: ReactNode }) {
  return <div className="hid-ehr-clinical-action-list">{children}</div>
}

/** "Connected orders", "Next steps", "Continue care". */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="hid-ehr-clinical-subheading">{children}</h3>
}

/** One natural-width step button per line, 12px apart (design `p > button`). */
export function Step({ children }: { children: ReactNode }) {
  return <p className="hid-ehr-clinical-step">{children}</p>
}

export interface HistoryItem {
  readonly key: string
  readonly label: string
  readonly href?: string
  readonly status?: string
  /**
   * A row that opens by an action rather than an address (a document's file): its label is a button drawn as the
   * row's link, disabled while it cannot be opened, busy (aria-busy) and ignoring presses (aria-disabled) while it is
   * being opened.
   */
  readonly open?: { readonly onOpen: () => void; readonly disabled?: boolean; readonly busy?: boolean }
  /** Lines under the label (a document's type, size and scan), which also describe its button. */
  readonly detail?: readonly string[]
  /** Controls after the status (a document's "Extract with OCR"). */
  readonly extra?: ReactNode
}

/**
 * "Connected hospital history": records of the same patient this user may see, each with its status. An empty
 * `empty` draws nothing when there are none. `children` come before the rows (notices, pagers), `footer` after them.
 */
export function HistoryCard({ items, empty = 'Nothing else for this patient yet.', children, footer }: {
  items: readonly HistoryItem[]
  empty?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  const id = useId()
  return (
    <EhrCard title="History">
      <p>Only records your role can see are listed.</p>
      {children}
      {items.length === 0 ? (empty ? <p>{empty}</p> : null) : (
        <ul className="hid-ehr-clinical-history-list">
          {items.map((item, index) => {
            const detailIds = (item.detail ?? []).map((_, line) => `${id}-${index}-${line}`)
            const label = item.open ? (
              <button
                type="button"
                className="hid-ehr-clinical-link hid-ehr-clinical-history-open"
                disabled={item.open.disabled}
                aria-disabled={item.open.busy || undefined}
                aria-busy={item.open.busy || undefined}
                aria-describedby={detailIds.length > 0 ? detailIds.join(' ') : undefined}
                onClick={() => { if (!item.open?.busy) item.open?.onOpen() }}
              >
                {item.label}
              </button>
            ) : item.href ? <Link className="hid-ehr-clinical-link" to={item.href}>{item.label}</Link> : <span>{item.label}</span>
            const status = item.status ? <StatusBadge status={item.status} /> : null
            return (
              <li key={item.key} className="hid-ehr-clinical-history-row">
                {detailIds.length > 0 ? (
                  <span>
                    {label}
                    {item.detail?.map((line, at) => <span key={detailIds[at]} id={detailIds[at]} className="hid-ehr-clinical-cell-sub">{line}</span>)}
                  </span>
                ) : label}
                {item.extra ? <span className="hid-ehr-clinical-consult-document-actions">{status}{item.extra}</span> : status}
              </li>
            )
          })}
        </ul>
      )}
      {footer}
    </EhrCard>
  )
}

export interface VersionItem {
  readonly key: string
  /** "{time} · {status} · {reason}". */
  readonly summary: string
  readonly author?: string
  readonly items: readonly KeyValue[]
}

/** "Preserved versions & amendments": one disclosure per earlier version. */
export function VersionsCard({ versions, title = 'Earlier versions' }: { versions: readonly VersionItem[]; title?: string }) {
  if (versions.length === 0) return null
  return (
    <EhrCard title={title}>
      {versions.map(version => (
        <details key={version.key} className="hid-ehr-clinical-version">
          <summary>{version.summary}</summary>
          {version.author ? <p>Author: {version.author}</p> : null}
          <KeyValueList items={version.items} />
        </details>
      ))}
    </EhrCard>
  )
}

export const CONFIRM_BODY = 'Check the details first. This changes the saved record; the change is kept in its history.'

/**
 * The design's decision dialog: "{label}?", the history sentence, "Cancel" and the action. `word` ("SIGN",
 * "DELETE", "REFUND") keeps the action disabled until typed exactly.
 */
export function ConfirmAction({ open, label, word, description = CONFIRM_BODY, busy, onConfirm, onCancel }: {
  open: boolean
  label: string
  word?: string
  description?: ReactNode
  busy?: boolean
  onConfirm: () => void | Promise<unknown>
  onCancel: () => void
}) {
  return (
    <EhrDialog
      open={open}
      title={`${label}?`}
      description={description}
      confirmLabel={label}
      confirmWord={word}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
