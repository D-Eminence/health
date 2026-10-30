import { isHidApiError } from '@hid/http'
import { EhrCard, EhrField, EhrSelect } from '@hid/ui/ehr'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { Banner, RecordHeading } from '../parts/Notices'
import { patientLine } from '../parts/PatientHeader'
import { COMPLETE_FIELD, RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import {
  DIAGNOSIS_CLINICAL_STATUSES, DIAGNOSIS_VERIFICATION_STATUSES, ENCOUNTER_CREATED, ENCOUNTER_TYPES, NEW_TITLE, NOTES_ARE_DRAFTS,
  composeNote, encounterTypeLabel, isoNow, refusedFieldErrors, text,
} from './encounters'

/** "New consultation": the design's create page for the open patient, or the chart's own state. */
export function NewConsultation() {
  const href = useWorkspaceHref()
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <NewConsultationForm chart={chart} />
  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      <ChartGate>{open => <NewConsultationForm chart={open} />}</ChartGate>
    </>
  )
}

/** Today's note limits (RecordForm, clinical-notes): the composed note is one `content` of at most 100,000 characters. */
const NOTE_LIMIT = 100_000
const NOTE_TOO_LONG = 'The clinical note is too long: History, Examination, Clinical note and Follow-up together must be at most 100,000 characters.'
const DIAGNOSIS_KEYS = ['diagnosis', 'diagnosisCodeSystem', 'diagnosisCode'] as const

const ENCOUNTER_FIELDS: readonly FieldDef[] = [
  { key: 'encounterType', label: 'Encounter type', required: true, choices: ENCOUNTER_TYPES },
  { key: 'complaint', label: 'Presenting complaint', required: true, maxLength: 4000 },
]
const NOTE_FIELDS: readonly FieldDef[] = [
  { key: 'history', label: 'History', type: 'textarea', required: true, maxLength: NOTE_LIMIT },
  { key: 'examination', label: 'Examination', type: 'textarea', required: true, maxLength: NOTE_LIMIT },
]
const DIAGNOSIS_FIELDS: readonly FieldDef[] = [
  { key: 'diagnosis', label: 'Diagnosis / assessment', maxLength: 500, hint: 'Optional. With a code system and code, it is saved as this encounter’s diagnosis.' },
  { key: 'diagnosisCodeSystem', label: 'Diagnosis code system', placeholder: 'ICD-10', maxLength: 255 },
  { key: 'diagnosisCode', label: 'Diagnosis code', maxLength: 100 },
  { key: 'diagnosisClinicalStatus', label: 'Clinical status', choices: DIAGNOSIS_CLINICAL_STATUSES },
  { key: 'diagnosisVerification', label: 'Verification', choices: DIAGNOSIS_VERIFICATION_STATUSES },
]
const NOTE_TAIL_FIELDS: readonly FieldDef[] = [
  { key: 'note', label: 'Clinical note', type: 'textarea', required: true, maxLength: NOTE_LIMIT },
  { key: 'followup', label: 'Follow-up', maxLength: 4000 },
]
const INITIAL: FormValues = { encounterType: 'ambulatory', diagnosisClinicalStatus: 'active', diagnosisVerification: 'unconfirmed' }

/** One save in progress: each step keeps its idempotency key while its input is unchanged, and is not sent twice. */
interface Attempt {
  encounter?: Encounter
  encounterStep?: { signature: string; key: string; input: { encounterType: string; status: string; startedAt: string; chiefComplaint: string } }
  note?: { signature: string; key: string; done: boolean }
  diagnosis?: { signature: string; key: string; done: boolean }
}

function step(previous: { signature: string; key: string; done: boolean } | undefined, signature: string) {
  return previous?.signature === signature ? previous : { signature, key: crypto.randomUUID(), done: false }
}

function NewConsultationForm({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const attempt = useRef<Attempt>({})
  const [started, setStarted] = useState<Encounter | null>(null)
  const writesNote = chart.can('ehr.note.write')
  const writesDiagnosis = chart.can('ehr.diagnosis.write')
  const canStart = chart.canWrite && chart.can('ehr.encounter.write')

  const fields = useMemo(() => [
    ...(started ? [] : ENCOUNTER_FIELDS),
    ...(writesNote ? NOTE_FIELDS : []),
    ...(writesDiagnosis ? DIAGNOSIS_FIELDS : []),
    ...(writesNote ? NOTE_TAIL_FIELDS : []),
  ], [started, writesDiagnosis, writesNote])

  const validate = (values: FormValues): FieldErrors => {
    const errors: Record<string, string> = {}
    if (writesDiagnosis && DIAGNOSIS_KEYS.some(key => text(values[key]))) {
      for (const key of DIAGNOSIS_KEYS) if (!text(values[key])) errors[key] = COMPLETE_FIELD
    }
    if (writesNote && noteContent(values).length > NOTE_LIMIT) errors.note = NOTE_TOO_LONG
    return errors
  }

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    const current = attempt.current
    // The DTO fields of the step being sent, named by this form's keys, so a refusal is shown at its field.
    let map: Record<string, string> = {}
    try {
      if (!current.encounter) {
        map = { chiefComplaint: 'complaint', encounterType: 'encounterType' }
        const encounterType = text(values.encounterType)
        const chiefComplaint = text(values.complaint)
        const signature = JSON.stringify([encounterType, chiefComplaint])
        if (current.encounterStep?.signature !== signature) {
          current.encounterStep = { signature, key: crypto.randomUUID(), input: { encounterType, status: 'in_progress', startedAt: isoNow(), chiefComplaint } }
        }
        await chart.verify()
        const created = await staffApi.createEncounter(chart.facilityId, chart.patientId, current.encounterStep.input, current.encounterStep.key)
        current.encounter = created
        setStarted(created)
      }
      const encounterId = current.encounter.id
      if (writesNote) {
        map = { content: 'note' }
        const body = { noteType: 'Consultation', title: 'Consultation note', status: 'draft', content: noteContent(values) }
        current.note = step(current.note, JSON.stringify(body))
        if (!current.note.done) {
          await chart.verify()
          await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'clinical-notes', body, current.note.key)
          current.note.done = true
        }
      }
      const display = text(values.diagnosis)
      if (writesDiagnosis && display) {
        map = { display: 'diagnosis', codeSystem: 'diagnosisCodeSystem', code: 'diagnosisCode', clinicalStatus: 'diagnosisClinicalStatus', verificationStatus: 'diagnosisVerification' }
        const body = {
          codeSystem: text(values.diagnosisCodeSystem), code: text(values.diagnosisCode), display,
          clinicalStatus: text(values.diagnosisClinicalStatus) || 'active', verificationStatus: text(values.diagnosisVerification) || 'unconfirmed',
        }
        current.diagnosis = step(current.diagnosis, JSON.stringify(body))
        if (!current.diagnosis.done) {
          await chart.verify()
          await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'diagnoses', body, current.diagnosis.key)
          current.diagnosis.done = true
        }
      }
      attempt.current = {}
      navigate(href(encounterId), { state: { created: true } })
    } catch (caught) {
      const fallback = current.encounter ? 'Record could not be saved.' : 'Encounter could not be created.'
      return { formError: refusalText(caught, fallback), fieldErrors: refusedFieldErrors(caught, map) }
    }
  }

  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : null}
      <EhrCard>
        <EhrField label={<>Patient<span aria-hidden="true"> *</span></>}>
          <EhrSelect value={chart.patientId} disabled={!canStart} onChange={() => undefined} required>
            <option value={chart.patientId}>{patientLine(chart.facts)}</option>
          </EhrSelect>
        </EhrField>
        <PatientContext chart={chart} />
        {canStart ? (
          <RecordForm fields={fields} initial={INITIAL} submitLabel="Save record" validate={validate} onSubmit={submit}>
            {started ? (
              <p className="hid-ehr-clinical-note" role="status">
                {`${ENCOUNTER_CREATED} ${encounterTypeLabel(started.encounterType)} · ${started.chiefComplaint ?? ''}. Saving again adds the rest to this encounter.`}
              </p>
            ) : null}
            {writesNote ? <p className="hid-ehr-clinical-note">{NOTES_ARE_DRAFTS}</p> : null}
          </RecordForm>
        ) : null}
      </EhrCard>
    </>
  )
}

function noteContent(values: FormValues): string {
  return composeNote([
    ['History', text(values.history)],
    ['Examination', text(values.examination)],
    ['Clinical note', text(values.note)],
    ['Follow-up', text(values.followup)],
  ])
}

type Reported = { readonly state: 'loading' | 'none' | 'failed' } | { readonly state: 'shown'; readonly allergies: string }

/**
 * The design's "Patient context": the patient and their allergies. Today's only allergy record is what the patient
 * reported in their Health ID portal (read for direct care, with ehr.note.read), so it is labelled as such.
 */
function PatientContext({ chart }: { chart: Chart }) {
  const { facilityId, patientId } = chart
  const reads = chart.can('ehr.note.read')
  const [reported, setReported] = useState<Reported>({ state: reads ? 'loading' : 'none' })

  useEffect(() => {
    if (!reads) return
    const controller = new AbortController()
    staffApi.reportedHealthProfile(facilityId, patientId, controller.signal).then(
      profile => controller.signal.aborted ? undefined : setReported(profile?.allergies ? { state: 'shown', allergies: profile.allergies } : { state: 'none' }),
      caught => {
        if (controller.signal.aborted) return
        const hidden = !isHidApiError(caught) || caught.status === 403 || caught.status === 404
        setReported({ state: hidden ? 'none' : 'failed' })
      },
    )
    return () => controller.abort()
  }, [facilityId, patientId, reads])

  return (
    <section className="hid-ehr-clinical-context-block" aria-labelledby="consult-patient-context">
      <h2 id="consult-patient-context">Patient context</h2>
      <p>{chart.facts.name}</p>
      {reported.state === 'loading' ? null : (
        <p>
          {reported.state === 'shown'
            ? `Recorded allergies: ${reported.allergies} (patient-reported: entered by the patient in their Health ID portal, not clinically verified).`
            : reported.state === 'failed'
              ? 'Recorded allergies: what the patient entered about their health could not be loaded. Confirm with the patient.'
              : 'Recorded allergies: None recorded. Confirm with the patient.'}
        </p>
      )}
    </section>
  )
}
