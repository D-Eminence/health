import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  edBoardApi, type EdCard, type EdDispositionInput, type EdOpenStage, type EdOutcome, type EdRecord, type EdWritten,
} from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { NO_TRIAGE_LEVEL, TRIAGE_HINT, TRIAGE_LEVELS, triageText } from '../parts/triageLevels'
import { EdBadges, EdIdentity } from './EmergencyDepartment'
import {
  ADMIT_DEPARTMENTS, ARRIVAL_BASIS_WORDS, BASE, COMPLAINT_MAX, EYEBROW, FACILITY_NAME_MAX, FACILITY_NAME_MIN, KEEPS_ON_BOARD,
  MOVE_STAGES, OUTCOMES, OUTCOME_HINTS, OUTCOME_WORDS, REASON_MAX, RELOAD_AFTER, arrivalModeText, canArrive, canDecide,
  canTriage, cardName, complaintProblem, complaintText, departmentText, historyText, lagosDateTime, lagosTime, leaveLabel,
  learnFrom, memberText, minutesText, notServed, reasonProblem, refusalWords, stageText, statusWords, visitAttempt,
} from './edRules'
import { useIdempotencyKeys, useStaffNames } from './hooks'

type Action = 'triage' | 'move' | 'disposition' | 'cancel' | null
interface Notice { readonly tone: DeptNoticeTone; readonly text: string }

/**
 * One patient's emergency department record (ED-1 route 3): the card, its history and the actions the member's role
 * has: Triage and Start care (nurses, clinicians, doctors), Record where they go next (clinicians and doctors), Left the
 * department or Handed over to the ward, Cancel arrival (the front desk too), and the visit link once the chart is open
 * under the usual access. Every write sends the row version the card showed; a change someone else made first answers
 * 412 and the record is read again.
 */
export function EdRecordPage({ facilityId, attendanceId }: { readonly facilityId: string; readonly attendanceId: string }) {
  const navigate = useNavigate()
  const { permissions, membershipId } = useDeptAccess()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [record, setRecord] = useState<EdRecord | null>(null)
  const [loadError, setLoadError] = useState<{ text: string; unavailable: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<Action>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const answer = await edBoardApi.record(facilityId, attendanceId)
      learnFrom()
      setRecord(answer)
      setLoadError(null)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      setLoadError({ text: refusalWords(caught, 'This patient’s record could not be loaded. Try again.'), unavailable: notServed(caught) })
    } finally { setLoading(false) }
  }, [facilityId, attendanceId])

  useEffect(() => { void load() }, [load])

  const card = record?.attendance ?? null
  const names = useStaffNames(facilityId, [card?.assignedMembershipId, card?.triagedByMembershipId, card?.disposition?.decidedByMembershipId,
    card?.disposition?.admittingMembershipId, ...(record?.history ?? []).map(event => event.byMembershipId)])

  /** Sends one write with its own key per body; a stale card reloads, every answer shows the new card at once. */
  async function write(name: string, body: unknown, send: (key: string) => Promise<EdWritten>, done: string, invalid?: string) {
    if (busy || !card) return
    setBusy(true)
    try {
      const answer = await send(keyFor(`${name}:${card.attendanceId}:${card.rowVersion}`, body))
      setRecord(previous => previous ? { ...previous, attendance: answer.attendance } : previous)
      setAction(null)
      setNotice({ tone: 'positive', text: done })
      void load()
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      const reload = isHidApiError(caught) && RELOAD_AFTER.has(caught.code)
      if (reload) { setAction(null); void load() }
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The change could not be saved. Try again.', invalid) })
    } finally {
      setBusy(false)
      focus('ed-record-notice')
    }
  }

  if (!card) {
    return (
      <DeptPage eyebrow={EYEBROW} title="Emergency department record" onBack={() => navigate(BASE)} backLabel="Back to the board">
        {loadError ? <DeptNotice role="alert" tone={loadError.unavailable ? 'info' : 'critical'}>{loadError.text}</DeptNotice> : null}
        {loading && !loadError ? <p className="hid-ehr-state-message" role="status">Loading the patient’s record…</p> : null}
      </DeptPage>
    )
  }

  const name = cardName(card)
  const triages = canTriage(permissions)
  const decides = canDecide(permissions)
  const open = card.status === 'open'
  const decided = card.status === 'decided'
  const mine = membershipId !== undefined && card.assignedMembershipId?.toLowerCase() === membershipId.toLowerCase()
  const startsCare = triages && open && !(card.stage === 'with_clinician' && mine)
  const cancels = canArrive(permissions) && open && card.encounterId === null && card.disposition === null

  const toggle = (next: Exclude<Action, null>) => setAction(value => value === next ? null : next)

  return (
    <DeptPage eyebrow={EYEBROW} title={name} onBack={() => navigate(BASE)} backLabel="Back to the board"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()} busy={loading}>Refresh</EhrButton>}>
      {notice ? <DeptNotice id="ed-record-notice" tabIndex={-1} role={notice.tone === 'critical' ? 'alert' : 'status'}
        tone={notice.tone} variant="box">{notice.text}</DeptNotice> : null}
      {loadError && record ? <DeptNotice role="alert" tone="critical">{loadError.text}</DeptNotice> : null}

      <DeptSection title="Patient" headingId="ed-record-patient">
        <EdIdentity card={card} />
        <EdBadges card={card} />
        <dl className="hid-ehr-dept-waiting-facts hid-ehr-dept-emergency-facts">
          <div><dt>Arrived</dt><dd>{lagosDateTime(card.arrivedAt)}</dd></div>
          <div><dt>In the department</dt><dd>{minutesText(card.minutesInDepartment)}</dd></div>
          <div><dt>How they came</dt><dd>{arrivalModeText(card.arrivalMode)}</dd></div>
          <div><dt>Added</dt><dd>{ARRIVAL_BASIS_WORDS[card.arrivalBasis] ?? ''}</dd></div>
          <div><dt>Stage</dt><dd>{card.status === 'open' ? stageText(card.stage) : statusWords(card)}</dd></div>
          <div><dt>Triage</dt><dd>{triageText(card.triageLevel)}{card.triagedAt ? `, ${lagosTime(card.triagedAt)} by ${memberText(card.triagedByMembershipId, membershipId, names, 'a staff member')}` : ''}</dd></div>
          <div><dt>Complaint</dt><dd>{complaintText(card)}</dd></div>
          <div><dt>Seen by</dt><dd>{memberText(card.assignedMembershipId, membershipId, names)}</dd></div>
          <div><dt>Visit</dt><dd>{card.encounterId ? 'Linked' : 'Not linked yet'}</dd></div>
          {card.disposition ? <div><dt>Decision</dt><dd>{dispositionText(card, membershipId, names)}</dd></div> : null}
          {card.leftAt ? <div><dt>Left</dt><dd>{lagosDateTime(card.leftAt)}</dd></div> : null}
        </dl>
        <ChartLink card={card} />
      </DeptSection>

      {open || decided ? (
        <DeptSection title="What to do next" headingId="ed-record-actions">
          <div className="hid-ehr-dept-emergency-actions">
            {triages && open ? (
              <EhrButton variant="secondary" aria-expanded={action === 'triage'} onClick={() => toggle('triage')}>Triage</EhrButton>
            ) : null}
            {startsCare && membershipId ? (
              <EhrButton busy={busy} onClick={() => {
                const body = { stage: 'with_clinician' as const, assignedMembershipId: membershipId }
                void write('move', body, key => edBoardApi.move(facilityId, card, body, key), `${name}: you are seeing them now.`)
              }}>Start care</EhrButton>
            ) : null}
            {triages && open ? (
              <EhrButton variant="secondary" aria-expanded={action === 'move'} onClick={() => toggle('move')}>Move</EhrButton>
            ) : null}
            {decides ? (
              <EhrButton variant={open ? 'primary' : 'secondary'} aria-expanded={action === 'disposition'} onClick={() => toggle('disposition')}>
                {open ? 'Record where they go next' : 'Change the decision'}
              </EhrButton>
            ) : null}
            {triages && decided ? (
              <EhrButton busy={busy} onClick={() => {
                const body = {}
                void write('leave', body, key => edBoardApi.leave(facilityId, card, key), `${name} has left the department.`)
              }}>{leaveLabel(card)}</EhrButton>
            ) : null}
            {cancels ? (
              <EhrButton variant="quiet" aria-expanded={action === 'cancel'} onClick={() => toggle('cancel')}>Cancel arrival</EhrButton>
            ) : null}
          </div>
          {!triages && !decides ? (
            <p className="hid-ehr-dept-waiting-hint">Nurses, clinicians and doctors triage and move patients. Clinicians and doctors record where they go next.</p>
          ) : null}

          {action === 'triage' ? (
            <TriageForm card={card} busy={busy} onCancel={() => setAction(null)} onSave={body => void write('triage', body,
              key => edBoardApi.triage(facilityId, card, body, key), `${name}: ${triageText(body.triageLevel).toLowerCase()}.`,
              'Choose a triage level from 1 to 5, and keep the complaint to 120 characters.')} />
          ) : null}
          {action === 'move' ? (
            <MoveForm card={card} membershipId={membershipId} busy={busy} onCancel={() => setAction(null)} onSave={body => void write('move', body,
              key => edBoardApi.move(facilityId, card, body, key), `${name}: saved.`, 'Choose a stage or who will see the patient.')} />
          ) : null}
          {action === 'disposition' ? (
            <DispositionForm card={card} membershipId={membershipId} busy={busy} onCancel={() => setAction(null)}
              onSave={body => void write('disposition', body, key => edBoardApi.disposition(facilityId, card, body, key),
                `${name}: ${OUTCOME_WORDS[body.outcome].toLowerCase()}.`, 'Check the decision’s details.')} />
          ) : null}
          {action === 'cancel' ? (
            <CancelForm busy={busy} onCancel={() => setAction(null)} onSave={reason => void write('cancel', { reason },
              key => edBoardApi.cancel(facilityId, card, reason, key), `${name}’s arrival is cancelled.`, 'Say why in at least 8 characters.')} />
          ) : null}
          {triages ? <VisitLink card={card} facilityId={facilityId} busy={busy} write={write} /> : null}
        </DeptSection>
      ) : null}

      <DeptSection title="History" headingId="ed-record-history">
        {record && record.history.length > 0 ? (
          <ol className="hid-ehr-dept-emergency-history">
            {record.history.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span className="hid-ehr-dept-emergency-history-when">{lagosDateTime(event.at)}</span>
                <span>{historyText(event)}</span>
                <span className="hid-ehr-dept-emergency-history-who">{memberText(event.byMembershipId, membershipId, names, '')}</span>
                {event.reason ? <span className="hid-ehr-dept-emergency-history-reason">Reason: {event.reason}</span> : null}
              </li>
            ))}
          </ol>
        ) : <p className="hid-ehr-state-message">Nothing recorded yet.</p>}
      </DeptSection>
    </DeptPage>
  )
}

function dispositionText(card: EdCard, membershipId: string | undefined, names: ReadonlyMap<string, string | null>): string {
  const decision = card.disposition
  if (!decision) return ''
  const parts = [OUTCOME_WORDS[decision.outcome] ?? statusWords(card)]
  if (decision.admitToDepartmentCode) parts.push(`to ${departmentText(decision.admitToDepartmentCode)}`)
  if (decision.admittingMembershipId) parts.push(`under ${memberText(decision.admittingMembershipId, membershipId, names)}`)
  if (decision.referredToFacilityName) parts.push(`to ${decision.referredToFacilityName}`)
  const when = lagosTime(decision.decidedAt)
  return `${parts.join(' ')}${when ? `, ${when}` : ''}`
}

/**
 * The patient's chart and record: the board gives no access, so the chart opens from Patients as usual (the Health ID,
 * or for an unknown patient the one on their wristband). The patient's id is never put in the address.
 */
function ChartLink({ card }: { readonly card: EdCard }) {
  return (
    <p className="hid-ehr-dept-waiting-hint">
      {card.recordKind === 'unknown'
        ? <>This is an unknown patient’s record. <Link className="hid-ehr-dept-link" to="/provider/patients">Open it on Patients</Link> with the Health ID on their wristband, to see the chart and to identify them once you know who they are.</>
        : <>The board does not open the chart. <Link className="hid-ehr-dept-link" to="/provider/patients">Open the chart on Patients</Link> as usual.</>}
    </p>
  )
}

/**
 * The visit link (route 6): once the patient's chart is open in this session under the usual access, their emergency visit
 * today (EHR-C1, reusing the open visit) is linked to the record. Never reads clinical content; the assessment itself is
 * written in Consultation.
 */
function VisitLink({ card, facilityId, busy, write }: {
  readonly card: EdCard
  readonly facilityId: string
  readonly busy: boolean
  readonly write: (name: string, body: unknown, send: (key: string) => Promise<EdWritten>, done: string, invalid?: string) => Promise<void>
}) {
  const { activePatient } = useStaff()
  const keyFor = useIdempotencyKeys()
  // One start time per attempt to link, kept while the page is open (visitAttempt): a retry is the same request.
  const startedAtFor = useRef(new Map<string, string>())
  const [problem, setProblem] = useState('')
  const opened = activePatient?.purpose === 'direct-care' && activePatient.lookup.patient.patientId === card.patientId
  const label = card.encounterId ? 'Link today’s emergency visit again' : 'Link today’s emergency visit'

  if (!opened) {
    return (
      <p className="hid-ehr-dept-waiting-hint">
        {card.encounterId ? 'The visit is linked.' : 'No visit is linked yet.'} To link today’s emergency visit, open the patient’s chart on Patients first, then come back here.
      </p>
    )
  }

  async function link() {
    setProblem('')
    let encounterId: string
    try {
      const { startedAt, keyBody } = visitAttempt(card, startedAtFor.current)
      const visit = await edBoardApi.emergencyVisit(facilityId, card.patientId, startedAt, keyFor('visit', keyBody))
      encounterId = visit.id
    } catch (caught) {
      setProblem(refusalWords(caught, 'The emergency visit could not be started. Try again.'))
      return
    }
    await write('visit', { encounterId }, key => edBoardApi.linkVisit(facilityId, card, encounterId, key), 'Today’s emergency visit is linked.',
      'Choose a visit of this patient at this facility, started for this arrival.')
  }

  return (
    <div className="hid-ehr-dept-emergency-visit">
      <EhrButton variant="secondary" busy={busy} onClick={() => void link()}>{label}</EhrButton>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
    </div>
  )
}

function TriageForm({ card, busy, onSave, onCancel }: {
  readonly card: EdCard
  readonly busy: boolean
  readonly onSave: (body: { triageLevel: number; presentingComplaint?: string | null }) => void
  readonly onCancel: () => void
}) {
  const [level, setLevel] = useState(card.triageLevel === null ? '' : String(card.triageLevel))
  const [complaint, setComplaint] = useState(card.presentingComplaint ?? '')
  const [problem, setProblem] = useState('')

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (level === '') { setProblem('Choose a triage level from 1 to 5.'); return }
    const wrong = complaintProblem(complaint)
    if (wrong) { setProblem(wrong); return }
    const trimmed = complaint.trim()
    const before = card.presentingComplaint ?? ''
    const body: { triageLevel: number; presentingComplaint?: string | null } = { triageLevel: Number(level) }
    // Only a changed complaint is sent: left out keeps it, null clears it.
    if (trimmed !== before) body.presentingComplaint = trimmed === '' ? null : trimmed
    setProblem('')
    onSave(body)
  }

  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={save} aria-label="Triage">
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="Triage level" controlId="ed-triage-level" hint={TRIAGE_HINT}>
          <EhrSelect value={level} onChange={event => setLevel(event.target.value)}>
            <option value="">{NO_TRIAGE_LEVEL}</option>
            {TRIAGE_LEVELS.map(value => <option key={value} value={String(value)}>{triageText(value)}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Presenting complaint (optional)" controlId="ed-triage-complaint" hint="A few words, for example Fall, left leg pain.">
          <EhrInput value={complaint} onChange={event => setComplaint(event.target.value)} maxLength={COMPLAINT_MAX} autoComplete="off" />
        </EhrField>
      </div>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Cancel</EhrButton>
        <EhrButton type="submit" busy={busy}>Save triage</EhrButton>
      </div>
    </form>
  )
}

const KEEP = 'keep'
const MINE = 'mine'
const NOBODY = 'nobody'

function MoveForm({ card, membershipId, busy, onSave, onCancel }: {
  readonly card: EdCard
  readonly membershipId: string | undefined
  readonly busy: boolean
  readonly onSave: (body: { stage?: EdOpenStage; assignedMembershipId?: string | null }) => void
  readonly onCancel: () => void
}) {
  const mine = membershipId !== undefined && card.assignedMembershipId?.toLowerCase() === membershipId.toLowerCase()
  const initialWho = card.assignedMembershipId === null ? NOBODY : mine ? MINE : KEEP
  const [stage, setStage] = useState<string>(card.stage)
  const [who, setWho] = useState(initialWho)
  const [problem, setProblem] = useState('')

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body: { stage?: EdOpenStage; assignedMembershipId?: string | null } = {}
    if (stage !== card.stage) body.stage = stage as EdOpenStage
    if (who !== initialWho) {
      if (who === NOBODY) body.assignedMembershipId = null
      else if (who === MINE && membershipId) body.assignedMembershipId = membershipId
    }
    if (Object.keys(body).length === 0) { setProblem('Choose a stage or who will see the patient.'); return }
    setProblem('')
    onSave(body)
  }

  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={save} aria-label="Move">
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="Stage" controlId="ed-move-stage">
          <EhrSelect value={stage} onChange={event => setStage(event.target.value)}>
            {MOVE_STAGES.map(value => <option key={value} value={value}>{stageText(value)}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Who will see them" controlId="ed-move-who">
          <EhrSelect value={who} onChange={event => setWho(event.target.value)}>
            <option value={NOBODY}>No one yet</option>
            <option value={MINE}>Me</option>
            {initialWho === KEEP ? <option value={KEEP}>Another staff member (keep)</option> : null}
          </EhrSelect>
        </EhrField>
      </div>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Cancel</EhrButton>
        <EhrButton type="submit" busy={busy}>Save</EhrButton>
      </div>
    </form>
  )
}

function DispositionForm({ card, membershipId, busy, onSave, onCancel }: {
  readonly card: EdCard
  readonly membershipId: string | undefined
  readonly busy: boolean
  readonly onSave: (body: EdDispositionInput) => void
  readonly onCancel: () => void
}) {
  const changing = card.status === 'decided'
  const [outcome, setOutcome] = useState<EdOutcome | ''>(changing ? card.disposition?.outcome ?? '' : '')
  const [department, setDepartment] = useState(card.disposition?.admitToDepartmentCode ?? '')
  const [admitting, setAdmitting] = useState(card.disposition?.admittingMembershipId ? KEEP : NOBODY)
  const [facilityName, setFacilityName] = useState(card.disposition?.referredToFacilityName ?? '')
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (outcome === '') { setProblem('Choose where the patient goes next.'); return }
    const body: EdDispositionInput = { outcome }
    if (outcome === 'admit_requested') {
      if (!department) { setProblem('Choose a department of this facility to admit the patient to.'); return }
      body.admitToDepartmentCode = department
      if (admitting === MINE && membershipId) body.admittingMembershipId = membershipId
      else if (admitting === KEEP && card.disposition?.admittingMembershipId) body.admittingMembershipId = card.disposition.admittingMembershipId
    }
    if (outcome === 'referred_out') {
      const named = facilityName.trim()
      if (named.length < FACILITY_NAME_MIN || named.length > FACILITY_NAME_MAX) {
        setProblem(`Enter the facility’s name (${FACILITY_NAME_MIN} to ${FACILITY_NAME_MAX} characters).`)
        return
      }
      body.referredToFacilityName = named
    }
    if (changing) {
      const wrong = reasonProblem(reason)
      if (wrong) { setProblem(wrong); return }
      body.reason = reason.trim()
    }
    setProblem('')
    onSave(body)
  }

  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={save} aria-label={changing ? 'Change the decision' : 'Record where they go next'}>
      <fieldset className="hid-ehr-dept-emergency-outcomes">
        <legend>Where the patient goes next</legend>
        {OUTCOMES.map(value => (
          <label key={value} className="hid-ehr-dept-emergency-outcome">
            <input type="radio" name="ed-outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
            <span>
              <strong>{OUTCOME_WORDS[value]}</strong>
              <span className="hid-ehr-dept-waiting-hint">{OUTCOME_HINTS[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {outcome === 'admit_requested' ? (
        <div className="hid-ehr-dept-form-grid">
          <EhrField label="Admit to" controlId="ed-admit-department" hint="Wards are not on Health ID yet: the patient waits in Disposition until handed over.">
            <EhrSelect value={department} onChange={event => setDepartment(event.target.value)}>
              <option value="">Choose a department</option>
              {ADMIT_DEPARTMENTS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Admitting doctor (optional)" controlId="ed-admitting">
            <EhrSelect value={admitting} onChange={event => setAdmitting(event.target.value)}>
              <option value={NOBODY}>Not chosen yet</option>
              <option value={MINE}>Me</option>
              {card.disposition?.admittingMembershipId ? <option value={KEEP}>The doctor already chosen (keep)</option> : null}
            </EhrSelect>
          </EhrField>
        </div>
      ) : null}
      {outcome === 'referred_out' ? (
        <EhrField label="Referred to" controlId="ed-referred-to" hint="The other facility’s name.">
          <EhrInput value={facilityName} onChange={event => setFacilityName(event.target.value)} maxLength={FACILITY_NAME_MAX} autoComplete="off" />
        </EhrField>
      ) : null}
      {outcome !== '' && !KEEPS_ON_BOARD.has(outcome) && !changing ? (
        <DeptNotice tone="caution">{OUTCOME_HINTS[outcome]}</DeptNotice>
      ) : null}
      {changing ? (
        <EhrField label="Why the decision changed" controlId="ed-disposition-reason" hint="At least 8 characters.">
          <EhrTextarea rows={3} value={reason} onChange={event => setReason(event.target.value)} maxLength={REASON_MAX} />
        </EhrField>
      ) : null}
      <p className="hid-ehr-dept-waiting-hint">Write the follow-up in the visit’s note in Consultation.</p>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Cancel</EhrButton>
        <EhrButton type="submit" busy={busy}>{changing ? 'Save the new decision' : 'Save the decision'}</EhrButton>
      </div>
    </form>
  )
}

function CancelForm({ busy, onSave, onCancel }: {
  readonly busy: boolean
  readonly onSave: (reason: string) => void
  readonly onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const wrong = reasonProblem(reason)
    if (wrong) { setProblem(wrong); return }
    setProblem('')
    onSave(reason.trim())
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={save} aria-label="Cancel arrival">
      <p className="hid-ehr-dept-waiting-hint">Only for an arrival added in error. The record is kept.</p>
      <EhrField label="Why it is cancelled" controlId="ed-cancel-reason" hint="At least 8 characters.">
        <EhrTextarea rows={3} value={reason} onChange={event => setReason(event.target.value)} maxLength={REASON_MAX} />
      </EhrField>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Keep the arrival</EhrButton>
        <EhrButton type="submit" variant="danger" busy={busy}>Cancel arrival</EhrButton>
      </div>
    </form>
  )
}
