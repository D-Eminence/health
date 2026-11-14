import { useRef, useState } from 'react'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, type EhrDataTableColumn } from '@hid/ui/ehr'
import { DeptPage } from '../DeptPage'
import { DeptFacts, DeptLinkButton, DeptRecordName } from '../DeptRecord'
import { DeptSearch } from '../DeptSearch'
import { dateText } from '../format'
import { SampleBanner } from '../SampleBanner'
import { matchesSampleSearch, recordName, samplePatient, valueFacts, type SampleDefinition, type SampleRecord } from './model'

export interface SampleListProps {
  readonly definition: SampleDefinition
  readonly records: readonly SampleRecord[]
  readonly search: string
  readonly onSearch: (value: string) => void
  readonly onClearSearch: () => void
  /** Opens the create form; left out where the viewer may not create, as the design leaves out "Create record". */
  readonly onCreate?: () => void
  readonly onOpen: (id: string) => void
  /** The id of a record's name in the list, where focus returns from its detail. */
  readonly nameId: (id: string) => string
  readonly createId: string
}

/**
 * The design's list: "Create record" by the title (for a viewer who may create) and the sample notice under it;
 * "Search <title>" over the rows on the page; each row's name (and the start of its id), its patient or the record
 * itself, its status, when it last changed, and "Quick view" (a drawer with the notice first, then its values) and
 * "Open". A sample hands out no file: the design's "Export filtered records" is left out.
 */
export function SampleList({ definition, records, search, onSearch, onClearSearch, onCreate, onOpen, nameId, createId }: SampleListProps) {
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
    <DeptPage title={definition.title}
      primaryAction={onCreate ? <EhrButton id={createId} onClick={onCreate}>Create record</EhrButton> : undefined}>
      <SampleBanner />
      <EhrDrawer open={quick !== undefined} title="Record quick view" returnFocusRef={openerRef} onClose={() => setQuickId(null)}>
        <SampleBanner />
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
