import { useCallback, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrDataTable, EhrEmptyState, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { nursingApi, type ObservationReading, type ObservationValues, type VitalMeasurement, type WardPatientCard } from '../../../staff/api'
import { BOTH_BP, VITAL_FIELDS } from '../../clinical/triage/vitals'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptSection } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys, useStaffNames } from './hooks'
import {
  AVPU_WORDS, FLAG_PART_WORDS, FLAG_WORDS, OXYGEN_DEVICE_WORDS, OXYGEN_RULE, balanceText, canWriteVitals, isChartAccessRefusal,
  lagosInput, lagosInputToIso, lagosWhen, learning, memberText, notServed, observationLines, refusalWords,
} from './nursingRules'
import { ChartAccessNotice, KEPT } from './parts'

/**
 * The observation chart (NUR-1 routes 1 and 2; Q195 A, Q199 A, Q202 A): the stay's readings over the last 24 hours with
 * VIT-1's soft flags, each beside its own value (never a total, a colour from several values, or a score: the answer's
 * `score` is always null and is never shown), and on an ICU ward (or with "Hourly grid") the hourly grid with fluid in,
 * out and the running balance. MAP and the GCS total are plain arithmetic of the values entered. New readings go on the
 * stay's visit through today's vitals route, with the chart's new fields.
 */
export function ObservationChart({ facilityId, admission }: { readonly facilityId: string; readonly admission: WardPatientCard | null }) {
  const { permissions, membershipId } = useDeptAccess()
  const [hourly, setHourly] = useState(false)
  const [adding, setAdding] = useState(false)
  const [saved, setSaved] = useState('')
  const focus = useFocusById()
  const admissionId = admission?.admissionId ?? ''
  const loader = useCallback((id: string) => learning(nursingApi.observationChart(id, admissionId, hourly)), [admissionId, hourly])
  const chart = useFacilityRead(facilityId, Boolean(admissionId), loader, 'The observation chart could not be loaded.')
  const readings = chart.value?.readings ?? []
  const names = useStaffNames(facilityId, readings.map(reading => reading.recordedByMembershipId))
  const canRecord = canWriteVitals(permissions) && admission !== null && admission.encounterId !== null
    && (admission.status === 'admitted' || admission.status === 'discharge_ready')

  if (chart.caught && isChartAccessRefusal(chart.caught)) return <ChartAccessNotice />
  return (
    <>
      {chart.caught ? <DeptNotice role="alert" tone={notServed(chart.caught) ? 'info' : 'critical'}>{refusalWords(chart.caught, 'The observation chart could not be loaded.')}</DeptNotice> : null}
      {saved ? <p className="hid-ehr-state-message" role="status">{saved}</p> : null}
      {adding && admission ? (
        <ObservationForm facilityId={facilityId} admission={admission}
          onDone={message => {
            setAdding(false)
            // Back to the button that opened the form (shown again as it closes).
            focus([RECORD_ID, 'obs-chart'])
            if (message) { setSaved(message); void chart.refresh() }
          }} />
      ) : null}
      <DeptSection title="Observation chart" headingId="obs-chart"
        actions={canRecord && !adding
          ? <EhrButton id={RECORD_ID} size="sm" onClick={() => { setSaved(''); setAdding(true); focus(FORM_ID) }}>Record observations</EhrButton> : undefined}>
        {chart.value && chart.value.wardType !== 'icu' ? (
          <label className="hid-ehr-dept-waiting-toggle">
            <input type="checkbox" checked={hourly} onChange={event => setHourly(event.target.checked)} />
            <span>Hourly grid</span>
          </label>
        ) : null}
        {chart.value === null && chart.loading ? <p className="hid-ehr-state-message" role="status">Loading the observation chart…</p> : null}
        {chart.value ? <p className="hid-ehr-state-message">{`${lagosWhen(chart.value.from)} to ${lagosWhen(chart.value.to)}. No early-warning score is worked out: read each value and its flag.`}</p> : null}
        {chart.value && readings.length === 0 ? <EhrEmptyState title="No observations yet" message="Readings for this stay show here, the newest first." /> : null}
        {readings.length > 0 ? (
          <ul className="hid-ehr-dept-waiting-list" aria-label="Readings">
            {[...readings].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).map(reading => (
              <ReadingRow key={reading.vitalId} reading={reading} by={memberText(reading.recordedByMembershipId, membershipId, names, 'Not recorded')} />
            ))}
          </ul>
        ) : null}
      </DeptSection>
      {chart.value?.hours && chart.value.hours.length > 0 ? (
        <DeptSection title="Hourly grid" headingId="obs-hours">
          {/* The blue table: its cells styled, and read as cards on a phone (no sideways scrolling). */}
          <EhrDataTable caption="Hourly grid" captionHidden rows={chart.value.hours} rowKey={hour => hour.hourStart} columns={[
            // The grid runs 24 hours back: an hour not on today's Lagos day carries its date.
            { id: 'hour', header: 'Hour', cell: hour => lagosWhen(hour.hourStart) },
            { id: 'readings', header: 'Readings', cell: hour => {
              const inHour = readings.filter(reading => hour.readingIds.includes(reading.vitalId))
              return inHour.length === 0 ? '—' : inHour.flatMap(reading => observationLines(reading.values).map(line => `${line.label} ${line.text}`)).join('; ')
            } },
            { id: 'in', header: 'In', align: 'end', cell: hour => `${hour.fluidInMl} mL` },
            { id: 'out', header: 'Out', align: 'end', cell: hour => `${hour.fluidOutMl} mL` },
            { id: 'balance', header: 'Running balance', align: 'end', cell: hour => balanceText(hour.runningBalanceMl) },
          ]} />
        </DeptSection>
      ) : null}
    </>
  )
}

const RECORD_ID = 'obs-record'
const FORM_ID = 'obs-form'

function ReadingRow({ reading, by }: { readonly reading: ObservationReading; readonly by: string }) {
  const inError = reading.status === 'entered_in_error'
  const lines = observationLines(reading.values)
  const headingId = `reading-${reading.vitalId}`
  return (
    <li className={['hid-ehr-dept-waiting-card', inError ? 'hid-ehr-dept-nursing-struck' : ''].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className="hid-ehr-dept-waiting-main">
        <h3 id={headingId} className="hid-ehr-dept-waiting-name">{lagosWhen(reading.recordedAt)}</h3>
        {inError || reading.corrected ? (
          <div className="hid-ehr-dept-waiting-badges">
            {inError ? <EhrBadge tone="critical">Entered in error</EhrBadge> : null}
            {reading.corrected ? <EhrBadge tone="neutral">Corrected</EhrBadge> : null}
          </div>
        ) : null}
        <dl className="hid-ehr-dept-waiting-facts">
          {lines.map(line => {
            // A reading entered in error is shown with its status and no flag. Each value's own flag is shown, and on a line
            // of several values (blood pressure) by its part, so which value is flagged is never left to guess.
            const flags = inError ? [] : line.measures.flatMap(measure => reading.flags.filter(candidate => candidate.measure === measure))
            const byPart = line.measures.length > 1
            return (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.text}{flags.map((flag, index) => (
                  <span key={`${flag.measure}-${index}`}> <EhrBadge tone={flag.level === 'far_outside_usual' ? 'critical' : 'caution'}>
                    {`${byPart && FLAG_PART_WORDS[flag.measure] ? `${FLAG_PART_WORDS[flag.measure]}: ` : ''}${FLAG_WORDS[flag.level] ?? 'Check this value'}`}
                  </EhrBadge></span>
                ))}</dd>
              </div>
            )
          })}
          <div className={KEPT}><dt>Recorded by</dt><dd>{by}</dd></div>
        </dl>
      </div>
    </li>
  )
}

interface Draft {
  time: string; systolic: string; diastolic: string; pulse: string; breathing: string; saturation: string; temperature: string
  pain: string; avpu: string; glucose: string; device: string; flow: string; fio2: string; eye: string; verbal: string; motor: string
  verbalNotTestable: boolean
}

const blank = (): Draft => ({ time: lagosInput(), systolic: '', diastolic: '', pulse: '', breathing: '', saturation: '', temperature: '',
  pain: '', avpu: '', glucose: '', device: '', flow: '', fio2: '', eye: '', verbal: '', motor: '', verbalNotTestable: false })

interface NumberField {
  readonly field: keyof Draft
  readonly key: keyof ObservationValues
  readonly label: string
  /** The measure in a sentence ("oxygen saturation"). */
  readonly name: string
  readonly min: number
  readonly max: number
  /** The decimal places the service takes (0: a whole number). */
  readonly places: number
}

/** A Triage & Vitals measure's limits and decimals (triage/vitals.ts VITAL_FIELDS, as EHR's VitalMeasurementsDto takes it). */
function triage(name: VitalMeasurement): Pick<NumberField, 'min' | 'max' | 'places'> {
  const field = VITAL_FIELDS.find(candidate => candidate.name === name)
  if (!field) throw new Error(`No vital field ${name}`)
  return { min: Number(field.min), max: Number(field.max), places: field.step.includes('.') ? field.step.split('.')[1]!.length : 0 }
}

/**
 * Each number the chart takes, with the backend's limits and decimals (VitalMeasurementsDto): those Triage & Vitals takes
 * too from its table, so a reading Triage would save is never refused here; pain and glucose from the DTO. A value outside
 * the usual range is saved with VIT-1's soft flag ("Check this entry"), never refused.
 */
const NUMBER_FIELDS: readonly NumberField[] = [
  { field: 'systolic', key: 'systolicMmhg', label: 'Systolic (mmHg)', name: 'systolic', ...triage('systolicMmhg') },
  { field: 'diastolic', key: 'diastolicMmhg', label: 'Diastolic (mmHg)', name: 'diastolic', ...triage('diastolicMmhg') },
  { field: 'pulse', key: 'pulseBpm', label: 'Pulse (a minute)', name: 'pulse', ...triage('pulseBpm') },
  { field: 'breathing', key: 'respiratoryRate', label: 'Breathing rate (a minute)', name: 'breathing rate', ...triage('respiratoryRate') },
  { field: 'saturation', key: 'oxygenSaturationPercent', label: 'Oxygen saturation (%)', name: 'oxygen saturation', ...triage('oxygenSaturationPercent') },
  { field: 'temperature', key: 'temperatureC', label: 'Temperature (°C)', name: 'temperature', ...triage('temperatureC') },
  { field: 'pain', key: 'painScore', label: 'Pain (0 to 10)', name: 'pain', min: 0, max: 10, places: 0 },
  { field: 'glucose', key: 'bloodGlucoseMmolL', label: 'Blood glucose (mmol/L)', name: 'blood glucose', min: 0.5, max: 50, places: 1 },
]

const PLACES_WORDS = ['as a whole number', 'to one decimal place', 'to two decimal places'] as const
const stepOf = (places: number) => places === 0 ? '1' : (1 / 10 ** places).toFixed(places)

/** Whether a number has no more than `places` decimal places. */
function hasPlaces(value: number, places: number): boolean {
  const scaled = value * 10 ** places
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

/**
 * What the form would send, or the problem to fix first, each naming its field: the DTO's limits and decimals, both
 * parts of a blood pressure or neither (BLOOD_PRESSURE_INCOMPLETE), and the oxygen and GCS rules (OXYGEN_FIELDS_INVALID,
 * GCS_INCOMPLETE).
 */
export function observationBody(draft: Draft): { values: ObservationValues; recordedAt: string } | { problem: string } {
  const recordedAt = lagosInputToIso(draft.time)
  if (!recordedAt) return { problem: 'Enter the time of the reading.' }
  const values: ObservationValues = {}
  for (const { field, key, name, min, max, places } of NUMBER_FIELDS) {
    const text = String(draft[field]).trim()
    if (!text) continue
    const value = Number(text)
    if (!Number.isFinite(value) || value < min || value > max) return { problem: `Check ${name}: ${min} to ${max}.` }
    if (!hasPlaces(value, places)) return { problem: `Enter ${name} ${PLACES_WORDS[places]}.` }
    values[key] = value
  }
  if ((values.systolicMmhg === undefined) !== (values.diastolicMmhg === undefined)) return { problem: BOTH_BP }
  if (draft.avpu) values.avpu = draft.avpu
  const flowText = draft.flow.trim()
  const fio2Text = draft.fio2.trim()
  if (!draft.device) {
    if (flowText || fio2Text) return { problem: OXYGEN_RULE }
  } else {
    // A device on its own is a reading: "Ventilated" records only that the patient is ventilated (Q202 A).
    values.oxygenDevice = draft.device
    if (flowText) {
      if (draft.device === 'room_air') return { problem: OXYGEN_RULE }
      const flow = Number(flowText)
      if (!Number.isFinite(flow) || flow < 0.5 || flow > 70) return { problem: 'Oxygen flow is 0.5 to 70 L a minute.' }
      if (!hasPlaces(flow, 1)) return { problem: 'Enter oxygen flow to one decimal place.' }
      values.oxygenFlowLPerMin = flow
    }
    if (fio2Text) {
      const fio2 = Number(fio2Text)
      if (draft.device === 'room_air' && fio2 !== 21) return { problem: OXYGEN_RULE }
      if (!Number.isFinite(fio2) || fio2 < 21 || fio2 > 100) return { problem: 'FiO2 is 21% to 100%.' }
      if (!Number.isInteger(fio2)) return { problem: 'Enter FiO2 as a whole number.' }
      values.fio2Percent = fio2
    }
  }
  const gcsParts = [draft.eye, draft.verbal, draft.motor].filter(part => part !== '').length + (draft.verbalNotTestable ? 1 : 0)
  if (gcsParts > 0) {
    if (!draft.eye || !draft.motor || (!draft.verbal && !draft.verbalNotTestable)) return { problem: 'Enter all three GCS parts, or mark the verbal part as not testable.' }
    values.gcsEye = Number(draft.eye)
    values.gcsMotor = Number(draft.motor)
    if (draft.verbalNotTestable) values.gcsVerbalNotTestable = true
    else values.gcsVerbal = Number(draft.verbal)
  }
  if (Object.keys(values).length === 0) return { problem: 'Enter at least one value.' }
  return { values, recordedAt }
}

function ObservationForm({ facilityId, admission, onDone }: {
  readonly facilityId: string
  readonly admission: WardPatientCard
  readonly onDone: (message: string | null) => void
}) {
  const [draft, setDraft] = useState<Draft>(blank)
  const [problem, setProblem] = useState('')
  const keyFor = useIdempotencyKeys()
  const set = (field: keyof Draft) => (event: { target: { value: string } }) => setDraft(previous => ({ ...previous, [field]: event.target.value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setProblem('')
    const body = observationBody(draft)
    if ('problem' in body) { setProblem(body.problem); return }
    try {
      const answer = await keyFor.send('observation', body,
        key => nursingApi.recordObservation(facilityId, admission.patientId, admission.encounterId!, body.values, body.recordedAt, key))
      const warnings = (answer as { warnings?: unknown[] } | null)?.warnings
      onDone(Array.isArray(warnings) && warnings.length > 0
        ? 'Observations saved. Some values are outside the usual range: check them on the chart.' : 'Observations saved.')
    } catch (caught) {
      setProblem(isHidApiError(caught) && caught.code === 'NURSING_FIELDS_NOT_AVAILABLE'
        ? 'These fields are not switched on yet. Record blood pressure, pulse, breathing, saturation and temperature on Triage & Vitals.'
        : refusalWords(caught, 'The observations could not be saved. Try again.'))
    }
  }

  return (
    <DeptSection title="Record observations" headingId={FORM_ID}>
      {/* The form's own checks name the field (observationBody), so the browser's are not used. */}
      <form className="hid-ehr-dept-nursing-form hid-ehr-dept-nursing-grid" noValidate onSubmit={event => void submit(event)} aria-label="Record observations">
        <EhrField label="Time (Lagos time)"><EhrInput type="datetime-local" value={draft.time} onChange={set('time')} /></EhrField>
        {NUMBER_FIELDS.map(({ field, label, min, max, places }) => (
          <EhrField key={field} label={label}>
            <EhrInput type="number" inputMode={places === 0 ? 'numeric' : 'decimal'} min={min} max={max} step={stepOf(places)}
              value={String(draft[field])} onChange={set(field)} />
          </EhrField>
        ))}
        <EhrField label="AVPU">
          <EhrSelect value={draft.avpu} onChange={set('avpu')}>
            <option value="">Not recorded</option>
            {Object.entries(AVPU_WORDS).map(([value, words]) => <option key={value} value={value}>{words}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Oxygen">
          <EhrSelect value={draft.device} onChange={set('device')}>
            <option value="">Not recorded</option>
            {Object.entries(OXYGEN_DEVICE_WORDS).map(([value, words]) => <option key={value} value={value}>{words}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Oxygen flow (L a minute)" hint="With a device other than room air, if known.">
          <EhrInput type="number" inputMode="decimal" min={0.5} max={70} step="0.1" value={draft.flow} onChange={set('flow')} />
        </EhrField>
        <EhrField label="FiO2 (%)" hint="With a device, if known. On room air, 21% only.">
          <EhrInput type="number" inputMode="numeric" min={21} max={100} step="1" value={draft.fio2} onChange={set('fio2')} />
        </EhrField>
        <EhrField label="GCS eye (1 to 4)">
          <EhrSelect value={draft.eye} onChange={set('eye')}>
            <option value="">Not recorded</option>
            {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="GCS verbal (1 to 5)">
          <EhrSelect value={draft.verbal} disabled={draft.verbalNotTestable} onChange={set('verbal')}>
            <option value="">Not recorded</option>
            {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
          </EhrSelect>
        </EhrField>
        <label className="hid-ehr-dept-waiting-toggle">
          <input type="checkbox" checked={draft.verbalNotTestable}
            onChange={event => setDraft(previous => ({ ...previous, verbalNotTestable: event.target.checked, verbal: '' }))} />
          <span>Verbal not testable (VT)</span>
        </label>
        <EhrField label="GCS motor (1 to 6)">
          <EhrSelect value={draft.motor} onChange={set('motor')}>
            <option value="">Not recorded</option>
            {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
          </EhrSelect>
        </EhrField>
        {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
        <div className="hid-ehr-dept-nursing-actions">
          <EhrButton type="submit">Save observations</EhrButton>
          <EhrButton variant="quiet" onClick={() => onDone(null)}>Go back</EhrButton>
        </div>
      </form>
    </DeptSection>
  )
}

