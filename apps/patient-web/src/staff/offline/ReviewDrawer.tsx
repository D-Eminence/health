import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { ConflictClass, Json, OfflineRuntime, OpName, Ref } from '@hid/offline'
import { Button, Field, Textarea } from '@hid/ui'
import { staffApi } from '../api'
import { ACTIONS, CLASS_TEXT, OP_LABELS, REVIEW } from './copy'
import { definitionOf } from './registry'
import { dayTime } from './time'
import type { ReportedHealthProfile } from '../../profileParity'

export type ReviewAction = keyof typeof ACTIONS
interface ReviewItem { commandId: string; class: ConflictClass; laneBlocked: number; patientId: string; op: OpName }

/** What the author may do for each class (§2.9). CC1, CC6 and CC8 offer nothing here: they wait, sign in, or are kept. */
export const CLASS_ACTIONS: Readonly<Record<ConflictClass, readonly ReviewAction[]>> = {
  CC1: [], CC2: ['apply-on-top', 'discard'], CC3: ['new-visit', 'discard'], CC4: ['send-as-is', 'discard'],
  CC5: ['ask-access', 'discard'], CC6: [], CC7: ['edit-as-new', 'discard'], CC8: [],
}

const MIN_REASON = 8

/** A change's fields as label and value, for comparing "Your change" with "Current record". */
function Fields({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <p className="staff-muted">{REVIEW.currentUnavailable}</p>
  const entries = Object.entries(value as Record<string, unknown>)
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

function Comparison({ runtime, item }: { runtime: OfflineRuntime; item: ReviewItem }) {
  const [mine, setMine] = useState<Json | null | undefined>(undefined)
  const [current, setCurrent] = useState<unknown>(undefined)
  const [safety, setSafety] = useState<ReportedHealthProfile | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void runtime.commands.pendingFor(item.patientId).then(async views => {
      const input = views.find(view => view.commandId === item.commandId)?.input ?? null
      if (!active) return
      setMine(input)
      const facilityId = (input as { facilityId?: string } | null)?.facilityId
      if (item.class === 'CC2' && input) {
        const definition = definitionOf(item.op)
        const resolved = resolvedOf(item.op, input)
        const read = definition?.reread && resolved ? definition.reread(input, resolved).catch(() => null) : Promise.resolve(null)
        const value = await read
        if (active) setCurrent(value)
      }
      // The safety hold shows the patient's allergies and medications as Health ID has them now (§2.9 CC4).
      if (item.class === 'CC4' && facilityId) {
        const profile = await staffApi.reportedHealthProfile(facilityId, item.patientId).catch(() => null)
        if (active) setSafety(profile)
      }
    })
    return () => { active = false }
  }, [runtime, item.commandId, item.patientId, item.class, item.op])
  const body = (mine as { body?: unknown } | null | undefined)?.body
  return <>
    {(item.class === 'CC2' || item.class === 'CC4' || item.class === 'CC7') && <div className="offline-compare">
      <div><h4>{REVIEW.yourChange}</h4>{mine === undefined ? <p className="staff-muted">{REVIEW.currentLoading}</p> : <Fields value={body} />}</div>
      {item.class === 'CC2' && <div><h4>{REVIEW.currentRecord}</h4>{current === undefined ? <p className="staff-muted">{REVIEW.currentLoading}</p> : <Fields value={current} />}</div>}
      {item.class === 'CC4' && <div><h4>{REVIEW.newSafety}</h4>{safety === undefined ? <p className="staff-muted">{REVIEW.currentLoading}</p> : <SafetyFacts value={safety} />}</div>}
    </div>}
  </>
}

/** Allergies and medications as the patient reported them, as Health ID has them now (ReportedHealthProfile). */
function SafetyFacts({ value }: { value: ReportedHealthProfile | null }) {
  if (!value || (!value.allergies && !value.currentMedications)) return <p className="staff-muted">{REVIEW.currentUnavailable}</p>
  return <dl className="offline-facts">
    {value.allergies && <div><dt>Allergies</dt><dd>{value.allergies}</dd></div>}
    {value.currentMedications && <div><dt>Medications</dt><dd>{value.currentMedications}</dd></div>}
    {value.updatedAt && <div><dt>Updated</dt><dd>{dayTime(value.updatedAt)}</dd></div>}
  </dl>
}

function ReviewEntry({ runtime, item, onDone }: { runtime: OfflineRuntime; item: ReviewItem; onDone: (said: string) => void }) {
  const actions = CLASS_ACTIONS[item.class]
  // Nothing is preselected: the author chooses.
  const [action, setAction] = useState<ReviewAction | ''>('')
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `review-${item.commandId}`
  const text = CLASS_TEXT[item.class]

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!action) { setProblem(REVIEW.chooseAction); document.getElementById(`${id}-${actions[0]}`)?.focus(); return }
    if (reason.trim().length < MIN_REASON) { setProblem(REVIEW.reasonShort); document.getElementById(`${id}-reason`)?.focus(); return }
    setProblem(''); setBusy(true)
    try {
      await runtime.review.resolve(item.commandId, action, { reason: reason.trim() })
      onDone(action === 'ask-access' ? 'ask-access' : action === 'discard' ? 'Discarded on this device.' : 'Saved. It will be sent when Health ID can be reached.')
    } catch (caught) { setProblem(caught instanceof Error ? caught.message : 'This could not be saved. Try again.') }
    finally { setBusy(false) }
  }

  return <li className="staff-list-item staff-stack offline-review-item">
    <h3 id={`${id}-title`}>{OP_LABELS[item.op]}: {text.title}</h3>
    <p>{text.body}</p>
    {item.laneBlocked > 0 && <p className="staff-muted">{REVIEW.blocked(item.laneBlocked)}</p>}
    <Comparison runtime={runtime} item={item} />
    {actions.length > 0 && <form className="staff-form" noValidate onSubmit={event => void submit(event)} aria-labelledby={`${id}-title`}>
      <fieldset disabled={busy}>
        <legend>What to do</legend>
        {actions.map(choice => <label key={choice} className="staff-choice">
          <input id={`${id}-${choice}`} type="radio" name={`${id}-action`} value={choice} checked={action === choice}
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
