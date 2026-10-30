import { EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { formatWhen, statusLabel } from '../parts/format'
import { Banner, ErrorBox, ListHeading, Loading } from '../parts/Notices'
import { Pager, RecordTable, SearchField, type RecordRow } from '../parts/RecordTable'
import { useWorkspaceHref } from '../parts/Workspace'
import {
  FIRST_PAGE, NO_COMPLAINT, NO_ENCOUNTERS, RESTARTED, TITLE, encounterTitle, encounterTypeLabel, readPage, useLatest, type Cursors,
} from './encounters'

/** The list page: the design's heading and table, or the chart's own state (no patient, access ended, emergency). */
export function EncounterList() {
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <Encounters chart={chart} />
  return (
    <>
      <ListHeading title={TITLE} />
      <ChartGate>{open => <Encounters chart={open} />}</ChartGate>
    </>
  )
}

type Notice = { readonly text: string; readonly alert: boolean }

/**
 * The open patient's encounters at this facility, newest first, 50 to a page with no total (today's list), drawn as
 * the design's record table. Every read re-checks access first, as today.
 */
function Encounters({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const { facilityId, patientId } = chart
  const verify = useLatest(chart.verify)
  const [rows, setRows] = useState<readonly Encounter[] | null>(null)
  const [position, setPosition] = useState<{ cursors: Cursors; next: string | null }>({ cursors: FIRST_PAGE, next: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [search, setSearch] = useState('')
  const sequence = useRef(0)
  const shown = useLatest(position.cursors)

  const load = useCallback(async (request: { cursors?: Cursors; fresh?: boolean; paging?: boolean } = {}) => {
    const run = ++sequence.current
    setLoading(true)
    if (request.paging) setNotice(null)
    try {
      await verify.current()
      const result = await readPage((cursor, fresh) => staffApi.encounters(facilityId, patientId, { cursor, fresh }), request.cursors ?? shown.current, request.fresh ?? false)
      if (run !== sequence.current) return
      setRows(result.page.items.filter(item => item.patientId === patientId && item.facilityId === facilityId))
      setPosition({ cursors: result.cursors, next: result.page.nextCursor ?? null })
      setNotice(result.restarted ? { text: RESTARTED, alert: false } : null)
      setError('')
    } catch (caught) {
      if (run !== sequence.current) return
      if (request.paging) setNotice({ text: `The page could not be loaded. ${refusalText(caught, '')}`.trim(), alert: true })
      else setError(refusalText(caught, 'Encounters could not be loaded.'))
    } finally {
      if (run === sequence.current) setLoading(false)
    }
  }, [facilityId, patientId, shown, verify])

  useEffect(() => {
    void load({ cursors: FIRST_PAGE })
    return () => { sequence.current += 1 }
  }, [load])

  const tableRows = useMemo<RecordRow[]>(() => (rows ?? []).map(encounter => ({
    id: encounter.id,
    name: encounterTitle(encounter),
    context: chart.facts.name,
    status: encounter.status,
    updated: encounter.startedAt,
    details: [
      { label: 'Encounter type', value: encounterTypeLabel(encounter.encounterType) },
      { label: 'Complaint', value: encounter.chiefComplaint || NO_COMPLAINT },
      { label: 'Status', value: statusLabel(encounter.status) },
      { label: 'Started', value: formatWhen(encounter.startedAt) },
    ],
  })), [chart.facts.name, rows])

  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase()
    if (!words) return tableRows
    return tableRows.filter(row => [row.name, row.id, row.context, statusLabel(row.status), ...row.details.map(detail => String(detail.value))]
      .join(' ').toLowerCase().includes(words))
  }, [search, tableRows])

  const canCreate = chart.canWrite && chart.can('ehr.encounter.write')
  const { cursors, next } = position
  const paged = cursors.length >= 2 || next !== null

  return (
    <>
      <EhrPageHeading
        title={TITLE}
        secondaryActions={<EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void load({ fresh: true }) }}>Refresh encounters</EhrButton>}
        primaryAction={canCreate ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : undefined}
      />
      {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : null}
      <EhrCard>
        <SearchField label={`Search ${TITLE}`} value={search} onChange={setSearch} />
        {notice ? (
          notice.alert ? <ErrorBox>{notice.text}</ErrorBox> : <p className="hid-ehr-clinical-note" role="status">{notice.text}</p>
        ) : null}
        {paged ? (
          <Pager
            page={cursors.length}
            busy={loading}
            onPrevious={cursors.length >= 2 ? () => void load({ cursors: cursors.slice(0, -1), paging: true }) : undefined}
            onNext={next ? () => void load({ cursors: [...cursors, next], paging: true }) : undefined}
          />
        ) : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {rows === null ? (loading ? <Loading label="Loading encounters…" /> : null) : (
          <RecordTable
            caption="Encounters"
            rows={filtered}
            hrefFor={row => href(row.id)}
            emptyMessage={rows.length === 0 ? NO_ENCOUNTERS : 'Change your search.'}
          />
        )}
      </EhrCard>
    </>
  )
}
