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
  DECIDE_REFUSED, EYEBROW, INPATIENT_BASE, canDecide, cardName, isCancelled, lagosDateTime, learnFrom, lengthProblem,
  refusalWords, wardTypeText,
} from './inpatientRules'

const OPEN_VISIT = new Set(['planned', 'in_progress'])
const OPEN_QUEUE = new Set(['waiting', 'triage', 'ready', 'with_clinician'])
const ENCOUNTER_PAIR = ['ehr.encounter.read', 'ehr.encounter.write']

type Source = 'direct' | 'consultation' | 'waiting_list'

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
  const [queueEntry, setQueueEntry] = useState<VisitQueueCard | null>(null)
  const [wards, setWards] = useState<Ward[]>([])
  const [encounterId, setEncounterId] = useState('')
  const [reason, setReason] = useState('')
  const [careTeam, setCareTeam] = useState('')
  const [wardId, setWardId] = useState('')
  const [newborn, setNewborn] = useState(false)
  const [mothers, setMothers] = useState<AdmissionCard[] | null>(null)
  const [motherId, setMotherId] = useState('')
  const [problem, setProblem] = useState('')
  const [refusal, setRefusal] = useState<{ text: string; alreadyOpen: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!patientId) return
    let live = true
    void inpatientApi.wards(facilityId).then(answer => { if (live) setWards(answer.items.filter(ward => ward.active)) }, () => {})
    void staffApi.encounters(facilityId, patientId).then(page => {
      if (live) setVisits(page.items.filter(visit => OPEN_VISIT.has(visit.status) && visit.encounterType !== 'inpatient'))
    }, () => {})
    if (ENCOUNTER_PAIR.every(code => permissions.includes(code))) {
      void visitQueueApi.list(facilityId).then(list => {
        if (live) setQueueEntry(list.items.find(item => item.patientId === patientId && OPEN_QUEUE.has(item.stage)) ?? null)
      }, () => {})
    }
    return () => { live = false }
  }, [facilityId, patientId, permissions])

  useEffect(() => {
    if (!newborn || mothers !== null) return
    let live = true
    void inpatientApi.admissions(facilityId, { wardType: 'maternity' }).then(list => {
      if (live) setMothers(list.items.filter(card => card.status === 'admitted' || card.status === 'discharge_ready'))
    }, () => { if (live) setMothers([]) })
    return () => { live = false }
  }, [newborn, mothers, facilityId])

  if (!canDecide(permissions)) return <DeptUnavailable title="New admission" message={DECIDE_REFUSED} />

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
      : source === 'waiting_list' && !queueEntry ? 'This patient is not on today’s waiting list.' : ''
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
          <label>
            <input type="radio" name="admission-source" checked={source === 'waiting_list'} disabled={!queueEntry}
              onChange={() => setSource('waiting_list')} /> From today’s waiting list{queueEntry ? '' : ' (not on the list)'}
          </label>
        </fieldset>
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
          <EhrField label="Mother’s admission" controlId="new-admission-mother" hint="The two bands carry the same pair code.">
            <EhrSelect value={motherId} onChange={event => setMotherId(event.target.value)}>
              <option value="">{mothers === null ? 'Loading…' : mothers.length === 0 ? 'No mother is admitted on a maternity ward' : 'Choose the mother'}</option>
              {(mothers ?? []).map(card => <option key={card.admissionId} value={card.admissionId}>{`${cardName(card)} (${card.admissionNumber})`}</option>)}
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
