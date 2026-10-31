import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { staffApi, type ClinicalRecord, type Encounter, type NoteRevision } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import {
  ActionList, ConfirmAction, DetailGrid, DetailMeta, HistoryCard, SavedRecord, VersionsCard, type HistoryItem, type VersionItem,
} from '../parts/Detail'
import { formatWhen, shortId, statusLabel } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import { Banner, ErrorBox, Loading, NoActions, RecordHeading, RecordNotFound } from '../parts/Notices'
import { patientLine } from '../parts/PatientHeader'
import { COMPLETE_FIELD, RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import { isObservation, noteStatus as observationStatus } from '../nursing/observations'
import { NO_RECORD_ACCESS, recordKey } from '../triage/records'
import { vitalStatus } from '../triage/vitals'
import { DiagnosesCard } from './Diagnoses'
import { DocumentsCard } from './Documents'
import {
  AMEND_LABEL, CLOSING_STATUSES, EDIT_DRAFT_LABEL, ENCOUNTER_CHANGED, ENCOUNTER_CREATED, ENCOUNTER_STATUS_UPDATED, ENCOUNTER_TRANSITIONS,
  NOTES_ARE_DRAFTS, NOTE_STATUS_UPDATED, NO_COMPLAINT, NO_WRITE, REASON_FIELD, RECORD_NOT_SAVED, RECORD_SAVED, RELOAD_FAILED, RELOAD_NOTE,
  RELOAD_RECORD, REVISION_FAILED, REVISION_REASON_FIELD, REVISION_RECORDED, SAVE_DRAFT, SIGN_LABEL, STATUS_FAILED, TITLE, UPDATING,
  WRITE_NOTE_LABEL, consultationNote, contentCheck, diagnosisStatus, encounterClosesRecords, encounterTitle, encounterTypeLabel, field,
  isoNow, reasonCheck, recordStatus, refusedFieldErrors, retractionNotPermitted, rowVersion, text, useLatest,
} from './encounters'
import { NotesCard } from './Notes'
import { EncounterOrders, orderPath } from './orders'
import { TodaySections } from './TodaySections'
import { useDocumentList, useRecordList, useRevisions, type RecordList } from './records'

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
  | { readonly phase: 'ready'; readonly encounter: Encounter; readonly others: readonly Encounter[] }

/** Reads the encounter after today's access re-check, with the first page of the patient's other encounters. */
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
        const [encounter, page] = await Promise.all([
          staffApi.encounter(facilityId, patientId, recordId),
          staffApi.encounters(facilityId, patientId).catch(() => null),
        ])
        if (!current) return
        if (encounter.patientId !== patientId || encounter.facilityId !== facilityId) return setLoaded({ phase: 'missing' })
        const others = (page?.items ?? []).filter(item => item.id !== encounter.id && item.patientId === patientId && item.facilityId === facilityId)
        setLoaded({ phase: 'ready', encounter, others })
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
  return <EncounterRecord key={loaded.encounter.id} chart={chart} initial={loaded.encounter} others={loaded.others} />
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

const AMEND_FIELDS: readonly FieldDef[] = [
  { key: 'content', label: 'Amendment', type: 'textarea', required: true, maxLength: 100_000 },
  { key: 'reason', label: 'Reason', type: 'textarea', required: true, maxLength: 500 },
]
/** The draft's content, then today's revision reason: an edit is a revision, recorded under the clinician's reason. */
const EDIT_FIELDS: readonly FieldDef[] = [{ key: 'content', label: 'Clinical note', type: 'textarea', required: true, maxLength: 100_000 }, REVISION_REASON_FIELD]
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

type Asking = { readonly label: string; readonly word?: string; readonly answer: (yes: boolean) => void }

function EncounterRecord({ chart, initial, others }: { chart: Chart; initial: Encounter; others: readonly Encounter[] }) {
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
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const encounterId = encounter.id

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
  const prescriptions = useRecordList(chart, encounterId, 'prescriptions', reads.prescriptions)
  const labs = useRecordList(chart, encounterId, 'lab-requests', reads.labs)
  const documents = useDocumentList(chart, encounterId, reads.documents)
  // The Saved record summarises the encounter: its consultation note is read from the first page, whichever page the
  // Notes card shows.
  const note = consultationNote(notes.first)
  const revisions = useRevisions(chart, encounterId, note?.id ?? null, note?.rowVersion)
  const latest = revisions.items?.at(-1) ?? null
  // Nothing is signed or amended unseen: its content must have been read (today's rule).
  const seen = !!note && !revisions.loading && !revisions.error && (revisions.items?.length ?? 0) > 0

  // After a change removes the control that had focus, focus goes to "Available actions" (never from an effect).
  useLayoutEffect(() => {
    if (!focusRequest) return
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected) document.getElementById(`encounter-${encounterId}-actions`)?.focus()
  }, [encounterId, focusRequest])

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

  /** A revision of the consultation note (the design's amendment, or an edit of the draft), under the typed reason. */
  const noteRevision = async (values: FormValues): Promise<SubmitOutcome> => {
    if (!note) return
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_NOTE }
    const content = text(values.content)
    const changeReason = text(values.reason)
    const signature = JSON.stringify([expectedRowVersion, content, changeReason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    begin()
    try {
      await chart.verify()
      await staffApi.addNoteRevision(facilityId, patientId, encounterId, note.id, { expectedRowVersion, changeReason, content }, attempt.current.key)
    } catch (caught) {
      return { formError: refusalText(caught, REVISION_FAILED), fieldErrors: refusedFieldErrors(caught, { content: 'content', changeReason: 'reason' }) }
    }
    attempt.current = null
    finish(REVISION_RECORDED)
    // The consultation note is on the first page: the list shows it again, with its revisions.
    await reloaded(notes.reload(true), revisions.reload())
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
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    begin()
    try {
      await chart.verify()
      await staffApi.createRecord(facilityId, patientId, encounterId, 'clinical-notes', body, attempt.current.key)
    } catch (caught) {
      return { formError: refusalText(caught, RECORD_NOT_SAVED), fieldErrors: refusedFieldErrors(caught, { noteType: 'noteType', title: 'title', content: 'content' }) }
    }
    attempt.current = null
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

  // The design's actions on the consultation note, once its content was read (today's rule): "Sign note" for a draft
  // (the design's typed SIGN dialog) and "Amend signed note". Every note, this one included, has today's own actions
  // in the Notes card ("Mark entered in error" among them); "Write clinical note" is today's note form, always offered.
  const actions: ActionDef[] = []
  if (writes.notes && note && seen) {
    if (note.status === 'draft') {
      actions.push({ id: 'sign', label: SIGN_LABEL, fields: [REASON_FIELD], confirm: { word: 'SIGN' }, validate: reasonCheck, busy: UPDATING, run: noteStatus('signed') })
    }
    if (note.status === 'signed' || note.status === 'amended') {
      actions.push({ id: 'amend', label: AMEND_LABEL, fields: AMEND_FIELDS, validate: values => ({ ...contentCheck(values), ...reasonCheck(values) }), run: noteRevision })
    }
  }
  if (writes.notes) {
    actions.push({ id: 'write-note', label: WRITE_NOTE_LABEL, fields: WRITE_FIELDS, hint: NOTES_ARE_DRAFTS, submit: SAVE_DRAFT, validate: writeCheck, run: writeNote })
  }
  if (writes.encounter) {
    for (const transition of ENCOUNTER_TRANSITIONS[encounter.status] ?? []) {
      actions.push({
        id: `encounter-${transition.value}`, label: transition.label, fields: [REASON_FIELD], validate: reasonCheck,
        confirm: CLOSING_STATUSES.has(transition.value) ? {} : undefined, warning: encounterClosesRecords(), run: encounterStatus(transition.value),
      })
    }
  }
  const action = actions.find(item => item.id === selected) ?? null

  const submitAction = (chosen: ActionDef) => async (values: FormValues): Promise<SubmitOutcome> => {
    if (chosen.confirm && !(await ask(chosen.label, chosen.confirm.word))) return false
    return chosen.run(values)
  }

  // A diagnosis entered in error or refuted (ruled out) is not the encounter's diagnosis; the Diagnoses card still lists it.
  const currentDiagnoses = (diagnoses.first ?? [])
    .filter(item => item.verificationStatus !== 'entered_in_error' && item.verificationStatus !== 'refuted')
    .map(item => field(item, 'display')).filter(Boolean)
  const readsNone = !Object.values(reads).some(Boolean)
  const saved: KeyValue[] = [
    { label: 'Encounter type', value: encounterTypeLabel(encounter.encounterType) },
    { label: 'Complaint', value: encounter.chiefComplaint || NO_COMPLAINT },
    { label: 'Started', value: formatWhen(encounter.startedAt) },
  ]
  if (reads.diagnoses) saved.push({ label: 'Diagnosis', value: currentDiagnoses.join(', ') })
  if (reads.notes) {
    saved.push({ label: 'Note status', value: note ? statusLabel(recordStatus(note, 'unknown')) : '' })
    saved.push({ label: 'Note', value: noteValue(notes, note, revisions, latest) })
  }

  return (
    <>
      <RecordHeading title={encounterTitle(encounter)} backHref={href()} />
      {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : null}
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      <div className="hid-ehr-clinical-status" role="status">{success}</div>
      <DetailMeta status={encounter.status} patient={patientLine(chart.facts)}>
        <span className="hid-ehr-clinical-meta-saved">Started {formatWhen(encounter.startedAt)}</span>
      </DetailMeta>
      {readsNone ? <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox> : null}
      <DetailGrid>
        <SavedRecord items={saved}>
          {writes.notes && note?.status === 'draft' && seen ? (
            <div className="hid-ehr-clinical-consult-edit">
              <EhrButton variant="secondary" aria-expanded={editing} onClick={() => setEditing(open => !open)}>
                {editing ? 'Cancel editing' : EDIT_DRAFT_LABEL}
              </EhrButton>
              {editing ? (
                <RecordForm
                  key={`${note.id}-${String(note.rowVersion)}`}
                  fields={EDIT_FIELDS}
                  initial={{ content: latest?.content ?? '' }}
                  submitLabel="Save draft changes"
                  validate={values => ({ ...contentCheck(values), ...reasonCheck(values) })}
                  disabled={revisions.loading}
                  onSubmit={noteRevision}
                />
              ) : null}
            </div>
          ) : null}
        </SavedRecord>
        <EhrCard title={<span id={`encounter-${encounterId}-actions`} className="hid-ehr-clinical-consult-focus" tabIndex={-1}>Available actions</span>}>
          {actions.length > 0 ? (
            <ActionList>
              {actions.map(item => (
                <EhrButton key={item.id} variant="secondary" aria-expanded={selected === item.id} onClick={() => setSelected(open => open === item.id ? null : item.id)}>
                  {item.label}
                </EhrButton>
              ))}
            </ActionList>
          ) : <NoActions />}
          {action ? (
            <RecordForm
              key={`${action.id}-${String(encounter.rowVersion)}-${String(note?.rowVersion)}`}
              fields={action.fields}
              initial={action.initial}
              submitLabel={action.submit ?? action.label}
              busyLabel={action.busy}
              validate={action.validate}
              disabled={action.id === 'sign' && revisions.loading}
              onSubmit={submitAction(action)}
            >
              {action.hint ? <p className="hid-ehr-clinical-note">{action.hint}</p> : null}
              {action.warning ? <p className="hid-ehr-clinical-consult-warning">{action.warning}</p> : null}
            </RecordForm>
          ) : null}
          <EncounterOrders chart={chart} encounter={encounter} />
        </EhrCard>
      </DetailGrid>
      <TodaySections chart={chart} />
      <HistoryCard items={historyItems(href, encounterId, others, { notes, diagnoses, vitals, prescriptions, labs }, documents)}>
        <HistoryErrors lists={[notes, diagnoses, vitals, prescriptions, labs, documents]} />
      </HistoryCard>
      <VersionsCard versions={versionItems(revisions.items)} />
      {reads.notes ? (
        <NotesCard chart={chart} encounterId={encounterId} list={notes} canWrite={writes.notes} onSaved={setSuccess} onError={setPageError} />
      ) : null}
      {reads.diagnoses ? (
        <DiagnosesCard chart={chart} encounterId={encounterId} list={diagnoses} canWrite={writes.diagnoses} onSaved={setSuccess} onError={setPageError} />
      ) : null}
      {reads.documents ? (
        <DocumentsCard chart={chart} encounterId={encounterId} list={documents} canWrite={writes.documents} />
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

function noteValue(notes: RecordList<ClinicalRecord>, note: ClinicalRecord | null, revisions: RecordList<NoteRevision>, latest: NoteRevision | null): ReactNode {
  if (notes.first === null) {
    if (notes.loading) return <span role="status">Loading records…</span>
    return notes.error ? <span role="alert">{notes.error}</span> : ''
  }
  if (!note) return ''
  if (revisions.error) return <span role="alert">{revisions.error}</span>
  if (revisions.items === null) return <span role="status">Loading note revisions…</span>
  return latest?.content || 'No note content is available.'
}

function HistoryErrors({ lists }: { lists: readonly RecordList<unknown>[] }) {
  const failure = lists.find(list => list.error)
  return failure ? <ErrorBox>{failure.error}</ErrorBox> : null
}

type Lists = { readonly [K in 'notes' | 'diagnoses' | 'vitals' | 'prescriptions' | 'labs']: RecordList<ClinicalRecord> }

/**
 * "Connected hospital history": the patient's other encounters here, then this encounter's records, each with its status.
 * A record with its own page links to it (nursing observations, vitals, orders), by record ids only.
 */
function historyItems(href: ReturnType<typeof useWorkspaceHref>, encounterId: string, others: readonly Encounter[], lists: Lists, documents: RecordList<{ id: string; fileName: string; status: string }>): HistoryItem[] {
  const rows = (records: readonly ClinicalRecord[], kind: string, title: (record: ClinicalRecord) => string, status: (record: ClinicalRecord) => string, link?: (record: ClinicalRecord) => string) =>
    records.map(record => ({ key: `${kind}-${record.id}`, label: `${kind} · ${title(record)}`, status: status(record), ...(link ? { href: link(record) } : {}) }))
  const notes = lists.notes.items ?? []
  return [
    ...others.map(item => ({ key: `encounter-${item.id}`, label: `${TITLE} · ${encounterTitle(item)}`, href: href(item.id), status: item.status })),
    ...rows(notes.filter(note => !isObservation(note)), 'Clinical notes', record => field(record, 'title') || 'Clinical note', record => recordStatus(record, 'unknown')),
    ...rows(notes.filter(isObservation), 'Nursing observations', record => shortId(record.id), observationStatus, record => href.to('nursing', recordKey(encounterId, record.id))),
    ...rows(lists.diagnoses.items ?? [], 'Diagnoses', record => field(record, 'display') || 'Diagnosis', diagnosisStatus),
    ...rows(lists.vitals.items ?? [], 'Triage & Vitals', record => shortId(record.id), vitalStatus, record => href.to('triage', recordKey(encounterId, record.id))),
    ...rows(lists.prescriptions.items ?? [], 'Pharmacy', record => field(record, 'medicationDisplay') || 'Prescription', record => recordStatus(record), record => href(orderPath(encounterId, 'pharmacy', record.id))),
    ...rows(lists.labs.items ?? [], 'Laboratory', record => field(record, 'testDisplay') || 'Lab request', record => recordStatus(record), record => href(orderPath(encounterId, 'laboratory', record.id))),
    ...(documents.items ?? []).map(item => ({ key: `document-${item.id}`, label: `Documents · ${item.fileName}`, status: item.status || 'uploaded' })),
  ]
}

/** "Preserved versions & amendments": every revision of the consultation note, once it has more than one. */
function versionItems(revisions: readonly NoteRevision[] | null): VersionItem[] {
  if (!revisions || revisions.length < 2) return []
  return revisions.map(revision => ({
    key: revision.id,
    summary: `${revision.createdAt} · Revision ${revision.revisionNo} · ${revision.changeReason}`,
    items: [{ label: 'Content', value: revision.content }, { label: 'Recorded', value: formatWhen(revision.createdAt) }],
  }))
}
