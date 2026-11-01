import { RotateCcw, Siren, UserSearch } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { FormPage, LoadingRows, PatientBanner, Value } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, type Tone } from '../../../kasuwa/ui'
import { usesNovuBackend } from '../../../backendContract'
import { staffApi, type EmergencyRecords, type EmergencySection } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { selfServiceReview } from '../../../staff/staffAccess'
import { ChartGate, type Chart } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { ACCESS_CLOSED, CLOSE_FAILED, CLOSE_GRANT, CLOSE_REASON, actionUnavailable } from './access'
import { ReleasedResults } from './ReleasedResults'

/** Today's emergency summary wording (Clinical.tsx EmergencySummary), word for word. */
export const SUMMARY_EYEBROW = 'Emergency summary'
export const SUMMARY_LEDE = 'View only. This facility’s finished visits, signed notes, diagnoses, prescriptions, lab tests and documents that your role may see. Every view is reviewed.'
export const VITALS_NOTICE = 'Vital signs aren’t shown here: a recorded value may have been corrected since.'
export const SUMMARY_FAILED = 'Please try again.'
export const LOADING_SUMMARY = 'Loading emergency summary'

// What EHR's emergency summary sends of each section at most (Clinical.tsx EMERGENCY_CAPS).
const EMERGENCY_CAPS = { encounters: 50, notes: 50, diagnoses: 100, prescriptions: 100, labRequests: 100, documents: 100 } as const

// Prescription and lab request statuses (EHR OrderStatus), what is current first, each with today's tone
// (Clinical.tsx:1006-1013 ORDER_STATUSES).
const ORDER_STATUSES: Readonly<Record<string, { readonly label: string; readonly tone: Tone; readonly rank: number }>> = {
  active: { label: 'Active', tone: 'success', rank: 0 },
  on_hold: { label: 'On hold', tone: 'warn', rank: 1 },
  draft: { label: 'Draft', tone: 'info', rank: 2 },
  completed: { label: 'Completed', tone: 'neutral', rank: 3 },
  cancelled: { label: 'Cancelled', tone: 'neutral', rank: 4 },
  entered_in_error: { label: 'Entered in error', tone: 'danger', rank: 5 },
}

function orderRank(status: string) { return ORDER_STATUSES[status]?.rank ?? 3 }

function diagnosisRank(item: EmergencyRecords['diagnoses'][number]) {
  if (item.verificationStatus === 'entered_in_error') return 3
  if (item.verificationStatus === 'refuted') return 2
  return ['inactive', 'remission', 'resolved'].includes(item.clinicalStatus) ? 1 : 0
}

/** The entries in `rank` order; EHR's own order, newest first, within a rank. */
function currentFirst<T>(items: readonly T[], rank: (item: T) => number): T[] {
  return [...items].sort((first, second) => rank(first) - rank(second))
}

const DAY_MS = 86_400_000
const CALENDAR_DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' })

/** A prescription's start or end day: the day whose UTC midnight is nearest (Clinical.tsx calendarDay). */
function calendarDay(value: string) {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const instant = plain ? Date.UTC(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : Date.parse(value)
  return Number.isNaN(instant) ? value : CALENDAR_DAY.format(new Date(Math.round(instant / DAY_MS) * DAY_MS))
}

/** A file size in KB or MB. */
function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  if (!Number.isFinite(count) || count < 0) return 'Size not known'
  return count >= 1024 * 1024 ? `${(count / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(count / 1024)).toLocaleString()} KB`
}

/** A file type in words: "PDF", "Image", else the subtype in capitals. */
function fileKind(mediaType: string | null | undefined): string {
  if (!mediaType) return 'File'
  if (mediaType === 'application/pdf') return 'PDF'
  if (mediaType.startsWith('image/')) return 'Image'
  return (mediaType.split('/')[1] ?? mediaType).split(/[.+-]/)[0]!.toUpperCase()
}

const words = (value: string) => { const text = value.replaceAll('_', ' '); return text.charAt(0).toUpperCase() + text.slice(1) }

function ErrorBadge() {
  return <Badge size="sm" tone="danger" solid>Entered in error</Badge>
}

/** An order's status in today's tone (Clinical.tsx:1047-1050 OrderStatus); entered in error as every other here. */
function OrderStatus({ status }: { status: string }) {
  if (status === 'entered_in_error') return <ErrorBadge />
  const known = ORDER_STATUSES[status]
  return <Badge size="sm" tone={known?.tone ?? 'neutral'}>{known?.label ?? words(status)}</Badge>
}

/**
 * One section of the summary, as a design card. A section EHR withheld was not read for this reader, so its empty
 * array is never shown as "none"; one EHR reports as cut short says so; from an EHR that reports nothing, one that
 * reaches its cap may have more.
 */
function SummarySection<T extends { id: string }>({ title, items, cap, empty, note, render, withheld = false, truncated }: {
  title: string
  items: readonly T[] | undefined
  cap: number
  empty: string
  note?: ReactNode
  render: (item: T) => ReactNode
  withheld?: boolean
  truncated?: boolean
}) {
  const line = (text: string) => <p className="m-0 px-5 py-4 text-[13px] text-ink-3">{text}</p>
  if (withheld && (!Array.isArray(items) || items.length === 0)) {
    return <Card><CardHeader as="h2" title={title} />{line(`${title} aren’t shared with your role here.`)}</Card>
  }
  const shortened = Array.isArray(items) && (truncated ?? items.length >= cap)
  return (
    <Card>
      <CardHeader as="h2" title={title} description={Array.isArray(items) && items.length > 0 ? `${items.length}` : undefined} />
      {note ? <div className="border-b border-line px-5 py-3 text-[13px] text-ink-3">{note}</div> : null}
      {!Array.isArray(items) ? line(`${title} aren’t available in this summary.`)
        : items.length === 0 ? line(empty)
          : <ul className="m-0 list-none divide-y divide-line p-0">
              {items.map(item => <li key={item.id} className="flex flex-col gap-1 px-5 py-3.5 text-[13px] text-ink-2">{render(item)}</li>)}
            </ul>}
      {/* One EHR reports as cut short has older entries; from one that reports nothing, it may (Clinical.tsx:1070-1073). */}
      {shortened ? (
        <p className="m-0 border-t border-line px-5 py-3 text-[12px] text-ink-3">
          {truncated === undefined ? `Only the ${cap} most recent are shown.` : `Only the ${cap} most recent are shown; older ones exist and are not shown.`}
        </p>
      ) : null}
    </Card>
  )
}

function Head({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">{children}</div>
}

function Text({ children }: { children: ReactNode }) {
  return <p className="m-0 whitespace-pre-wrap text-ink">{children}</p>
}

/** The sections of one emergency summary. Reading only: no control here creates, changes, signs or sends anything. */
function Sections({ summary, facilityId, may }: { summary: EmergencyRecords; facilityId: string; may: (permission: string) => boolean }) {
  const sectionProps = (key: keyof typeof EMERGENCY_CAPS) => ({
    cap: summary.limits?.[key] ?? EMERGENCY_CAPS[key],
    withheld: summary.withheld?.includes(key) ?? false,
    truncated: summary.truncated ? summary.truncated[key] === true : undefined,
  })
  const released = (key: EmergencySection) => !summary.released || summary.released.includes(key)
  return (
    <>
      {released('vitals') ? <Alert intent="info" size="sm" live={false}>{VITALS_NOTICE}</Alert> : null}
      <SummarySection title="Finished visits" items={summary.encounters} {...sectionProps('encounters')}
        empty="No finished visits at this facility." render={item => <>
          <Head>{words(item.encounterType)}</Head>
          <span>{formatWhen(item.startedAt)}{item.endedAt ? ` to ${formatWhen(item.endedAt)}` : ''}</span>
        </>} />
      <SummarySection title="Signed notes" items={summary.notes} {...sectionProps('notes')}
        empty="No signed notes at this facility." render={item => <>
          <Head>{item.title}</Head>
          {/* The note's status says whether it was amended (Clinical.tsx:1130). */}
          <span>{words(item.noteType)} · {words(item.status)} · version {item.revisionNo}{item.signedAt ? ` · signed ${formatWhen(item.signedAt)}` : ''}</span>
          <Text>{item.content}</Text>
        </>} />
      {may('ehr.diagnosis.read') ? (
        <SummarySection title="Diagnoses" {...sectionProps('diagnoses')}
          items={Array.isArray(summary.diagnoses) ? currentFirst(summary.diagnoses, diagnosisRank) : undefined}
          empty="No diagnoses at this facility." render={item => <>
            <Head>
              {item.display}
              {item.verificationStatus === 'entered_in_error' ? <ErrorBadge /> : null}
              {item.verificationStatus === 'refuted' ? <Badge size="sm">Ruled out</Badge> : null}
            </Head>
            {item.verificationStatus === 'entered_in_error' ? <span className="font-medium text-danger-ink">Recorded in error: not a diagnosis of this patient.</span> : null}
            {/* The code with its code system, ICD-10 or SNOMED (Clinical.tsx:1141). */}
            <span>{words(item.clinicalStatus)} · {words(item.verificationStatus)}{item.code ? ` · code ${item.codeSystem} ${item.code}` : ''}</span>
            {item.notes ? <Text>{item.notes}</Text> : null}
          </>} />
      ) : null}
      {may('ehr.prescription.read') ? (
        <SummarySection title="Prescriptions" {...sectionProps('prescriptions')}
          items={Array.isArray(summary.prescriptions) ? currentFirst(summary.prescriptions, item => orderRank(item.status)) : undefined}
          empty="No prescriptions at this facility." render={item => <>
            <Head>{item.medicationDisplay}<OrderStatus status={item.status} /></Head>
            {item.status === 'entered_in_error' ? <span className="font-medium text-danger-ink">Recorded in error: not a prescription for this patient.</span> : null}
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
              {/* A dose not recorded says so by name: "Not recorded" alone would not say what is missing. */}
              {item.doseQuantity == null || item.doseQuantity === '' ? <span className="text-ink-3">Dose not recorded</span>
                : <Value label="Dose" value={Number(item.doseQuantity)} unit={item.doseUnit} />}
              <span>· {item.routeCode ? `route ${item.routeCode}` : 'route not recorded'} · {item.frequency}</span>
            </span>
            {item.instructions ? <Text>{item.instructions}</Text> : null}
            {item.startsOn || item.endsOn ? (
              <span>{[item.startsOn && `Starts ${calendarDay(item.startsOn)}`, item.endsOn && `Ends ${calendarDay(item.endsOn)}`].filter(Boolean).join(' · ')}</span>
            ) : null}
          </>} />
      ) : null}
      {may('ehr.lab-request.read') ? (
        <SummarySection title="Lab tests" {...sectionProps('labRequests')}
          items={Array.isArray(summary.labRequests) ? currentFirst(summary.labRequests, item => orderRank(item.status)) : undefined}
          empty="No lab tests at this facility." render={item => <>
            <Head>{item.testDisplay}<OrderStatus status={item.status} />{item.priority && item.priority !== 'routine' ? <Badge size="sm" tone="danger">{words(item.priority)}</Badge> : null}</Head>
            {item.status === 'entered_in_error' ? <span className="font-medium text-danger-ink">Recorded in error: not a test for this patient.</span> : null}
            {/* The test's code with its code system, and its priority, routine too (Clinical.tsx:1158). */}
            <span>{item.testCodeSystem} {item.testCode} · {item.priority} priority · Asked for {formatWhen(item.createdAt)}</span>
            {item.clinicalInformation ? <Text>{item.clinicalInformation}</Text> : null}
            {/* Lab allows a released-results read under an active emergency grant; a draft never reached Lab. */}
            {item.status !== 'draft' && may('lab.result.released.read') ? <ReleasedResults facilityId={facilityId} requestId={item.id} /> : null}
          </>} />
      ) : null}
      {may('ehr.document.read') ? (
        <SummarySection title="Documents" items={summary.documents} {...sectionProps('documents')}
          note={summary.released ? 'Listed only: documents can’t be opened here. Only files that passed the virus check are listed.'
            : 'Listed only: documents can’t be opened here, and they may not have been checked for viruses.'}
          empty="No documents at this facility." render={item => <>
            <Head>{item.fileName}</Head>
            <span>{fileKind(item.mediaType)} · {fileSize(item.sizeBytes)} · added {formatWhen(item.createdAt)}</span>
          </>} />
      ) : null}
    </>
  )
}

/**
 * The open emergency patient's view-only summary: today's re-check (an emergency lookup), then the emergency records.
 * The only actions are reading again, ending this clinician's own emergency access (at once, as today: nothing may
 * stand between a clinician and ending emergency access) and leaving.
 */
function Summary({ chart, onClosed }: { chart: Chart; onClosed: () => void }) {
  const { facility, permissions, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const id = useId()
  const { facilityId, patientId } = chart
  const [summary, setSummary] = useState<EmergencyRecords | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [closeError, setCloseError] = useState('')
  const [ending, setEnding] = useState(false)
  // A close already on its way is not sent again by a second press.
  const closing = useRef(false)
  // The latest re-check, so a new function identity does not read the summary again.
  const verify = useRef(chart.verify)
  useLayoutEffect(() => { verify.current = chart.verify })

  useEffect(() => {
    let active = true
    setSummary(null)
    setLoading(true)
    setError('')
    verify.current()
      .then(() => staffApi.emergencyRecords(facilityId, patientId))
      .then(result => { if (active) setSummary(result) })
      .catch((caught: unknown) => { if (active) setError(refusalText(caught, SUMMARY_FAILED)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [facilityId, patientId, revision])

  const grantId = chart.patient.lookup.authorization.consentGrantId ?? null
  const administrator = usesNovuBackend() && permissions.includes('workforce.manage') ? selfServiceReview(facility) : null
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administrator)
  const closeUnavailableId = `${id}-close-unavailable`
  const expiresAt = chart.patient.lookup.authorization.expiresAt
  const expires = expiresAt && !Number.isNaN(new Date(expiresAt).getTime()) ? new Date(expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''

  async function closeGrant() {
    if (!grantId || closeUnavailable || closing.current) return
    closing.current = true
    setEnding(true)
    setCloseError('')
    try {
      await staffApi.closeGrant(facilityId, grantId, CLOSE_REASON)
    } catch (caught) {
      setCloseError(caught instanceof Error && caught.message ? caught.message : CLOSE_FAILED)
      return
    } finally {
      closing.current = false
      setEnding(false)
    }
    setActivePatient(null)
    onClosed()
  }

  return (
    <>
      <PatientBanner name={chart.facts.name} hid={chart.facts.hid} dateOfBirth={chart.facts.dateOfBirth} sex={chart.facts.sex} sticky
        status={{ label: 'Emergency access', tone: 'danger' }} />
      <Card>
        <div className="flex flex-col gap-3 p-5">
          <p className="m-0 text-sm text-ink-2">{SUMMARY_LEDE}{expires ? ` Access ends at ${expires}.` : ''}</p>
          <div className="flex flex-wrap gap-2">
            {/* Busy, it stays focusable (aria-disabled, not disabled), so focus stays on it; a press while it reads does nothing. */}
            <Button icon={RotateCcw} aria-disabled={loading || undefined}
              onClick={() => { if (!loading) setRevision(value => value + 1) }}>Refresh</Button>
            {/* At once, as today: nothing may stand between a clinician and ending emergency access. */}
            {grantId ? <Button variant="danger" disabled={closeUnavailable !== null} aria-describedby={closeUnavailable ? closeUnavailableId : undefined}
              aria-disabled={ending || undefined} onClick={closeGrant}>End emergency access</Button> : null}
            <Button variant="ghost" icon={UserSearch} to={href.to('patients')}>Find another patient</Button>
          </div>
          {grantId && closeUnavailable ? <p id={closeUnavailableId} className="m-0 text-[13px] text-ink-3">{closeUnavailable}</p> : null}
          {closeError ? <Alert intent="error" title="Couldn’t end access">{closeError}</Alert> : null}
        </div>
      </Card>
      {loading && !summary ? <Card><LoadingRows rows={3} label={LOADING_SUMMARY} /></Card> : null}
      {error ? <Alert intent="error" title="Couldn’t load the emergency summary"
        action={<Button size="sm" icon={RotateCcw} onClick={() => setRevision(value => value + 1)}>Try again</Button>}>{error}</Alert> : null}
      {summary ? <Sections summary={summary} facilityId={facilityId} may={permission => permissions.includes(permission)} /> : null}
    </>
  )
}

/** ChartGate's no-patient state, for a patient open in direct care: the emergency summary is for emergency access. */
function NoEmergencyPatient() {
  const href = useWorkspaceHref()
  return <EmptyState icon={Siren} title="No patient open with emergency access" description="Open one from Emergency access first."
    action={<Button to={href()}>Emergency access</Button>} />
}

/** emergency/summary: the read-only emergency summary of the patient open under emergency access. */
export function EmergencySummaryPage() {
  const href = useWorkspaceHref()
  const [closed, setClosed] = useState(0)
  const said = useRef<HTMLParagraphElement>(null)

  // Ending access removes the button that did it: focus goes to what the page now says, if it was lost.
  useLayoutEffect(() => {
    if (!closed) return
    const active = document.activeElement
    if (!active || active === document.body) said.current?.focus()
  }, [closed])

  return (
    <FormPage title="Emergency summary" back={{ to: href(), label: 'Back to emergency access' }} wide>
      <div role="status" className="empty:hidden">
        {closed ? <p ref={said} tabIndex={-1} className="m-0 rounded-lg bg-subtle px-4 py-3 text-sm text-ink outline-none">{ACCESS_CLOSED}</p> : null}
      </div>
      <ChartGate allowEmergency>
        {chart => chart.purpose === 'emergency'
          ? <Summary key={chart.patientId} chart={chart} onClosed={() => setClosed(value => value + 1)} />
          : <NoEmergencyPatient />}
      </ChartGate>
    </FormPage>
  )
}
