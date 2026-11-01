import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useRef, useState } from 'react'
import { staffApi, type ClinicalRecord } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import { ActionList, ConfirmAction } from '../parts/Detail'
import { formatWhen } from '../parts/format'
import { KeyValueList } from '../parts/KeyValueList'
import { ErrorBox, Loading } from '../parts/Notices'
import { RecordForm, type FieldDef, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { Pager } from '../parts/RecordTable'
import { StatusBadge } from '../parts/StatusBadge'
import {
  LOADING_REVISIONS, NOTE_TRANSITIONS, NO_CONTENT, RECORDING, RECORD_REVISION, REFRESH_REVISIONS, isObservation, type NoteStatusChange,
} from '../nursing/observations'
import { useFocusAfterChange } from '../triage/records'
import {
  ADD_REVISION_LABEL, HIDE_NOTE, NOTES_TITLE, NOTE_STATUS_UPDATED, NO_NOTES, NO_NOTES_ON_PAGE, REASON_FIELD, RELOAD_FAILED, RELOAD_NOTE,
  RELOAD_RECORD, REVIEW_NOTE, REVISION_CONTENT_FIELD, REVISION_FAILED, REVISION_REASON_FIELD, REVISION_RECORDED, STATUS_FAILED, UPDATING,
  contentCheck, field, reasonCheck, recordStatus, refusedFieldErrors, rowVersion, text,
} from './encounters'
import { pagerProps, useRevisions, type RecordList } from './records'

const STATUS_FIELDS: readonly FieldDef[] = [REASON_FIELD]
const REVISION_FIELDS: readonly FieldDef[] = [REVISION_CONTENT_FIELD, REVISION_REASON_FIELD]

type Ask = (label: string, word?: string) => Promise<boolean>
type Asking = { readonly label: string; readonly word?: string; readonly answer: (yes: boolean) => void }

/** Today's notice and the shared "Record pages" pager, above a list (today's place), while it has more than one page. */
export function ListPaging({ list }: { list: RecordList<unknown> }) {
  const pager = pagerProps(list)
  return (
    <>
      {list.notice ? (
        list.notice.alert ? <ErrorBox>{list.notice.text}</ErrorBox> : <p className="hid-ehr-clinical-note" role="status">{list.notice.text}</p>
      ) : null}
      {pager ? <Pager {...pager} /> : null}
    </>
  )
}

/**
 * The encounter's clinical notes (today's Notes tab), drawn as the design's card: every note that is not a nursing
 * observation (those have their own pages, which History links for the page shown here), on today's record pages.
 * Each note offers today's NotePanel: "Review note content" (its revisions, read when opened), then, once read, "Sign
 * note" (a draft; the design's typed SIGN dialog) and "Mark entered in error" (a plain confirm), each with a reason,
 * and "Add a note revision". Every change re-checks access first.
 */
export function NotesCard({ chart, encounterId, list, canWrite, onSaved, onError }: {
  chart: Chart
  encounterId: string
  list: RecordList<ClinicalRecord>
  canWrite: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const [asking, setAsking] = useState<Asking | null>(null)
  const ask: Ask = (label, word) => new Promise<boolean>(answer => setAsking({ label, word, answer }))
  const notes = (list.items ?? []).filter(note => !isObservation(note))
  const onlyPage = list.cursors.length < 2 && !list.next

  return (
    <EhrCard title={NOTES_TITLE}>
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      <ListPaging list={list} />
      {list.items === null ? (list.loading ? <Loading label="Loading records…" /> : null) : notes.length === 0 ? (
        <p>{onlyPage ? NO_NOTES : NO_NOTES_ON_PAGE}</p>
      ) : (
        <ul className="hid-ehr-clinical-history-list">
          {notes.map(note => (
            <NoteRow key={note.id} chart={chart} encounterId={encounterId} note={note} canWrite={canWrite} ask={ask} list={list} onSaved={onSaved} onError={onError} />
          ))}
        </ul>
      )}
      <ConfirmAction
        open={asking !== null}
        label={asking?.label ?? ''}
        word={asking?.word}
        onConfirm={() => { asking?.answer(true); setAsking(null) }}
        onCancel={() => { asking?.answer(false); setAsking(null) }}
      />
    </EhrCard>
  )
}

type Selected = NoteStatusChange | 'revise'

function NoteRow({ chart, encounterId, note, canWrite, ask, list, onSaved, onError }: {
  chart: Chart
  encounterId: string
  note: ClinicalRecord
  canWrite: boolean
  ask: Ask
  list: RecordList<ClinicalRecord>
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const { facilityId, patientId } = chart
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [notice, setNotice] = useState('')
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const titleId = `note-${note.id}-title`
  const focusTitle = useFocusAfterChange(titleId)
  const revisions = useRevisions(chart, encounterId, open ? note.id : null, note.rowVersion)
  const status = recordStatus(note, 'unknown')
  // A failed read hides the content; while it is read again it is hidden too, so nothing is signed unseen (today).
  const reading = revisions.loading || (revisions.items === null && !revisions.error)
  const read = !revisions.error && revisions.items !== null
  const shown = read && !reading ? revisions.items ?? [] : null
  const changes = canWrite && read && (revisions.items?.length ?? 0) > 0 ? NOTE_TRANSITIONS[status] ?? [] : []
  const canRevise = canWrite && read && status !== 'entered_in_error'
  const change = changes.find(item => item.status === selected) ?? null

  const begin = () => { setNotice(''); onSaved(''); onError('') }
  const afterReload = (failures: readonly (string | null)[]) => {
    const failure = failures.find((item): item is string => item !== null)
    if (failure !== undefined) onError(`${RELOAD_FAILED} ${failure}`.trim())
  }

  /** Today's changeRecordStatus: the version shown, the dialog, the access re-check, then the PATCH with the typed reason. */
  const changeStatus = (to: NoteStatusChange, label: string) => async (values: FormValues): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_RECORD }
    if (!(await ask(label, to === 'signed' ? 'SIGN' : undefined))) return false
    begin()
    try {
      await chart.verify()
      await staffApi.updateRecord(facilityId, patientId, encounterId, 'clinical-notes', note.id, { expectedRowVersion, changeReason: text(values.reason), status: to })
    } catch (caught) {
      return { formError: refusalText(caught, STATUS_FAILED), fieldErrors: refusedFieldErrors(caught, { changeReason: 'reason' }) }
    }
    setSelected(null)
    onSaved(NOTE_STATUS_UPDATED)
    focusTitle()
    afterReload([await list.reload()])
  }

  /** Today's NotePanel revision: a retry of the same revision reuses its key, so EHR cannot record it twice. */
  const addRevision = async (values: FormValues): Promise<SubmitOutcome> => {
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
    setSelected(null)
    setNotice(REVISION_RECORDED)
    focusTitle()
    // The revisions are read again (a failure shows in place of the content, as today), then the list.
    void revisions.refresh()
    afterReload([await list.reload()])
  }

  const toggle = (action: Selected) => setSelected(current => current === action ? null : action)
  const noteType = field(note, 'noteType')

  return (
    <li className="hid-ehr-clinical-consult-record">
      <div className="hid-ehr-clinical-history-row">
        <span>
          <strong id={titleId} className="hid-ehr-clinical-consult-focus" tabIndex={-1}>{field(note, 'title') || 'Clinical note'}</strong>
          <span className="hid-ehr-clinical-cell-sub">{[noteType, note.createdAt ? `Recorded ${formatWhen(note.createdAt)}` : ''].filter(Boolean).join(' · ')}</span>
        </span>
        <StatusBadge status={status} />
      </div>
      <EhrButton variant="secondary" size="sm" aria-expanded={open} onClick={() => { setOpen(value => !value); setSelected(null); setNotice('') }}>
        {open ? HIDE_NOTE : REVIEW_NOTE}
      </EhrButton>
      {open ? (
        <div className="hid-ehr-clinical-form">
          <EhrButton variant="quiet" size="sm" busy={reading} onClick={() => { setNotice(''); return revisions.refresh() }}>{REFRESH_REVISIONS}</EhrButton>
          {/* Mounted while the note is open, so what a revision records, and the read that follows, are announced. */}
          <div className="hid-ehr-clinical-status" role="status">{notice || (reading ? LOADING_REVISIONS : '')}</div>
          {revisions.error ? <ErrorBox>{revisions.error}</ErrorBox> : null}
          {shown?.length === 0 ? <p>{NO_CONTENT}</p> : null}
          {shown?.map(revision => (
            <KeyValueList key={revision.id} items={[
              { label: `Revision ${revision.revisionNo}`, value: revision.content },
              { label: 'Recorded', value: `${formatWhen(revision.createdAt)} · ${revision.changeReason}` },
            ]} />
          ))}
          {changes.length > 0 || canRevise ? (
            <div className="hid-ehr-clinical-note">
              <ActionList>
                {changes.map(item => (
                  <EhrButton key={item.status} variant="secondary" aria-expanded={selected === item.status} onClick={() => toggle(item.status)}>{item.label}</EhrButton>
                ))}
                {canRevise ? <EhrButton variant="secondary" aria-expanded={selected === 'revise'} onClick={() => toggle('revise')}>{ADD_REVISION_LABEL}</EhrButton> : null}
              </ActionList>
            </div>
          ) : null}
          {change ? (
            <RecordForm
              key={`${change.status}-${String(note.rowVersion)}`}
              fields={STATUS_FIELDS}
              submitLabel={change.label}
              busyLabel={UPDATING}
              validate={reasonCheck}
              disabled={reading}
              onSubmit={changeStatus(change.status, change.label)}
            />
          ) : null}
          {canRevise && selected === 'revise' ? (
            <RecordForm
              key={`revise-${String(note.rowVersion)}`}
              fields={REVISION_FIELDS}
              submitLabel={RECORD_REVISION}
              busyLabel={RECORDING}
              validate={values => ({ ...contentCheck(values), ...reasonCheck(values) })}
              onSubmit={addRevision}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
