import { EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { staffApi, type Encounter, type OrderRouteKind } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { formatWhen, statusLabel } from '../parts/format'
import { ErrorBox, ListHeading, Loading } from '../parts/Notices'
import { Pager, RecordTable, SearchField, type RecordRow } from '../parts/RecordTable'
import { useWorkspaceHref } from '../parts/Workspace'
import {
  FIRST_PAGE, NEW_TITLE, NO_COMPLAINT, NO_ENCOUNTERS, RESTARTED, TITLE, encounterTitle, encounterTypeLabel, readPage, useLatest, type Cursors,
} from './encounters'
import { orderPath, type OrderKind } from './orders'
import { TodaySections } from './TodaySections'

/**
 * The list page: the design's heading and table, or the chart's own state (no patient, access ended, emergency). An
 * order Home links to (today's `location.state.order`) opens that order's page instead. Under emergency access this
 * address is the read-only emergency summary, as today's /provider/clinical is (staff/routes/Clinical.tsx:1376-1378):
 * a role that may open it is taken there; one that may not keeps the chart's emergency notice.
 */
export function EncounterList() {
  const chart = useChart()
  const href = useWorkspaceHref()
  const linked = useLinkedOrder(chart)
  if (linked) return <OpenLinkedOrder to={linked} />
  if (chart && chart.purpose === 'emergency' && chart.can('identity.break-glass.write')) return <Navigate replace to={href.to('emergency', 'summary')} />
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <Encounters chart={open} />}</ChartGate>
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
  // Only a role that may read that kind of order is sent to its page.
  if (!chart.can(kind === 'lab_request' ? 'ehr.lab-request.read' : 'ehr.prescription.read')) return null
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

  const load = useCallback(async (request: { cursors: Cursors; fresh?: boolean; paging?: boolean }) => {
    const run = ++sequence.current
    setLoading(true)
    if (request.paging) setNotice(null)
    try {
      await verify.current()
      const result = await readPage((cursor, fresh) => staffApi.encounters(facilityId, patientId, { cursor, fresh }), request.cursors, request.fresh ?? false)
      if (run !== sequence.current) return
      setRows(result.page.items.filter(item => item.patientId === patientId && item.facilityId === facilityId))
      setPosition({ cursors: result.cursors, next: result.page.nextCursor ?? null })
      setNotice(result.restarted ? { text: RESTARTED, alert: false } : null)
      setError('')
    } catch (caught) {
      if (run !== sequence.current) return
      if (request.paging) setNotice({ text: `The page could not be loaded. ${refusalText(caught, '')}`.trim(), alert: true })
      else setError(refusalText(caught, 'Consultations could not be loaded.'))
    } finally {
      if (run === sequence.current) setLoading(false)
    }
  }, [facilityId, patientId, verify])

  useEffect(() => {
    void load({ cursors: FIRST_PAGE })
    return () => { sequence.current += 1 }
  }, [load])

  const tableRows = useMemo<RecordRow[]>(() => (rows ?? []).map(encounter => ({
    id: encounter.id,
    name: encounterTitle(encounter),
    // One patient's chart: the row says what the visit was for, not the patient's name again.
    context: encounter.chiefComplaint || NO_COMPLAINT,
    contextSub: encounterTypeLabel(encounter.encounterType),
    status: encounter.status,
    updated: encounter.startedAt,
    details: [
      { label: 'Type of visit', value: encounterTypeLabel(encounter.encounterType) },
      { label: 'Complaint', value: encounter.chiefComplaint || NO_COMPLAINT },
      { label: 'Status', value: statusLabel(encounter.status) },
      { label: 'Started', value: formatWhen(encounter.startedAt) },
    ],
  })), [rows])

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
        // One primary: "New consultation" (only when changes are allowed; read-only offers no dead end). Refresh is secondary.
        primaryAction={canCreate ? <EhrButton onClick={() => navigate(href('new'))}>{NEW_TITLE}</EhrButton> : undefined}
        secondaryActions={<EhrButton variant="secondary" busy={loading} onClick={() => { if (!loading) void load({ cursors, fresh: true }) }}>Refresh</EhrButton>}
      />
      <EhrCard>
        <SearchField label={`Search ${TITLE}`} value={search} onChange={setSearch} />
        {notice ? (
          notice.alert ? <ErrorBox>{notice.text}</ErrorBox> : <p className="hid-ehr-clinical-note" role="status">{notice.text}</p>
        ) : null}
        {paged ? (
          <Pager
            label="Encounter pages"
            page={cursors.length}
            busy={loading}
            onPrevious={cursors.length >= 2 ? () => void load({ cursors: cursors.slice(0, -1), paging: true }) : undefined}
            onNext={next ? () => void load({ cursors: [...cursors, next], paging: true }) : undefined}
          />
        ) : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {rows === null ? (loading ? <Loading label="Loading consultations…" /> : null) : (
          <RecordTable
            caption="Consultations"
            contextHeader="Complaint"
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
