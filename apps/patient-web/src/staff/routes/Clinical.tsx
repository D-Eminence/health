import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from '@hid/ui'
import { isAllowedPatientLookup, staffApi, type ClinicalRecord, type DiagnosisUpdate, type DocumentRecord, type EmergencyRecords, type Encounter, type NoteRevision, type Page, type RecordKind, type StatusRecordKind, type VitalCorrection, type VitalMeasurement, type VitalMeasurements } from '../api'
import { useStaff } from '../App'

const tabs: Array<{ id: RecordKind | 'documents'; label: string; permission: string }> = [
  { id: 'clinical-notes', label: 'Notes', permission: 'ehr.note.read' },
  { id: 'vitals', label: 'Vitals', permission: 'ehr.vital.read' },
  { id: 'diagnoses', label: 'Diagnoses', permission: 'ehr.diagnosis.read' },
  { id: 'prescriptions', label: 'Prescriptions', permission: 'ehr.prescription.read' },
  { id: 'lab-requests', label: 'Lab requests', permission: 'ehr.lab-request.read' },
  { id: 'documents', label: 'Documents', permission: 'ehr.document.read' },
]

/**
 * Each vital as EHR's VitalMeasurementsDto accepts it (hid-system
 * ehr/shared/clinical.dto.ts): whole numbers or a number of decimal places, and
 * a range. The browser refuses anything else before it is sent.
 */
const VITAL_FIELDS: ReadonlyArray<readonly [name: VitalMeasurement, label: string, step: string, min: string, max: string]> = [
  ['systolicMmhg', 'Systolic BP (mmHg)', '1', '30', '350'],
  ['diastolicMmhg', 'Diastolic BP (mmHg)', '1', '10', '250'],
  ['pulseBpm', 'Pulse (bpm)', '1', '10', '350'],
  ['temperatureC', 'Temperature (°C)', '0.1', '20', '50'],
  ['respiratoryRate', 'Respirations / min', '1', '1', '100'],
  ['oxygenSaturationPercent', 'SpO₂ (%)', '0.01', '0', '100'],
  ['weightKg', 'Weight (kg)', '0.001', '0.2', '700'],
  ['heightCm', 'Height (cm)', '0.01', '20', '300'],
]

const writePermissions: Record<RecordKind | 'documents', string> = {
  'clinical-notes': 'ehr.note.write',
  vitals: 'ehr.vital.write',
  diagnoses: 'ehr.diagnosis.write',
  prescriptions: 'ehr.prescription.write',
  'lab-requests': 'ehr.lab-request.write',
  documents: 'ehr.document.write',
}

function text(form: FormData, name: string) { return String(form.get(name) ?? '').trim() }
function number(form: FormData, name: string) { const value = text(form, name); return value === '' ? undefined : Number(value) }
function isoNow() { return new Date().toISOString() }

type StatusOption = { readonly value: string; readonly label: string }
const encounterTransitions: Readonly<Record<string, readonly StatusOption[]>> = {
  planned: [{ value: 'in_progress', label: 'Start' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
  in_progress: [{ value: 'on_hold', label: 'Put on hold' }, { value: 'completed', label: 'Complete' },
    { value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  on_hold: [{ value: 'in_progress', label: 'Resume' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
}
const prescriptionTransitions: Readonly<Record<string, readonly StatusOption[]>> = {
  draft: [{ value: 'active', label: 'Activate' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
  active: [{ value: 'on_hold', label: 'Put on hold' }, { value: 'completed', label: 'Complete' },
    { value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  on_hold: [{ value: 'active', label: 'Resume' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
}
const noteTransitions: Readonly<Record<string, readonly StatusOption[]>> = {
  draft: [{ value: 'signed', label: 'Sign note' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  signed: [{ value: 'entered_in_error', label: 'Mark entered in error' }],
  amended: [{ value: 'entered_in_error', label: 'Mark entered in error' }],
}
// EHR allows draft → active too, but that PATCH never reaches Lab, and no change
// to a request Lab has accepted is passed to Lab: only a draft is offered changes.
const labRequestTransitions: Readonly<Record<string, readonly StatusOption[]>> = {
  draft: [{ value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
}
const diagnosisClinicalStatuses: readonly StatusOption[] = [
  { value: 'active', label: 'Active' }, { value: 'recurrence', label: 'Recurrence' }, { value: 'relapse', label: 'Relapse' },
  { value: 'inactive', label: 'Inactive' }, { value: 'remission', label: 'Remission' }, { value: 'resolved', label: 'Resolved' },
]
const diagnosisVerificationStatuses: readonly StatusOption[] = [
  { value: 'unconfirmed', label: 'Unconfirmed' }, { value: 'provisional', label: 'Provisional' },
  { value: 'differential', label: 'Differential' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'refuted', label: 'Refuted' },
]

// EHR lists encounters and each record kind newest first, 50 to a page, and
// hands back an opaque cursor for the next; it gives no total. A list keeps the
// cursors that led to the page shown, the first page's being none.
type Cursors = ReadonlyArray<string | undefined>
type PagePosition = { readonly scope: string; readonly cursors: Cursors; readonly next: string | null }
const FIRST_PAGE: Cursors = [undefined]
const RESTARTED = 'This list changed since it was opened, so it shows the newest entries again.'

/** Reads a page; a cursor EHR no longer accepts (400 INVALID_CURSOR) starts the list again. */
async function readPage<T>(read: (cursor: string | undefined, fresh: boolean) => Promise<Page<T>>, cursors: Cursors, fresh: boolean) {
  try { return { page: await read(cursors.at(-1), fresh), cursors, restarted: false } }
  catch (caught) {
    if (cursors.length < 2 || !isHidApiError(caught) || caught.code !== 'INVALID_CURSOR') throw caught
    return { page: await read(undefined, true), cursors: FIRST_PAGE, restarted: true }
  }
}

/** The reference design's record pages: shown only when there is more than one page. */
function Pager({ label, position, disabled, onShow }: {
  label: string; position: PagePosition | null; disabled: boolean; onShow: (cursors: Cursors) => void
}) {
  if (!position || (position.cursors.length < 2 && !position.next)) return null
  const { cursors, next } = position
  return <nav className="staff-row" aria-label={label}>
    <Button tone="secondary" size="sm" disabled={disabled || cursors.length < 2} onClick={() => onShow(cursors.slice(0, -1))}>Previous page</Button>
    <span className="staff-muted">{`Page ${cursors.length}`}</span>
    <Button tone="secondary" size="sm" disabled={disabled || !next} onClick={() => { if (next) onShow([...cursors, next]) }}>Next page</Button>
  </nav>
}

function rowVersion(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === '') return null
  return <div className="staff-detail"><span>{label}</span><strong>{value}</strong></div>
}

type VitalValues = Readonly<Record<string, unknown>>

function vitalSummary(values: VitalValues) {
  return [
    values.systolicMmhg != null && values.diastolicMmhg != null ? `BP ${values.systolicMmhg}/${values.diastolicMmhg} mmHg` : '',
    values.temperatureC != null ? `${values.temperatureC} °C` : '',
    values.pulseBpm != null ? `${values.pulseBpm} bpm` : '',
    values.respiratoryRate != null ? `${values.respiratoryRate} breaths/min` : '',
    values.oxygenSaturationPercent != null ? `SpO₂ ${values.oxygenSaturationPercent}%` : '',
    values.weightKg != null ? `${values.weightKg} kg` : '',
    values.heightCm != null ? `${values.heightCm} cm` : '',
  ].filter(Boolean).join(' · ')
}

function recordTitle(tab: RecordKind, record: ClinicalRecord) {
  if (tab === 'clinical-notes') return String(record.title ?? 'Clinical note')
  if (tab === 'vitals') return 'Vitals recorded'
  if (tab === 'diagnoses') return String(record.display ?? 'Diagnosis')
  if (tab === 'prescriptions') return String(record.medicationDisplay ?? 'Prescription')
  return String(record.testDisplay ?? 'Lab request')
}

function recordDetail(tab: RecordKind, record: ClinicalRecord) {
  if (tab === 'clinical-notes') return `Status: ${String(record.status ?? 'unknown')}`
  if (tab === 'vitals') return vitalSummary(record)
  if (tab === 'diagnoses') return `${String(record.codeSystem ?? '')} · ${String(record.code ?? '')} · ${String(record.clinicalStatus ?? '')} · ${String(record.verificationStatus ?? '').replaceAll('_', ' ')}`
  if (tab === 'prescriptions') return `${String(record.frequency ?? '')} · ${String(record.status ?? '')}`
  return `${String(record.testCode ?? '')} · ${String(record.priority ?? '')} · ${String(record.status ?? '')}`
}

function EncounterForm({ onCreated, disabled }: { onCreated: (input: { encounterType: string; status: string; startedAt: string; chiefComplaint: string }, key: string) => Promise<void>; disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const attempt = useRef<{ signature: string; input: { encounterType: string; status: string; startedAt: string; chiefComplaint: string }; key: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const signature = JSON.stringify([text(form, 'encounterType'), text(form, 'chiefComplaint')])
    if (attempt.current?.signature !== signature) attempt.current = {
      signature, input: { encounterType: text(form, 'encounterType'), status: 'in_progress', startedAt: isoNow(), chiefComplaint: text(form, 'chiefComplaint') },
      key: crypto.randomUUID(),
    }
    submitting.current = true; setError(''); setBusy(true)
    try { await onCreated(attempt.current.input, attempt.current.key); formElement.reset(); attempt.current = null }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Encounter could not be created.') }
    finally { submitting.current = false; setBusy(false) }
  }
  return <Card className="staff-card"><h2>Start encounter</h2><p>Creating a clinical encounter requires current server authorization and a documented reason for care.</p><form className="staff-form" onSubmit={event => void submit(event)}><Field label="Encounter type" htmlFor="encounter-type" required><Select id="encounter-type" name="encounterType" required><option value="ambulatory">Outpatient</option><option value="emergency">Emergency</option><option value="inpatient">Inpatient</option><option value="virtual">Virtual</option><option value="home">Home</option><option value="other">Other</option></Select></Field><Field label="Chief complaint" htmlFor="chief-complaint" required><Textarea id="chief-complaint" name="chiefComplaint" maxLength={4000} required /></Field>{error && <p className="staff-error" role="alert">{error}</p>}<Button type="submit" disabled={busy || disabled}>{busy ? 'Creating…' : 'Start encounter'}</Button></form></Card>
}

function RecordForm({ tab, onCreated, disabled }: { tab: RecordKind; onCreated: (kind: RecordKind, body: object, key: string) => Promise<void>; disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const attempt = useRef<{ signature: string; body: object; key: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    submitting.current = true; setError(''); setBusy(true)
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    try {
      let body: object
      if (tab === 'clinical-notes') body = { noteType: text(form, 'noteType'), title: text(form, 'title'), status: 'draft', content: text(form, 'content') }
      else if (tab === 'vitals') {
        const measurements = Object.fromEntries(['heightCm', 'weightKg', 'temperatureC', 'pulseBpm', 'respiratoryRate', 'systolicMmhg', 'diastolicMmhg', 'oxygenSaturationPercent']
          .map(name => [name, number(form, name)] as const).filter(([, value]) => value !== undefined))
        if (Object.keys(measurements).length === 0) throw new Error('Enter at least one vital measurement.')
        body = { recordedAt: isoNow(), source: 'manual', ...measurements }
      } else if (tab === 'diagnoses') body = { codeSystem: text(form, 'codeSystem'), code: text(form, 'code'), display: text(form, 'display'), clinicalStatus: text(form, 'clinicalStatus'), verificationStatus: text(form, 'verificationStatus'), notes: text(form, 'notes') || undefined }
      else if (tab === 'prescriptions') {
        const doseQuantity = number(form, 'doseQuantity')
        const doseUnit = text(form, 'doseUnit') || undefined
        if ((doseQuantity === undefined) !== (doseUnit === undefined)) throw new Error('Enter both dose quantity and dose unit, or leave both blank.')
        body = { medicationDisplay: text(form, 'medicationDisplay'), doseQuantity, doseUnit,
          routeCode: text(form, 'routeCode') || undefined, frequency: text(form, 'frequency'),
          instructions: text(form, 'instructions'), status: 'draft' }
      }
      else {
        const status = text(form, 'status')
        if (status !== 'draft' && status !== 'active') throw new Error('Choose draft or active request.')
        body = { testCodeSystem: text(form, 'testCodeSystem'), testCode: text(form, 'testCode'),
          testDisplay: text(form, 'testDisplay'), priority: text(form, 'priority'), status,
          specimenTypeCode: text(form, 'specimenTypeCode') || undefined,
          clinicalInformation: text(form, 'clinicalInformation') || undefined }
      }
      const signature = JSON.stringify([tab, ...Array.from(form.entries())])
      if (attempt.current?.signature !== signature) attempt.current = { signature, body, key: crypto.randomUUID() }
      await onCreated(tab, attempt.current.body, attempt.current.key)
      formElement.reset()
      attempt.current = null
    } catch (caught) { setError(errorMessage(caught, 'Record could not be saved.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <Card className="staff-card"><h2>Add {tabs.find(item => item.id === tab)?.label.toLowerCase()}</h2><form className="staff-form" onSubmit={event => void submit(event)}>
    {tab === 'clinical-notes' && <><Field label="Note type" htmlFor="note-type" required><Input id="note-type" name="noteType" placeholder="Consultation" required /></Field><Field label="Title" htmlFor="note-title" required><Input id="note-title" name="title" required /></Field><Field label="Clinical note" htmlFor="note-content" required><Textarea id="note-content" name="content" minLength={1} required /></Field><p className="staff-muted">Notes are saved as drafts. Signing needs its own reviewed action.</p></>}
    {tab === 'vitals' && <div className="staff-form-row">{VITAL_FIELDS.map(([name, label, step, min, max]) =>
      <Field key={name} label={label} htmlFor={`vital-${name}`}><Input id={`vital-${name}`} name={name} type="number" step={step} min={min} max={max} /></Field>)}</div>}
    {tab === 'diagnoses' && <><div className="staff-form-row"><Field label="Code system" htmlFor="diagnosis-system" required><Input id="diagnosis-system" name="codeSystem" placeholder="ICD-10" required /></Field><Field label="Code" htmlFor="diagnosis-code" required><Input id="diagnosis-code" name="code" required /></Field></div><Field label="Display" htmlFor="diagnosis-display" required><Input id="diagnosis-display" name="display" required /></Field><div className="staff-form-row"><Field label="Clinical status" htmlFor="diagnosis-status"><Select id="diagnosis-status" name="clinicalStatus">{diagnosisClinicalStatuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="Verification" htmlFor="diagnosis-verification"><Select id="diagnosis-verification" name="verificationStatus">{diagnosisVerificationStatuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field></div><Field label="Notes" htmlFor="diagnosis-notes"><Textarea id="diagnosis-notes" name="notes" /></Field></>}
    {tab === 'prescriptions' && <><Field label="Medication" htmlFor="medication" required><Input id="medication" name="medicationDisplay" required /></Field><div className="staff-form-row"><Field label="Dose quantity" htmlFor="dose-quantity"><Input id="dose-quantity" name="doseQuantity" type="number" min="0" step="any" /></Field><Field label="Dose unit" htmlFor="dose-unit"><Input id="dose-unit" name="doseUnit" placeholder="mg" /></Field></div><div className="staff-form-row"><Field label="Route code" htmlFor="route-code"><Input id="route-code" name="routeCode" placeholder="oral" /></Field><Field label="Frequency" htmlFor="frequency" required><Input id="frequency" name="frequency" placeholder="Twice daily" required /></Field></div><Field label="Instructions" htmlFor="instructions" required><Textarea id="instructions" name="instructions" required /></Field><p className="staff-muted">This creates an EHR draft. Pharmacy acceptance and dispensing are separate backend actions.</p></>}
    {tab === 'lab-requests' && <><div className="staff-form-row"><Field label="Test code system" htmlFor="test-system" required><Input id="test-system" name="testCodeSystem" placeholder="LOINC" required /></Field><Field label="Test code" htmlFor="test-code" required><Input id="test-code" name="testCode" required /></Field></div><Field label="Test display" htmlFor="test-display" required><Input id="test-display" name="testDisplay" required /></Field><div className="staff-form-row"><Field label="Priority" htmlFor="test-priority"><Select id="test-priority" name="priority"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="asap">As soon as possible</option><option value="stat">Stat</option></Select></Field><Field label="Specimen type code" htmlFor="specimen-code"><Input id="specimen-code" name="specimenTypeCode" /></Field></div><Field label="Clinical information" htmlFor="test-information"><Textarea id="test-information" name="clinicalInformation" /></Field><Field label="Request handling" htmlFor="lab-request-status" required><Select id="lab-request-status" name="status" defaultValue="draft" required><option value="draft">Save EHR draft</option><option value="active">Create active request and send to Lab</option></Select></Field><p className="staff-muted">Active creation asks Lab to accept the order. If acceptance is not confirmed, review the request list before retrying. A draft stays in the EHR: it cannot be sent to Lab later, because that backend handoff is still missing, so create an active request to order the test.</p></>}
    {error && <p className="staff-error" role="alert">{error}</p>}<Button type="submit" disabled={busy || disabled}>{busy ? 'Saving…' : tab === 'lab-requests' ? 'Create lab request' : tab === 'vitals' || tab === 'diagnoses' ? 'Save record' : 'Save draft'}</Button>
  </form></Card>
}

function StatusActionForm({ id, title, choices, disabled, onChange }: {
  id: string; title: string; choices: readonly StatusOption[]; disabled: boolean
  onChange: (status: string, reason: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const status = text(form, 'status')
    const reason = text(form, 'reason')
    if (!choices.some(choice => choice.value === status) || reason.length < 3) {
      setError('Choose an allowed status and give a reason of at least 3 characters.')
      return
    }
    submitting.current = true; setBusy(true); setError('')
    try { await onChange(status, reason); formElement.reset() }
    catch (caught) { setError(errorMessage(caught, 'Status could not be changed.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <strong>{title}</strong>
    <Field label="New status" htmlFor={`${id}-status`} required><Select id={`${id}-status`} name="status" defaultValue={choices[0]?.value} required>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</Select></Field>
    <Field label="Reason for change" htmlFor={`${id}-reason`} required><Input id={`${id}-reason`} name="reason" minLength={3} maxLength={500} required /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" disabled={busy || disabled}>{busy ? 'Updating…' : 'Update status'}</Button>
  </form>
}

function ReasonActionForm({ id, title, actionLabel, minLength = 3, disabled, onAction }: {
  id: string; title: string; actionLabel: string; minLength?: number; disabled: boolean
  onAction: (reason: string, key: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const attempt = useRef<{ reason: string; key: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const formElement = event.currentTarget
    const reason = text(new FormData(formElement), 'reason')
    if (reason.length < minLength) {
      setError(`Give a reason of at least ${minLength} characters.`)
      return
    }
    if (attempt.current?.reason !== reason) attempt.current = { reason, key: crypto.randomUUID() }
    submitting.current = true; setBusy(true); setError('')
    try { await onAction(reason, attempt.current.key); formElement.reset(); attempt.current = null }
    catch (caught) { setError(errorMessage(caught, `${actionLabel} could not be completed.`)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <strong>{title}</strong>
    <Field label="Reason" htmlFor={`${id}-reason`} required><Input id={`${id}-reason`} name="reason" minLength={minLength} maxLength={500} required /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" disabled={busy || disabled}>{busy ? 'Working…' : actionLabel}</Button>
  </form>
}

type DiagnosisChanges = Omit<DiagnosisUpdate, 'expectedRowVersion' | 'changeReason'>

/** Sends only what was changed: EHR's UpdateDiagnosisDto names no other field. */
function DiagnosisUpdateForm({ id, diagnosis, disabled, onUpdate }: {
  id: string; diagnosis: ClinicalRecord; disabled: boolean
  onUpdate: (changes: DiagnosisChanges, reason: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const form = new FormData(event.currentTarget)
    const clinicalStatus = text(form, 'clinicalStatus')
    const verificationStatus = text(form, 'verificationStatus')
    const notes = text(form, 'notes')
    const reason = text(form, 'reason')
    const changes: DiagnosisChanges = {
      ...(clinicalStatus !== String(diagnosis.clinicalStatus ?? '') ? { clinicalStatus } : {}),
      ...(verificationStatus !== String(diagnosis.verificationStatus ?? '') ? { verificationStatus } : {}),
      ...(notes !== String(diagnosis.notes ?? '').trim() ? { notes } : {}),
    }
    if (Object.keys(changes).length === 0) { setError('Change the clinical status, verification or notes before saving.'); return }
    if (reason.length < 3) { setError('Give a reason of at least 3 characters.'); return }
    submitting.current = true; setBusy(true); setError('')
    try { await onUpdate(changes, reason) }
    catch (caught) { setError(errorMessage(caught, 'The diagnosis could not be changed.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <strong>Change this diagnosis</strong>
    <div className="staff-form-row">
      <Field label="Clinical status" htmlFor={`${id}-clinical`}><Select id={`${id}-clinical`} name="clinicalStatus" defaultValue={String(diagnosis.clinicalStatus ?? '')}>{diagnosisClinicalStatuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
      <Field label="Verification" htmlFor={`${id}-verification`}><Select id={`${id}-verification`} name="verificationStatus" defaultValue={String(diagnosis.verificationStatus ?? '')}>{[...diagnosisVerificationStatuses, { value: 'entered_in_error', label: 'Entered in error' }].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
    </div>
    <Field label="Notes" htmlFor={`${id}-notes`}><Textarea id={`${id}-notes`} name="notes" maxLength={4000} defaultValue={String(diagnosis.notes ?? '')} /></Field>
    <Field label="Reason for change" htmlFor={`${id}-reason`} required><Input id={`${id}-reason`} name="reason" minLength={3} maxLength={500} required /></Field>
    <p className="staff-muted">Every change is kept in the record history. A diagnosis marked entered in error accepts no further change here.</p>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" disabled={busy || disabled}>{busy ? 'Updating…' : 'Update diagnosis'}</Button>
  </form>
}

type VitalCorrect = (replacementValues: VitalMeasurements, reason: string, key: string) => Promise<void>

function VitalCorrectionForm({ id, current, disabled, onCorrect }: {
  id: string; current: VitalValues; disabled: boolean; onCorrect: VitalCorrect
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const form = new FormData(event.currentTarget)
    const values: VitalMeasurements = {}
    for (const [name] of VITAL_FIELDS) {
      const value = number(form, name)
      if (value !== undefined) values[name] = value
    }
    const reason = text(form, 'reason')
    const problem = Object.keys(values).length === 0 ? 'Enter at least one vital measurement.'
      : (values.systolicMmhg === undefined) !== (values.diastolicMmhg === undefined) ? 'Enter both systolic and diastolic blood pressure, or leave both blank.'
      : VITAL_FIELDS.every(([name]) => values[name] === (current[name] == null ? undefined : Number(current[name]))) ? 'Change at least one value before saving a correction.'
      : reason.length < 3 ? 'Give a reason of at least 3 characters.' : ''
    if (problem) { setError(problem); return }
    // A retry of the same correction reuses its key, so EHR cannot append it twice.
    const signature = JSON.stringify([values, reason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    submitting.current = true; setBusy(true); setError('')
    try { await onCorrect(values, reason, attempt.current.key); attempt.current = null }
    catch (caught) { setError(errorMessage(caught, 'The correction could not be saved.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <p className="staff-muted">The values below become the current vitals; what was recorded is kept. A measurement left blank is not part of the corrected vitals.</p>
    <div className="staff-form-row">{VITAL_FIELDS.map(([name, label, step, min, max]) =>
      <Field key={name} label={label} htmlFor={`${id}-${name}`}><Input id={`${id}-${name}`} name={name} type="number" step={step} min={min} max={max}
        defaultValue={current[name] == null ? '' : String(current[name])} /></Field>)}</div>
    <Field label="Reason for correction" htmlFor={`${id}-reason`} required><Input id={`${id}-reason`} name="reason" minLength={3} maxLength={500} required /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" disabled={busy || disabled}>{busy ? 'Saving…' : 'Save correction'}</Button>
  </form>
}

/**
 * A vital is never edited: EHR appends a correction and the list row keeps the
 * recorded values. Where a correction exists its values are shown as current,
 * and if it cannot be read the recorded values are not passed off as current.
 */
function VitalPanel({ facilityId, patientId, encounterId, vital, canCorrect, disabled, onCorrect }: {
  facilityId: string; patientId: string; encounterId: string; vital: ClinicalRecord
  canCorrect: boolean; disabled: boolean; onCorrect: VitalCorrect
}) {
  const correctionNo = Number(vital.currentCorrectionNo ?? 0)
  const corrected = correctionNo > 0
  const [latest, setLatest] = useState<VitalCorrection | null>(null)
  const [loadError, setLoadError] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!corrected) return
    let active = true
    void staffApi.vitalCorrections(facilityId, patientId, encounterId, vital.id).then(items => {
      if (!active) return
      const current = items.find(item => item.correctionNo === correctionNo)
      if (current) setLatest(current)
      else setLoadError('The current correction was not returned.')
    }).catch(caught => { if (active) setLoadError(errorMessage(caught, 'Corrections could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, patientId, encounterId, vital.id, corrected, correctionNo])
  const current: VitalValues | null = corrected ? latest?.replacementValues ?? null : vital
  return <>
    {!corrected && <p>{vitalSummary(vital)}</p>}
    {corrected && !latest && !loadError && <p role="status">Loading the correction…</p>}
    {latest && <><Detail label={`Corrected (correction ${latest.correctionNo})`} value={vitalSummary(latest.replacementValues)} />
      <Detail label="Reason" value={latest.reason} />
      <Detail label="Corrected at" value={latest.createdAt ? new Date(latest.createdAt).toLocaleString() : ''} /></>}
    {loadError && <p className="staff-error" role="alert">These vitals were corrected, but the correction could not be loaded, so the values below are as first recorded and may not be current. {loadError}</p>}
    {corrected && <Detail label="Originally recorded" value={vitalSummary(vital)} />}
    {canCorrect && current && <>
      <Button tone="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close correction' : 'Correct these vitals'}</Button>
      {open && <VitalCorrectionForm id={`vital-${vital.id}`} current={current} disabled={disabled} onCorrect={onCorrect} />}
    </>}
  </>
}

function NotePanel({ facilityId, patientId, encounterId, note, canWrite, verify, onStatus, onChanged }: {
  facilityId: string; patientId: string; encounterId: string; note: ClinicalRecord; canWrite: boolean
  verify: () => Promise<void>; onStatus: (status: string, reason: string) => Promise<void>; onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [revisions, setRevisions] = useState<NoteRevision[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const submitting = useRef(false)
  const attempt = useRef<{ signature: string; input: { expectedRowVersion: number; changeReason: string; content: string }; key: string } | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setError('')
    void staffApi.noteRevisions(facilityId, patientId, encounterId, note.id)
      .then(value => { if (active) setRevisions(value) })
      .catch(caught => { if (active) setError(errorMessage(caught, 'Note content could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, revision, facilityId, patientId, encounterId, note.id])

  async function addRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !canWrite) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const content = text(form, 'content')
    const changeReason = text(form, 'reason')
    const expectedRowVersion = rowVersion(note.rowVersion)
    if (!expectedRowVersion || !content || changeReason.length < 3) {
      setError('Reload the note, enter content, and give a reason of at least 3 characters.')
      return
    }
    const signature = JSON.stringify([expectedRowVersion, content, changeReason])
    if (attempt.current?.signature !== signature) attempt.current = {
      signature, input: { expectedRowVersion, changeReason, content }, key: crypto.randomUUID(),
    }
    submitting.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await verify()
      await staffApi.addNoteRevision(facilityId, patientId, encounterId, note.id, attempt.current.input, attempt.current.key)
      attempt.current = null
      formElement.reset()
      setNotice('A new note revision was recorded.')
      setRevision(value => value + 1)
      await onChanged()
    } catch (caught) { setError(errorMessage(caught, 'Note revision could not be recorded.')) }
    finally { submitting.current = false; setBusy(false) }
  }

  return <div className="staff-stack">
    <Button tone="secondary" size="sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      {open ? 'Hide note content' : 'Review note content'}
    </Button>
    {open && <>
      <Button tone="quiet" size="sm" onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh revisions</Button>
      {loading && <p role="status">Loading note revisions…</p>}
      {error && <p className="staff-error" role="alert">{error}</p>}
      {notice && <p className="staff-success" role="status">{notice}</p>}
      {!loading && !error && revisions?.length === 0 && <p>No note content is available.</p>}
      {!loading && !error && revisions?.map(item => <div className="staff-list-item" key={item.id}>
        <strong>Revision {item.revisionNo}</strong><p className="staff-note-content">{item.content}</p>
        <p>Recorded {new Date(item.createdAt).toLocaleString()} · {item.changeReason}</p>
      </div>)}
      {!loading && !error && Boolean(revisions?.length) && canWrite && (noteTransitions[String(note.status)]?.length ?? 0) > 0 &&
        <StatusActionForm key={`${note.id}-${note.rowVersion}`} id={`note-${note.id}`} title="Reviewed note status"
          choices={noteTransitions[String(note.status)]!} disabled={busy}
          onChange={onStatus} />}
      {!loading && !error && canWrite && note.status !== 'entered_in_error' &&
        <form className="staff-form" onSubmit={event => void addRevision(event)}>
          <strong>Add a note revision</strong>
          <Field label="Content" htmlFor={`note-revision-content-${note.id}`} required>
            <Textarea id={`note-revision-content-${note.id}`} name="content" maxLength={100000} required />
          </Field>
          <Field label="Reason for revision" htmlFor={`note-revision-reason-${note.id}`} required>
            <Input id={`note-revision-reason-${note.id}`} name="reason" minLength={3} maxLength={500} required />
          </Field>
          <Button type="submit" size="sm" disabled={busy}>{busy ? 'Recording…' : 'Record revision'}</Button>
        </form>}
    </>}
  </div>
}

function Documents({ patientId, encounterId, facilityId, canWrite, canOcr, verify }: { patientId: string; encounterId: string; facilityId: string; canWrite: boolean; canOcr: boolean; verify: () => Promise<void> }) {
  const [items, setItems] = useState<DocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function load() { setLoading(true); setError(''); try { setItems((await staffApi.documents(facilityId, patientId, encounterId)).items) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Documents could not be loaded.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [facilityId, patientId, encounterId])
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    const formElement = event.currentTarget
    const file = new FormData(formElement).get('document')
    if (!(file instanceof File) || !file.size) return setError('Select a file first.')
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'].includes(file.type) || file.size > 52_428_800) return setError('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')
    setBusy(true)
    try { await verify(); await staffApi.uploadDocument(facilityId, patientId, encounterId, file); await load(); formElement.reset() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Document could not be uploaded.') }
    finally { setBusy(false) }
  }
  async function download(id: string) {
    setError('')
    try { await verify(); const result = await staffApi.documentDownload(facilityId, id); window.open(result.url, '_blank', 'noopener,noreferrer') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Document could not be opened.') }
  }
  return <div className="staff-two-col"><Card className="staff-card"><h2>Documents</h2>{loading && <p role="status">Loading documents…</p>}{!loading && items.length === 0 && <p>No documents for this encounter.</p>}<div className="staff-list">{items.map(item => <div className="staff-list-item" key={item.id}><strong>{item.fileName}</strong><p>{item.mediaType} · {Math.ceil(item.sizeBytes / 1024)} KiB · scan: {item.scanStatus}</p><Button tone="secondary" size="sm" onClick={() => void download(item.id)} disabled={item.scanStatus !== 'clean'}>Open file</Button>{canOcr && item.scanStatus === 'clean' && <Link to="/provider/ocr" state={{ ocrDocumentId: item.id, ocrPatientId: patientId }} className="staff-text-link">Extract with OCR</Link>}</div>)}</div></Card>{canWrite && <Card className="staff-card"><h2>Upload a document</h2><p>Files are scanned before download becomes available.</p><form className="staff-form" onSubmit={event => void upload(event)}><Field label="Clinical document" htmlFor="clinical-document"><Input id="clinical-document" name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required /></Field><Button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload document'}</Button></form></Card>}{error && <p role="alert" className="staff-error">{error}</p>}</div>
}

function EmergencySummary({ facilityId, patientId, patientName, verify }: {
  facilityId: string; patientId: string; patientName: string; verify: () => Promise<void>
}) {
  const [summary, setSummary] = useState<EmergencyRecords | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setSummary(null); setLoading(true); setError('')
    void verify().then(() => staffApi.emergencyRecords(facilityId, patientId))
      .then(result => { if (active) setSummary(result) })
      .catch(caught => { if (active) setError(errorMessage(caught, 'Emergency records could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [facilityId, patientId, verify, revision])

  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Emergency record · audited access</p><h1>{patientName}</h1>
      <p>This read-only summary contains completed encounters and signed clinical notes from this facility. The server checks the active emergency grant on each request.</p>
    </div>
    <div className="staff-row staff-toolbar"><Badge tone="danger">Emergency access</Badge>
      <Button tone="secondary" size="sm" onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh summary</Button>
      <Link className="staff-text-link" to="/provider/patients">Change patient →</Link>
    </div>
    {loading && <p role="status">Loading emergency summary…</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {summary && <div className="staff-two-col">
      <Card className="staff-card"><h2>Completed encounters</h2>
        {summary.encounters.length === 0 && <p>No completed encounters are available from this facility.</p>}
        <div className="staff-list">{summary.encounters.map(item => <div className="staff-list-item" key={item.id}>
          <strong>{item.encounterType.replace('_', ' ')}</strong>
          <p>Started {new Date(item.startedAt).toLocaleString()}</p>
          {item.endedAt && <p>Ended {new Date(item.endedAt).toLocaleString()}</p>}
        </div>)}</div>
      </Card>
      <Card className="staff-card"><h2>Signed notes</h2>
        {summary.notes.length === 0 && <p>No signed notes are available from this facility.</p>}
        <div className="staff-list">{summary.notes.map(item => <div className="staff-list-item" key={item.id}>
          <strong>{item.title}</strong>
          <p>{item.noteType} · {item.status} · revision {item.revisionNo}</p>
          <p className="staff-note-content">{item.content}</p>
          {item.signedAt && <p>Signed {new Date(item.signedAt).toLocaleString()}</p>}
        </div>)}</div>
      </Card>
    </div>}
    {summary && (summary.encounters.length >= summary.limit || summary.notes.length >= summary.limit) &&
      <p className="staff-muted">The backend limits each emergency summary section to its {summary.limit} most recent records.</p>}
  </>
}

export function Clinical() {
  const { state, activePatient, setActivePatient } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const permissions = facility?.permissions ?? []
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [encounterPages, setEncounterPages] = useState<PagePosition | null>(null)
  const [encounterNotice, setEncounterNotice] = useState<{ scope: string; text: string } | null>(null)
  const [encounterId, setEncounterId] = useState('')
  const [tab, setTab] = useState<RecordKind | 'documents'>('clinical-notes')
  const [records, setRecords] = useState<ClinicalRecord[]>([])
  const [recordsFor, setRecordsFor] = useState('')
  const [recordPages, setRecordPages] = useState<PagePosition | null>(null)
  const [recordNotice, setRecordNotice] = useState<{ scope: string; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const loadSequence = useRef(0)
  // Every records read takes a number; only the latest may show its rows.
  const recordLoad = useRef(0)
  const patientId = activePatient?.lookup.patient.patientId
  const visibleTabs = tabs.filter(item => permissions.includes(item.permission))
  const activeTab = visibleTabs.some(item => item.id === tab) ? tab : visibleTabs[0]?.id
  const encounterScope = JSON.stringify([facility?.id, patientId])
  const encounterPosition = encounterPages?.scope === encounterScope ? encounterPages : null
  const recordScope = JSON.stringify([facility?.id, patientId, encounterId, activeTab])
  const recordScopeShown = useRef(recordScope)
  useEffect(() => { recordScopeShown.current = recordScope }, [recordScope])
  const recordPosition = recordPages?.scope === recordScope ? recordPages : null
  const visibleRecords = recordsFor === recordScope ? records : []
  const scopedEncounters = encounters.filter(item => item.patientId === patientId && item.facilityId === facility?.id)
  const selectedEncounter = scopedEncounters.find(item => item.id === encounterId)

  const verify = useCallback(async () => {
    if (!facility || !activePatient) throw new Error('Open a patient through governed access first.')
    let result: Awaited<ReturnType<typeof staffApi.lookupPatient>>
    try {
      result = await staffApi.lookupPatient(facility.id, activePatient.hid, activePatient.purpose)
    } catch (caught) {
      // The backend refuses a lookup once access has ended (403) or the patient is
      // unavailable (404); it never answers with a deny decision. The record closes.
      if (isHidApiError(caught) && (caught.status === 403 || caught.status === 404)) {
        setActivePatient(null)
        throw new Error('Patient access has ended. Reopen the record through governed access.')
      }
      throw caught
    }
    if (!isAllowedPatientLookup(result) || result.patient.patientId !== patientId) {
      setActivePatient(null)
      throw new Error('Patient access has ended. Reopen the record through governed access.')
    }
  }, [facility?.id, activePatient?.hid, activePatient?.purpose, patientId])

  // Loads one page of encounters, the first unless told otherwise. The page and
  // its rows change together, once the page has been read; the selection stays
  // on an encounter of the page shown.
  const loadEncounters = useCallback(async (request: { cursors?: Cursors; fresh?: boolean; select?: string } = {}) => {
    if (!facility || !patientId || activePatient?.purpose === 'emergency') return
    const sequence = ++loadSequence.current
    const scope = JSON.stringify([facility.id, patientId])
    setLoading(true); setError('')
    try {
      await verify()
      const { page, cursors, restarted } = await readPage(
        (cursor, fresh) => staffApi.encounters(facility.id, patientId, { cursor, fresh }), request.cursors ?? FIRST_PAGE, request.fresh ?? false)
      if (sequence !== loadSequence.current) return
      setEncounters(page.items)
      setEncounterPages({ scope, cursors, next: page.nextCursor ?? null })
      setEncounterNotice(restarted ? { scope, text: RESTARTED } : null)
      setEncounterId(current => {
        const wanted = request.select ?? current
        return page.items.some(item => item.id === wanted) ? wanted : page.items[0]?.id ?? ''
      })
    } catch (caught) { if (sequence === loadSequence.current) setError(errorMessage(caught, 'Encounters could not be loaded.')) }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [facility?.id, patientId, activePatient?.purpose, verify])

  useEffect(() => {
    setEncounters([]); setEncounterPages(null); setEncounterNotice(null); setEncounterId(''); setRecords([]); setRecordsFor(''); setSuccess('')
    void loadEncounters()
    return () => { loadSequence.current += 1 }
  }, [loadEncounters])
  useEffect(() => {
    if (!facility || !patientId || !selectedEncounter || !activeTab || activeTab === 'documents' || activePatient?.purpose === 'emergency') return
    const sequence = ++recordLoad.current
    const scope = recordScope
    setRecords([]); setRecordsFor(''); setRecordPages(null); setRecordNotice(null); setRecordsLoading(true); setError('')
    void staffApi.records(facility.id, patientId, encounterId, activeTab).then(result => {
      if (sequence !== recordLoad.current) return
      setRecords(result.items); setRecordsFor(scope); setRecordPages({ scope, cursors: FIRST_PAGE, next: result.nextCursor ?? null })
    })
      .catch(caught => { if (sequence === recordLoad.current) setError(caught instanceof Error ? caught.message : 'Records could not be loaded.') })
      .finally(() => { if (sequence === recordLoad.current) setRecordsLoading(false) })
    return () => { recordLoad.current += 1 }
  }, [facility?.id, patientId, encounterId, selectedEncounter?.id, activeTab, activePatient?.purpose, recordScope])

  // What the current grant permits, from the server (POST /identity/consent-status).
  // A patient PIN or a read-only request authorizes reading only; changes stay
  // hidden until the server reports write access, and whenever the check fails.
  const accessScope = JSON.stringify([facility?.id, patientId])
  const [writeAccess, setWriteAccess] = useState<{ scope: string; allowed: boolean; failed: boolean } | null>(null)
  useEffect(() => {
    if (!facility || !patientId || activePatient?.purpose !== 'direct-care') return
    let active = true
    void staffApi.consentStatus(facility.id, patientId)
      .then(status => { if (active) setWriteAccess({ scope: accessScope, allowed: status.writeAllowed === true, failed: false }) })
      .catch(() => { if (active) setWriteAccess({ scope: accessScope, allowed: false, failed: true }) })
    return () => { active = false }
  }, [facility?.id, patientId, activePatient?.purpose, accessScope])
  const currentWriteAccess = writeAccess?.scope === accessScope ? writeAccess : null

  if (!activePatient || !facility) return <><div className="staff-page-head"><p className="staff-eyebrow">Clinical record</p><h1>Choose a patient first.</h1><p>Clinical records require a current backend authorization for the selected facility.</p></div><EmptyState title="No authorized patient" description="Open a patient using an approved request, patient PIN, or documented emergency access." action={<Link className="staff-text-link" to="/provider/patients">Go to patient access →</Link>} /></>
  if (activePatient.purpose === 'emergency') return <EmergencySummary facilityId={facility.id}
    patientId={activePatient.lookup.patient.patientId} patientName={activePatient.lookup.patient.fullName ?? activePatient.hid}
    verify={verify} />
  const selected = selectedEncounter
  const canMutate = activePatient.purpose === 'direct-care' && currentWriteAccess?.allowed === true

  const encounterCursors = encounterPosition?.cursors ?? FIRST_PAGE
  const recordCursors = recordPosition?.cursors ?? FIRST_PAGE

  // A new encounter starts now, so it heads the first page.
  async function createEncounter(input: { encounterType: string; status: string; startedAt: string; chiefComplaint: string }, key: string) {
    if (!facility || !patientId) return
    await verify()
    const result = await staffApi.createEncounter(facility.id, patientId, input, key)
    await loadEncounters({ fresh: true, select: result.id })
    setSuccess('Encounter created by the backend.')
  }

  // Reads a page of the records list shown. A read for a list no longer shown
  // (the clinician moved to another tab or encounter) is not made: it would
  // replace that list's rows. After a change the read is fresh, and a failure
  // keeps the rows and says the change was saved.
  async function loadRecords(kind: RecordKind, cursors: Cursors, afterChange: boolean) {
    if (!facility || !patientId || !encounterId) return
    const scope = JSON.stringify([facility.id, patientId, encounterId, kind])
    if (scope !== recordScopeShown.current) return
    const sequence = ++recordLoad.current
    setRecordsLoading(true)
    if (!afterChange) setError('')
    try {
      const { page, cursors: shown, restarted } = await readPage(
        (cursor, fresh) => staffApi.records(facility.id, patientId, encounterId, kind, { cursor, fresh }), cursors, afterChange)
      if (sequence !== recordLoad.current) return
      setRecords(page.items); setRecordsFor(scope); setRecordPages({ scope, cursors: shown, next: page.nextCursor ?? null })
      setRecordNotice(restarted ? { scope, text: RESTARTED } : null)
    } catch (caught) {
      if (sequence !== recordLoad.current) return
      setError(afterChange ? `The change was saved, but the records could not be reloaded. ${errorMessage(caught, '')}`.trim()
        : errorMessage(caught, 'Records could not be loaded.'))
    } finally { if (sequence === recordLoad.current) setRecordsLoading(false) }
  }

  // A new record is the newest, so it heads the first page.
  async function createRecord(kind: RecordKind, body: object, key: string) {
    if (!facility || !patientId || !encounterId) return
    if (!canMutate) throw new Error('This access does not permit changes to the patient record.')
    setSuccess('')
    await verify()
    await staffApi.createRecord(facility.id, patientId, encounterId, kind, body, key)
    setSuccess(kind === 'lab-requests' && 'status' in body && body.status === 'active'
      ? 'Active lab request created and accepted by Lab.' : 'Clinical record saved by the backend.')
    await loadRecords(kind, FIRST_PAGE, true)
  }

  async function changeEncounterStatus(status: string, reason: string) {
    if (!selected || !facility || !patientId || !canMutate) return
    const expectedRowVersion = rowVersion(selected.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the encounter before changing its status.')
    setSuccess('')
    await verify()
    await staffApi.updateEncounter(facility.id, patientId, selected.id, {
      expectedRowVersion, changeReason: reason, status,
      ...(status === 'completed' ? { endedAt: isoNow() } : {}),
    })
    await loadEncounters({ cursors: encounterCursors, fresh: true })
    setSuccess('Encounter status updated.')
  }

  async function changeRecordStatus(record: ClinicalRecord, kind: StatusRecordKind, status: string, reason: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the record before changing its status.')
    setSuccess('')
    await verify()
    await staffApi.updateRecord(facility.id, patientId, encounterId, kind, record.id,
      { expectedRowVersion, changeReason: reason, status })
    setSuccess(kind === 'clinical-notes' ? 'Clinical note status updated.'
      : kind === 'lab-requests' ? 'Lab request status updated.' : 'Prescription status updated.')
    await loadRecords(kind, recordCursors, true)
  }

  async function updateDiagnosis(record: ClinicalRecord, changes: DiagnosisChanges, reason: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the diagnosis before changing it.')
    setSuccess('')
    await verify()
    await staffApi.updateDiagnosis(facility.id, patientId, encounterId, record.id,
      { expectedRowVersion, changeReason: reason, ...changes })
    setSuccess('Diagnosis updated.')
    await loadRecords('diagnoses', recordCursors, true)
  }

  async function correctVital(record: ClinicalRecord, replacementValues: VitalMeasurements, reason: string, key: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the vitals before correcting them.')
    setSuccess('')
    await verify()
    await staffApi.correctVital(facility.id, patientId, encounterId, record.id,
      { expectedRowVersion, changeReason: reason, replacementValues }, key)
    setSuccess('Vital correction saved.')
    await loadRecords('vitals', recordCursors, true)
  }

  async function handoffPrescription(record: ClinicalRecord, reason: string, key: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the prescription before sending it to Pharmacy.')
    setSuccess('')
    await verify()
    await staffApi.acceptPrescription(facility.id, patientId, encounterId, record.id, expectedRowVersion, reason, key)
    setSuccess('Pharmacy accepted this exact prescription version.')
  }

  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Clinical record · {facility.name}</p><h1>{activePatient.lookup.patient.fullName ?? activePatient.hid}</h1><p>HID {activePatient.hid} · Direct care access. The server rechecks authorization before changes.</p></div>
    <div className="staff-row staff-toolbar"><Badge tone="success">Authorized</Badge><Button tone="secondary" size="sm" onClick={() => void loadEncounters({ cursors: encounterCursors, fresh: true })} disabled={loading}>Refresh encounters</Button><Link className="staff-text-link" to="/provider/patients">Change patient →</Link></div>
    {currentWriteAccess && !currentWriteAccess.allowed && <div className="staff-notice" role="status">{currentWriteAccess.failed
      ? 'Write access could not be confirmed, so changes are unavailable. Refresh the page to try again.'
      : 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'}</div>}
    {error && <p className="staff-error" role="alert">{error}</p>}{success && <p className="staff-success" role="status">{success}</p>}
    <div className="staff-two-col staff-encounter-grid"><Card className="staff-card"><h2>Encounters</h2>{loading && <p role="status">Loading encounters…</p>}{!loading && scopedEncounters.length === 0 && <p>No encounters are available for this patient and facility.</p>}<div className="staff-list">{scopedEncounters.map(item => <button type="button" key={item.id} className={`staff-list-item staff-select-row${item.id === encounterId ? ' selected' : ''}`} onClick={() => setEncounterId(item.id)}><strong>{item.encounterType.replace('_', ' ')} · {item.status.replace('_', ' ')}</strong><p>{new Date(item.startedAt).toLocaleString()}</p><p>{item.chiefComplaint || 'No chief complaint provided'}</p></button>)}</div>
      {encounterNotice?.scope === encounterScope && <p className="staff-notice" role="status">{encounterNotice.text}</p>}
      <Pager label="Encounter pages" position={encounterPosition} disabled={loading} onShow={cursors => void loadEncounters({ cursors })} /></Card>{permissions.includes('ehr.encounter.write') && canMutate && <EncounterForm onCreated={createEncounter} disabled={!facility} />}</div>
    {selected && <section className="staff-section"><div className="staff-page-head"><p className="staff-eyebrow">Selected encounter</p><h1>Care documentation</h1><p>{new Date(selected.startedAt).toLocaleString()} · {selected.status.replace('_', ' ')}</p></div><div className="staff-tabs" role="tablist" aria-label="Clinical record section">{visibleTabs.map(item => <button role="tab" aria-selected={activeTab === item.id} type="button" key={item.id} className={activeTab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
      {canMutate && permissions.includes('ehr.encounter.write') && (encounterTransitions[selected.status]?.length ?? 0) > 0 &&
        <Card className="staff-card"><StatusActionForm key={`${selected.id}-${selected.rowVersion}`} id={`encounter-${selected.id}`} title="Encounter status"
          choices={encounterTransitions[selected.status]!} disabled={loading} onChange={changeEncounterStatus} /></Card>}
      {!activeTab ? <p className="staff-muted">Your current facility role does not grant access to encounter records.</p>
        : activeTab === 'documents' ? <Documents key={selected.id} patientId={patientId!} encounterId={selected.id} facilityId={facility.id} canWrite={canMutate && permissions.includes(writePermissions.documents)} canOcr={permissions.includes('ocr.job.read')} verify={verify} /> : <div className="staff-two-col"><Card className="staff-card"><h2>{tabs.find(item => item.id === activeTab)?.label}</h2>{recordsLoading && <p role="status">Loading records…</p>}{!recordsLoading && visibleRecords.length === 0 && <p>No {tabs.find(item => item.id === activeTab)?.label.toLowerCase()} for this encounter.</p>}<div className="staff-list">{visibleRecords.map(record => <div className="staff-list-item staff-stack" key={record.id}><strong>{recordTitle(activeTab, record)}</strong>
        {activeTab === 'diagnoses' && record.verificationStatus === 'entered_in_error' && <Badge tone="warning">Entered in error</Badge>}
        {activeTab === 'vitals' ? <VitalPanel key={`${record.id}-${String(record.rowVersion)}`} facilityId={facility.id} patientId={patientId!} encounterId={selected.id}
          vital={record} canCorrect={canMutate && permissions.includes('ehr.vital.write')} disabled={recordsLoading}
          onCorrect={(values, reason, key) => correctVital(record, values, reason, key)} /> : <p>{recordDetail(activeTab, record)}</p>}
        <Detail label="Recorded" value={record.createdAt ? new Date(record.createdAt).toLocaleString() : ''} />
        {activeTab === 'clinical-notes' && <NotePanel facilityId={facility.id} patientId={patientId!} encounterId={selected.id}
          note={record} canWrite={canMutate && permissions.includes('ehr.note.write')} verify={verify}
          onStatus={(status, reason) => changeRecordStatus(record, 'clinical-notes', status, reason)}
          onChanged={() => loadRecords('clinical-notes', recordCursors, true)} />}
        {activeTab === 'prescriptions' && canMutate && permissions.includes('ehr.prescription.write') && (prescriptionTransitions[String(record.status)]?.length ?? 0) > 0 &&
          <StatusActionForm key={`${record.id}-${record.rowVersion}`} id={`prescription-${record.id}`} title="Prescription status" choices={prescriptionTransitions[String(record.status)]!}
            disabled={recordsLoading} onChange={(status, reason) => changeRecordStatus(record, 'prescriptions', status, reason)} />}
        {activeTab === 'prescriptions' && record.status === 'active' && canMutate && permissions.includes('pharmacy.work-item.accept') &&
          <ReasonActionForm key={`${record.id}-${record.rowVersion}`} id={`handoff-${record.id}`} title="Send active prescription to Pharmacy" actionLabel="Send to Pharmacy"
            minLength={8} disabled={recordsLoading} onAction={(reason, key) => handoffPrescription(record, reason, key)} />}
        {activeTab === 'diagnoses' && canMutate && permissions.includes('ehr.diagnosis.write') && record.verificationStatus !== 'entered_in_error' &&
          <DiagnosisUpdateForm key={`${record.id}-${String(record.rowVersion)}`} id={`diagnosis-${record.id}`} diagnosis={record}
            disabled={recordsLoading} onUpdate={(changes, reason) => updateDiagnosis(record, changes, reason)} />}
        {activeTab === 'lab-requests' && canMutate && permissions.includes('ehr.lab-request.write') && (labRequestTransitions[String(record.status)]?.length ?? 0) > 0 &&
          <StatusActionForm key={`${record.id}-${String(record.rowVersion)}`} id={`lab-request-${record.id}`} title="Lab request status" choices={labRequestTransitions[String(record.status)]!}
            disabled={recordsLoading} onChange={(status, reason) => changeRecordStatus(record, 'lab-requests', status, reason)} />}
        {activeTab === 'lab-requests' && canMutate && permissions.includes('ehr.lab-request.write') && (record.status === 'active' || record.status === 'on_hold') &&
          <p className="staff-muted">Lab may already be working on this request. Status changes made here are not passed to Lab, so none are offered; contact the laboratory to stop or correct it.</p>}
      </div>)}</div>
        {recordNotice?.scope === recordScope && <p className="staff-notice" role="status">{recordNotice.text}</p>}
        <Pager label="Record pages" position={recordPosition} disabled={recordsLoading} onShow={cursors => void loadRecords(activeTab, cursors, false)} /></Card>{canMutate && permissions.includes(writePermissions[activeTab]) && <RecordForm key={activeTab} tab={activeTab} onCreated={createRecord} disabled={!selected} />}</div>}
    </section>}
  </>
}
