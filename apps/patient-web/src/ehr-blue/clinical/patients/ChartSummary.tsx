import { ClipboardList, RotateCcw, Stethoscope } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LoadingRows } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader, IconChip, ListRow } from '../../../kasuwa/ui'
import { consultationLabel, priorityLabel, routeLabel, visitClassLabel } from '../../../plainLabels'
import { staffApi } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { orderPath } from '../consult/orders'
import { fromPatient } from '../parts/cameFrom'
import type { Chart } from '../parts/chart'
import { decimalText, formatDate, formatWhen, statusWords } from '../parts/format'
import { useWorkspaceHref } from '../parts/Workspace'
import { recordKey } from '../triage/records'
import { VITAL_FIELDS } from '../triage/vitals'
import {
  PROGRESS_UNKNOWN, parseChartSummary, type ChartList, type ChartSummary as Summary, type LabProgress, type LatestVital,
  type PharmacyProgress, type Shown, type Visit,
} from './chartSummary'

/** Where the chart summary's own Refresh could not read it again: the summary shown stays, and this says so under it. */
export const REFRESH_FAILED = 'Couldn’t refresh the chart summary'

type Read =
  | { readonly status: 'loading' }
  /** The call failed as a whole (an EHR before EHR-C4 answers 404; or 5xx, or an answer that is not a summary). */
  | { readonly status: 'failed' }
  | { readonly status: 'shown'; readonly summary: Summary }

/**
 * The patient's chart in one call (EHR-C4, GET chart-summary): active problems, current medicines, latest vitals, open
 * lab requests, recent lab results and this facility's visits, each with its link to the visit or order it belongs to.
 * A section the role may not see, or one that could not be loaded, says so in the contract's words where it would be.
 * Allergies are the Allergies card's, on this page with their own read (adding one and marking one entered in error
 * need what that read gives), so they are not said twice: only when the summary leaves them out does its sentence show.
 *
 * Should the call fail as a whole (an EHR before EHR-C4 answers 404; a 5xx; an answer this page can't read), `fallback`
 * is shown instead: today's separate reads, so nothing is lost. The first read is the summary alone: the EHR checks the
 * patient's consent on it, and a refusal falls back to today's list, whose own access re-check closes the patient when
 * access ended. Refresh re-checks first, as today's Refresh does.
 */
export function ChartSummary({ chart, canStart, opens, fallback }: {
  chart: Chart
  canStart: boolean
  /** Whether this site opens a workspace's pages: a row links only to a page that opens here. */
  opens: (workspace: string) => boolean
  fallback: ReactNode
}) {
  const [read, setRead] = useState<Read>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const { facilityId, patientId, verify } = chart
  // Read once per patient: the re-check itself may be a new function on each render.
  const recheck = useRef(verify)
  useLayoutEffect(() => { recheck.current = verify })
  // Each read is this patient's latest: an answer for an earlier read (or patient) is never shown.
  const reads = useRef(0)

  useEffect(() => {
    const current = ++reads.current
    const controller = new AbortController()
    setRead({ status: 'loading' })
    setBusy(false)
    setProblem('')
    // Run as a promise, so a client without the call (or one that throws at once) is this card's fallback, never the page's.
    void Promise.resolve().then(() => staffApi.chartSummary(facilityId, patientId, controller.signal)).then(
      answer => {
        if (current !== reads.current) return
        try { setRead({ status: 'shown', summary: parseChartSummary(answer, patientId) }) }
        catch { setRead({ status: 'failed' }) }
      },
      () => { if (current === reads.current) setRead({ status: 'failed' }) },
    )
    return () => { reads.current += 1; controller.abort() }
  }, [facilityId, patientId])

  /** Today's Refresh: the access re-check, then the summary afresh; the summary shown stays while it loads. */
  async function refresh() {
    if (busy) return
    const current = ++reads.current
    setBusy(true)
    setProblem('')
    try {
      await recheck.current()
      const summary = parseChartSummary(await staffApi.chartSummary(facilityId, patientId), patientId)
      if (current === reads.current) setRead({ status: 'shown', summary })
    } catch (caught) {
      if (current === reads.current) setProblem(refusalText(caught, 'Please try again.'))
    } finally {
      if (current === reads.current) setBusy(false)
    }
  }

  if (read.status === 'failed') return <>{fallback}</>
  return <Card>
    <CardHeader as="h2" title="Chart summary" description="Only what your role may see" icon={ClipboardList}
      actions={read.status === 'shown' ? <Button size="sm" icon={RotateCcw} aria-disabled={busy || undefined} aria-busy={busy || undefined}
        onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh'}</Button> : undefined} />
    {read.status === 'loading' ? <LoadingRows rows={3} label="Loading the chart summary" />
      : <SummarySections summary={read.summary} canStart={canStart}
        consultOpen={opens('consult') && chart.can('ehr.encounter.read')} vitalsOpen={opens('triage')} />}
    {problem ? <div className="border-t border-line px-5 py-3"><Alert intent="error" title={REFRESH_FAILED}>{problem}</Alert></div> : null}
  </Card>
}

function SummarySections({ summary, canStart, consultOpen, vitalsOpen }: {
  summary: Summary
  canStart: boolean
  /**
   * Whether Consultation opens here for this role (it needs ehr.encounter.read). The summary is shown to a role holding
   * any one of its reads (EHR-C4), so a lab or diagnosis-only role sees these rows without a link, as TriageRecord does.
   */
  consultOpen: boolean
  vitalsOpen: boolean
}) {
  const href = useWorkspaceHref()
  const back = fromPatient(href('open'))
  const { limits } = summary
  /** A row's link into Consultation, or none where Consultation does not open for this role. */
  const consult = (path: string) => consultOpen ? { to: href.to('consult', path), state: back } : {}
  return <div className="divide-y divide-line">
    <Section title="Active problems" section={summary.problems} empty="No active problems recorded here."
      more={list => newest(list, limits.problems, consultOpen ? 'Open a visit to see all its diagnoses.' : null)}>
      {list => list.items.map(item => <li key={item.id}>
        <ListRow {...consult(item.encounterId)} title={item.display}
          subtitle={[statusWords(item.clinicalStatus), item.createdAt ? `Recorded ${formatDate(item.createdAt)}` : ''].filter(Boolean).join(' · ')} />
      </li>)}
    </Section>
    <Section title="Current medicines" section={summary.medications} note={summary.progressNotes.medications} empty="No current medicines prescribed here."
      more={list => newest(list, limits.medications, consultOpen ? 'Open a visit to see all its prescriptions.' : null)}>
      {list => list.items.map(item => <li key={item.id}>
        <ListRow {...consult(orderPath(item.encounterId, 'pharmacy', item.id))} title={item.medicationDisplay}
          subtitle={[item.doseQuantity ? [decimalText(item.doseQuantity), item.doseUnit].filter(Boolean).join(' ') : '', routeLabel(item.routeCode) ?? '', item.frequency ?? '']
            .filter(Boolean).join(' · ') || undefined}
          trailing={<Trailing status={item.status} progress={pharmacyWords(item.ownProgress)} />} />
      </li>)}
    </Section>
    {/* Shown by the Allergies card above; only a section left out is said here, where it would be. */}
    {summary.allergies.shown ? null : <Section title="Allergies" section={summary.allergies} empty="">{() => null}</Section>}
    <Section title="Latest vitals" section={summary.latestVitals} empty="No vitals recorded here yet.">
      {rows => rows.map(row => <li key={row.measure}>
        <ListRow to={vitalsOpen ? href.to('triage', recordKey(row.encounterId, row.vitalId)) : undefined} state={vitalsOpen ? back : undefined}
          title={`${vitalLabel(row)}: ${vitalValue(row)}`}
          subtitle={[formatWhen(row.recordedAt), row.corrected ? 'Corrected' : ''].filter(Boolean).join(' · ') || undefined} />
      </li>)}
    </Section>
    <Section title="Open lab requests" section={summary.openLabRequests} note={summary.progressNotes.openLabRequests} empty="No open lab requests here."
      more={list => newest(list, limits.openLabRequests, consultOpen ? 'Open a visit to see all its lab requests.' : null)}>
      {list => list.items.map(item => <li key={item.id}>
        <ListRow {...consult(orderPath(item.encounterId, 'laboratory', item.id))} title={item.testDisplay}
          subtitle={item.priority && item.priority !== 'routine' ? priorityLabel(item.priority) ?? undefined : undefined}
          trailing={<Trailing status={item.status} progress={labWords(item.ownProgress)} />} />
      </li>)}
    </Section>
    <Section title="Recent lab results" section={summary.recentResults} empty="No released lab results yet."
      more={results => <>
        {results.more ? <p className="m-0">{`Showing the newest ${limits.recentResults ?? results.items.length}. Each lab request lists its own results.`}</p> : null}
        {/* EHR-C4: Lab had more results than the summary reads, so the newest may not be among these. */}
        {results.complete ? null : <p className="m-0">This patient has more lab results than the summary can read, so newer results may not be shown here.</p>}
      </>}>
      {results => results.items.map(item => <li key={item.id}>
        <ListRow title={item.title} subtitle={item.recordedAt ? `Released ${formatWhen(item.recordedAt)}` : undefined} />
      </li>)}
    </Section>
    <Section title="Visits here" section={summary.recentVisits} empty={`No visits at this facility yet.${canStart ? ' Start a consultation to begin one.' : ''}`}
      more={list => list.more || consultOpen ? <>
        {list.more ? <p className="m-0">{`Showing the newest ${limits.recentVisits ?? list.items.length}.`}</p> : null}
        {/* The visits' full list, as before: Consultation lists them all, page by page (where it opens for this role). */}
        {consultOpen ? <p className="m-0"><Link className="font-medium text-brand-ink underline underline-offset-2" to={href.to('consult')}>See all visits</Link></p> : null}
      </> : null}>
      {list => list.items.map(item => <li key={item.id}>
        <ListRow {...consult(item.id)} leading={<IconChip size="sm" icon={Stethoscope} />} title={consultationLabel(item)}
          subtitle={visitSubtitle(item)}
          trailing={<Badge size="sm" tone={item.status === 'in_progress' || item.status === 'open' ? 'brand' : 'neutral'}>{statusWords(item.status)}</Badge>} />
      </li>)}
    </Section>
  </div>
}

/**
 * One section: its rows, or, where the summary left it out, the contract's sentence in its place. `note` is a sentence
 * said above the rows (ORD-3 progress that could not be read); `more` what is said under them.
 */
function Section<Value>({ title, section, empty, note, more, children }: {
  title: string
  section: Shown<Value>
  empty: string
  note?: string | null
  more?: (value: Value) => ReactNode
  children: (value: Value) => ReactNode
}) {
  const rows = section.shown ? children(section.value) : null
  const count = Array.isArray(rows) ? rows.length : 0
  const after = section.shown && count > 0 && more ? more(section.value) : null
  return <section aria-label={title} className="py-1">
    <h3 className="m-0 px-5 pt-3 text-[13px] font-semibold text-ink">{title}</h3>
    {!section.shown ? <p className="m-0 px-5 py-3 text-[13px] text-ink-3">{section.message}</p>
      : <>
        {note ? <p className="m-0 px-5 pt-2 text-[13px] text-ink-3">{note}</p> : null}
        {count === 0 ? <p className="m-0 px-5 py-3 text-[13px] text-ink-3">{empty}</p>
          : <ul className="m-0 list-none divide-y divide-line p-0">{rows}</ul>}
        {after ? <div className="flex flex-col gap-1 px-5 pb-3 text-[13px] text-ink-3">{after}</div> : null}
      </>}
  </section>
}

/**
 * Under a list cut at the summary's limit: how many are shown, and where the rest are (none where Consultation does not
 * open for this role). Nothing when none were cut.
 */
function newest<Item>(list: ChartList<Item>, limit: number | undefined, rest: string | null): ReactNode {
  return list.more ? <p className="m-0">{[`Showing the newest ${limit ?? list.items.length}.`, rest].filter(Boolean).join(' ')}</p> : null
}

/** An order's status, then where this facility's own pharmacy or laboratory is with it (ORD-3), when there is something to say. */
function Trailing({ status, progress }: { status: string; progress: string | null }) {
  return <>
    {progress ? <span className="text-[12px] text-ink-3">{progress}</span> : null}
    <Badge size="sm" tone={status === 'on_hold' ? 'warn' : 'neutral'}>{statusWords(status)}</Badge>
  </>
}

/** "Dispensed 19 Nov 2026, 11:05" (ORD-3's screen words); nothing before the pharmacy has it. */
export function pharmacyWords(progress: PharmacyProgress | null): string | null {
  if (!progress) return null
  switch (progress.status) {
    case 'received': return withTime('Received', progress.receivedAt)
    case 'dispensed': return withTime('Dispensed', progress.dispensedAt)
    case 'dispensing_reversed': return withTime('Dispensing reversed', progress.reversedAt)
    // Answers the pharmacy gave (live EHR, ORD-3 with 0133), so never "not available"; they carry no time of their own.
    case 'withdrawn': return 'Withdrawn from the pharmacy'
    case 'sent_elsewhere': return 'Sent to another pharmacy'
    case 'unknown': return PROGRESS_UNKNOWN
    default: return null
  }
}

/** "Sample taken 19 Nov 2026, 09:30", "Results ready …" (ORD-3's screen words); nothing before the laboratory has it. */
export function labWords(progress: LabProgress | null): string | null {
  if (!progress) return null
  switch (progress.status) {
    case 'received': return withTime('Received', progress.receivedAt)
    case 'sample_collected': return withTime('Sample taken', progress.collectedAt)
    case 'some_results_ready': return withTime('Some results ready', progress.lastResultAt)
    case 'results_ready': return withTime('Results ready', progress.lastResultAt)
    case 'unknown': return PROGRESS_UNKNOWN
    default: return null
  }
}

function withTime(words: string, at: string | null): string {
  const when = formatWhen(at)
  return when ? `${words} ${when}` : words
}

function vitalLabel(row: LatestVital): string {
  if (row.measure === 'bloodPressure') return 'Blood pressure'
  return VITAL_FIELDS.find(field => field.name === row.measure)?.label ?? 'Vital'
}

function vitalValue(row: LatestVital): string {
  if (typeof row.value !== 'number') return `${row.value.systolicMmhg}/${row.value.diastolicMmhg} mmHg`
  const unit = VITAL_FIELDS.find(field => field.name === row.measure)?.unit
  return unit ? `${row.value} ${unit}` : String(row.value)
}

/** A row's second line: the kind of visit and, when one was written, the complaint, as the visits list shows them. */
function visitSubtitle(item: Visit): string {
  return item.chiefComplaint ? `${visitClassLabel(item.encounterType)} · ${item.chiefComplaint}` : visitClassLabel(item.encounterType)
}
