import { Activity, ChevronRight, FolderOpen, History, KeyRound, ListChecks, LogOut, RotateCcw, Send, ShieldCheck, Siren, Stethoscope, UserPlus } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, IconChip, ListRow, PageHeader } from '../../../kasuwa/ui'
import { CardFace } from '../../../routes/HealthIdCard'
import { isHidApiError, plainErrorText } from '@hid/http'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { HEALTH_FIELDS, type HealthFields, type ReportedHealthProfile } from '../../../profileParity'
import { ChartGate, READ_ONLY, type Chart } from '../parts/chart'
import { LoadingRows } from '../../../kasuwa/parts'
import { consultationLabel, visitClassLabel } from '../../../plainLabels'
import { formatDate, formatWhen } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import type { PatientFacts } from '../parts/PatientHeader'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { isDemoFacility } from '../../blueFacilities'
import { useSampleCan } from '../../frame/sampleAccess'
import { opensInProduct, productOf } from '../../frame/product'
import { segmentOf } from '../parts/segments'
import { CLOSE_GRANT, CLOSE_REASON, METHOD_ROUTES, actionUnavailable, administratorOf, offerHealthId } from '../consent/access'
import { CLOSE_REFUSALS } from '../emergency/access'
import type { ActivePatient } from '../../../staff/App'
import { isAdult, STAFF_ACCESS_COVERS_PAPER } from '../../../paperRecordsWording'
import { AllergiesCard } from './AllergiesCard'

export const CLOSED_NOTICE = 'closed'
/** Said where a lab's or a pharmacy's site hides every next step: those pages are the hospital EHR's alone. */
export const ON_HOSPITAL_EHR = 'Charts, visits and emergency access are on the Hospital EHR.'
/** After the chart's READ_ONLY, on the patient page only: how to get changes. */
const READ_ONLY_HOW = 'To make changes, ask the patient to let you see and add to their records.'

function sexText(value: string | undefined) {
  if (!value) return ''
  const words = value.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function accessLabel(patient: ActivePatient): string {
  return patient.purpose === 'emergency' ? 'Emergency access' : 'Access allowed'
}

/** What the allowed lookup told us, as the design's key and value list prints it. Nothing else is known here. */
export function patientDetails(patient: ActivePatient, facts: PatientFacts): KeyValue[] {
  return [
    { label: 'Name', value: facts.name },
    { label: 'Date of birth', value: formatDate(facts.dateOfBirth) },
    { label: 'Sex', value: sexText(facts.sex) },
    { label: 'Health ID', value: facts.hid },
    { label: 'Access', value: patient.purpose === 'emergency' ? 'Emergency (read-only)' : 'Direct care' },
    { label: 'Access until', value: formatWhen(patient.lookup.authorization.expiresAt) },
  ]
}

type Reported =
  | { readonly scope: string; readonly status: 'hidden' }
  | { readonly scope: string; readonly status: 'failed' }
  | { readonly scope: string; readonly status: 'shown'; readonly profile: ReportedHealthProfile }

/** As the patient's profile names them, in today's order (staff/routes/PatientReportedHealth.tsx). */
const REPORTED_LABELS: Readonly<Record<keyof HealthFields, string>> = {
  bloodGroup: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', currentMedications: 'Current medications',
  chronicConditions: 'Chronic conditions', medicalNotes: 'Medical notes for the care team',
}

/** What the reported-health read gives the access card: today's failure words with a retry, or each field as today's card lists it. */
type ReportedHealth =
  | { readonly status: 'failed'; readonly retry: () => void }
  | { readonly status: 'shown'; readonly rows: readonly KeyValue[]; readonly updatedAt: string | null }

/**
 * Everything the patient reported about their health (blood group, genotype, allergies, medicines, conditions, notes for
 * the care team), shown on the access card under the patient's Health ID card: what the patient entered in their Health ID portal, as
 * today's "Reported by the patient" reads it (staff/routes/PatientReportedHealth.tsx) and under the same conditions:
 * direct care only, with ehr.note.read, read afresh for each actor, facility, patient, purpose and permission set (today's
 * key), so nothing of another patient's shows. No row while it loads, when EHR refuses it (403) or does not serve it
 * (404), or when the patient has stated nothing; another failure says so in today's words, with today's retry. It is
 * what the patient says, not a clinical finding, and is labelled so.
 */
function useReportedHealth(chart: Chart): ReportedHealth | null {
  const { state, permissions } = useClinical()
  const { facilityId, patientId, purpose } = chart
  const reads = purpose === 'direct-care' && permissions.includes('ehr.note.read')
  const actorId = state.status === 'ready' ? state.session.actor.id : ''
  const [revision, setRevision] = useState(0)
  const scope = JSON.stringify([actorId, facilityId, patientId, purpose, permissions, revision])
  const [reported, setReported] = useState<Reported | null>(null)

  useEffect(() => {
    if (!reads) return
    const controller = new AbortController()
    // Run as a promise, as today's component does, so that a read that throws at once is this row's failure, never the page's.
    void Promise.resolve().then(() => staffApi.reportedHealthProfile(facilityId, patientId, controller.signal)).then(
      profile => {
        if (!controller.signal.aborted) setReported(profile ? { scope, status: 'shown', profile } : { scope, status: 'hidden' })
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return
        // Refused or not served: nothing is shown. Only the service failing to answer says so, with a retry.
        setReported({ scope, status: isHidApiError(caught) && caught.status !== 403 && caught.status !== 404 ? 'failed' : 'hidden' })
      },
    )
    return () => controller.abort()
  }, [reads, scope, facilityId, patientId])

  // An answer for an earlier scope (or retry) is never shown: until this one answers, there is no row.
  const current = reads && reported?.scope === scope ? reported : null
  if (!current || current.status === 'hidden') return null
  if (current.status === 'failed') return { status: 'failed', retry: () => setRevision(value => value + 1) }
  const { profile } = current
  return {
    status: 'shown', updatedAt: profile.updatedAt,
    rows: HEALTH_FIELDS.map(field => ({ label: REPORTED_LABELS[field], value: profile[field] ?? 'Not stated' })),
  }
}

/** The access card's "Reported by the patient": labelled as theirs, not a clinical finding, as today's card is. */
function ReportedByPatient({ reported }: { reported: ReportedHealth }) {
  if (reported.status === 'failed') {
    return <div className="border-t border-line px-4 py-2.5 text-sm text-ink">
      <p className="m-0 text-[13px] font-semibold text-ink">Reported by the patient</p>
      <p className="m-0">What the patient entered about their health could not be loaded.{' '}
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-brand-ink underline underline-offset-2" onClick={reported.retry}>
          Retry patient-reported health information
        </button>
      </p>
    </div>
  }
  const when = formatWhen(reported.updatedAt)
  return <section aria-labelledby="patient-reported-health-title" className="border-t border-line px-4 py-2.5">
    <div className="flex flex-wrap items-center gap-2">
      <p id="patient-reported-health-title" className="m-0 text-[13px] font-semibold text-ink">Reported by the patient</p>
      <Badge size="sm" tone="warn">Patient-reported</Badge>
    </div>
    <p className="m-0 mt-1 text-[12px] text-ink-3">Entered by the patient in their Health ID portal, not clinically verified. It does not change this record.{when ? ` Last updated ${when}.` : ''}</p>
    <dl className="m-0 mt-2 flex flex-col gap-1.5">{reported.rows.map(row => <div key={row.label}>
      <dt className="text-[12px] text-ink-3">{row.label}</dt>
      <dd className="m-0 text-sm break-words whitespace-pre-line text-ink">{row.value}</dd>
    </div>)}</dl>
  </section>
}

/** Age in whole years from an ISO date of birth; empty when unknown. */
function ageOf(dateOfBirth: string | undefined): string {
  if (!dateOfBirth) return ''
  const born = new Date(dateOfBirth)
  if (Number.isNaN(born.getTime())) return ''
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) age -= 1
  return `${age} years`
}

/**
 * The open patient's page (`patients/open`: the URL names no patient). The patient's own Health ID card heads it, the
 * same card they carry and share, so the clinician confirms who this is at a glance; then one action that matters
 * (Open chart), the next steps, and this facility's visits.
 */
export function PatientPage() {
  return (
    <div className="flex flex-col gap-5">
      <ChartGate allowEmergency>{current => <PatientRecord chart={current} />}</ChartGate>
    </div>
  )
}

function PatientRecord({ chart }: { chart: Chart }) {
  const { facility, permissions, can, setActivePatient } = useClinical()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const sampleCan = useSampleCan()
  const [error, setError] = useState('')
  const [ending, setEnding] = useState(false)
  const emergency = chart.purpose === 'emergency'
  // Read only (emergency, or a grant without changes): write actions are hidden, not offered as a dead end.
  const readOnly = emergency || chart.writeNotice !== null
  const grantId = chart.patient.lookup.authorization.consentGrantId ?? null
  const administrator = administratorOf(facility, permissions)
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administrator)
  // The access steps today's Patients page offers (its METHOD_ROUTES), each with today's reason when the role cannot take it.
  const pinUnavailable = actionUnavailable(METHOD_ROUTES.pin, permissions, administrator)
  const requestUnavailable = actionUnavailable(METHOD_ROUTES.request, permissions, administrator)
  const emergencyUnavailable = actionUnavailable(METHOD_ROUTES.emergency, permissions, administrator)
  const expires = chart.patient.lookup.authorization.expiresAt
  const facts = chart.facts
  const about = [ageOf(facts.dateOfBirth), sexText(facts.sex), facts.dateOfBirth ? `born ${formatDate(facts.dateOfBirth)}` : ''].filter(Boolean).join(' · ')
  const reported = useReportedHealth(chart)

  async function closeGrant() {
    if (!grantId || closeUnavailable || ending) return
    setEnding(true)
    setError('')
    try {
      await staffApi.closeGrant(chart.facilityId, grantId, CLOSE_REASON)
    } catch (caught) {
      setError(plainErrorText(caught, 'Couldn’t end your access. Please try again.', { codes: CLOSE_REFUSALS, audience: 'facility' }))
      return
    } finally {
      setEnding(false)
    }
    setActivePatient(null)
    navigate(href(), { state: { notice: CLOSED_NOTICE } })
  }

  /**
   * As the design's Next steps, a step shows only to a role that may take it: External record access opens only with
   * identity.consent.write (the frame's rule, the permission its request form needs). The two steps that move an
   * emergency patient to direct care are the exception: a role that cannot take one sees it turned off with today's
   * reason, as on Find a patient.
   */
  const mayOpenConsent = can('identity.consent.write')
  const mayOpenChart = chart.can('ehr.encounter.read')
  // Starting a consultation or recording vitals needs the grant to allow changes and the role to hold what that page
  // writes with (Consultation's ehr.encounter.write; Triage's ehr.vital.read and ehr.vital.write): no dead-end step.
  const mayStart = !readOnly && chart.can('ehr.encounter.write')
  const mayRecordVitals = !readOnly && chart.can('ehr.vital.read', 'ehr.vital.write')
  // A step leads only to a page this site opens: on a single product's site (lab., pharmacy.) Consultation, Triage,
  // Emergency and the samples are the hospital EHR's, and the frame would send the person back to Home (product.ts).
  // The product is decided as the frame decides it. In a hospital's EHR every page opens.
  const product = productOf(window.location.hostname, permissions)
  const opens = (workspace: string) => opensInProduct(product, segmentOf(workspace))
  const showChart = mayOpenChart && opens('consult')
  const showStart = mayStart && opens('consult')
  const showVitals = mayRecordVitals && opens('triage')
  const showWalkIn = isDemoFacility(chart.facilityId) && sampleCan('journey', 'create') && opens('journey')
  const showEmergency = isDemoFacility(chart.facilityId) && emergencyUnavailable === null && opens('emergency')
  const showSummary = opens('emergency')
  const noSteps = !showStart && !showVitals && !showWalkIn && !mayOpenConsent && !showEmergency

  /** The Health ID is handed over in memory only, and only where the request form can open and read it. */
  function openConsent() {
    if (!mayOpenConsent) return
    offerHealthId(chart.patient.hid, chart.facilityId, setActivePatient)
    navigate(href.to('consent', 'new'))
  }

  /**
   * The access steps, as Find a patient takes them: under direct care at the demo facilities only, emergency access
   * (Emergency's own page, which needs identity.break-glass.write; today's portal offers it only from Patients' Obtain
   * access, never on an open record); under emergency access, the patient's Access PIN (Patients' own page) or Ask the
   * patient (External record access), which move the patient to direct care. Each hands the Health ID over in memory,
   * never in the URL, and only to a step the role may take.
   */
  function accessStep(target: 'pin' | 'request' | 'emergency') {
    const unavailable = target === 'pin' ? pinUnavailable : target === 'request' ? requestUnavailable : emergencyUnavailable
    if (unavailable) return
    offerHealthId(chart.patient.hid, chart.facilityId, setActivePatient)
    if (target === 'pin') navigate(href('pin'))
    else if (target === 'request') navigate(href.to('consent', 'new'))
    else navigate(href.to('emergency'))
  }

  const initials = facts.name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] @5xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3 @3xl:sticky @3xl:top-24">
        <CardFace name={facts.name} hid={facts.hid} verified={null} facts={[]} allergies={[]} label="Patient"
          face={<span className="text-[5.4cqw] font-light tracking-[.12em] text-white/85" aria-hidden="true">{initials}</span>} />
        <Card>
          <div className="flex items-center gap-3 px-4 py-3">
            <IconChip icon={emergency ? Siren : ShieldCheck} tone={emergency ? 'danger' : 'success'} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-ink">{emergency ? 'Emergency access' : 'You have access'}</p>
              {expires ? <p className="m-0 text-[12px] text-ink-3">Until {formatWhen(expires)}</p> : null}
              {/* Direct care from the patient's own OK (an approved request, their Access PIN, or a share they made to this staff
                  member here; owner, 5 Nov 2026) also covers bringing in paper records while it lasts. Whichever it is, the open
                  record's grant is what Identity answers for, so the line asks nothing about how access came: adults only, to a
                  role that brings them in, once the grant is known to allow adding to the record (canWrite: never emergency, never
                  while the check is still answering). */}
              {chart.canWrite && permissions.includes('ocr.job.read') && isAdult(facts.dateOfBirth) ? <p className="m-0 mt-1 text-[12px] text-ink-3">{STAFF_ACCESS_COVERS_PAPER}</p> : null}
            </div>
          </div>
          {/* What the patient entered in their Health ID portal: labelled as theirs, not a clinical finding. */}
          {reported ? <ReportedByPatient reported={reported} /> : null}
          {grantId ? <div className="border-t border-line px-4 py-2.5">
            {closeUnavailable ? <p id="close-grant-unavailable" className="m-0 mb-1.5 text-[12px] text-ink-3">{closeUnavailable}</p> : null}
            {/* Busy (aria-busy), it stays focusable (aria-disabled, not disabled), as today's Close my grant and the emergency
                summary's End emergency access: a refused close leaves focus on it, and a second press sends nothing. */}
            <Button variant="danger" size="sm" icon={LogOut} disabled={closeUnavailable !== null} aria-describedby={closeUnavailable ? 'close-grant-unavailable' : undefined}
              aria-busy={ending || undefined} aria-disabled={ending || undefined} onClick={() => void closeGrant()}>End my access</Button>
          </div> : null}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <PageHeader title={facts.name} description={about || undefined} back={{ to: href(), label: 'Back to find a patient' }}
          actions={emergency ? (showSummary ? <Button variant="primary" icon={Siren} onClick={() => navigate(href.to('emergency', 'summary'))}>Open emergency summary</Button> : undefined)
            : showChart ? <Button variant="primary" icon={FolderOpen} onClick={() => navigate(href.to('consult'))}>Open chart</Button> : undefined} />
        {/* Read only, said once. */}
        {emergency ? <Alert intent="warning" title="View only">{`Emergency access shows the emergency summary only. Nothing can be added or changed for ${facts.name}.`}</Alert>
          : chart.writeNotice ? <Alert intent="info" title="View only">{chart.writeNotice === READ_ONLY
            ? `${READ_ONLY} ${READ_ONLY_HOW}` : chart.writeNotice}</Alert> : null}
        {error ? <Alert intent="error" title="Couldn’t end access">{error}</Alert> : null}
        {/* Allergies, recorded by clinicians and reported by the patient, each labelled (hid-system 0124; patient-reported only before it). */}
        {!emergency ? <AllergiesCard chart={chart} /> : null}

        {!emergency ? <Card>
          <CardHeader as="h2" title="Next steps" icon={ListChecks} iconTone="brand" />
          {product !== 'ehr' && noSteps ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3">{ON_HOSPITAL_EHR}</p> : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {showStart ? <li><ListRow onClick={() => navigate(href.to('consult', 'new'))} leading={<IconChip size="sm" icon={Stethoscope} />} title="Start a consultation" subtitle="Notes, diagnoses and orders in one place" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {showVitals ? <li><ListRow onClick={() => navigate(href.to('triage', 'new'))} leading={<IconChip size="sm" icon={Activity} />} title="Record vitals" subtitle="Blood pressure, temperature, pulse, oxygen" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {/* Appointments and walk-in visits are samples: offered only at the demo facilities, and only to a design role
                that may create there (sampleAccess.ts), as a role the sample is closed to would land on Home instead. */}
            {showWalkIn ? <li><ListRow onClick={() => navigate(href.to('journey', 'new'))} leading={<IconChip size="sm" icon={UserPlus} />} title="Register a walk-in visit" subtitle="Sample at demo facilities" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {mayOpenConsent ? <li><ListRow onClick={openConsent} leading={<IconChip size="sm" icon={Send} />} title="Ask for more access" subtitle="More time, or the right to add records. The patient approves." trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {/* At the demo facilities only, like the sample steps: today's portal never offers break-glass on an open
                record, so a real facility keeps it on Find a patient's Obtain access. Shown, as this card's steps are,
                only to a role that may take it. */}
            {showEmergency ? <li><ListRow onClick={() => accessStep('emergency')} leading={<IconChip size="sm" icon={Siren} tone="danger" />} title="Emergency access" subtitle="Only if they can’t consent. Time-limited and recorded." trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
          </ul>
        </Card> : <Card>
          <CardHeader as="h2" title="Next steps" icon={ListChecks} iconTone="brand" />
          {/* Emergency access is read-only: the patient's Access PIN or their approval moves them to direct care (owner,
              31 October). A step the role cannot take is turned off, with today's reason. */}
          <ul className="m-0 list-none divide-y divide-line p-0">
            <li>
              <ListRow onClick={() => accessStep('pin')} disabled={pinUnavailable !== null} describedBy={pinUnavailable ? 'pin-step-unavailable' : undefined}
                leading={<IconChip size="sm" icon={KeyRound} />} title="Use their Access PIN" subtitle="If they’re with you and have set one." trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} />
              {pinUnavailable ? <p id="pin-step-unavailable" className="m-0 px-5 pb-3 text-[12px] text-ink-3">{pinUnavailable}</p> : null}
            </li>
            <li>
              <ListRow onClick={() => accessStep('request')} disabled={requestUnavailable !== null} describedBy={requestUnavailable ? 'request-step-unavailable' : undefined}
                leading={<IconChip size="sm" icon={Send} />} title="Ask the patient" subtitle="They approve on their phone. You’re told the moment they do." trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} />
              {requestUnavailable ? <p id="request-step-unavailable" className="m-0 px-5 pb-3 text-[12px] text-ink-3">{requestUnavailable}</p> : null}
            </li>
          </ul>
        </Card>}
        {/* Each visit opens in Consultation, so the list shows only where Consultation opens. */}
        {!emergency && chart.can('ehr.encounter.read') && opens('consult') ? <EncounterHistory chart={chart} canStart={showStart} /> : null}
      </div>
    </div>
  )
}

type HistoryState = { readonly items: readonly Encounter[]; readonly nextCursor: string | null } | { readonly error: string } | null

/** A row's second line: the kind of visit and, when one was written, the complaint, as today's chart list shows them. */
function visitSubtitle(item: Pick<Encounter, 'encounterType' | 'chiefComplaint'>): string {
  const complaint = item.chiefComplaint?.trim()
  return complaint ? `${visitClassLabel(item.encounterType)} · ${complaint}` : visitClassLabel(item.encounterType)
}

/**
 * This facility's visits for the patient (today's chart list), each opening in Consultation, with a Show more for the
 * earlier pages and today's Refresh, which reads every page shown again. Each read follows today's re-check; a refusal
 * there closes the patient and shows that access ended.
 */
function EncounterHistory({ chart, canStart }: { chart: Chart; canStart: boolean }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const [state, setState] = useState<HistoryState>(null)
  const [busy, setBusy] = useState<'refresh' | 'more' | null>(null)
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null)
  const { facilityId, patientId, verify } = chart
  // Read once per patient: the re-check itself may be a new function on each render.
  const recheck = useRef(verify)
  useLayoutEffect(() => { recheck.current = verify })
  // Each read is this patient's latest: an answer for an earlier read (or patient) is never shown.
  const reads = useRef(0)
  // Pages shown, so Refresh reads the same number again.
  const pages = useRef(1)
  const list = useRef<HTMLUListElement>(null)
  // After the last Show more its button goes away: focus moves to the first visit it added (this row's index).
  const focusRow = useRef<number | null>(null)

  useEffect(() => {
    const read = ++reads.current
    pages.current = 1
    setState(null)
    setBusy(null)
    setProblem(null)
    void (async () => {
      try {
        await recheck.current()
        const page = await staffApi.encounters(facilityId, patientId)
        if (read === reads.current) setState({ items: page.items, nextCursor: page.nextCursor })
      } catch (caught) {
        if (read === reads.current) setState({ error: refusalText(caught, 'Please try again.') })
      }
    })()
    return () => { reads.current += 1 }
  }, [facilityId, patientId])

  useLayoutEffect(() => {
    const row = focusRow.current
    if (row === null) return
    focusRow.current = null
    list.current?.querySelectorAll<HTMLElement>(':scope > li > button')[row]?.focus()
  }, [state])

  /** Visits from the first page to the given number of pages, read afresh, with no visit twice. */
  async function readPages(count: number, cursor?: string, fresh = false) {
    const items: Encounter[] = []
    const seen = new Set<string>()
    let next: string | null = cursor ?? null
    for (let index = 0; index < count; index += 1) {
      const page = await staffApi.encounters(facilityId, patientId, { cursor: next ?? undefined, fresh })
      for (const item of page.items) if (!seen.has(item.id)) { seen.add(item.id); items.push(item) }
      next = page.nextCursor
      if (!next) break
    }
    return { items, nextCursor: next }
  }

  /** Today's Refresh encounters: every page shown, read afresh, the list kept on screen while it loads. */
  async function refresh() {
    if (busy) return
    const read = ++reads.current
    setBusy('refresh')
    setProblem(null)
    try {
      await recheck.current()
      const fresh = await readPages(pages.current, undefined, true)
      if (read === reads.current) setState(fresh)
    } catch (caught) {
      if (read !== reads.current) return
      const text = refusalText(caught, 'Please try again.')
      // A list already shown stays; the problem shows under it.
      if (state !== null && !('error' in state)) setProblem({ title: 'Couldn’t refresh visits', text })
      else setState({ error: text })
    } finally {
      if (read === reads.current) setBusy(null)
    }
  }

  /** The next, earlier page, added below the visits shown. */
  async function showMore() {
    if (busy || state === null || 'error' in state || !state.nextCursor) return
    const read = ++reads.current
    const shown = state
    setBusy('more')
    setProblem(null)
    try {
      await recheck.current()
      const page = await staffApi.encounters(facilityId, patientId, { cursor: shown.nextCursor ?? undefined })
      if (read !== reads.current) return
      const seen = new Set(shown.items.map(item => item.id))
      const added = page.items.filter(item => !seen.has(item.id))
      pages.current += 1
      if (!page.nextCursor) focusRow.current = added.length > 0 ? shown.items.length : shown.items.length - 1
      setState({ items: [...shown.items, ...added], nextCursor: page.nextCursor })
    } catch (caught) {
      if (read === reads.current) setProblem({ title: 'Couldn’t load more visits', text: refusalText(caught, 'Please try again.') })
    } finally {
      if (read === reads.current) setBusy(null)
    }
  }

  return <Card>
    <CardHeader as="h2" title="Visits here" description="Only what your role may see" icon={History}
      actions={state !== null ? <Button size="sm" icon={RotateCcw} aria-disabled={busy !== null || undefined}
        aria-busy={busy === 'refresh' || undefined} onClick={() => void refresh()}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</Button> : undefined} />
    {state === null ? <LoadingRows rows={2} label="Loading visits" />
      : 'error' in state ? <div className="p-5"><Alert intent="error" title="Couldn’t load visits">{state.error}</Alert></div>
      : state.items.length === 0 ? <p className="m-0 px-5 py-5 text-[13px] text-ink-3">No visits at this facility yet.{canStart ? ' Start a consultation to begin one.' : ''}</p>
      : <>
        <ul ref={list} className="m-0 list-none divide-y divide-line p-0">{state.items.map(item => <li key={item.id}>
          <ListRow onClick={() => navigate(href.to('consult', item.id))} leading={<IconChip size="sm" icon={Stethoscope} />} title={consultationLabel(item)}
            subtitle={visitSubtitle(item)}
            trailing={<Badge size="sm" tone={item.status === 'in_progress' || item.status === 'open' ? 'brand' : 'neutral'}>{sexText(item.status)}</Badge>} />
        </li>)}</ul>
        {problem ? <div className="border-t border-line px-5 py-3"><Alert intent="error" title={problem.title}>{problem.text}</Alert></div> : null}
        {state.nextCursor ? <div className="border-t border-line px-5 py-3">
          {/* Busy, it stays focusable (aria-disabled, not disabled), so focus stays on it; a press while it reads does nothing. */}
          <Button size="sm" aria-disabled={busy !== null || undefined} aria-busy={busy === 'more' || undefined}
            onClick={() => void showMore()}>{busy === 'more' ? 'Loading more visits…' : 'Show more visits'}</Button>
        </div> : null}
      </>}
  </Card>
}
