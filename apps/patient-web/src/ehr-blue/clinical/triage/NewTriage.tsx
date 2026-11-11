import { EhrCard, EhrField, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { staffApi, type Encounter, type VitalMeasurements } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { isDemoFacility } from '../../blueFacilities'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { formatWhen, statusWords } from '../parts/format'
import { KeyValueList } from '../parts/KeyValueList'
import { ErrorBox, Loading, RecordHeading } from '../parts/Notices'
import type { SubmitOutcome } from '../parts/RecordForm'
import { SampleBanner } from '../parts/SampleBanner'
import { useWorkspaceHref } from '../parts/Workspace'
import { AllergyLines, useAllergies } from '../patients/AllergiesCard'
import { VisitPages } from './ListCard'
import {
  NO_COMPLAINT, NO_CREATE, NO_ENCOUNTERS, NO_RECORD_ACCESS, NO_WRITE, RECORD_NOT_SAVED, isoNow, onAnotherPage, recordKey, recordedAt,
  refusedFieldErrors, usePatientRecords, type VisitRecord,
} from './records'
import { CORRECTION_UNREAD, LOADING_CORRECTION, NEW_TITLE, VITAL_FIELDS, currentValues, measurementItems, orderedMeasurements, useCorrections, vitalStatus } from './vitals'
import { VitalsForm, type VitalsInput } from './VitalsForm'

/** "New triage & vitals": the design's create page for the open patient, or the chart's own state. */
export function NewTriage() {
  const href = useWorkspaceHref()
  const chart = useChart()
  if (chart && chart.purpose === 'direct-care') return <ChartGate>{open => <NewTriageForm chart={open} />}</ChartGate>
  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      <ChartGate>{open => <NewTriageForm chart={open} />}</ChartGate>
    </>
  )
}

const MEASUREMENT_NAMES = new Set<string>(VITAL_FIELDS.map(field => field.name))
const PRIORITIES = ['Routine', 'Urgent', 'Emergency'] as const

function NewTriageForm({ chart }: { chart: Chart }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const location = useLocation()
  const reads = chart.can('ehr.vital.read')
  const writes = chart.can('ehr.vital.write')
  const canCreate = reads && chart.canWrite && writes
  const list = usePatientRecords(chart, reads ? 'vitals' : null)
  const attempt = useRef<{ signature: string; body: object; key: string } | null>(null)

  const submit = async ({ encounterId, values }: VitalsInput): Promise<SubmitOutcome> => {
    if (!chart.canWrite) return { formError: NO_WRITE }
    const measurements: VitalMeasurements = orderedMeasurements(values)
    // A retry of the same vitals for the same visit reuses its body and key, so EHR cannot save them twice.
    const signature = JSON.stringify(['vitals', encounterId, measurements])
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, body: { recordedAt: isoNow(), source: 'manual', ...measurements }, key: crypto.randomUUID() }
    }
    let savedId: string
    try {
      await chart.verify()
      const saved = await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'vitals', attempt.current.body, attempt.current.key)
      savedId = saved.id
    } catch (caught) {
      return {
        formError: refusalText(caught, RECORD_NOT_SAVED),
        fieldErrors: refusedFieldErrors(caught, name => MEASUREMENT_NAMES.has(name) ? name : name === 'encounterId' ? 'visit' : undefined),
      }
    }
    attempt.current = null
    navigate(href(recordKey(encounterId, savedId)), { state: { saved: true } })
  }

  const visits = list.encounters ?? []
  // Opened from a consultation's Vitals card: that visit is chosen, only when it is one of this patient's visits read.
  const asked = (location.state as { visitId?: unknown } | null)?.visitId
  const preset = typeof asked === 'string' ? visits.find(encounter => encounter.id === asked) ?? null : null
  const visitHint = (chosen: Encounter | null) => {
    if (!chosen) {
      if (list.encounters === null || visits.length > 0) return undefined
      return (
        <>
          {NO_ENCOUNTERS}
          {chart.can('ehr.encounter.write') ? <> <Link className="hid-ehr-clinical-link" to={href.to('consult', 'new')}>New consultation</Link></> : null}
        </>
      )
    }
    const complaint = `Presenting complaint: ${chosen.chiefComplaint || NO_COMPLAINT}`
    if (visits.some(encounter => encounter.id === chosen.id)) return complaint
    // Today's sentence is a line of its own (Clinical.tsx:1795), not run on after the complaint.
    return <><span className="block">{complaint}</span> <span className="block">{onAnotherPage(chosen)}</span></>
  }

  return (
    <>
      <RecordHeading title={NEW_TITLE} backHref={href()} />
      {!reads ? <ErrorBox>{NO_RECORD_ACCESS}</ErrorBox> : chart.canWrite && !writes ? <ErrorBox>{NO_CREATE}</ErrorBox> : null}
      <EhrCard>
        <PatientContext chart={chart} prior={reads ? list.records : []} />
        {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
        {/* Today's "Encounter pages" (Clinical.tsx:1794): vitals may be added to any of the patient's encounters here,
            not only the newest 50. The page shown also gives the earlier vitals above. */}
        {reads ? <VisitPages list={list} label="Encounter pages" /> : null}
        {canCreate ? (
          list.encounters === null ? (list.loading ? <Loading label="Loading encounters…" /> : null) : (
            <VitalsForm mode="record" visits={visits} initialVisit={preset} visitHint={visitHint} groupLabel="Vital measurements" submitLabel="Save record" onSubmit={submit}>
              {/* Sample fields inside a live form: only at the demo facilities, where nothing real is recorded. */}
              {isDemoFacility(chart.facilityId) ? <SampleTriage /> : null}
            </VitalsForm>
          )
        ) : null}
      </EhrCard>
    </>
  )
}

/**
 * The design's priority and observations, which today's vitals have no field for: a clearly marked sample, held in
 * this page only and never sent. Shown only at the four demo facilities, so at a real facility no one can type in a
 * field that is not saved.
 */
function SampleTriage() {
  const [priority, setPriority] = useState<string>('Routine')
  const [observations, setObservations] = useState('')
  return (
    <div className="hid-ehr-clinical-triage-sample" role="group" aria-label="Priority and observations (sample)">
      <SampleBanner />
      <div className="hid-ehr-clinical-form-grid">
        <EhrField label="Priority">
          <EhrSelect value={priority} onChange={event => setPriority(event.target.value)}>
            {PRIORITIES.map(option => <option key={option} value={option}>{option}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField className="hid-ehr-clinical-form-full" label="Observations">
          <EhrTextarea rows={3} maxLength={4000} value={observations} onChange={event => setObservations(event.target.value)} />
        </EhrField>
      </div>
    </div>
  )
}

/**
 * The design's "Patient context": the patient, their allergies and their earlier triage. The allergies are the chart's
 * (useAllergies, read for direct care with ehr.note.read): those clinicians recorded, most serious first, and what the
 * patient entered in their Health ID portal, each labelled; on a backend before 0124, the patient's text alone. A read
 * that failed, was refused or is not served says so: "none" is said only after a read that found none.
 */
function PatientContext({ chart, prior }: { chart: Chart; prior: readonly VisitRecord[] | null }) {
  const { state: allergies } = useAllergies(chart)
  const corrections = useCorrections(chart, prior?.map(item => ({ encounterId: item.encounter.id, vital: item.record })) ?? null)

  return (
    <section className="hid-ehr-clinical-context-block" aria-labelledby="triage-patient-context">
      <h2 id="triage-patient-context">Allergies and earlier vitals</h2>
      <AllergyLines allergies={allergies} />
      {(prior ?? []).map(({ encounter, record }) => {
        const read = corrections(record)
        const values = currentValues(record, read)
        const items = values ? measurementItems(values) : read.state === 'failed'
          ? [{ label: 'Correction', value: `${CORRECTION_UNREAD} ${read.message}` }, ...measurementItems(record)]
          : [{ label: 'Correction', value: LOADING_CORRECTION }]
        return (
          <details key={`${encounter.id}-${record.id}`} className="hid-ehr-clinical-version">
            <summary>{`Vitals · ${statusWords(vitalStatus(record))} · ${formatWhen(recordedAt(record))}`}</summary>
            <KeyValueList items={items} />
          </details>
        )
      })}
    </section>
  )
}
