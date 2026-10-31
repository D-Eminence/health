import { isHidApiError } from '@hid/http'
import { EhrCard } from '@hid/ui/ehr'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type Encounter } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { RecordHeading } from '../parts/Notices'
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
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <NewConsultationForm chart={open} />}</ChartGate>
  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      <ChartGate>{open => <NewConsultationForm chart={open} />}</ChartGate>
    </>
  )
}

/** Today's note limits (RecordForm, clinical-notes): the composed note is one `content` of at most 100,000 characters. */
const NOTE_LIMIT = 100_000
const NOTE_TOO_LONG = 'The note is too long. History, Examination, Clinical note and Follow-up together can be up to 100,000 characters.'
const DIAGNOSIS_KEYS = ['diagnosis', 'diagnosisCodeSystem', 'diagnosisCode'] as const
/** Said after a partial save, once the draft note is in: its fields are gone, and it is changed from the encounter's page. */
const NOTE_SAVED = 'The draft note is saved; change it from the consultation’s page.'

const ENCOUNTER_FIELDS: readonly FieldDef[] = [
  { key: 'encounterType', label: 'Type of visit', required: true, choices: ENCOUNTER_TYPES },
  { key: 'complaint', label: 'Presenting complaint', required: true, maxLength: 4000 },
]
const NOTE_FIELDS: readonly FieldDef[] = [
  { key: 'history', label: 'History', type: 'textarea', required: true, maxLength: NOTE_LIMIT },
  { key: 'examination', label: 'Examination', type: 'textarea', required: true, maxLength: NOTE_LIMIT },
]
const DIAGNOSIS_FIELDS: readonly FieldDef[] = [
  { key: 'diagnosis', label: 'Diagnosis', maxLength: 500, hint: 'Optional. Add its code to save it as this consultation’s diagnosis.' },
  { key: 'diagnosisCodeSystem', label: 'Code system', placeholder: 'ICD-10', maxLength: 255, row: 'code' },
  { key: 'diagnosisCode', label: 'Code', maxLength: 100, row: 'code' },
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
  // Once the draft note is saved it is never sent again, so its fields go (as the encounter's do once it is started).
  const [noteSaved, setNoteSaved] = useState(false)
  const writesNote = chart.can('ehr.note.write')
  const writesDiagnosis = chart.can('ehr.diagnosis.write')
  const canStart = chart.canWrite && chart.can('ehr.encounter.write')

  const fields = useMemo(() => [
    ...(started ? [] : ENCOUNTER_FIELDS),
    ...(writesNote && !noteSaved ? NOTE_FIELDS : []),
    ...(writesDiagnosis ? DIAGNOSIS_FIELDS : []),
    ...(writesNote && !noteSaved ? NOTE_TAIL_FIELDS : []),
  ], [noteSaved, started, writesDiagnosis, writesNote])

  const validate = (values: FormValues): FieldErrors => {
    const errors: Record<string, string> = {}
    if (writesDiagnosis && DIAGNOSIS_KEYS.some(key => text(values[key]))) {
      for (const key of DIAGNOSIS_KEYS) if (!text(values[key])) errors[key] = COMPLETE_FIELD
    }
    if (writesNote && !noteSaved && noteContent(values).length > NOTE_LIMIT) errors.note = NOTE_TOO_LONG
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
      // A saved step is never sent again, whatever its fields now hold: a second create would be a second record.
      if (writesNote && !current.note?.done) {
        map = { content: 'note' }
        const body = { noteType: 'Consultation', title: 'Consultation note', status: 'draft', content: noteContent(values) }
        current.note = step(current.note, JSON.stringify(body))
        await chart.verify()
        await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'clinical-notes', body, current.note.key)
        current.note.done = true
        setNoteSaved(true)
      }
      const display = text(values.diagnosis)
      if (writesDiagnosis && display && !current.diagnosis?.done) {
        map = { display: 'diagnosis', codeSystem: 'diagnosisCodeSystem', code: 'diagnosisCode', clinicalStatus: 'diagnosisClinicalStatus', verificationStatus: 'diagnosisVerification' }
        const body = {
          codeSystem: text(values.diagnosisCodeSystem), code: text(values.diagnosisCode), display,
          clinicalStatus: text(values.diagnosisClinicalStatus) || 'active', verificationStatus: text(values.diagnosisVerification) || 'unconfirmed',
        }
        current.diagnosis = step(current.diagnosis, JSON.stringify(body))
        await chart.verify()
        await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'diagnoses', body, current.diagnosis.key)
        current.diagnosis.done = true
      }
      attempt.current = {}
      navigate(href(encounterId), { state: { created: true } })
    } catch (caught) {
      const fallback = current.encounter ? 'The rest could not be saved.' : 'The consultation could not be started.'
      return { formError: refusalText(caught, fallback), fieldErrors: refusedFieldErrors(caught, map) }
    }
  }

  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      <EhrCard>
        <PatientContext chart={chart} />
        {canStart ? (
          <RecordForm fields={fields} initial={INITIAL} submitLabel={started ? 'Save the rest' : 'Start consultation'} validate={validate} onSubmit={submit}>
            {started ? (
              <p className="hid-ehr-clinical-note" role="status">
                {`${ENCOUNTER_CREATED} ${encounterTypeLabel(started.encounterType)} · ${started.chiefComplaint ?? ''}.${noteSaved ? ` ${NOTE_SAVED}` : ''} Save again to add the rest to it.`}
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

type Reported = { readonly state: 'loading' | 'hidden' | 'none' | 'failed' } | { readonly state: 'shown'; readonly allergies: string }

/**
 * The design's "Patient context": the patient and their allergies. Today's only allergy record is what the patient
 * reported in their Health ID portal (read for direct care, with ehr.note.read), so it is labelled as such. As today's
 * "Reported by the patient" (staff/routes/PatientReportedHealth.tsx): nothing is said while it loads, without
 * ehr.note.read, or when EHR refuses (403) or does not serve it (404); "None recorded" only after a read that answered.
 */
function PatientContext({ chart }: { chart: Chart }) {
  const { facilityId, patientId } = chart
  const reads = chart.can('ehr.note.read')
  const [reported, setReported] = useState<Reported>({ state: reads ? 'loading' : 'hidden' })

  useEffect(() => {
    if (!reads) return
    const controller = new AbortController()
    staffApi.reportedHealthProfile(facilityId, patientId, controller.signal).then(
      profile => controller.signal.aborted ? undefined : setReported(profile?.allergies ? { state: 'shown', allergies: profile.allergies } : { state: 'none' }),
      caught => {
        if (controller.signal.aborted) return
        const hidden = !isHidApiError(caught) || caught.status === 403 || caught.status === 404
        setReported({ state: hidden ? 'hidden' : 'failed' })
      },
    )
    return () => controller.abort()
  }, [facilityId, patientId, reads])

  return (
    // A section shows only when it has something to say (rule B): nothing while it loads or when it isn't served.
    reported.state === 'loading' || reported.state === 'hidden' ? null : (
    <section className="hid-ehr-clinical-context-block" aria-labelledby="consult-patient-context">
      <h2 id="consult-patient-context">Allergies</h2>
      <p>
        {reported.state === 'shown'
          ? `${reported.allergies} (told us by the patient, not checked by a clinician).`
          : reported.state === 'failed'
            ? 'What the patient told us couldn’t be loaded. Confirm with the patient.'
            : 'None recorded. Confirm with the patient.'}
      </p>
    </section>
    )
  )
}
