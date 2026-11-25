import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { appointmentsApi, type AppointmentCard, type AppointmentHistoryEntry, type AppointmentReschedule } from '../../../staff/api'
import type { PatientSearchCard } from '../../../staff/patientSearch'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptFacts } from '../parts/DeptRecord'
import { birthDateText } from '../parts/format'
import {
  BASE, BOOKED_DONE, CANCELLED_DONE, CANCEL_HINT, CHANGE_REASON_MAX, CHECK_IN_CONFIRM, CHECK_IN_CONFIRM_LABEL, LENGTHS,
  MOVED_DONE, NOT_AVAILABLE, RELOAD_AFTER, RESCHEDULE_REASON_HINT, canCheckIn, canSearch, canWrite, changeReasonProblem,
  checkInOffered, clinicianText, dayText, departmentText, hasStarted, historyText, isDay, lagosParts, lagosStartsAt,
  lagosToday, learnFrom, refusalWords, statusText, statusTone, timeProblem, timeRangeText, visitTypeText, whenText,
} from './appointmentRules'
import { Identity, useBookingChoices } from './Appointments'
import { PatientFinder } from './PatientFinder'
import { useStaffNames } from './staffNames'
import { useIdempotencyKeys } from './useIdempotencyKeys'

interface Notice { readonly tone: DeptNoticeTone; readonly text: string }
type Open = 'reschedule' | 'cancel' | 'no-show' | 'check-in' | null

/**
 * One appointment: its card, the design's four actions (Reschedule, Check in, Cancel appointment, Mark no-show) for the
 * roles that may take them, and its history. Each change sends the row version the card showed, so a change someone else
 * made first is never overwritten (412 APPOINTMENT_VERSION_CONFLICT reads the appointment again).
 *
 * Check in (Q-APPT-6 A, the challenger correction): a booking made days ahead cannot rely on its 10-minute search, so on
 * the appointment's own Lagos day the appointment itself is the basis for this one check-in, at this facility, after the
 * desk confirms the patient's name and date of birth with them. It opens no chart. When the server asks for a fresh search
 * (APPOINTMENT_CHECK_IN_NEEDS_SEARCH: the record was merged, say), the page offers "Search for the patient" and checks
 * them in with that search card's matchRef instead.
 */
export function AppointmentDetail({ facilityId, appointmentId }: { readonly facilityId: string; readonly appointmentId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { permissions, membershipId } = useDeptAccess()
  const focus = useFocusById()
  const keyFor = useIdempotencyKeys()
  const [read, setRead] = useState<{ appointment: AppointmentCard; history: readonly AppointmentHistoryEntry[] } | null>(null)
  const [loadError, setLoadError] = useState<{ text: string; missing: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const booked = (location.state as { booked?: unknown } | null)?.booked === true
  const [notice, setNotice] = useState<Notice | null>(booked ? { tone: 'positive', text: BOOKED_DONE } : null)
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const answer = await appointmentsApi.read(facilityId, appointmentId)
      learnFrom()
      setRead({ appointment: answer.appointment, history: answer.history })
      setLoadError(null)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      setLoadError({ text: refusalWords(caught, 'The appointment could not be loaded. Try again.'),
        missing: isHidApiError(caught) && caught.code === 'APPOINTMENT_NOT_FOUND' })
    } finally { setLoading(false) }
  }, [facilityId, appointmentId])
  useEffect(() => { void load() }, [load])

  const card = read?.appointment ?? null
  const names = useStaffNames(facilityId, [card?.clinicianMembershipId, card?.bookedByMembershipId,
    ...(read?.history ?? []).flatMap(entry => [entry.byMembershipId, entry.toClinicianMembershipId])])

  /** Sends one action; on success the answer's card replaces the shown one and the history is read again. */
  async function act(action: Exclude<Open, null>, send: () => Promise<{ appointment: AppointmentCard }>, done: string): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    try {
      const answer = await send()
      setRead(previous => previous ? { ...previous, appointment: answer.appointment } : previous)
      setOpen(null)
      setNotice({ tone: 'positive', text: done })
      void load()
      focus('appointment-notice')
      return true
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return false
      learnFrom(caught)
      const reload = isHidApiError(caught) && RELOAD_AFTER.has(caught.code)
      if (reload) { setOpen(null); void load() }
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The change could not be saved. Try again.', action === 'check-in' ? 'check-in' : 'write') })
      focus('appointment-notice')
      throw caught
    } finally { setBusy(false) }
  }

  if (!card) {
    return (
      <DeptPage eyebrow="Appointments" title="Appointment" onBack={() => navigate(BASE)} backLabel="Back to appointments"
        className="hid-ehr-dept-appointments">
        {loading && !loadError ? <p className="hid-ehr-state-message" role="status">Loading the appointment…</p> : null}
        {loadError ? (
          <DeptNotice role="alert" tone={loadError.text === NOT_AVAILABLE ? 'info' : 'critical'}>{loadError.text}</DeptNotice>
        ) : null}
        {loadError && !loadError.missing && loadError.text !== NOT_AVAILABLE
          ? <EhrButton variant="secondary" onClick={() => void load()}>Try again</EhrButton> : null}
      </DeptPage>
    )
  }

  const writes = canWrite(permissions) && card.status === 'booked'
  const checksIn = canCheckIn(permissions) && checkInOffered(card)
  const noShow = writes && hasStarted(card)
  // "Any clinician in the clinic" only when the card names a clinic; else in the department (as "Clinic: No clinic" says).
  const inClinic = card.clinicName !== null
  const toggle = (which: Exclude<Open, null>) => setOpen(value => value === which ? null : which)

  return (
    <DeptPage eyebrow="Appointments" title={card.fullName} onBack={() => navigate(BASE)} backLabel="Back to appointments"
      className="hid-ehr-dept-appointments"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()} busy={loading}>Refresh</EhrButton>}>
      {notice ? <DeptNotice id="appointment-notice" tabIndex={-1} role={notice.tone === 'critical' ? 'alert' : 'status'} tone={notice.tone} variant="box">{notice.text}</DeptNotice> : null}
      {loadError && card ? <DeptNotice role="alert" tone="critical">{loadError.text}</DeptNotice> : null}

      <DeptSection title="Appointment" headingId="appointment-card-title">
        <Identity card={card} />
        <div className="hid-ehr-dept-appointments-badges">
          <EhrBadge tone={statusTone(card.status)}>{statusText(card.status)}</EhrBadge>
          {card.chartBlocked ? <EhrBadge tone="critical">Chart cannot be opened</EhrBadge> : null}
        </div>
        <DeptFacts facts={[
          { label: 'When', value: `${dayText(card.appointmentDay)}, ${timeRangeText(card)}` },
          { label: 'Length', value: `${card.lengthMinutes} minutes` },
          { label: 'Clinic', value: card.clinicName ?? 'No clinic' },
          { label: 'Department', value: departmentText(card.departmentCode) },
          { label: 'With', value: clinicianText(card.clinicianMembershipId, names, membershipId, { inClinic }) },
          { label: 'Visit type', value: visitTypeText(card.visitType) },
          { label: 'Reason', value: card.reason?.trim() || 'None given' },
          { label: 'Found by', value: card.bookingBasis === 'own-facility' ? 'This facility’s patient' : 'A patient search' },
          { label: 'Booked', value: `${whenText(card.bookedAt)} by ${clinicianText(card.bookedByMembershipId, names, membershipId, { inSentence: true })}` },
        ]} />
        {card.status === 'checked_in' ? (
          <p className="hid-ehr-dept-appointments-hint">Checked in to the waiting list. <Link to="/provider/waiting-list">Open the waiting list</Link></p>
        ) : null}
      </DeptSection>

      {writes || checksIn ? (
        <DeptSection title="Actions" headingId="appointment-actions-title">
          <div className="hid-ehr-dept-appointments-action-row">
            {checksIn ? <EhrButton aria-expanded={open === 'check-in'} onClick={() => toggle('check-in')}>Check in</EhrButton> : null}
            {writes ? <EhrButton variant="secondary" aria-expanded={open === 'reschedule'} onClick={() => toggle('reschedule')}>Reschedule</EhrButton> : null}
            {noShow ? <EhrButton variant="secondary" aria-expanded={open === 'no-show'} onClick={() => toggle('no-show')}>Mark no-show</EhrButton> : null}
            {writes ? <EhrButton variant="secondary" aria-expanded={open === 'cancel'} onClick={() => toggle('cancel')}>Cancel appointment</EhrButton> : null}
          </div>
          {open === 'check-in' ? (
            <CheckInForm facilityId={facilityId} card={card} busy={busy} searches={canSearch(permissions)} onCancel={() => setOpen(null)}
              onSend={matchRef => act('check-in', async () => {
                const body = { appointmentId: card.appointmentId, rowVersion: card.rowVersion, matchRef: matchRef ?? null }
                const answer = await appointmentsApi.checkIn(facilityId, card, keyFor('check-in', body), matchRef)
                return answer
              }, `${card.fullName} is checked in and on the waiting list.`)} />
          ) : null}
          {open === 'reschedule' ? (
            <RescheduleForm facilityId={facilityId} card={card} busy={busy} onCancel={() => setOpen(null)}
              onSend={change => act('reschedule', () => appointmentsApi.reschedule(facilityId, card,
                change, keyFor('reschedule', { card: [card.appointmentId, card.rowVersion], change })),
              MOVED_DONE)} />
          ) : null}
          {open === 'cancel' ? (
            <ReasonForm id="appointment-cancel" title="Cancel appointment" action="Cancel appointment" busy={busy} onCancel={() => setOpen(null)}
              hint={CANCEL_HINT}
              onSend={reason => act('cancel', () => appointmentsApi.cancel(facilityId, card, reason,
                keyFor('cancel', { card: [card.appointmentId, card.rowVersion], reason })), CANCELLED_DONE)} />
          ) : null}
          {open === 'no-show' ? (
            <div className="hid-ehr-dept-form" role="group" aria-label="Mark no-show">
              <p>Mark that {card.fullName} did not come? {card.appointmentDay === lagosToday()
                ? 'If they arrive later today, they can still be checked in.'
                : 'To see them another day, book a new appointment.'}</p>
              <div className="hid-ehr-dept-form-actions">
                <EhrButton variant="quiet" onClick={() => setOpen(null)}>Keep it booked</EhrButton>
                <EhrButton busy={busy} onClick={() => void act('no-show', () => appointmentsApi.noShow(facilityId, card,
                  keyFor('no-show', [card.appointmentId, card.rowVersion])), 'Marked as a no-show.').catch(() => {})}>Mark no-show</EhrButton>
              </div>
            </div>
          ) : null}
        </DeptSection>
      ) : card.status === 'booked' && canWrite(permissions) === false ? (
        <DeptNotice tone="info">Only the front desk, clinicians and doctors of this facility can change appointments.</DeptNotice>
      ) : null}

      <DeptSection title="History" headingId="appointment-history-title">
        {read && read.history.length > 0 ? (
          <ol className="hid-ehr-dept-appointments-history" aria-labelledby="appointment-history-title">
            {read.history.map((entry, index) => (
              <li key={`${entry.kind}-${entry.at}-${index}`}>
                <p><strong>{historyText(entry)}</strong></p>
                <p className="hid-ehr-dept-appointments-hint">
                  {whenText(entry.at)}{entry.byMembershipId ? `, by ${clinicianText(entry.byMembershipId, names, membershipId, { inSentence: true })}` : ''}
                </p>
                {entry.kind === 'rescheduled' && entry.toClinicianMembershipId !== entry.fromClinicianMembershipId ? (
                  <p className="hid-ehr-dept-appointments-hint">Now with {clinicianText(entry.toClinicianMembershipId, names, membershipId, { inSentence: true, inClinic })}</p>
                ) : null}
                {entry.reason ? <p className="hid-ehr-dept-appointments-hint">Reason: {entry.reason}</p> : null}
              </li>
            ))}
          </ol>
        ) : <p className="hid-ehr-state-message">No history yet.</p>}
      </DeptSection>
    </DeptPage>
  )
}

/**
 * Check in from the appointment: the desk confirms the patient's name and date of birth with them first (the server
 * refuses without it). When the server asks for a fresh search, the search is offered and its card's matchRef is sent.
 */
function CheckInForm({ facilityId, card, busy, searches, onSend, onCancel }: {
  readonly facilityId: string
  readonly card: AppointmentCard
  readonly busy: boolean
  readonly searches: boolean
  readonly onSend: (matchRef?: string) => Promise<boolean>
  readonly onCancel: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [problem, setProblem] = useState('')
  const [needsSearch, setNeedsSearch] = useState(false)
  const [sending, setSending] = useState<string | null>(null)

  async function send(matchRef?: string) {
    try { await onSend(matchRef) } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'APPOINTMENT_CHECK_IN_NEEDS_SEARCH') setNeedsSearch(true)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirmed) { setProblem(CHECK_IN_CONFIRM); return }
    setProblem('')
    void send()
  }

  async function pick(found: PatientSearchCard) {
    setSending(found.matchRef)
    try { await send(found.matchRef) } finally { setSending(null) }
  }

  if (needsSearch) {
    return searches ? (
      <PatientFinder facilityId={facilityId} idPrefix="appointment-check-in-find" actionLabel="Check in" busyRef={sending}
        notice={`Search for the patient to check them in. Choose ${card.fullName}’s card when you have confirmed it is them.`}
        onPick={found => void pick(found)} />
    ) : (
      <DeptNotice tone="info">Search for the patient to check them in. Ask the front desk to search for them and check them in on the waiting list.</DeptNotice>
    )
  }

  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={submit} aria-label={`Check in ${card.fullName}`}>
      <p>{CHECK_IN_CONFIRM} The appointment shows: <strong>{card.fullName}</strong>{card.dateOfBirth ? `, born ${birthDateText(card.dateOfBirth)}` : ''}.</p>
      <label className="hid-ehr-dept-appointments-confirm">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>{CHECK_IN_CONFIRM_LABEL}</span>
      </label>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <p className="hid-ehr-dept-appointments-hint">Checking in puts the patient on today’s waiting list. It does not open their chart.</p>
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Not now</EhrButton>
        <EhrButton type="submit" busy={busy}>Check in</EhrButton>
      </div>
    </form>
  )
}

/** Reschedule: a new day and time (Lagos), the length and clinician if they change, and a reason. Clashes are the server's. */
function RescheduleForm({ facilityId, card, busy, onSend, onCancel }: {
  readonly facilityId: string
  readonly card: AppointmentCard
  readonly busy: boolean
  readonly onSend: (change: AppointmentReschedule) => Promise<boolean>
  readonly onCancel: () => void
}) {
  const { membershipId } = useDeptAccess()
  const { staff } = useBookingChoices(facilityId)
  const names = useStaffNames(facilityId, [...staff, card.clinicianMembershipId])
  const start = lagosParts(card.startsAt)
  const KEEP = 'keep'
  const NONE = 'none'
  const [day, setDay] = useState(start?.day ?? '')
  const [time, setTime] = useState(start?.time ?? '')
  const [length, setLength] = useState('')
  const [clinician, setClinician] = useState(KEEP)
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const issue = !isDay(day) ? 'Choose the new day.' : timeProblem(time) === 'missing' ? 'Choose the new time.'
      : timeProblem(time) === 'step' ? 'Choose a time on a 5-minute step.' : changeReasonProblem(reason)
    const startsAt = lagosStartsAt(day, time)
    if (issue || !startsAt) { setProblem(issue ?? 'Choose the new day and time.'); return }
    setProblem('')
    const change: AppointmentReschedule = {
      startsAt, reason: reason.trim(),
      ...(length ? { lengthMinutes: Number(length) } : {}),
      ...(clinician === KEEP ? {} : { clinicianMembershipId: clinician === NONE ? null : clinician }),
    }
    void onSend(change).catch(() => {})
  }

  const others = staff.filter(id => id.toLowerCase() !== card.clinicianMembershipId?.toLowerCase())
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={submit} aria-label="Reschedule">
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="New day" controlId="appointment-reschedule-day" hint={isDay(day) ? dayText(day) : undefined}>
          <EhrInput type="date" value={day} onChange={event => setDay(event.target.value)} />
        </EhrField>
        <EhrField label="New time (Lagos)" controlId="appointment-reschedule-time" hint="On a 5-minute step, in Lagos time.">
          <EhrInput type="time" step={300} value={time} onChange={event => setTime(event.target.value)} />
        </EhrField>
        <EhrField label="Length" controlId="appointment-reschedule-length">
          <EhrSelect value={length} onChange={event => setLength(event.target.value)}>
            <option value="">Keep {card.lengthMinutes} minutes</option>
            {LENGTHS.filter(minutes => minutes !== card.lengthMinutes).map(minutes => <option key={minutes} value={String(minutes)}>{minutes} minutes</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Clinician" controlId="appointment-reschedule-clinician">
          <EhrSelect value={clinician} onChange={event => setClinician(event.target.value)}>
            <option value={KEEP}>Keep: {clinicianText(card.clinicianMembershipId, names, membershipId, { inClinic: card.clinicName !== null })}</option>
            {card.clinicianMembershipId ? <option value={NONE}>Any clinician</option> : null}
            {others.map(id => <option key={id} value={id}>{clinicianText(id, names, membershipId)}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Reason for the change" controlId="appointment-reschedule-reason" className="hid-ehr-dept-full"
          hint={RESCHEDULE_REASON_HINT}>
          <EhrTextarea value={reason} onChange={event => setReason(event.target.value)} maxLength={CHANGE_REASON_MAX} rows={2} />
        </EhrField>
      </div>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Keep the time</EhrButton>
        <EhrButton type="submit" busy={busy}>Save new time</EhrButton>
      </div>
    </form>
  )
}

/** A form that asks for a reason (8-500 characters) before its action. */
function ReasonForm({ id, title, action, hint, busy, onSend, onCancel }: {
  readonly id: string
  readonly title: string
  readonly action: string
  readonly hint: string
  readonly busy: boolean
  readonly onSend: (reason: string) => Promise<boolean>
  readonly onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const issue = changeReasonProblem(reason)
    if (issue) { setProblem(issue); return }
    setProblem('')
    void onSend(reason.trim()).catch(() => {})
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={submit} aria-label={title}>
      <p className="hid-ehr-dept-appointments-hint">{hint}</p>
      <EhrField label="Reason" controlId={`${id}-reason`} hint={`8 to ${CHANGE_REASON_MAX} characters.`}>
        <EhrTextarea value={reason} onChange={event => setReason(event.target.value)} maxLength={CHANGE_REASON_MAX} rows={2} />
      </EhrField>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="button" variant="quiet" onClick={onCancel}>Keep it booked</EhrButton>
        <EhrButton type="submit" busy={busy}>{action}</EhrButton>
      </div>
    </form>
  )
}

