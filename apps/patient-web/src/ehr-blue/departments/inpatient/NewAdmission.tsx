import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  inpatientApi, staffApi, visitQueueApi, type AdmissionCard, type AdmissionRequestInput, type Encounter, type VisitQueueCard,
  type Ward,
} from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { useIdempotencyKeys } from './hooks'
import {
  DECIDE_REFUSED, EYEBROW, INPATIENT_BASE, NOT_AVAILABLE, canDecide, cardName, isCancelled, lagosDateTime, learnFrom, lengthProblem,
  notServed, placeText, refusalWords, useInpatientServed, wardTypeText,
} from './inpatientRules'

const OPEN_VISIT = new Set(['planned', 'in_progress'])
const OPEN_QUEUE = new Set(['waiting', 'triage', 'ready', 'with_clinician'])
const ENCOUNTER_PAIR = ['ehr.encounter.read', 'ehr.encounter.write']

type Source = 'direct' | 'consultation' | 'waiting_list'

/**
 * The patient's place on today's waiting list, looked for only once the doctor chooses it as the source: the list's
 * read (GET ehr/visit-queue, which has no one-patient filter) sends every waiting patient's card and records each as
 * shown to the doctor, so a direct or visit admission never reads it. Kept for the patient it was read for.
 */
type QueueLookup =
  | { readonly state: 'unread' }
  | { readonly state: 'reading'; readonly patientId: string }
  | { readonly state: 'found'; readonly patientId: string; readonly entry: VisitQueueCard }
  | { readonly state: 'absent'; readonly patientId: string }
  | { readonly state: 'failed'; readonly patientId: string }

export const NOT_ON_LIST = 'This patient is not on today’s waiting list. Choose another source.'
export const LIST_NOT_READ = 'Today’s waiting list could not be read.'

/** The patient's open place on today's waiting list, from the list's cards; null when they are not on it. */
export function queueEntryOf(items: readonly VisitQueueCard[], patientId: string): VisitQueueCard | null {
  return items.find(item => item.patientId === patientId && OPEN_QUEUE.has(item.stage)) ?? null
}

/**
 * Whose admission a newborn's may name (Q-ADT-17, route 10's motherAdmissionId): any other patient's open admission here,
 * whatever the ward (a mother moved to ICU, a facility with general wards only) or none yet (waiting for a bed). Those on
 * a maternity ward come first; the backend still checks (MOTHER_ADMISSION_INVALID).
 */
export function motherChoices(cards: readonly AdmissionCard[], patientId: string, wards: readonly Pick<Ward, 'wardId' | 'wardType'>[]): AdmissionCard[] {
  const maternity = new Set(wards.filter(ward => ward.wardType === 'maternity').map(ward => ward.wardId))
  const onMaternity = (card: AdmissionCard) => maternity.has(card.wardId ?? card.requestedWardId ?? '')
  return cards
    .filter(card => card.patientId !== patientId && ['requested', 'admitted', 'discharge_ready'].includes(card.status))
    .map((card, index) => ({ card, index }))
    .sort((a, b) => Number(onMaternity(b.card)) - Number(onMaternity(a.card)) || a.index - b.index)
    .map(item => item.card)
}

/**
 * New admission (ADT-1 route 10, Q184 A and Q185 A): a doctor or clinician asks for an admission for the patient whose
 * record is open in this session under direct care (the request needs write access to the chart). It comes from one of
 * the patient's open visits, their place on today's waiting list, or directly; it carries the reason, the care team,
 * the responsible doctor (the member asking: "Me") and, if known, the ward wanted, and makes the inpatient visit at once.
 * A newborn's admission names the mother's admission, so their bands match. The patient goes by their UUID in the body;
 * the address carries nothing about them.
 */
export function NewAdmission({ facilityId }: { readonly facilityId: string }) {
  const navigate = useNavigate()
  const { permissions, membershipId } = useDeptAccess()
  const { activePatient } = useStaff()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const patient = activePatient?.purpose === 'direct-care' ? activePatient.lookup.patient : null
  const patientId = patient?.patientId ?? ''
  const patientName = patient ? patient.fullName?.trim() || [patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'The open patient' : ''

  const [source, setSource] = useState<Source>('direct')
  const [visits, setVisits] = useState<Encounter[]>([])
  const [lookup, setLookup] = useState<QueueLookup>({ state: 'unread' })
  const queue: QueueLookup = lookup.state !== 'unread' && lookup.patientId === patientId ? lookup : { state: 'unread' }
  const queueEntry = queue.state === 'found' ? queue.entry : null
  const readsQueue = ENCOUNTER_PAIR.every(code => permissions.includes(code))
  const [wards, setWards] = useState<Ward[]>([])
  const [encounterId, setEncounterId] = useState('')
  const [reason, setReason] = useState('')
  const [careTeam, setCareTeam] = useState('')
  const [wardId, setWardId] = useState('')
  const [newborn, setNewborn] = useState(false)
  const [openAdmissions, setOpenAdmissions] = useState<AdmissionCard[] | null>(null)
  const mothers = openAdmissions === null ? null : motherChoices(openAdmissions, patientId, wards)
  const [motherId, setMotherId] = useState('')
  const [problem, setProblem] = useState('')
  const [refusal, setRefusal] = useState<{ text: string; alreadyOpen: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // Inpatient care switched off (503) or an ehr-api without it (404): said at once, before any form is filled in.
  const served = useInpatientServed()
  const [notAvailable, setNotAvailable] = useState(false)
  const unavailable = served === false || notAvailable

  useEffect(() => {
    if (!patientId) return
    let live = true
    void inpatientApi.wards(facilityId).then(answer => {
      learnFrom()
      if (live) { setWards(answer.items.filter(ward => ward.active)); setNotAvailable(false) }
    }, caught => {
      if (isCancelled(caught)) return
      learnFrom(caught)
      if (live && notServed(caught)) setNotAvailable(true)
    })
    void staffApi.encounters(facilityId, patientId).then(page => {
      if (live) setVisits(page.items.filter(visit => OPEN_VISIT.has(visit.status) && visit.encounterType !== 'inpatient'))
    }, () => {})
    return () => { live = false }
  }, [facilityId, patientId])

  /** Looks for the patient on today's waiting list (once per patient; again after a failed read). */
  function findOnList() {
    if (!patientId || queue.state === 'reading' || queue.state === 'found' || queue.state === 'absent') return
    const forPatient = patientId
    setLookup({ state: 'reading', patientId: forPatient })
    const settle = (next: QueueLookup) => setLookup(previous => previous.state === 'reading' && previous.patientId === forPatient ? next : previous)
    void visitQueueApi.list(facilityId).then(list => {
      const entry = queueEntryOf(list.items, forPatient)
      settle(entry ? { state: 'found', patientId: forPatient, entry } : { state: 'absent', patientId: forPatient })
    }, () => settle({ state: 'failed', patientId: forPatient }))
  }

  useEffect(() => {
    if (!newborn || openAdmissions !== null) return
    let live = true
    void inpatientApi.admissions(facilityId, { status: 'open' }).then(list => {
      if (live) setOpenAdmissions(list.items)
    }, () => { if (live) setOpenAdmissions([]) })
    return () => { live = false }
  }, [newborn, openAdmissions, facilityId])

  if (!canDecide(permissions)) return <DeptUnavailable title="New admission" message={DECIDE_REFUSED} />

  if (unavailable) {
    return (
      <DeptPage eyebrow={EYEBROW} title="New admission" onBack={() => navigate(INPATIENT_BASE)} backLabel="Back to the list">
        <DeptNotice role="alert" tone="info">{NOT_AVAILABLE}</DeptNotice>
      </DeptPage>
    )
  }

  if (!patient) {
    return (
      <DeptPage eyebrow={EYEBROW} title="New admission" onBack={() => navigate(INPATIENT_BASE)} backLabel="Back to the list">
        <DeptNotice tone="info" title="Open the patient’s record first">
          Find the patient on <Link className="hid-ehr-dept-link" to="/provider/patients">Patients</Link> and open their record, then select Request admission there.
        </DeptNotice>
      </DeptPage>
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !membershipId) return
    const reasonProblem = lengthProblem(reason, 1, 300, 'the admission reason')
    const teamProblem = careTeam.trim() ? lengthProblem(careTeam, 1, 80, 'the care team') : ''
    const sourceProblem = source === 'consultation' && !encounterId ? 'Choose the visit the admission comes from.'
      : source === 'waiting_list' && !queueEntry ? listProblem(queue) : ''
    const motherProblem = newborn && !motherId ? 'Choose the mother’s admission.' : ''
    const first = reasonProblem || teamProblem || sourceProblem || motherProblem
    if (first) { setProblem(first); focus('new-admission-problem'); return }
    setProblem(''); setRefusal(null)
    const body: AdmissionRequestInput = {
      patientId, source, reason: reason.trim(), responsibleMembershipId: membershipId,
      ...(source === 'consultation' ? { fromEncounterId: encounterId } : {}),
      ...(source === 'waiting_list' && queueEntry ? { visitQueueEntryId: queueEntry.entryId } : {}),
      ...(careTeam.trim() ? { careTeam: careTeam.trim() } : {}),
      ...(wardId ? { requestedWardId: wardId } : {}),
      ...(newborn && motherId ? { motherAdmissionId: motherId } : {}),
    }
    setBusy(true)
    try {
      const answer = await inpatientApi.requestAdmission(facilityId, body, keyFor('request', body))
      learnFrom()
      navigate(`${INPATIENT_BASE}/${answer.admission.admissionId}`)
    } catch (caught) {
      if (isCancelled(caught)) return
      learnFrom(caught)
      setRefusal({ text: refusalWords(caught, 'The admission could not be requested. Try again.', 'Check the admission’s details.'),
        alreadyOpen: isHidApiError(caught) && caught.code === 'ADMISSION_ALREADY_OPEN' })
      focus('new-admission-refusal')
    } finally { setBusy(false) }
  }

  return (
    <DeptPage eyebrow={EYEBROW} title="New admission" onBack={() => navigate(INPATIENT_BASE)} backLabel="Back to the list"
      description="The request makes the patient’s inpatient visit at once, so orders written before a bed is found go on the stay.">
      <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Request an admission">
        <DeptNotice tone="info" title="Patient">{patientName}</DeptNotice>
        <fieldset className="hid-ehr-dept-inpatient-choices">
          <legend>Where does the admission come from?</legend>
          <label><input type="radio" name="admission-source" checked={source === 'direct'} onChange={() => setSource('direct')} /> Direct admission</label>
          <label>
            <input type="radio" name="admission-source" checked={source === 'consultation'} disabled={visits.length === 0}
              onChange={() => setSource('consultation')} /> From a visit{visits.length === 0 ? ' (no open visit)' : ''}
          </label>
          {readsQueue ? (
            <label>
              <input type="radio" name="admission-source" checked={source === 'waiting_list'}
                onChange={() => { setSource('waiting_list'); findOnList() }} /> From today’s waiting list
            </label>
          ) : null}
        </fieldset>
        {source === 'waiting_list' ? <QueueStatus queue={queue} onRetry={findOnList} /> : null}
        {source === 'consultation' ? (
          <EhrField label="Visit" controlId="new-admission-visit">
            <EhrSelect value={encounterId} onChange={event => setEncounterId(event.target.value)}>
              <option value="">Choose the visit</option>
              {visits.map(visit => <option key={visit.id} value={visit.id}>{`${lagosDateTime(visit.startedAt)}${visit.chiefComplaint ? `: ${visit.chiefComplaint}` : ''}`}</option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
        <div className="hid-ehr-dept-form-grid">
          <EhrField label="Admission reason" controlId="new-admission-reason" hint="Up to 300 characters.">
            <EhrTextarea value={reason} rows={2} maxLength={300} onChange={event => setReason(event.target.value)} />
          </EhrField>
          <EhrField label="Assigned care team (optional)" controlId="new-admission-team">
            <EhrInput value={careTeam} maxLength={80} onChange={event => setCareTeam(event.target.value)} />
          </EhrField>
          <EhrField label="Ward wanted (optional)" controlId="new-admission-ward">
            <EhrSelect value={wardId} onChange={event => setWardId(event.target.value)}>
              <option value="">Any ward</option>
              {wards.map(ward => <option key={ward.wardId} value={ward.wardId}>{`${ward.name} (${wardTypeText(ward.wardType)}): ${ward.available} free`}</option>)}
            </EhrSelect>
          </EhrField>
        </div>
        <p className="hid-ehr-dept-inpatient-hint">Responsible doctor: you. Another doctor can take over with Change details on the admission.</p>
        <label className="hid-ehr-dept-inpatient-choices">
          <span><input type="checkbox" checked={newborn} onChange={event => setNewborn(event.target.checked)} /> This is a newborn baby of a mother admitted here</span>
        </label>
        {newborn ? (
          <EhrField label="Mother’s admission" controlId="new-admission-mother" hint="Any ward, maternity first. The two bands carry the same pair code.">
            <EhrSelect value={motherId} onChange={event => setMotherId(event.target.value)}>
              <option value="">{mothers === null ? 'Loading…' : mothers.length === 0 ? 'No other patient is admitted or waiting for a bed here' : 'Choose the mother'}</option>
              {(mothers ?? []).map(card => <option key={card.admissionId} value={card.admissionId}>
                {`${cardName(card)} (${[card.admissionNumber, placeText(card) || 'waiting for a bed'].join(', ')})`}
              </option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
        {problem ? <DeptNotice id="new-admission-problem" tabIndex={-1} role="alert" tone="critical">{problem}</DeptNotice> : null}
        {refusal ? (
          <DeptNotice id="new-admission-refusal" tabIndex={-1} role="alert" tone="critical">
            {refusal.text}
            {refusal.alreadyOpen ? <> <Link className="hid-ehr-dept-link" to={INPATIENT_BASE}>Find their admission on the list</Link></> : null}
          </DeptNotice>
        ) : null}
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" busy={busy}>Request admission</EhrButton>
          <EhrButton variant="quiet" onClick={() => navigate(INPATIENT_BASE)}>Cancel</EhrButton>
        </div>
      </form>
    </DeptPage>
  )
}

function listProblem(queue: QueueLookup): string {
  if (queue.state === 'absent') return NOT_ON_LIST
  if (queue.state === 'failed') return `${LIST_NOT_READ} Try again, or choose another source.`
  return 'Wait while today’s waiting list is checked.'
}

/** What looking for the patient on today's waiting list found, said under the choice. */
function QueueStatus({ queue, onRetry }: { readonly queue: QueueLookup; readonly onRetry: () => void }) {
  if (queue.state === 'found') return <p className="hid-ehr-dept-inpatient-hint" role="status">This patient is on today’s waiting list.</p>
  if (queue.state === 'absent') return <DeptNotice role="status" tone="caution">{NOT_ON_LIST}</DeptNotice>
  if (queue.state === 'failed') {
    return (
      <DeptNotice role="alert" tone="critical">
        {LIST_NOT_READ} <EhrButton size="sm" variant="secondary" onClick={onRetry}>Try again</EhrButton>
      </DeptNotice>
    )
  }
  if (queue.state === 'unread') {
    // Another patient's record was opened since: their place is looked for afresh.
    return <p className="hid-ehr-dept-inpatient-hint"><EhrButton size="sm" variant="secondary" onClick={onRetry}>Check today’s waiting list</EhrButton></p>
  }
  return <p className="hid-ehr-state-message" role="status">Checking today’s waiting list…</p>
}
