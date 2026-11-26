import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime, formatWeekday } from '@hid/ui/display'
import { EhrBadge, EhrButton, EhrField, EhrSelect } from '@hid/ui/ehr'
import {
  workforceApi, type AttendanceMark, type DutyEntry, type DutyRoster, type FacilityStaffName, type RosterAssignment, type RosterShift,
} from '../../../staff/api'
import { startPrint, type PrintJob } from '../../../print/printPaper'
import { PrintHeader } from '../../frame/PrintHeader'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useCurrentMembers, useIdempotencyKeys, useStaffNames, withMembers } from './hooks'
import {
  BASE, OWN_ATTENDANCE, RELOAD_AFTER, attendanceOpen, attendanceText, attendanceTone, dayText, departmentText, dutyStarted,
  entriesOf, entryKey, firstClash, learnFrom, leaveKindText, leaveOn, personText, refusalWords, refusedDuty, restText,
  rosterStatusText, rosterStatusTone, ruleText, sameEntries, shiftTimes, weekDays, weekText,
} from './rosterRules'

/**
 * One department's roster for one week (routes 16, 18, 19 and 20): a grid of the week's days and the facility's
 * clinical shifts with who is on each. Editors change the duties and save them all at once (nothing is saved when any is
 * refused), publish, print, and mark attendance once it is published. "On leave" and "Leave requested" show to editors
 * only, never the type of leave. Everyone else sees a published roster as it is.
 */
export function RosterCard({ facilityId, rosterId }: { readonly facilityId: string; readonly rosterId: string }) {
  const navigate = useNavigate()
  const { membershipId, facility } = useDeptAccess()
  const keyFor = useIdempotencyKeys()
  const [roster, setRoster] = useState<DutyRoster | null>(null)
  const [readProblem, setReadProblem] = useState<string | null>(null)
  const [entries, setEntries] = useState<DutyEntry[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null)
  const [problem, setProblem] = useState<{ text: string; reload: boolean } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const { print, paper } = useRosterPrint()

  const show = useCallback((next: DutyRoster) => {
    setRoster(next)
    setEntries(entriesOf(next))
  }, [])

  const load = useCallback(async () => {
    setReadProblem(null)
    try {
      const read = await workforceApi.roster(facilityId, rosterId)
      learnFrom(facilityId)
      show(read)
      setProblem(null)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(facilityId, caught)
      setReadProblem(refusalWords(caught, 'This roster could not be loaded. Try again.'))
    }
  }, [facilityId, rosterId, show])

  useEffect(() => { void load() }, [load])

  const editor = roster?.canEdit === true
  const { members, failed: membersFailed } = useCurrentMembers(facilityId, editor)
  const ids = [
    ...(roster?.assignments ?? []).flatMap(item => [item.membershipId, item.coveredByMembershipId]),
    ...entries.map(entry => entry.membershipId), ...(roster?.unavailable ?? []).map(item => item.membershipId),
    roster?.publishedByMembershipId,
  ]
  const names = withMembers(useStaffNames(facilityId, ids), members)

  if (!roster) {
    return (
      <DeptPage title="Duty roster" onBack={() => navigate(BASE)} backLabel="Back to rosters" className="hid-ehr-dept-roster">
        {readProblem ? (
          <DeptNotice role="alert" tone="critical">
            <p>{readProblem}</p>
            <EhrButton variant="secondary" size="sm" onClick={() => void load()}>Try again</EhrButton>
          </DeptNotice>
        ) : <p className="hid-ehr-state-message" role="status">Loading the roster…</p>}
      </DeptPage>
    )
  }

  const saved = entriesOf(roster)
  const dirty = !sameEntries(entries, saved)
  const department = departmentText(roster.departmentCode)
  const shifts = roster.shifts
  const shiftOf = (shiftId: string) => shifts.find(shift => shift.shiftId.toLowerCase() === shiftId.toLowerCase())
  const dutyName = (entry: DutyEntry) => `${personText(entry.membershipId, names, membershipId)}: ${shiftOf(entry.shiftId)?.name ?? 'a shift'}, ${dayText(entry.dutyDate)}`
  const published = roster.status === 'published'
  const canPublish = editor && (roster.status === 'draft' || roster.changedSincePublished)

  async function save() {
    if (!roster || busy || !dirty) return
    const clash = firstClash(entries, roster.shifts, roster.rules.minRestHours)
    if (clash) {
      const text = clash.kind === 'overlap' ? 'This person is already on duty at that time.' : restText(roster.rules.minRestHours)
      setProblem({ text: `${text} ${dutyName(clash.entry)}.`, reload: false })
      return
    }
    const body = { rowVersion: roster.rowVersion, entries: [...entries].sort((a, b) => entryKey(a).localeCompare(entryKey(b))) }
    setBusy('save')
    setProblem(null)
    setAnnouncement('')
    try {
      const answer = await workforceApi.saveDuties(facilityId, roster, body.entries, keyFor(`save-${roster.rosterId}`, body))
      show(answer.roster)
      setEditing(false)
      setAnnouncement(`Duties saved: ${answer.changes.added} added, ${answer.changes.removed} removed.`)
    } catch (caught) {
      learnFrom(facilityId, caught)
      const duty = refusedDuty(caught)
      const text = refusalWords(caught, 'The duties could not be saved. Nothing was changed. Try again.', roster.rules.minRestHours)
      setProblem({ text: duty ? `${text} ${dutyName(duty)}.` : text, reload: isHidApiError(caught) && RELOAD_AFTER.has(caught.code) })
    } finally { setBusy(null) }
  }

  async function publish() {
    if (!roster || busy || dirty) return
    setBusy('publish')
    setProblem(null)
    setAnnouncement('')
    try {
      const answer = await workforceApi.publishRoster(facilityId, roster, keyFor(`publish-${roster.rosterId}`, roster.rowVersion))
      show(answer.roster)
      setAnnouncement(answer.outcome === 'published' ? 'Roster published.' : 'Nothing has changed since it was published.')
    } catch (caught) {
      learnFrom(facilityId, caught)
      setProblem({ text: refusalWords(caught, 'The roster could not be published. Try again.'),
        reload: isHidApiError(caught) && RELOAD_AFTER.has(caught.code) })
    } finally { setBusy(null) }
  }

  const paperOf = (shown: DutyRoster) => <RosterPaper roster={shown} names={names} facility={facility?.name ?? ''} />

  return (
    <DeptPage title={`${department} roster`} onBack={() => { if (busy === null) navigate(BASE) }} backLabel="Back to rosters"
      className="hid-ehr-dept-roster" backUnavailable={busy !== null}
      description={`Week of ${weekText(roster.weekStart)}`}
      primaryAction={canPublish ? (
        <EhrButton busy={busy === 'publish'} disabled={dirty || roster.assignments.length === 0} onClick={() => void publish()}>
          {roster.status === 'draft' ? 'Publish' : 'Publish again'}
        </EhrButton>
      ) : undefined}
      secondaryActions={<EhrButton variant="secondary" onClick={() => print(paperOf(roster))}>Print</EhrButton>}>
      <p className="hid-ehr-sr-only" role="status">{announcement}</p>
      <div className="hid-ehr-dept-context">
        <EhrBadge tone={rosterStatusTone(roster.status, roster.changedSincePublished)}>{rosterStatusText(roster.status, roster.changedSincePublished)}</EhrBadge>
        {published && roster.publishedAt ? (
          <small className="hid-ehr-dept-context-item">
            Published {formatDate(roster.publishedAt)} by {personText(roster.publishedByMembershipId, names, membershipId)}
          </small>
        ) : null}
      </div>
      <DeptNotice tone="caution">{ruleText(roster.rules)}</DeptNotice>
      {canPublish && dirty ? <p className="hid-ehr-dept-muted">Save the duties before publishing.</p> : null}
      {problem ? (
        <DeptNotice role="alert" tone="critical">
          <p>{problem.text}</p>
          {problem.reload ? <EhrButton variant="secondary" size="sm" onClick={() => { setEditing(false); void load() }}>Reload the roster</EhrButton> : null}
        </DeptNotice>
      ) : null}

      <DeptSection title="Duties" headingId="roster-duties-title" actions={editor ? (
        <div className="hid-ehr-dept-roster-edit-actions">
          {editing ? (
            <>
              <EhrButton size="sm" busy={busy === 'save'} disabled={!dirty} onClick={() => void save()}>Save duties</EhrButton>
              <EhrButton size="sm" variant="secondary" onClick={() => { setEntries(saved); setEditing(false); setProblem(null) }}>Cancel changes</EhrButton>
            </>
          ) : <EhrButton size="sm" variant="secondary" onClick={() => { setEditing(true); setAnnouncement('') }}>Change duties</EhrButton>}
        </div>
      ) : undefined}>
        {editing && membersFailed ? <DeptNotice tone="critical">The staff list could not be loaded, so nobody can be added now. Reload the page to try again.</DeptNotice> : null}
        {shifts.length === 0 ? (
          <p className="hid-ehr-state-message">This facility has no clinical shifts yet. An administrator sets them up under Clinical shifts.</p>
        ) : (
          <RosterGrid roster={roster} entries={editing ? entries : saved} editing={editing} names={names} me={membershipId}
            members={members} onChange={setEntries} />
        )}
      </DeptSection>

      {editor && roster.unavailable.length > 0 ? (
        <DeptSection title="Leave this week" headingId="roster-leave-title">
          <ul className="hid-ehr-dept-roster-leave">
            {roster.unavailable.map(item => (
              <li key={`${item.membershipId}-${item.from}-${item.kind}`}>
                <strong>{personText(item.membershipId, names, membershipId)}</strong>: {leaveKindText(item.kind)},{' '}
                {item.from === item.to ? formatDate(item.from) : `${formatDate(item.from)} to ${formatDate(item.to)}`}
              </li>
            ))}
          </ul>
        </DeptSection>
      ) : null}

      {editor && published ? (
        <Attendance facilityId={facilityId} roster={roster} names={names} me={membershipId} members={members}
          onMarked={assignment => setRoster(current => current ? { ...current,
            assignments: current.assignments.map(item => item.assignmentId === assignment.assignmentId ? assignment : item) } : current)}
          onReload={() => void load()} />
      ) : null}
      {paper}
    </DeptPage>
  )
}

/** The week as a grid: a row per clinical shift, a column per day, and who is on each. */
function RosterGrid({ roster, entries, editing, names, me, members, onChange }: {
  readonly roster: DutyRoster
  readonly entries: readonly DutyEntry[]
  readonly editing: boolean
  readonly names: ReadonlyMap<string, string | null>
  readonly me: string | undefined
  readonly members: readonly FacilityStaffName[]
  readonly onChange: (entries: DutyEntry[]) => void
}) {
  const days = weekDays(roster.weekStart)
  const now = Date.now()
  const marks = new Map(roster.assignments.map(item => [entryKey(item), item]))
  return (
    <div className="hid-ehr-dept-roster-grid-wrap">
      <table className="hid-ehr-dept-roster-grid">
        <caption className="hid-ehr-sr-only">Duties for the week of {weekText(roster.weekStart)}</caption>
        <thead>
          <tr>
            <th scope="col">Shift</th>
            {days.map(day => <th key={day} scope="col"><span>{formatWeekday(day)}</span><small>{formatDate(day)}</small></th>)}
          </tr>
        </thead>
        <tbody>
          {roster.shifts.map(shift => (
            <tr key={shift.shiftId}>
              <th scope="row"><span>{shift.name}</span><small>{shiftTimes(shift)}{shift.active ? '' : ' · no longer used'}</small></th>
              {days.map(day => {
                const here = entries.filter(entry => entry.shiftId.toLowerCase() === shift.shiftId.toLowerCase() && entry.dutyDate === day)
                const started = dutyStarted(day, shift, now)
                const where = `${shift.name} on ${dayText(day)}`
                return (
                  <td key={day}>
                    <ul aria-label={where}>
                      {here.map(entry => {
                        const name = personText(entry.membershipId, names, me)
                        const mark = marks.get(entryKey(entry))
                        const leave = editing ? leaveOn(roster.unavailable, entry.membershipId, day) : null
                        return (
                          <li key={entryKey(entry)}>
                            <span>{name}</span>
                            {mark && mark.attendance !== 'not_marked'
                              ? <EhrBadge tone={attendanceTone(mark.attendance)}>{attendanceText(mark.attendance)}</EhrBadge> : null}
                            {leave ? <EhrBadge tone="caution">{leaveKindText(leave)}</EhrBadge> : null}
                            {editing && !started ? (
                              <EhrButton size="sm" variant="quiet" aria-label={`Take ${name} off ${where}`}
                                onClick={() => onChange(entries.filter(other => entryKey(other) !== entryKey(entry)))}>Remove</EhrButton>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                    {editing && !started && shift.active ? (
                      <AddPerson where={where} day={day} roster={roster} members={members} taken={here.map(entry => entry.membershipId.toLowerCase())}
                        onAdd={membershipId => onChange([...entries, { membershipId, shiftId: shift.shiftId, dutyDate: day }])} />
                    ) : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Add someone": the facility's current members, each marked when on leave (approved leave can't be chosen). */
function AddPerson({ where, day, roster, members, taken, onAdd }: {
  readonly where: string
  readonly day: string
  readonly roster: DutyRoster
  readonly members: readonly FacilityStaffName[]
  readonly taken: readonly string[]
  readonly onAdd: (membershipId: string) => void
}) {
  const choices = members.filter(member => !taken.includes(member.membershipId.toLowerCase()))
  if (choices.length === 0) return null
  return (
    <EhrSelect aria-label={`Add someone to ${where}`} value="" className="hid-ehr-dept-roster-add"
      onChange={event => { if (event.target.value) onAdd(event.target.value) }}>
      <option value="">Add someone…</option>
      {choices.map(member => {
        const leave = leaveOn(roster.unavailable, member.membershipId, day)
        return (
          <option key={member.membershipId} value={member.membershipId} disabled={leave === 'leave_approved'}>
            {member.name}{leave ? ` (${leaveKindText(leave).toLowerCase()})` : ''}
          </option>
        )
      })}
    </EhrSelect>
  )
}

/**
 * Attendance on a published roster (route 20): each duty whose window is open (from 1 hour before it starts to 7 days
 * after it ends), marked present, absent or swapped (with who worked instead) by an editor other than the person on duty.
 */
function Attendance({ facilityId, roster, names, me, members, onMarked, onReload }: {
  readonly facilityId: string
  readonly roster: DutyRoster
  readonly names: ReadonlyMap<string, string | null>
  readonly me: string | undefined
  readonly members: readonly FacilityStaffName[]
  readonly onMarked: (assignment: RosterAssignment) => void
  readonly onReload: () => void
}) {
  const now = Date.now()
  const open = roster.assignments.filter(item => attendanceOpen(item, now)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return (
    <DeptSection title="Attendance" headingId="roster-attendance-title">
      {open.length === 0 ? (
        <p className="hid-ehr-state-message">Attendance can be marked from 1 hour before a shift starts until 7 days after it ends. No duty is in that window now.</p>
      ) : (
        <ul className="hid-ehr-dept-roster-attendance" aria-label="Duties to mark">
          {open.map(assignment => (
            <AttendanceLine key={assignment.assignmentId} facilityId={facilityId} roster={roster} assignment={assignment} names={names} me={me}
              members={members} onMarked={onMarked} onReload={onReload} />
          ))}
        </ul>
      )}
    </DeptSection>
  )
}

function AttendanceLine({ facilityId, roster, assignment, names, me, members, onMarked, onReload }: {
  readonly facilityId: string
  readonly roster: DutyRoster
  readonly assignment: RosterAssignment
  readonly names: ReadonlyMap<string, string | null>
  readonly me: string | undefined
  readonly members: readonly FacilityStaffName[]
  readonly onMarked: (assignment: RosterAssignment) => void
  readonly onReload: () => void
}) {
  const keyFor = useIdempotencyKeys()
  const [marking, setMarking] = useState(false)
  const [choice, setChoice] = useState<'present' | 'absent' | 'swapped' | ''>('')
  const [cover, setCover] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ text: string; reload: boolean } | null>(null)
  const own = Boolean(me) && assignment.membershipId.toLowerCase() === me!.toLowerCase()
  const shift = roster.shifts.find(item => item.shiftId.toLowerCase() === assignment.shiftId.toLowerCase())
  const name = personText(assignment.membershipId, names, me)
  const headingId = `attendance-${assignment.assignmentId}`
  const idPrefix = `attendance-${assignment.assignmentId}`

  async function send() {
    if (busy || !choice) return
    if (choice === 'swapped' && !cover) { setProblem({ text: 'Choose who worked this shift instead.', reload: false }); return }
    const mark: AttendanceMark = choice === 'swapped' ? { attendance: 'swapped', coveredByMembershipId: cover } : { attendance: choice }
    setBusy(true)
    setProblem(null)
    try {
      const answer = await workforceApi.markAttendance(facilityId, roster.rosterId, assignment, mark,
        keyFor(`attendance-${assignment.assignmentId}`, { rowVersion: assignment.rowVersion, ...mark }))
      onMarked(answer.assignment)
      setMarking(false)
      setChoice('')
      setCover('')
    } catch (caught) {
      learnFrom(facilityId, caught)
      setProblem({ text: refusalWords(caught, 'The attendance could not be saved. Try again.'), reload: isHidApiError(caught) && RELOAD_AFTER.has(caught.code) })
    } finally { setBusy(false) }
  }

  return (
    <li className="hid-ehr-dept-roster-attendance-line" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId}>{name}</h3>
        <p className="hid-ehr-dept-muted">{shift?.name ?? 'Shift'} · {dayText(assignment.dutyDate)} · {formatDateTime(assignment.startsAt)}</p>
        <p>
          <EhrBadge tone={attendanceTone(assignment.attendance)}>{attendanceText(assignment.attendance)}</EhrBadge>
          {assignment.attendance === 'swapped' ? <span> Covered by {personText(assignment.coveredByMembershipId, names, me)}</span> : null}
        </p>
      </div>
      {own ? <p className="hid-ehr-dept-muted">{OWN_ATTENDANCE}</p> : marking ? (
        <form className="hid-ehr-dept-action-form" noValidate onSubmit={event => { event.preventDefault(); void send() }}>
          <fieldset>
            <legend>Attendance for {name}</legend>
            {(['present', 'absent', 'swapped'] as const).map(value => (
              <label key={value} className="hid-ehr-dept-roster-choice">
                <input type="radio" name={idPrefix} value={value} checked={choice === value} onChange={() => setChoice(value)} />
                <span>{value === 'swapped' ? 'Swapped: someone else worked it' : attendanceText(value)}</span>
              </label>
            ))}
          </fieldset>
          {choice === 'swapped' ? (
            <EhrField label="Who worked instead" controlId={`${idPrefix}-cover`}>
              <EhrSelect value={cover} onChange={event => setCover(event.target.value)}>
                <option value="">Choose…</option>
                {members.filter(member => member.membershipId.toLowerCase() !== assignment.membershipId.toLowerCase())
                  .map(member => <option key={member.membershipId} value={member.membershipId}>{member.name}</option>)}
              </EhrSelect>
            </EhrField>
          ) : null}
          {problem ? (
            <DeptNotice role="alert" tone="critical">
              <p>{problem.text}</p>
              {problem.reload ? <EhrButton size="sm" variant="secondary" onClick={onReload}>Reload the roster</EhrButton> : null}
            </DeptNotice>
          ) : null}
          <div className="hid-ehr-dept-form-actions">
            <EhrButton type="submit" size="sm" busy={busy} disabled={!choice}>Save attendance</EhrButton>
            <EhrButton size="sm" variant="quiet" onClick={() => { setMarking(false); setProblem(null) }}>Cancel</EhrButton>
          </div>
        </form>
      ) : (
        <EhrButton size="sm" variant="secondary" aria-describedby={headingId} onClick={() => setMarking(true)}>
          {assignment.attendance === 'not_marked' ? 'Mark attendance' : 'Change attendance'}
        </EhrButton>
      )}
    </li>
  )
}

/**
 * The roster on paper (A4 landscape): the facility, the department, the week, who published it and when (or "Draft,
 * not published"), the rest rule, and each person's shifts. Made from what the page read; nothing is fetched to print.
 */
function RosterPaper({ roster, names, facility }: {
  readonly roster: DutyRoster
  readonly names: ReadonlyMap<string, string | null>
  readonly facility: string
}) {
  const days = weekDays(roster.weekStart)
  // Names only on paper, never "You": the paper is read by everyone on the ward.
  const nameOf = (id: string | null) => personText(id, names)
  return (
    <div className="hid-ehr-dept-roster-paper">
      <PrintHeader facility={facility} className="hid-ehr-dept-roster-paper-brand" />
      <h1>Duty roster: {departmentText(roster.departmentCode)}</h1>
      <p>Week of {weekText(roster.weekStart)}</p>
      <p>{roster.status === 'published' && roster.publishedAt
        ? `Published ${formatDate(roster.publishedAt)} by ${nameOf(roster.publishedByMembershipId)}${roster.changedSincePublished ? ' (changed since)' : ''}`
        : 'Draft, not published'}</p>
      <p>{ruleText(roster.rules)}</p>
      <table>
        <thead><tr><th scope="col">Shift</th>{days.map(day => <th key={day} scope="col">{formatWeekday(day)} {formatDate(day)}</th>)}</tr></thead>
        <tbody>
          {roster.shifts.map((shift: RosterShift) => (
            <tr key={shift.shiftId}>
              <th scope="row">{shift.name}<br />{shiftTimes(shift)}</th>
              {days.map(day => (
                <td key={day}>
                  {roster.assignments.filter(item => item.shiftId === shift.shiftId && item.dutyDate === day)
                    .map(item => <div key={item.assignmentId}>{nameOf(item.membershipId)}</div>)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Printing the roster: the paper is put under <body> only while it prints (roster.css prints it alone, on A4 landscape)
 * and goes once it has printed. A WebKit browser gets it as a PDF in a new tab (print/printPaper.ts), so no web address
 * is printed on it.
 */
function useRosterPrint(): { print: (node: ReactNode) => void; paper: ReactNode } {
  const [job, setJob] = useState<{ node: ReactNode; job: PrintJob; round: number } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!job) return
    return job.job.run(area.current, () => setJob(current => current?.round === job.round ? null : current))
  }, [job])
  const print = useCallback((node: ReactNode) => {
    const started = startPrint({ size: 'A4', kind: 'Duty roster' })
    setJob(current => ({ node, job: started, round: (current?.round ?? 0) + 1 }))
  }, [])
  const paper = job && typeof document !== 'undefined'
    ? createPortal(<div ref={area} data-roster-print="" aria-hidden="true">{job.node}</div>, document.body)
    : null
  return { print, paper }
}
