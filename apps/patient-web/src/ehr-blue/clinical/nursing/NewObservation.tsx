import { EhrCard } from '@hid/ui/ehr'
import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { staffApi } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { ErrorBox, Loading, RecordHeading } from '../parts/Notices'
import { RecordForm, type FieldDef, type FormValues, type SubmitOutcome } from '../parts/RecordForm'
import { useWorkspaceHref } from '../parts/Workspace'
import {
  NO_CREATE, NO_ENCOUNTERS, NO_RECORD_ACCESS, NO_WRITE, RECORD_NOT_SAVED, recordKey, refusedFieldErrors, text, usePatientRecords, visitLabel,
} from '../triage/records'
import { CATEGORIES, DETAILS_LIMIT, NEW_TITLE, NOTE_TYPE, UNITS_LIMIT, composeObservation } from './observations'

/** "New nursing observations": the design's create page for the open patient, or the chart's own state. */
export function NewObservation() {
  const href = useWorkspaceHref()
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <NewObservationForm chart={open} />}</ChartGate>
  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      <ChartGate>{open => <NewObservationForm chart={open} />}</ChartGate>
    </>
  )
}

/** Which form field each refused DTO field was entered in. */
const REFUSED: Readonly<Record<string, string>> = { title: 'category', noteType: 'category', content: 'note', encounterId: 'visit' }

function NewObservationForm({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const reads = chart.can('ehr.note.read')
  const writes = chart.can('ehr.note.write')
  const canCreate = reads && chart.canWrite && writes
  const list = usePatientRecords(chart, null)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const visits = list.encounters ?? []

  const fields: FieldDef[] = [
    { key: 'visit', label: 'Visit', required: true, choices: visits.map(encounter => ({ value: encounter.id, label: visitLabel(encounter) })) },
    { key: 'category', label: 'Category', required: true, options: CATEGORIES },
    { key: 'note', label: 'What you observed or gave', type: 'textarea', required: true, maxLength: DETAILS_LIMIT },
    { key: 'units', label: 'Dose and unit, if you gave something', maxLength: UNITS_LIMIT },
  ]

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    if (!chart.canWrite) return { formError: NO_WRITE }
    const encounterId = text(values.visit)
    const body = { noteType: NOTE_TYPE, title: text(values.category), status: 'draft', content: composeObservation(text(values.note), text(values.units)) }
    // A retry of the same observation for the same visit reuses its key, so EHR cannot save it twice.
    const signature = JSON.stringify(['clinical-notes', encounterId, body])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    let savedId: string
    try {
      await chart.verify()
      const saved = await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'clinical-notes', body, attempt.current.key)
      savedId = saved.id
    } catch (caught) {
      return { formError: refusalText(caught, RECORD_NOT_SAVED), fieldErrors: refusedFieldErrors(caught, name => REFUSED[name]) }
    }
    attempt.current = null
    navigate(href(recordKey(encounterId, savedId)), { state: { saved: true } })
  }

  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      {!reads ? <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox> : chart.canWrite && !writes ? <ErrorBox>{NO_CREATE}</ErrorBox> : null}
      <EhrCard>
        {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
        {canCreate ? (
          list.encounters === null ? (list.loading ? <Loading label="Loading consultations…" /> : null) : (
            <>
              {visits.length === 0 ? (
                <p className="hid-ehr-clinical-note">
                  {NO_ENCOUNTERS}
                  {chart.can('ehr.encounter.write') ? <> <Link className="hid-ehr-clinical-link" to={href.to('consult', 'new')}>New consultation</Link></> : null}
                </p>
              ) : null}
              <RecordForm key={visits.map(encounter => encounter.id).join()} fields={fields} submitLabel="Save record" onSubmit={submit} />
            </>
          )
        ) : null}
      </EhrCard>
    </>
  )
}
