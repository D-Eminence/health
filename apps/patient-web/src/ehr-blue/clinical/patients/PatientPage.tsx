import { Activity, ChevronRight, FolderOpen, History, ListChecks, LogOut, Send, ShieldCheck, Siren, Stethoscope, UserPlus } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, IconChip, ListRow, PageHeader } from '../../../kasuwa/ui'
import { CardFace } from '../../../routes/HealthIdCard'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, READ_ONLY, type Chart } from '../parts/chart'
import { ConfirmSheet, LoadingRows, PatientBanner } from '../../../kasuwa/parts'
import { formatDate, formatWhen, shortId } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import type { PatientFacts } from '../parts/PatientHeader'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { isDemoFacility } from '../../blueFacilities'
import { CLOSE_GRANT, CLOSE_REASON, actionUnavailable, administratorOf, offerHealthId } from '../consent/access'
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
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [ending, setEnding] = useState(false)
  const emergency = chart.purpose === 'emergency'
  // Read only (emergency, or a grant without changes): write actions are hidden, not offered as a dead end.
  const readOnly = emergency || chart.writeNotice !== null
  const grantId = chart.patient.lookup.authorization.consentGrantId ?? null
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administratorOf(facility, permissions))
  const expires = chart.patient.lookup.authorization.expiresAt
  const facts = chart.facts
  const about = [ageOf(facts.dateOfBirth), sexText(facts.sex), facts.dateOfBirth ? `born ${formatDate(facts.dateOfBirth)}` : ''].filter(Boolean).join(' · ')

  async function closeGrant() {
    if (!grantId || closeUnavailable || ending) return
    setEnding(true)
    setError('')
    try {
      await staffApi.closeGrant(chart.facilityId, grantId, CLOSE_REASON)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Couldn’t end your access. Please try again.')
      setConfirming(false)
      return
    } finally {
      setEnding(false)
    }
    setActivePatient(null)
    navigate(href(), { state: { notice: CLOSED_NOTICE } })
  }

  /** External record access opens only with identity.consent.write (the frame's rule): only then is the Health ID handed over. */
  function openConsent() {
    if (can('identity.consent.write')) offerHealthId(chart.patient.hid, chart.facilityId, setActivePatient)
    navigate(href.to('consent', 'new'))
  }

  const initials = facts.name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 lg:sticky lg:top-24">
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
          {grantId ? <div className="border-t border-line px-4 py-2.5">
            {closeUnavailable ? <p id="close-grant-unavailable" className="m-0 mb-1.5 text-[12px] text-ink-3">{closeUnavailable}</p> : null}
            <Button variant="danger" size="sm" icon={LogOut} disabled={closeUnavailable !== null} aria-describedby={closeUnavailable ? 'close-grant-unavailable' : undefined}
              onClick={() => setConfirming(true)}>End my access</Button>
          </div> : null}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <PageHeader title={facts.name} description={about || undefined} back={{ to: href(), label: 'Back to find a patient' }}
          actions={emergency ? <Button variant="primary" icon={Siren} onClick={() => navigate(href.to('emergency', 'summary'))}>Open emergency summary</Button>
            : <Button variant="primary" icon={FolderOpen} onClick={() => navigate(href.to('consult'))}>Open chart</Button>} />
        {/* Read only, said once. */}
        {emergency ? <Alert intent="warning" title="View only">{`Emergency access shows the emergency summary only. Nothing can be added or changed for ${facts.name}.`}</Alert>
          : chart.writeNotice ? <Alert intent="info" title="View only">{chart.writeNotice === READ_ONLY
            ? 'You can see this record but not add to it. To make changes, ask the patient to let you see and add to their records.'
            : chart.writeNotice}</Alert> : null}
        {error ? <Alert intent="error" title="Couldn’t end access">{error}</Alert> : null}

        {!emergency ? <Card>
          <CardHeader as="h2" title="Next steps" icon={ListChecks} iconTone="brand" />
          <ul className="m-0 list-none divide-y divide-line p-0">
            {!readOnly ? <>
              <li><ListRow onClick={() => navigate(href.to('consult', 'new'))} leading={<IconChip size="sm" icon={Stethoscope} />} title="Start a consultation" subtitle="Notes, diagnoses and orders in one place" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>
              <li><ListRow onClick={() => navigate(href.to('triage', 'new'))} leading={<IconChip size="sm" icon={Activity} />} title="Record vitals" subtitle="Blood pressure, temperature, pulse, oxygen" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>
            </> : null}
            {/* Appointments and walk-in visits are samples: offered only at the demo facilities. */}
            {isDemoFacility(chart.facilityId) ? <li><ListRow onClick={() => navigate(href.to('journey', 'new'))} leading={<IconChip size="sm" icon={UserPlus} />} title="Register a walk-in visit" subtitle="Sample at demo facilities" trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li> : null}
            <li><ListRow onClick={openConsent} leading={<IconChip size="sm" icon={Send} />} title="Ask for more access" subtitle="More time, or the right to add records. The patient approves." trailing={<ChevronRight className="size-4 text-ink-3" aria-hidden />} /></li>
          </ul>
        </Card> : null}
        {!emergency && chart.can('ehr.encounter.read') ? <EncounterHistory chart={chart} canStart={!readOnly} /> : null}
      </div>
      <ConfirmSheet open={confirming} onClose={() => setConfirming(false)} destructive busy={ending} confirmLabel="End my access"
        title={`End your access to ${facts.name}?`}
        subject={<PatientBanner name={facts.name} hid={facts.hid} dateOfBirth={facts.dateOfBirth} sex={facts.sex} compact />}
        effect="You’ll need the patient’s approval to open their record again."
        onConfirm={() => void closeGrant()} />
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
