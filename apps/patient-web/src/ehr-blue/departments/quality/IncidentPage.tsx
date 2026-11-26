import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton } from '@hid/ui/ehr'
import {
  qualityApi, qualityResolutionOf, type QualityAction, type QualityHistoryEntry, type QualityIncidentCard, type QualityIncidentRecord,
  type QualityWritten,
} from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { birthDateText } from '../parts/format'
import { healthIdEnding, sexText } from '../waiting/waitingRules'
import { useIdempotencyKeys, useStaffDirectory } from './hooks'
import {
  ActionChangeStep, AddActionStep, AssignStep, CorrectStep, InvestigationStep, ReopenStep, ResolveStep, type SendStep, type StaffPick,
} from './IncidentSteps'
import type { QualityShared } from './parts'
import {
  BASE, CONFIDENTIAL, EYEBROW, RELOAD_AFTER, actionStatusText, anyStep, cancelled, categoryText, changeLines, dayText, harmText,
  historyKindText, isDraft, learnFrom, memberText, notServed, patientLinkLine, patientName, placeText, refusalWords, statusText, statusTone,
  toldText, whenText,
} from './qualityRules'

type Step = { readonly kind: 'assign' | 'investigate' | 'add-action' | 'resolve' | 'reopen' | 'correct' }
  | { readonly kind: 'action'; readonly actionId: string }
interface Notice { readonly tone: DeptNoticeTone; readonly text: string }

const NO_STEPS: QualityIncidentCard['can'] = { assign: false, investigate: false, addAction: false, resolve: false, reopen: false, correct: false }

/**
 * One incident (route 4) in this member's view: a manager's (the reporter and the linked patient), the reviewer's
 * (neither) or the reporter's (the report as filed, its status and dates). The steps offered are the card's `can`: assign
 * or change the reviewer, record or change the investigation, add and change corrective actions, resolve, reopen and
 * correct. Every write sends the row version the card showed; a change someone else made first answers 412 and the
 * incident is read again. "Confidential" is said on the page; nothing here is in the address but the incident's UUID.
 */
export function IncidentPage({ facilityId, me, membershipId, incidentId }: QualityShared & { readonly incidentId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [record, setRecord] = useState<QualityIncidentRecord | null>(null)
  const [loadError, setLoadError] = useState<{ text: string; unavailable: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step | null>(null)
  const [marking, setMarking] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(() => {
    const sent = (location.state as { qualityNotice?: unknown } | null)?.qualityNotice
    return typeof sent === 'string' ? { tone: 'positive', text: sent } : null
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const answer = await qualityApi.incident(facilityId, incidentId)
      learnFrom()
      setRecord(answer)
      setLoadError(null)
    } catch (caught) {
      if (cancelled(caught)) return
      learnFrom(caught)
      setLoadError({ text: refusalWords(caught, 'This incident report could not be loaded. Try again.'), unavailable: notServed(caught) })
    } finally { setLoading(false) }
  }, [facilityId, incidentId])

  useEffect(() => { void load() }, [load])

  const card = record?.incident ?? null
  const view = card?.view
  const resolution = card ? qualityResolutionOf(card) : null
  const directory = useStaffDirectory(facilityId, [card?.reporterMembershipId, card?.reviewerMembershipId,
    card?.investigation?.recordedByMembershipId, resolution?.byMembershipId,
    ...(record?.actions ?? []).flatMap(action => [action.ownerMembershipId, action.createdByMembershipId]),
    ...(record?.history ?? []).flatMap(entry => [entry.byMembershipId, ...memberChanges(entry)])], Boolean(view && view !== 'reporter'))
  const pick: StaffPick = { staff: directory.current, names: directory.names, own: membershipId, loaded: directory.loaded, failed: directory.failed }

  /**
   * Sends one step with its own key per body: the answer's card, actions and history are shown at once. A stale card,
   * or a step the incident's stage no longer allows, closes the drawer and reads the incident again; any other refusal
   * stays in the drawer.
   */
  function write<Body>(name: string, send: (card: QualityIncidentCard, body: Body, key: string) => Promise<QualityWritten>,
    done: string, invalid?: string): SendStep<Body> {
    return async body => {
      if (!card) return null
      try {
        const answer = await send(card, body, keyFor(`${name}:${card.incidentId}:${card.rowVersion}`, body))
        learnFrom()
        setRecord({ incident: answer.incident, actions: answer.actions ?? [], history: answer.history ?? [] })
        setStep(null)
        setNotice({ tone: 'positive', text: done })
        focus('qs-incident-notice')
        return null
      } catch (caught) {
        if (cancelled(caught)) return null
        learnFrom(caught)
        const text = refusalWords(caught, 'The change could not be saved. Try again.', invalid)
        if (isHidApiError(caught) && (RELOAD_AFTER.has(caught.code) || notServed(caught))) {
          setStep(null)
          setNotice({ tone: 'critical', text })
          focus('qs-incident-notice')
          void load()
          return null
        }
        return text
      }
    }
  }

  /** "Mark done" on an action's row: the same step as its drawer's, said on the page. */
  async function markDone(actionId: string) {
    if (marking) return
    setMarking(actionId)
    const text = await write<{ actionId: string; status: 'done' }>('action',
      (current, body, key) => qualityApi.updateAction(facilityId, current, body.actionId, { status: body.status }, key),
      'The corrective action is marked done.')({ actionId, status: 'done' })
    setMarking(null)
    if (text) {
      setNotice({ tone: 'critical', text })
      focus('qs-incident-notice')
    }
  }

  if (!card || !record) {
    return (
      <DeptPage eyebrow={EYEBROW} title="Incident report" onBack={() => navigate(BASE)} backLabel="Back to Quality & Safety" className="hid-ehr-dept-qs">
        {loadError ? <DeptNotice role="alert" tone={loadError.unavailable ? 'info' : 'critical'}>{loadError.text}</DeptNotice> : null}
        {loading && !loadError ? <p className="hid-ehr-state-message" role="status">Loading the incident report…</p> : null}
      </DeptPage>
    )
  }

  const can = card.can ?? NO_STEPS
  const seesWork = view === 'manager' || view === 'reviewer'
  const changesActions = seesWork && card.status !== 'resolved'
  const names = directory.names
  const who = (id: string | null | undefined, none?: string) => memberText(id, membershipId, names, none)
  const action = step?.kind === 'action' ? record.actions.find(entry => entry.actionId === step.actionId) : undefined

  return (
    <DeptPage eyebrow={EYEBROW} title={`Incident ${card.incidentNumber}`} description={card.title} onBack={() => navigate(BASE)}
      backLabel="Back to Quality & Safety" className="hid-ehr-dept-qs"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()} busy={loading}>Refresh</EhrButton>}>
      <DeptNotice tone="info" title="Confidential">{CONFIDENTIAL}</DeptNotice>
      {notice ? <DeptNotice id="qs-incident-notice" tabIndex={-1} role={notice.tone === 'critical' ? 'alert' : 'status'} tone={notice.tone}
        variant="box">{notice.text}</DeptNotice> : null}
      {loadError ? <DeptNotice role="alert" tone="critical">{loadError.text}</DeptNotice> : null}

      <DeptSection title="Where it is up to" headingId="qs-incident-status">
        <div className="hid-ehr-qs-badges">
          <EhrBadge tone={statusTone(card.status)}>{statusText(card.status)}</EhrBadge>
          {card.reopenedCount > 0 ? <EhrBadge tone="neutral">{`Reopened ${card.reopenedCount === 1 ? 'once' : `${card.reopenedCount} times`}`}</EhrBadge> : null}
          {seesWork && card.overdueActions > 0 ? <EhrBadge tone="critical">{`${card.overdueActions} overdue`}</EhrBadge> : null}
        </div>
        <dl className="hid-ehr-qs-facts">
          <div><dt>Reported</dt><dd>{whenText(card.reportedAt)}</dd></div>
          {view === 'reporter' ? null : <div><dt>Reviewer</dt><dd>{who(card.reviewerMembershipId, 'Not assigned yet')}</dd></div>}
          {card.assignedAt && view !== 'reporter' ? <div><dt>Assigned</dt><dd>{whenText(card.assignedAt)}</dd></div> : null}
        </dl>
        {view === 'reporter' ? (
          <p className="hid-ehr-qs-plain">You reported this. You can see where it is up to. The investigation and its actions are seen by the reviewer and quality leads.</p>
        ) : null}
        {anyStep({ can }) ? (
          <div className="hid-ehr-qs-steps">
            {can.assign ? <EhrButton variant={card.status === 'reported' ? 'primary' : 'secondary'} onClick={() => setStep({ kind: 'assign' })}>
              {card.reviewerMembershipId ? 'Change reviewer' : 'Assign reviewer'}</EhrButton> : null}
            {can.investigate ? <EhrButton variant={card.status === 'assigned' ? 'primary' : 'secondary'} onClick={() => setStep({ kind: 'investigate' })}>
              {card.status === 'investigated' ? 'Change investigation' : 'Record investigation'}</EhrButton> : null}
            {can.addAction ? <EhrButton variant="secondary" onClick={() => setStep({ kind: 'add-action' })}>Add corrective action</EhrButton> : null}
            {can.resolve ? <EhrButton variant={card.status === 'investigated' ? 'primary' : 'secondary'} onClick={() => setStep({ kind: 'resolve' })}>Resolve</EhrButton> : null}
            {can.reopen ? <EhrButton variant="secondary" onClick={() => setStep({ kind: 'reopen' })}>Reopen</EhrButton> : null}
            {can.correct ? <EhrButton variant="quiet" onClick={() => setStep({ kind: 'correct' })}>Correct the report</EhrButton> : null}
          </div>
        ) : null}
      </DeptSection>

      <DeptSection title="The report" headingId="qs-incident-report">
        <dl className="hid-ehr-qs-facts">
          <div className="hid-ehr-qs-fact-wide"><dt>What happened</dt><dd className="hid-ehr-qs-text">{card.description}</dd></div>
          <div><dt>When it happened</dt><dd>{whenText(card.occurredAt)}</dd></div>
          <div><dt>Where</dt><dd>{placeText(card)}</dd></div>
          <div><dt>Category</dt><dd>{categoryText(card.category, me.lists)}</dd></div>
          <div><dt>Harm</dt><dd>{harmText(card.harmLevel, me.lists)}</dd></div>
          <div><dt>Patient or family told</dt><dd>{toldText(card.patientOrFamilyTold)}</dd></div>
          <div className="hid-ehr-qs-fact-wide"><dt>Immediate action taken</dt><dd className="hid-ehr-qs-text">{card.immediateAction || 'None recorded'}</dd></div>
          <div><dt>Reported by</dt><dd>{reporterText(card, membershipId, names)}</dd></div>
          <div><dt>List</dt><dd>{card.listVersion}{card.listVersion === me.lists.listVersion && isDraft(me.lists) ? ' (draft)' : ''}</dd></div>
        </dl>
      </DeptSection>

      {card.patientLinked ? (
        <DeptSection title="Patient" headingId="qs-incident-patient">
          {card.patient && view === 'manager' ? (
            <dl className="hid-ehr-qs-facts">
              <div><dt>Name</dt><dd>{patientName(card.patient)}</dd></div>
              {card.patient.sex ? <div><dt>Sex</dt><dd>{sexText(card.patient.sex)}</dd></div> : null}
              {card.patient.dateOfBirth ? <div><dt>Born</dt><dd>{birthDateText(card.patient.dateOfBirth)}</dd></div> : null}
              {card.patient.healthIdLast4 ? <div><dt>Health ID</dt>
                <dd aria-label={`Health ID ending ${card.patient.healthIdLast4}`}>{healthIdEnding(card.patient.healthIdLast4)}</dd></div> : null}
            </dl>
          ) : <p className="hid-ehr-qs-plain">A patient is linked to this report. Only quality leads and administrators see who.</p>}
          {view === 'manager' ? <p className="hid-ehr-hint">The link gives no access to the patient’s record.</p> : null}
        </DeptSection>
      ) : null}

      {seesWork ? <>
        <DeptSection title="Investigation" headingId="qs-incident-investigation">
          {card.investigation ? <>
            <p className="hid-ehr-qs-text">{card.investigation.findings}</p>
            <p className="hid-ehr-hint">Recorded {whenText(card.investigation.recordedAt)} by {who(card.investigation.recordedByMembershipId, 'a staff member here')}</p>
          </> : <p className="hid-ehr-state-message">{card.status === 'reported' ? 'A reviewer is assigned first.' : 'Not recorded yet.'}</p>}
        </DeptSection>

        <DeptSection title="Corrective actions" headingId="qs-incident-actions">
          {record.actions.length === 0 ? <p className="hid-ehr-state-message">No corrective actions yet.</p> : (
            <ul className="hid-ehr-qs-actions" aria-labelledby="qs-incident-actions">
              {record.actions.map(entry => (
                <ActionRow key={entry.actionId} action={entry} who={who} changes={changesActions} marking={marking === entry.actionId}
                  onChange={() => setStep({ kind: 'action', actionId: entry.actionId })} onDone={() => void markDone(entry.actionId)} />
              ))}
            </ul>
          )}
        </DeptSection>

        {resolution ? (
          <DeptSection title="Resolution" headingId="qs-incident-resolution">
            <p className="hid-ehr-qs-text">{resolution.text}</p>
            {resolution.at ? <p className="hid-ehr-hint">Resolved {whenText(resolution.at)}{resolution.byMembershipId ? ` by ${who(resolution.byMembershipId)}` : ''}</p> : null}
          </DeptSection>
        ) : null}
      </> : null}

      <DeptSection title="History" headingId="qs-incident-history">
        {record.history.length === 0 ? <p className="hid-ehr-state-message">Nothing recorded yet.</p> : (
          <ol className="hid-ehr-qs-history">
            {record.history.map((entry, index) => (
              <HistoryRow key={`${entry.at}-${index}`} entry={entry} me={me} own={membershipId} names={names} />
            ))}
          </ol>
        )}
      </DeptSection>

      {step?.kind === 'assign' ? <AssignStep card={card} pick={pick} onClose={() => setStep(null)}
        send={write<string>('assign', (current, reviewer, key) => qualityApi.assign(facilityId, current, reviewer, key), 'The reviewer is assigned.')} /> : null}
      {step?.kind === 'investigate' ? <InvestigationStep card={card} onClose={() => setStep(null)}
        send={write<string>('investigation', (current, findings, key) => qualityApi.investigate(facilityId, current, findings, key),
          'The investigation is saved.')} /> : null}
      {step?.kind === 'add-action' ? <AddActionStep pick={pick} onClose={() => setStep(null)}
        send={write('add-action', (current, body: { description: string; ownerMembershipId: string; dueDate: string }, key) =>
          qualityApi.addAction(facilityId, current, body, key), 'The corrective action is added.')} /> : null}
      {step?.kind === 'action' && action ? <ActionChangeStep action={action} pick={pick} onClose={() => setStep(null)}
        send={write('action', (current, change: Parameters<typeof qualityApi.updateAction>[3], key) =>
          qualityApi.updateAction(facilityId, current, action.actionId, change, key), 'The corrective action is saved.')} /> : null}
      {step?.kind === 'resolve' ? <ResolveStep card={card} onClose={() => setStep(null)}
        send={write<string>('resolve', (current, text, key) => qualityApi.resolve(facilityId, current, text, key), 'The incident is resolved.')} /> : null}
      {step?.kind === 'reopen' ? <ReopenStep onClose={() => setStep(null)}
        send={write<string>('reopen', (current, reason, key) => qualityApi.reopen(facilityId, current, reason, key), 'The incident is reopened.')} /> : null}
      {step?.kind === 'correct' ? <CorrectStep card={card} me={me} onClose={() => setStep(null)}
        send={write('correct', (current, correction: Parameters<typeof qualityApi.correct>[2], key) =>
          qualityApi.correct(facilityId, current, correction, key), 'The correction is saved.')} /> : null}
    </DeptPage>
  )
}

/** Who reported it, as this view may say: the manager sees the name; the reviewer is told it is not shown. */
function reporterText(card: QualityIncidentCard, own: string | undefined, names: ReadonlyMap<string, string | null>): string {
  if (card.view === 'manager' && card.reporterMembershipId) return memberText(card.reporterMembershipId, own, names)
  if (card.reportedByMe) return 'You'
  return card.reporterHidden ? 'Not shown to reviewers' : 'Not shown'
}

/** The member ids a history entry's changes name (a reviewer or an owner), to name them. */
function memberChanges(entry: QualityHistoryEntry): string[] {
  const ids: string[] = []
  for (const field of ['reviewerMembershipId', 'ownerMembershipId']) {
    const change = entry.changes?.[field]
    for (const value of [change?.from, change?.to]) if (typeof value === 'string') ids.push(value)
  }
  return ids
}

function ActionRow({ action, who, changes, marking, onChange, onDone }: {
  readonly action: QualityAction
  readonly who: (id: string | null | undefined, none?: string) => string
  readonly changes: boolean
  readonly marking: boolean
  readonly onChange: () => void
  readonly onDone: () => void
}) {
  const headingId = `qs-action-${action.actionId}`
  return (
    <li className="hid-ehr-qs-action" aria-labelledby={headingId}>
      <p id={headingId} className="hid-ehr-qs-action-title">{action.description}</p>
      <div className="hid-ehr-qs-badges">
        <EhrBadge tone={action.status === 'done' ? 'positive' : action.status === 'cancelled' ? 'neutral' : 'brand'}>{actionStatusText(action.status)}</EhrBadge>
        {action.status === 'open' && action.overdue ? <EhrBadge tone="critical">Overdue</EhrBadge> : null}
      </div>
      <dl className="hid-ehr-qs-facts">
        <div><dt>Owner</dt><dd>{who(action.ownerMembershipId)}</dd></div>
        <div><dt>Due</dt><dd>{dayText(action.dueDate)}</dd></div>
        {action.completedAt ? <div><dt>Done</dt><dd>{whenText(action.completedAt)}</dd></div> : null}
        {action.note ? <div className="hid-ehr-qs-fact-wide"><dt>Note</dt><dd className="hid-ehr-qs-text">{action.note}</dd></div> : null}
      </dl>
      {changes ? (
        <div className="hid-ehr-qs-steps">
          {action.status === 'open' ? <EhrButton size="sm" variant="secondary" busy={marking} onClick={onDone}>Mark done</EhrButton> : null}
          <EhrButton size="sm" variant="quiet" onClick={onChange}>Change</EhrButton>
        </div>
      ) : null}
    </li>
  )
}

function HistoryRow({ entry, me, own, names }: {
  readonly entry: QualityHistoryEntry
  readonly me: QualityShared['me']
  readonly own: string | undefined
  readonly names: ReadonlyMap<string, string | null>
}) {
  const lines = changeLines(entry, me.lists, own, names)
  const link = patientLinkLine(entry)
  const by = entry.byMembershipId ? memberText(entry.byMembershipId, own, names) : ''
  const moved = entry.fromStatus && entry.toStatus && entry.fromStatus !== entry.toStatus
    ? `${statusText(entry.fromStatus)} to ${statusText(entry.toStatus)}` : ''
  return (
    <li className="hid-ehr-qs-history-entry">
      <span className="hid-ehr-qs-history-when">{whenText(entry.at)}</span>
      <span className="hid-ehr-qs-history-what">{historyKindText(entry.kind)}{by ? `, by ${by}` : ''}</span>
      {moved ? <span className="hid-ehr-qs-history-detail">{moved}</span> : null}
      {link ? <span className="hid-ehr-qs-history-detail">{link}</span> : null}
      {lines.map(line => <span key={line} className="hid-ehr-qs-history-detail">{line}</span>)}
      {entry.text ? <span className="hid-ehr-qs-history-detail hid-ehr-qs-text">Written: {entry.text}</span> : null}
      {entry.reason ? <span className="hid-ehr-qs-history-detail">Reason: {entry.reason}</span> : null}
    </li>
  )
}
