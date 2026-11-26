import { useState, type FormEvent, type ReactNode } from 'react'
import { EhrButton, EhrDrawer, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import type {
  FacilityStaffName, QualityAction, QualityActionChange, QualityActionStatus, QualityCorrection, QualityIncidentCard, QualityMe, QualityTold,
} from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import {
  ACTION_STATUS_WORDS, LIMITS, REFUSALS, TOLD_VALUES, TOLD_WORDS, categoryText, departmentText, dueDateLimits, dueDateProblem, harmText,
  lengthProblem, memberText, reasonProblem, toldRequired,
} from './qualityRules'

/** What a step's form sends; it answers with the refusal's words to show in the drawer, or null once saved. */
export type SendStep<Body> = (body: Body) => Promise<string | null>

/** A step's drawer: a form with its own refusal line, Save and Cancel. Closing a changed form asks first. */
function StepDrawer({ title, open, dirty, onClose, children, submitLabel, busy, refusal, onSubmit, blocked }: {
  readonly title: string
  readonly open: boolean
  readonly dirty: boolean
  readonly onClose: () => void
  readonly children: ReactNode
  readonly submitLabel: string
  readonly busy: boolean
  readonly refusal: string | null
  readonly onSubmit: () => void
  readonly blocked?: boolean
}) {
  return (
    <EhrDrawer open={open} title={title} dirty={dirty && !busy} onClose={onClose}>
      <form className="hid-ehr-qs-drawer-form" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); if (!busy) onSubmit() }}>
        {refusal ? <DeptNotice role="alert" tone="critical" variant="box">{refusal}</DeptNotice> : null}
        {children}
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" busy={busy} disabled={blocked}>{submitLabel}</EhrButton>
          <EhrButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</EhrButton>
        </div>
      </form>
    </EhrDrawer>
  )
}

/** Runs one step: checks first, then sends, keeping the drawer's refusal line. */
function useStep<Body>(send: SendStep<Body>) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  async function run(body: Body) {
    setBusy(true)
    setRefusal(null)
    try { setRefusal(await send(body)) } finally { setBusy(false) }
  }
  return { busy, refusal, run }
}

/** The facility's current members as choices, by name; never a typed id. */
function StaffChoices({ staff, own, names, exclude }: {
  readonly staff: readonly FacilityStaffName[]
  readonly own: string | undefined
  readonly names: ReadonlyMap<string, string | null>
  readonly exclude?: string | null
}) {
  return <>
    {staff.filter(member => member.membershipId.toLowerCase() !== exclude?.toLowerCase()).map(member => (
      <option key={member.membershipId} value={member.membershipId}>{memberText(member.membershipId, own, names)}</option>
    ))}
  </>
}

export interface StaffPick {
  readonly staff: readonly FacilityStaffName[]
  readonly names: ReadonlyMap<string, string | null>
  readonly own: string | undefined
  readonly loaded: boolean
  readonly failed: boolean
}

function staffHint(pick: StaffPick): string | undefined {
  if (!pick.loaded) return 'Loading this facility’s staff…'
  if (pick.failed) return 'The staff list could not be loaded. Close this and try again.'
  return undefined
}

/** Route 5: choose (or change) the reviewer from this facility's staff. */
export function AssignStep({ card, pick, onClose, send }: {
  readonly card: QualityIncidentCard
  readonly pick: StaffPick
  readonly onClose: () => void
  readonly send: SendStep<string>
}) {
  const [reviewer, setReviewer] = useState('')
  const [problem, setProblem] = useState('')
  const step = useStep(send)
  const changing = Boolean(card.reviewerMembershipId)
  return (
    <StepDrawer open title={changing ? 'Change reviewer' : 'Assign reviewer'} dirty={reviewer !== ''} onClose={onClose}
      submitLabel={changing ? 'Change reviewer' : 'Assign reviewer'} busy={step.busy} refusal={step.refusal}
      onSubmit={() => { if (!reviewer) { setProblem('Choose a reviewer.'); return } setProblem(''); void step.run(reviewer) }}>
      <p className="hid-ehr-qs-plain">The reviewer sees this report without who reported it or the patient. They are not told by Health ID: tell them yourself.</p>
      {changing ? <p className="hid-ehr-qs-plain">The current reviewer, {memberText(card.reviewerMembershipId, pick.own, pick.names)}, will no longer see it.</p> : null}
      <EhrField label="Reviewer" controlId="qs-assign-reviewer" error={problem || undefined} hint={staffHint(pick)}>
        <EhrSelect value={reviewer} onChange={event => setReviewer(event.target.value)}>
          <option value="">Choose a staff member</option>
          <StaffChoices staff={pick.staff} own={pick.own} names={pick.names} exclude={card.reviewerMembershipId} />
        </EhrSelect>
      </EhrField>
    </StepDrawer>
  )
}

/** Route 6: the findings; from investigated, a change, the earlier text kept in the history. */
export function InvestigationStep({ card, onClose, send }: {
  readonly card: QualityIncidentCard
  readonly onClose: () => void
  readonly send: SendStep<string>
}) {
  const earlier = card.investigation?.findings ?? ''
  const [findings, setFindings] = useState(earlier)
  const [problem, setProblem] = useState('')
  const step = useStep(send)
  const amending = card.status === 'investigated'
  return (
    <StepDrawer open title={amending ? 'Change investigation' : 'Record investigation'} dirty={findings !== earlier} onClose={onClose}
      submitLabel="Save investigation" busy={step.busy} refusal={step.refusal}
      onSubmit={() => {
        const found = lengthProblem(findings, LIMITS.findings[0], LIMITS.findings[1], 'the findings')
          || (amending && findings.trim() === earlier.trim() ? REFUSALS.QUALITY_NOTHING_TO_CHANGE! : '')
        setProblem(found)
        if (!found) void step.run(findings.trim())
      }}>
      {amending ? <p className="hid-ehr-qs-plain">The earlier findings stay in the history.</p> : null}
      <EhrField label="Findings" controlId="qs-investigation-findings" error={problem || undefined}
        hint="What was found, and why it happened. Facts, not blame; no names.">
        <EhrTextarea rows={8} value={findings} maxLength={LIMITS.findings[1]} onChange={event => setFindings(event.target.value)} />
      </EhrField>
    </StepDrawer>
  )
}

/** Route 7: a corrective action with an owner from this facility's staff and a due date. */
export function AddActionStep({ pick, onClose, send }: {
  readonly pick: StaffPick
  readonly onClose: () => void
  readonly send: SendStep<{ description: string; ownerMembershipId: string; dueDate: string }>
}) {
  const [description, setDescription] = useState('')
  const [owner, setOwner] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [problems, setProblems] = useState<{ description?: string; owner?: string; dueDate?: string }>({})
  const step = useStep(send)
  const limits = dueDateLimits()
  return (
    <StepDrawer open title="Add corrective action" dirty={Boolean(description || owner || dueDate)} onClose={onClose}
      submitLabel="Add action" busy={step.busy} refusal={step.refusal}
      onSubmit={() => {
        const found = {
          description: lengthProblem(description, LIMITS.actionDescription[0], LIMITS.actionDescription[1], 'what will be done') || undefined,
          owner: owner ? undefined : 'Choose who owns this action.',
          dueDate: dueDateProblem(dueDate) || undefined,
        }
        setProblems(found)
        if (!found.description && !found.owner && !found.dueDate) void step.run({ description: description.trim(), ownerMembershipId: owner, dueDate })
      }}>
      <EhrField label="What will be done" controlId="qs-action-description" error={problems.description}>
        <EhrTextarea rows={3} value={description} maxLength={LIMITS.actionDescription[1]} onChange={event => setDescription(event.target.value)} />
      </EhrField>
      <EhrField label="Owner" controlId="qs-action-owner" error={problems.owner}
        hint={staffHint(pick) ?? 'The owner is not told by Health ID, and sees this incident only as its reviewer or a quality lead.'}>
        <EhrSelect value={owner} onChange={event => setOwner(event.target.value)}>
          <option value="">Choose a staff member</option>
          <StaffChoices staff={pick.staff} own={pick.own} names={pick.names} />
        </EhrSelect>
      </EhrField>
      <EhrField label="Due" controlId="qs-action-due" error={problems.dueDate} hint="From today up to a year ahead.">
        <EhrInput type="date" value={dueDate} min={limits.min} max={limits.max} onChange={event => setDueDate(event.target.value)} />
      </EhrField>
    </StepDrawer>
  )
}

/** Route 8: an action's status, owner, due date or note; cancelling needs a note. Only what changed is sent. */
export function ActionChangeStep({ action, pick, onClose, send }: {
  readonly action: QualityAction
  readonly pick: StaffPick
  readonly onClose: () => void
  readonly send: SendStep<QualityActionChange>
}) {
  const [status, setStatus] = useState<QualityActionStatus>(action.status)
  const [owner, setOwner] = useState(action.ownerMembershipId)
  const [dueDate, setDueDate] = useState(action.dueDate)
  const [note, setNote] = useState('')
  const [problems, setProblems] = useState<{ note?: string; dueDate?: string; all?: string }>({})
  const step = useStep(send)
  const limits = dueDateLimits()
  const change: QualityActionChange = {
    ...(status !== action.status ? { status } : {}),
    ...(owner !== action.ownerMembershipId ? { ownerMembershipId: owner } : {}),
    ...(dueDate !== action.dueDate ? { dueDate } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  }
  const ownerListed = pick.staff.some(member => member.membershipId.toLowerCase() === action.ownerMembershipId.toLowerCase())
  return (
    <StepDrawer open title="Change corrective action" dirty={Object.keys(change).length > 0} onClose={onClose}
      submitLabel="Save action" busy={step.busy} refusal={step.refusal}
      onSubmit={() => {
        const found = {
          all: Object.keys(change).length === 0 ? REFUSALS.QUALITY_NOTHING_TO_CHANGE : undefined,
          note: status === 'cancelled' && status !== action.status && !note.trim() ? 'Say why it is cancelled.'
            : lengthProblem(note, LIMITS.note[0], LIMITS.note[1], 'a note', true) || undefined,
          dueDate: dueDate !== action.dueDate ? dueDateProblem(dueDate) || undefined : undefined,
        }
        setProblems(found)
        if (!found.all && !found.note && !found.dueDate) void step.run(change)
      }}>
      <p className="hid-ehr-qs-plain">{action.description}</p>
      {problems.all ? <p className="hid-ehr-error" role="alert">{problems.all}</p> : null}
      <EhrField label="Status" controlId="qs-action-status">
        <EhrSelect value={status} onChange={event => setStatus(event.target.value as QualityActionStatus)}>
          {(['open', 'done', 'cancelled'] as const).map(value => <option key={value} value={value}>{ACTION_STATUS_WORDS[value]}</option>)}
        </EhrSelect>
      </EhrField>
      <EhrField label="Owner" controlId="qs-action-change-owner" hint={staffHint(pick)}>
        <EhrSelect value={owner} onChange={event => setOwner(event.target.value)}>
          {ownerListed ? null : <option value={action.ownerMembershipId}>{memberText(action.ownerMembershipId, pick.own, pick.names)}</option>}
          <StaffChoices staff={pick.staff} own={pick.own} names={pick.names} />
        </EhrSelect>
      </EhrField>
      <EhrField label="Due" controlId="qs-action-change-due" error={problems.dueDate} hint="From today up to a year ahead.">
        <EhrInput type="date" value={dueDate} min={limits.min} max={limits.max} onChange={event => setDueDate(event.target.value)} />
      </EhrField>
      <EhrField label={status === 'cancelled' && action.status !== 'cancelled' ? 'Why it is cancelled' : 'Note (optional)'}
        controlId="qs-action-note" error={problems.note}>
        <EhrTextarea rows={3} value={note} maxLength={LIMITS.note[1]} onChange={event => setNote(event.target.value)} />
      </EhrField>
    </StepDrawer>
  )
}

/** Route 9: the resolution, once every corrective action is done or cancelled (Q-QUAL-6 A). */
export function ResolveStep({ card, onClose, send }: {
  readonly card: QualityIncidentCard
  readonly onClose: () => void
  readonly send: SendStep<string>
}) {
  const [resolution, setResolution] = useState('')
  const [problem, setProblem] = useState('')
  const step = useStep(send)
  const open = card.openActions > 0
  return (
    <StepDrawer open title="Resolve incident" dirty={resolution !== ''} onClose={onClose} submitLabel="Resolve incident"
      busy={step.busy} refusal={step.refusal} blocked={open}
      onSubmit={() => {
        const found = lengthProblem(resolution, LIMITS.resolution[0], LIMITS.resolution[1], 'the resolution')
        setProblem(found)
        if (!found) void step.run(resolution.trim())
      }}>
      {open ? <DeptNotice tone="caution">{REFUSALS.QUALITY_ACTIONS_OPEN}</DeptNotice> : null}
      <p className="hid-ehr-qs-plain">The resolution confirms the investigation as it stands now. A quality lead can reopen it later.</p>
      <EhrField label="Resolution" controlId="qs-resolution" error={problem || undefined}>
        <EhrTextarea rows={5} value={resolution} maxLength={LIMITS.resolution[1]} onChange={event => setResolution(event.target.value)} />
      </EhrField>
    </StepDrawer>
  )
}

/** Route 10: back to assigned, with the same reviewer and a reason. */
export function ReopenStep({ onClose, send }: { readonly onClose: () => void; readonly send: SendStep<string> }) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const step = useStep(send)
  return (
    <StepDrawer open title="Reopen incident" dirty={reason !== ''} onClose={onClose} submitLabel="Reopen incident"
      busy={step.busy} refusal={step.refusal}
      onSubmit={() => { const found = reasonProblem(reason); setProblem(found); if (!found) void step.run(reason.trim()) }}>
      <p className="hid-ehr-qs-plain">It goes back to its reviewer. The findings and actions stay, and the resolution moves to the history.</p>
      <EhrField label="Why it is reopened" controlId="qs-reopen-reason" error={problem || undefined}>
        <EhrTextarea rows={3} value={reason} maxLength={LIMITS.reason[1]} onChange={event => setReason(event.target.value)} />
      </EhrField>
    </StepDrawer>
  )
}

/**
 * Route 11: correct the category, harm level, place, "told" or clear the patient link, with a reason. Only what changed
 * is sent; an emptied department, place or "told" is sent as null. The report as filed never changes.
 */
export function CorrectStep({ card, me, onClose, send }: {
  readonly card: QualityIncidentCard
  readonly me: QualityMe
  readonly onClose: () => void
  readonly send: SendStep<QualityCorrection>
}) {
  const [category, setCategory] = useState(card.category)
  const [harmLevel, setHarmLevel] = useState(card.harmLevel)
  const [departmentCode, setDepartmentCode] = useState(card.departmentCode ?? '')
  const [locationText, setLocationText] = useState(card.locationText ?? '')
  const [told, setTold] = useState<QualityTold | ''>(card.patientOrFamilyTold ?? '')
  const [clearPatient, setClearPatient] = useState(false)
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<{ reason?: string; place?: string; locationText?: string; told?: string; all?: string }>({})
  const step = useStep(send)
  const change: Omit<QualityCorrection, 'reason'> = {
    ...(category !== card.category ? { category } : {}),
    ...(harmLevel !== card.harmLevel ? { harmLevel } : {}),
    ...(departmentCode !== (card.departmentCode ?? '') ? { departmentCode: departmentCode || null } : {}),
    ...(locationText.trim() !== (card.locationText ?? '').trim() ? { locationText: locationText.trim() || null } : {}),
    ...(told !== (card.patientOrFamilyTold ?? '') ? { patientOrFamilyTold: told || null } : {}),
    ...(clearPatient ? { patientId: null } : {}),
  }
  const changed = Object.keys(change).length > 0
  const departments = card.departmentCode && !me.departmentCodes.includes(card.departmentCode)
    ? [card.departmentCode, ...me.departmentCodes] : me.departmentCodes
  return (
    <StepDrawer open title="Correct the report" dirty={changed || reason !== ''} onClose={onClose} submitLabel="Save correction"
      busy={step.busy} refusal={step.refusal}
      onSubmit={() => {
        const found = {
          all: changed ? undefined : REFUSALS.QUALITY_NOTHING_TO_CHANGE,
          reason: reasonProblem(reason) || undefined,
          place: !departmentCode && !locationText.trim() ? REFUSALS.QUALITY_LOCATION_REQUIRED : undefined,
          locationText: lengthProblem(locationText, LIMITS.locationText[0], LIMITS.locationText[1], 'the place', true) || undefined,
          told: toldRequired(harmLevel, me.lists) && !told ? REFUSALS.QUALITY_TOLD_REQUIRED : undefined,
        }
        setProblems(found)
        if (!Object.values(found).some(Boolean)) void step.run({ reason: reason.trim(), ...change })
      }}>
      <p className="hid-ehr-qs-plain">The report as filed stays as it was: its title, what happened, when, the immediate action and who filed it.</p>
      {problems.all ? <p className="hid-ehr-error" role="alert">{problems.all}</p> : null}
      <EhrField label="Category" controlId="qs-correct-category">
        <EhrSelect value={category} onChange={event => setCategory(event.target.value)}>
          {me.lists.categories.some(entry => entry.code === card.category) ? null : <option value={card.category}>{categoryText(card.category)}</option>}
          {me.lists.categories.map(entry => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
        </EhrSelect>
      </EhrField>
      <EhrField label="Harm" controlId="qs-correct-harm">
        <EhrSelect value={harmLevel} onChange={event => setHarmLevel(event.target.value)}>
          {me.lists.harmLevels.some(entry => entry.code === card.harmLevel) ? null : <option value={card.harmLevel}>{harmText(card.harmLevel)}</option>}
          {me.lists.harmLevels.map(entry => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
        </EhrSelect>
      </EhrField>
      <EhrField label="Department" controlId="qs-correct-department" error={problems.place}>
        <EhrSelect value={departmentCode} onChange={event => setDepartmentCode(event.target.value)}>
          <option value="">No department</option>
          {departments.map(code => <option key={code} value={code}>{departmentText(code)}</option>)}
        </EhrSelect>
      </EhrField>
      <EhrField label="Where exactly" controlId="qs-correct-location" error={problems.locationText}>
        <EhrInput value={locationText} maxLength={LIMITS.locationText[1]} onChange={event => setLocationText(event.target.value)} />
      </EhrField>
      <EhrField label="Patient or family told" controlId="qs-correct-told" error={problems.told}
        hint="Required for moderate harm, severe harm and death.">
        <EhrSelect value={told} onChange={event => setTold(event.target.value as QualityTold | '')}>
          <option value="">Not recorded</option>
          {TOLD_VALUES.map(value => <option key={value} value={value}>{TOLD_WORDS[value]}</option>)}
        </EhrSelect>
      </EhrField>
      {card.patientLinked ? (
        <label className="hid-ehr-qs-check">
          <input type="checkbox" checked={clearPatient} onChange={event => setClearPatient(event.target.checked)} />
          <span>Remove the patient link</span>
        </label>
      ) : null}
      <EhrField label="Why it is corrected" controlId="qs-correct-reason" error={problems.reason}>
        <EhrTextarea rows={3} value={reason} maxLength={LIMITS.reason[1]} onChange={event => setReason(event.target.value)} />
      </EhrField>
    </StepDrawer>
  )
}
