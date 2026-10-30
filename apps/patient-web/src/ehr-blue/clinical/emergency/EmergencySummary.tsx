import { EhrBadge, EhrButton, EhrCard, EhrEmptyState } from '@hid/ui/ehr'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usesNovuBackend } from '../../../backendContract'
import { staffApi, type EmergencyRecords, type EmergencySection } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { selfServiceReview } from '../../../staff/staffAccess'
import { CHOOSE_FIRST, CHOOSE_FIRST_DETAIL, ChartGate, OPEN_PATIENT_HOW, type Chart } from '../parts/chart'
import { ActionList, DetailGrid, Step } from '../parts/Detail'
import { formatWhen } from '../parts/format'
import { ErrorBox, Loading, RecordHeading } from '../parts/Notices'
import { PatientHeader } from '../parts/PatientHeader'
import { StatusBadge } from '../parts/StatusBadge'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { ACCESS_CLOSED, CLOSE_FAILED, CLOSE_GRANT, CLOSE_REASON, actionUnavailable } from './access'
import { ReleasedResults } from './ReleasedResults'

/** Today's emergency summary wording (Clinical.tsx EmergencySummary), word for word. */
export const SUMMARY_EYEBROW = 'Emergency record · audited access'
export const SUMMARY_LEDE = 'This read-only summary holds this facility’s completed encounters and signed clinical notes, and the diagnoses, prescriptions, lab requests and documents your role may read. The server checks the active emergency grant on each request.'
export const VITALS_NOTICE = 'Vital signs are not shown in this summary. EHR sends them as first recorded, without later corrections, so a value here could be one a clinician has since corrected.'
export const SUMMARY_FAILED = 'Emergency records could not be loaded.'
export const LOADING_SUMMARY = 'Loading emergency summary…'

// What EHR's emergency summary sends of each section at most (Clinical.tsx EMERGENCY_CAPS).
const EMERGENCY_CAPS = { encounters: 50, notes: 50, diagnoses: 100, prescriptions: 100, labRequests: 100, documents: 100 } as const

// Prescription and lab request statuses (EHR OrderStatus), what is current first (Clinical.tsx ORDER_STATUSES).
const ORDER_STATUSES: Readonly<Record<string, { readonly label: string; readonly rank: number }>> = {
  active: { label: 'Active', rank: 0 },
  on_hold: { label: 'On hold', rank: 1 },
  draft: { label: 'Draft', rank: 2 },
  completed: { label: 'Completed', rank: 3 },
  cancelled: { label: 'Cancelled', rank: 4 },
  entered_in_error: { label: 'Entered in error', rank: 5 },
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

/** Clinical.tsx fileSize. */
function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(count) && count >= 0 ? `${Math.ceil(count / 1024).toLocaleString()} KiB` : 'Size unavailable'
}

function ErrorBadge() {
  return <EhrBadge tone="critical" className="hid-ehr-clinical-badge">Entered in error</EhrBadge>
}

function OrderStatus({ status }: { status: string }) {
  if (status === 'entered_in_error') return <ErrorBadge />
  return <StatusBadge status={ORDER_STATUSES[status]?.label ?? status.replaceAll('_', ' ')} />
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
  if (withheld && (!Array.isArray(items) || items.length === 0)) {
    return (
      <EhrCard title={title}>
        <p>{title} are not included in this summary: EHR did not release them to your role at this facility.</p>
      </EhrCard>
    )
  }
  const shortened = Array.isArray(items) && (truncated ?? items.length >= cap)
  return (
    <EhrCard title={title}>
      {note}
      {!Array.isArray(items) ? <p>{title} are not available in this summary.</p>
        : items.length === 0 ? <p>{empty}</p>
          : (
            <ul className="hid-ehr-clinical-emergency-entries">
              {items.map(item => <li key={item.id} className="hid-ehr-clinical-emergency-entry">{render(item)}</li>)}
            </ul>
          )}
      {shortened ? (
        <p className="hid-ehr-clinical-emergency-muted">{truncated === undefined
          ? `The backend sends only the ${cap} most recent; older ones are not shown.`
          : `Only the ${cap} most recent are shown; older ones exist and are not shown.`}</p>
      ) : null}
    </EhrCard>
  )
}

function Head({ children }: { children: ReactNode }) {
  return <div className="hid-ehr-clinical-emergency-entry-head">{children}</div>
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
      {released('vitals') ? <div className="hid-ehr-clinical-banner"><p>{VITALS_NOTICE}</p></div> : null}
      <SummarySection title="Completed encounters" items={summary.encounters} {...sectionProps('encounters')}
        empty="No completed encounters are available from this facility." render={item => <>
          <Head><strong>{item.encounterType.replace('_', ' ')}</strong></Head>
          <p>Started {formatWhen(item.startedAt)}</p>
          {item.endedAt ? <p>Ended {formatWhen(item.endedAt)}</p> : null}
        </>} />
      <SummarySection title="Signed notes" items={summary.notes} {...sectionProps('notes')}
        empty="No signed notes are available from this facility." render={item => <>
          <Head><strong>{item.title}</strong></Head>
          <p>{item.noteType} · {item.status} · revision {item.revisionNo}</p>
          <p className="hid-ehr-clinical-emergency-content">{item.content}</p>
          {item.signedAt ? <p>Signed {formatWhen(item.signedAt)}</p> : null}
        </>} />
      {may('ehr.diagnosis.read') ? (
        <SummarySection title="Diagnoses" {...sectionProps('diagnoses')}
          items={Array.isArray(summary.diagnoses) ? currentFirst(summary.diagnoses, diagnosisRank) : undefined}
          empty="No diagnoses are available from this facility." render={item => <>
            <Head>
              <strong>{item.display}</strong>
              {item.verificationStatus === 'entered_in_error' ? <ErrorBadge /> : null}
              {item.verificationStatus === 'refuted' ? <StatusBadge status="Refuted" /> : null}
            </Head>
            {item.verificationStatus === 'entered_in_error' ? <p>Recorded in error: not a diagnosis of this patient.</p> : null}
            <p>{item.codeSystem} {item.code} · {item.clinicalStatus.replaceAll('_', ' ')} · {item.verificationStatus.replaceAll('_', ' ')}</p>
            {item.notes ? <p className="hid-ehr-clinical-emergency-content">{item.notes}</p> : null}
          </>} />
      ) : null}
      {may('ehr.prescription.read') ? (
        <SummarySection title="Prescriptions" {...sectionProps('prescriptions')}
          items={Array.isArray(summary.prescriptions) ? currentFirst(summary.prescriptions, item => orderRank(item.status)) : undefined}
          empty="No prescriptions are available from this facility." render={item => <>
            <Head><strong>{item.medicationDisplay}</strong><OrderStatus status={item.status} /></Head>
            {item.status === 'entered_in_error' ? <p>Recorded in error: not a prescription for this patient.</p> : null}
            <p>{item.doseQuantity == null || item.doseQuantity === '' ? 'Dose not recorded' : `${Number(item.doseQuantity)} ${item.doseUnit ?? ''}`.trim()} · {item.routeCode ? `Route ${item.routeCode}` : 'Route not recorded'} · {item.frequency}</p>
            {item.instructions ? <p className="hid-ehr-clinical-emergency-content">{item.instructions}</p> : null}
            {item.startsOn || item.endsOn ? (
              <p>{[item.startsOn && `Starts ${calendarDay(item.startsOn)}`, item.endsOn && `Ends ${calendarDay(item.endsOn)}`].filter(Boolean).join(' · ')}</p>
            ) : null}
          </>} />
      ) : null}
      {may('ehr.lab-request.read') ? (
        <SummarySection title="Lab requests" {...sectionProps('labRequests')}
          items={Array.isArray(summary.labRequests) ? currentFirst(summary.labRequests, item => orderRank(item.status)) : undefined}
          empty="No lab requests are available from this facility." render={item => <>
            <Head><strong>{item.testDisplay}</strong><OrderStatus status={item.status} /></Head>
            {item.status === 'entered_in_error' ? <p>Recorded in error: not a request for this patient.</p> : null}
            <p>{item.testCodeSystem} {item.testCode} · {item.priority} priority · Requested {formatWhen(item.createdAt)}</p>
            {item.clinicalInformation ? <p className="hid-ehr-clinical-emergency-content">{item.clinicalInformation}</p> : null}
            {/* Lab allows a released-results read under an active emergency grant; a draft never reached Lab. */}
            {item.status !== 'draft' && may('lab.result.released.read') ? <ReleasedResults facilityId={facilityId} requestId={item.id} /> : null}
          </>} />
      ) : null}
      {may('ehr.document.read') ? (
        <SummarySection title="Documents" items={summary.documents} {...sectionProps('documents')}
          note={<p>{summary.released
            ? 'Documents that passed the virus scan are listed for reference; they cannot be opened from this summary.'
            : 'Uploaded documents are listed for reference. They cannot be opened from this summary, and their virus scan result is not included.'}</p>}
          empty="No uploaded documents are available from this facility." render={item => <>
            <Head><strong>{item.fileName}</strong></Head>
            <p>{item.mediaType} · {fileSize(item.sizeBytes)} · Uploaded {formatWhen(item.createdAt)}</p>
          </>} />
      ) : null}
    </>
  )
}

/**
 * The open emergency patient's read-only summary: today's re-check (an emergency lookup), then the emergency records.
 * The only actions are reading again, closing this clinician's own grant (today's "Close my grant", at once, as today:
 * nothing may stand between a clinician and ending emergency access) and leaving.
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
  const expires = expiresAt && !Number.isNaN(new Date(expiresAt).getTime()) ? new Date(expiresAt).toLocaleTimeString('en-US') : ''

  async function closeGrant() {
    if (!grantId || closeUnavailable || closing.current) return
    closing.current = true
    setCloseError('')
    try {
      await staffApi.closeGrant(facilityId, grantId, CLOSE_REASON)
    } catch (caught) {
      setCloseError(caught instanceof Error && caught.message ? caught.message : CLOSE_FAILED)
      return
    } finally {
      closing.current = false
    }
    setActivePatient(null)
    onClosed()
  }

  return (
    <>
      <PatientHeader facts={chart.facts} flags={['Emergency access', 'Read only']} />
      <DetailGrid>
        <EhrCard title={SUMMARY_EYEBROW}>
          <p>{SUMMARY_LEDE}</p>
          {expires ? <p>Grant expires {expires}.</p> : null}
        </EhrCard>
        <EhrCard title="Available actions">
          <ActionList>
            <EhrButton variant="secondary" busy={loading} onClick={() => setRevision(value => value + 1)}>Refresh summary</EhrButton>
            {grantId ? (
              <EhrButton
                variant="secondary"
                disabled={closeUnavailable !== null}
                aria-describedby={closeUnavailable ? closeUnavailableId : undefined}
                onClick={closeGrant}
              >
                Close my grant
              </EhrButton>
            ) : null}
          </ActionList>
          {grantId && closeUnavailable ? <p id={closeUnavailableId}>{closeUnavailable}</p> : null}
          {closeError ? <ErrorBox>{closeError}</ErrorBox> : null}
          <Step><Link className="hid-ehr-clinical-link" to={href.to('patients')}>Change patient →</Link></Step>
        </EhrCard>
      </DetailGrid>
      {loading ? <Loading label={LOADING_SUMMARY} /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {summary ? <Sections summary={summary} facilityId={facilityId} may={permission => permissions.includes(permission)} /> : null}
    </>
  )
}

/** ChartGate's no-patient state, for a patient open in direct care: the emergency summary is for emergency access. */
function NoEmergencyPatient() {
  const href = useWorkspaceHref()
  return (
    <EhrEmptyState
      title={CHOOSE_FIRST}
      message={`${CHOOSE_FIRST_DETAIL} ${OPEN_PATIENT_HOW}`}
      action={<Link className="hid-ehr-clinical-link" to={href.to('patients')}>Go to patient access →</Link>}
    />
  )
}

/** emergency/summary: the read-only emergency summary of the patient open under emergency access. */
export function EmergencySummaryPage() {
  const href = useWorkspaceHref()
  const [closed, setClosed] = useState(0)
  const said = useRef<HTMLParagraphElement>(null)

  // Closing the grant removes the button that did it: focus goes to what the page now says, if it was lost.
  useLayoutEffect(() => {
    if (!closed) return
    const active = document.activeElement
    if (!active || active === document.body) said.current?.focus()
  }, [closed])

  return (
    <>
      <RecordHeading title="Emergency summary" backHref={href()} />
      <div role="status">
        {closed ? <p ref={said} tabIndex={-1} className="hid-ehr-clinical-status">{ACCESS_CLOSED}</p> : null}
      </div>
      <ChartGate allowEmergency>
        {chart => chart.purpose === 'emergency'
          ? <Summary key={chart.patientId} chart={chart} onClosed={() => setClosed(value => value + 1)} />
          : <NoEmergencyPatient />}
      </ChartGate>
    </>
  )
}
