import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { ConflictClass, Json, OfflineCore, OfflineRuntime, OpName, Ref } from '@hid/offline'
import { Button, Field, Textarea } from '@hid/ui'
import { staffApi, type ClinicalRecord } from '../api'
import { ACTIONS, CLASS_TEXT, OP_LABELS, REVIEW } from './copy'
import { receiptOf } from './holder'
import { definitionOf } from './registry'
import { dayTime } from './time'
import type { ReportedHealthProfile } from '../../profileParity'

export type ReviewAction = keyof typeof ACTIONS
interface ReviewItem { commandId: string; class: ConflictClass; laneBlocked: number; patientId: string; op: OpName }

/**
 * What the author may do for each class (§2.9). CC1, CC6 and CC8 offer nothing here: they wait, sign in, or are kept.
 * "Attach to a new visit" (CC3) and "Edit as a new entry" (CC7) need the entry opened in an editor, which this drawer
 * does not have yet: there the change can be discarded (its copy stays on this device for 30 days) and entered again.
 */
export const CLASS_ACTIONS: Readonly<Record<ConflictClass, readonly ReviewAction[]>> = {
  CC1: [], CC2: ['apply-on-top', 'discard'], CC3: ['discard'], CC4: ['send-as-is', 'discard'],
  CC5: ['ask-access', 'discard'], CC6: [], CC7: ['discard'], CC8: [],
}

/** Said where the entry can only be discarded here: enter it again in the chart first if it is still needed. */
const ENTER_AGAIN = 'To keep it, enter it again in the chart. A discarded entry stays on this device for 30 days.'

const MIN_REASON = 8

/** A change's fields as label and value, for comparing "Your change" with "Current record". */
function Fields({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <p className="staff-muted">{REVIEW.currentUnavailable}</p>
  // One level of nesting opened, so a correction's replacement readings (`replacementValues`) are shown too.
  const entries = Object.entries(value as Record<string, unknown>)
    .flatMap(([name, item]): [string, unknown][] => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.entries(item as Record<string, unknown>) : [[name, item]])
    .filter(([name, item]) => !['id', 'patientId', 'encounterId', 'facilityId', 'createdAt', 'updatedAt'].includes(name)
      && item !== null && item !== undefined && typeof item !== 'object')
  return <dl className="offline-facts">{entries.map(([name, item]) => <div key={name}><dt>{name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}</dt><dd>{String(item)}</dd></div>)}</dl>
}

/** The server refs of a change's input, as the registry's re-read needs them. A ref still local has no record yet. */
function resolvedOf(op: OpName, input: Json): Record<string, string> | null {
  const definition = definitionOf(op)
  if (!definition) return null
  const refs: Record<string, Ref> = definition.refs(input)
  const resolved: Record<string, string> = {}
  for (const [name, ref] of Object.entries(refs)) {
    if (!('server' in ref)) return null
    resolved[name] = ref.server
  }
  return resolved
}

/**
 * What the drawer read for an entry: the change as saved, the record as Health ID has it now, and for a safety hold
 * whether the patient's allergies, medications and the visit's prescriptions were actually read (A12.4).
 */
interface Compared { mine: Json | null; current: unknown; safetyRead: boolean }

/** A safety hold's reading of Health ID now: loading, failed, or what it has. */
type SafetyRead = undefined | 'failed' | { profile: ReportedHealthProfile | null; prescriptions: ClinicalRecord[] }

function Comparison({ runtime, item, onRead }: { runtime: OfflineRuntime; item: ReviewItem; onRead: (read: Partial<Compared>) => void }) {
  const [mine, setMine] = useState<Json | null | undefined>(undefined)
  const [current, setCurrent] = useState<unknown>(undefined)
  const [safety, setSafety] = useState<SafetyRead>(undefined)
  useEffect(() => {
    let active = true
    void runtime.commands.pendingFor(item.patientId).then(async views => {
      const input = views.find(view => view.commandId === item.commandId)?.input ?? null
      if (!active) return
      setMine(input)
      onRead({ mine: input })
      const facilityId = (input as { facilityId?: string } | null)?.facilityId
      if (item.class === 'CC2' && input) {
        const definition = definitionOf(item.op)
        const resolved = resolvedOf(item.op, input)
        const read = definition?.reread && resolved ? definition.reread(input, resolved).catch(() => null) : Promise.resolve(null)
        const value = await read
        if (active) { setCurrent(value); onRead({ current: value }) }
      }
      // The safety hold shows the patient's allergies and medications, and the visit's prescriptions, as Health ID has
      // them now (§2.9 CC4). "Send as is" is offered only once they were read: a failed read is not "nothing reported".
      if (item.class === 'CC4') {
        // A visit saved on this device is read as the visit Health ID made of it; one not known yet is not read at all,
        // and never said to have no prescriptions (A12.4).
        const ref = input ? (definitionOf(item.op)?.refs(input) as Record<string, Ref> | undefined)?.encounterId : undefined
        const encounterId = !ref ? undefined : 'server' in ref ? ref.server
          : ((await receiptOf(runtime as OfflineCore, ref.local).catch(() => null))?.resourceId || null)
        if (!active) return
        const read: SafetyRead = !facilityId || encounterId === null ? 'failed' : await Promise.all([
          staffApi.reportedHealthProfile(facilityId, item.patientId),
          encounterId ? staffApi.records(facilityId, item.patientId, encounterId, 'prescriptions').then(page => page.items) : Promise.resolve([]),
        ]).then(([profile, prescriptions]) => ({ profile, prescriptions }), () => 'failed' as const)
        if (!active) return
        setSafety(read)
        onRead({ safetyRead: read !== 'failed' })
      }
    })
    return () => { active = false }
  }, [runtime, item.commandId, item.patientId, item.class, item.op])
  const body = (mine as { body?: unknown } | null | undefined)?.body
  return <>
    {(item.class === 'CC2' || item.class === 'CC4' || item.class === 'CC7') && <div className="offline-compare">
      <div><h4>{REVIEW.yourChange}</h4>{mine === undefined ? <p className="staff-muted">{REVIEW.currentLoading}</p> : <Fields value={body} />}</div>
      {item.class === 'CC2' && <div><h4>{REVIEW.currentRecord}</h4>{current === undefined ? <p className="staff-muted">{REVIEW.currentLoading}</p> : <Fields value={current} />}</div>}
      {item.class === 'CC4' && <div><h4>{REVIEW.newSafety}</h4>{safety === undefined ? <p className="staff-muted">{REVIEW.currentLoading}</p>
        : safety === 'failed' ? <p className="staff-muted">{REVIEW.safetyUnavailable}</p>
          : <><SafetyFacts value={safety.profile} /><VisitPrescriptions items={safety.prescriptions} /></>}</div>}
    </div>}
  </>
}

/** Allergies and medications as the patient reported them, as Health ID has them now (ReportedHealthProfile). */
function SafetyFacts({ value }: { value: ReportedHealthProfile | null }) {
  if (!value?.allergies?.trim() && !value?.currentMedications?.trim()) return <p>{REVIEW.noSafetyReported}</p>
  if (!value) return null
  return <dl className="offline-facts">
    {value.allergies && <div><dt>Allergies</dt><dd>{value.allergies}</dd></div>}
    {value.currentMedications && <div><dt>Medications</dt><dd>{value.currentMedications}</dd></div>}
    {value.updatedAt && <div><dt>Updated</dt><dd>{dayTime(value.updatedAt)}</dd></div>}
  </dl>
}

/** The visit's prescriptions as Health ID has them now. */
function VisitPrescriptions({ items }: { items: readonly ClinicalRecord[] }) {
  return <>
    <h4>{REVIEW.visitPrescriptions}</h4>
    {items.length === 0 ? <p>{REVIEW.noVisitPrescriptions}</p>
      : <ul className="offline-facts">{items.map(item => <li key={item.id}>{String(item.medicationDisplay ?? 'Prescription')}</li>)}</ul>}
  </>
}

function ReviewEntry({ runtime, item, onDone }: { runtime: OfflineRuntime; item: ReviewItem; onDone: (said: string) => void }) {
  const [safetyRead, setSafetyRead] = useState(false)
  // "Send as is (I have checked)" only once there was something to check (A12.4).
  const actions = CLASS_ACTIONS[item.class].filter(choice => choice !== 'send-as-is' || safetyRead)
  // Nothing is preselected: the author chooses.
  const [action, setAction] = useState<ReviewAction | ''>('')
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `review-${item.commandId}`
  const read = useRef<Partial<Compared>>({})
  const text = CLASS_TEXT[item.class]

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!action || !actions.includes(action)) { setProblem(REVIEW.chooseAction); document.getElementById(`${id}-${actions[0]}`)?.focus(); return }
    if (reason.trim().length < MIN_REASON) { setProblem(REVIEW.reasonShort); document.getElementById(`${id}-reason`)?.focus(); return }
    setProblem(''); setBusy(true)
    try {
      // Applied on top: a new entry at the record's current version, which replaces this one (§2.9 CC2).
      let input: Json | undefined
      if (action === 'apply-on-top') {
        const version = Number((read.current.current as { rowVersion?: unknown } | null | undefined)?.rowVersion)
        const mine = read.current.mine as { body?: Record<string, Json> } | null | undefined
        if (!mine?.body || !Number.isInteger(version) || version < 1) { setProblem(REVIEW.currentUnavailable); return }
        input = { ...mine, body: { ...mine.body, expectedRowVersion: version } } as Json
      }
      await runtime.review.resolve(item.commandId, action, { reason: reason.trim(), ...(input !== undefined ? { input } : {}) })
      onDone(action === 'ask-access' ? 'ask-access' : action === 'discard' ? 'Discarded on this device.' : 'Saved. It will be sent when Health ID can be reached.')
    } catch (caught) { setProblem(caught instanceof Error ? caught.message : 'This could not be saved. Try again.') }
    finally { setBusy(false) }
  }

  return <li className="staff-list-item staff-stack offline-review-item" data-testid="review-entry" data-command-id={item.commandId}>
    <h3 id={`${id}-title`}>{OP_LABELS[item.op]}: {text.title}</h3>
    <p>{text.body}</p>
    {item.laneBlocked > 0 && <p className="staff-muted">{REVIEW.blocked(item.laneBlocked)}</p>}
    <Comparison runtime={runtime} item={item} onRead={value => {
      read.current = { ...read.current, ...value }
      if (value.safetyRead !== undefined) setSafetyRead(value.safetyRead)
    }} />
    {(item.class === 'CC3' || item.class === 'CC7') && <p className="staff-muted">{ENTER_AGAIN}</p>}
    {actions.length > 0 && <form className="staff-form" noValidate onSubmit={event => void submit(event)} aria-labelledby={`${id}-title`}>
      <fieldset disabled={busy}>
        <legend>What to do</legend>
        {actions.map(choice => <label key={choice} className="staff-choice">
          <input id={`${id}-${choice}`} data-testid={`review-entry-action-${choice}`} type="radio" name={`${id}-action`} value={choice} checked={action === choice}
            onChange={() => { setAction(choice); setProblem('') }} /> {ACTIONS[choice]}
        </label>)}
      </fieldset>
      <Field label={REVIEW.reason} htmlFor={`${id}-reason`} hint={REVIEW.reasonHint} required>
        <Textarea id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value)} minLength={MIN_REASON} maxLength={500}
          aria-describedby={`${id}-reason-hint`} required /></Field>
      {problem && <p role="alert" className="staff-error">{problem}</p>}
      <Button type="submit" size="sm" aria-disabled={busy || undefined}>{busy ? REVIEW.working : REVIEW.submit}</Button>
    </form>}
  </li>
}

/**
 * The author's review of changes Health ID could not take as they were (§2.9). A modal dialog: focus moves to its
 * heading, Escape closes it, and focus returns where it was.
 */
export function ReviewDrawer({ runtime, onClose }: { runtime: OfflineRuntime; onClose: () => void }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [said, setSaid] = useState('')
  const [askAccess, setAskAccess] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const returnTo = useRef<Element | null>(null)
  useLayoutEffect(() => {
    returnTo.current = document.activeElement
    heading.current?.focus()
    return () => { if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected) returnTo.current.focus() }
  }, [])
  const load = useCallback(() => runtime.review.list().then(setItems, () => setItems([])), [runtime])
  useEffect(() => { void load() }, [load])

  return <div className="offline-drawer-backdrop">
    <div className="offline-drawer" role="dialog" aria-modal="true" aria-labelledby="offline-review-title"
      onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <div className="staff-row offline-panel-head">
        <h2 id="offline-review-title" ref={heading} tabIndex={-1}>{REVIEW.title}</h2>
        <Button tone="quiet" size="sm" onClick={onClose}>{REVIEW.close}</Button>
      </div>
      <div role="status">{said && <p className="staff-success">{said}</p>}
        {askAccess && <p>Ask the patient for access again on <Link className="staff-text-link" to="/provider/patients" onClick={onClose}>Patient access</Link>.
          The change is sent as it is once access is approved; there is no need to enter it again.</p>}</div>
      {items === null ? <p role="status">{REVIEW.currentLoading}</p>
        : items.length === 0 ? <p>{REVIEW.empty}</p>
          : <ul className="staff-list offline-review-list">{items.map(item => <ReviewEntry key={item.commandId} runtime={runtime} item={item}
            onDone={result => {
              if (result === 'ask-access') { setAskAccess(true); setSaid('Kept on this device until access is approved.') }
              else setSaid(result)
              void load()
            }} />)}</ul>}
    </div>
  </div>
}
