import { EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { shortId } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { ListHeading } from '../parts/Notices'
import type { RecordRow } from '../parts/RecordTable'
import { useWorkspaceHref } from '../parts/Workspace'
import { ListCard } from './ListCard'
import { NO_COMPLAINT, NO_RECORD_ACCESS, recordKey, recordedAt, usePatientRecords } from './records'
import {
  CORRECTION_UNREAD, LOADING_CORRECTION, RETRACTED_TEXT, TITLE, correctionNumber, currentValues, isRetracted, measurementItems, useCorrections,
  vitalStatus, vitalSummary, type VitalValues,
} from './vitals'

/** The list page: the design's heading and table, or the chart's own state (no patient, access ended, emergency). */
export function TriageList() {
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <TriageRecords chart={open} />}</ChartGate>
  return (
    <>
      <ListHeading title={TITLE} />
      <ChartGate>{open => <TriageRecords chart={open} />}</ChartGate>
    </>
  )
}

function TriageRecords({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const reads = chart.can('ehr.vital.read')
  const canCreate = reads && chart.canWrite && chart.can('ehr.vital.write')
  return (
    <>
      <EhrPageHeading title={TITLE} primaryAction={canCreate ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : undefined} />
      {reads ? <VitalsTable chart={chart} /> : <EhrCard><p>{NO_RECORD_ACCESS}</p></EhrCard>}
    </>
  )
}

/**
 * The open patient's vitals at this facility, from every encounter on the encounter page shown, drawn as the design's
 * record table. A corrected vital shows its current correction's values, read as today's rows read them; one whose
 * correction cannot be read says so.
 */
function VitalsTable({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const list = usePatientRecords(chart, 'vitals')
  const corrections = useCorrections(chart, list.records?.map(item => ({ encounterId: item.encounter.id, vital: item.record })) ?? null)
  const [search, setSearch] = useState('')

  const rows: RecordRow[] = (list.records ?? []).map(({ encounter, record }) => {
    const read = corrections(record)
    const values = currentValues(record, read)
    const number = correctionNumber(record)
    const details: KeyValue[] = [
      { label: 'Visit', value: shortId(encounter.id) },
      { label: 'Complaint', value: encounter.chiefComplaint || NO_COMPLAINT },
    ]
    if (isRetracted(record)) details.push({ label: 'Entered in error', value: RETRACTED_TEXT })
    if (values) details.push(...measurementItems(values))
    else if (read.state === 'failed') details.push({ label: 'Correction', value: `${CORRECTION_UNREAD} ${read.message}` }, ...measurementItems(record))
    else details.push({ label: 'Correction', value: LOADING_CORRECTION })
    const readings = values ?? (read.state === 'failed' ? record : null)
    return {
      id: recordKey(encounter.id, record.id),
      name: shortId(record.id),
      reference: shortId(record.id),
      context: readings ? vitalSummary(readings) : '',
      summary: readings ? <Readings values={readings} /> : null,
      status: vitalStatus(record),
      statusNote: number > 0 ? `Corrected (correction ${number})` : undefined,
      updated: read.state === 'shown' ? read.latest.createdAt : recordedAt(record),
      details,
    }
  })

  // The table waits for the corrections, so a row (and its quick view) never shows values that are not current.
  const pending = (list.records ?? []).some(({ record }) => corrections(record).state === 'loading')
  // Today's empty Vitals tab (staff/routes/Clinical.tsx:1808).
  return <ListCard title={TITLE} list={list} rows={rows} pending={pending} search={search} onSearch={setSearch} hrefFor={row => href(row.id)} contextHeader="Readings"
    noRecords="No vitals for this encounter." />
}

/** A row's readings, each with its unit and, outside the adult range, its flag. */
function Readings({ values }: { values: VitalValues }) {
  return (
    <span className="hid-ehr-clinical-readings">
      {measurementItems(values).map(item => <span key={item.label}><span className="hid-ehr-clinical-cell-sub-inline">{item.label}</span> {item.value}</span>)}
    </span>
  )
}
