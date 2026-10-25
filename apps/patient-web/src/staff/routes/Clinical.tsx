import { StaffPatientChat } from './StaffPatientChat'
import { usesNovuBackend } from '../../backendContract'
import { ImportedPatientHistory } from './ImportedPatientHistory'
import { StaffImportedHistory } from './StaffImportedHistory'
import { importedRecordsEnabled, staffPatientChatEnabled } from '../stagingOnlyFeatures'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { assertSignedStorageUrl, isHidApiError } from '@hid/http'
import { Badge, Button, Card, EmptyState, Field, Input, Select, TabList, TabPanel, Textarea } from '@hid/ui'
import { isAllowedPatientLookup, orderRoutesApi, staffApi, type ClinicalRecord, type DiagnosisUpdate, type DocumentRecord, type EmergencyRecords, type EmergencySection, type Encounter, type LabHandoff, type LabOrderReleasedResults, type NoteRevision, type OrderDestination, type OrderRouteKind, type OrderRouteSummary, type OrderRouteWithdrawReason, type Page, type RecordKind, type SavedRecord, type StatusRecordKind, type VitalCorrection, type VitalMeasurement, type VitalMeasurements } from '../api'
import { useStaff } from '../App'
import { getEnvironment } from '../env'
import { refusalText, refusedFields } from '../fieldProblem'
import { BUSY, QUIET_UNAVAILABLE, UNAVAILABLE, useFocusById } from '../focus'
import { GroupError, useFieldProblems } from '../useFieldProblems'
import { staffSessionGeneration, untilStaffSessionReady } from '../session'
import { RevisionList, skipsVersions } from '../labRevisions'
import { routedElsewhere, sendRefusal, withdrawRefusal } from '../orderRoutes'
import { choiceProblem, NO_DESTINATION, OrderDestinationFields, OrderRoutePanel, savedNotSent, SendToFacility, type DestinationChoice,
  type RouteContext } from './OrderRoutes'

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
// Since hid-system #64 (CLIN-EIE, migration 0084) EHR closes an encounter's records
// in the same change (encounters.service.ts CLOSE_STEPS): cancelling cancels its
// draft, active and on-hold prescriptions and lab requests and keeps everything else.
// Since hid-system #74 (ENC-RETRACT-2, migration 0090) entered in error marks its
// notes, its diagnoses, its final vitals, its draft, active, on-hold and completed
// orders, and its initiated or uploaded documents entered in error. Neither Pharmacy
// nor Lab is told. Every encounter status form offers Cancel and Mark entered in
// error, and any encounter may hold these records.
const MAIN_ENCOUNTER_CLOSES_RECORDS = 'Cancelling this encounter also cancels its draft, active and on-hold prescriptions and lab requests; its notes, diagnoses, vitals, documents and completed orders are not changed. Marking it entered in error also marks entered in error its notes, diagnoses and vitals, its documents (other than rejected uploads), and its prescriptions and lab requests that are not cancelled, completed ones included. Pharmacy and the Laboratory are not told: contact the pharmacy or laboratory about any order sent to them.'
/**
 * Novu (the production backend) has no such cascade (P4c map MO §0 item 11): closing or cancelling an encounter leaves
 * its orders as they are, each changed on its own, and an order sent to another facility follows its change there.
 */
const NOVU_ENCOUNTER_CLOSES_RECORDS = 'Closing or cancelling the encounter does not change its lab requests or prescriptions. Change or cancel each one: one sent to another facility is then withdrawn there, or cancelled if that facility had accepted it.'
function encounterClosesRecords() { return usesNovuBackend() ? NOVU_ENCOUNTER_CLOSES_RECORDS : MAIN_ENCOUNTER_CLOSES_RECORDS }
/**
 * Since hid-system #74 (ENC-RETRACT-1) a close that would change a kind of record the actor
 * may not write is refused, with nothing written, as 403 ENCOUNTER_RETRACTION_NOT_PERMITTED.
 * Its fixed detail names no kind, so as not to tell a role which records it holds; nor does this.
 */
function retractionNotPermitted(status: string) {
  return `You may not ${status === 'cancelled' ? 'cancel this encounter' : 'mark this encounter entered in error'}: it holds records that this change would also change, and your role may not change all of them. Nothing was changed. Ask a colleague whose role may change all of its records (usually a doctor or clinician) to make this change.`
}
// The statuses whose change also changes the encounter's records (above).
const CLOSING_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'entered_in_error'])
const prescriptionTransitions: Readonly<Record<string, readonly StatusOption[]>> = {
  draft: [{ value: 'active', label: 'Activate' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
  active: [{ value: 'on_hold', label: 'Put on hold' }, { value: 'completed', label: 'Complete' },
    { value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  on_hold: [{ value: 'active', label: 'Resume' }, { value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }],
}
// EHR passes no change to a prescription on to Pharmacy. Since hid-system #48
// (migration 0080) Pharmacy dispenses only while the prescription is still active at
// the version it accepted, so a change ends that, a later resume included (the
// proposed default of hid-system's open decision D10), and the remedy is a new
// prescription; a dispensing already recorded stands. A Pharmacy before 0080 still
// dispenses a cancelled prescription, and no response tells the two apart, so the
// warning says only what holds for both: the pharmacy must be told. Only an active
// prescription can be sent, so one active or on hold may have been: the clinician is
// told so where its change is confirmed. A draft never reached Pharmacy.
const PHARMACY_NOT_TOLD = 'Pharmacy is not told of this change, so if this prescription was sent to Pharmacy you must contact the pharmacy. A dispensing already recorded is not undone. Pharmacy may refuse to dispense the version it was sent once the prescription has been put on hold, completed, cancelled or marked entered in error, even after it is resumed: if treatment is to continue and the pharmacy cannot dispense it, create a new prescription and send it.'
/**
 * An order sent to another facility (Novu, P4c): its change is passed on there (the EHR's mirror trigger), withdrawing
 * it before that facility accepts it, or cancelling it there after, so the warning says so instead.
 */
function routedChangeWarning(facility: string | null | undefined) {
  const name = facility?.trim() || 'the other facility'
  return `Changing it withdraws it from ${name}, or cancels it there if ${name} has accepted it; a cancelled order can’t be resumed there.`
}
/** The changes offered for a lab request sent to another facility: every change is passed on there. */
const ROUTED_LAB_CHOICES: Readonly<Record<string, readonly StatusOption[]>> = {
  active: [{ value: 'on_hold', label: 'Put on hold' }, { value: 'completed', label: 'Complete' },
    { value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  // Resuming would leave it active with no laboratory to do it: this facility's Lab may not take it.
  on_hold: [{ value: 'cancelled', label: 'Cancel' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
}
const noteTransitions: Readonly<Record<string, readonly StatusOption[]>> = {
  draft: [{ value: 'signed', label: 'Sign note' }, { value: 'entered_in_error', label: 'Mark entered in error' }],
  signed: [{ value: 'entered_in_error', label: 'Mark entered in error' }],
  amended: [{ value: 'entered_in_error', label: 'Mark entered in error' }],
}
/**
 * A lab request's status changes. Since hid-system #56 EHR sends a request to Lab
 * whenever a change leaves it active: activating a draft, resuming a held request
 * (lab-requests.service.ts update). It sends it only for an actor who holds
 * lab.work-item.accept; for anyone else it makes the change without sending it,
 * leaving an active request that role can neither send nor cancel, so neither is
 * offered to such a role (LAB_SENT_BY_OTHERS says who can). An EHR before #56
 * sends nothing to Lab on a status change: what "and send to Lab" promises is
 * then corrected by what the change says once made (labHandoffOutcome, no
 * handoff), that Lab was not asked or not told. Holding, completing,
 * cancelling or marking entered in error a request Lab may hold is not passed to
 * Lab, which keeps working on the version it accepted, so none is offered for an
 * active or held request; a draft, which Lab never received, may be cancelled or
 * marked entered in error.
 */
function labRequestChoices(status: string, canSend: boolean): readonly StatusOption[] {
  const activate = (label: string): readonly StatusOption[] => canSend ? [{ value: 'active', label }] : []
  // Sending an order is never the choice made by default: it is chosen deliberately.
  if (status === 'draft') return [{ value: 'cancelled', label: 'Cancel' },
    { value: 'entered_in_error', label: 'Mark entered in error' }, ...activate('Activate and send to Lab')]
  if (status === 'on_hold') return activate('Resume and send to Lab')
  return []
}

/**
 * What is said under a lab request to a role without lab.work-item.accept, about what only another
 * role can do. It is the portal's rule, not the EHR's effect: an EHR before #56 sends nothing to Lab
 * when a request is activated or resumed, and has no Send to Lab, so the laboratory is named too.
 */
const LAB_SENT_BY_OTHERS: Readonly<Record<string, string>> = {
  draft: 'Only someone who may send requests to Lab can activate this draft.',
  on_hold: 'Only someone who may send requests to Lab can resume this request.',
  active: 'If the Laboratory may not have this request, ask someone who may send requests to Lab to use Send to Lab on it, or contact the laboratory.',
}

/** What is said under an active or held lab request about the changes not offered. */
const LAB_NOT_TOLD: Readonly<Record<string, string>> = {
  active: 'Lab may already be working on this request. Holding, cancelling, completing or marking it entered in error is not passed to Lab, which keeps working on the version it accepted, so none of these is offered here; contact the laboratory to stop or correct it.',
  on_hold: 'Putting this request on hold was not passed to Lab, which may still be working on the version it accepted. Cancelling it or marking it entered in error would not be passed to Lab either, so neither is offered here; contact the laboratory to stop or correct it.',
}

/**
 * Lab's statuses that are its verdict on the request or the caller, as EHR tells them apart
 * (lab-requests.service.ts LAB_REFUSALS): invalid, not allowed, or in conflict with what Lab holds.
 * Any other (401, another 4xx, 5xx, Lab unreachable) says nothing about the request.
 */
const LAB_REFUSALS: ReadonlySet<number> = new Set([400, 403, 409])

/** A code from Lab as EHR reports it (lab-requests.service.ts LAB_CODE), or nothing. */
function labCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined
}

/**
 * The saved request, and Lab's code, that a create's 409 LAB_HANDOFF_REFUSED names
 * in its detail (lab-requests.service.ts handoffProblem). A 502's detail is hidden
 * by EHR, so it names neither. Neither is ever shown: the ID is only where focus goes.
 */
function handoffNames(message: string) {
  const named = /Lab request ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) is saved and active in the EHR, but Lab refused it \(([A-Z][A-Z0-9_]{0,63})\)/i.exec(message)
  return { requestId: named?.[1], code: named?.[2] }
}

/** Where a saved request is sent from: this role's Send to Lab, or someone else's. */
function sendItFrom(canSend: boolean) {
  return canSend ? 'use Send to Lab on the request' : 'someone who may send requests to Lab must use Send to Lab on the request'
}

/**
 * What a lab request warning says, and where the work continues: `sendable` when
 * Send to Lab can still help (not when Lab holds an earlier version, the role may
 * not send, or the EHR cannot send), `listChanged` when the request changed under
 * the change, so the list read again shows it differently.
 */
interface LabOutcome { readonly text: string; readonly accepted: boolean; readonly sendable?: boolean; readonly listChanged?: boolean }

/**
 * What an active lab request's save says about Lab (hid-system #56 labHandoff).
 * `done` is the change made ("created", "activated", "resumed"); only Lab's
 * acceptance is a plain success. An EHR before #56 reports no handoff after a
 * status change, and sent nothing to Lab, which is said as Lab not being asked.
 * It sent a request to Lab only when the request was created active, so for a
 * resumption Lab may hold the version it accepted then, or never have received
 * it (activated from a draft, or refused by Lab at creation, it stayed active):
 * the laboratory is to be asked either way.
 */
function labHandoffOutcome(handoff: LabHandoff | null, done: string, canSend: boolean): LabOutcome {
  switch (handoff?.state) {
    case 'accepted':
      return { accepted: true, text: `Lab request ${done} and accepted by Lab.` }
    case 'already_accepted':
      return { accepted: false, sendable: false, text: `Lab request ${done} in the EHR, but Lab holds an earlier version of it, so this change is not in Lab. Contact the laboratory.` }
    case 'failed': {
      if (handoff.code === 'LAB_ORDER_NOT_CURRENT') return { accepted: false, sendable: true, listChanged: true,
        text: `Lab request ${done} in the EHR, but it changed again before Lab accepted it, and Lab may hold that later version: check the request, and if it is still needed, ${sendItFrom(canSend)}.` }
      // As a create's 409 LAB_HANDOFF_REFUSED or 502 LAB_HANDOFF_UNCONFIRMED, by Lab's status. Lab
      // checks the caller before what it holds, so a refusal does not say Lab lacks the request.
      const code = labCode(handoff.code)
      const named = code ? ` (${code})` : ''
      return { accepted: false, sendable: true, text: LAB_REFUSALS.has(handoff.status)
        ? `Lab request ${done} in the EHR: its status is saved, but Lab refused it${named}. Once that is resolved, ${sendItFrom(canSend)}.`
        : `Lab request ${done} in the EHR: its status is saved, but Lab did not confirm it${named}, so the Laboratory may not have it: to send it again, ${sendItFrom(canSend)}.` }
    }
    case 'not_sent':
      // Novu since P4c: a request sent to another facility is never handed to this facility's Lab.
      if (handoff.code === 'ORDER_ROUTED') return { accepted: true, text: `Lab request ${done}. It was sent to another facility, so it was not sent to this facility’s Lab.` }
      return { accepted: false, sendable: false, text: `Lab request ${done} in the EHR, not sent to Lab: your role cannot send requests to Lab. Someone who may send requests to Lab must use Send to Lab on it.` }
    default:
      return { accepted: false, sendable: false, text: done === 'resumed'
        ? 'Lab request resumed in the EHR, but Lab was not told of the resumption: it may hold the version it accepted before the hold, or may never have received this request. Contact the laboratory to confirm the test is ordered.'
        : `Lab request ${done} in the EHR; Lab was not asked to accept it, so the Laboratory does not have it. Contact the laboratory to order the test.` }
  }
}

/** A Send to Lab that did not reach Lab's acceptance: what to say, and whether the list changed under it. */
interface LabSendRefusal { readonly text: string; readonly reload?: boolean; readonly retry?: boolean; readonly sendable?: boolean }

/**
 * What a records read after a change came to: the rows read, 'failed' (the read
 * failed), or null when no read for the list shown was made or kept (another
 * read, or another list, replaced it), which is not a failure.
 */
type Reload = ClinicalRecord[] | 'failed' | null

/**
 * The sentence a warning after a change ends with about the list read again: that
 * it could not be read, or, when the record changed under the change, that it was.
 */
function reloadSentence(reload: Reload, what: string, listChanged: boolean) {
  if (reload === 'failed') return ` The list could not be reloaded; refresh it to see the ${what}.`
  return Array.isArray(reload) && listChanged ? ' The list was reloaded.' : ''
}

/**
 * What a refused POST .../lab-work-item means (lab-requests.service.ts sendToLab).
 * Its problem details are not shown: Lab's pass through as Lab wrote them, and a
 * handoff problem names the request.
 */
function labSendRefusal(caught: unknown): LabSendRefusal {
  if (!isHidApiError(caught)) return { retry: true, text: refusalText(caught, 'The lab request could not be sent to Lab. Send it again.') }
  if (caught.status === 412 || caught.code === 'LAB_ORDER_NOT_CURRENT') return { reload: true, sendable: true,
    text: 'This lab request changed since it was loaded, so it was not sent to Lab: check the request, and send it again if it is still needed.' }
  if (caught.code === 'LAB_REQUEST_NOT_ELIGIBLE') return { reload: true,
    text: 'This lab request is no longer active, so it was not sent to Lab.' }
  if (caught.code === 'LAB_ORDER_ALREADY_ACCEPTED') return {
    text: 'Lab already holds an earlier version of this request, so this version was not sent and its changes are not in Lab. Contact the laboratory.' }
  if (caught.code === 'LAB_ACCESS_DENIED') return { text: 'Lab does not allow you to accept this order for this patient.' }
  // Novu since P4c: the request is sent to (or was accepted by) a laboratory at another facility.
  if (caught.code === 'LAB_REQUEST_ROUTED') return { reload: true, sendable: false,
    text: 'This lab request was sent to a laboratory at another facility, so this facility’s Lab can’t take it.' }
  if (caught.status === 502 || caught.code === 'LAB_HANDOFF_UNCONFIRMED') return { retry: true,
    text: 'Lab did not confirm that it accepted this request, so the Laboratory may not have it: send again.' }
  if (caught.status === 0 || caught.status === 408 || caught.status >= 500) return { retry: true,
    text: `${refusalText(caught, 'The service did not answer.')} The request may not have reached Lab: send it again.` }
  if (caught.status === 404) return { reload: true, sendable: false,
    text: 'The EHR did not find this lab request to send, or cannot send a saved request to Lab. Contact the laboratory if the test is still needed.' }
  if (caught.status === 401) return { text: refusalText(caught, 'Sign in again to send this request to Lab.') }
  const code = labCode(caught.code)
  return { text: `This lab request was not sent to Lab: it was refused${code ? ` (${code})` : ''}. Contact the laboratory if the test is still needed.` }
}

class LabSendError extends Error {
  constructor(message: string, readonly retry: boolean) { super(message) }
}

/**
 * Sends a saved active request to Lab, or sends it again. One key per attempt:
 * pressed again after Lab did not answer, it is the same send; after any other
 * outcome the next press is a new attempt. The control is rebuilt for each
 * version of the request, which is a new attempt too.
 */
function SendToLab({ requestId, disabled, onSend }: { requestId: string; disabled: boolean; onSend: (key: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const attempt = useRef<string | null>(null)
  async function send() {
    if (sending.current || disabled) return
    attempt.current ??= crypto.randomUUID()
    sending.current = true; setBusy(true); setError('')
    try { await onSend(attempt.current); attempt.current = null }
    catch (caught) {
      const retry = caught instanceof LabSendError ? caught.retry : true
      if (!retry) attempt.current = null
      setError(caught instanceof Error ? caught.message : 'The lab request could not be sent to Lab.')
    } finally { sending.current = false; setBusy(false) }
  }
  return <div className="staff-stack">
    <p className="staff-muted" id={`lab-request-${requestId}-send-hint`}>Sends this active request to Lab if Lab does not have it yet. Lab keeps one work item per request, so sending again changes nothing Lab already holds.</p>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button id={`lab-request-${requestId}-send`} tone="secondary" size="sm" aria-disabled={busy || disabled || undefined} className={UNAVAILABLE}
      aria-describedby={`lab-request-${requestId}-send-hint`} onClick={() => void send()}>{busy ? 'Sending…' : 'Send to Lab'}</Button>
  </div>
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
async function readPage<P extends Page<unknown>>(read: (cursor: string | undefined, fresh: boolean) => Promise<P>, cursors: Cursors, fresh: boolean) {
  try { return { page: await read(cursors.at(-1), fresh), cursors, restarted: false } }
  catch (caught) {
    if (cursors.length < 2 || !isHidApiError(caught) || caught.code !== 'INVALID_CURSOR') throw caught
    return { page: await read(undefined, true), cursors: FIRST_PAGE, restarted: true }
  }
}

type ListNotice = { readonly scope: string; readonly text: string; readonly alert: boolean }

function Notice({ notice, scope }: { notice: ListNotice | null; scope: string }) {
  if (notice?.scope !== scope) return null
  return <p className={notice.alert ? 'staff-error' : 'staff-notice'} role={notice.alert ? 'alert' : 'status'}>{notice.text}</p>
}

/**
 * The reference design's record pages, above the list and shown only when there
 * is more than one page. A button that cannot act is marked unavailable rather
 * than disabled, so the one just pressed keeps focus while its page loads and at
 * either end; the page reached is announced.
 */
function Pager({ label, position, busy, onShow }: {
  label: string; position: PagePosition | null; busy: boolean; onShow: (cursors: Cursors) => void
}) {
  if (!position || (position.cursors.length < 2 && !position.next)) return null
  const { cursors, next } = position
  const previousOff = busy || cursors.length < 2
  const nextOff = busy || !next
  return <nav className="staff-row" aria-label={label}>
    <Button tone="secondary" size="sm" aria-disabled={previousOff} className={UNAVAILABLE}
      onClick={() => { if (!previousOff) onShow(cursors.slice(0, -1)) }}>Previous page</Button>
    <span className="staff-muted" role="status">{`Page ${cursors.length}`}</span>
    <Button tone="secondary" size="sm" aria-disabled={nextOff} className={UNAVAILABLE}
      onClick={() => { if (!nextOff && next) onShow([...cursors, next]) }}>Next page</Button>
  </nav>
}

/**
 * An order's `orderRoute` as the EHR lists it (Novu, P4c): a route summary, null for none, or undefined when the EHR
 * sent no field (main, a Novu before P4c, or routes not read). A value of another shape is read as not sent.
 */
function readOrderRoute(value: unknown): OrderRouteSummary | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object' || value === undefined) return undefined
  const route = value as Partial<OrderRouteSummary>
  if (typeof route.id !== 'string' || typeof route.effectiveState !== 'string' || typeof route.receivingFacility !== 'object'
    || route.receivingFacility === null) return undefined
  return route as OrderRouteSummary
}

function rowVersion(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}

/** A file size as EHR sends it, a number or text (pg returns bigint and ::text columns as strings), in KiB. */
function fileSize(value: number | string | null | undefined): string {
  const count = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(count) && count >= 0 ? `${Math.ceil(count / 1024).toLocaleString()} KiB` : 'Size unavailable'
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === '') return null
  return <div className="staff-detail"><span>{label}: </span><strong>{value}</strong></div>
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
    catch (caught) { setError(refusalText(caught, 'Encounter could not be created.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <Card className="staff-card"><h2>Start encounter</h2><p>Creating a clinical encounter requires current server authorization and a documented reason for care.</p><form className="staff-form" onSubmit={event => void submit(event)}><Field label="Encounter type" htmlFor="encounter-type" required><Select id="encounter-type" name="encounterType" required><option value="ambulatory">Outpatient</option><option value="emergency">Emergency</option><option value="inpatient">Inpatient</option><option value="virtual">Virtual</option><option value="home">Home</option><option value="other">Other</option></Select></Field><Field label="Chief complaint" htmlFor="chief-complaint" required><Textarea id="chief-complaint" name="chiefComplaint" maxLength={4000} required /></Field>{error && <p className="staff-error" role="alert">{error}</p>}<Button type="submit" aria-disabled={busy || disabled || undefined} className={BUSY}>{busy ? 'Creating…' : 'Start encounter'}</Button></form></Card>
}

/** A value refused before sending, at a control (or group) to tie it to and the control to focus. */
class FieldRefusal extends Error {
  constructor(readonly field: string, message: string, readonly focusId: string = field) { super(message) }
}

/** A lab request created and sent at once to a laboratory at another facility (Novu, P4c): what the send needs. */
export interface CreateAndSend { destination: OrderDestination; attestationTextVersion: string }

function RecordForm({ tab, onCreated, disabled, canSendToLab, routing, onCreateAndSend, prescriptionRouting = false }: {
  tab: RecordKind; onCreated: (kind: RecordKind, body: object, key: string) => Promise<void>; disabled: boolean; canSendToLab: boolean
  /** Novu since P4c, for a lab request when this member may send it to another facility now. */
  routing?: RouteContext | null
  onCreateAndSend?: (body: object, key: string, send: CreateAndSend) => Promise<void>
  /** Novu since P4c: this member may send a saved prescription to a pharmacy at another facility now. */
  prescriptionRouting?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const submitting = useRef(false)
  const attempt = useRef<{ signature: string; body: object; key: string } | null>(null)
  // How the lab request is handled: kept here so another laboratory's fields show only when chosen.
  const [handling, setHandling] = useState('draft')
  const [priority, setPriority] = useState('routine')
  const [choice, setChoice] = useState<DestinationChoice>(NO_DESTINATION)
  const [routeErrors, setRouteErrors] = useState<{ destination?: string; attested?: string }>({})
  const routable = tab === 'lab-requests' && Boolean(routing && onCreateAndSend)
  const sendingElsewhere = routable && handling === 'route'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    submitting.current = true; setError(''); problems.clear(); setRouteErrors({}); setBusy(true)
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    try {
      let body: object
      if (tab === 'clinical-notes') body = { noteType: text(form, 'noteType'), title: text(form, 'title'), status: 'draft', content: text(form, 'content') }
      else if (tab === 'vitals') {
        const measurements = Object.fromEntries(['heightCm', 'weightKg', 'temperatureC', 'pulseBpm', 'respiratoryRate', 'systolicMmhg', 'diastolicMmhg', 'oxygenSaturationPercent']
          .map(name => [name, number(form, name)] as const).filter(([, value]) => value !== undefined))
        if (Object.keys(measurements).length === 0) throw new FieldRefusal('vital-values', 'Enter at least one vital measurement.', 'vital-systolicMmhg')
        // EHR refuses one blood pressure reading without the other (400 BLOOD_PRESSURE_INCOMPLETE).
        if (('systolicMmhg' in measurements) !== ('diastolicMmhg' in measurements)) {
          throw new FieldRefusal('systolicMmhg' in measurements ? 'vital-diastolicMmhg' : 'vital-systolicMmhg', 'Enter both systolic and diastolic blood pressure, or leave both blank.')
        }
        body = { recordedAt: isoNow(), source: 'manual', ...measurements }
      } else if (tab === 'diagnoses') body = { codeSystem: text(form, 'codeSystem'), code: text(form, 'code'), display: text(form, 'display'), clinicalStatus: text(form, 'clinicalStatus'), verificationStatus: text(form, 'verificationStatus'), notes: text(form, 'notes') || undefined }
      else if (tab === 'prescriptions') {
        const doseQuantity = number(form, 'doseQuantity')
        const doseUnit = text(form, 'doseUnit') || undefined
        if ((doseQuantity === undefined) !== (doseUnit === undefined)) {
          throw new FieldRefusal(doseQuantity === undefined ? 'dose-quantity' : 'dose-unit', 'Enter both dose quantity and dose unit, or leave both blank.')
        }
        body = { medicationDisplay: text(form, 'medicationDisplay'), doseQuantity, doseUnit,
          routeCode: text(form, 'routeCode') || undefined, frequency: text(form, 'frequency'),
          instructions: text(form, 'instructions'), status: 'draft' }
      }
      else {
        const status = text(form, 'status')
        const toAnother = status === 'route' && routable
        if (status !== 'draft' && !(status === 'active' && canSendToLab) && !toAnother) throw new FieldRefusal('lab-request-status', canSendToLab ? 'Choose draft or active request.' : 'Choose a draft request.')
        // Sent to another laboratory, it is saved as a draft first; sending activates it (P4c SPEC 13.1).
        body = { testCodeSystem: text(form, 'testCodeSystem'), testCode: text(form, 'testCode'),
          testDisplay: text(form, 'testDisplay'), priority: text(form, 'priority'), status: toAnother ? 'draft' : status,
          specimenTypeCode: text(form, 'specimenTypeCode') || undefined,
          clinicalInformation: text(form, 'clinicalInformation') || undefined }
        if (toAnother) {
          const problem = choiceProblem(choice, 'lab_request')
          if (problem) {
            setRouteErrors({ [problem.field]: problem.text })
            document.getElementById(problem.field === 'destination' ? 'lab-route-destination-query' : 'lab-route-attested')?.focus()
            return
          }
        }
      }
      const signature = JSON.stringify([tab, ...Array.from(form.entries())])
      if (attempt.current?.signature !== signature) attempt.current = { signature, body, key: crypto.randomUUID() }
      if (sendingElsewhere && onCreateAndSend && choice.destination && choice.attestation) {
        await onCreateAndSend(attempt.current.body, attempt.current.key,
          { destination: choice.destination, attestationTextVersion: choice.attestation.version })
        setHandling('draft'); setPriority('routine'); setChoice(NO_DESTINATION)
      } else await onCreated(tab, attempt.current.body, attempt.current.key)
      formElement.reset()
      if (tab === 'lab-requests') { setHandling('draft'); setPriority('routine') }
      attempt.current = null
    } catch (caught) {
      if (caught instanceof FieldRefusal) problems.refuse(caught.field, caught.message, caught.focusId)
      else {
        // The inputs are named as the DTO's fields, so each field EHR refused is marked where it was entered.
        setError(refusalText(caught, 'Record could not be saved.'))
        problems.markRefused(formElement, caught)
      }
    }
    finally { submitting.current = false; setBusy(false) }
  }
  // A control in this form, marked invalid and described by its error while refused.
  const field = (id: string) => ({ error: problems.error(id), control: problems.control(id) })
  const f = {
    noteType: field('note-type'), title: field('note-title'), content: field('note-content'),
    system: field('diagnosis-system'), code: field('diagnosis-code'), display: field('diagnosis-display'), notes: field('diagnosis-notes'),
    medication: field('medication'), dose: field('dose-quantity'), unit: field('dose-unit'), route: field('route-code'), frequency: field('frequency'), instructions: field('instructions'),
    testSystem: field('test-system'), testCode: field('test-code'), testDisplay: field('test-display'), specimen: field('specimen-code'), information: field('test-information'), handling: field('lab-request-status'),
  }
  return <Card className="staff-card"><h2>Add {tabs.find(item => item.id === tab)?.label.toLowerCase()}</h2><form className="staff-form" onSubmit={event => void submit(event)}>
    {tab === 'clinical-notes' && <><Field label="Note type" htmlFor="note-type" error={f.noteType.error} required><Input id="note-type" name="noteType" placeholder="Consultation" maxLength={80} required {...f.noteType.control} /></Field><Field label="Title" htmlFor="note-title" error={f.title.error} required><Input id="note-title" name="title" maxLength={240} required {...f.title.control} /></Field><Field label="Clinical note" htmlFor="note-content" error={f.content.error} required><Textarea id="note-content" name="content" minLength={1} maxLength={100000} required {...f.content.control} /></Field><p className="staff-muted">Notes are saved as drafts. Signing needs its own reviewed action.</p></>}
    {tab === 'vitals' && <div role="group" aria-label="Vital measurements" {...problems.group('vital-values')}><div className="staff-form-row">{VITAL_FIELDS.map(([name, label, step, min, max]) =>
      <Field key={name} label={label} htmlFor={`vital-${name}`} error={problems.error(`vital-${name}`)}><Input id={`vital-${name}`} name={name} type="number" step={step} min={min} max={max} {...problems.control(`vital-${name}`)} /></Field>)}</div>
      <GroupError field="vital-values">{problems.error('vital-values')}</GroupError></div>}
    {tab === 'diagnoses' && <><div className="staff-form-row"><Field label="Code system" htmlFor="diagnosis-system" error={f.system.error} required><Input id="diagnosis-system" name="codeSystem" placeholder="ICD-10" maxLength={255} required {...f.system.control} /></Field><Field label="Code" htmlFor="diagnosis-code" error={f.code.error} required><Input id="diagnosis-code" name="code" maxLength={100} required {...f.code.control} /></Field></div><Field label="Display" htmlFor="diagnosis-display" error={f.display.error} required><Input id="diagnosis-display" name="display" maxLength={500} required {...f.display.control} /></Field><div className="staff-form-row"><Field label="Clinical status" htmlFor="diagnosis-status"><Select id="diagnosis-status" name="clinicalStatus">{diagnosisClinicalStatuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field><Field label="Verification" htmlFor="diagnosis-verification"><Select id="diagnosis-verification" name="verificationStatus">{diagnosisVerificationStatuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field></div><Field label="Notes" htmlFor="diagnosis-notes" error={f.notes.error}><Textarea id="diagnosis-notes" name="notes" maxLength={4000} {...f.notes.control} /></Field></>}
    {tab === 'prescriptions' && <><Field label="Medication" htmlFor="medication" error={f.medication.error} required><Input id="medication" name="medicationDisplay" maxLength={500} required {...f.medication.control} /></Field><div className="staff-form-row"><Field label="Dose quantity" htmlFor="dose-quantity" error={f.dose.error}><Input id="dose-quantity" name="doseQuantity" type="number" min="0.0001" step="0.0001" {...f.dose.control} /></Field><Field label="Dose unit" htmlFor="dose-unit" error={f.unit.error}><Input id="dose-unit" name="doseUnit" placeholder="mg" maxLength={80} {...f.unit.control} /></Field></div><div className="staff-form-row"><Field label="Route code" htmlFor="route-code" error={f.route.error}><Input id="route-code" name="routeCode" placeholder="oral" maxLength={100} {...f.route.control} /></Field><Field label="Frequency" htmlFor="frequency" error={f.frequency.error} required><Input id="frequency" name="frequency" placeholder="Twice daily" maxLength={240} required {...f.frequency.control} /></Field></div><Field label="Instructions" htmlFor="instructions" error={f.instructions.error} required><Textarea id="instructions" name="instructions" maxLength={4000} required {...f.instructions.control} /></Field><p className="staff-muted">{prescriptionRouting
      ? 'This saves a draft. To send it to a pharmacy at another facility, use Send to a pharmacy on it in the list.'
      : 'This creates an EHR draft. Pharmacy acceptance and dispensing are separate backend actions.'}</p></>}
    {tab === 'lab-requests' && <><div className="staff-form-row"><Field label="Test code system" htmlFor="test-system" error={f.testSystem.error} required><Input id="test-system" name="testCodeSystem" placeholder="LOINC" maxLength={255} required {...f.testSystem.control} /></Field><Field label="Test code" htmlFor="test-code" error={f.testCode.error} required><Input id="test-code" name="testCode" maxLength={100} required {...f.testCode.control} /></Field></div><Field label="Test display" htmlFor="test-display" error={f.testDisplay.error} required><Input id="test-display" name="testDisplay" maxLength={500} required {...f.testDisplay.control} /></Field><div className="staff-form-row"><Field label="Priority" htmlFor="test-priority"><Select id="test-priority" name="priority" value={priority} onChange={event => setPriority(event.target.value)}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="asap">As soon as possible</option><option value="stat">Stat</option></Select></Field><Field label="Specimen type code" htmlFor="specimen-code" error={f.specimen.error}><Input id="specimen-code" name="specimenTypeCode" maxLength={100} {...f.specimen.control} /></Field></div><Field label="Clinical information" htmlFor="test-information" error={f.information.error}><Textarea id="test-information" name="clinicalInformation" maxLength={4000} {...f.information.control} /></Field><Field label="Request handling" htmlFor="lab-request-status" error={f.handling.error} required><Select id="lab-request-status" name="status" value={handling} onChange={event => { setHandling(event.target.value); setRouteErrors({}) }} required {...f.handling.control}
      aria-describedby={f.handling.error ? 'lab-request-status-error lab-request-draft-warning' : 'lab-request-draft-warning'}><option value="draft">Save EHR draft</option>{canSendToLab && <option value="active">{routable ? 'Create active request and send to this facility’s Lab' : 'Create active request and send to Lab'}</option>}
      {routable && <option value="route">Create and send to another laboratory</option>}</Select></Field>
      {sendingElsewhere && routing && <OrderDestinationFields id="lab-route" context={routing} kind="lab_request" priority={priority}
        value={choice} onChange={setChoice} errors={routeErrors} />}
      {/* Since hid-system #56 EHR sends a request to Lab when it is created active, and when a draft is activated later.
          Lab accepts it only from an actor holding lab.work-item.accept, and refuses anyone else's (LAB_WORK_ITEM_ACCESS_DENIED). */}
      <div id="lab-request-draft-warning" className="staff-notice staff-danger">{sendingElsewhere
        ? 'The request is saved as a draft, then sent to the laboratory you choose: sending it activates it. If it can’t be sent, it stays a draft.'
        : <>A draft is not sent to the Laboratory until it is activated.{canSendToLab ? '' : routable ? ' Only someone who may send requests to this facility’s Lab can activate it here; you can send it to another laboratory.' : ' Only someone who may send requests to Lab can activate it or create an active request.'}</>}</div>
      {/* An EHR before #56 has no Send to Lab, and passes Lab's own refusal back after saving the request. */}
      {canSendToLab && !sendingElsewhere && <p className="staff-muted">Active creation saves the request, then asks Lab to accept it. If Lab does not, the request stays saved and active, even when an error is shown: check the list before creating it again, then use Send to Lab on it there, or contact the laboratory if the EHR cannot send it.</p>}</>}
    {error && <p className="staff-error" role="alert">{error}</p>}<Button type="submit" aria-disabled={busy || disabled || undefined} className={BUSY}
      aria-describedby={tab === 'lab-requests' ? 'lab-request-draft-warning' : undefined}>{busy ? (sendingElsewhere ? 'Sending…' : 'Saving…') : sendingElsewhere && choice.destination ? `Create and send to ${choice.destination.facilityName}` : tab === 'lab-requests' ? 'Create lab request' : tab === 'vitals' || tab === 'diagnoses' ? 'Save record' : 'Save draft'}</Button>
  </form></Card>
}

/** A status change; a `warning` stays in the form and describes the button that confirms it. */
function StatusActionForm({ id, title, choices, warning, disabled, onChange }: {
  id: string; title: string; choices: readonly StatusOption[]; warning?: string; disabled: boolean
  onChange: (status: string, reason: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const submitting = useRef(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const status = text(form, 'status')
    const reason = text(form, 'reason')
    setError(''); problems.clear()
    if (!choices.some(choice => choice.value === status)) return problems.refuse(`${id}-status`, 'Choose an allowed status.')
    if (reason.length < 3) return problems.refuse(`${id}-reason`, 'Give a reason of at least 3 characters.')
    submitting.current = true; setBusy(true)
    try { await onChange(status, reason); formElement.reset() }
    catch (caught) { setError(refusalText(caught, 'Status could not be changed.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <strong>{title}</strong>
    <Field label="New status" htmlFor={`${id}-status`} error={problems.error(`${id}-status`)} required><Select id={`${id}-status`} name="status" defaultValue={choices[0]?.value} required {...problems.control(`${id}-status`)}>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</Select></Field>
    <Field label="Reason for change" htmlFor={`${id}-reason`} error={problems.error(`${id}-reason`)} required><Input id={`${id}-reason`} name="reason" minLength={3} maxLength={500} required {...problems.control(`${id}-reason`)} /></Field>
    {warning && <div id={`${id}-warning`} className="staff-notice staff-danger">{warning}</div>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" aria-disabled={busy || disabled || undefined} className={UNAVAILABLE}
      aria-describedby={warning ? `${id}-warning` : undefined}>{busy ? 'Updating…' : 'Update status'}</Button>
  </form>
}

function ReasonActionForm({ id, title, actionLabel, minLength = 3, disabled, onAction }: {
  id: string; title: string; actionLabel: string; minLength?: number; disabled: boolean
  onAction: (reason: string, key: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
  const submitting = useRef(false)
  const attempt = useRef<{ reason: string; key: string } | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || disabled) return
    const formElement = event.currentTarget
    const reason = text(new FormData(formElement), 'reason')
    setError(''); problems.clear()
    if (reason.length < minLength) return problems.refuse(`${id}-reason`, `Give a reason of at least ${minLength} characters.`)
    if (attempt.current?.reason !== reason) attempt.current = { reason, key: crypto.randomUUID() }
    submitting.current = true; setBusy(true)
    try { await onAction(reason, attempt.current.key); formElement.reset(); attempt.current = null }
    catch (caught) { setError(refusalText(caught, `${actionLabel} could not be completed.`)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <strong>{title}</strong>
    <Field label="Reason" htmlFor={`${id}-reason`} error={problems.error(`${id}-reason`)} required><Input id={`${id}-reason`} name="reason" minLength={minLength} maxLength={500} required {...problems.control(`${id}-reason`)} /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" aria-disabled={busy || disabled || undefined} className={UNAVAILABLE}>{busy ? 'Working…' : actionLabel}</Button>
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
  const problems = useFieldProblems()
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
    setError(''); problems.clear()
    // "Nothing changed" is about the three fields together: it is tied to their group.
    if (Object.keys(changes).length === 0) return problems.refuse(`${id}-changes`, 'Change the clinical status, verification or notes before saving.', `${id}-clinical`)
    if (reason.length < 3) return problems.refuse(`${id}-reason`, 'Give a reason of at least 3 characters.')
    submitting.current = true; setBusy(true)
    try { await onUpdate(changes, reason) }
    catch (caught) { setError(refusalText(caught, 'The diagnosis could not be changed.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <strong>Change this diagnosis</strong>
    <div className="staff-form" role="group" aria-label="Diagnosis changes" {...problems.group(`${id}-changes`)}>
      <div className="staff-form-row">
        <Field label="Clinical status" htmlFor={`${id}-clinical`}><Select id={`${id}-clinical`} name="clinicalStatus" defaultValue={String(diagnosis.clinicalStatus ?? '')}>{diagnosisClinicalStatuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
        <Field label="Verification" htmlFor={`${id}-verification`}><Select id={`${id}-verification`} name="verificationStatus" defaultValue={String(diagnosis.verificationStatus ?? '')}>{[...diagnosisVerificationStatuses, { value: 'entered_in_error', label: 'Entered in error' }].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
      </div>
      <Field label="Notes" htmlFor={`${id}-notes`}><Textarea id={`${id}-notes`} name="notes" maxLength={4000} defaultValue={String(diagnosis.notes ?? '')} /></Field>
      <GroupError field={`${id}-changes`}>{problems.error(`${id}-changes`)}</GroupError>
    </div>
    <Field label="Reason for change" htmlFor={`${id}-reason`} error={problems.error(`${id}-reason`)} required><Input id={`${id}-reason`} name="reason" minLength={3} maxLength={500} required {...problems.control(`${id}-reason`)} /></Field>
    <p className="staff-muted">Every change is kept in the record history. A diagnosis marked entered in error accepts no further change here.</p>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" aria-disabled={busy || disabled || undefined} className={UNAVAILABLE}>{busy ? 'Updating…' : 'Update diagnosis'}</Button>
  </form>
}

type VitalCorrect = (replacementValues: VitalMeasurements, reason: string, key: string) => Promise<void>

function VitalCorrectionForm({ id, current, disabled, onCorrect }: {
  id: string; current: VitalValues; disabled: boolean; onCorrect: VitalCorrect
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problems = useFieldProblems()
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
    setError(''); problems.clear()
    // A rule about the values together is tied to their group; a missing blood pressure reading to its field.
    if (Object.keys(values).length === 0) return problems.refuse(`${id}-values`, 'Enter at least one vital measurement.', `${id}-systolicMmhg`)
    if ((values.systolicMmhg === undefined) !== (values.diastolicMmhg === undefined)) {
      return problems.refuse(values.systolicMmhg === undefined ? `${id}-systolicMmhg` : `${id}-diastolicMmhg`, 'Enter both systolic and diastolic blood pressure, or leave both blank.')
    }
    if (VITAL_FIELDS.every(([name]) => values[name] === (current[name] == null ? undefined : Number(current[name])))) {
      return problems.refuse(`${id}-values`, 'Change at least one value before saving a correction.', `${id}-systolicMmhg`)
    }
    if (reason.length < 3) return problems.refuse(`${id}-reason`, 'Give a reason of at least 3 characters.')
    // A retry of the same correction reuses its key, so EHR cannot append it twice.
    const signature = JSON.stringify([values, reason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    submitting.current = true; setBusy(true)
    try { await onCorrect(values, reason, attempt.current.key); attempt.current = null }
    catch (caught) { setError(refusalText(caught, 'The correction could not be saved.')) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <form className="staff-form" onSubmit={event => void submit(event)}>
    <p className="staff-muted">The values below become the current vitals; what was recorded is kept. A measurement left blank is not part of the corrected vitals.</p>
    <div role="group" aria-label="Corrected vital measurements" {...problems.group(`${id}-values`)}><div className="staff-form-row">{VITAL_FIELDS.map(([name, label, step, min, max]) =>
      <Field key={name} label={label} htmlFor={`${id}-${name}`} error={problems.error(`${id}-${name}`)}><Input id={`${id}-${name}`} name={name} type="number" step={step} min={min} max={max}
        defaultValue={current[name] == null ? '' : String(current[name])} {...problems.control(`${id}-${name}`)} /></Field>)}</div>
      <GroupError field={`${id}-values`}>{problems.error(`${id}-values`)}</GroupError></div>
    <Field label="Reason for correction" htmlFor={`${id}-reason`} error={problems.error(`${id}-reason`)} required><Input id={`${id}-reason`} name="reason" minLength={3} maxLength={500} required {...problems.control(`${id}-reason`)} /></Field>
    {error && <p className="staff-error" role="alert">{error}</p>}
    <Button type="submit" tone="secondary" size="sm" aria-disabled={busy || disabled || undefined} className={UNAVAILABLE}>{busy ? 'Saving…' : 'Save correction'}</Button>
  </form>
}

/**
 * A vital is never edited: EHR appends a correction and the list row keeps the
 * recorded values. Where a correction exists its values are shown as current,
 * and if it cannot be read the recorded values are not passed off as current.
 * Since hid-system #74 (migration 0090) a vital marked entered in error keeps its
 * values and corrections and takes no further correction (409 VITAL_NOT_AMENDABLE),
 * so it is marked and offers none. An EHR before #74 sends no status: every vital is final.
 */
function VitalPanel({ facilityId, patientId, encounterId, vital, canCorrect, disabled, onCorrect }: {
  facilityId: string; patientId: string; encounterId: string; vital: ClinicalRecord
  canCorrect: boolean; disabled: boolean; onCorrect: VitalCorrect
}) {
  const retracted = vital.status === 'entered_in_error'
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
    }).catch(caught => { if (active) setLoadError(refusalText(caught, 'Corrections could not be loaded.')) })
    return () => { active = false }
  }, [facilityId, patientId, encounterId, vital.id, corrected, correctionNo])
  const current: VitalValues | null = corrected ? latest?.replacementValues ?? null : vital
  return <>
    {retracted && <><Badge tone="warning">Entered in error</Badge><p>Recorded in error: do not use these values. They can no longer be corrected.</p></>}
    {!corrected && <p>{vitalSummary(vital)}</p>}
    {corrected && !latest && !loadError && <p role="status">Loading the correction…</p>}
    {latest && <><Detail label={`Corrected (correction ${latest.correctionNo})`} value={vitalSummary(latest.replacementValues)} />
      <Detail label="Reason" value={latest.reason} />
      <Detail label="Corrected at" value={latest.createdAt ? new Date(latest.createdAt).toLocaleString() : ''} /></>}
    {loadError && <p className="staff-error" role="alert">These vitals were corrected, but the correction could not be loaded, so the values below are as first recorded and may not be current. {loadError}</p>}
    {corrected && <Detail label="Originally recorded" value={vitalSummary(vital)} />}
    {canCorrect && current && !retracted && <>
      <Button id={`vital-${vital.id}-correct`} tone="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close correction' : 'Correct these vitals'}</Button>
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
  // A failed read hides the content; a refused revision is reported in its form, which keeps what was typed.
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const problems = useFieldProblems()
  const submitting = useRef(false)
  const attempt = useRef<{ signature: string; input: { expectedRowVersion: number; changeReason: string; content: string }; key: string } | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true); setLoadError('')
    void staffApi.noteRevisions(facilityId, patientId, encounterId, note.id)
      .then(value => { if (active) setRevisions(value) })
      .catch(caught => { if (active) setLoadError(refusalText(caught, 'Note content could not be loaded.')) })
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
    setError(''); problems.clear()
    if (!expectedRowVersion) { setError('Reload the note before recording a revision.'); return }
    if (!content) return problems.refuse(`note-revision-content-${note.id}`, 'Enter the revised note content.')
    if (changeReason.length < 3) return problems.refuse(`note-revision-reason-${note.id}`, 'Give a reason of at least 3 characters.')
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
    } catch (caught) { setError(refusalText(caught, 'Note revision could not be recorded.')) }
    finally { submitting.current = false; setBusy(false) }
  }

  return <div className="staff-stack">
    <Button id={`note-${note.id}-toggle`} tone="secondary" size="sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      {open ? 'Hide note content' : 'Review note content'}
    </Button>
    {open && <>
      <Button tone="quiet" size="sm" aria-disabled={loading || undefined} className={QUIET_UNAVAILABLE}
        onClick={() => { if (loading) return; setNotice(''); setRevision(value => value + 1) }}>Refresh revisions</Button>
      {/* Mounted while the note is open, so what a revision records is announced; it says so through the read that follows. */}
      <div id={`note-${note.id}-status-region`} role="status">{notice ? <p className="staff-success">{notice}</p> : loading && <p>Loading note revisions…</p>}</div>
      {loadError && <p className="staff-error" role="alert">{loadError}</p>}
      {!loading && !loadError && revisions?.length === 0 && <p>No note content is available.</p>}
      {!loading && !loadError && revisions?.map(item => <div className="staff-list-item" key={item.id}>
        <strong>Revision {item.revisionNo}</strong><p className="staff-note-content">{item.content}</p>
        <p>Recorded {new Date(item.createdAt).toLocaleString()} · {item.changeReason}</p>
      </div>)}
      {/* The forms stay while the revisions are read again, so the one just used keeps focus;
          the content is hidden then, so the status form, which signs it, is unavailable. */}
      {!loadError && Boolean(revisions?.length) && canWrite && (noteTransitions[String(note.status)]?.length ?? 0) > 0 &&
        <StatusActionForm key={`${note.id}-${note.rowVersion}`} id={`note-${note.id}`} title="Reviewed note status"
          choices={noteTransitions[String(note.status)]!} disabled={busy || loading}
          onChange={onStatus} />}
      {!loadError && revisions !== null && canWrite && note.status !== 'entered_in_error' &&
        <form className="staff-form" onSubmit={event => void addRevision(event)}>
          <strong>Add a note revision</strong>
          <Field label="Content" htmlFor={`note-revision-content-${note.id}`} error={problems.error(`note-revision-content-${note.id}`)} required>
            <Textarea id={`note-revision-content-${note.id}`} name="content" maxLength={100000} required {...problems.control(`note-revision-content-${note.id}`)} />
          </Field>
          <Field label="Reason for revision" htmlFor={`note-revision-reason-${note.id}`} error={problems.error(`note-revision-reason-${note.id}`)} required>
            <Input id={`note-revision-reason-${note.id}`} name="reason" minLength={3} maxLength={500} required {...problems.control(`note-revision-reason-${note.id}`)} />
          </Field>
          {error && <p className="staff-error" role="alert">{error}</p>}
          <Button type="submit" size="sm" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Recording…' : 'Record revision'}</Button>
        </form>}
    </>}
  </div>
}

/** What a refused read of a request's released Lab results means (INTERFACE_CONTRACT.md, Lab "Released results"). */
function releasedResultsRefusal(caught: unknown): string {
  if (!isHidApiError(caught)) return refusalText(caught, 'Released results could not be loaded.')
  if (caught.status === 404) return caught.code === 'LAB_WORK_ITEM_NOT_FOUND'
    ? 'Lab has no work item for this request that you can see: Lab has not accepted it, accepted it at another facility, or your access to this patient does not cover it.'
    // An earlier Lab has no such route.
    : 'Released results are not available from this Lab service.'
  if (caught.status === 403) return `Access denied: you may not read this request's Lab results here${labCode(caught.code) ? ` (${caught.code})` : ''}.`
  return refusalText(caught, 'Released results could not be loaded.')
}

/**
 * The released results of the Lab work item accepted from one lab request
 * (hid-system #51, GET /lab/ehr-orders/:id/released-results). Lab audits every
 * read, so it is read only when opened or refreshed, never on its own. Each
 * result shows its released revisions only, under their stored version numbers.
 */
function ReleasedResults({ facilityId, requestId, purpose = 'direct-care' }: { facilityId: string; requestId: string; purpose?: 'direct-care' | 'emergency' }) {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [released, setReleased] = useState<LabOrderReleasedResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    // What was shown is hidden while it is read again: a refused read leaves nothing of it.
    setReleased(null); setLoading(true); setError('')
    void staffApi.labReleasedResultsForOrder(facilityId, requestId, purpose)
      .then(value => { if (active) setReleased(value) })
      .catch(caught => { if (active) setError(releasedResultsRefusal(caught)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, revision, facilityId, requestId, purpose])
  return <div className="staff-stack">
    <Button id={`lab-request-${requestId}-results`} tone="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Hide released results' : 'View released results'}</Button>
    {open && <>
      <Button tone="quiet" size="sm" aria-disabled={loading || undefined} className={QUIET_UNAVAILABLE}
        onClick={() => { if (!loading) setRevision(value => value + 1) }}>Refresh released results</Button>
      <div role="status">{loading && <p>Loading released results…</p>}</div>
      {error && <p className="staff-error" role="alert">{error}</p>}
      {released && (released.results.length === 0 ? <p>No result released yet.</p> : <>
        <p>{released.test.name} · {released.test.codeSystem} {released.test.code} · accepted by Lab {new Date(released.acceptedAt).toLocaleString()}</p>
        {released.results.map((result, index) => <div className="staff-stack" key={result.id}>
          <div className="staff-row"><strong>Result {index + 1}</strong>
            <Badge tone={result.status === 'entered_in_error' ? 'danger' : 'success'}>{result.status === 'entered_in_error' ? 'Entered in error' : 'Released'}</Badge></div>
          {result.status === 'entered_in_error' && <p>The latest released version was marked entered in error: do not use it.</p>}
          {skipsVersions(result.revisions) && <p className="staff-muted">Version numbers skip revisions that were never released; those are not shown.</p>}
          <RevisionList revisions={result.revisions} />
        </div>)}
      </>)}
    </>}
  </div>
}

// Since hid-system #59 only the account that created an upload intent completes it, with no delegated
// completion, and the list shows every intent: one left `initiated` is never scanned (INTERFACE_CONTRACT.md §16).
function Documents({ patientId, encounterId, facilityId, canWrite, canOcr, verify }: { patientId: string; encounterId: string; facilityId: string; canWrite: boolean; canOcr: boolean; verify: () => Promise<void> }) {
  const { state } = useStaff()
  // The OCR handoff names who made it and where, since the history entry holding it outlives both.
  const actorId = state.status === 'ready' ? state.session.actor.id : undefined
  const [items, setItems] = useState<DocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const problems = useFieldProblems()
  async function load() { setLoading(true); setError(''); try { setItems((await staffApi.documents(facilityId, patientId, encounterId)).items) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Documents could not be loaded.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [facilityId, patientId, encounterId])
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The button stays focusable while the upload runs; a second press does nothing.
    if (busy) return
    setError(''); setNotice(''); problems.clear()
    const formElement = event.currentTarget
    const file = new FormData(formElement).get('document')
    if (!(file instanceof File) || !file.size) return problems.refuse('clinical-document', 'Select a file first.')
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'].includes(file.type) || file.size > 52_428_800) return problems.refuse('clinical-document', 'Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')
    setBusy(true)
    try {
      await verify(); await staffApi.uploadDocument(facilityId, patientId, encounterId, file); await load(); formElement.reset()
      setNotice('Document uploaded. It can be opened once its virus scan is clean.')
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Document could not be uploaded.') }
    finally { setBusy(false) }
  }
  async function download(id: string) {
    setError('')
    // The document opens in a tab of its own only while its session is ready.
    const sentIn = staffSessionGeneration()
    try {
      await verify()
      const result = await staffApi.documentDownload(facilityId, id)
      // Only a signed storage link opens: never javascript:, data: or plain http to
      // another host, whatever a faulty backend or proxy sends.
      assertSignedStorageUrl(result.url, { allowLocalHttp: getEnvironment().name === 'local',
        code: 'INVALID_DOWNLOAD_URL', message: 'Document could not be opened.' })
      await untilStaffSessionReady(sentIn)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Document could not be opened.') }
  }
  return <div className="staff-two-col"><Card className="staff-card"><h2>Documents</h2>{loading && <p role="status">Loading documents…</p>}{!loading && items.length === 0 && <p>No documents for this encounter.</p>}<div className="staff-list">{items.map(item => <div className="staff-list-item" key={item.id}><strong>{item.fileName}</strong><p>{item.mediaType} · {fileSize(item.sizeBytes)}{item.status === 'initiated' ? '' : ` · scan: ${item.scanStatus}`}</p>{item.status === 'initiated' && <p className="staff-muted">Upload not completed; only the person who started it can finish it. Upload the file again.</p>}<Button tone="secondary" size="sm" onClick={() => void download(item.id)} disabled={item.scanStatus !== 'clean'}>Open file</Button>{canOcr && item.scanStatus === 'clean' && <Link to="/provider/ocr" state={{ ocrDocumentId: item.id, ocrPatientId: patientId, actorId, facilityId }} className="staff-text-link">Extract with OCR</Link>}</div>)}</div></Card>{canWrite && <Card className="staff-card"><h2>Upload a document</h2><p>Files are scanned before download becomes available.</p><form className="staff-form" onSubmit={event => void upload(event)}><Field label="Clinical document" htmlFor="clinical-document" error={problems.error('clinical-document')}><Input id="clinical-document" name="document" type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" required {...problems.control('clinical-document')} /></Field><Button type="submit" aria-disabled={busy || undefined} className={BUSY}>{busy ? 'Uploading…' : 'Upload document'}</Button></form><div role="status">{notice && <p className="staff-success">{notice}</p>}</div></Card>}{error && <p role="alert" className="staff-error">{error}</p>}</div>
}

// What EHR's emergency summary sends of each section at most (patient-records.service.ts
// SECTION_LIMITS). Since hid-system #52 EHR reports each released section's limit and
// whether it was cut short; an earlier EHR reports neither, only one `limit` that is
// no section's cap, so there a section that reaches its cap may have more.
const EMERGENCY_CAPS = { encounters: 50, notes: 50, diagnoses: 100, prescriptions: 100, labRequests: 100, documents: 100 } as const

type BadgeTone = 'neutral' | 'information' | 'success' | 'warning' | 'danger'
// Prescription and lab request statuses (EHR OrderStatus), what is current first.
const ORDER_STATUSES: Readonly<Record<string, { readonly label: string; readonly tone: BadgeTone; readonly rank: number }>> = {
  active: { label: 'Active', tone: 'success', rank: 0 },
  on_hold: { label: 'On hold', tone: 'warning', rank: 1 },
  draft: { label: 'Draft', tone: 'information', rank: 2 },
  completed: { label: 'Completed', tone: 'neutral', rank: 3 },
  cancelled: { label: 'Cancelled', tone: 'neutral', rank: 4 },
  entered_in_error: { label: 'Entered in error', tone: 'danger', rank: 5 },
}

function orderRank(status: string) { return ORDER_STATUSES[status]?.rank ?? 3 }

// A diagnosis has no status of its own: an ongoing one first, then one that has
// ended, then one refuted, and last one entered in error.
function diagnosisRank(item: EmergencyRecords['diagnoses'][number]) {
  if (item.verificationStatus === 'entered_in_error') return 3
  if (item.verificationStatus === 'refuted') return 2
  return ['inactive', 'remission', 'resolved'].includes(item.clinicalStatus) ? 1 : 0
}

const DAY_MS = 86_400_000
const CALENDAR_DAY = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'UTC' })

/**
 * A prescription's start or end day. EHR keeps it as a date (ehr.prescriptions
 * starts_on, ends_on), which node-pg, given no type parser in hid-system, turns into
 * midnight where the service runs and sends as an instant: 2026-10-12T00:00:00.000Z
 * in UTC, 2026-10-11T23:00:00.000Z an hour east of it. The day is the one whose UTC
 * midnight is nearest, which holds for any service less than 12 hours from UTC; a
 * plain YYYY-MM-DD, as a type parser would send it, is that day.
 */
function calendarDay(value: string) {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const instant = plain ? Date.UTC(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : Date.parse(value)
  return Number.isNaN(instant) ? value : CALENDAR_DAY.format(new Date(Math.round(instant / DAY_MS) * DAY_MS))
}

/** The entries in `rank` order; EHR's own order, newest first, within a rank. */
function currentFirst<T>(items: readonly T[], rank: (item: T) => number): T[] {
  return [...items].sort((first, second) => rank(first) - rank(second))
}

function OrderStatus({ status }: { status: string }) {
  const known = ORDER_STATUSES[status]
  return <Badge tone={known?.tone ?? 'neutral'}>{known?.label ?? status.replaceAll('_', ' ')}</Badge>
}

/**
 * One section of the summary. A section EHR withheld was not read for this
 * reader, so its empty array is no answer and is never shown as "none". One EHR
 * reports as cut short (`truncated`) says so; from an EHR that reports nothing,
 * one that reaches its cap may have more.
 */
function SummarySection<T extends { id: string }>({ title, items, cap, empty, note, render, withheld = false, truncated }: {
  title: string; items: readonly T[] | undefined; cap: number; empty: string; note?: ReactNode
  render: (item: T) => ReactNode; withheld?: boolean; truncated?: boolean
}) {
  if (withheld && (!Array.isArray(items) || items.length === 0)) return <Card className="staff-card"><h2>{title}</h2>
    <p>{title} are not included in this summary: EHR did not release them to your role at this facility.</p></Card>
  const shortened = Array.isArray(items) && (truncated ?? items.length >= cap)
  return <Card className="staff-card"><h2>{title}</h2>
    {note}
    {!Array.isArray(items) ? <p>{title} are not available in this summary.</p>
      : items.length === 0 ? <p>{empty}</p>
        : <div className="staff-list">{items.map(item => <div className="staff-list-item" key={item.id}>{render(item)}</div>)}</div>}
    {shortened && <p className="staff-muted">{truncated === undefined
      ? `The backend sends only the ${cap} most recent; older ones are not shown.`
      : `Only the ${cap} most recent are shown; older ones exist and are not shown.`}</p>}
  </Card>
}

function EmergencySummary({ facilityId, patientId, patientName, permissions, verify }: {
  facilityId: string; patientId: string; patientName: string; permissions: readonly string[]; verify: () => Promise<void>
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
      .catch(caught => { if (active) setError(refusalText(caught, 'Emergency records could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [facilityId, patientId, verify, revision])

  // The route needs only ehr.encounter.read and ehr.note.read. Since hid-system #52
  // EHR reads each further section only for a reader who holds its read permission
  // and names the others withheld; an earlier EHR sends every section. Either way a
  // section is shown only to a role that may read that record: display, kept as
  // defence in depth, not access control, which is EHR's.
  const may = (permission: string) => permissions.includes(permission)
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : ''
  // Each section's own limit and whether EHR cut it short, where EHR reports them.
  const sectionProps = (key: keyof typeof EMERGENCY_CAPS) => ({
    cap: summary?.limits?.[key] ?? EMERGENCY_CAPS[key],
    withheld: summary?.withheld?.includes(key) ?? false,
    truncated: summary?.truncated ? summary.truncated[key] === true : undefined,
  })
  const released = (key: EmergencySection) => !summary?.released || summary.released.includes(key)
  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Emergency record · audited access</p><h1>{patientName}</h1>
      <p>This read-only summary holds this facility’s completed encounters and signed clinical notes, and the diagnoses, prescriptions, lab requests and documents your role may read. The server checks the active emergency grant on each request.</p>
    </div>
    <div className="staff-row staff-toolbar"><Badge tone="danger">Emergency access</Badge>
      <Button tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE}
        onClick={() => { if (!loading) setRevision(value => value + 1) }}>Refresh summary</Button>
      <Link className="staff-text-link" to="/provider/patients">Change patient →</Link>
    </div>
    {loading && <p role="status">Loading emergency summary…</p>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {summary && released('vitals') && <p className="staff-notice">Vital signs are not shown in this summary. EHR sends them as first recorded, without later corrections, so a value here could be one a clinician has since corrected.</p>}
    {summary && <div className="staff-two-col">
      <SummarySection title="Completed encounters" items={summary.encounters} {...sectionProps('encounters')}
        empty="No completed encounters are available from this facility." render={item => <>
          <strong>{item.encounterType.replace('_', ' ')}</strong>
          <p>Started {date(item.startedAt)}</p>
          {item.endedAt && <p>Ended {date(item.endedAt)}</p>}
        </>} />
      <SummarySection title="Signed notes" items={summary.notes} {...sectionProps('notes')}
        empty="No signed notes are available from this facility." render={item => <>
          <strong>{item.title}</strong>
          <p>{item.noteType} · {item.status} · revision {item.revisionNo}</p>
          <p className="staff-note-content">{item.content}</p>
          {item.signedAt && <p>Signed {date(item.signedAt)}</p>}
        </>} />
      {may('ehr.diagnosis.read') && <SummarySection title="Diagnoses" {...sectionProps('diagnoses')}
        items={Array.isArray(summary.diagnoses) ? currentFirst(summary.diagnoses, diagnosisRank) : undefined}
        empty="No diagnoses are available from this facility." render={item => <>
          <div className="staff-row"><strong>{item.display}</strong>
            {item.verificationStatus === 'entered_in_error' && <Badge tone="danger">Entered in error</Badge>}
            {item.verificationStatus === 'refuted' && <Badge tone="neutral">Refuted</Badge>}</div>
          {item.verificationStatus === 'entered_in_error' && <p>Recorded in error: not a diagnosis of this patient.</p>}
          <p>{item.codeSystem} {item.code} · {item.clinicalStatus.replaceAll('_', ' ')} · {item.verificationStatus.replaceAll('_', ' ')}</p>
          {item.notes && <p className="staff-note-content">{item.notes}</p>}
        </>} />}
      {may('ehr.prescription.read') && <SummarySection title="Prescriptions" {...sectionProps('prescriptions')}
        items={Array.isArray(summary.prescriptions) ? currentFirst(summary.prescriptions, item => orderRank(item.status)) : undefined}
        empty="No prescriptions are available from this facility." render={item => <>
          <div className="staff-row"><strong>{item.medicationDisplay}</strong><OrderStatus status={item.status} /></div>
          {item.status === 'entered_in_error' && <p>Recorded in error: not a prescription for this patient.</p>}
          <p>{item.doseQuantity == null || item.doseQuantity === '' ? 'Dose not recorded' : `${Number(item.doseQuantity)} ${item.doseUnit ?? ''}`.trim()} · {item.routeCode ? `Route ${item.routeCode}` : 'Route not recorded'} · {item.frequency}</p>
          {item.instructions && <p className="staff-note-content">{item.instructions}</p>}
          {(item.startsOn || item.endsOn) && <p>{[item.startsOn && `Starts ${calendarDay(item.startsOn)}`, item.endsOn && `Ends ${calendarDay(item.endsOn)}`].filter(Boolean).join(' · ')}</p>}
        </>} />}
      {may('ehr.lab-request.read') && <SummarySection title="Lab requests" {...sectionProps('labRequests')}
        items={Array.isArray(summary.labRequests) ? currentFirst(summary.labRequests, item => orderRank(item.status)) : undefined}
        empty="No lab requests are available from this facility." render={item => <>
          <div className="staff-row"><strong>{item.testDisplay}</strong><OrderStatus status={item.status} /></div>
          {item.status === 'entered_in_error' && <p>Recorded in error: not a request for this patient.</p>}
          <p>{item.testCodeSystem} {item.testCode} · {item.priority} priority · Requested {date(item.createdAt)}</p>
          {item.clinicalInformation && <p className="staff-note-content">{item.clinicalInformation}</p>}
          {/* Lab allows a released-results read under an active emergency grant; a draft never reached Lab. */}
          {item.status !== 'draft' && may('lab.result.released.read') && <ReleasedResults facilityId={facilityId} requestId={item.id} purpose="emergency" />}
        </>} />}
      {may('ehr.document.read') && <SummarySection title="Documents" items={summary.documents} {...sectionProps('documents')}
        note={<p>{summary.released
          ? 'Documents that passed the virus scan are listed for reference; they cannot be opened from this summary.'
          : 'Uploaded documents are listed for reference. They cannot be opened from this summary, and their virus scan result is not included.'}</p>}
        empty="No uploaded documents are available from this facility." render={item => <>
          <strong>{item.fileName}</strong>
          <p>{item.mediaType} · {fileSize(item.sizeBytes)} · Uploaded {date(item.createdAt)}</p>
        </>} />}
    </div>}
  </>
}

export function Clinical() {
  const { state, activePatient, setActivePatient } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const permissions = facility?.permissions ?? []
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [encounterPages, setEncounterPages] = useState<PagePosition | null>(null)
  const [encounterNotice, setEncounterNotice] = useState<ListNotice | null>(null)
  // The encounter being documented. Only choosing a row or starting an encounter
  // changes it; paging the list does not, so a draft stays with its encounter.
  const [selection, setSelection] = useState<Encounter | null>(null)
  const encounterId = selection?.id ?? ''
  const selectionShown = useRef<Encounter | null>(null)
  useEffect(() => { selectionShown.current = selection }, [selection])
  const [tab, setTab] = useState<RecordKind | 'documents'>('clinical-notes')
  const [records, setRecords] = useState<ClinicalRecord[]>([])
  const [recordsFor, setRecordsFor] = useState('')
  const [recordPages, setRecordPages] = useState<PagePosition | null>(null)
  const [recordNotice, setRecordNotice] = useState<ListNotice | null>(null)
  // Novu since P4c: whether orders between facilities are on, as the lab request or prescription list last said.
  const [ordersOpen, setOrdersOpen] = useState<{ scope: string; open: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  // After a change, where the work continues: the form rebuilt for the record's new
  // version, or the record itself once a final status removes the form.
  const focus = useFocusById()
  const loadSequence = useRef(0)
  // Every records read takes a number; only the latest may show its rows. The
  // page last asked for is what a re-read after a change reads again, so a page
  // move made while the change was saving is not undone.
  const recordLoad = useRef(0)
  const recordRequested = useRef<{ scope: string; cursors: Cursors }>({ scope: '', cursors: FIRST_PAGE })
  const encounterRequested = useRef<Cursors>(FIRST_PAGE)
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
  const selectedEncounter = selection && selection.patientId === patientId && selection.facilityId === facility?.id ? selection : undefined

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
  // Loads one page of encounters: the first, the page asked for, or ('shown') the
  // page last asked for. The page and its rows change together, once read. The
  // selection keeps its encounter, refreshed from the page when it is there.
  const loadEncounters = useCallback(async (request: { cursors?: Cursors | 'shown'; fresh?: boolean; select?: Encounter; paging?: boolean } = {}) => {
    if (!facility || !patientId || activePatient?.purpose === 'emergency') return
    const sequence = ++loadSequence.current
    const scope = JSON.stringify([facility.id, patientId])
    const before = encounterRequested.current
    const wanted = request.cursors === 'shown' ? before : request.cursors ?? FIRST_PAGE
    encounterRequested.current = wanted
    setLoading(true); setError('')
    if (request.paging) setEncounterNotice(null)
    try {
      await verify()
      const { page, cursors, restarted } = await readPage(
        (cursor, fresh) => staffApi.encounters(facility.id, patientId, { cursor, fresh }), wanted, request.fresh ?? false)
      if (sequence !== loadSequence.current) return
      encounterRequested.current = cursors
      setEncounters(page.items)
      setEncounterPages({ scope, cursors, next: page.nextCursor ?? null })
      setEncounterNotice(restarted ? { scope, text: RESTARTED, alert: false } : null)
      setSelection(current => {
        const chosen = request.select ?? current
        if (!chosen) return page.items[0] ?? null
        return page.items.find(item => item.id === chosen.id) ?? chosen
      })
      // A refresh or a re-read after a change brings the documented encounter up
      // to date even when it is on another page: its status and version are the
      // ones the next change is checked against.
      const documented = selectionShown.current
      if (request.fresh && !request.select && documented?.patientId === patientId && documented.facilityId === facility.id
        && !page.items.some(item => item.id === documented.id)) {
        const current = await staffApi.encounter(facility.id, patientId, documented.id).catch(() => null)
        if (current && sequence === loadSequence.current) setSelection(selected => selected?.id === current.id ? current : selected)
      }
    } catch (caught) {
      if (sequence !== loadSequence.current) return
      encounterRequested.current = before
      if (request.paging) setEncounterNotice({ scope, text: `The page could not be loaded. ${refusalText(caught, '')}`.trim(), alert: true })
      else setError(refusalText(caught, 'Encounters could not be loaded.'))
    }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [facility?.id, patientId, activePatient?.purpose, verify])

  useEffect(() => {
    encounterRequested.current = FIRST_PAGE
    setEncounters([]); setEncounterPages(null); setEncounterNotice(null); setSelection(null); setRecords([]); setRecordsFor(''); setSuccess('')
    void loadEncounters()
    return () => { loadSequence.current += 1 }
  }, [loadEncounters])
  useEffect(() => {
    if (!facility || !patientId || !selectedEncounter || !activeTab || activeTab === 'documents' || activePatient?.purpose === 'emergency') return
    const sequence = ++recordLoad.current
    const scope = recordScope
    recordRequested.current = { scope, cursors: FIRST_PAGE }
    setRecords([]); setRecordsFor(''); setRecordPages(null); setRecordNotice(null); setRecordsLoading(true); setError('')
    void staffApi.records(facility.id, patientId, encounterId, activeTab).then(result => {
      if (sequence !== recordLoad.current) return
      setRecords(result.items); setRecordsFor(scope); setRecordPages({ scope, cursors: FIRST_PAGE, next: result.nextCursor ?? null })
      setOrdersOpen({ scope, open: result.crossFacilityOrders === true })
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
    permissions={permissions} verify={verify} />
  const selected = selectedEncounter
  const canMutate = activePatient.purpose === 'direct-care' && currentWriteAccess?.allowed === true
  // EHR sends a lab request to Lab only for an actor who also holds Lab's acceptance permission.
  const canSendToLab = permissions.includes('lab.work-item.accept')
  // Orders between facilities (Novu, P4c): sent under direct care by a member holding ehr.order-route.send and the
  // order's write permission, with write access to the patient, while the list says they are on. Withdrawal needs the
  // send permission only (no consent: it discloses nothing). A main-v1 build has neither.
  const novu = usesNovuBackend()
  const ordersOpenHere = ordersOpen?.scope === recordScope && ordersOpen.open
  const canRouteOrders = novu && ordersOpenHere && canMutate && permissions.includes('ehr.order-route.send')
  const canRoute = (kind: RecordKind) => canRouteOrders && permissions.includes(writePermissions[kind])
  const canWithdrawRoutes = novu && activePatient.purpose === 'direct-care' && permissions.includes('ehr.order-route.send')
  const routeContext: RouteContext = { facilityId: facility.id, orderingFacility: facility.name,
    patient: activePatient.lookup.patient.fullName ?? activePatient.hid }

  // A new encounter starts now, so it usually heads the first page; it is the
  // one documented next even when it does not (a backdated start).
  async function createEncounter(input: { encounterType: string; status: string; startedAt: string; chiefComplaint: string }, key: string) {
    if (!facility || !patientId) return
    await verify()
    const result = await staffApi.createEncounter(facility.id, patientId, input, key)
    if (result?.id) setSelection(result)
    await loadEncounters({ fresh: true, select: result })
    setSuccess('Encounter created by the backend.')
  }

  // Reads a page of the records list shown: the page asked for, or ('shown') the
  // page last asked for. A read for a list no longer shown (the clinician moved
  // to another tab or encounter) is not made: it would replace that list's rows.
  // After a change the read is fresh, and a failure keeps the rows and says the
  // change was saved; a failed page move is reported beside the list. After an
  // attempt that may have saved nothing ('unsure') the read is fresh too, and a
  // failure is left to the caller to say. It answers the rows read, 'failed', or
  // null when no read was made or kept (Reload).
  async function loadRecords(kind: RecordKind, cursors: Cursors | 'shown', afterChange: boolean | 'unsure'): Promise<Reload> {
    if (!facility || !patientId || !encounterId) return null
    const scope = JSON.stringify([facility.id, patientId, encounterId, kind])
    if (scope !== recordScopeShown.current) return null
    const sequence = ++recordLoad.current
    const before = recordRequested.current
    const wanted = cursors !== 'shown' ? cursors : before.scope === scope ? before.cursors : FIRST_PAGE
    recordRequested.current = { scope, cursors: wanted }
    setRecordsLoading(true)
    if (!afterChange) { setError(''); setRecordNotice(null) }
    try {
      const { page, cursors: shown, restarted } = await readPage(
        (cursor, fresh) => staffApi.records(facility.id, patientId, encounterId, kind, { cursor, fresh }), wanted, afterChange !== false)
      if (sequence !== recordLoad.current) return null
      recordRequested.current = { scope, cursors: shown }
      setRecords(page.items); setRecordsFor(scope); setRecordPages({ scope, cursors: shown, next: page.nextCursor ?? null })
      setOrdersOpen({ scope, open: page.crossFacilityOrders === true })
      setRecordNotice(restarted ? { scope, text: RESTARTED, alert: false } : null)
      return page.items
    } catch (caught) {
      if (sequence !== recordLoad.current) return null
      recordRequested.current = before
      if (afterChange === true) setError(`The change was saved, but the records could not be reloaded. ${refusalText(caught, '')}`.trim())
      else if (!afterChange) setRecordNotice({ scope, text: `The page could not be loaded. ${refusalText(caught, '')}`.trim(), alert: true })
      return 'failed'
    } finally { if (sequence === recordLoad.current) setRecordsLoading(false) }
  }

  // A saved lab request that Lab does not hold, or holds at another version: the
  // change stands, so this is said as a warning, not as the change failing, and
  // the work continues at the request's Send to Lab where it is offered and can
  // help, else at the request. Said after the list is read again (`reload`).
  function labWarning(text: string, requestId: string | undefined, reload: Reload, { sendable = true, listChanged = false } = {}) {
    setError(`${text}${reloadSentence(reload, 'request', listChanged)}`)
    focus(requestId ? [...(sendable ? [`lab-request-${requestId}-send`] : []), `record-${requestId}-title`, 'clinical-records-title'] : ['clinical-records-title'])
  }

  // A new record is the newest, so it heads the first page.
  async function createRecord(kind: RecordKind, body: object, key: string) {
    if (!facility || !patientId || !encounterId) return
    if (!canMutate) throw new Error('This access does not permit changes to the patient record.')
    const activeLab = kind === 'lab-requests' && 'status' in body && body.status === 'active'
    setSuccess('')
    if (activeLab) setError('')
    await verify()
    let saved: SavedRecord
    try { saved = await staffApi.createRecord(facility.id, patientId, encounterId, kind, body, key) }
    catch (caught) {
      const handoff = isHidApiError(caught) && (caught.code === 'LAB_HANDOFF_REFUSED' || caught.code === 'LAB_HANDOFF_UNCONFIRMED')
      // Not an active request, or fields EHR refused before saving anything (its ValidationPipe).
      if (!activeLab || (!handoff && refusedFields(caught).length > 0)) throw caught
      if (!handoff) {
        // An EHR before #56 saves the request, then passes Lab's own refusal back (6b49a06
        // lab-requests.service.ts create), and a create that went unanswered may have been
        // saved too. The list is read again, and the form keeps the request and its key, so
        // pressing again unchanged replays the same create rather than making another.
        const items = await loadRecords(kind, FIRST_PAGE, 'unsure')
        // Lab's own detail, passed back as it wrote it, may end without a full stop.
        const said = refusalText(caught, 'The lab request could not be created.')
        throw new Error(`${/[.!?]$/.test(said) ? said : `${said}.`} The lab request may have been saved and active even so: check the list before creating it again.${reloadSentence(items, 'lab requests', false)}`)
      }
      // hid-system #56: the request is saved and active, and Lab did not take it. Answering
      // here clears the form and its key, so it is not created again: it is sent from the
      // list. The problem's detail names the request, and is not shown.
      const named = handoffNames(caught.message)
      const items = await loadRecords(kind, FIRST_PAGE, true)
      // A 502 names no request; the newest active one for this test heads the list read.
      const fields = body as { testCodeSystem?: unknown; testCode?: unknown }
      const requestId = named.requestId ?? (Array.isArray(items) ? items.find(item => item.status === 'active'
        && item.testCodeSystem === fields.testCodeSystem && item.testCode === fields.testCode)?.id : undefined)
      labWarning(caught.code === 'LAB_HANDOFF_REFUSED'
        ? `Lab request saved and active in the EHR, but Lab refused it${named.code ? ` (${named.code})` : ''}, so the Laboratory does not have it. Do not create it again: once that is resolved, ${sendItFrom(canSendToLab)}.`
        : `Lab request saved and active in the EHR, but Lab did not confirm it, so the Laboratory may not have it. Do not create it again: to send it again, ${sendItFrom(canSendToLab)}.`,
      requestId, items)
      return
    }
    // A 201 without a body names neither the request nor Lab's answer: the save is said, not Lab's acceptance.
    if (activeLab && !saved) {
      setSuccess('Active lab request created; check it in the list.')
      await loadRecords(kind, FIRST_PAGE, true)
      return
    }
    // An EHR before #56 reports no handoff: its 201 for an active request meant Lab accepted it.
    // So does #56's, unless it names another state: a 201 never means Lab failed (that is a 409 or 502).
    const outcome: LabOutcome | null = !activeLab ? null : saved.labHandoff === undefined ? { accepted: true, text: 'Active lab request created and accepted by Lab.' }
      : saved.labHandoff?.state === 'accepted' ? { accepted: true, text: 'Active lab request created and accepted by Lab.' }
        : labHandoffOutcome(saved.labHandoff ?? null, 'created', canSendToLab)
    if (!outcome || outcome.accepted) setSuccess(outcome?.text ?? 'Clinical record saved by the backend.')
    const items = await loadRecords(kind, FIRST_PAGE, true)
    if (outcome && !outcome.accepted) labWarning(outcome.text, typeof saved?.id === 'string' ? saved.id : undefined, items, outcome)
  }

  async function changeEncounterStatus(status: string, reason: string) {
    if (!selected || !facility || !patientId || !canMutate) return
    const expectedRowVersion = rowVersion(selected.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the encounter before changing its status.')
    setSuccess(''); setError('')
    await verify()
    let updated: Encounter
    try {
      updated = await staffApi.updateEncounter(facility.id, patientId, selected.id, {
        expectedRowVersion, changeReason: reason, status,
        ...(status === 'completed' ? { endedAt: isoNow() } : {}),
      })
    } catch (caught) {
      if (isHidApiError(caught) && caught.status === 403 && caught.code === 'ENCOUNTER_RETRACTION_NOT_PERMITTED') {
        throw new Error(retractionNotPermitted(status))
      }
      // Someone changed the encounter first: show it as it is now (the status
      // form is rebuilt for it) and say why the change was not made.
      if (!isHidApiError(caught) || (caught.status !== 409 && caught.status !== 412)) throw caught
      const current = await staffApi.encounter(facility.id, patientId, selected.id).catch(() => null)
      if (!current) throw caught
      setSelection(chosen => chosen?.id === current.id ? current : chosen)
      setEncounters(items => items.map(item => item.id === current.id ? current : item))
      setError('This encounter changed since it was loaded and now shows its current status. Choose the change again if it is still needed.')
      focus([`encounter-${selected.id}-status`, 'clinical-documentation-title'], true)
      return
    }
    // The changed encounter may not be on the page shown; it stays documented as changed.
    if (updated?.id) setSelection(current => current?.id === updated.id ? updated : current)
    await loadEncounters({ cursors: 'shown', fresh: true })
    // The answer does not carry the records it closed (hid-system #64; since #74 only their ids, in
    // `cascade`): they are read again, in the tab shown now, which the clinician may have changed
    // while the change was sent.
    if (CLOSING_STATUSES.has(status)) {
      const [, , shownEncounter, shownTab] = JSON.parse(recordScopeShown.current) as unknown[]
      if (shownEncounter === selected.id && typeof shownTab === 'string' && shownTab !== 'documents') await loadRecords(shownTab as RecordKind, 'shown', true)
    }
    setSuccess('Encounter status updated.')
    focus([`encounter-${selected.id}-status`, 'clinical-documentation-title'], true)
  }

  async function changeRecordStatus(record: ClinicalRecord, kind: StatusRecordKind, status: string, reason: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the record before changing its status.')
    // Since hid-system #56 a lab request left active is sent to Lab, and the answer says how that went.
    const toLab = kind === 'lab-requests' && status === 'active'
    setSuccess('')
    if (toLab) setError('')
    await verify()
    const saved = await staffApi.updateRecord(facility.id, patientId, encounterId, kind, record.id,
      { expectedRowVersion, changeReason: reason, status })
    // An EHR before #56 reports no handoff, and sent nothing to Lab.
    const outcome = toLab ? labHandoffOutcome(saved?.labHandoff ?? null, record.status === 'on_hold' ? 'resumed' : 'activated', canSendToLab) : null
    if (!outcome || outcome.accepted) setSuccess(outcome?.text ?? (kind === 'clinical-notes' ? 'Clinical note status updated.'
      : kind === 'lab-requests' ? 'Lab request status updated.' : 'Prescription status updated.'))
    const items = await loadRecords(kind, 'shown', true)
    if (outcome && !outcome.accepted) return labWarning(outcome.text, record.id, items, outcome)
    const form = kind === 'clinical-notes' ? 'note' : kind === 'lab-requests' ? 'lab-request' : 'prescription'
    focus([`${form}-${record.id}-status`, `record-${record.id}-title`, 'clinical-records-title'], true)
  }

  // Sends a saved active lab request to Lab at the version shown (hid-system #56).
  // A refusal that means the request changed reads the list again and says so above
  // it; any other is said at the control, which keeps its attempt's key to send again.
  async function sendLabRequest(record: ClinicalRecord, key: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new LabSendError('Reload the lab request before sending it to Lab.', false)
    setSuccess(''); setError('')
    await verify()
    try { await staffApi.sendLabRequestToLab(facility.id, patientId, encounterId, record.id, expectedRowVersion, key) }
    catch (caught) {
      const refusal = labSendRefusal(caught)
      if (!refusal.reload) throw new LabSendError(refusal.text, refusal.retry === true)
      const items = await loadRecords('lab-requests', 'shown', true)
      labWarning(refusal.text, record.id, items, { sendable: refusal.sendable === true, listChanged: true })
      return
    }
    setSuccess('Lab accepted this lab request at its current version.')
  }

  /** The order's latest route to another facility; undefined when the EHR sent none (its routes could not be read). */
  function orderRouteOf(record: ClinicalRecord): OrderRouteSummary | null | undefined { return readOrderRoute(record.orderRoute) }
  /** An order that may be sent: a draft or active one, with no route in force (or one that may be sent again). */
  function mayBeSent(record: ClinicalRecord): boolean {
    const route = orderRouteOf(record)
    return (record.status === 'draft' || record.status === 'active') && route !== undefined && (route === null || route.resendAllowed)
  }
  /** A lab request's status choices: every change of one sent to another facility is passed on there. */
  function labChoices(record: ClinicalRecord): readonly StatusOption[] {
    return routedElsewhere(orderRouteOf(record)) ? ROUTED_LAB_CHOICES[String(record.status)] ?? [] : labRequestChoices(String(record.status), canSendToLab)
  }

  /** The kind of an order list, as order routes name it. */
  function routeKindOf(kind: RecordKind): OrderRouteKind { return kind === 'lab-requests' ? 'lab_request' : 'prescription' }

  /**
   * Sends a saved order to another facility at the version shown (Novu, P4c). A refusal that means the list is out of
   * date reads it again and says why above it; any other is said in the send form, which keeps its key to send again.
   */
  async function sendOrder(kind: 'lab-requests' | 'prescriptions', record: ClinicalRecord, destination: OrderDestination,
    attestationTextVersion: string, key: string) {
    if (!facility || !patientId || !encounterId) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the list before sending it.')
    setSuccess(''); setError('')
    await verify()
    try {
      await orderRoutesApi.send(facility.id, patientId, encounterId, routeKindOf(kind), record.id,
        { expectedRowVersion, receivingFacilityId: destination.facilityId, attestationTextVersion }, key)
    } catch (caught) {
      const refusal = sendRefusal(caught, routeKindOf(kind), destination.facilityName, routeContext.patient)
      if (!refusal.reload) throw caught
      const items = await loadRecords(kind, 'shown', true)
      setError(`${refusal.text}${reloadSentence(items, kind === 'lab-requests' ? 'lab request' : 'prescription', true)}`)
      focus([`record-${record.id}-title`, 'clinical-records-title'], true)
      return
    }
    setSuccess(`${kind === 'lab-requests' ? 'Lab request' : 'Prescription'} sent to ${destination.facilityName}. It waits there until ${destination.facilityName} accepts it, and ${routeContext.patient} is told in the Health ID app.`)
    await loadRecords(kind, 'shown', true)
    focus([`order-route-${record.id}-title`, `record-${record.id}-title`, 'clinical-records-title'], true)
  }

  /**
   * Creates a lab request as a draft and sends it to the laboratory chosen (Novu, P4c SPEC 13.1): two requests, each
   * with its own key. A create that fails is the form's to say; once saved, a refused send leaves the draft, said so.
   */
  async function createAndSend(body: object, key: string, send: CreateAndSend) {
    if (!facility || !patientId || !encounterId) return
    if (!canMutate) throw new Error('This access does not permit changes to the patient record.')
    setSuccess(''); setError('')
    await verify()
    const saved = await staffApi.createRecord(facility.id, patientId, encounterId, 'lab-requests', body, key)
    const savedId = typeof saved?.id === 'string' ? saved.id : undefined
    const savedVersion = rowVersion(saved?.rowVersion)
    let notSent: string | null = null
    if (!savedId || !savedVersion) notSent = 'the saved request could not be read back. Find it in the list and use Send to another laboratory on it.'
    else {
      try {
        await orderRoutesApi.send(facility.id, patientId, encounterId, 'lab_request', savedId,
          { expectedRowVersion: savedVersion, receivingFacilityId: send.destination.facilityId,
            attestationTextVersion: send.attestationTextVersion }, crypto.randomUUID())
      } catch (caught) {
        notSent = sendRefusal(caught, 'lab_request', send.destination.facilityName, routeContext.patient).text
      }
    }
    const items = await loadRecords('lab-requests', FIRST_PAGE, true)
    if (notSent) {
      setError(`${savedNotSent(notSent)}${reloadSentence(items, 'lab requests', false)}`)
      focus(savedId ? [`record-${savedId}-route-open`, `record-${savedId}-title`, 'clinical-records-title'] : ['clinical-records-title'], true)
      return
    }
    setSuccess(`Lab request created and sent to ${send.destination.facilityName}. It waits there until ${send.destination.facilityName} accepts it, and ${routeContext.patient} is told in the Health ID app.`)
    if (savedId) focus([`order-route-${savedId}-title`, `record-${savedId}-title`, 'clinical-records-title'], true)
  }

  /** Withdraws a route still waiting for the receiving facility; the list is read again either way it ends. */
  async function withdrawRoute(kind: 'lab-requests' | 'prescriptions', record: ClinicalRecord, route: OrderRouteSummary,
    reason: OrderRouteWithdrawReason) {
    if (!facility || !patientId || !encounterId) return
    setSuccess(''); setError('')
    try {
      await orderRoutesApi.withdraw(facility.id, patientId, encounterId, routeKindOf(kind), record.id, route, reason)
    } catch (caught) {
      const refusal = withdrawRefusal(caught)
      if (!refusal.reload) throw caught
      await loadRecords(kind, 'shown', true)
      setError(refusal.text)
      focus([`order-route-${record.id}-title`, `record-${record.id}-title`, 'clinical-records-title'], true)
      return
    }
    setSuccess(`Withdrawn from ${route.receivingFacility.name ?? 'the other facility'}. ${routeContext.patient} is told in the Health ID app.`)
    await loadRecords(kind, 'shown', true)
    focus([`record-${record.id}-route-open`, `record-${record.id}-title`, 'clinical-records-title'], true)
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
    await loadRecords('diagnoses', 'shown', true)
    focus([`diagnosis-${record.id}-clinical`, `record-${record.id}-title`, 'clinical-records-title'], true)
  }

  async function correctVital(record: ClinicalRecord, replacementValues: VitalMeasurements, reason: string, key: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the vitals before correcting them.')
    setSuccess('')
    await verify()
    try {
      await staffApi.correctVital(facility.id, patientId, encounterId, record.id,
        { expectedRowVersion, changeReason: reason, replacementValues }, key)
    } catch (caught) {
      // Changed since it was loaded: corrected, or (hid-system #74) marked entered in error on its
      // own or with its encounter. Either change raises its row version, which EHR checks first, so
      // it answers 412; 409 VITAL_NOT_AMENDABLE answers only the version of a vital already entered
      // in error, which offers no correction here. What was shown is read again, the form, built for
      // the old version, goes, and what is said follows the vital as read.
      if (!isHidApiError(caught) || (caught.status !== 412 && caught.code !== 'VITAL_NOT_AMENDABLE')) throw caught
      const items = await loadRecords('vitals', 'shown', true)
      const retracted = caught.code === 'VITAL_NOT_AMENDABLE'
        || (Array.isArray(items) && items.some(item => item.id === record.id && item.status === 'entered_in_error'))
      setError(`${retracted ? 'These vitals were marked entered in error since they were loaded, so the correction was not saved.'
        : 'These vitals changed since they were loaded, so the correction was not saved: check them, and correct them again if it is still needed.'}${reloadSentence(items, 'vitals', true)}`)
      focus([`record-${record.id}-title`, 'clinical-records-title'], true)
      return
    }
    setSuccess('Vital correction saved.')
    await loadRecords('vitals', 'shown', true)
    // The rebuilt vitals show their correction only once it is read, so the record itself takes focus.
    focus([`record-${record.id}-title`, 'clinical-records-title'], true)
  }

  async function handoffPrescription(record: ClinicalRecord, reason: string, key: string) {
    if (!facility || !patientId || !encounterId || !canMutate) return
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the prescription before sending it to Pharmacy.')
    setSuccess('')
    await verify()
    try { await staffApi.acceptPrescription(facility.id, patientId, encounterId, record.id, expectedRowVersion, reason, key) }
    catch (caught) {
      if (!isHidApiError(caught)) throw caught
      // Pharmacy holds one work item per prescription (hid-system #48), whatever version it was sent.
      // Whether it can still dispense that work depends on migration 0080, which no response shows.
      if (caught.code === 'IDEMPOTENCY_CONFLICT') throw new Error('Pharmacy already holds work for this prescription, sent earlier, perhaps at an earlier version or with another reason, so it was not sent again. If the prescription changed since, contact the pharmacy: it may refuse to dispense the version it holds, and if it cannot dispense it, create a new prescription and send that.')
      // The prescription changed under the handoff: what was shown is read again, and the form, built for the old version, goes.
      const changed = caught.code === 'PHARMACY_PRESCRIPTION_NOT_ELIGIBLE'
        ? 'This prescription no longer matches what was sent (it was changed, put on hold or cancelled meanwhile), so Pharmacy did not accept it.'
        : caught.status === 412 ? 'This prescription changed since it was loaded, so it was not sent to Pharmacy: check it, and send it again if it is still needed.'
          : caught.code === 'PRESCRIPTION_NOT_ELIGIBLE' ? 'This prescription is no longer active, so it was not sent to Pharmacy.'
            // Novu since P4c: it is sent to (or was accepted by) a pharmacy at another facility.
            : caught.code === 'PRESCRIPTION_ROUTED' ? 'This prescription was sent to a pharmacy at another facility, so this facility’s Pharmacy can’t take it.' : null
      if (!changed) throw caught
      const items = await loadRecords('prescriptions', 'shown', true)
      setError(`${changed}${reloadSentence(items, 'prescription', true)}`)
      focus([`handoff-${record.id}-reason`, `record-${record.id}-title`, 'clinical-records-title'], true)
      return
    }
    setSuccess('Pharmacy accepted this exact prescription version.')
  }

  return <>
    <div className="staff-page-head"><p className="staff-eyebrow">Clinical record · {facility.name}</p><h1>{activePatient.lookup.patient.fullName ?? activePatient.hid}</h1><p>HID {activePatient.hid} · Direct care access. The server rechecks authorization before changes.</p></div>
    <div className="staff-row staff-toolbar"><Badge tone="success">Authorized</Badge><Button tone="secondary" size="sm" aria-disabled={loading || undefined} className={UNAVAILABLE} onClick={() => { if (!loading) void loadEncounters({ cursors: 'shown', fresh: true }) }}>Refresh encounters</Button><Link className="staff-text-link" to="/provider/patients">Change patient →</Link></div>
    {currentWriteAccess && !currentWriteAccess.allowed && <div className="staff-notice" role="status">{currentWriteAccess.failed
      ? 'Write access could not be confirmed, so changes are unavailable. Refresh the page to try again.'
      : 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'}</div>}
    {error && <p className="staff-error" role="alert">{error}</p>}
    {/* Mounted throughout, so what a change says is announced. */}
    <div id="clinical-status" role="status">{success && <p className="staff-success">{success}</p>}</div>
    {/* Off unless the build turns them on: hid-system main does not serve their routes (stagingOnlyFeatures.ts). */}
    {!usesNovuBackend() && permissions.includes('ehr.imported-history.read') && activePatient.purpose === 'direct-care' && <StaffImportedHistory
      key={JSON.stringify([state.status === 'ready' ? state.session.actor.id : '', facility.id, patientId, activePatient.purpose, permissions])}
      facilityId={facility.id} patientId={patientId!} />}
    {permissions.includes(usesNovuBackend() ? 'ehr.note.read' : 'ehr.record-chat.use') && activePatient.purpose === 'direct-care' && staffPatientChatEnabled() && <StaffPatientChat
      key={JSON.stringify([state.status==='ready'?state.session.actor.id:'',facility.id,facility.membershipId,patientId,activePatient.purpose,permissions])}
      facilityId={facility.id} facilityName={facility.name} patientId={patientId!}
      patientName={activePatient.lookup.patient.fullName??activePatient.hid} hid={activePatient.hid} />}
    {permissions.includes('ehr.note.read') && importedRecordsEnabled() && <ImportedPatientHistory
      key={JSON.stringify([state.status === 'ready' ? state.session.actor.id : '', facility.id, patientId, activePatient.purpose, permissions])}
      facilityId={facility.id} patientId={patientId!} purpose="direct-care" verify={verify}
      canDownload={permissions.includes('ehr.document.read')} />}
    <div className="staff-two-col staff-encounter-grid"><Card className="staff-card"><h2>Encounters</h2>{loading && <p role="status">Loading encounters…</p>}
      <Notice notice={encounterNotice} scope={encounterScope} />
      <Pager label="Encounter pages" position={encounterPosition} busy={loading} onShow={cursors => void loadEncounters({ cursors, paging: true })} />
      {selected && !scopedEncounters.some(item => item.id === selected.id) && <p className="staff-muted">The encounter being documented, {selected.encounterType.replace('_', ' ')} started {new Date(selected.startedAt).toLocaleString()}, is on another page.</p>}
      {!loading && scopedEncounters.length === 0 && <p>No encounters are available for this patient and facility.</p>}<div className="staff-list">{scopedEncounters.map(item => <button type="button" key={item.id} className={`staff-list-item staff-select-row${item.id === encounterId ? ' selected' : ''}`} aria-current={item.id === encounterId ? 'true' : undefined} onClick={() => setSelection(item)}><strong>{item.encounterType.replace('_', ' ')} · {item.status.replace('_', ' ')}</strong><p>{new Date(item.startedAt).toLocaleString()}</p><p>{item.chiefComplaint || 'No chief complaint provided'}</p></button>)}</div>
</Card>{permissions.includes('ehr.encounter.write') && canMutate && <EncounterForm onCreated={createEncounter} disabled={!facility} />}</div>
    {selected && <section className="staff-section" aria-labelledby="clinical-documentation-title"><div className="staff-page-head"><p className="staff-eyebrow">Selected encounter</p><h2 id="clinical-documentation-title" tabIndex={-1}>Care documentation</h2><p>{new Date(selected.startedAt).toLocaleString()} · {selected.status.replace('_', ' ')}</p></div>
      {canMutate && permissions.includes('ehr.encounter.write') && (encounterTransitions[selected.status]?.length ?? 0) > 0 &&
        <Card className="staff-card"><StatusActionForm key={`${selected.id}-${selected.rowVersion}`} id={`encounter-${selected.id}`} title="Encounter status"
          choices={encounterTransitions[selected.status]!} warning={encounterClosesRecords()} disabled={loading} onChange={changeEncounterStatus} /></Card>}
      {!activeTab ? <p className="staff-muted">Your current facility role does not grant access to encounter records.</p>
        : <><TabList items={visibleTabs} selectedId={activeTab} onSelect={id => setTab(id as RecordKind | 'documents')} label="Clinical record section"
          idPrefix="clinical-record" className="staff-tabs" />
        <TabPanel id={activeTab} idPrefix="clinical-record">{activeTab === 'documents' ? <Documents key={selected.id} patientId={patientId!} encounterId={selected.id} facilityId={facility.id} canWrite={canMutate && permissions.includes(writePermissions.documents)} canOcr={permissions.includes('ocr.job.read')} verify={verify} /> : <div className="staff-two-col"><Card className="staff-card"><h2 id="clinical-records-title" tabIndex={-1}>{tabs.find(item => item.id === activeTab)?.label}</h2>{recordsLoading && <p role="status">Loading records…</p>}
        <Notice notice={recordNotice} scope={recordScope} />
        <Pager label="Record pages" position={recordPosition} busy={recordsLoading} onShow={cursors => void loadRecords(activeTab, cursors, false)} />
        {!recordsLoading && visibleRecords.length === 0 && <p>No {tabs.find(item => item.id === activeTab)?.label.toLowerCase()} for this encounter.</p>}<div className="staff-list">{visibleRecords.map(record => <div className="staff-list-item staff-stack" key={record.id}><strong id={`record-${record.id}-title`} tabIndex={-1}>{recordTitle(activeTab, record)}</strong>
        {activeTab === 'diagnoses' && record.verificationStatus === 'entered_in_error' && <Badge tone="warning">Entered in error</Badge>}
        {activeTab === 'vitals' ? <VitalPanel key={`${record.id}-${String(record.rowVersion)}`} facilityId={facility.id} patientId={patientId!} encounterId={selected.id}
          vital={record} canCorrect={canMutate && permissions.includes('ehr.vital.write')} disabled={recordsLoading}
          onCorrect={(values, reason, key) => correctVital(record, values, reason, key)} /> : <p>{recordDetail(activeTab, record)}</p>}
        <Detail label="Recorded" value={record.createdAt ? new Date(record.createdAt).toLocaleString() : ''} />
        {activeTab === 'clinical-notes' && <NotePanel facilityId={facility.id} patientId={patientId!} encounterId={selected.id}
          note={record} canWrite={canMutate && permissions.includes('ehr.note.write')} verify={verify}
          onStatus={(status, reason) => changeRecordStatus(record, 'clinical-notes', status, reason)}
          onChanged={async () => { await loadRecords('clinical-notes', 'shown', true) }} />}
        {activeTab === 'prescriptions' && canMutate && permissions.includes('ehr.prescription.write') && (prescriptionTransitions[String(record.status)]?.length ?? 0) > 0 &&
          <StatusActionForm key={`${record.id}-${record.rowVersion}`} id={`prescription-${record.id}`} title="Prescription status" choices={prescriptionTransitions[String(record.status)]!}
            warning={routedElsewhere(orderRouteOf(record)) ? routedChangeWarning(orderRouteOf(record)?.receivingFacility.name)
              : record.status === 'active' || record.status === 'on_hold' ? PHARMACY_NOT_TOLD : undefined}
            disabled={recordsLoading} onChange={(status, reason) => changeRecordStatus(record, 'prescriptions', status, reason)} />}
        {activeTab === 'prescriptions' && record.status === 'active' && canMutate && permissions.includes('pharmacy.work-item.accept') && !routedElsewhere(orderRouteOf(record)) &&
          <ReasonActionForm key={`handoff-${record.id}-${record.rowVersion}`} id={`handoff-${record.id}`} title="Send active prescription to Pharmacy" actionLabel="Send to Pharmacy"
            minLength={8} disabled={recordsLoading} onAction={(reason, key) => handoffPrescription(record, reason, key)} />}
        {activeTab === 'diagnoses' && canMutate && permissions.includes('ehr.diagnosis.write') && record.verificationStatus !== 'entered_in_error' &&
          <DiagnosisUpdateForm key={`${record.id}-${String(record.rowVersion)}`} id={`diagnosis-${record.id}`} diagnosis={record}
            disabled={recordsLoading} onUpdate={(changes, reason) => updateDiagnosis(record, changes, reason)} />}
        {activeTab === 'lab-requests' && canMutate && permissions.includes('ehr.lab-request.write') && labChoices(record).length > 0 &&
          <StatusActionForm key={`${record.id}-${String(record.rowVersion)}`} id={`lab-request-${record.id}`} title="Lab request status" choices={labChoices(record)}
            warning={routedElsewhere(orderRouteOf(record)) ? routedChangeWarning(orderRouteOf(record)?.receivingFacility.name) : undefined}
            disabled={recordsLoading} onChange={(status, reason) => changeRecordStatus(record, 'lab-requests', status, reason)} />}
        {activeTab === 'lab-requests' && canMutate && permissions.includes('ehr.lab-request.write') && LAB_NOT_TOLD[String(record.status)] && !routedElsewhere(orderRouteOf(record)) &&
          <p className="staff-muted">{LAB_NOT_TOLD[String(record.status)]}</p>}
        {activeTab === 'lab-requests' && canMutate && permissions.includes('ehr.lab-request.write') && !canSendToLab && LAB_SENT_BY_OTHERS[String(record.status)] && !routedElsewhere(orderRouteOf(record)) &&
          <p className="staff-muted">{LAB_SENT_BY_OTHERS[String(record.status)]}</p>}
        {activeTab === 'lab-requests' && record.status === 'active' && canMutate && permissions.includes('ehr.lab-request.write') && canSendToLab && !routedElsewhere(orderRouteOf(record)) &&
          <SendToLab key={`send-${record.id}-${String(record.rowVersion)}`} requestId={record.id} disabled={recordsLoading}
            onSend={key => sendLabRequest(record, key)} />}
        {/* A draft never reached Lab; any other request may have, before or after a change. One sent to another
            facility comes back through its route instead (Novu, P4c). */}
        {activeTab === 'lab-requests' && record.status !== 'draft' && permissions.includes('lab.result.released.read') && !routedElsewhere(orderRouteOf(record)) &&
          <ReleasedResults key={`results-${record.id}`} facilityId={facility.id} requestId={record.id} />}
        {(activeTab === 'lab-requests' || activeTab === 'prescriptions') && novu && orderRouteOf(record) &&
          <OrderRoutePanel key={`route-${record.id}-${orderRouteOf(record)!.id}-${orderRouteOf(record)!.version}`} id={`order-route-${record.id}`}
            kind={routeKindOf(activeTab)} route={orderRouteOf(record)!} context={routeContext} canWithdraw={canWithdrawRoutes}
            onWithdraw={(route, reason) => withdrawRoute(activeTab, record, route, reason)}
            loadViews={() => orderRoutesApi.routes(facility.id, patientId!, selected.id, routeKindOf(activeTab), record.id).then(answer => answer.items)} />}
        {(activeTab === 'lab-requests' || activeTab === 'prescriptions') && canRoute(activeTab) && mayBeSent(record) &&
          <SendToFacility key={`send-route-${record.id}`} id={`record-${record.id}-route`} kind={routeKindOf(activeTab)} context={routeContext}
            priority={typeof record.priority === 'string' ? record.priority : undefined}
            onSend={(destination, version, key) => sendOrder(activeTab, record, destination, version, key)} />}
      </div>)}</div></Card>{canMutate && permissions.includes(writePermissions[activeTab]) && <RecordForm key={`${selected.id}-${activeTab}`} tab={activeTab} onCreated={createRecord} disabled={!selected} canSendToLab={canSendToLab}
        routing={activeTab === 'lab-requests' && canRoute('lab-requests') ? routeContext : null} onCreateAndSend={createAndSend}
        prescriptionRouting={activeTab === 'prescriptions' && canRoute('prescriptions')} />}</div>}</TabPanel></>}
    </section>}
  </>
}
