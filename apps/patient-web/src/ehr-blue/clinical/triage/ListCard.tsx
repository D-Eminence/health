import { EhrCard } from '@hid/ui/ehr'
import { useMemo } from 'react'
import { statusWords } from '../parts/format'
import { ErrorBox, Loading } from '../parts/Notices'
import { Pager, RecordTable, SearchField, type RecordRow } from '../parts/RecordTable'
import { CHANGE_SEARCH, FIRST_RECORD, NEWEST_ONLY, NO_ENCOUNTERS, type PatientRecords } from './records'

/** The design's list card: search, today's paging notices and pager, the table and its empty states. */
export function ListCard({ list, rows, search, onSearch, hrefFor, title, pending = false, contextHeader, noRecords = FIRST_RECORD }: {
  list: PatientRecords
  rows: readonly RecordRow[]
  /** The rows are not ready to show yet (a corrected vital's current values are still being read). */
  pending?: boolean
  search: string
  onSearch: (value: string) => void
  hrefFor: (row: RecordRow) => string
  title: string
  /** The table's second column (in one patient's chart, what the row holds, not the patient's name again). */
  contextHeader?: string
  /** Said when the encounters hold none of these records. */
  noRecords?: string
}) {
  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase()
    if (!words) return rows
    return rows.filter(row => [row.name, row.id, row.context, statusWords(row.status), row.statusNote ?? '', ...row.details.map(detail => typeof detail.value === 'string' ? detail.value : '')]
      .join(' ').toLowerCase().includes(words))
  }, [rows, search])

  return (
    <EhrCard>
      <SearchField label={`Search ${title}`} value={search} onChange={onSearch} />
      <VisitPages list={list} />
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      {list.recordError ? <ErrorBox>{list.recordError}</ErrorBox> : null}
      {list.truncated ? <p className="hid-ehr-clinical-note">{NEWEST_ONLY}</p> : null}
      {list.records === null || pending ? (list.loading || pending ? <Loading label="Loading records…" /> : null) : (
        <RecordTable
          caption={title}
          rows={filtered}
          hrefFor={hrefFor}
          contextHeader={contextHeader}
          emptyMessage={rows.length > 0 ? CHANGE_SEARCH : list.encounters?.length === 0 ? NO_ENCOUNTERS : noRecords}
        />
      )}
    </EhrCard>
  )
}

/**
 * Today's paging over the patient's encounters, 50 to a page (staff/routes/Clinical.tsx:1793-1794): the list's notice,
 * then the pager, each move re-checking access first. Shown only while there is more than one page, or something to
 * say. `label` names the pager's landmark, as today's Pager takes one (Clinical.tsx:367): the create page's is today's
 * "Encounter pages" (:1794), beside its visit picker; without one it is the shared "Record pages".
 */
export function VisitPages({ list, label }: { list: PatientRecords; label?: string }) {
  const { cursors, next, loading, load, notice } = list
  const paged = cursors.length >= 2 || next !== null
  if (!paged && !notice) return null
  return (
    <>
      {notice ? (
        notice.alert ? <ErrorBox>{notice.text}</ErrorBox> : <p className="hid-ehr-clinical-note" role="status">{notice.text}</p>
      ) : null}
      {paged ? (
        <Pager
          page={cursors.length}
          busy={loading}
          label={label}
          onPrevious={cursors.length >= 2 ? () => void load({ cursors: cursors.slice(0, -1), paging: true }) : undefined}
          onNext={next ? () => void load({ cursors: [...cursors, next], paging: true }) : undefined}
        />
      ) : null}
    </>
  )
}
