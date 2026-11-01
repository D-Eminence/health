import { Activity, ChevronRight, FolderOpen, History, KeyRound, ListChecks, LogOut, Send, ShieldCheck, Siren, Stethoscope, UserPlus } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, IconChip, ListRow, PageHeader } from '../../../kasuwa/ui'
import { CardFace } from '../../../routes/HealthIdCard'
import { isHidApiError } from '@hid/http'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, READ_ONLY, type Chart } from '../parts/chart'
import { LoadingRows } from '../../../kasuwa/parts'
import { formatDate, formatWhen, shortId } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import type { PatientFacts } from '../parts/PatientHeader'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { isDemoFacility } from '../../blueFacilities'
import { useSampleCan } from '../../frame/sampleAccess'
import { CLOSE_GRANT, CLOSE_REASON, METHOD_ROUTES, actionUnavailable, administratorOf, offerHealthId } from '../consent/access'
import type { ActivePatient } from '../../../staff/App'

export const CLOSED_NOTICE = 'closed'

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
  | { readonly scope: string; readonly status: 'shown'; readonly allergies: string | null }

/**
 * The patient-reported allergies, shown on the access card under the patient's Health ID card: what the patient entered in their Health ID portal, as
 * today's "Reported by the patient" reads it (staff/routes/PatientReportedHealth.tsx) and under the same conditions:
 * direct care only, with ehr.note.read, read afresh for each actor, facility, patient, purpose and permission set (today's
 * key), so nothing of another patient's shows. No row while it loads, when EHR refuses it (403) or does not serve it
 * (404), or when the patient has stated nothing; another failure says so in today's words, with today's retry. It is
 * what the patient says, not a clinical finding, and is labelled so.
 */
function useReportedAllergies(chart: Chart): KeyValue | null {
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
        if (!controller.signal.aborted) setReported(profile ? { scope, status: 'shown', allergies: profile.allergies } : { scope, status: 'hidden' })
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
  if (current.status === 'failed') {
    return {
      label: 'Allergies',
      value: (
        <>
          <span>What the patient entered about their health could not be loaded.</span>{' '}
          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-brand-ink underline underline-offset-2" onClick={() => setRevision(value => value + 1)}>
            Retry patient-reported health information
          </button>
        </>
      ),
    }
  }
  return { label: 'Allergies', value: `${current.allergies ?? 'Not stated'} (patient-reported)` }
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
  const allergies = useReportedAllergies(chart)

  async function closeGrant() {
    if (!grantId || closeUnavailable || ending) return
    setEnding(true)
    setError('')
    try {
      await staffApi.closeGrant(chart.facilityId, grantId, CLOSE_REASON)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Couldn’t end your access. Please try again.')
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
            </div>
          </div>
          {/* What the patient entered in their Health ID portal: labelled as theirs, not a clinical finding. */}
          {allergies ? <dl className="m-0 border-t border-line px-4 py-2.5">
            <dt className="text-[12px] text-ink-3">{allergies.label}</dt>
            <dd className="m-0 text-sm text-ink">{allergies.value}</dd>
          </dl> : null}
          {grantId ? <div className="border-t border-line px-4 py-2.5">
            {closeUnavailable ? <p id="close-grant-unavailable" className="m-0 mb-1.5 text-[12px] text-ink-3">{closeUnavailable}</p> : null}
            <Button variant="danger" size="sm" icon={LogOut} disabled={closeUnavailable !== null} aria-describedby={closeUnavailable ? 'close-grant-unavailable' : undefined}
              loading={ending} onClick={() => void closeGrant()}>End my access</Button>
          </div> : null}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <PageHeader title={facts.name} description={about || undefined} back={{ to: href(), label: 'Back to find a patient' }}
          actions={emergency ? <Button variant="primary" icon={Siren} onClick={() => navigate(href.to('emergency', 'summary'))}>Open emergency summary</Button>
            : mayOpenChart ? <Button variant="primary" icon={FolderOpen} onClick={() => navigate(href.to('consult'))}>Open chart</Button> : undefined} />
        {/* Read only, said once. */}
        {emergency ? <Alert intent="warning" title="View only">{`Emergency access shows the emergency summary only. Nothing can be added or changed for ${facts.name}.`}</Alert>
          : chart.writeNotice ? <Alert intent="info" title="View only">{chart.writeNotice === READ_ONLY
            ? 'You can see this record but not add to it. To make changes, ask the patient to let you see and add to their records.'
            : chart.writeNotice}</Alert> : null}
        {error ? <Alert intent="error" title="Couldn’t end access">{error}</Alert> : null}

        {!emergency ? <Card>
          <CardHeader as="h2" title="Next steps" icon={ListChecks} iconTone="brand" />
          <ul className="m-0 list-none divide-y divide-line p-0">
            {mayStart ? <li><ListRow onClick={() => navigate(href.to('consult', 'new'))} leading={<IconChip size="sm" icon={Stethoscope} />} title="Start a consultation" subtitle="Notes, diagnoses and orders in one place" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {mayRecordVitals ? <li><ListRow onClick={() => navigate(href.to('triage', 'new'))} leading={<IconChip size="sm" icon={Activity} />} title="Record vitals" subtitle="Blood pressure, temperature, pulse, oxygen" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {/* Appointments and walk-in visits are samples: offered only at the demo facilities, and only to a design role
                that may create there (sampleAccess.ts), as a role the sample is closed to would land on Home instead. */}
            {isDemoFacility(chart.facilityId) && sampleCan('journey', 'create') ? <li><ListRow onClick={() => navigate(href.to('journey', 'new'))} leading={<IconChip size="sm" icon={UserPlus} />} title="Register a walk-in visit" subtitle="Sample at demo facilities" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {mayOpenConsent ? <li><ListRow onClick={openConsent} leading={<IconChip size="sm" icon={Send} />} title="Ask for more access" subtitle="More time, or the right to add records. The patient approves." trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            {/* At the demo facilities only, like the sample steps: today's portal never offers break-glass on an open
                record, so a real facility keeps it on Find a patient's Obtain access. Shown, as this card's steps are,
                only to a role that may take it. */}
            {isDemoFacility(chart.facilityId) && emergencyUnavailable === null ? <li><ListRow onClick={() => accessStep('emergency')} leading={<IconChip size="sm" icon={Siren} tone="danger" />} title="Emergency access" subtitle="Only if they can’t consent. Time-limited and reviewed." trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
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
        {!emergency && chart.can('ehr.encounter.read') ? <EncounterHistory chart={chart} canStart={mayStart} /> : null}
      </div>
    </div>
  )
}

type HistoryState = { readonly items: readonly Encounter[] } | { readonly error: string } | null

/**
 * This facility's visits for the patient (today's chart list), each opening in Consultation. Read after today's
 * re-check; a refusal there closes the patient and shows that access ended.
 */
function EncounterHistory({ chart, canStart }: { chart: Chart; canStart: boolean }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const [state, setState] = useState<HistoryState>(null)
  const { facilityId, patientId, verify } = chart
  // Read once per patient: the re-check itself may be a new function on each render.
  const recheck = useRef(verify)
  useLayoutEffect(() => { recheck.current = verify })

  useEffect(() => {
    let current = true
    setState(null)
    void (async () => {
      try {
        await recheck.current()
        const page = await staffApi.encounters(facilityId, patientId)
        if (current) setState({ items: page.items })
      } catch (caught) {
        if (current) setState({ error: refusalText(caught, 'Please try again.') })
      }
    })()
    return () => { current = false }
  }, [facilityId, patientId])

  return <Card>
    <CardHeader as="h2" title="Visits here" description="Only what your role may see" icon={History} />
    {state === null ? <LoadingRows rows={2} label="Loading visits" />
      : 'error' in state ? <div className="p-5"><Alert intent="error" title="Couldn’t load visits">{state.error}</Alert></div>
      : state.items.length === 0 ? <p className="m-0 px-5 py-5 text-[13px] text-ink-3">No visits at this facility yet.{canStart ? ' Start a consultation to begin one.' : ''}</p>
      : <ul className="m-0 list-none divide-y divide-line p-0">{state.items.map(item => <li key={item.id}>
          <ListRow onClick={() => navigate(href.to('consult', item.id))} leading={<IconChip size="sm" icon={Stethoscope} />} title={`Consultation · ${shortId(item.id)}`}
            trailing={<Badge size="sm" tone={item.status === 'in_progress' || item.status === 'open' ? 'brand' : 'neutral'}>{sexText(item.status)}</Badge>} />
        </li>)}</ul>}
  </Card>
}
