import { COMPLAINTS } from '../parts/vocabulary'
import { isHidApiError, plainErrorText } from '@hid/http'
import { EhrCard } from '@hid/ui/ehr'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type ConsultationInput, type ConsultationSaved, type Encounter } from '../../../staff/api'
import { FIELDS_REFUSED, refusalText, refusedFields } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { RecordHeading } from '../parts/Notices'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import { AllergyLines, useAllergies } from '../patients/AllergiesCard'
import {
  ENCOUNTER_CREATED, ENCOUNTER_TYPES, NEW_DIAGNOSIS_FIELDS, NEW_DIAGNOSIS_INITIAL, NEW_DIAGNOSIS_REFUSED, NEW_TITLE, NOTES_ARE_DRAFTS,
  composeNote, encounterTypeLabel, isoNow, newDiagnosisBody, newDiagnosisCheck, refusedFieldErrors, text,
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
/** Said after a partial save, once the draft note is in: its fields are gone, and it is changed from the encounter's page. */
const NOTE_SAVED = 'The draft note is saved; change it from the consultation’s page.'
/** Today's line over the form (staff/routes/Clinical.tsx:455), in plain words: what starting a consultation needs. */
const START_REQUIRES = 'To start a consultation, you need current access to this patient and must give the reason for the visit.'

const ENCOUNTER_FIELDS: readonly FieldDef[] = [
  { key: 'encounterType', label: 'Type of visit', required: true, choices: ENCOUNTER_TYPES },
  // Today's textarea (staff/routes/Clinical.tsx:455): a complaint keeps its line breaks.
  { key: 'complaint', label: 'Presenting complaint', type: 'textarea', required: true, maxLength: 4000, suggestions: COMPLAINTS },
]
// The note's fields are optional, as today: type and complaint alone start the encounter, and the draft note is written
// only when History, Examination, Clinical note or Follow-up has text.
const NOTE_FIELDS: readonly FieldDef[] = [
  { key: 'history', label: 'History', type: 'textarea', maxLength: NOTE_LIMIT },
  { key: 'examination', label: 'Examination', type: 'textarea', maxLength: NOTE_LIMIT },
]
const NOTE_TAIL_FIELDS: readonly FieldDef[] = [
  { key: 'note', label: 'Clinical note', type: 'textarea', maxLength: NOTE_LIMIT },
  { key: 'followup', label: 'Follow-up', maxLength: 4000 },
]
const INITIAL: FormValues = { encounterType: 'ambulatory', ...NEW_DIAGNOSIS_INITIAL }

/**
 * EHR-C5 (EHR_LIVE_CONTRACT.md "EHR-C5: one-call consultation"): the one call is all or nothing, so on any refusal
 * nothing was saved. Its refusals in plain words; a 403 or 409 not named here keeps the shared words.
 */
const ONE_CALL_REFUSED: Readonly<Record<string, string>> = {
  CONSENT_REQUIRED: 'Nothing was saved. The patient has not approved changes to their record by this facility. Ask them to approve a read-and-write request first.',
  PERMISSION_DENIED: 'Nothing was saved. You don’t have access to save all of this. Ask your facility administrator if you need it.',
  // The same key with another body: an earlier press was saved although no answer came back, and the details changed since.
  IDEMPOTENCY_KEY_REUSED: 'This consultation was already saved with the details as they were before your last change. Open the patient’s consultations to check it before you save again.',
  VISIT_ENTERED_IN_ERROR: 'Nothing was saved. The patient’s visit today is marked as entered in error. Open the patient’s consultations to check it, then try again.',
  // EHR-C1's day check, by the server's clock: the device's date or time is off.
  REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY: 'Nothing was saved. The date or time on this device looks wrong. Check it, then save again.',
  // A refusal by the database names no part (contract "All or nothing").
  INVALID_CLINICAL_DATA: 'Nothing was saved. Some details weren’t accepted. Check the details you entered and try again.',
}
const ONE_CALL_CONFLICT = 'Nothing was saved. This patient’s record changed meanwhile. Open the patient’s consultations to check it, then try again.'
const NOT_STARTED = 'The consultation could not be started.'

/**
 * A validation refusal inside a part names only that part's top-level field (contract "All or nothing"; hid-system
 * validation-pipe.ts gives it no messages of its own), so it is shown at the form's field for that part.
 */
const PART_FIELDS: Readonly<Record<string, readonly [field: string, message: string]>> = {
  visit: ['complaint', 'Check the type of visit and the presenting complaint.'],
  note: ['note', 'Check History, Examination, Clinical note and Follow-up.'],
  diagnoses: ['diagnosis', 'Check the diagnosis, its code system and its code.'],
}

/** After a 201 on the open visit today, which keeps its own complaint (EHR-C1): said on the consultation's page. */
const SAVED_ON_OPEN_VISIT = 'Saved on the patient’s open visit today.'

/** One save in progress: each step keeps its idempotency key while its input is unchanged, and is not sent twice. */
interface Attempt {
  /**
   * EHR-C5: this consultation's one key and start time. Kept until the server gives a final answer, so pressing again
   * after no answer sends the same key (and, with the fields unchanged, the same body), which answers the saved
   * consultation instead of saving a second one. Replaced after a final answer.
   */
  consultation?: { key: string; startedAt: string }
  /** The one-call route answered 404 (a backend before EHR-C5): this form saves with today's separate calls. */
  separate?: boolean
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
  // Today adds a diagnosis only on its Diagnoses tab, which needs the read as well as the write (Clinical.tsx:28, 1853).
  const writesDiagnosis = chart.can('ehr.diagnosis.read', 'ehr.diagnosis.write')
  const canStart = chart.canWrite && chart.can('ehr.encounter.write')

  const fields = useMemo(() => [
    ...(started ? [] : ENCOUNTER_FIELDS),
    ...(writesNote && !noteSaved ? NOTE_FIELDS : []),
    ...(writesDiagnosis ? NEW_DIAGNOSIS_FIELDS : []),
    ...(writesNote && !noteSaved ? NOTE_TAIL_FIELDS : []),
  ], [noteSaved, started, writesDiagnosis, writesNote])

  const validate = (values: FormValues): FieldErrors => {
    const errors: Record<string, string> = writesDiagnosis ? { ...newDiagnosisCheck(values) } : {}
    if (writesNote && !noteSaved && noteContent(values).length > NOTE_LIMIT) errors.note = NOTE_TOO_LONG
    return errors
  }

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    if (!attempt.current.separate) {
      const outcome = await saveInOneCall(values)
      if (outcome !== NOT_SERVED) return outcome
      attempt.current = { separate: true }
      return saveSeparately(values, true)
    }
    return saveSeparately(values, false)
  }

  /** EHR-C5: the visit, its draft note and its diagnosis in one call, each part sent only when today's flow writes it. */
  const saveInOneCall = async (values: FormValues): Promise<SubmitOutcome | typeof NOT_SERVED> => {
    const current = attempt.current
    current.consultation ??= { key: crypto.randomUUID(), startedAt: isoNow() }
    const chiefComplaint = text(values.complaint)
    const content = noteContent(values)
    const diagnosis = newDiagnosisBody(values)
    const input: ConsultationInput = {
      visit: { encounterType: text(values.encounterType), status: 'in_progress', startedAt: current.consultation.startedAt, chiefComplaint },
      ...(writesNote && content ? { note: { noteType: 'Consultation', title: 'Consultation note', status: 'draft', content } } : {}),
      ...(writesDiagnosis && diagnosis ? { diagnoses: [diagnosis] } : {}),
    }
    let saved: ConsultationSaved
    try {
      await chart.verify()
    } catch (caught) {
      return { formError: refusalText(caught, NOT_STARTED) }
    }
    try {
      saved = await staffApi.createConsultation(chart.facilityId, chart.patientId, input, current.consultation.key)
    } catch (caught) {
      if (routeNotServed(caught)) return NOT_SERVED
      if (finalAnswer(caught)) current.consultation = undefined
      return { formError: oneCallRefusal(caught), fieldErrors: partErrors(caught) }
    }
    attempt.current = {}
    const notice = openVisitNotice(saved, chiefComplaint)
    navigate(href(saved.encounter.id), { state: { created: true, ...(notice ? { notice } : {}) } })
  }

  /** Today's separate calls, on a backend before EHR-C5. `verified`: the access re-check was just made for this press. */
  const saveSeparately = async (values: FormValues, verified: boolean): Promise<SubmitOutcome> => {
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
        if (!verified) await chart.verify()
        const created = await staffApi.createEncounter(chart.facilityId, chart.patientId, current.encounterStep.input, current.encounterStep.key)
        current.encounter = created
        setStarted(created)
      }
      const encounterId = current.encounter.id
      // A saved step is never sent again, whatever its fields now hold: a second create would be a second record. With
      // nothing typed in the note's fields there is no note to write.
      const content = noteContent(values)
      if (writesNote && !current.note?.done && content) {
        map = { content: 'note' }
        const body = { noteType: 'Consultation', title: 'Consultation note', status: 'draft', content }
        current.note = step(current.note, JSON.stringify(body))
        await chart.verify()
        await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'clinical-notes', body, current.note.key)
        current.note.done = true
        setNoteSaved(true)
      }
      const diagnosis = newDiagnosisBody(values)
      if (writesDiagnosis && diagnosis && !current.diagnosis?.done) {
        map = { ...NEW_DIAGNOSIS_REFUSED }
        current.diagnosis = step(current.diagnosis, JSON.stringify(diagnosis))
        await chart.verify()
        await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'diagnoses', diagnosis, current.diagnosis.key)
        current.diagnosis.done = true
      }
      attempt.current = { separate: true }
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
          <>
            <p className="hid-ehr-clinical-note">{START_REQUIRES}</p>
            <RecordForm fields={fields} initial={INITIAL} submitLabel={started ? 'Save the rest' : 'Start consultation'} validate={validate} onSubmit={submit}>
              {started ? (
                <p className="hid-ehr-clinical-note" role="status">
                  {`${ENCOUNTER_CREATED} ${encounterTypeLabel(started.encounterType)} · ${started.chiefComplaint ?? ''}.${noteSaved ? ` ${NOTE_SAVED}` : ''} Save again to add the rest to it.`}
                </p>
              ) : null}
              {writesNote ? <p className="hid-ehr-clinical-note">{NOTES_ARE_DRAFTS}</p> : null}
            </RecordForm>
          </>
        ) : null}
      </EhrCard>
    </>
  )
}

const NOT_SERVED = Symbol('not served')

/** A backend before EHR-C5 has no such route: its 404 names no code of its own (the gateway's, or Nest's). */
function routeNotServed(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 404 && (caught.code === 'NOT_FOUND' || caught.code === 'API_ROUTE_NOT_FOUND')
}

/**
 * Whether the server answered with a refusal, after which nothing was saved under the key (all or nothing), so the next
 * press is a new save with a new key. No answer, a timeout, too many tries or a server failure may have saved it: the key
 * is kept.
 */
function finalAnswer(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status >= 400 && caught.status < 500 && caught.status !== 408 && caught.status !== 429
}

function oneCallRefusal(caught: unknown): string {
  if (refusedFields(caught).length > 0) return FIELDS_REFUSED
  return plainErrorText(caught, NOT_STARTED, { audience: 'facility', codes: ONE_CALL_REFUSED, statuses: { 409: ONE_CALL_CONFLICT } })
}

function partErrors(caught: unknown): FieldErrors {
  const errors: Record<string, string> = {}
  for (const { field } of refusedFields(caught)) {
    const part = PART_FIELDS[field]
    if (part) errors[part[0]] = part[1]
  }
  return errors
}

/**
 * EHR-C1: on the open visit today the visit keeps the values it already has, so a complaint typed here that differs
 * is not on it (the contract's screen change). The consultation's page says so, with the complaint, so it is not lost.
 */
function openVisitNotice(saved: ConsultationSaved, typed: string): string | null {
  if (!saved.encounter.reusedOpenVisit) return null
  if ((saved.encounter.chiefComplaint ?? '').trim() === typed) return SAVED_ON_OPEN_VISIT
  return `${SAVED_ON_OPEN_VISIT} That visit keeps its own presenting complaint, so the one typed here is not on it: ${typed}. Add it to the note if it is needed.`
}

function noteContent(values: FormValues): string {
  return composeNote([
    ['History', text(values.history)],
    ['Examination', text(values.examination)],
    ['Clinical note', text(values.note)],
    ['Follow-up', text(values.followup)],
  ])
}

/**
 * The design's "Patient context": the patient and their allergies, the chart's (useAllergies, read for direct care with
 * ehr.note.read): those clinicians recorded, most serious first, and what the patient entered in their Health ID portal,
 * each labelled; on a backend before 0117, the patient's text alone. Nothing while it loads; then always a line, so a
 * read that failed, was refused or is not served is never silence a reader could take for "no allergies". "None" is
 * said only after a read that found none.
 */
function PatientContext({ chart }: { chart: Chart }) {
  const { state: allergies } = useAllergies(chart)
  if (allergies.status === 'loading') return null
  return (
    <section className="hid-ehr-clinical-context-block" aria-labelledby="consult-patient-context">
      <h2 id="consult-patient-context">Allergies</h2>
      <AllergyLines allergies={allergies} />
    </section>
  )
}
