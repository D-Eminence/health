import { EhrBadge, EhrButton, EhrCard, EhrField, EhrInput, EhrPageHeading, EhrSelect } from '@hid/ui/ehr'
import { ageInYears, formatTimeOrDateTime } from '@hid/ui/display'
import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { dentalApi, visitQueueApi, type DentalVisitsList, type VisitQueueCard } from '../../../staff/api'
import { useChart, type Chart } from '../parts/chart'
import { ErrorBox, Loading } from '../parts/Notices'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { stageText as queueStageText } from '../../departments/waiting/waitingRules'
import {
  COMPLAINT_MAX, DAYS_CHOICES, DEFAULT_COMPLAINT, DENTAL_WRITE, OPEN_PATIENT_FIRST, TITLE, dayText, refusalWords, sexText,
  stageText, stageTone, textProblem,
} from './dentalRules'
import { useDentalRead, useIdempotencyKeys } from './hooks'
import { startTodaysDentalVisit } from './startVisit'

/**
 * The dental clinic's own page for a dentist (DEN-1): the open patient and "Start today's dental visit", the patients
 * the front desk has set the dentist to see on the waiting list (EHR-C7, "Assigned to me"), and this facility's dental
 * visits of today, the last 7 or the last 30 days (route 5). A visit's record opens only for the patient open in the
 * chart, under the usual access (Access PIN or approval): a row gives no access, and visits of patients this member may
 * not read now are counted, never shown. No Health ID in any address: visits by their UUID.
 */
export function DentalHome() {
  const { facility } = useClinical()
  const chart = useChart()
  const facilityId = facility?.id ?? ''
  return (
    <>
      <EhrPageHeading title={TITLE} description="Tooth chart, treatment plan and procedures for outpatient dental visits." />
      <OpenPatient chart={chart} />
      <AssignedToMe facilityId={facilityId} membershipId={facility?.membershipId} />
      <DentalVisits facilityId={facilityId} openPatientId={chart?.purpose === 'direct-care' ? chart.patientId : null} />
    </>
  )
}

function OpenPatient({ chart }: { readonly chart: Chart | null }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const { can } = useClinical()
  const keyFor = useIdempotencyKeys()
  const startedAtFor = useRef(new Map<string, string>())
  const [complaint, setComplaint] = useState('')
  const [problem, setProblem] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!chart || chart.purpose !== 'direct-care') {
    return (
      <EhrCard title="Patient">
        <p>{OPEN_PATIENT_FIRST}</p>
        {can('identity.patient.read') ? <p><Link className="hid-ehr-clinical-link" to={href.to('patients')}>Find a patient</Link></p> : null}
      </EhrCard>
    )
  }
  const open = chart
  const mayStart = open.canWrite && open.can(DENTAL_WRITE) && open.can('ehr.encounter.write')

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const found = textProblem(complaint, COMPLAINT_MAX, true)
    setProblem(found)
    setError('')
    if (found) return
    setBusy(true)
    try {
      const result = await startTodaysDentalVisit(open, complaint.trim() || DEFAULT_COMPLAINT, keyFor, startedAtFor.current)
      if ('refused' in result) setError(result.refused)
      else navigate(href(result.encounterId))
    } finally {
      setBusy(false)
    }
  }

  return (
    <EhrCard title={`Patient: ${open.facts.name}`}>
      {mayStart ? (
        <form className="hid-ehr-clinical-form" noValidate onSubmit={event => void start(event)}>
          <p className="hid-ehr-clinical-note">
            Starts the patient’s outpatient visit today, or continues the one already open, and its dental record.
          </p>
          <EhrField label="Reason for the visit (optional)" hint={`For example: Toothache, lower left. Left empty: “${DEFAULT_COMPLAINT}”.`}
            error={problem || undefined}>
            <EhrInput value={complaint} maxLength={COMPLAINT_MAX + 20} onChange={event => { setComplaint(event.target.value); setProblem('') }} />
          </EhrField>
          {error ? <ErrorBox>{error}</ErrorBox> : null}
          <div className="hid-ehr-clinical-form-footer">
            <EhrButton type="submit" busy={busy}>Start today’s dental visit</EhrButton>
          </div>
        </form>
      ) : (
        <p className="hid-ehr-clinical-note">{open.writeNotice ?? 'You can view this patient’s dental visits but not start one.'}</p>
      )}
    </EhrCard>
  )
}

/**
 * The waiting list's rows the front desk set this dentist to see (0135's assignee), still waiting or being seen. Names
 * and the last 4 characters of the Health ID only: opening the patient still needs their consent.
 */
function AssignedToMe({ facilityId, membershipId }: { readonly facilityId: string; readonly membershipId: string | undefined }) {
  const href = useWorkspaceHref()
  const { can } = useClinical()
  const read = useCallback(() => visitQueueApi.list(facilityId), [facilityId])
  const queue = useDentalRead(`queue:${facilityId}`, facilityId && can('ehr.encounter.read', 'ehr.encounter.write') ? read : null, false)
  if (!can('ehr.encounter.read', 'ehr.encounter.write')) return null
  const mine = queue.state.phase === 'ready'
    ? queue.state.value.items.filter(card => membershipId && card.assignedMembershipId?.toLowerCase() === membershipId.toLowerCase()
      && !['finished', 'left', 'cancelled'].includes(card.stage))
    : []
  return (
    <EhrCard title="Assigned to me" actions={<EhrButton variant="quiet" size="sm" onClick={() => queue.reload()}>Refresh</EhrButton>}>
      {queue.state.phase === 'loading' ? <Loading label="Loading the waiting list…" /> : null}
      {queue.state.phase === 'failed' ? <p className="hid-ehr-clinical-note">The waiting list could not be loaded. Select Refresh to try again.</p> : null}
      {queue.state.phase === 'ready' && mine.length === 0
        ? <p className="hid-ehr-clinical-note">No one on the waiting list is set for you to see.</p> : null}
      {mine.length > 0 ? (
        <>
          <ul className="hid-ehr-clinical-history-list">
            {mine.map(card => <QueueRow key={card.entryId} card={card} />)}
          </ul>
          <p className="hid-ehr-clinical-note">
            To see a patient, find them on <Link className="hid-ehr-clinical-link" to={href.to('patients')}>Patients</Link> and
            open their record with their Access PIN or an approved request, then start today’s dental visit here.
          </p>
        </>
      ) : null}
    </EhrCard>
  )
}

function QueueRow({ card }: { readonly card: VisitQueueCard }) {
  const age = ageInYears(card.dateOfBirth)
  const facts = [card.healthIdLast4 ? `Health ID ending ${card.healthIdLast4}` : '', sexText(card.sex), age === null ? '' : `${age} years`,
    `Checked in ${formatTimeOrDateTime(card.checkedInAt)}`].filter(Boolean).join(' · ')
  return (
    <li className="hid-ehr-clinical-history-row">
      <span>
        <strong>{card.fullName}</strong>
        <span className="hid-ehr-clinical-cell-sub">{facts}</span>
      </span>
      <EhrBadge tone="neutral">{queueStageText(card.stage)}</EhrBadge>
    </li>
  )
}

/** Route 5: this facility's dental visits of the chosen days, newest first. */
function DentalVisits({ facilityId, openPatientId }: { readonly facilityId: string; readonly openPatientId: string | null }) {
  const [days, setDays] = useState(1)
  const read = useCallback(() => dentalApi.visits(facilityId, days), [facilityId, days])
  const list = useDentalRead(`visits:${facilityId}:${days}`, facilityId ? read : null)
  return (
    <EhrCard title="Dental visits" actions={(
      <span className="hid-ehr-dental-toolbar">
        <EhrField label="Show">
          <EhrSelect value={String(days)} onChange={event => setDays(Number(event.target.value))}>
            {DAYS_CHOICES.map(([value, label]) => <option key={value} value={String(value)}>{label}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrButton variant="quiet" size="sm" onClick={() => list.reload()}>Refresh</EhrButton>
      </span>
    )}>
      {list.state.phase === 'loading' ? <Loading label="Loading dental visits…" /> : null}
      {list.state.phase === 'failed' ? <ErrorBox>{refusalWords(list.state.caught, 'Dental visits could not be loaded. Select Refresh to try again.')}</ErrorBox> : null}
      {list.state.phase === 'ready' ? <VisitRows list={list.state.value} openPatientId={openPatientId} /> : null}
    </EhrCard>
  )
}

function VisitRows({ list, openPatientId }: { readonly list: DentalVisitsList; readonly openPatientId: string | null }) {
  const href = useWorkspaceHref()
  return (
    <>
      {list.items.length === 0 ? <p className="hid-ehr-clinical-note">No dental visits in this time.</p> : (
        <ul className="hid-ehr-clinical-history-list">
          {list.items.map(({ patient, visit }) => {
            const age = ageInYears(patient.dateOfBirth)
            const facts = [patient.healthIdLast4 ? `Health ID ending ${patient.healthIdLast4}` : '', sexText(patient.sex),
              age === null ? '' : `${age} years`, `Started ${formatTimeOrDateTime(visit.startedAt)}`,
              visit.followUpOn ? `Follow-up ${dayText(visit.followUpOn)}` : ''].filter(Boolean).join(' · ')
            const opens = openPatientId !== null && openPatientId.toLowerCase() === patient.patientId.toLowerCase()
            return (
              <li key={visit.visitId} className="hid-ehr-clinical-history-row">
                <span>
                  <strong>{patient.fullName}</strong>
                  <span className="hid-ehr-clinical-cell-sub">{facts}</span>
                </span>
                <span className="hid-ehr-clinical-row-actions">
                  <EhrBadge tone={stageTone(visit.stage)}>{stageText(visit.stage)}</EhrBadge>
                  {opens
                    ? <Link className="hid-ehr-clinical-link" to={href(visit.encounterId)}>Open dental record</Link>
                    : <span className="hid-ehr-clinical-cell-sub">Open the patient first</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {list.hiddenCount > 0 ? (
        <p className="hid-ehr-clinical-note">
          {list.hiddenCount === 1 ? '1 more visit is' : `${list.hiddenCount} more visits are`} of patients you can’t open now. They show
          once you have the patient’s agreement.
        </p>
      ) : null}
      {list.hasMore ? <p className="hid-ehr-clinical-note">Only the newest {list.limit} visits are shown.</p> : null}
    </>
  )
}
