import { useCallback, useState, type FormEvent } from 'react'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { nursingApi, type ClinicalShift, type ShiftAssignment, type ShiftAssignments, type ShiftDuty } from '../../../staff/api'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys, useStaffNames, type IdempotencyKeys } from './hooks'
import {
  DUTY_WORDS, EYEBROW, SHIFTS_REFUSED, SHIFTS_TITLE, SUGGESTED_SHIFTS, canAssign, canListAdmissions, canSetUpShifts, lagosDayFrom,
  learning, learningRefusal, memberText, notServed, patientName, refusalWords,
} from './nursingRules'
import { ScreenWarning, WardPicker, WardsState, useWardChoice } from './parts'

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Clinical shifts (NUR-1 routes 14 and 15; Q193 A: one meaning of "shift", reused by the duty roster; the cashier's day
 * is the "till day"). Admins set the facility's shifts up (none is seeded for a real facility; Morning, Afternoon and
 * Night are offered as a starting point, Q-NUR-16 A). Nurses in charge and admins say who is on each ward's shift:
 * nurses with their patients, one nurse in charge and one on-call doctor. An assignment opens no chart.
 */
export function ClinicalShifts() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !(canSetUpShifts(permissions) || canAssign(permissions))) return <DeptUnavailable title={SHIFTS_TITLE} message={SHIFTS_REFUSED} />
  return <ShiftsPage key={facility.id} facilityId={facility.id} />
}

function ShiftsPage({ facilityId }: { readonly facilityId: string }) {
  const { permissions } = useDeptAccess()
  const manage = canSetUpShifts(permissions)
  const purpose = manage ? 'healthcare-operations' : 'direct-care'
  const loader = useCallback((id: string) => learning(nursingApi.shifts(id, purpose)), [purpose])
  const shifts = useFacilityRead(facilityId, true, loader, 'The shifts could not be loaded.')
  const keyFor = useIdempotencyKeys()
  const items = shifts.value?.items ?? []
  return (
    <DeptPage eyebrow={EYEBROW} title={SHIFTS_TITLE} className="hid-ehr-dept-nursing"
      description="The facility’s clinical shifts, and who is on each ward’s shift. Times are Lagos time.">
      {shifts.caught ? <DeptNotice role="alert" tone={notServed(shifts.caught) ? 'info' : 'critical'}>{refusalWords(shifts.caught, 'The shifts could not be loaded.')}</DeptNotice> : null}
      <DeptSection title="Shifts" headingId="shift-list">
        {shifts.value === null && shifts.loading ? <p className="hid-ehr-state-message" role="status">Loading the shifts…</p> : null}
        {shifts.value && items.length === 0 ? <EhrEmptyState title="No shifts set up yet" message={manage ? 'Add the facility’s shifts below.' : 'An admin sets the shifts up.'} /> : null}
        {items.length > 0 ? (
          <ul className="hid-ehr-dept-waiting-list" aria-labelledby="shift-list">
            {items.map(shift => <ShiftRow key={shift.shiftId} facilityId={facilityId} shift={shift} manage={manage} keyFor={keyFor} onChanged={() => void shifts.refresh()} />)}
          </ul>
        ) : null}
        {shifts.value ? <p className="hid-ehr-state-message">{`Each fluid day starts at ${String(shifts.value.fluidDayStartsAtHour).padStart(2, '0')}:00.`}</p> : null}
      </DeptSection>
      {manage && shifts.value ? <NewShift facilityId={facilityId} existing={items} keyFor={keyFor} onAdded={() => void shifts.refresh()} /> : null}
      {canAssign(permissions) && items.some(shift => shift.active) ? <Assignments facilityId={facilityId} shifts={items.filter(shift => shift.active)} /> : null}
    </DeptPage>
  )
}

function ShiftRow({ facilityId, shift, manage, keyFor, onChanged }: {
  readonly facilityId: string
  readonly shift: ClinicalShift
  readonly manage: boolean
  readonly keyFor: IdempotencyKeys
  readonly onChanged: () => void
}) {
  const [problem, setProblem] = useState('')
  async function toggle() {
    setProblem('')
    try {
      await nursingApi.updateShift(facilityId, shift, { active: !shift.active }, keyFor('shift-active', { id: shift.shiftId, version: shift.rowVersion, active: !shift.active }))
      onChanged()
    } catch (caught) {
      setProblem(refusalWords(caught, 'The shift could not be changed. Try again.'))
    }
  }
  const headingId = `shift-${shift.shiftId}`
  return (
    <li className="hid-ehr-dept-waiting-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">{shift.name}</h3>
        <p className="hid-ehr-dept-waiting-identity"><span>{`${shift.startsAt} to ${shift.endsAt}${shift.crossesMidnight ? ', past midnight' : ''}`}</span></p>
        {!shift.active ? <div className="hid-ehr-dept-waiting-badges"><EhrBadge tone="neutral">Stopped</EhrBadge></div> : null}
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        {manage ? <EhrButton size="sm" variant="secondary" onClick={toggle}>{shift.active ? 'Stop this shift' : 'Use this shift again'}</EhrButton> : null}
      </div>
    </li>
  )
}

function NewShift({ facilityId, existing, keyFor, onAdded }: {
  readonly facilityId: string
  readonly existing: readonly ClinicalShift[]
  readonly keyFor: IdempotencyKeys
  readonly onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')

  async function add(input: { name: string; startsAt: string; endsAt: string }) {
    setProblem('')
    setDone('')
    if (!input.name.trim() || input.name.trim().length > 40) { setProblem('Name the shift in up to 40 characters.'); return }
    if (!CLOCK.test(input.startsAt) || !CLOCK.test(input.endsAt) || input.startsAt === input.endsAt) {
      setProblem('Enter a start and end time. A shift can run past midnight.')
      return
    }
    const body = { name: input.name.trim(), startsAt: input.startsAt, endsAt: input.endsAt }
    try {
      await nursingApi.createShift(facilityId, body, keyFor('shift-new', body))
      setDone(`${body.name} added.`)
      setName('')
      setStartsAt('')
      setEndsAt('')
      onAdded()
    } catch (caught) {
      setProblem(refusalWords(caught, 'The shift could not be added. Try again.'))
    }
  }

  const named = new Set(existing.filter(shift => shift.active).map(shift => shift.name.toLowerCase()))
  const suggestions = SUGGESTED_SHIFTS.filter(shift => !named.has(shift.name.toLowerCase()))
  return (
    <DeptSection title="Add a shift">
      {suggestions.length > 0 ? (
        <div className="hid-ehr-dept-nursing-actions" aria-label="Suggested shifts">
          {suggestions.map(shift => (
            <EhrButton key={shift.name} size="sm" variant="secondary" onClick={() => add(shift)}>{`Add ${shift.name} ${shift.startsAt} to ${shift.endsAt}`}</EhrButton>
          ))}
        </div>
      ) : null}
      <form className="hid-ehr-dept-nursing-form" aria-label="Add a shift" onSubmit={(event: FormEvent) => { event.preventDefault(); void add({ name, startsAt, endsAt }) }}>
        <EhrField label="Name"><EhrInput value={name} maxLength={40} onChange={event => setName(event.target.value)} /></EhrField>
        <EhrField label="Starts (Lagos time)"><EhrInput type="time" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></EhrField>
        <EhrField label="Ends (Lagos time)" hint="A shift can run past midnight."><EhrInput type="time" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></EhrField>
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        {done ? <p className="hid-ehr-state-message" role="status">{done}</p> : null}
        <EhrButton type="submit">Add shift</EhrButton>
      </form>
    </DeptSection>
  )
}

interface Row { membershipId: string; duty: ShiftDuty; admissionIds: string[] }

/** The ward, day and shift whose list is shown. Each choice gets its own list, read afresh (never another's kept). */
function Assignments({ facilityId, shifts }: { readonly facilityId: string; readonly shifts: readonly ClinicalShift[] }) {
  const { permissions } = useDeptAccess()
  const { wards, active, wardId, ward, choose } = useWardChoice(facilityId, canSetUpShifts(permissions) ? 'healthcare-operations' : 'direct-care')
  const [date, setDate] = useState(() => lagosDayFrom(0))
  const [shiftId, setShiftId] = useState(shifts[0]?.shiftId ?? '')

  return (
    <DeptSection title="Who is on" headingId="assignments">
      <ScreenWarning />
      <WardsState wards={wards} active={active} />
      <div className="hid-ehr-dept-nursing-filters">
        {active.length > 1 ? <WardPicker active={active} wardId={wardId} onChoose={choose} /> : null}
        <EhrField label="Day" hint="From yesterday to 14 days ahead.">
          <EhrInput type="date" value={date} min={lagosDayFrom(-1)} max={lagosDayFrom(14)} onChange={event => setDate(event.target.value)} />
        </EhrField>
        <EhrField label="Shift">
          <EhrSelect value={shiftId} onChange={event => setShiftId(event.target.value)}>
            {shifts.map(shift => <option key={shift.shiftId} value={shift.shiftId}>{`${shift.name} (${shift.startsAt} to ${shift.endsAt})`}</option>)}
          </EhrSelect>
        </EhrField>
      </div>
      {wardId && shiftId && date ? (
        <ShiftList key={`${wardId}-${date}-${shiftId}`} facilityId={facilityId} query={{ wardId, date, shiftId }}
          staffIds={ward?.staffMembershipIds ?? []} />
      ) : null}
    </DeptSection>
  )
}

/**
 * Who is on one ward's shift on one day, and its editor. Keyed by the three, so while another day's or shift's list is
 * read (or after it is refused) nothing of the last one is shown or saved under it: Save sends the list read for these
 * three, with its own version.
 */
function ShiftList({ facilityId, query, staffIds }: {
  readonly facilityId: string
  readonly query: { wardId: string; date: string; shiftId: string }
  readonly staffIds: readonly string[]
}) {
  const { permissions, membershipId } = useDeptAccess()
  const { wardId, date, shiftId } = query
  const loader = useCallback((id: string) => learning(nursingApi.assignments(id, { date, shiftId, wardId })), [date, shiftId, wardId])
  const list = useFacilityRead(facilityId, true, loader, 'Who is on this shift could not be loaded.')
  const patientsLoader = useCallback((id: string) => learningRefusal(nursingApi.admissions(id, wardId)), [wardId])
  const patients = useFacilityRead(facilityId, canListAdmissions(permissions), patientsLoader, 'The ward’s patients could not be loaded.')
  const [rows, setRows] = useState<Row[] | null>(null)
  const listed = list.value
  const names = useStaffNames(facilityId, [...staffIds, ...(listed?.assignments.map(row => row.membershipId) ?? [])])
  const keyFor = useIdempotencyKeys()
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')

  const shown: Row[] = rows ?? (listed ? listed.assignments.map(row => ({ ...row, admissionIds: [...row.admissionIds] })) : [])
  const people = [...new Set([...staffIds, ...shown.map(row => row.membershipId)])]
  const admitted = patients.value?.items ?? []

  function change(index: number, next: Partial<Row>) {
    setRows(shown.map((row, at) => at === index ? { ...row, ...next } : row))
  }

  /** Each line named by its person and duty, so its controls are told apart from another line's. */
  function lineName(row: Row) {
    const who = row.membershipId ? memberText(row.membershipId, membershipId, names) : 'Someone new'
    return { line: `${who}, ${DUTY_WORDS[row.duty].toLowerCase()}`,
      remove: `Remove ${who === 'You' ? 'yourself' : who === 'Someone new' ? 'this new line' : who} as ${DUTY_WORDS[row.duty].toLowerCase()}` }
  }

  async function save(current: ShiftAssignments) {
    setProblem('')
    setDone('')
    if (shown.some(row => !row.membershipId)) { setProblem('Choose who each line is for.'); return }
    if (shown.filter(row => row.duty === 'nurse_in_charge').length > 1) { setProblem('Choose one nurse in charge.'); return }
    if (shown.filter(row => row.duty === 'on_call_doctor').length > 1) { setProblem('Choose one on-call doctor.'); return }
    const assignments: ShiftAssignment[] = shown.map(row => ({ membershipId: row.membershipId, duty: row.duty,
      admissionIds: row.duty === 'on_call_doctor' ? [] : row.admissionIds }))
    const body = { date, shiftId, wardId, expectedVersion: current.version, assignments }
    try {
      const answer = await nursingApi.setAssignments(facilityId, body, keyFor('assign', body))
      setRows(null)
      setDone(answer.warnings.includes('icu_nurse_over_two') ? 'Saved. An ICU nurse has more than two patients.' : 'Saved.')
      void list.refresh()
    } catch (caught) {
      setProblem(refusalWords(caught, 'Who is on this shift could not be saved. Try again.'))
    }
  }

  return (
    <>
      {list.caught ? <DeptNotice role="alert" tone={notServed(list.caught) ? 'info' : 'critical'}>{refusalWords(list.caught, 'Who is on this shift could not be loaded.')}</DeptNotice> : null}
      {listed === null && list.loading ? <p className="hid-ehr-state-message" role="status">Loading who is on…</p> : null}
      {listed ? (
        <>
          {shown.length === 0 ? <EhrEmptyState title="No one is on this shift yet" message="Add the nurses, the nurse in charge and the on-call doctor." /> : (
            <ul className="hid-ehr-dept-waiting-list" aria-label="On this shift">
              {shown.map((row, index) => {
                const named = lineName(row)
                return (
                  <li key={index} className="hid-ehr-dept-waiting-card" aria-label={named.line}>
                    <div className="hid-ehr-dept-waiting-main hid-ehr-dept-nursing-form">
                      <EhrField label="Who">
                        <EhrSelect value={row.membershipId} onChange={event => change(index, { membershipId: event.target.value })}>
                          <option value="">Choose</option>
                          {people.map(id => <option key={id} value={id}>{memberText(id, membershipId, names)}</option>)}
                        </EhrSelect>
                      </EhrField>
                      <EhrField label="Duty">
                        <EhrSelect value={row.duty} onChange={event => change(index, { duty: event.target.value as ShiftDuty })}>
                          {(Object.keys(DUTY_WORDS) as ShiftDuty[]).map(duty => <option key={duty} value={duty}>{DUTY_WORDS[duty]}</option>)}
                        </EhrSelect>
                      </EhrField>
                      {row.duty !== 'on_call_doctor' && admitted.length > 0 ? (
                        <fieldset className="hid-ehr-dept-nursing-patients">
                          <legend>Patients</legend>
                          {admitted.map(card => (
                            <label key={card.admissionId} className="hid-ehr-dept-waiting-toggle">
                              <input type="checkbox" checked={row.admissionIds.includes(card.admissionId)}
                                onChange={event => change(index, { admissionIds: event.target.checked
                                  ? [...row.admissionIds, card.admissionId] : row.admissionIds.filter(id => id !== card.admissionId) })} />
                              <span>{[card.bedName, patientName(card)].filter(Boolean).join(' · ')}</span>
                            </label>
                          ))}
                        </fieldset>
                      ) : null}
                      <EhrButton size="sm" variant="quiet" aria-label={named.remove} onClick={() => setRows(shown.filter((_, at) => at !== index))}>Remove</EhrButton>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="hid-ehr-dept-nursing-actions">
            <EhrButton size="sm" variant="secondary" onClick={() => setRows([...shown, { membershipId: '', duty: 'nurse', admissionIds: [] }])}>Add someone</EhrButton>
            <EhrButton onClick={() => save(listed)}>Save who is on</EhrButton>
          </div>
          {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
          {done ? <p className="hid-ehr-state-message" role="status">{done}</p> : null}
        </>
      ) : null}
    </>
  )
}
