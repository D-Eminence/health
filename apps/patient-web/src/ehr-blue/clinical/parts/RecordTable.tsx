import { EhrButton, EhrDataTable, EhrDrawer, EhrField, EhrInput, type EhrDataTableColumn } from '@hid/ui/ehr'
import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatWhen, shortId } from './format'
import { KeyValueList, type KeyValue } from './KeyValueList'
import { StatusBadge } from './StatusBadge'

/** One row of a workspace list, in the design's five columns. */
export interface RecordRow {
  readonly id: string
  /** The "Record" link text. */
  readonly name: string
  /** Under the link; the first eight characters of `id` by default. */
  readonly reference?: string
  /** "Patient / context", or the column `contextHeader` names; also searched. */
  readonly context: string
  readonly contextSub?: string
  /** Drawn in place of `context` (values with units and flags); `context` stays the searchable text. */
  readonly summary?: ReactNode
  readonly status: string
  /** A short note after the badge. */
  readonly statusNote?: string
  /** ISO time for "Updated". */
  readonly updated?: string
  /** What the quick view lists. */
  readonly details: readonly KeyValue[]
}

/**
 * The design's record table: Record, Patient / context, Status, Updated, then "Quick view" and "Open →". The quick
 * view is the design's "Record quick view" drawer. Below 1024px each row is a card (title and status on the first
 * line, the context, when it was updated, then its two actions), so nothing scrolls sideways (owner, 2026-10-31).
 */
export function RecordTable({ caption, rows, hrefFor, loading = false, emptyTitle = 'No matching records', emptyMessage, emptyAction, contextHeader = 'Patient / context' }: {
  caption: string
  /** The second column's heading. In one patient's chart it names what the row holds, never the patient again. */
  contextHeader?: string
  rows: readonly RecordRow[]
  hrefFor: (row: RecordRow) => string
  loading?: boolean
  emptyTitle?: ReactNode
  emptyMessage: ReactNode
  emptyAction?: ReactNode
}) {
  // By id, so the quick view shows the row as it is now if the rows change while it is open.
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = viewingId === null ? null : rows.find(row => row.id === viewingId) ?? null
  const navigate = useNavigate()
  const columns: EhrDataTableColumn<RecordRow>[] = [
    {
      id: 'record',
      header: 'Record',
      cell: row => (
        <>
          <Link className="hid-ehr-clinical-link" to={hrefFor(row)}>{row.name}</Link>
          <span className="hid-ehr-clinical-record-id">{row.reference ?? shortId(row.id)}</span>
        </>
      ),
    },
    {
      id: 'context',
      header: contextHeader,
      cell: row => (
        <>
          {row.summary ?? row.context}
          {row.contextSub ? <span className="hid-ehr-clinical-cell-sub">{row.contextSub}</span> : null}
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: row => (
        <>
          <StatusBadge status={row.status} />
          {row.statusNote ? <span className="hid-ehr-clinical-sync-note">{row.statusNote}</span> : null}
        </>
      ),
    },
    { id: 'updated', header: 'Updated', cell: row => formatWhen(row.updated) },
    {
      id: 'open',
      header: <span className="hid-ehr-sr-only">Actions</span>,
      cell: row => (
        <span className="hid-ehr-clinical-row-actions">
          <EhrButton variant="secondary" aria-label={`Quick view ${row.name}`} onClick={() => setViewingId(row.id)}>Quick view</EhrButton>
          <Link className="hid-ehr-clinical-link" to={hrefFor(row)} aria-label={`Open ${row.name}`}>Open →</Link>
        </span>
      ),
    },
  ]

  return (
    <>
      <EhrDataTable
        caption={caption}
        captionHidden
        className="hid-ehr-clinical-list-table"
        stack="lg"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        loading={loading}
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        emptyAction={emptyAction}
      />
      <EhrDrawer open={viewing !== null} title="Record quick view" onClose={() => setViewingId(null)}>
        {viewing ? (
          <div className="hid-ehr-clinical-quick">
            <h3 className="hid-ehr-clinical-quick-title">{viewing.name}</h3>
            {viewing.updated ? <p className="hid-ehr-clinical-quick-updated">Last updated {formatWhen(viewing.updated)}</p> : null}
            <KeyValueList items={viewing.details} />
            <EhrButton onClick={() => { const to = hrefFor(viewing); setViewingId(null); navigate(to) }}>Open full record</EhrButton>
          </div>
        ) : null}
      </EhrDrawer>
    </>
  )
}

/**
 * The design's list search: "Search {workspace}" over "Search saved records…", and "Clear search" while it holds
 * text. Clearing moves focus back to the field, since the button disappears.
 */
export function SearchField({ label, value, onChange, placeholder = 'Search saved records…', hint, error, type = 'search', onSubmit, children }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  error?: ReactNode
  type?: 'search' | 'text'
  /** When set, the field is a form: Enter (or a submit button in `children`) calls it. */
  onSubmit?: () => void
  children?: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const field = (
    <EhrField label={label} hint={hint} error={error}>
      <EhrInput ref={input} type={type} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={event => onChange(event.target.value)} />
    </EhrField>
  )
  const clear = value ? (
    <EhrButton variant="secondary" className="hid-ehr-clinical-search-clear" onClick={() => { onChange(''); input.current?.focus() }}>Clear search</EhrButton>
  ) : null

  if (!onSubmit) return <div className="hid-ehr-clinical-search">{field}{clear}{children}</div>
  return (
    <form className="hid-ehr-clinical-search" noValidate onSubmit={event => { event.preventDefault(); onSubmit() }}>
      {field}
      {children ? <div className="hid-ehr-clinical-search-actions">{children}{clear}</div> : clear}
    </form>
  )
}

/** "Previous page | Page n of m | Next page" (`total` unknown: "Page n"). */
export function Pager({ page, total, onPrevious, onNext, busy = false }: {
  page: number
  total?: number
  onPrevious?: () => void
  onNext?: () => void
  busy?: boolean
}) {
  return (
    <nav className="hid-ehr-clinical-pager" aria-label="Record pages">
      <EhrButton variant="secondary" disabled={!onPrevious} busy={busy} onClick={onPrevious}>Previous page</EhrButton>
      <span>{total ? `Page ${page} of ${total}` : `Page ${page}`}</span>
      <EhrButton variant="secondary" disabled={!onNext} busy={busy} onClick={onNext}>Next page</EhrButton>
    </nav>
  )
}
