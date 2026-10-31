import { EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { staffApi, type Encounter, type OrderRouteKind } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { formatWhen, statusLabel } from '../parts/format'
import { Banner, ErrorBox, ListHeading, Loading } from '../parts/Notices'
import { Pager, RecordTable, SearchField, type RecordRow } from '../parts/RecordTable'
import { useWorkspaceHref } from '../parts/Workspace'
import {
  FIRST_PAGE, NO_COMPLAINT, NO_ENCOUNTERS, RESTARTED, TITLE, encounterTitle, encounterTypeLabel, readPage, useLatest, type Cursors,
} from './encounters'
import { orderPath, type OrderKind } from './orders'
import { TodaySections } from './TodaySections'

/**
 * The list page: the design's heading and table, or the chart's own state (no patient, access ended, emergency). An
 * order Home links to (today's `location.state.order`) opens that order's page instead.
 */
export function EncounterList() {
  const chart = useChart()
  const linked = useLinkedOrder(chart)
  if (linked) return <OpenLinkedOrder to={linked} />
  if (chart && chart.purpose === 'direct-care') return <Encounters chart={chart} />
  return (
    <>
      <ListHeading title={TITLE} />
      <ChartGate>{open => <Encounters chart={open} />}</ChartGate>
    </>
  )
}

/** Today's order kinds (the link's `kind`, staff/api OrderRouteKind) as this workspace's order pages name them. */
const LINKED_KINDS: Readonly<Record<OrderRouteKind, OrderKind>> = { prescription: 'pharmacy', lab_request: 'laboratory' }

function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !value.includes('/')
}

/**
 * The order Home's "Orders accepted for the wrong person" links to: today's `location.state.order` ({ patientId,
 * encounterId, kind: 'lab_request' | 'prescription', orderId }, staff/routes/Clinical.tsx linkedOrder). Its page's
 * address, only for direct care and the patient open now, as today; any other link is ignored.
 */
function useLinkedOrder(chart: Chart | null): string | null {
  const state: unknown = useLocation().state
  const href = useWorkspaceHref()
  if (!chart || chart.purpose !== 'direct-care') return null
  const value = state && typeof state === 'object' ? (state as { order?: unknown }).order : null
  if (!value || typeof value !== 'object') return null
  const { patientId, encounterId, kind, orderId } = value as Record<string, unknown>
  if (patientId !== chart.patientId || !isRecordId(encounterId) || !isRecordId(orderId)) return null
  if (kind !== 'lab_request' && kind !== 'prescription') return null
  return href(orderPath(encounterId, LINKED_KINDS[kind], orderId))
}

/** Opens the linked order in place of the list (replace: the link's state is not kept, and the address holds record ids only). */
function OpenLinkedOrder({ to }: { to: string }) {
  const navigate = useNavigate()
  useEffect(() => { navigate(to, { replace: true }) }, [navigate, to])
  return <ListHeading title={TITLE} />
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
        // The design's order: "Create record" first, then "Refresh encounters" (the heading draws its secondary actions first).
        secondaryActions={(
          <>
            {canCreate ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : null}
            <EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void load({ fresh: true }) }}>Refresh encounters</EhrButton>
          </>
        )}
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
      {/* Today's chart sections, as on today's Clinical page: shown with or without an encounter here (direct care only). */}
      <TodaySections chart={chart} />
    </>
  )
}
