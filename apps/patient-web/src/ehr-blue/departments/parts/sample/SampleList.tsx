import { useRef, useState, type ReactNode } from 'react'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, type EhrDataTableColumn } from '@hid/ui/ehr'
import { DeptPage } from '../DeptPage'
import { DeptFacts, DeptLinkButton, DeptRecordName } from '../DeptRecord'
import { DeptSearch } from '../DeptSearch'
import { dateText } from '../format'
import { matchesSampleSearch, recordName, samplePatient, valueFacts, type SampleDefinition, type SampleRecord } from './model'

export interface SampleListProps {
  readonly definition: SampleDefinition
  readonly records: readonly SampleRecord[]
  readonly search: string
  readonly onSearch: (value: string) => void
  readonly onClearSearch: () => void
  readonly above: ReactNode
  readonly onCreate: () => void
  readonly onExport: (records: readonly SampleRecord[]) => void
  readonly onOpen: (id: string) => void
  /** The id of a record's name in the list, where focus returns from its detail. */
  readonly nameId: (id: string) => string
  readonly createId: string
}

/**
 * The design's list: "Create record" and "Export filtered records" by the title; "Search <title>" over the rows on
 * the page; each row's name (and the start of its id), its patient or the record itself, its status, when it last
 * changed, and "Quick view" (a drawer with its values) and "Open".
 */
export function SampleList({ definition, records, search, onSearch, onClearSearch, above, onCreate, onExport, onOpen, nameId, createId }: SampleListProps) {
  const [quickId, setQuickId] = useState<string | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const filtered = records.filter(record => matchesSampleSearch(record, search))
  const quick = quickId ? records.find(record => record.id === quickId) : undefined

  const columns: EhrDataTableColumn<SampleRecord>[] = [
    {
      id: 'record',
      header: 'Record',
      cell: record => <DeptRecordName id={nameId(record.id)} name={recordName(record)} reference={record.id.slice(0, 8)} onOpen={() => onOpen(record.id)} />,
    },
    { id: 'context', header: 'Patient / context', cell: record => samplePatient(record.patientId)?.name ?? recordName(record) },
    { id: 'status', header: 'Status', cell: record => <EhrBadge>{record.status}</EhrBadge> },
    { id: 'updated', header: 'Updated', cell: record => dateText(record.updatedAt) },
    {
      id: 'actions',
      header: <span className="hid-ehr-sr-only">Actions</span>,
      cell: record => (
        <div className="hid-ehr-dept-table-actions">
          <EhrButton variant="secondary" aria-describedby={nameId(record.id)}
            onClick={event => { openerRef.current = event.currentTarget; setQuickId(record.id) }}>Quick view</EhrButton>
          <DeptLinkButton describedBy={nameId(record.id)} onClick={() => onOpen(record.id)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
        </div>
      ),
    },
  ]

  return (
    <DeptPage title={definition.title} above={above} secondaryActions={<>
      <EhrButton id={createId} onClick={onCreate}>Create record</EhrButton>
      <EhrButton variant="secondary" onClick={() => onExport(filtered)}>Export filtered records</EhrButton>
    </>}>
      <EhrDrawer open={quick !== undefined} title="Record quick view" returnFocusRef={openerRef} onClose={() => setQuickId(null)}>
        {quick ? (
          <div className="hid-ehr-dept-sample-quick">
            <h3>{recordName(quick)}</h3>
            <p>Last updated {dateText(quick.updatedAt)}</p>
            <DeptFacts facts={valueFacts(quick.values)} />
            <EhrButton onClick={() => { setQuickId(null); onOpen(quick.id) }}>Open full record</EhrButton>
          </div>
        ) : null}
      </EhrDrawer>
      <DeptSearch label={`Search ${definition.title}`} value={search} onChange={onSearch}>
        {search ? <EhrButton variant="secondary" className="hid-ehr-dept-sample-clear" onClick={onClearSearch}>Clear search</EhrButton> : null}
        <EhrDataTable caption={`${definition.title} records`} captionHidden columns={columns} rows={filtered} rowKey={record => record.id}
          emptyTitle="No matching records"
          emptyMessage={records.length ? 'Change your search.' : 'Create the first record when you have the appropriate permission.'} />
      </DeptSearch>
    </DeptPage>
  )
}
