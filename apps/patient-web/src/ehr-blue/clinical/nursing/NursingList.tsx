import { EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { formatWhen, shortId } from '../parts/format'
import { ListHeading } from '../parts/Notices'
import type { RecordRow } from '../parts/RecordTable'
import { useWorkspaceHref } from '../parts/Workspace'
import { ListCard } from '../triage/ListCard'
import { NO_RECORD_ACCESS, field, recordKey, usePatientRecords } from '../triage/records'
import { TITLE, isObservation, noteStatus } from './observations'

/** The list page: the design's heading and table, or the chart's own state (no patient, access ended, emergency). */
export function NursingList() {
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <NursingRecords chart={open} />}</ChartGate>
  return (
    <>
      <ListHeading title={TITLE} />
      <ChartGate>{open => <NursingRecords chart={open} />}</ChartGate>
    </>
  )
}

function NursingRecords({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const reads = chart.can('ehr.note.read')
  const canCreate = reads && chart.canWrite && chart.can('ehr.note.write')
  return (
    <>
      <EhrPageHeading title={TITLE} primaryAction={canCreate ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : undefined} />
      {reads ? <ObservationsTable chart={chart} /> : <EhrCard><p>{NO_RECORD_ACCESS}</p></EhrCard>}
    </>
  )
}

/**
 * The open patient's nursing observations at this facility (today's clinical notes of type "Nursing observation"),
 * from every encounter on the encounter page shown, in the design's record table. A note's content is read only when
 * it is opened, as today.
 */
function ObservationsTable({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const list = usePatientRecords(chart, 'clinical-notes', isObservation)
  const [search, setSearch] = useState('')

  const rows: RecordRow[] = (list.records ?? []).map(({ encounter, record }) => ({
    id: recordKey(encounter.id, record.id),
    name: shortId(record.id),
    reference: shortId(record.id),
    context: field(record, 'title'),
    status: noteStatus(record),
    updated: field(record, 'updatedAt') || record.createdAt,
    details: [
      { label: 'Visit', value: shortId(encounter.id) },
      { label: 'Category', value: field(record, 'title') },
      { label: 'Recorded', value: formatWhen(record.createdAt) },
    ],
  }))

  return <ListCard title={TITLE} list={list} rows={rows} search={search} onSearch={setSearch} hrefFor={row => href(row.id)} contextHeader="Category" />
}
