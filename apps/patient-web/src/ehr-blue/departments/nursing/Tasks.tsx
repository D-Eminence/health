import { useCallback, useState, type FormEvent } from 'react'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { nursingApi, type NursingTask, type WardPatientCard } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection, DeptUnavailable } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys, usePolling, useStaffNames, type IdempotencyKeys } from './hooks'
import {
  EYEBROW, NURSING_REFUSED, PATIENT_BASE, TASKS_TITLE, canListAdmissions, canReadTasks, canWriteTasks, count, lagosInput,
  lagosInputToIso, lagosWhen, learning, learningRefusal, memberText, notServed, patientName, refusalWords,
} from './nursingRules'
import { PatientIdentity, PatientLink, ScreenWarning, WardPicker, WardsState, useWardChoice } from './parts'

const STATUS_WORDS: Readonly<Record<NursingTask['status'], string>> = {
  assigned: 'To do', in_progress: 'In progress', completed: 'Done', cancelled: 'Cancelled',
}

/** "New task" and its form's heading: focus goes to the form as it opens, and back to the button as it closes. */
export const NEW_TASK_ID = 'nursing-task-new'
export const TASK_FORM_ID = 'nursing-task-form'

/**
 * Nursing tasks (NUR-1 routes 8-10), in place of Akos's sample (the sample engine's "nursing-tasks"): a ward's tasks,
 * open first by due time, with "Only mine" and "Done", and each task's Start, Complete (with its record) and Cancel (with
 * a reason). Patients are named under Q190 A; a completion record is chart content, shown only where the member can
 * read the chart. Every time is Lagos time.
 */
export function NursingTasks() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canReadTasks(permissions)) return <DeptUnavailable title={TASKS_TITLE} message={NURSING_REFUSED} />
  return <WardTasks key={facility.id} facilityId={facility.id} />
}

function WardTasks({ facilityId }: { readonly facilityId: string }) {
  const { permissions } = useDeptAccess()
  const { wards, active, wardId, choose } = useWardChoice(facilityId)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(0)
  const [said, setSaid] = useState('')
  const focus = useFocusById()
  return (
    <DeptPage eyebrow={EYEBROW} title={TASKS_TITLE} className="hid-ehr-dept-nursing"
      description="Care tasks on the ward: who does what, and when."
      primaryAction={wardId && canWriteTasks(permissions) && canListAdmissions(permissions) && !adding
        ? <EhrButton id={NEW_TASK_ID} onClick={() => { setSaid(''); setAdding(true); focus(TASK_FORM_ID) }}>New task</EhrButton> : undefined}>
      <ScreenWarning />
      <WardsState wards={wards} active={active} />
      {active.length > 1 ? <WardPicker active={active} wardId={wardId} onChoose={choose} /> : null}
      {said ? <p className="hid-ehr-state-message" role="status">{said}</p> : null}
      {wardId && adding ? <TaskForm facilityId={facilityId} wardId={wardId}
        onDone={done => { setAdding(false); focus(NEW_TASK_ID); if (done) { setSaid('Task added.'); setAdded(n => n + 1) } }} /> : null}
      {wardId ? <TaskList key={wardId} facilityId={facilityId} where={{ wardId }} showPatient refreshKey={added} /> : null}
    </DeptPage>
  )
}

/** A ward's or one stay's tasks, with each task's steps. */
export function TaskList({ facilityId, where, showPatient, refreshKey = 0 }: {
  readonly facilityId: string
  readonly where: { wardId: string } | { admissionId: string }
  readonly showPatient: boolean
  readonly refreshKey?: number
}) {
  const { permissions, membershipId } = useDeptAccess()
  const [status, setStatus] = useState<'open' | 'done'>('open')
  const [mine, setMine] = useState(false)
  const whereKey = JSON.stringify(where)
  // A new refreshKey (a task added elsewhere on the page) makes a new loader, so the list is read again.
  const loader = useCallback((id: string) => learning(nursingApi.tasks(id, JSON.parse(whereKey) as typeof where, status, mine)),
    [whereKey, status, mine, refreshKey])
  const tasks = useFacilityRead(facilityId, true, loader, 'The tasks could not be loaded.')
  usePolling(tasks.refresh, 60_000)
  const items = tasks.value?.items ?? []
  const names = useStaffNames(facilityId, items.map(task => task.assignedMembershipId))
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [said, setSaid] = useState('')
  const headingId = `tasks-${status}`

  return (
    <DeptSection title={status === 'open' ? 'Open tasks' : 'Done and cancelled'} headingId={headingId}
      actions={<EhrButton variant="secondary" size="sm" onClick={() => void tasks.refresh()}>Refresh</EhrButton>}>
      <div className="hid-ehr-dept-nursing-filters">
        <label className="hid-ehr-dept-waiting-toggle">
          <input type="checkbox" checked={status === 'done'} onChange={event => setStatus(event.target.checked ? 'done' : 'open')} />
          <span>Show done and cancelled tasks</span>
        </label>
        <label className="hid-ehr-dept-waiting-toggle">
          <input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} />
          <span>Only mine</span>
        </label>
      </div>
      {tasks.caught ? <DeptNotice role="alert" tone={notServed(tasks.caught) ? 'info' : 'critical'}>{refusalWords(tasks.caught, 'The tasks could not be loaded.')}</DeptNotice> : null}
      {tasks.value === null && tasks.loading ? <p className="hid-ehr-state-message" role="status">Loading the tasks…</p> : null}
      {said ? <p className="hid-ehr-state-message" role="status">{said}</p> : null}
      {tasks.value !== null && items.length === 0
        ? <EhrEmptyState title={status === 'open' ? 'No open tasks' : 'No done tasks'} message="Tasks show here, the soonest due first." /> : null}
      {items.length > 0 ? (
        <ul className="hid-ehr-dept-waiting-list" aria-labelledby={headingId}>
          {items.map(task => (
            <TaskRow key={task.taskId} facilityId={facilityId} task={task} showPatient={showPatient} me={membershipId}
              names={names} canWrite={canWriteTasks(permissions)} keyFor={keyFor} onStep={() => setSaid('')}
              onChanged={(message, leaves) => {
                setSaid(message)
                // A task done or cancelled leaves the open list as it is read again: focus goes to the list's heading.
                if (leaves) focus(headingId)
                void tasks.refresh()
              }} />
          ))}
        </ul>
      ) : null}
    </DeptSection>
  )
}

type Step = 'start' | 'complete' | 'cancel'

function TaskRow({ facilityId, task, showPatient, me, names, canWrite, keyFor, onStep, onChanged }: {
  readonly facilityId: string
  readonly task: NursingTask
  readonly showPatient: boolean
  readonly me: string | undefined
  readonly names: ReadonlyMap<string, string | null>
  readonly canWrite: boolean
  readonly keyFor: IdempotencyKeys
  /** A step is begun: what the last one said is cleared. */
  readonly onStep: () => void
  /** A step is done: what to say, and whether the task leaves the open list. */
  readonly onChanged: (message: string, leaves: boolean) => void
}) {
  const [step, setStep] = useState<Step | null>(null)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const focus = useFocusById()
  const headingId = `task-${task.taskId}`
  const textId = `${headingId}-text`
  const buttonId = (chosen: Step) => `${headingId}-${chosen}`
  const open = task.status === 'assigned' || task.status === 'in_progress'

  /** Opens Complete's or Cancel's form in place of the buttons, with focus in it; Go back puts focus on the button again. */
  function choose(chosen: Step | null) {
    const was = step
    setStep(chosen)
    setText('')
    setProblem('')
    if (chosen) { onStep(); focus(textId) } else if (was) focus(buttonId(was))
  }

  async function send(chosen: Step, extra: { completionRecord?: string; reason?: string }) {
    setProblem('')
    onStep()
    const body = { task: task.taskId, version: task.rowVersion, chosen, extra }
    try {
      const answer = await keyFor.send(`task-${chosen}`, body, key => nursingApi.taskStep(facilityId, task, chosen, extra, key))
      setStep(null)
      setText('')
      // Started, the task stays on the list: focus on it, as its Start button goes when it is read again.
      if (chosen === 'start') focus(headingId)
      onChanged(chosen === 'complete' && answer.nextTaskId ? 'Task done. The next one is on the list.'
        : chosen === 'complete' ? 'Task done.' : chosen === 'cancel' ? 'Task cancelled.' : 'Task started.', chosen !== 'start')
    } catch (caught) {
      setProblem(refusalWords(caught, 'The task could not be changed. Try again.'))
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (step === 'cancel') {
      if (text.trim().length < 8) { setProblem('Say why in at least 8 characters.'); return }
      void send('cancel', { reason: text.trim() })
    } else if (step === 'complete') {
      void send('complete', text.trim() ? { completionRecord: text.trim() } : {})
    }
  }

  return (
    <li className="hid-ehr-dept-waiting-card hid-ehr-dept-nursing-task" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name" tabIndex={-1}>{task.name}</h3>
        {showPatient ? (
          <div className="hid-ehr-dept-nursing-patient">
            <PatientLink card={task.patient} to={`${PATIENT_BASE}/${task.admissionId}/tasks`} />
            <PatientIdentity card={task.patient} bedName={task.bedName} />
          </div>
        ) : null}
        <div className="hid-ehr-dept-waiting-badges">
          <EhrBadge tone={task.status === 'completed' ? 'positive' : task.status === 'cancelled' ? 'neutral' : 'brand'}>{STATUS_WORDS[task.status]}</EhrBadge>
          {task.overdue && open ? <EhrBadge tone="critical">Overdue</EhrBadge> : null}
          {task.repeatEveryHours ? <EhrBadge tone="neutral">{`Repeats every ${count(task.repeatEveryHours, 'hour')}`}</EhrBadge> : null}
        </div>
        <dl className="hid-ehr-dept-waiting-facts">
          <div><dt>Due</dt><dd>{lagosWhen(task.dueAt)}</dd></div>
          <div><dt>For</dt><dd>{memberText(task.assignedMembershipId, me, names, 'Anyone on the ward')}</dd></div>
          {task.completedAt ? <div><dt>Done</dt><dd>{lagosWhen(task.completedAt)}</dd></div> : null}
          {task.cancelledAt ? <div><dt>Cancelled</dt><dd>{lagosWhen(task.cancelledAt)}</dd></div> : null}
          {task.completionRecorded ? (
            <div><dt>Completion record</dt><dd>{task.completionRecord ?? 'Open the patient’s record to read it.'}</dd></div>
          ) : null}
        </dl>
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        {canWrite && open && step === null ? (
          <div className="hid-ehr-dept-nursing-actions">
            {task.status === 'assigned' ? <EhrButton id={buttonId('start')} size="sm" onClick={() => send('start', {})}>Start task</EhrButton> : null}
            {task.status === 'in_progress' ? <EhrButton id={buttonId('complete')} size="sm" onClick={() => choose('complete')}>Complete task</EhrButton> : null}
            <EhrButton id={buttonId('cancel')} size="sm" variant="secondary" onClick={() => choose('cancel')}>Cancel task</EhrButton>
          </div>
        ) : null}
        {step ? (
          <form className="hid-ehr-dept-nursing-form" onSubmit={submit} aria-label={step === 'complete' ? `Complete ${task.name}` : `Cancel ${task.name}`}>
            <EhrField label={step === 'complete' ? 'Completion record (optional)' : 'Why is it cancelled?'} controlId={textId}
              hint={step === 'complete' ? 'What was done and anything to watch. Saved to the patient’s record.' : 'At least 8 characters.'}>
              <EhrTextarea value={text} maxLength={step === 'complete' ? 2000 : 300} onChange={event => setText(event.target.value)} />
            </EhrField>
            <div className="hid-ehr-dept-nursing-actions">
              <EhrButton type="submit" size="sm">{step === 'complete' ? 'Save as done' : 'Cancel the task'}</EhrButton>
              <EhrButton size="sm" variant="quiet" onClick={() => choose(null)}>Go back</EhrButton>
            </div>
          </form>
        ) : null}
      </div>
    </li>
  )
}

/**
 * New task (route 9): for a patient on the ward (chosen from the ward's admissions, ADT-1 route 11) or for this stay; a
 * name, when it is due (Lagos time), who it is for (the ward's staff, or anyone), and how often it repeats.
 */
export function TaskForm({ facilityId, wardId, admission, onDone }: {
  readonly facilityId: string
  readonly wardId?: string
  readonly admission?: WardPatientCard
  readonly onDone: (added: boolean) => void
}) {
  const { membershipId } = useDeptAccess()
  const admissionsLoader = useCallback((id: string) => learningRefusal(nursingApi.admissions(id, wardId ?? '')), [wardId])
  const admissions = useFacilityRead(facilityId, Boolean(wardId) && !admission, admissionsLoader, 'The ward’s patients could not be loaded.')
  const wardsLoader = useCallback((id: string) => learningRefusal(nursingApi.wards(id)), [])
  const wards = useFacilityRead(facilityId, true, wardsLoader, 'The wards could not be loaded.')
  const staffIds = wards.value?.items.find(ward => ward.wardId === (wardId ?? admission?.wardId))?.staffMembershipIds ?? []
  const names = useStaffNames(facilityId, staffIds)
  const keyFor = useIdempotencyKeys()
  const [patient, setPatient] = useState(admission?.admissionId ?? '')
  const [name, setName] = useState('')
  const [due, setDue] = useState(() => lagosInput())
  const [assignee, setAssignee] = useState('')
  const [repeat, setRepeat] = useState('')
  const [problem, setProblem] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem('')
    const dueAt = lagosInputToIso(due)
    const hours = repeat ? Number(repeat) : undefined
    if (!patient) { setProblem('Choose the patient.'); return }
    if (!name.trim() || name.trim().length > 120) { setProblem('Name the task in up to 120 characters.'); return }
    if (!dueAt) { setProblem('Enter when the task is due.'); return }
    if (hours !== undefined && (!Number.isInteger(hours) || hours < 1 || hours > 168)) { setProblem('A task can repeat every 1 to 168 hours.'); return }
    const body = { name: name.trim(), dueAt, ...(assignee ? { assignedMembershipId: assignee } : {}), ...(hours ? { repeatEveryHours: hours } : {}) }
    try {
      await keyFor.send('task-new', { patient, ...body }, key => nursingApi.createTask(facilityId, patient, body, key))
      onDone(true)
    } catch (caught) {
      setProblem(refusalWords(caught, 'The task could not be added. Try again.'))
    }
  }

  const people = admissions.value?.items ?? []
  return (
    <DeptSection title="New task" headingId={TASK_FORM_ID}>
      <form className="hid-ehr-dept-nursing-form" onSubmit={event => void submit(event)} aria-label="New task">
        {admission ? null : (
          <EhrField label="Patient">
            <EhrSelect value={patient} onChange={event => setPatient(event.target.value)}>
              <option value="">Choose the patient</option>
              {people.map(card => (
                <option key={card.admissionId} value={card.admissionId}>{[card.bedName, patientName(card)].filter(Boolean).join(' · ')}</option>
              ))}
            </EhrSelect>
          </EhrField>
        )}
        {admissions.caught ? <DeptNotice role="alert" tone="critical">{refusalWords(admissions.caught, 'The ward’s patients could not be loaded.')}</DeptNotice> : null}
        <EhrField label="Task" hint="For example: Turn the patient, Check the drip site, Collect urine sample.">
          <EhrInput value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        </EhrField>
        <EhrField label="Due (Lagos time)">
          <EhrInput type="datetime-local" value={due} onChange={event => setDue(event.target.value)} />
        </EhrField>
        <EhrField label="For">
          <EhrSelect value={assignee} onChange={event => setAssignee(event.target.value)}>
            <option value="">Anyone on the ward</option>
            {membershipId ? <option value={membershipId}>Me</option> : null}
            {staffIds.filter(id => id !== membershipId).map(id => (
              <option key={id} value={id}>{memberText(id, membershipId, names)}</option>
            ))}
          </EhrSelect>
        </EhrField>
        <EhrField label="Repeat every (hours, optional)" hint="Leave empty for a one-off task. 1 to 168 hours.">
          <EhrInput type="number" inputMode="numeric" min={1} max={168} value={repeat} onChange={event => setRepeat(event.target.value)} />
        </EhrField>
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        <div className="hid-ehr-dept-nursing-actions">
          <EhrButton type="submit">Add task</EhrButton>
          <EhrButton variant="quiet" onClick={() => onDone(false)}>Go back</EhrButton>
        </div>
      </form>
    </DeptSection>
  )
}
