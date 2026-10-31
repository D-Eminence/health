import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { staffApi, type ClinicalRecord, type DocumentRecord, type Encounter, type NoteRevision } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import {
  ActionList, ConfirmAction, DetailGrid, DetailMeta, HistoryCard, SavedRecord, VersionsCard, type HistoryItem, type VersionItem,
} from '../parts/Detail'
import { formatWhen, shortId, statusLabel } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { MoreActions, type MoreActionItem } from '../parts/MoreActions'
import { Banner, ErrorBox, Loading, NoActions, RecordHeading, RecordNotFound } from '../parts/Notices'
import { patientLine } from '../parts/PatientHeader'
import { COMPLETE_FIELD, RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import { NOTE_TRANSITIONS, isObservation, noteStatus as observationStatus } from '../nursing/observations'
import { NO_RECORD_ACCESS, recordKey } from '../triage/records'
import { vitalStatus } from '../triage/vitals'
import {
  ADD_DIAGNOSIS_LABEL, AddDiagnosis, CHANGE_DIAGNOSIS_LABEL, ChangeDiagnosis, DiagnosisList, VIEW_DIAGNOSES_LABEL, hasDiagnosisToChange,
} from './Diagnoses'
import {
  DOCUMENTS_TRUNCATED, DocumentsState, OcrLink, UPLOAD_LABEL, UploadDocument, canOpenDocument, documentDetail, documentLabel, useDocumentOpener,
} from './Documents'
import {
  AMEND_LABEL, CLOSING_STATUSES, DIAGNOSIS_UPDATED, EDIT_DRAFT_LABEL, ENCOUNTER_CHANGED, ENCOUNTER_CREATED, ENCOUNTER_STATUS_UPDATED,
  ENCOUNTER_TRANSITIONS, NEW_DIAGNOSIS_FIELDS, NEW_DIAGNOSIS_INITIAL, NEW_DIAGNOSIS_REFUSED, NOTES_ARE_DRAFTS, NOTE_EIE_LABEL,
  NOTE_STATUS_UPDATED, NO_COMPLAINT, NO_WRITE, REASON_FIELD, RECORD_NOT_SAVED, RECORD_SAVED, RELOAD_FAILED, RELOAD_NOTE, RELOAD_RECORD,
  REVISION_FAILED, REVISION_REASON_FIELD, REVISION_RECORDED, SAVE_DRAFT, SIGN_LABEL, STATUS_FAILED, TITLE, UPDATING, WRITE_NOTE_LABEL,
  consultationNote, contentCheck, encounterClosesRecords, encounterTitle, field, isoNow, newDiagnosisBody, newDiagnosisCheck, reasonCheck,
  recordStatus, refusedFieldErrors, retractionNotPermitted, rowVersion, splitNote, text, useLatest,
} from './encounters'
import { ListPaging, NotesCard } from './Notes'
import { EncounterOrders, orderPath } from './orders'
import { learnFrom } from './orders/orders'
import { pagerProps, useDocumentList, useRecordList, useRevisions, type RecordList } from './records'

/** One encounter's page, or the chart's own state. */
export function EncounterPage() {
  const href = useWorkspaceHref()
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <EncounterLoader chart={chart} />
  return (
    <>
      <RecordHeading title={TITLE} backHref={href()} />
      <ChartGate>{open => <EncounterLoader chart={open} />}</ChartGate>
    </>
  )
}

type Loaded =
  | { readonly phase: 'loading' }
  | { readonly phase: 'missing' }
  | { readonly phase: 'failed'; readonly message: string }
  | { readonly phase: 'ready'; readonly encounter: Encounter }

/** Reads the encounter after today's access re-check. */
function EncounterLoader({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const { recordId = '' } = useParams()
  const { facilityId, patientId } = chart
  const verify = useLatest(chart.verify)
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading' })

  useEffect(() => {
    let current = true
    setLoaded({ phase: 'loading' })
    void (async () => {
      try {
        await verify.current()
        const encounter = await staffApi.encounter(facilityId, patientId, recordId)
        if (!current) return
        if (encounter.patientId !== patientId || encounter.facilityId !== facilityId) return setLoaded({ phase: 'missing' })
        setLoaded({ phase: 'ready', encounter })
      } catch (caught) {
        if (!current) return
        if (isHidApiError(caught) && caught.status === 404) return setLoaded({ phase: 'missing' })
        setLoaded({ phase: 'failed', message: refusalText(caught, 'Encounters could not be loaded.') })
      }
    })()
    return () => { current = false }
  }, [facilityId, patientId, recordId, verify])

  if (loaded.phase === 'loading') return <Loading label="Loading encounters…" />
  if (loaded.phase === 'missing') return <RecordNotFound backHref={href()} />
  if (loaded.phase === 'failed') {
    return (
      <>
        <RecordHeading title={TITLE} backHref={href()} />
        <ErrorBox>{loaded.message}</ErrorBox>
      </>
    )
  }
  return <EncounterRecord key={loaded.encounter.id} chart={chart} initial={loaded.encounter} />
}

interface ActionDef {
  readonly id: string
  readonly label: string
  readonly fields: readonly FieldDef[]
  /** The design's decision dialog: `word` asks for it typed (SIGN). */
  readonly confirm?: { readonly word?: string }
  readonly warning?: string
  /** A plain line under the fields (today's "Notes are saved as drafts…"). */
  readonly hint?: string
  /** The submit button, when it is not the action's label (today's "Save draft"), and its busy label. */
  readonly submit?: string
  readonly busy?: string
  readonly initial?: FormValues
  readonly validate?: (values: FormValues) => FieldErrors
  readonly run: (values: FormValues) => Promise<SubmitOutcome>
}

const AMEND_CONTENT: FieldDef = { key: 'content', label: 'Amendment', type: 'textarea', required: true, maxLength: 100_000 }
const AMEND_REASON: FieldDef = { key: 'reason', label: 'Reason', type: 'textarea', required: true, maxLength: 500 }
/** The draft's content, then today's revision reason: an edit is a revision, recorded under the clinician's reason. */
const EDIT_CONTENT: FieldDef = { key: 'content', label: 'Clinical note', type: 'textarea', required: true, maxLength: 100_000 }
/** Today's "Add notes" fields and limits (Clinical.tsx RecordForm, clinical-notes). */
const WRITE_FIELDS: readonly FieldDef[] = [
  { key: 'noteType', label: 'Note type', required: true, placeholder: 'Consultation', maxLength: 80 },
  { key: 'title', label: 'Title', required: true, maxLength: 240 },
  { key: 'content', label: 'Clinical note', type: 'textarea', required: true, maxLength: 100_000 },
]
const writeCheck = (values: FormValues): FieldErrors => {
  const errors: Record<string, string> = {}
  for (const key of ['noteType', 'title', 'content']) if (!text(values[key])) errors[key] = COMPLETE_FIELD
  return errors
}

/** The More actions items that open a form (or today's diagnoses list) of their own rather than a status change. */
const VIEW_DIAGNOSES = 'view-diagnoses'
const ADD_DIAGNOSIS = 'add-diagnosis'
const CHANGE_DIAGNOSIS = 'change-diagnosis'
const UPLOAD_DOCUMENT = 'upload-document'

type Asking = { readonly label: string; readonly word?: string; readonly answer: (yes: boolean) => void }
/** One step of a save: it keeps its idempotency key while its input is unchanged, and is never sent again once done. */
type Step = { readonly signature: string; readonly key: string; done: boolean }

function step(previous: Step | null, signature: string): Step {
  return previous?.signature === signature ? previous : { signature, key: crypto.randomUUID(), done: false }
}

function EncounterRecord({ chart, initial }: { chart: Chart; initial: Encounter }) {
  const href = useWorkspaceHref()
  const location = useLocation()
  const { facilityId, patientId } = chart
  const [encounter, setEncounter] = useState(initial)
  const [success, setSuccess] = useState(() => (location.state as { created?: unknown } | null)?.created === true ? ENCOUNTER_CREATED : '')
  const [pageError, setPageError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  // Where focus goes on that request when the control that had it is gone: the More actions button once a form it
  // opened is closed, else "Available actions".
  const focusTarget = useRef<string | null>(null)
  const writeAttempt = useRef<{ signature: string; key: string } | null>(null)
  // A note change with a new diagnosis is two saves: the revision, then the diagnosis.
  const revisionAttempt = useRef<Step | null>(null)
  const diagnosisAttempt = useRef<Step | null>(null)
  // A revision saved while its form stays open (its diagnosis was refused): the note has a new version not yet read.
  const unreadRevision = useRef(false)
  const encounterId = encounter.id
  const actionsId = `encounter-${encounterId}-actions`
  const moreId = `encounter-${encounterId}-more`

  const reads = {
    notes: chart.can('ehr.note.read'), diagnoses: chart.can('ehr.diagnosis.read'), vitals: chart.can('ehr.vital.read'),
    prescriptions: chart.can('ehr.prescription.read'), labs: chart.can('ehr.lab-request.read'), documents: chart.can('ehr.document.read'),
  }
  const writes = {
    notes: chart.canWrite && chart.can('ehr.note.write'), encounter: chart.canWrite && chart.can('ehr.encounter.write'),
    diagnoses: chart.canWrite && chart.can('ehr.diagnosis.write'), documents: chart.canWrite && chart.can('ehr.document.write'),
  }
  const notes = useRecordList(chart, encounterId, 'clinical-notes', reads.notes)
  const diagnoses = useRecordList(chart, encounterId, 'diagnoses', reads.diagnoses)
  const vitals = useRecordList(chart, encounterId, 'vitals', reads.vitals)
  // Today's page learns from its orders answers what the order pages need (receiving-side reports, late corrections).
  const prescriptions = useRecordList(chart, encounterId, 'prescriptions', reads.prescriptions, learnFrom)
  const labs = useRecordList(chart, encounterId, 'lab-requests', reads.labs, learnFrom)
  const documents = useDocumentList(chart, encounterId, reads.documents)
  const opener = useDocumentOpener(chart)
  // The Saved record summarises the encounter: its consultation note is read from the first page, whichever page the
  // Notes card shows.
  const note = consultationNote(notes.first)
  const revisions = useRevisions(chart, encounterId, note?.id ?? null, note?.rowVersion)
  const latest = revisions.items?.at(-1) ?? null
  // Nothing is signed or amended unseen: its content must have been read (today's rule).
  const seen = !!note && !revisions.loading && !revisions.error && (revisions.items?.length ?? 0) > 0

  // After a change removes the control that had focus, focus goes to "Available actions", or back to the More actions
  // button when its form was closed (never from a deferred effect).
  useLayoutEffect(() => {
    if (!focusRequest) return
    const target = focusTarget.current
    focusTarget.current = null
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    const element = (target ? document.getElementById(target) : null) ?? document.getElementById(actionsId)
    element?.focus()
  }, [actionsId, focusRequest])

  const finish = (message: string) => {
    setSelected(null)
    setEditing(false)
    setSuccess(message)
    setFocusRequest(count => count + 1)
  }
  const reloaded = async (...reads: Promise<string | null>[]) => {
    const failures = (await Promise.all(reads)).filter((failure): failure is string => failure !== null)
    if (failures.length > 0) setPageError(`${RELOAD_FAILED} ${failures[0]}`.trim())
  }
  const begin = () => { setSuccess(''); setPageError('') }
  const ask = (label: string, word?: string) => new Promise<boolean>(answer => setAsking({ label, word, answer }))
  /**
   * A form left after its note change was saved but its diagnosis was not: the note is read again (its new version),
   * and the next change starts afresh.
   */
  const settle = () => {
    if (!unreadRevision.current) return
    unreadRevision.current = false
    revisionAttempt.current = null
    diagnosisAttempt.current = null
    void reloaded(notes.reload(true))
  }

  /**
   * A revision of the consultation note (the design's amendment, or an edit of the draft), under the typed reason,
   * then the diagnosis typed with it, if any (New consultation's fields), each after the access re-check. A retry
   * reuses each step's key, and a saved revision is not sent again: a retry after a refused diagnosis sends only it.
   */
  const noteRevision = async (values: FormValues): Promise<SubmitOutcome> => {
    if (!note) return
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_NOTE }
    const content = text(values.content)
    const changeReason = text(values.reason)
    const diagnosis = writes.diagnoses ? newDiagnosisBody(values) : null
    const revision = step(revisionAttempt.current, JSON.stringify([note.id, expectedRowVersion, content, changeReason]))
    revisionAttempt.current = revision
    begin()
    if (!revision.done) {
      try {
        await chart.verify()
        await staffApi.addNoteRevision(facilityId, patientId, encounterId, note.id, { expectedRowVersion, changeReason, content }, revision.key)
      } catch (caught) {
        return { formError: refusalText(caught, REVISION_FAILED), fieldErrors: refusedFieldErrors(caught, { content: 'content', changeReason: 'reason' }) }
      }
      revision.done = true
      unreadRevision.current = true
    }
    if (diagnosis) {
      const added = step(diagnosisAttempt.current, JSON.stringify(diagnosis))
      diagnosisAttempt.current = added
      try {
        await chart.verify()
        await staffApi.createRecord(facilityId, patientId, encounterId, 'diagnoses', diagnosis, added.key)
      } catch (caught) {
        // The revision is saved, and the page says so; the form keeps the diagnosis for a retry.
        setSuccess(REVISION_RECORDED)
        return { formError: refusalText(caught, RECORD_NOT_SAVED), fieldErrors: refusedFieldErrors(caught, NEW_DIAGNOSIS_REFUSED) }
      }
    }
    revisionAttempt.current = null
    diagnosisAttempt.current = null
    unreadRevision.current = false
    finish(diagnosis ? `${REVISION_RECORDED} ${RECORD_SAVED}` : REVISION_RECORDED)
    // The consultation note is on the first page: the list shows it again, with its revisions (and a new diagnosis,
    // today's create read: the first page).
    await reloaded(notes.reload(true), revisions.refresh(), ...(diagnosis ? [diagnoses.reload(true)] : []))
  }

  /** Today's note status change on the consultation note, under the clinician's typed reason. */
  const noteStatus = (status: string) => async (values: FormValues): Promise<SubmitOutcome> => {
    if (!note) return
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_RECORD }
    begin()
    try {
      await chart.verify()
      await staffApi.updateRecord(facilityId, patientId, encounterId, 'clinical-notes', note.id, { expectedRowVersion, changeReason: text(values.reason), status })
    } catch (caught) {
      return { formError: refusalText(caught, STATUS_FAILED), fieldErrors: refusedFieldErrors(caught, { changeReason: 'reason' }) }
    }
    finish(NOTE_STATUS_UPDATED)
    await reloaded(notes.reload(true))
  }

  /** Today's "Add notes": a draft of the type and title typed; the list shows its first page again. */
  const writeNote = async (values: FormValues): Promise<SubmitOutcome> => {
    if (!chart.canWrite) return { formError: NO_WRITE }
    const body = { noteType: text(values.noteType), title: text(values.title), status: 'draft', content: text(values.content) }
    const signature = JSON.stringify(['clinical-notes', body])
    if (writeAttempt.current?.signature !== signature) writeAttempt.current = { signature, key: crypto.randomUUID() }
    begin()
    try {
      await chart.verify()
      await staffApi.createRecord(facilityId, patientId, encounterId, 'clinical-notes', body, writeAttempt.current.key)
    } catch (caught) {
      return { formError: refusalText(caught, RECORD_NOT_SAVED), fieldErrors: refusedFieldErrors(caught, { noteType: 'noteType', title: 'title', content: 'content' }) }
    }
    writeAttempt.current = null
    finish(RECORD_SAVED)
    await reloaded(notes.reload(true))
  }

  const encounterStatus = (status: string) => async (values: FormValues): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(encounter.rowVersion)
    if (expectedRowVersion === null) return { formError: 'Reload the encounter before changing its status.' }
    begin()
    let updated: Encounter
    try {
      await chart.verify()
      updated = await staffApi.updateEncounter(facilityId, patientId, encounterId, {
        expectedRowVersion, changeReason: text(values.reason), status, ...(status === 'completed' ? { endedAt: isoNow() } : {}),
      })
    } catch (caught) {
      if (isHidApiError(caught) && caught.status === 403 && caught.code === 'ENCOUNTER_RETRACTION_NOT_PERMITTED') {
        return { formError: retractionNotPermitted(status) }
      }
      if (isHidApiError(caught) && (caught.status === 409 || caught.status === 412)) {
        let fresh: Encounter
        try { fresh = await staffApi.encounter(facilityId, patientId, encounterId) }
        catch { return { formError: refusalText(caught, 'Status could not be changed.') } }
        setEncounter(fresh)
        setSelected(null)
        setPageError(ENCOUNTER_CHANGED)
        setFocusRequest(count => count + 1)
        return
      }
      return { formError: refusalText(caught, 'Status could not be changed.'), fieldErrors: refusedFieldErrors(caught, { changeReason: 'reason' }) }
    }
    if (updated?.id === encounterId) setEncounter(updated)
    finish(ENCOUNTER_STATUS_UPDATED)
    if (CLOSING_STATUSES.has(status)) await reloaded(...[notes, diagnoses, vitals, prescriptions, labs, documents].map(list => list.reload()))
  }

  // A new diagnosis may be typed with a note change (New consultation's fields, optional).
  const diagnosisFields = writes.diagnoses ? NEW_DIAGNOSIS_FIELDS : []
  const diagnosisInitial = writes.diagnoses ? NEW_DIAGNOSIS_INITIAL : {}
  const revisionCheck = (values: FormValues): FieldErrors => ({
    ...contentCheck(values), ...reasonCheck(values), ...(writes.diagnoses ? newDiagnosisCheck(values) : {}),
  })

  // The design's actions on the consultation note, once its content was read (today's rule): "Sign note" for a draft
  // (the design's typed SIGN dialog) and "Amend signed note"; and "Write clinical note", today's note form, always
  // offered. Every other live action is in More actions (the owner's decision), each with today's form, reason, call
  // and messages: today's encounter status changes, "Mark note entered in error" on this note (the Notes card keeps
  // every note's own actions too), and the Diagnoses and Documents cards' changes the design's page does not have.
  const actions: ActionDef[] = []
  const more: ActionDef[] = []
  if (writes.notes && note && seen) {
    if (note.status === 'draft') {
      actions.push({ id: 'sign', label: SIGN_LABEL, fields: [REASON_FIELD], confirm: { word: 'SIGN' }, validate: reasonCheck, busy: UPDATING, run: noteStatus('signed') })
    }
    if (note.status === 'signed' || note.status === 'amended') {
      actions.push({
        id: 'amend', label: AMEND_LABEL, fields: [AMEND_CONTENT, ...diagnosisFields, AMEND_REASON], initial: diagnosisInitial,
        validate: revisionCheck, run: noteRevision,
      })
    }
  }
  if (writes.notes && reads.notes) {
    actions.push({ id: 'write-note', label: WRITE_NOTE_LABEL, fields: WRITE_FIELDS, hint: NOTES_ARE_DRAFTS, submit: SAVE_DRAFT, validate: writeCheck, run: writeNote })
  }
  if (writes.encounter) {
    for (const transition of ENCOUNTER_TRANSITIONS[encounter.status] ?? []) {
      more.push({
        id: `encounter-${transition.value}`, label: transition.label, fields: [REASON_FIELD], validate: reasonCheck,
        confirm: CLOSING_STATUSES.has(transition.value) ? {} : undefined, warning: encounterClosesRecords(), run: encounterStatus(transition.value),
      })
    }
  }
  if (writes.notes && note && seen && (NOTE_TRANSITIONS[recordStatus(note, 'unknown')] ?? []).some(change => change.status === 'entered_in_error')) {
    more.push({ id: 'note-error', label: NOTE_EIE_LABEL, fields: [REASON_FIELD], confirm: {}, validate: reasonCheck, busy: UPDATING, run: noteStatus('entered_in_error') })
  }
  // Today's Diagnoses tab is a read: everyone who may read diagnoses can list them all ("View diagnoses"), with or
  // without write access. Its changes were offered only beside the diagnoses it read.
  const canViewDiagnoses = reads.diagnoses
  const canAddDiagnosis = writes.diagnoses && reads.diagnoses
  const canChangeDiagnosis = writes.diagnoses && reads.diagnoses && hasDiagnosisToChange(diagnoses)
  const canUpload = writes.documents && reads.documents
  const statusChanges: MoreActionItem[] = more.map(({ id, label }) => ({ id, label }))
  const diagnosisChanges: MoreActionItem[] = [
    ...(canAddDiagnosis ? [{ id: ADD_DIAGNOSIS, label: ADD_DIAGNOSIS_LABEL }] : []),
    ...(canChangeDiagnosis ? [{ id: CHANGE_DIAGNOSIS, label: CHANGE_DIAGNOSIS_LABEL }] : []),
  ]
  const documentChanges: MoreActionItem[] = canUpload ? [{ id: UPLOAD_DOCUMENT, label: UPLOAD_LABEL }] : []
  /** The menu's changes; with none and no design action, the card says so (today's sentence) above the menu. */
  const changes = [...statusChanges, ...diagnosisChanges, ...documentChanges]
  const menu: MoreActionItem[] = [
    ...statusChanges,
    ...(canViewDiagnoses ? [{ id: VIEW_DIAGNOSES, label: VIEW_DIAGNOSES_LABEL }] : []),
    ...diagnosisChanges,
    ...documentChanges,
  ]
  const action = [...actions, ...more].find(item => item.id === selected) ?? null
  const choose = (id: string | null) => { settle(); setSelected(id) }
  /** Closes what a More actions item opened ("Cancel", "Close"), focus going back to the menu button. */
  const close = () => {
    choose(null)
    focusTarget.current = moreId
    setFocusRequest(count => count + 1)
  }
  const cancel = <EhrButton variant="secondary" onClick={close}>Cancel</EhrButton>

  const submitAction = (chosen: ActionDef) => async (values: FormValues): Promise<SubmitOutcome> => {
    if (chosen.confirm && !(await ask(chosen.label, chosen.confirm.word))) return false
    return chosen.run(values)
  }

  const readsNone = !Object.values(reads).some(Boolean)
  const saved = savedItems(encounter, reads, { notes, note, revisions, latest, diagnoses })
  const documentRow = (item: DocumentRecord): HistoryItem => ({
    key: `document-${item.id}`,
    label: documentLabel(item),
    status: item.status || 'uploaded',
    // A clean document is the design's one-line link and badge; one that cannot be opened says why under its name.
    detail: canOpenDocument(item) ? undefined : documentDetail(item),
    open: { onOpen: () => { void opener.open(item) }, disabled: !canOpenDocument(item), busy: opener.opening === item.id },
    extra: chart.can('ocr.job.read') && canOpenDocument(item) ? <OcrLink chart={chart} document={item} /> : undefined,
  })
  const historyLists = [notes, vitals, prescriptions, labs, documents]
  const firstRead = (list: RecordList<unknown>) => list.items === null && list.loading
  // The documents say their own loading and empty sentences (today's Documents tab), under the rows; the history's
  // own empty sentence waits for every list.
  const recordsLoading = [notes, vitals, prescriptions, labs].some(firstRead)
  const historyLoading = recordsLoading || firstRead(documents)
  const updatedAt = (encounter as Encounter & { updatedAt?: unknown }).updatedAt

  return (
    <>
      <RecordHeading title={encounterTitle(encounter)} backHref={href()} />
      {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : null}
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      <div className="hid-ehr-clinical-status" role="status">{success}</div>
      <DetailMeta status={encounter.status} patient={patientLine(chart.facts)} saved={(typeof updatedAt === 'string' && updatedAt) || encounter.startedAt} />
      {readsNone ? <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox> : null}
      <DetailGrid>
        <SavedRecord items={saved}>
          {writes.notes && note?.status === 'draft' && seen ? (
            <div className="hid-ehr-clinical-consult-edit">
              <EhrButton variant="secondary" aria-expanded={editing} onClick={() => { settle(); setEditing(open => !open) }}>
                {editing ? 'Cancel editing' : EDIT_DRAFT_LABEL}
              </EhrButton>
              {editing ? (
                <RecordForm
                  key={`${note.id}-${String(note.rowVersion)}`}
                  fields={[EDIT_CONTENT, ...diagnosisFields, REVISION_REASON_FIELD]}
                  initial={{ content: latest?.content ?? '', ...diagnosisInitial }}
                  submitLabel="Save draft changes"
                  validate={revisionCheck}
                  disabled={revisions.loading}
                  onSubmit={noteRevision}
                />
              ) : null}
            </div>
          ) : null}
        </SavedRecord>
        <EhrCard title={<span id={actionsId} className="hid-ehr-clinical-consult-focus" tabIndex={-1}>Available actions</span>}>
          {actions.length > 0 ? (
            <ActionList>
              {actions.map(item => (
                <EhrButton key={item.id} variant="secondary" aria-expanded={selected === item.id} onClick={() => choose(selected === item.id ? null : item.id)}>
                  {item.label}
                </EhrButton>
              ))}
            </ActionList>
          ) : changes.length === 0 ? <NoActions /> : null}
          <MoreActions id={moreId} items={menu} selected={selected} onSelect={choose} />
          {action ? (
            <RecordForm
              key={`${action.id}-${String(encounter.rowVersion)}-${String(note?.rowVersion)}`}
              fields={action.fields}
              initial={action.initial}
              submitLabel={action.submit ?? action.label}
              busyLabel={action.busy}
              validate={action.validate}
              disabled={(action.id === 'sign' || action.id === 'note-error') && revisions.loading}
              onSubmit={submitAction(action)}
              // A form More actions opened closes with "Cancel"; the design's own actions toggle with their button.
              footer={more.includes(action) ? cancel : undefined}
            >
              {action.hint ? <p className="hid-ehr-clinical-note">{action.hint}</p> : null}
              {action.warning ? <p className="hid-ehr-clinical-consult-warning">{action.warning}</p> : null}
            </RecordForm>
          ) : null}
          {selected === VIEW_DIAGNOSES && canViewDiagnoses ? (
            <DiagnosisList list={diagnoses} footer={<EhrButton variant="secondary" onClick={close}>Close</EhrButton>} />
          ) : null}
          {selected === ADD_DIAGNOSIS && canAddDiagnosis ? (
            <AddDiagnosis
              chart={chart}
              encounterId={encounterId}
              onBegin={begin}
              onAdded={async () => { finish(RECORD_SAVED); await reloaded(diagnoses.reload(true)) }}
              footer={cancel}
            />
          ) : null}
          {selected === CHANGE_DIAGNOSIS && canChangeDiagnosis ? (
            <ChangeDiagnosis
              chart={chart}
              encounterId={encounterId}
              list={diagnoses}
              onBegin={begin}
              onChanged={async () => { finish(DIAGNOSIS_UPDATED); await reloaded(diagnoses.reload()) }}
              footer={cancel}
            />
          ) : null}
          {selected === UPLOAD_DOCUMENT && canUpload ? <UploadDocument chart={chart} encounterId={encounterId} list={documents} footer={cancel} /> : null}
          <EncounterOrders chart={chart} encounter={encounter} />
        </EhrCard>
      </DetailGrid>
      <HistoryCard
        items={historyItems(href, encounterId, { notes, vitals, prescriptions, labs }, documents, documentRow)}
        empty={historyLoading ? '' : undefined}
        footer={(
          <>
            {reads.documents ? <DocumentsState list={documents} /> : null}
            {documents.truncated ? <p className="hid-ehr-clinical-note">{DOCUMENTS_TRUNCATED}</p> : null}
          </>
        )}
      >
        <HistoryErrors lists={historyLists} />
        {opener.error ? <ErrorBox>{opener.error}</ErrorBox> : null}
        {recordsLoading ? <Loading label="Loading records…" /> : null}
        {/* Each list pages on its own, 50 to a page, as today's records tabs do: an order past the first page is reached here. */}
        <HistoryPages title="Triage & Vitals" list={vitals} />
        <HistoryPages title="Laboratory" list={labs} />
        <HistoryPages title="Pharmacy" list={prescriptions} />
        <HistoryPages title="Documents" list={documents} />
      </HistoryCard>
      <VersionsCard versions={versionItems(note, revisions.items)} />
      {reads.notes ? (
        <NotesCard chart={chart} encounterId={encounterId} list={notes} canWrite={writes.notes} onSaved={setSuccess} onError={setPageError} />
      ) : null}
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

/**
 * "Saved record", in the design's rows: Visit, Complaint, History, Examination, Diagnosis, Note. History, Examination,
 * the clinical note and Follow-up are the sections New consultation composed the note from (a note written otherwise
 * is shown whole as Note); a section the note does not have is not listed, as the design lists only what was saved.
 */
function savedItems(encounter: Encounter, reads: { readonly notes: boolean; readonly diagnoses: boolean }, read: {
  notes: RecordList<ClinicalRecord>
  note: ClinicalRecord | null
  revisions: RecordList<NoteRevision>
  latest: NoteRevision | null
  diagnoses: RecordList<ClinicalRecord>
}): KeyValue[] {
  const { notes, note, revisions, latest, diagnoses } = read
  const content = notes.first !== null && note && !revisions.error && revisions.items !== null ? latest?.content ?? '' : null
  const sections = reads.notes && content ? splitNote(content) : null
  const items: KeyValue[] = [
    { label: 'Visit', value: shortId(encounter.id) },
    { label: 'Complaint', value: encounter.chiefComplaint || NO_COMPLAINT },
  ]
  if (sections?.history) items.push({ label: 'History', value: sections.history })
  if (sections?.examination) items.push({ label: 'Examination', value: sections.examination })
  if (reads.diagnoses) items.push({ label: 'Diagnosis', value: diagnosisValue(diagnoses) })
  if (reads.notes) items.push({ label: 'Note', value: sections ? sections.note : noteValue(notes, note, revisions, content) })
  if (sections?.followup) items.push({ label: 'Follow-up', value: sections.followup })
  return items
}

/** The encounter's diagnoses (first page): one entered in error or refuted (ruled out) is not its diagnosis. */
function diagnosisValue(diagnoses: RecordList<ClinicalRecord>): ReactNode {
  if (diagnoses.first === null) {
    if (diagnoses.loading) return <span role="status">Loading records…</span>
    return diagnoses.error ? <span role="alert">{diagnoses.error}</span> : ''
  }
  return diagnoses.first
    .filter(item => item.verificationStatus !== 'entered_in_error' && item.verificationStatus !== 'refuted')
    .map(item => field(item, 'display')).filter(Boolean).join(', ')
}

/** The Note row while the note is read, cannot be read, or has no content. */
function noteValue(notes: RecordList<ClinicalRecord>, note: ClinicalRecord | null, revisions: RecordList<NoteRevision>, content: string | null): ReactNode {
  if (notes.first === null) {
    if (notes.loading) return <span role="status">Loading records…</span>
    return notes.error ? <span role="alert">{notes.error}</span> : ''
  }
  if (!note) return ''
  if (revisions.error) return <span role="alert">{revisions.error}</span>
  if (revisions.items === null) return <span role="status">Loading note revisions…</span>
  return content || 'No note content is available.'
}

function HistoryErrors({ lists }: { lists: readonly RecordList<unknown>[] }) {
  const failure = lists.find(list => list.error)
  return failure ? <ErrorBox>{failure.error}</ErrorBox> : null
}

/**
 * One history list's "Record pages" (today's pager), with its notice, named by the list it pages. Shown only while the
 * list spans more than one page, or has something to say.
 */
function HistoryPages({ title, list }: { title: string; list: RecordList<unknown> }) {
  const captionId = useId()
  if (!pagerProps(list) && !list.notice) return null
  return (
    <div className="hid-ehr-clinical-orders-pages" role="group" aria-labelledby={captionId}>
      <p id={captionId} className="hid-ehr-clinical-orders-muted hid-ehr-clinical-orders-gap">{title}</p>
      <ListPaging list={list} />
    </div>
  )
}

type Lists = { readonly [K in 'notes' | 'vitals' | 'prescriptions' | 'labs']: RecordList<ClinicalRecord> }

/**
 * "Connected hospital history": the records of other workspaces this encounter holds, in the sidebar's order (Triage &
 * Vitals, Laboratory, Pharmacy, Nursing observations, Documents), each with its status. Every row opens: a record's
 * page, by record ids only, or a document's file. Vitals, orders and documents page in this card; nursing
 * observations come from the notes' first page, whichever page the Clinical notes card shows.
 */
function historyItems(href: ReturnType<typeof useWorkspaceHref>, encounterId: string, lists: Lists, documents: RecordList<DocumentRecord>, documentRow: (document: DocumentRecord) => HistoryItem): HistoryItem[] {
  const rows = (records: readonly ClinicalRecord[], kind: string, title: (record: ClinicalRecord) => string, status: (record: ClinicalRecord) => string, link: (record: ClinicalRecord) => string) =>
    records.map(record => ({ key: `${kind}-${record.id}`, label: `${kind} · ${title(record)}`, status: status(record), href: link(record) }))
  return [
    ...rows(lists.vitals.items ?? [], 'Triage & Vitals', record => shortId(record.id), vitalStatus, record => href.to('triage', recordKey(encounterId, record.id))),
    ...rows(lists.labs.items ?? [], 'Laboratory', record => field(record, 'testDisplay') || 'Lab request', record => recordStatus(record), record => href(orderPath(encounterId, 'laboratory', record.id))),
    ...rows(lists.prescriptions.items ?? [], 'Pharmacy', record => field(record, 'medicationDisplay') || 'Prescription', record => recordStatus(record), record => href(orderPath(encounterId, 'pharmacy', record.id))),
    ...rows((lists.notes.first ?? []).filter(isObservation), 'Nursing observations', record => shortId(record.id), observationStatus, record => href.to('nursing', recordKey(encounterId, record.id))),
    ...(documents.items ?? []).map(documentRow),
  ]
}

/** An ISO time for ordering; one that is not a date goes last. */
function timeOf(value: string): number {
  const time = Date.parse(value)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

/**
 * "Preserved versions & amendments", oldest first: every revision of the consultation note once it has more than one
 * ("{time} · {note status} · {reason}", as the nursing record names them), and, for a signed note, the version it was
 * signed as ("{signedAt} · draft · Sign note"), so a signed note shows the card even with one revision.
 */
function versionItems(note: ClinicalRecord | null, revisions: readonly NoteRevision[] | null): VersionItem[] {
  if (!note || !revisions || revisions.length === 0) return []
  const status = statusLabel(recordStatus(note, 'unknown'))
  const entries: { at: string; item: VersionItem }[] = revisions.length < 2 ? [] : revisions.map(revision => ({
    at: revision.createdAt,
    item: {
      key: revision.id,
      summary: `${revision.createdAt} · ${status} · ${revision.changeReason}`,
      items: [{ label: 'Content', value: revision.content }, { label: 'Recorded', value: formatWhen(revision.createdAt) }],
    },
  }))
  const signedAt = field(note, 'signedAt')
  if (signedAt) {
    // What was signed: the newest revision recorded by then (the first, should none be).
    const signed = timeOf(signedAt)
    const current = [...revisions].reverse().find(revision => timeOf(revision.createdAt) <= signed) ?? revisions[0]!
    entries.push({
      at: signedAt,
      item: {
        key: `signed-${note.id}`,
        summary: `${signedAt} · draft · ${SIGN_LABEL}`,
        items: [{ label: 'Content', value: current.content }, { label: 'Recorded', value: formatWhen(current.createdAt) }],
      },
    })
  }
  return entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => timeOf(a.at) === timeOf(b.at) ? a.index - b.index : timeOf(a.at) < timeOf(b.at) ? -1 : 1)
    .map(entry => entry.item)
}
