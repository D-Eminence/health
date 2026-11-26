import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { lagosClock } from '@hid/ui/display'
import { isHidApiError } from '@hid/http'
import { nursingApi, type ClinicalShift, type HandoverPatient, type HandoverSheet } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys, useStaffNames, type IdempotencyKeys } from './hooks'
import {
  EYEBROW, HANDOVER_TITLE, NURSING_REFUSED, PATIENT_BASE, SHIFTS_BASE, balanceText, canAssign, canReadTasks, canWriteHandover,
  count, isChartAccessRefusal, lagosDate, lagosDayFrom, lagosWhen, learning, memberText, notServed, refusalWords,
} from './nursingRules'
import { PatientIdentity, PatientLink, ScreenWarning, WardPicker, WardsState, useWardChoice } from './parts'

const STATUS_WORDS = { draft: 'Draft', given: 'Given, waiting to be accepted', accepted: 'Accepted' } as const

const minutes = (clock: string) => {
  const [hour = 0, minute = 0] = clock.split(':').map(Number)
  return hour * 60 + minute
}

/**
 * The shift on now in Lagos and the day it started on: a shift that runs past midnight and is on after midnight started
 * yesterday. Null when no active shift is on now.
 */
export function currentShift(shifts: readonly ClinicalShift[], now: number = Date.now()): { shiftId: string; date: string } | null {
  const clock = lagosClock(now)
  if (!clock) return null
  const at = clock.hour * 60 + clock.minute
  for (const shift of shifts.filter(candidate => candidate.active)) {
    const start = minutes(shift.startsAt)
    const end = minutes(shift.endsAt)
    if (end > start ? at >= start && at < end : at >= start) return { shiftId: shift.shiftId, date: lagosDayFrom(0, now) }
    if (end <= start && at < end) return { shiftId: shift.shiftId, date: lagosDayFrom(-1, now) }
  }
  return null
}

/**
 * Shift handover (NUR-1 routes 16-18; Q193 A): a ward's sheet for one shift, each patient's counts (doses missed this
 * shift and due next, open and overdue tasks) for everyone, and the chart figures and the handover note only where the
 * member can read the chart. A note is a signed clinical note "Nursing handover"; the sheet is given by this shift and
 * accepted by a nurse on the next shift for the ward.
 */
export function ShiftHandover() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canReadTasks(permissions)) return <DeptUnavailable title={HANDOVER_TITLE} message={NURSING_REFUSED} />
  return <HandoverPage key={facility.id} facilityId={facility.id} />
}

function HandoverPage({ facilityId }: { readonly facilityId: string }) {
  const { permissions } = useDeptAccess()
  const { wards, active, wardId, choose } = useWardChoice(facilityId)
  const shiftsLoader = useCallback((id: string) => learning(nursingApi.shifts(id)), [])
  const shifts = useFacilityRead(facilityId, true, shiftsLoader, 'The shifts could not be loaded.')
  const activeShifts = (shifts.value?.items ?? []).filter(shift => shift.active)
  const [date, setDate] = useState(() => lagosDayFrom(0))
  const [shiftId, setShiftId] = useState('')
  useEffect(() => {
    if (shiftId || activeShifts.length === 0) return
    const now = currentShift(activeShifts)
    setShiftId(now?.shiftId ?? activeShifts[0]!.shiftId)
    if (now) setDate(now.date)
  }, [shiftId, activeShifts])

  return (
    <DeptPage eyebrow={EYEBROW} title={HANDOVER_TITLE} className="hid-ehr-dept-nursing"
      description="Hand the ward over to the next shift: each patient’s note, what is due and what to watch.">
      <ScreenWarning />
      <WardsState wards={wards} active={active} />
      {shifts.caught ? <DeptNotice role="alert" tone={notServed(shifts.caught) ? 'info' : 'critical'}>{refusalWords(shifts.caught, 'The shifts could not be loaded.')}</DeptNotice> : null}
      {shifts.value && activeShifts.length === 0 ? (
        <DeptNotice tone="info">
          No clinical shifts are set up yet. An admin sets them up in <Link className="hid-ehr-dept-link" to={SHIFTS_BASE}>Clinical shifts</Link>.
        </DeptNotice>
      ) : null}
      <div className="hid-ehr-dept-nursing-filters">
        {active.length > 1 ? <WardPicker active={active} wardId={wardId} onChoose={choose} /> : null}
        {activeShifts.length > 0 ? (
          <>
            <EhrField label="Day">
              <EhrInput type="date" value={date} onChange={event => setDate(event.target.value)} />
            </EhrField>
            <EhrField label="Shift">
              <EhrSelect value={shiftId} onChange={event => setShiftId(event.target.value)}>
                {activeShifts.map(shift => <option key={shift.shiftId} value={shift.shiftId}>{`${shift.name} (${shift.startsAt} to ${shift.endsAt})`}</option>)}
              </EhrSelect>
            </EhrField>
          </>
        ) : null}
      </div>
      {canAssign(permissions) ? <p className="hid-ehr-state-message">Who is on each shift is set in <Link className="hid-ehr-dept-link" to={SHIFTS_BASE}>Clinical shifts</Link>.</p> : null}
      {wardId && shiftId && date ? <Sheet key={`${wardId}-${date}-${shiftId}`} facilityId={facilityId} query={{ wardId, date, shiftId }} /> : null}
    </DeptPage>
  )
}

function Sheet({ facilityId, query }: { readonly facilityId: string; readonly query: { wardId: string; date: string; shiftId: string } }) {
  const { permissions, membershipId } = useDeptAccess()
  const { wardId, date, shiftId } = query
  const loader = useCallback((id: string) => learning(nursingApi.handover(id, { wardId, date, shiftId })), [wardId, date, shiftId])
  const sheet = useFacilityRead(facilityId, true, loader, 'The handover could not be loaded.')
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')
  const value = sheet.value
  const names = useStaffNames(facilityId, [...(value?.fromMembershipIds ?? []), ...(value?.toMembershipIds ?? []),
    value?.givenByMembershipId, value?.acceptedByMembershipId])
  const write = canWriteHandover(permissions)

  async function step(chosen: 'give' | 'accept', current: HandoverSheet) {
    const { handoverId, rowVersion } = current
    if (!handoverId || rowVersion === null) return
    setProblem('')
    setDone('')
    try {
      await keyFor.send(`handover-${chosen}`, { id: handoverId, version: rowVersion },
        key => nursingApi.handoverStep(facilityId, { handoverId, rowVersion }, chosen, key))
      setDone(chosen === 'give' ? 'Handover given. A nurse on the next shift accepts it.' : 'Handover accepted.')
      // The button goes as the sheet is read again: focus on the sheet's heading.
      focus(SHEET_ID)
      void sheet.refresh()
    } catch (caught) {
      setProblem(refusalWords(caught, 'The handover could not be changed. Try again.'))
    }
  }

  const team = (ids: readonly string[]) => ids.length === 0 ? 'No one assigned' : ids.map(id => memberText(id, membershipId, names)).join(', ')
  return (
    <DeptSection title={value ? `Handover for ${lagosDate(value.date)}` : 'Handover'} headingId={SHEET_ID}
      actions={<EhrButton variant="secondary" size="sm" onClick={() => void sheet.refresh()}>Refresh</EhrButton>}>
      {sheet.caught ? <DeptNotice role="alert" tone={notServed(sheet.caught) ? 'info' : 'critical'}>{refusalWords(sheet.caught, 'The handover could not be loaded.')}</DeptNotice> : null}
      {value === null && sheet.loading ? <p className="hid-ehr-state-message" role="status">Loading the handover…</p> : null}
      {value ? (
        <>
          <div className="hid-ehr-dept-waiting-badges"><EhrBadge tone={value.status === 'accepted' ? 'positive' : value.status === 'given' ? 'caution' : 'brand'}>{STATUS_WORDS[value.status]}</EhrBadge></div>
          <dl className="hid-ehr-dept-waiting-facts">
            <div><dt>This shift</dt><dd>{`${lagosWhen(value.from)} to ${lagosWhen(value.to)}`}</dd></div>
            <div><dt>On this shift</dt><dd>{team(value.fromMembershipIds)}</dd></div>
            <div><dt>Next shift</dt><dd>{value.nextShift ? `${lagosWhen(value.nextShift.from)} to ${lagosWhen(value.nextShift.to)}` : 'None set up'}</dd></div>
            <div><dt>On the next shift</dt><dd>{team(value.toMembershipIds)}</dd></div>
            {value.givenAt ? <div><dt>Given</dt><dd>{`${lagosWhen(value.givenAt)} by ${memberText(value.givenByMembershipId, membershipId, names)}`}</dd></div> : null}
            {value.acceptedAt ? <div><dt>Accepted</dt><dd>{`${lagosWhen(value.acceptedAt)} by ${memberText(value.acceptedByMembershipId, membershipId, names)}`}</dd></div> : null}
          </dl>
          {done ? <p className="hid-ehr-state-message" role="status">{done}</p> : null}
          {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
          {write && value.status === 'draft' && value.handoverId ? (
            <EhrButton onClick={() => step('give', value)}>Give the handover</EhrButton>
          ) : null}
          {write && value.status === 'given' ? <EhrButton onClick={() => step('accept', value)}>Accept the handover</EhrButton> : null}
          {value.status === 'draft' && !value.handoverId ? <p className="hid-ehr-state-message">Write a note for a patient to start this shift’s sheet.</p> : null}
          {value.patients.length === 0 ? <EhrEmptyState title="No patients on this ward" message="Admitted patients show here." /> : (
            <ul className="hid-ehr-dept-waiting-list" aria-label="Patients">
              {value.patients.map(patient => (
                <HandoverRow key={patient.admissionId} facilityId={facilityId} sheet={value} patient={patient} keyFor={keyFor}
                  canWrite={write && value.status === 'draft'} onRead={() => void sheet.refresh()} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </DeptSection>
  )
}

const SHEET_ID = 'handover-sheet'

/** The note being written, and the note and version it started from. */
interface NoteDraft { note: string; watch: boolean; from: { note: string; watch: boolean; version: number | null } }

const draftOf = (patient: HandoverPatient): NoteDraft => {
  const from = { note: patient.handoverNote ?? '', watch: patient.watch, version: patient.itemRowVersion }
  return { note: from.note, watch: from.watch, from }
}

const NOTE_CHANGED = 'Someone else changed this note while you were writing. Their note is shown above: go back, then change the note again.'

/**
 * One patient on the sheet. The note opens from the sheet as last read (and the sheet is read again as it opens), and
 * is saved against the version it was written from: a colleague's newer note is never written over without a word
 * (412 NURSING_VERSION_CONFLICT, or said here first when the sheet already shows it).
 */
function HandoverRow({ facilityId, sheet, patient, canWrite, keyFor, onRead }: {
  readonly facilityId: string
  readonly sheet: HandoverSheet
  readonly patient: HandoverPatient
  readonly canWrite: boolean
  readonly keyFor: IdempotencyKeys
  /** Reads the sheet again. */
  readonly onRead: () => void
}) {
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [problem, setProblem] = useState('')
  const [chartClosed, setChartClosed] = useState(false)
  const focus = useFocusById()
  const headingId = `handover-${patient.admissionId}`
  const writeId = `${headingId}-write`
  const noteId = `${headingId}-note`
  const editing = draft !== null

  // A newer read while the note is open and nothing has been typed: start from the newer note.
  useEffect(() => {
    setDraft(current => current && current.from.version !== patient.itemRowVersion && current.note === current.from.note
      && current.watch === current.from.watch ? draftOf(patient) : current)
  }, [patient])

  function open() {
    setProblem('')
    setChartClosed(false)
    setDraft(draftOf(patient))
    focus(noteId)
    onRead()
  }

  /** The note closes (saved, or Go back): focus on the button that opened it, shown again. */
  function close() {
    setDraft(null)
    setProblem('')
    focus([writeId, headingId])
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    setProblem('')
    const note = draft.note.trim()
    if (!note || note.length > 2000) { setProblem('Write the note in up to 2,000 characters.'); return }
    // The sheet already shows a newer note than the one this was written from (one first written since, too, which the
    // server could not tell: it checks a version only when one is sent).
    if (draft.from.version !== patient.itemRowVersion) { setProblem(NOTE_CHANGED); return }
    const input = { note, watch: draft.watch, ...(draft.from.version !== null ? { expectedRowVersion: draft.from.version } : {}) }
    try {
      await keyFor.send('handover-note', { sheet: sheet.handoverId, admission: patient.admissionId, ...input },
        key => nursingApi.handoverNote(facilityId, sheet, patient.admissionId, input, key))
      close()
      onRead()
    } catch (caught) {
      if (isChartAccessRefusal(caught)) setChartClosed(true)
      const conflict = isHidApiError(caught) && caught.code === 'NURSING_VERSION_CONFLICT'
      setProblem(conflict ? NOTE_CHANGED : refusalWords(caught, 'The note could not be saved. Try again.'))
      if (conflict) onRead()
    }
  }

  return (
    <li className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name" tabIndex={-1}>
          <PatientLink card={patient.patient} to={`${PATIENT_BASE}/${patient.admissionId}/observations`} />
        </h3>
        <PatientIdentity card={patient.patient} bedName={patient.bedName} />
        {patient.watch ? <div className="hid-ehr-dept-waiting-badges"><EhrBadge tone="critical">Watch closely</EhrBadge></div> : null}
        <dl className="hid-ehr-dept-waiting-facts">
          <div><dt>Doses missed this shift</dt><dd>{patient.dosesMissedThisShift}</dd></div>
          <div><dt>Doses due next shift</dt><dd>{patient.dosesDueNextShift}</dd></div>
          <div><dt>Open tasks</dt><dd>{patient.overdueTasks > 0 ? `${patient.openTasks} (${patient.overdueTasks} overdue)` : patient.openTasks}</dd></div>
          {patient.chartShown ? (
            <>
              <div><dt>Last observations</dt><dd>{lagosWhen(patient.lastObservationAt)}</dd></div>
              <div><dt>Flagged readings this shift</dt><dd>{patient.flagsSinceLastShift === null ? '—' : count(patient.flagsSinceLastShift, 'reading')}</dd></div>
              <div><dt>Fluid balance so far</dt><dd>{balanceText(patient.fluidBalanceMl)}</dd></div>
            </>
          ) : null}
          <div><dt>Handover note</dt><dd>{patient.noteHidden ? 'Open the record to read the note.' : patient.handoverNote ?? 'No note yet'}</dd></div>
        </dl>
        {canWrite && patient.chartShown && !editing ? (
          <EhrButton id={writeId} size="sm" variant="secondary" onClick={open}>{patient.handoverNote ? 'Change the note' : 'Write a note'}</EhrButton>
        ) : null}
        {draft ? (
          <form className="hid-ehr-dept-nursing-form" onSubmit={event => void save(event)} aria-label={`Handover note for ${patient.patient.nameHidden ? patient.patient.initials : patient.patient.fullName ?? ''}`}>
            <EhrField label="Handover note" hint="Saved to the patient’s record as a signed nursing handover note." controlId={noteId}>
              <EhrTextarea value={draft.note} maxLength={2000} onChange={event => setDraft({ ...draft, note: event.target.value })} />
            </EhrField>
            <label className="hid-ehr-dept-waiting-toggle">
              <input type="checkbox" checked={draft.watch} onChange={event => setDraft({ ...draft, watch: event.target.checked })} />
              <span>Watch closely next shift</span>
            </label>
            {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
            {chartClosed ? <p className="hid-ehr-state-message"><Link className="hid-ehr-dept-link" to="/provider/patients">Find the patient on Patients</Link></p> : null}
            <div className="hid-ehr-dept-nursing-actions">
              <EhrButton type="submit" size="sm">Save the note</EhrButton>
              <EhrButton size="sm" variant="quiet" onClick={close}>Go back</EhrButton>
            </div>
          </form>
        ) : null}
      </div>
    </li>
  )
}
