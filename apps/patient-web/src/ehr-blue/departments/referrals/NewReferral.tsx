import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { formatDateTime } from '@hid/ui/display'
import { EhrBadge, EhrButton, EhrCard, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  REFERRAL_PACKAGE_KINDS, referralsApi, staffApi, type ReferralAttestation, type ReferralDestination, type ReferralDestinationKind,
  type ReferralPackageKind, type ReferralSendInput, type ReferralUrgency,
} from '../../../staff/api'
import { destinationLine } from '../../../staff/components/OrderDestinationPicker'
import { useFocusById } from '../../../staff/focus'
import { isDemoFacility } from '../../blueFacilities'
import { DEPARTMENTS } from '../../collected/facilityProfile'
import type { Chart } from '../../clinical/parts/chart'
import { ErrorBox, Loading, RecordHeading } from '../../clinical/parts/Notices'
import { useWorkspaceHref } from '../../clinical/parts/Workspace'
import { DeptNotice } from '../parts/DeptNotice'
import { useIdempotencyKeys } from './hooks'
import {
  BASE, CONTROL_OFF, ENCOUNTER_WRITE, LIMITS, NOT_AVAILABLE, NOT_AVAILABLE_MORE, PACKAGE_KIND_WORDS, PACKAGE_LIMITS, REFERRAL_SEND,
  controlOff, departmentText, fillAttestation, learnFrom, lengthProblem, refusalWords, useReferralsServed,
} from './referralRules'
import './referrals.css'

/** One detail the clinician may tick, as the chart summary (EHR-C4) answers it: its id and a line to read. */
export interface TickItem { readonly id: string; readonly label: string }
export type TickLists = Readonly<Record<ReferralPackageKind, { readonly items: readonly TickItem[]; readonly message: string | null }>>

const NOT_IN_SUMMARY = 'Not shown in the chart summary for your role, so none can be ticked.'
const SUMMARY_UNAVAILABLE = 'The chart summary could not be loaded, so no details can be ticked. You can still send the letter.'
const DAY_MS = 24 * 60 * 60 * 1000

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
const items = (section: unknown): Record<string, unknown>[] =>
  record(section) && Array.isArray(section.items) ? section.items.filter(record) : []

const VITAL_WORDS: ReadonlyArray<readonly [string, string, string]> = [
  ['pulseBpm', 'Pulse', ' bpm'], ['temperatureC', 'Temperature', ' °C'], ['respiratoryRate', 'Breathing rate', '/min'],
  ['oxygenSaturationPercent', 'Oxygen saturation', '%'], ['weightKg', 'Weight', ' kg'], ['heightCm', 'Height', ' cm'],
]

/**
 * The tick list from the chart summary's answer (EHR-C4): current diagnoses, current medicines, recorded allergies from
 * any facility, this facility's vital-sign readings of the last 30 days (one line per reading, its measures together) and
 * released lab results. A section the summary left out says so; the server checks each id again when the referral is
 * sent (REFERRAL_PACKAGE_INVALID), so nothing here decides what may be sent.
 */
export function tickListsFrom(answer: unknown, patientId: string, now = Date.now()): TickLists {
  if (!record(answer) || answer.patientId !== patientId || !record(answer.sections)) throw new Error('Not a chart summary for this patient.')
  const sections = answer.sections
  const absent = (key: string) => !Object.hasOwn(sections, key)
  const list = (key: string, build: () => TickItem[]) => absent(key) ? { items: [], message: NOT_IN_SUMMARY } : { items: build(), message: null }

  const diagnoses = list('problems', () => items(sections.problems).filter(row => text(row.id) && text(row.display))
    .map(row => ({ id: text(row.id), label: [text(row.display), text(row.code) ? `${text(row.codeSystem)} ${text(row.code)}`.trim() : ''].filter(Boolean).join(' · ') })))
  const medicines = list('medications', () => items(sections.medications).filter(row => text(row.id) && text(row.medicationDisplay))
    .map(row => ({ id: text(row.id), label: [text(row.medicationDisplay), [text(row.doseQuantity), text(row.doseUnit)].filter(Boolean).join(' '),
      text(row.frequency)].filter(Boolean).join(' · ') })))
  const allergies = list('allergies', () => {
    const recorded = record(sections.allergies) && Array.isArray(sections.allergies.recorded) ? sections.allergies.recorded.filter(record) : []
    return recorded.filter(row => text(row.id) && text(row.substance)).map(row => ({ id: text(row.id), label: [text(row.substance), text(row.reaction),
      text(row.severity) ? `${text(row.severity)} severity` : '', row.recordedHere === false ? 'recorded at another facility' : ''].filter(Boolean).join(' · ') }))
  })
  const vitals = list('latestVitals', () => {
    const measures = record(sections.latestVitals) && record(sections.latestVitals.measures) ? sections.latestVitals.measures : {}
    const readings = new Map<string, { recordedAt: string; parts: string[] }>()
    for (const [measure, entry] of Object.entries(measures)) {
      if (!record(entry) || !text(entry.vitalId)) continue
      const recordedAt = text(entry.recordedAt)
      const when = Date.parse(recordedAt)
      // The last 30 days only (the server's rule): an older reading can't be sent, so it is not offered.
      if (!Number.isFinite(when) || now - when > 30 * DAY_MS) continue
      const reading = readings.get(text(entry.vitalId)) ?? { recordedAt, parts: [] }
      if (measure === 'bloodPressure' && record(entry.value)) {
        reading.parts.unshift(`Blood pressure ${text(entry.value.systolicMmhg)}/${text(entry.value.diastolicMmhg)} mmHg`)
      } else {
        const words = VITAL_WORDS.find(([key]) => key === measure)
        if (words && text(entry.value)) reading.parts.push(`${words[1]} ${text(entry.value)}${words[2]}`)
      }
      readings.set(text(entry.vitalId), reading)
    }
    return [...readings.entries()].filter(([, reading]) => reading.parts.length > 0)
      .map(([id, reading]) => ({ id, label: `${formatDateTime(reading.recordedAt)}: ${reading.parts.join(' · ')}` }))
  })
  const labResults = list('recentResults', () => items(sections.recentResults).filter(row => text(row.id) && text(row.title))
    .map(row => ({ id: text(row.id), label: [text(row.title), text(row.recordedAt) ? `released ${formatDateTime(text(row.recordedAt))}` : ''].filter(Boolean).join(' · ') })))
  return { diagnoses, medicines, allergies, vitals, labResults }
}

const EMPTY_TICKS: Readonly<Record<ReferralPackageKind, readonly string[]>> = { diagnoses: [], medicines: [], allergies: [], vitals: [], labResults: [] }

type Errors = Partial<Record<'destination' | 'printedName' | 'town' | 'department' | 'service' | 'urgency' | 'reason' | 'letter' | 'ticks' | 'agreed', string>>

/**
 * "New referral" from a visit (hid-system REF-1 routes 1, 2 and 6), in place of the sample's Create record
 * (clinical/sample SampleCreate with definitions.ts "referrals"): a facility on Health ID found with the directory
 * (kind=referral, each with its departments), or a printed letter for a facility outside Health ID; the department and
 * service wanted, the urgency (routine or urgent, Q266 A), the reason and the letter; the details to share, ticked from
 * the chart summary ("Consent scope" becomes "Only the details ticked here are shared", Q261 A); and the clinician's
 * confirmation that the patient agreed, in the current versioned words (Q262 A). Sent once, with one Idempotency-Key per
 * body; a Health ID referral then opens, a printed one opens its letter to print. The visit's note must be signed: the
 * server says so (REFERRAL_VISIT_NOT_SIGNED).
 */
export function NewReferral({ chart, encounterId }: { readonly chart: Chart; readonly encounterId: string }) {
  const href = useWorkspaceHref()
  const served = useReferralsServed()
  const heading = <RecordHeading title="New referral" backHref={href(encounterId)} backLabel="Back to consultation" />
  if (chart.purpose !== 'direct-care' || !chart.can(REFERRAL_SEND, ENCOUNTER_WRITE)) {
    return <>{heading}<ErrorBox>Only doctors and clinicians can send referrals.</ErrorBox></>
  }
  if (served === false) {
    return (
      <>
        {heading}
        <EhrCard>
          <DeptNotice tone="info" role="status" title={NOT_AVAILABLE}>{NOT_AVAILABLE_MORE}</DeptNotice>
          {isDemoFacility(chart.facilityId) ? <p className="hid-ehr-clinical-note">At this demo facility, the sample Referral Network shows how they will work.</p> : null}
        </EhrCard>
      </>
    )
  }
  if (!chart.canWrite) return <>{heading}{chart.writeNotice ? null : <Loading label="Checking your access…" />}</>
  return <>{heading}<ReferralForm chart={chart} encounterId={encounterId} /></>
}

function ReferralForm({ chart, encounterId }: { readonly chart: Chart; readonly encounterId: string }) {
  const navigate = useNavigate()
  const id = useId()
  const focus = useFocusById()
  const keyFor = useIdempotencyKeys()
  const [kind, setKind] = useState<ReferralDestinationKind>('health_id')
  const [destination, setDestination] = useState<ReferralDestination | null>(null)
  const [printedName, setPrintedName] = useState('')
  const [town, setTown] = useState('')
  const [department, setDepartment] = useState('')
  const [service, setService] = useState('')
  const [urgency, setUrgency] = useState<ReferralUrgency | ''>('')
  const [reason, setReason] = useState('')
  const [letter, setLetter] = useState('')
  const [ticks, setTicks] = useState<Readonly<Record<ReferralPackageKind, readonly string[]>>>(EMPTY_TICKS)
  const [lists, setLists] = useState<TickLists | null | 'failed'>(null)
  const [summaryRead, setSummaryRead] = useState(0)
  const [attestation, setAttestation] = useState<{ kind: ReferralDestinationKind; value: ReferralAttestation } | null>(null)
  const [attestationError, setAttestationError] = useState('')
  const [attestationRead, setAttestationRead] = useState(0)
  const [agreedTo, setAgreedTo] = useState<string | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState('')
  const [sending, setSending] = useState(false)

  // The chart summary, once (and again after REFERRAL_PACKAGE_INVALID): what the tick list offers.
  useEffect(() => {
    let alive = true
    setLists(null)
    staffApi.chartSummary(chart.facilityId, chart.patientId)
      .then(answer => { if (alive) setLists(tickListsFrom(answer, chart.patientId)) }, () => { if (alive) setLists('failed') })
    return () => { alive = false }
  }, [chart.facilityId, chart.patientId, summaryRead])

  // The agreement text of the kind chosen, read afresh each time the kind changes (each read is audited).
  useEffect(() => {
    let alive = true
    setAttestationError('')
    referralsApi.attestation(chart.facilityId, kind).then(value => {
      learnFrom()
      if (alive) setAttestation({ kind, value })
    }, (caught: unknown) => {
      learnFrom(caught)
      if (alive) setAttestationError(refusalWords(caught, 'The agreement wording could not be loaded. Try again.'))
    })
    return () => { alive = false }
  }, [chart.facilityId, kind, attestationRead])

  const receivingName = kind === 'health_id' ? destination?.facilityName ?? 'the facility you choose' : printedName.trim() || 'the facility you name'
  const current = attestation?.kind === kind ? attestation.value : null
  const filled = current ? fillAttestation(current.text, { patient: chart.facts.name, referringFacility: chart.facilityName, receivingFacility: receivingName }) : ''
  const agreed = agreedTo !== null && agreedTo === `${current?.version}\n${filled}`

  function tick(which: ReferralPackageKind, itemId: string, on: boolean) {
    setTicks(previous => ({ ...previous, [which]: on ? [...previous[which], itemId] : previous[which].filter(value => value !== itemId) }))
  }

  function check(): Errors {
    const found: Errors = {}
    if (kind === 'health_id' && !destination) found.destination = 'Choose the facility on Health ID, or print a letter instead.'
    if (kind === 'printed') {
      const name = lengthProblem(printedName, LIMITS.printedName, 'the facility’s name')
      if (name) found.printedName = name
      if (town.trim()) { const problem = lengthProblem(town, LIMITS.town, 'the town'); if (problem) found.town = problem }
    }
    if (!department) found.department = 'Choose the department wanted.'
    if (service.trim()) { const problem = lengthProblem(service, LIMITS.service, 'the service'); if (problem) found.service = problem }
    if (!urgency) found.urgency = 'Choose routine or urgent.'
    const reasonProblem = lengthProblem(reason, LIMITS.reason, 'the reason')
    if (reasonProblem) found.reason = reasonProblem
    const letterProblem = lengthProblem(letter, LIMITS.letter, 'the letter', true)
    if (letterProblem) found.letter = letterProblem
    const over = REFERRAL_PACKAGE_KINDS.find(which => ticks[which].length > PACKAGE_LIMITS[which])
    if (over) found.ticks = `Tick at most ${PACKAGE_LIMITS[over]} under ${PACKAGE_KIND_WORDS[over]}.`
    if (!current) found.agreed = 'The agreement wording has not loaded yet. Wait a moment, then confirm.'
    else if (!agreed) found.agreed = 'Confirm that the patient agreed before sending.'
    return found
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    const found = check()
    setErrors(found); setFormError('')
    const first = Object.keys(found)[0]
    if (first) { setFormError('Check the highlighted fields.'); focus(`${id}-error`); return }
    const input: ReferralSendInput = {
      destination: kind === 'health_id' ? { kind, facilityId: destination!.facilityId }
        : { kind, facilityName: printedName.trim(), ...(town.trim() ? { town: town.trim() } : {}) },
      departmentCode: department,
      ...(service.trim() ? { serviceWanted: service.trim() } : {}),
      urgency: urgency as ReferralUrgency,
      reason: reason.trim(),
      letterText: letter.trim(),
      package: {
        ...(ticks.diagnoses.length ? { diagnosisIds: [...ticks.diagnoses] } : {}),
        ...(ticks.medicines.length ? { prescriptionIds: [...ticks.medicines] } : {}),
        ...(ticks.allergies.length ? { allergyIds: [...ticks.allergies] } : {}),
        ...(ticks.vitals.length ? { vitalIds: [...ticks.vitals] } : {}),
        ...(ticks.labResults.length ? { labResultIds: [...ticks.labResults] } : {}),
      },
      attestationTextVersion: current!.version,
    }
    setSending(true)
    try {
      const answer = await referralsApi.send(chart.facilityId, chart.patientId, encounterId, input, keyFor('send', input))
      learnFrom()
      const referralId = answer.referral.referralId
      navigate(answer.referral.destinationKind === 'printed' ? `${BASE}/${referralId}/letter` : `${BASE}/${referralId}`)
    } catch (caught) {
      learnFrom(caught)
      const words = refusalWords(caught, 'The referral could not be sent. Try again.')
      if (!words) return
      setFormError(words)
      if (isHidApiError(caught) && caught.code === 'REFERRAL_ATTESTATION_OUTDATED') { setAgreedTo(null); setAttestationRead(count => count + 1) }
      if (isHidApiError(caught) && caught.code === 'REFERRAL_PACKAGE_INVALID') { setTicks(EMPTY_TICKS); setSummaryRead(count => count + 1) }
      if (isHidApiError(caught) && (caught.code === 'REFERRAL_DESTINATION_UNAVAILABLE' || caught.code === 'REFERRAL_DESTINATION_BUSY')) setDestination(null)
      focus(`${id}-error`)
    } finally { setSending(false) }
  }

  return (
    <EhrCard>
      <form className="hid-ehr-dept-form hid-ehr-dept-referrals-form" noValidate onSubmit={event => void submit(event)} aria-label="New referral">
        <p className="hid-ehr-clinical-note">From this visit. Only the details ticked here are shared.</p>

        <fieldset className="hid-ehr-dept-referrals-ticks">
          <legend>Where to</legend>
          <label className="hid-ehr-dept-referrals-choice">
            <input type="radio" name={`${id}-kind`} checked={kind === 'health_id'} onChange={() => { setKind('health_id'); setAgreedTo(null) }} />
            <span>A facility on Health ID</span>
          </label>
          <label className="hid-ehr-dept-referrals-choice">
            <input type="radio" name={`${id}-kind`} checked={kind === 'printed'} onChange={() => { setKind('printed'); setAgreedTo(null) }} />
            <span>Facility not on Health ID: print a letter</span>
          </label>
        </fieldset>

        {kind === 'health_id' ? (
          <DestinationSearch facilityId={chart.facilityId} value={destination} error={errors.destination}
            onChange={next => { setDestination(next); setAgreedTo(null) }} />
        ) : (
          <div className="hid-ehr-dept-form-grid">
            <EhrField label="Facility’s name" error={errors.printedName} hint="As the patient will find it. Nothing is sent there: the patient carries the letter.">
              <EhrInput value={printedName} onChange={event => { setPrintedName(event.target.value); setAgreedTo(null) }} maxLength={LIMITS.printedName[1]} autoComplete="off" />
            </EhrField>
            <EhrField label="Town (optional)" error={errors.town}>
              <EhrInput value={town} onChange={event => setTown(event.target.value)} maxLength={LIMITS.town[1]} autoComplete="off" />
            </EhrField>
          </div>
        )}

        <div className="hid-ehr-dept-form-grid">
          <EhrField label="Department wanted" error={errors.department}>
            <EhrSelect value={department} onChange={event => setDepartment(event.target.value)}>
              <option value="">Choose a department</option>
              {DEPARTMENTS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Service or clinic wanted (optional)" error={errors.service} hint="In your own words, such as ‘Cardiology clinic’.">
            <EhrInput value={service} onChange={event => setService(event.target.value)} maxLength={LIMITS.service[1]} autoComplete="off" />
          </EhrField>
        </div>

        <fieldset className="hid-ehr-dept-referrals-ticks" aria-describedby={errors.urgency ? `${id}-urgency-error` : undefined}>
          <legend>Urgency</legend>
          {(['routine', 'urgent'] as const).map(value => (
            <label key={value} className="hid-ehr-dept-referrals-choice">
              <input type="radio" name={`${id}-urgency`} checked={urgency === value} onChange={() => setUrgency(value)} />
              <span>{value === 'routine' ? 'Routine (answer within 7 days)' : 'Urgent (answer within 24 hours)'}</span>
            </label>
          ))}
          <p className="hid-ehr-clinical-note">Emergencies are not referrals: phone the facility and send the patient through its emergency department.</p>
          {errors.urgency ? <p id={`${id}-urgency-error`} className="hid-ehr-error">{errors.urgency}</p> : null}
        </fieldset>

        <EhrField label="Reason" error={errors.reason}
          hint="A short reason the receiving facility sees before accepting. Do not write the patient’s name. 8 to 300 characters.">
          <EhrTextarea value={reason} onChange={event => setReason(event.target.value)} maxLength={LIMITS.reason[1]} rows={2} />
        </EhrField>
        <EhrField label="Letter" error={errors.letter} hint="The referral letter: what you found, what you have done and what you are asking for. 20 to 8,000 characters.">
          <EhrTextarea value={letter} onChange={event => setLetter(event.target.value)} maxLength={LIMITS.letter[1]} rows={8} />
        </EhrField>

        <Ticks lists={lists} ticks={ticks} onTick={tick} error={errors.ticks} />

        <div className="hid-ehr-dept-referrals-ticks" role="group" aria-labelledby={`${id}-agree-title`}>
          <p id={`${id}-agree-title`}><strong>The patient’s agreement</strong></p>
          {attestationError ? <DeptNotice role="alert" tone="critical">{attestationError}</DeptNotice> : null}
          {current ? (
            <>
              <blockquote className="hid-ehr-dept-referrals-attestation">{filled}</blockquote>
              <label className="hid-ehr-dept-referrals-choice">
                <input type="checkbox" checked={agreed} aria-describedby={errors.agreed ? `${id}-agreed-error` : undefined}
                  onChange={event => setAgreedTo(event.target.checked ? `${current.version}\n${filled}` : null)} />
                <span>I confirm the patient agreed, as written above.</span>
              </label>
            </>
          ) : attestationError ? null : <p className="hid-ehr-state-message" role="status">Loading the agreement wording…</p>}
          {errors.agreed ? <p id={`${id}-agreed-error`} className="hid-ehr-error">{errors.agreed}</p> : null}
        </div>

        {formError ? <div id={`${id}-error`} tabIndex={-1}><DeptNotice role="alert" tone="critical">{formError}</DeptNotice></div> : null}
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" busy={sending}>{kind === 'printed' ? 'Save and print letter' : 'Send referral'}</EhrButton>
        </div>
      </form>
    </EhrCard>
  )
}

/**
 * The details to share, ticked from the chart summary under the design's five headings. Nothing is ticked at first:
 * the clinician chooses what goes.
 */
function Ticks({ lists, ticks, onTick, error }: {
  readonly lists: TickLists | null | 'failed'
  readonly ticks: Readonly<Record<ReferralPackageKind, readonly string[]>>
  readonly onTick: (kind: ReferralPackageKind, id: string, on: boolean) => void
  readonly error?: string
}) {
  return (
    <div className="hid-ehr-dept-referrals-ticks" role="group" aria-label="Details to share">
      <p><strong>Details to share</strong></p>
      <p className="hid-ehr-clinical-note">Only the details ticked here are shared. They are copied when you send, and the copy never changes.</p>
      {lists === null ? <p className="hid-ehr-state-message" role="status">Loading the chart summary…</p> : null}
      {lists === 'failed' ? <p className="hid-ehr-state-message">{SUMMARY_UNAVAILABLE}</p> : null}
      {lists && lists !== 'failed' ? REFERRAL_PACKAGE_KINDS.map(kind => {
        const section = lists[kind]
        return (
          <fieldset key={kind}>
            <legend>{PACKAGE_KIND_WORDS[kind]}</legend>
            {section.message ? <p className="hid-ehr-clinical-note">{section.message}</p>
              : section.items.length === 0 ? <p className="hid-ehr-clinical-note">None on record.</p>
              : section.items.map(item => (
                <label key={item.id} className="hid-ehr-dept-referrals-choice">
                  <input type="checkbox" checked={ticks[kind].includes(item.id)} onChange={event => onTick(kind, item.id, event.target.checked)} />
                  <span>{item.label}</span>
                </label>
              ))}
          </fieldset>
        )
      }) : null}
      {error ? <p className="hid-ehr-error" role="alert">{error}</p> : null}
    </div>
  )
}

/**
 * The directory (REF-1 route 6, kind=referral): facilities on Health ID listed to receive referrals, at most 10, never
 * this one, each with its CAC registered office and the departments its profile names. A search is made only when asked:
 * each counts towards the member's 60 an hour. With the control off it answers 423, and the page offers the letter.
 */
function DestinationSearch({ facilityId, value, onChange, error }: {
  readonly facilityId: string
  readonly value: ReferralDestination | null
  readonly onChange: (destination: ReferralDestination | null) => void
  readonly error?: string
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<ReferralDestination[] | null>(null)
  const [refused, setRefused] = useState('')
  const [answered, setAnswered] = useState(0)
  const typed = query.replace(/\s+/g, ' ').trim()

  async function search() {
    if (searching) return
    if (typed.length < 3 || typed.length > 80) { setRefused('Type 3 to 80 letters of the facility’s name.'); return }
    setSearching(true); setRefused('')
    try {
      const answer = await referralsApi.destinations(facilityId, typed)
      learnFrom()
      setResults(Array.isArray(answer?.items) ? answer.items : [])
      setAnswered(count => count + 1)
    } catch (caught) {
      learnFrom(caught)
      setResults(null)
      setRefused(controlOff(caught) ? CONTROL_OFF : refusalWords(caught, 'The search did not work. Try again.'))
    } finally { setSearching(false) }
  }

  function enter(event: KeyboardEvent<HTMLInputElement>) {
    // Enter searches here; it does not send the form around it.
    if (event.key !== 'Enter') return
    event.preventDefault()
    void search()
  }

  const count = results?.length ?? 0
  return (
    <div className="hid-ehr-dept-referrals-ticks" role="group" aria-labelledby={`${id}-legend`}>
      <p id={`${id}-legend`}><strong>Facility on Health ID</strong></p>
      <div className="hid-ehr-dept-form-grid">
        <EhrField label="Search for the facility" hint="Type at least 3 letters of its name, then search." error={error}>
          <EhrInput type="search" autoComplete="off" spellCheck={false} maxLength={80} value={query}
            onChange={event => setQuery(event.target.value)} onKeyDown={enter} />
        </EhrField>
      </div>
      <div className="hid-ehr-dept-referrals-actions">
        <EhrButton variant="secondary" busy={searching} onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</EhrButton>
      </div>
      <p role="status" className="hid-ehr-clinical-note">{searching ? 'Searching…' : results === null ? null
        : <span key={answered}>{count === 0 ? 'No facility on Health ID taking referrals matches that name.' : count === 1 ? '1 facility found.' : `${count} facilities found.`}</span>}</p>
      {refused ? <p role="alert" className="hid-ehr-error">{refused}</p> : null}
      {results && count > 0 ? (
        <fieldset className="hid-ehr-dept-referrals-ticks">
          <legend>Choose the facility</legend>
          {results.map(destination => (
            <label key={destination.facilityId} className="hid-ehr-dept-referrals-choice">
              <input type="radio" name={`${id}-destination`} value={destination.facilityId}
                checked={value?.facilityId === destination.facilityId} onChange={() => onChange(destination)} />
              <span>
                {destinationLine(destination)}
                {destination.newOnHealthId ? <> <EhrBadge tone="brand">New on Health ID</EhrBadge></> : null}
                <span className="hid-ehr-dept-referrals-line">
                  {destination.departments?.length ? `Departments: ${destination.departments.map(departmentText).join(', ')}` : 'Departments not listed'}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {value ? <p className="hid-ehr-clinical-note">Chosen: <strong>{destinationLine(value)}</strong></p> : null}
      <p className="hid-ehr-clinical-note">Not listed? It may not be on Health ID yet, or not taking referrals. Print a letter instead.</p>
    </div>
  )
}
