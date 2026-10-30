import { EhrCard, EhrField, EhrSelect } from '@hid/ui/ehr'
import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { staffApi } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { Banner, ErrorBox, Loading, RecordHeading } from '../parts/Notices'
import { patientLine } from '../parts/PatientHeader'
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
  if (chart && chart.purpose === 'direct-care') return <NewObservationForm chart={chart} />
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
    { key: 'category', label: 'Observation category', required: true, options: CATEGORIES },
    { key: 'note', label: 'Observation / administration details', type: 'textarea', required: true, maxLength: DETAILS_LIMIT },
    { key: 'units', label: 'Units / dose if applicable', maxLength: UNITS_LIMIT },
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
      {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : null}
      {!reads ? <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox> : chart.canWrite && !writes ? <ErrorBox>{NO_CREATE}</ErrorBox> : null}
      <EhrCard>
        <EhrField label={<>Patient<span aria-hidden="true"> *</span></>}>
          <EhrSelect value="open" required onChange={() => undefined}>
            <option value="open">{patientLine(chart.facts)}</option>
          </EhrSelect>
        </EhrField>
        {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
        {canCreate ? (
          list.encounters === null ? (list.loading ? <Loading label="Loading encounters…" /> : null) : (
            <>
              {visits.length === 0 ? (
                <p className="hid-ehr-clinical-note">
                  {NO_ENCOUNTERS}
                  {chart.can('ehr.encounter.write') ? <> <Link className="hid-ehr-clinical-link" to={href.to('consult', 'new')}>Create consultation</Link></> : null}
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
