import { EhrField, EhrSelect } from '@hid/ui/ehr'
import { useRef, useState, type ReactNode } from 'react'
import { staffApi, type ClinicalRecord, type DiagnosisUpdate } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import { SubHeading } from '../parts/Detail'
import { ErrorBox, Loading } from '../parts/Notices'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { StatusBadge } from '../parts/StatusBadge'
import {
  DIAGNOSIS_CLINICAL_STATUSES, DIAGNOSIS_VERIFICATION_STATUSES, NO_WRITE, REASON_SHORT, diagnosisStatus, field, refusedFieldErrors, rowVersion, text,
} from './encounters'
import { ListPaging } from './Notes'
import type { RecordList } from './records'

/** The More actions items that open these forms, and today's list of the encounter's diagnoses. */
export const CHANGE_DIAGNOSIS_LABEL = 'Change diagnosis'
export const ADD_DIAGNOSIS_LABEL = 'Add diagnosis'
export const VIEW_DIAGNOSES_LABEL = 'View diagnoses'

/** Today's "Add diagnoses" fields and defaults (the Diagnoses tab). */
const ADD_FIELDS: readonly FieldDef[] = [
  { key: 'codeSystem', label: 'Code system', required: true, placeholder: 'ICD-10', maxLength: 255 },
  { key: 'code', label: 'Code', required: true, maxLength: 100 },
  { key: 'display', label: 'Display', required: true, maxLength: 500 },
  { key: 'clinicalStatus', label: 'Clinical status', choices: DIAGNOSIS_CLINICAL_STATUSES },
  { key: 'verificationStatus', label: 'Verification', choices: DIAGNOSIS_VERIFICATION_STATUSES },
  { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 4000 },
]
const ADD_INITIAL: FormValues = { clinicalStatus: 'active', verificationStatus: 'unconfirmed' }

const CHANGE_FIELDS: readonly FieldDef[] = [
  { key: 'clinicalStatus', label: 'Clinical status', choices: DIAGNOSIS_CLINICAL_STATUSES },
  { key: 'verificationStatus', label: 'Verification', choices: [...DIAGNOSIS_VERIFICATION_STATUSES, { value: 'entered_in_error', label: 'Entered in error' }] },
  { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 4000 },
  { key: 'reason', label: 'Reason for change', required: true, maxLength: 500 },
]
const NOTHING_CHANGED = 'Change the clinical status, verification or notes before saving.'

/** "ICD-10 · B54 · active · provisional": a diagnosis's line under its name, as today's Diagnoses tab lists it. */
function detail(record: ClinicalRecord) {
  return `${field(record, 'codeSystem')} · ${field(record, 'code')} · ${field(record, 'clinicalStatus')} · ${field(record, 'verificationStatus').replaceAll('_', ' ')}`
}

/** "Malaria (fictional) · ICD-10 · B54 · active · provisional": a diagnosis as one line (the picker's option). */
function describe(record: ClinicalRecord) {
  return `${field(record, 'display') || 'Diagnosis'} · ${detail(record)}`
}

function retracted(record: ClinicalRecord) {
  return record.verificationStatus === 'entered_in_error'
}

/** A changeable diagnosis is on the list's first page, or the list has more pages (the More actions item shows then). */
export function hasDiagnosisToChange(list: RecordList<ClinicalRecord>): boolean {
  return (list.first ?? []).some(record => !retracted(record)) || list.cursors.length >= 2 || list.next !== null
}

/**
 * "View diagnoses" (More actions): today's Diagnoses tab, a read, for everyone who may read diagnoses, writers or not.
 * The design's page has no Diagnoses card, and its Saved record names only the encounter's current diagnoses; this
 * lists every diagnosis on today's record pages (50 to a page, the shared "Record pages" pager past 50, today's
 * restart and failed-page notices), each with its code, statuses, notes and status badge, entered in error and refuted
 * ones included, with today's loading, refusal and empty sentences. `footer` is its closing control.
 */
export function DiagnosisList({ list, footer }: { list: RecordList<ClinicalRecord>; footer?: ReactNode }) {
  return (
    <div className="hid-ehr-clinical-form">
      <SubHeading>Diagnoses</SubHeading>
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      <ListPaging list={list} />
      {list.items === null ? (list.loading ? <Loading label="Loading records…" /> : null) : list.items.length === 0 ? (
        <p>No diagnoses for this encounter.</p>
      ) : (
        <ul className="hid-ehr-clinical-history-list">
          {list.items.map(record => (
            <li key={record.id} className="hid-ehr-clinical-consult-record">
              <div className="hid-ehr-clinical-history-row">
                <span>
                  <strong>{field(record, 'display') || 'Diagnosis'}</strong>
                  <span className="hid-ehr-clinical-cell-sub">{detail(record)}</span>
                  {field(record, 'notes') ? <span className="hid-ehr-clinical-cell-sub">{field(record, 'notes')}</span> : null}
                </span>
                <StatusBadge status={diagnosisStatus(record)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {footer ? <div className="hid-ehr-clinical-form-footer">{footer}</div> : null}
    </div>
  )
}

/**
 * "Change diagnosis" (More actions): today's "Change this diagnosis" from the Diagnoses card the design does not
 * have. The form first picks the diagnosis, from the encounter's diagnoses on today's record pages (50 to a page,
 * the shared "Record pages" pager past 50, today's restart notice), one entered in error offered but not choosable
 * (it accepts no further change, as today); then today's fields, checks, access re-check, call and messages.
 * `onChanged` runs after the change is saved: the page says so and reads the page shown again (today's read).
 * `footer` (its "Cancel") sits beside "Update diagnosis", or on its own before a diagnosis is picked.
 */
export function ChangeDiagnosis({ chart, encounterId, list, onBegin, onChanged, footer }: {
  chart: Chart
  encounterId: string
  list: RecordList<ClinicalRecord>
  /** Clears the page's messages as a change begins. */
  onBegin: () => void
  onChanged: () => Promise<void>
  footer?: ReactNode
}) {
  const { facilityId, patientId } = chart
  const [chosenId, setChosenId] = useState('')
  const items = list.items ?? []
  const record = items.find(item => item.id === chosenId && !retracted(item)) ?? null

  const changes = (chosen: ClinicalRecord, values: FormValues): Omit<DiagnosisUpdate, 'expectedRowVersion' | 'changeReason'> => {
    const clinicalStatus = text(values.clinicalStatus)
    const verificationStatus = text(values.verificationStatus)
    const notes = text(values.notes)
    return {
      ...(clinicalStatus !== field(chosen, 'clinicalStatus') ? { clinicalStatus } : {}),
      ...(verificationStatus !== field(chosen, 'verificationStatus') ? { verificationStatus } : {}),
      ...(notes !== field(chosen, 'notes').trim() ? { notes } : {}),
    }
  }

  const validate = (chosen: ClinicalRecord) => (values: FormValues): FieldErrors => ({
    ...(Object.keys(changes(chosen, values)).length === 0 ? { clinicalStatus: NOTHING_CHANGED } : {}),
    ...(text(values.reason).length < 3 ? { reason: REASON_SHORT } : {}),
  })

  const submit = (chosen: ClinicalRecord) => async (values: FormValues): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(chosen.rowVersion)
    if (expectedRowVersion === null) return { formError: 'Reload the diagnosis before changing it.' }
    onBegin()
    try {
      await chart.verify()
      await staffApi.updateDiagnosis(facilityId, patientId, encounterId, chosen.id, { expectedRowVersion, changeReason: text(values.reason), ...changes(chosen, values) })
    } catch (caught) {
      return {
        formError: refusalText(caught, 'The diagnosis could not be changed.'),
        fieldErrors: refusedFieldErrors(caught, { clinicalStatus: 'clinicalStatus', verificationStatus: 'verificationStatus', notes: 'notes', changeReason: 'reason' }),
      }
    }
    setChosenId('')
    await onChanged()
  }

  return (
    <div className="hid-ehr-clinical-form">
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      <ListPaging list={list} />
      {list.items === null ? (list.loading ? <Loading label="Loading records…" /> : null) : items.length === 0 ? (
        <p>No diagnoses for this encounter.</p>
      ) : (
        <EhrField label={<>Diagnosis<span aria-hidden="true"> *</span></>}>
          <EhrSelect value={record?.id ?? ''} required onChange={event => setChosenId(event.target.value)}>
            <option value="">Select…</option>
            {items.map(item => <option key={item.id} value={item.id} disabled={retracted(item)}>{describe(item)}</option>)}
          </EhrSelect>
        </EhrField>
      )}
      {record ? (
        <RecordForm
          key={`${record.id}-${String(record.rowVersion)}`}
          fields={CHANGE_FIELDS}
          initial={{ clinicalStatus: field(record, 'clinicalStatus'), verificationStatus: field(record, 'verificationStatus'), notes: field(record, 'notes') }}
          submitLabel="Update diagnosis"
          busyLabel="Updating…"
          validate={validate(record)}
          onSubmit={submit(record)}
          footer={footer}
        >
          <p className="hid-ehr-clinical-note">Every change is kept in the record history. A diagnosis marked entered in error accepts no further change here.</p>
        </RecordForm>
      ) : footer ? <div className="hid-ehr-clinical-form-footer">{footer}</div> : null}
    </div>
  )
}

/**
 * "Add diagnosis" (More actions): today's "Add diagnoses" from the Diagnoses card the design does not have, so a
 * diagnosis can still be added where no note change is offered (no consultation note, one entered in error, or no
 * note write). Today's fields, checks, access re-check and call; a retry of the same diagnosis reuses its key, so EHR
 * cannot record it twice. `onAdded` runs once it is saved: the page says so and reads the first page again.
 * `footer` (its "Cancel") sits beside "Save record".
 */
export function AddDiagnosis({ chart, encounterId, onBegin, onAdded, footer }: {
  chart: Chart
  encounterId: string
  onBegin: () => void
  onAdded: () => Promise<void>
  footer?: ReactNode
}) {
  const { facilityId, patientId } = chart
  const attempt = useRef<{ signature: string; key: string } | null>(null)

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
    onBegin()
    try {
      await chart.verify()
      await staffApi.createRecord(facilityId, patientId, encounterId, 'diagnoses', body, attempt.current.key)
    } catch (caught) {
      return {
        formError: refusalText(caught, 'Record could not be saved.'),
        fieldErrors: refusedFieldErrors(caught, { codeSystem: 'codeSystem', code: 'code', display: 'display', clinicalStatus: 'clinicalStatus', verificationStatus: 'verificationStatus', notes: 'notes' }),
      }
    }
    attempt.current = null
    await onAdded()
  }

  return <RecordForm fields={ADD_FIELDS} initial={ADD_INITIAL} submitLabel="Save record" onSubmit={add} footer={footer} />
}
