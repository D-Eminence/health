import { EhrCard } from '@hid/ui/ehr'
import { useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { staffApi, type Encounter, type VitalMeasurements } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import { ChartGate, useChart, type Chart } from '../parts/chart'
import { formatWhen, statusWords } from '../parts/format'
import { KeyValueList } from '../parts/KeyValueList'
import { ErrorBox, Loading, RecordHeading } from '../parts/Notices'
import type { SubmitOutcome } from '../parts/RecordForm'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { TRIAGE_LEVELS, triageText } from '../../departments/parts/triageLevels'
import { canRead as canReadEdBoard, useEdBoardServed } from '../../departments/emergency/edRules'
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
              <TriageLevelNote />
            </VitalsForm>
          )
        ) : null}
      </EhrCard>
    </>
  )
}

/**
 * The triage level, in place of the design's sample priority (Routine, Urgent, Emergency), which is gone: the live
 * five-level scale (hid-system 0135, the same words as the waiting list and the emergency department board) is set on the
 * patient's place on the Waiting list, or on the Emergency department board, not with the vitals. Nothing here is sent.
 *
 * The board is named only to a member it is open to (its code, 0169, and 0135's encounter pair) once it has answered in
 * this page's life (useEdBoardServed): before 0169 no one holds its code, and production keeps it switched off
 * (ED_BOARD_ENABLED) until go-live, so until it answers the note points to the Waiting list alone. A patient on the
 * board shows there too, with a link to their record on the board.
 */
function TriageLevelNote() {
  const { permissions } = useClinical()
  const board = useEdBoardServed() === true && canReadEdBoard(permissions)
  const levels = `${triageText(TRIAGE_LEVELS[0])} to ${triageText(TRIAGE_LEVELS[4])}`
  const waitingList = <Link className="hid-ehr-clinical-link" to="/provider/waiting-list">Waiting list</Link>
  return (
    <div className="hid-ehr-clinical-triage-sample" role="group" aria-label="Triage level">
      {board ? (
        <p>
          Set the triage level ({levels}) on the patient’s place
          on the <Link className="hid-ehr-clinical-link" to="/provider/emergency-department">Emergency department</Link> board
          or the {waitingList}.
        </p>
      ) : <p>Set the triage level ({levels}) on the patient’s place on the {waitingList}.</p>}
    </div>
  )
}

/**
 * The design's "Patient context": the patient, their allergies and their earlier triage. The allergies are the chart's
 * (useAllergies, read for direct care with ehr.note.read): those clinicians recorded, most serious first, and what the
 * patient entered in their Health ID portal, each labelled; on a backend before 0117, the patient's text alone. A read
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
