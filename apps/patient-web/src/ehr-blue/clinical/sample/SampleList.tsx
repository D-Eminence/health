import { EhrCard } from '@hid/ui/ehr'
import { useState } from 'react'
import { ErrorBox } from '../parts/Notices'
import { Pager, RecordTable, SearchField, type RecordRow } from '../parts/RecordTable'
import { SampleBanner } from '../parts/SampleBanner'
import { useWorkspaceHref } from '../parts/Workspace'
import { useStandaloneSample } from './context'
import { contextName, displayItems, listedRecords, matchesSearch, recordName, sampleDefinition, useSampleState } from './store'

/** The design's list shows 50 records a page. */
export const PAGE_SIZE = 50

export const UNKNOWN_SAMPLE = 'This sample workspace does not exist.'

/**
 * A sample workspace's list card: "Search {title}", "Clear search", the pager over 50 records and the design's
 * five-column table with its quick view. Every record is fictional and in memory only.
 */
export function SampleList({ id }: { id: string }) {
  const definition = sampleDefinition(id)
  const href = useWorkspaceHref()
  const standalone = useStandaloneSample()
  const current = useSampleState()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  if (!definition) return <ErrorBox>{UNKNOWN_SAMPLE}</ErrorBox>

  const all = listedRecords(current, definition)
  const matching = all.filter(record => matchesSearch(current, record, query))
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const shown = Math.min(page, pages)
  const rows: RecordRow[] = matching.slice((shown - 1) * PAGE_SIZE, shown * PAGE_SIZE).map(record => ({
    id: record.id,
    name: recordName(record),
    context: contextName(current, record),
    status: record.status,
    updated: record.updatedAt,
    details: displayItems(current, record.data),
  }))

  return (
    <>
      {standalone ? <SampleBanner /> : null}
      <EhrCard>
        <SearchField label={`Search ${definition.title}`} value={query} onChange={value => { setQuery(value); setPage(1) }} />
        {matching.length > PAGE_SIZE ? (
          <Pager
            page={shown}
            total={pages}
            onPrevious={shown > 1 ? () => setPage(shown - 1) : undefined}
            onNext={shown < pages ? () => setPage(shown + 1) : undefined}
          />
        ) : null}
        <RecordTable
          caption={definition.title}
          rows={rows}
          hrefFor={row => href(row.id)}
          emptyMessage={all.length > 0 ? 'Change your search.' : 'Create the first record when you have the appropriate permission.'}
        />
      </EhrCard>
      {definition.listNote ? <p className="hid-ehr-clinical-list-note">{definition.listNote}</p> : null}
    </>
  )
}
