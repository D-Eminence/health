import { EhrCard } from '@hid/ui/ehr'
import { useMemo } from 'react'
import { statusWords } from '../parts/format'
import { ErrorBox, Loading } from '../parts/Notices'
import { Pager, RecordTable, SearchField, type RecordRow } from '../parts/RecordTable'
import { CHANGE_SEARCH, FIRST_RECORD, NEWEST_ONLY, NO_ENCOUNTERS, type PatientRecords } from './records'

/** The design's list card: search, today's paging notices and pager, the table and its empty states. */
export function ListCard({ list, rows, search, onSearch, hrefFor, title, pending = false, contextHeader }: {
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
}) {
  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase()
    if (!words) return rows
    return rows.filter(row => [row.name, row.id, row.context, statusWords(row.status), row.statusNote ?? '', ...row.details.map(detail => typeof detail.value === 'string' ? detail.value : '')]
      .join(' ').toLowerCase().includes(words))
  }, [rows, search])
  const { cursors, next, loading, load } = list
  const paged = cursors.length >= 2 || next !== null

  return (
    <EhrCard>
      <SearchField label={`Search ${title}`} value={search} onChange={onSearch} />
      {list.notice ? (
        list.notice.alert ? <ErrorBox>{list.notice.text}</ErrorBox> : <p className="hid-ehr-clinical-note" role="status">{list.notice.text}</p>
      ) : null}
      {paged ? (
        <Pager
          page={cursors.length}
          busy={loading}
          onPrevious={cursors.length >= 2 ? () => void load({ cursors: cursors.slice(0, -1), paging: true }) : undefined}
          onNext={next ? () => void load({ cursors: [...cursors, next], paging: true }) : undefined}
        />
      ) : null}
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      {list.recordError ? <ErrorBox>{list.recordError}</ErrorBox> : null}
      {list.truncated ? <p className="hid-ehr-clinical-note">{NEWEST_ONLY}</p> : null}
      {list.records === null || pending ? (loading || pending ? <Loading label="Loading records…" /> : null) : (
        <RecordTable
          caption={title}
          rows={filtered}
          hrefFor={hrefFor}
          contextHeader={contextHeader}
          emptyMessage={rows.length > 0 ? CHANGE_SEARCH : list.encounters?.length === 0 ? NO_ENCOUNTERS : FIRST_RECORD}
        />
      )}
    </EhrCard>
  )
}
