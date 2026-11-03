import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useRef, useState } from 'react'
import { Badge } from '../../../kasuwa/ui'
import { staffApi, type ClinicalRecord, type DiagnosisUpdate } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import { SubHeading } from '../parts/Detail'
import { formatWhen, statusWords } from '../parts/format'
import { ErrorBox, Loading } from '../parts/Notices'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { StatusBadge } from '../parts/StatusBadge'
import {
  DIAGNOSIS_CLINICAL_STATUSES, DIAGNOSIS_UPDATED, DIAGNOSIS_VERIFICATION_STATUSES, NO_WRITE, REASON_SHORT, RECORD_SAVED, RELOAD_FAILED,
  diagnosisStatus, field, refusedFieldErrors, rowVersion, text, type StatusOption,
} from './encounters'
import { ListPaging } from './Notes'
import type { RecordList } from './records'

// Today's "Add diagnoses" fields, in its order and words (Clinical.tsx:566).
const ADD_FIELDS: readonly FieldDef[] = [
  { key: 'codeSystem', label: 'Code system', required: true, placeholder: 'ICD-10', maxLength: 255, row: 'code' },
  { key: 'code', label: 'Code', required: true, maxLength: 100, row: 'code' },
  // Today's "Display" (Clinical.tsx:568) is the record's field name; the form says what it is.
  { key: 'display', label: 'Diagnosis', required: true, maxLength: 500 },
  { key: 'clinicalStatus', label: 'Clinical status', choices: DIAGNOSIS_CLINICAL_STATUSES },
  { key: 'verificationStatus', label: 'Verification', choices: DIAGNOSIS_VERIFICATION_STATUSES },
  { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 4000 },
]
const ADD_INITIAL: FormValues = { clinicalStatus: 'active', verificationStatus: 'unconfirmed' }

/**
 * A refusal's sentences lead with the record's field name ("Display must be shorter than…"); the form calls that field
 * "Diagnosis", so a sentence led by it says so. Only a sentence's first word changes, and words without it are kept.
 */
function asTheFormSays(said: string): string {
  return said.replace(/(^|[.!?] )Display\b/g, '$1Diagnosis')
}
// Today's change selects open on the current values and offer no blank choice, so no empty status is ever sent
// (Clinical.tsx DiagnosisUpdateForm).
const VERIFICATION_CHOICES: readonly StatusOption[] = [...DIAGNOSIS_VERIFICATION_STATUSES, { value: 'entered_in_error', label: 'Entered in error' }]
const CHANGE_FIELDS: readonly FieldDef[] = [
  { key: 'clinicalStatus', label: 'Clinical status', choices: DIAGNOSIS_CLINICAL_STATUSES, blank: false },
  { key: 'verificationStatus', label: 'Verification', choices: VERIFICATION_CHOICES, blank: false },
  { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 4000 },
  { key: 'reason', label: 'Reason for change', required: true, maxLength: 500 },
]
const NOTHING_CHANGED = 'Change the clinical status, verification or notes before saving.'

/** A status as its choice says it ("Active", "Provisional"), never the stored value. */
function choiceLabel(choices: readonly StatusOption[], value: string): string {
  return choices.find(choice => choice.value === value)?.label ?? (value ? statusWords(value) : '')
}

/** Its code, then its clinical status and verification in words: "ICD-10 B54 · Active · Provisional". */
function detail(record: ClinicalRecord) {
  const code = [field(record, 'codeSystem'), field(record, 'code')].filter(Boolean).join(' ')
  return [code, choiceLabel(DIAGNOSIS_CLINICAL_STATUSES, field(record, 'clinicalStatus')), choiceLabel(VERIFICATION_CHOICES, field(record, 'verificationStatus'))]
    .filter(Boolean).join(' · ')
}

/**
 * The encounter's diagnoses (today's Diagnoses tab), on today's record pages: each with its code and status, "Change
 * this diagnosis" while it is not entered in error, and "Add diagnoses". Every change re-checks access first and is
 * kept in the history; a new diagnosis shows the first page again, a change the page shown (today's reads).
 */
export function DiagnosesCard({ chart, encounterId, list, canWrite, onSaved, onError }: {
  chart: Chart
  encounterId: string
  list: RecordList<ClinicalRecord>
  canWrite: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const [changing, setChanging] = useState<string | null>(null)
  const [added, setAdded] = useState(0)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const { facilityId, patientId } = chart

  const afterChange = async (message: string, first: boolean) => {
    onSaved(message)
    const failure = await list.reload(first)
    if (failure !== null) onError(`${RELOAD_FAILED} ${failure}`.trim())
  }

  const add = async (values: FormValues): Promise<SubmitOutcome> => {
    if (!chart.canWrite) return { formError: NO_WRITE }
    const notes = text(values.notes)
    const body = {
      codeSystem: text(values.codeSystem), code: text(values.code), display: text(values.display),
      clinicalStatus: text(values.clinicalStatus) || 'active', verificationStatus: text(values.verificationStatus) || 'unconfirmed',
      notes: notes || undefined,
    }
    const signature = JSON.stringify(body)
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    onSaved('')
    try {
      await chart.verify()
      await staffApi.createRecord(facilityId, patientId, encounterId, 'diagnoses', body, attempt.current.key)
    } catch (caught) {
      const fieldErrors = refusedFieldErrors(caught, { codeSystem: 'codeSystem', code: 'code', display: 'display', clinicalStatus: 'clinicalStatus', verificationStatus: 'verificationStatus', notes: 'notes' })
      return {
        formError: asTheFormSays(refusalText(caught, 'Record could not be saved.')),
        fieldErrors: fieldErrors.display ? { ...fieldErrors, display: asTheFormSays(fieldErrors.display) } : fieldErrors,
      }
    }
    attempt.current = null
    setAdded(count => count + 1)
    await afterChange(RECORD_SAVED, true)
  }

  const change = (record: ClinicalRecord) => {
    const changes = (values: FormValues): Omit<DiagnosisUpdate, 'expectedRowVersion' | 'changeReason'> => {
      const clinicalStatus = text(values.clinicalStatus)
      const verificationStatus = text(values.verificationStatus)
      const notes = text(values.notes)
      return {
        ...(clinicalStatus !== field(record, 'clinicalStatus') ? { clinicalStatus } : {}),
        ...(verificationStatus !== field(record, 'verificationStatus') ? { verificationStatus } : {}),
        ...(notes !== field(record, 'notes').trim() ? { notes } : {}),
      }
    }
    const validate = (values: FormValues): FieldErrors => ({
      ...(Object.keys(changes(values)).length === 0 ? { clinicalStatus: NOTHING_CHANGED } : {}),
      ...(text(values.reason).length < 3 ? { reason: REASON_SHORT } : {}),
    })
    const submit = async (values: FormValues): Promise<SubmitOutcome> => {
      const expectedRowVersion = rowVersion(record.rowVersion)
      if (expectedRowVersion === null) return { formError: 'Reload the diagnosis before changing it.' }
      onSaved('')
      try {
        await chart.verify()
        await staffApi.updateDiagnosis(facilityId, patientId, encounterId, record.id, { expectedRowVersion, changeReason: text(values.reason), ...changes(values) })
      } catch (caught) {
        return {
          formError: refusalText(caught, 'The diagnosis could not be changed.'),
          fieldErrors: refusedFieldErrors(caught, { clinicalStatus: 'clinicalStatus', verificationStatus: 'verificationStatus', notes: 'notes', changeReason: 'reason' }),
        }
      }
      setChanging(null)
      await afterChange(DIAGNOSIS_UPDATED, false)
    }
    return { validate, submit }
  }

  return (
    <EhrCard title="Diagnoses">
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      <ListPaging list={list} />
      {list.items === null ? (list.loading ? <Loading label="Loading records…" /> : null) : list.items.length === 0 ? (
        <p>No diagnoses for this consultation.</p>
      ) : (
        <ul className="hid-ehr-clinical-history-list">
          {list.items.map(record => {
            const retracted = record.verificationStatus === 'entered_in_error'
            const recorded = formatWhen(field(record, 'createdAt'))
            const open = changing === record.id
            const form = open ? change(record) : null
            return (
              <li key={record.id} className="hid-ehr-clinical-consult-record">
                <div className="hid-ehr-clinical-history-row">
                  <span>
                    <strong>{field(record, 'display') || 'Diagnosis'}</strong>
                    <span className="hid-ehr-clinical-cell-sub">{detail(record)}</span>
                    {field(record, 'notes') ? <span className="hid-ehr-clinical-cell-sub">{field(record, 'notes')}</span> : null}
                    {recorded ? <span className="hid-ehr-clinical-cell-sub">Recorded: {recorded}</span> : null}
                  </span>
                  {/* Today's warning badge for a diagnosis entered in error; the shared status map has no tone for it. */}
                  {retracted ? <Badge size="sm" tone="warn">Entered in error</Badge> : <StatusBadge status={diagnosisStatus(record)} />}
                </div>
                {canWrite && !retracted ? (
                  <EhrButton variant="secondary" size="sm" aria-expanded={open} onClick={() => setChanging(open ? null : record.id)}>
                    {open ? 'Cancel editing' : 'Change this diagnosis'}
                  </EhrButton>
                ) : null}
                {form ? (
                  <RecordForm
                    key={`${record.id}-${String(record.rowVersion)}`}
                    fields={CHANGE_FIELDS}
                    initial={{ clinicalStatus: field(record, 'clinicalStatus'), verificationStatus: field(record, 'verificationStatus'), notes: field(record, 'notes') }}
                    submitLabel="Update diagnosis"
                    submitVariant="secondary"
                    busyLabel="Updating…"
                    // Not while the list is read again: the row version shown may be about to change (today's recordsLoading).
                    disabled={list.loading}
                    validate={form.validate}
                    onSubmit={form.submit}
                  >
                    <p className="hid-ehr-clinical-note">Every change is kept in the record history. A diagnosis marked entered in error accepts no further change here.</p>
                  </RecordForm>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {canWrite ? (
        <>
          <SubHeading>Add diagnoses</SubHeading>
          <RecordForm key={added} fields={ADD_FIELDS} initial={ADD_INITIAL} submitLabel="Save record" submitVariant="secondary" onSubmit={add} />
        </>
      ) : null}
    </EhrCard>
  )
}
