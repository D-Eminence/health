import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useRef, useState, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { staffApi, type ClinicalRecord, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { REVISION_CONTENT_FIELD, REVISION_REASON_FIELD } from '../consult/encounters'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { ActionList, ConfirmAction, DetailGrid, DetailMeta, SavedRecord, VersionsCard, type VersionItem } from '../parts/Detail'
import { formatWhen, shortId } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { MoreActions } from '../parts/MoreActions'
import { ErrorBox, Loading, NoActions, RecordHeading, RecordNotFound } from '../parts/Notices'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import { ConnectedHistory } from '../triage/ConnectedHistory'
import {
  NO_RECORD_ACCESS, REASON_SHORT, RECORD_SAVED, RELOAD_FAILED, field, refusedFieldErrors, rowVersion, text, useFocusAfterChange, useLatest,
  useVisitRecord,
} from '../triage/records'
import {
  AMEND_LABEL, CONTENT_EMPTY, DETAILS_LIMIT, LOADING_REVISIONS, NOTE_STATUS_UPDATED, NOTE_TRANSITIONS, NO_CONTENT, RECORDING, RECORD_REVISION,
  REFRESH_REVISIONS, RELOAD_NOTE, RELOAD_RECORD, REVISION_FAILED, REVISION_RECORDED, STATUS_FAILED, TITLE, UNITS_LIMIT, composeObservation,
  isObservation, noteStatus, observationItems, parseObservation, useRevisions, type NoteStatusChange, type Revisions,
} from './observations'

/** One nursing observation's page, or the chart's own state. */
export function ObservationRecord() {
  const href = useWorkspaceHref()
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <ObservationLoader chart={open} />}</ChartGate>
  return (
    <>
      <RecordHeading title={TITLE} backHref={href()} />
      <ChartGate>{open => <ObservationLoader chart={open} />}</ChartGate>
    </>
  )
}

function ObservationLoader({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()

  if (!chart.can('ehr.note.read')) {
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox>
      </>
    )
  }
  return <ObservationReader chart={chart} />
}

/** Reads the record only for a role that may read it. */
function ObservationReader({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const { recordId = '' } = useParams()
  const { loaded, reload } = useVisitRecord(chart, recordId, 'clinical-notes', isObservation)

  if (loaded.phase === 'loading') return <Loading label="Loading records…" />
  if (loaded.phase === 'missing') return <RecordNotFound backHref={href()} />
  if (loaded.phase === 'failed') {
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        <ErrorBox>{loaded.message}</ErrorBox>
      </>
    )
  }
  return <Observation key={loaded.record.id} chart={chart} encounter={loaded.encounter} note={loaded.record} reload={reload} />
}

/**
 * Today's revision form (Clinical.tsx:879-884), the Notes card's fields: "Content", then "Reason for revision" on one
 * line. Today's revision replaces the whole content, its units line included: the units or dose is its own field here,
 * starting at the latest revision's, so it can be corrected or cleared too.
 */
const AMEND_FIELDS: readonly FieldDef[] = [
  { ...REVISION_CONTENT_FIELD, key: 'note', maxLength: DETAILS_LIMIT },
  { key: 'units', label: 'Units / dose', maxLength: UNITS_LIMIT },
  REVISION_REASON_FIELD,
]

/** Today's revision refusals, in place of the design's "Complete this field." for the same fields. */
function amendCheck(values: FormValues): FieldErrors {
  const errors: Record<string, string> = {}
  if (!text(values.note)) errors.note = CONTENT_EMPTY
  if (text(values.reason).length < 3) errors.reason = REASON_SHORT
  return errors
}

/** Today's status form's one field, and its refusal. */
const STATUS_FIELDS: readonly FieldDef[] = [{ key: 'reason', label: 'Reason for change', required: true, maxLength: 500 }]
const statusCheck = (values: FormValues): FieldErrors => text(values.reason).length < 3 ? { reason: REASON_SHORT } : {}

type Reload = () => Promise<{ readonly items: readonly ClinicalRecord[] } | { readonly failed: string }>
/** The action whose form is open: the amendment, or one of today's status changes. */
type Selected = 'amend' | NoteStatusChange
type Asking = { readonly label: string; readonly word?: string; readonly answer: (yes: boolean) => void }

/**
 * Today's status changes the design's Available actions card does not show: behind "More actions" (the owner's
 * decision), with the same form, reason, dialog, call and messages.
 */
const MORE_CHANGES: ReadonlySet<NoteStatusChange> = new Set(['entered_in_error'])

/**
 * The design's record page for one nursing observation: "Saved record" (the latest revision), "Available actions"
 * (the design's "Amend observation": today's note revision, with a reason; and "Sign note" for a draft; then "More
 * actions", holding today's "Mark entered in error"; each status change with a reason and the design's decision
 * dialog), "Connected hospital history" (the visit, then the encounter's records in the other workspaces:
 * ConnectedHistory) and "Preserved versions & amendments" (every revision, with its own content).
 */
function Observation({ chart, encounter, note, reload }: {
  chart: Chart
  encounter: Encounter
  note: ClinicalRecord
  reload: Reload
}) {
  const href = useWorkspaceHref()
  const location = useLocation()
  const { facilityId, patientId } = chart
  const [success, setSuccess] = useState(() => (location.state as { saved?: unknown } | null)?.saved === true ? RECORD_SAVED : '')
  const [pageError, setPageError] = useState('')
  const [selected, setSelected] = useState<Selected | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const actionsId = `observation-${note.id}-actions`
  const moreId = `observation-${note.id}-more`
  const focusActions = useFocusAfterChange(actionsId)
  const focusMore = useFocusAfterChange(moreId)
  const revisions = useRevisions(chart, encounter.id, note)
  const reloads = useLatest(reload)
  // The revisions read, kept while "Refresh revisions" reads them again: as today, the forms stay (the one in use keeps
  // focus) while the content is hidden, and a status change waits for the read; a failed read hides them.
  const read = revisions.state === 'shown' ? revisions.items : revisions.state === 'loading' ? revisions.earlier : null
  const reading = revisions.state === 'loading'
  const latest = read?.at(-1) ?? null
  const writes = chart.canWrite && chart.can('ehr.note.write')
  // Nothing is amended unseen: the content must have been read (today's rule).
  const canAmend = writes && note.status !== 'entered_in_error' && read !== null
  // Nothing is signed or retracted unseen: as today, only once the note's revisions were read and hold its content.
  const changes = writes && (read?.length ?? 0) > 0 ? NOTE_TRANSITIONS[noteStatus(note)] ?? [] : []
  const change = selected === 'amend' ? null : changes.find(item => item.status === selected) ?? null
  const shownChanges = changes.filter(item => !MORE_CHANGES.has(item.status))
  const moreChanges = changes.filter(item => MORE_CHANGES.has(item.status))
  const ask = (label: string, word?: string) => new Promise<boolean>(answer => setAsking({ label, word, answer }))

  const amend = async (values: FormValues): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_NOTE }
    const content = composeObservation(text(values.note), text(values.units))
    const changeReason = text(values.reason)
    // A retry of the same revision reuses its key, so EHR cannot record it twice.
    const signature = JSON.stringify([expectedRowVersion, content, changeReason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setSuccess('')
    setPageError('')
    try {
      await chart.verify()
      await staffApi.addNoteRevision(facilityId, patientId, encounter.id, note.id, { expectedRowVersion, changeReason, content }, attempt.current.key)
    } catch (caught) {
      return {
        formError: refusalText(caught, REVISION_FAILED),
        fieldErrors: refusedFieldErrors(caught, name => name === 'content' ? 'note' : name === 'changeReason' ? 'reason' : undefined),
      }
    }
    attempt.current = null
    setSelected(null)
    setSuccess(REVISION_RECORDED)
    focusActions()
    const reloaded = await reloads.current()
    if ('failed' in reloaded) setPageError(`${RELOAD_FAILED} ${reloaded.failed}`.trim())
  }

  /**
   * Today's note status change (Clinical.tsx changeRecordStatus): the version shown, the access re-check, then the
   * PATCH with the reason, sent once the design's dialog is confirmed ("SIGN" typed to sign). A refusal, a 412
   * included, shows in the form, as today.
   */
  const changeStatus = (status: NoteStatusChange, label: string) => async (values: FormValues): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_RECORD }
    if (!(await ask(label, status === 'signed' ? 'SIGN' : undefined))) return false
    setSuccess('')
    setPageError('')
    try {
      await chart.verify()
      await staffApi.updateRecord(facilityId, patientId, encounter.id, 'clinical-notes', note.id, { expectedRowVersion, changeReason: text(values.reason), status })
    } catch (caught) {
      return {
        formError: refusalText(caught, STATUS_FAILED),
        fieldErrors: refusedFieldErrors(caught, name => name === 'changeReason' ? 'reason' : undefined),
      }
    }
    setSelected(null)
    setSuccess(NOTE_STATUS_UPDATED)
    focusActions()
    const reloaded = await reloads.current()
    if ('failed' in reloaded) setPageError(`${RELOAD_FAILED} ${reloaded.failed}`.trim())
  }
  const toggle = (action: Selected) => setSelected(current => current === action ? null : action)
  // A menu item always opens its form (a form already open stays, with what was typed), as the consultation page's
  // menu does; the action buttons, the form's own submit or its "Cancel" close it.
  const chooseMore = (id: string) => {
    const chosen = moreChanges.find(item => item.status === id)
    if (chosen) setSelected(chosen.status)
  }
  /** "Cancel" closes a form More actions opened, focus going back to the menu button (as on the consultation page). */
  const cancelMore = () => {
    setSelected(null)
    focusMore()
  }

  const saved: KeyValue[] = [
    { label: 'Visit', value: shortId(encounter.id) },
    { label: 'Category', value: field(note, 'title') },
    ...contentItems(revisions, latest?.content ?? null),
  ]

  return (
    <>
      <RecordHeading title={shortId(note.id)} backHref={href()} />
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      <div className="hid-ehr-clinical-status" role="status">{success}</div>
      <DetailMeta status={noteStatus(note)} saved={field(note, 'updatedAt') || note.createdAt} />
      <DetailGrid>
        <SavedRecord items={saved}>
          {/* Today's "Refresh revisions", also the way to read them again after a failed read. */}
          <EhrButton variant="quiet" size="sm" busy={reading} onClick={() => { setSuccess(''); revisions.refresh() }}>{REFRESH_REVISIONS}</EhrButton>
          {revisions.state === 'failed' ? <ErrorBox>{revisions.message}</ErrorBox> : null}
        </SavedRecord>
        <EhrCard title={<span id={actionsId} className="hid-ehr-clinical-nursing-focus" tabIndex={-1}>Available actions</span>}>
          {canAmend || shownChanges.length > 0 ? (
            <ActionList>
              {canAmend ? <EhrButton variant="secondary" aria-expanded={selected === 'amend'} onClick={() => toggle('amend')}>{AMEND_LABEL}</EhrButton> : null}
              {shownChanges.map(item => (
                <EhrButton key={item.status} variant="secondary" aria-expanded={selected === item.status} onClick={() => toggle(item.status)}>{item.label}</EhrButton>
              ))}
            </ActionList>
          ) : moreChanges.length === 0 ? <NoActions /> : null}
          <MoreActions
            id={moreId}
            items={moreChanges.map(item => ({ id: item.status, label: item.label }))}
            selected={moreChanges.some(item => item.status === selected) ? selected : null}
            onSelect={chooseMore}
          />
          {canAmend && selected === 'amend' ? (
            <RecordForm
              key={`${note.id}-${String(note.rowVersion)}`}
              fields={AMEND_FIELDS}
              initial={{ units: parseObservation(latest?.content ?? '').units }}
              submitLabel={RECORD_REVISION}
              busyLabel={RECORDING}
              validate={amendCheck}
              onSubmit={amend}
            />
          ) : null}
          {change ? (
            <RecordForm
              key={`${change.status}-${note.id}-${String(note.rowVersion)}`}
              fields={STATUS_FIELDS}
              submitLabel={change.label}
              busyLabel="Updating…"
              validate={statusCheck}
              disabled={reading}
              onSubmit={changeStatus(change.status, change.label)}
              footer={MORE_CHANGES.has(change.status) ? <EhrButton variant="secondary" onClick={cancelMore}>Cancel</EhrButton> : undefined}
            />
          ) : null}
        </EhrCard>
      </DetailGrid>
      <ConnectedHistory chart={chart} encounter={encounter} owner="nursing" />
      <VersionsCard versions={versionItems(revisions)} />
      <ConfirmAction
        open={asking !== null}
        label={asking?.label ?? ''}
        word={asking?.word}
        onConfirm={() => { asking?.answer(true); setAsking(null) }}
        onCancel={() => { asking?.answer(false); setAsking(null) }}
      />
    </>
  )
}

/** The note's details and units, or why they are not shown (today's texts). */
function contentItems(revisions: Revisions, content: string | null): KeyValue[] {
  const note = (value: ReactNode): KeyValue[] => [{ label: 'Note', value }]
  if (revisions.state === 'loading') return note(<span role="status">{LOADING_REVISIONS}</span>)
  if (revisions.state === 'failed') return []
  if (!content) return note(NO_CONTENT)
  return observationItems(content)
}

/**
 * "Preserved versions & amendments", once the note has more than one revision: every revision, oldest first, with its
 * own content, under today's "Revision n" and "Recorded {time} · {reason}" (Clinical.tsx NotePanel).
 */
function versionItems(revisions: Revisions): VersionItem[] {
  if (revisions.state !== 'shown' || revisions.items.length < 2) return []
  return revisions.items.map(revision => ({
    key: revision.id,
    summary: `Revision ${revision.revisionNo} · Recorded ${formatWhen(revision.createdAt)} · ${revision.changeReason}`,
    items: observationItems(revision.content),
  }))
}
