import { EhrButton, EhrDataTable, EhrDrawer, EhrField, EhrInput, type EhrDataTableColumn } from '@hid/ui/ehr'
import { useId, useRef, useState, type ReactNode } from 'react'
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
  /** "Patient / context". */
  readonly context: string
  readonly contextSub?: string
  readonly status: string
  /** A short note after the badge. */
  readonly statusNote?: string
  /** ISO time for "Updated". */
  readonly updated?: string
  /** What the quick view lists. */
  readonly details: readonly KeyValue[]
  /**
   * How the row opens. Left out: a link to `hrefFor(row)`. An action (such as a Health ID lookup, which has no address):
   * the Record name, "Open →" and "Open full record" are buttons drawn as those links. null: the row does not open; it
   * has only its quick view.
   */
  readonly open?: RowOpenAction | null
  /** Shown in the quick view after the details (such as an invitation's "Accept"); `close` closes this quick view. */
  readonly quickView?: (close: () => void) => ReactNode
}

/** A row that opens by an action rather than an address. */
export interface RowOpenAction {
  readonly onOpen: () => void
  /** While another open runs: the buttons say so (aria-disabled), and a press does nothing. */
  readonly busy?: boolean
  /**
   * Why the role cannot open it: its buttons are disabled and described by the element with `id`, which the page shows
   * once for every such row. The quick view repeats `reason` under its own button.
   */
  readonly unavailable?: { readonly id: string; readonly reason: string } | null
}

/**
 * The design's record table: Record, Patient / context, Status, Updated, then "Quick view" and "Open →". The quick
 * view is the design's "Record quick view" drawer. A row opens through its link, its action (`open`), or not at all.
 */
export function RecordTable({ caption, rows, hrefFor, loading = false, emptyTitle = 'No matching records', emptyMessage, emptyAction, notice }: {
  caption: string
  rows: readonly RecordRow[]
  hrefFor: (row: RecordRow) => string
  loading?: boolean
  emptyTitle?: ReactNode
  emptyMessage: ReactNode
  emptyAction?: ReactNode
  /** Shown first inside the quick view, such as the sample notice on a sample workspace's records. */
  notice?: ReactNode
}) {
  // By id, so the quick view shows the row as it is now if the rows change while it is open.
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = viewingId === null ? null : rows.find(row => row.id === viewingId) ?? null
  const navigate = useNavigate()
  const quickReasonId = useId()

  /** The Record name or "Open →": the row's link, its action drawn as that link, or (`open: null`) plain text and nothing. */
  function opener(row: RecordRow, text: string, label?: string) {
    if (row.open === null) return label ? null : <span>{text}</span>
    if (!row.open) return <Link className="hid-ehr-clinical-link" to={hrefFor(row)} aria-label={label}>{text}</Link>
    const { onOpen, busy = false, unavailable = null } = row.open
    return (
      <button
        type="button"
        className="hid-ehr-clinical-link hid-ehr-clinical-link-button"
        disabled={unavailable !== null}
        aria-disabled={busy || undefined}
        aria-label={label}
        aria-describedby={unavailable ? unavailable.id : undefined}
        onClick={() => { if (!busy) onOpen() }}
      >
        {text}
      </button>
    )
  }

  /** "Open full record": closes the quick view, then follows the link or runs the action. */
  function openFull(row: RecordRow) {
    if (row.open === null) return null
    const action = row.open
    if (!action) return <EhrButton onClick={() => { const to = hrefFor(row); setViewingId(null); navigate(to) }}>Open full record</EhrButton>
    const { onOpen, busy = false, unavailable = null } = action
    return (
      <>
        {unavailable ? <p id={quickReasonId} className="hid-ehr-clinical-quick-text">{unavailable.reason}</p> : null}
        <EhrButton
          disabled={unavailable !== null}
          aria-disabled={busy || undefined}
          aria-describedby={unavailable ? quickReasonId : undefined}
          onClick={() => { if (busy) return; setViewingId(null); onOpen() }}
        >
          Open full record
        </EhrButton>
      </>
    )
  }

  const columns: EhrDataTableColumn<RecordRow>[] = [
    {
      id: 'record',
      header: 'Record',
      cell: row => (
        <>
          {opener(row, row.name)}
          <span className="hid-ehr-clinical-record-id">{row.reference ?? shortId(row.id)}</span>
        </>
      ),
    },
    {
      id: 'context',
      header: 'Patient / context',
      cell: row => (
        <>
          {row.context}
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
          {opener(row, 'Open →', `Open ${row.name}`)}
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
            {notice}
            <h3 className="hid-ehr-clinical-quick-title">{viewing.name}</h3>
            {viewing.updated ? <p className="hid-ehr-clinical-quick-updated">Last updated {formatWhen(viewing.updated)}</p> : null}
            <KeyValueList items={viewing.details} />
            {viewing.quickView?.(() => setViewingId(current => (current === viewing.id ? null : current)))}
            {openFull(viewing)}
          </div>
        ) : null}
      </EhrDrawer>
    </>
  )
}

/**
 * The design's list search: "Search {workspace}" over "Search saved records…", and "Clear search" while it holds
 * text. Clearing moves focus back to the field, since the button disappears. `blankValue` is what the field holds when
 * nothing has been typed (the "HID-" a Health ID field starts with): it shows no "Clear search", and clearing returns
 * to it.
 */
export function SearchField({ label, value, onChange, placeholder = 'Search saved records…', hint, error, type = 'search', onSubmit, blankValue = '', children }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  error?: ReactNode
  type?: 'search' | 'text'
  /** When set, the field is a form: Enter (or a submit button in `children`) calls it. */
  onSubmit?: () => void
  blankValue?: string
  children?: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const field = (
    <EhrField label={label} hint={hint} error={error}>
      <EhrInput ref={input} type={type} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={event => onChange(event.target.value)} />
    </EhrField>
  )
  const clear = value && value !== blankValue ? (
    <EhrButton variant="secondary" className="hid-ehr-clinical-search-clear" onClick={() => { onChange(blankValue); input.current?.focus() }}>Clear search</EhrButton>
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
