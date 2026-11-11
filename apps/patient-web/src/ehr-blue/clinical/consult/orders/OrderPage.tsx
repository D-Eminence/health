import { isHidApiError, PlainError, plainErrorText } from '@hid/http'
import { EhrBackButton, EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  orderRoutesApi, staffApi, type ClinicalRecord, type OrderDestination, type OrderRouteSummary, type OrderRouteWithdrawReason,
} from '../../../../staff/api'
import { parsePrescriptionAllergyAcknowledgements, type AllergyAcknowledgement } from '../../../../staff/allergies'
import { refusalText } from '../../../../staff/fieldProblem'
import { routedChangeWarning, routedElsewhere, sendRefusal, withdrawRefusal } from '../../../../staff/orderRoutes'
import { sendLabel, type RouteContext } from '../../../../staff/routes/OrderRoutes'
import { useLateCorrectionServed } from '../../../../lateCorrectionServed'
import { useWrongPatientServed } from '../../../../wrongPatientServed'
import {
  ALLERGY_GO_AHEAD_ERROR, acknowledgementRefused, readAllergyRefusal, useAllergyAcknowledgement, withAllergyAcknowledgement,
  type AllergyAcknowledgementState, type AllergyRefusal,
} from '../../parts/allergyWarning'
import { AllergyWarningPanel } from '../../parts/AllergyWarningPanel'
import type { Chart } from '../../parts/chart'
import { LabResultPaper, PrescriptionPaper, drugLine, isPrintable, paperPatient, prescriberName, usePaperPrint } from '../../parts/clinicalPrint'
import { ActionList, ConfirmAction, DetailGrid, DetailMeta, SavedRecord } from '../../parts/Detail'
import { formatWhen } from '../../parts/format'
import type { KeyValue } from '../../parts/KeyValueList'
import { Value } from '../../../../kasuwa/parts'
import { ErrorBox, Loading, NoActions, RecordNotFound } from '../../parts/Notices'
import { RecordForm, type FieldErrors, type FormValues, type SubmitOutcome } from '../../parts/RecordForm'
import { useClinical, useWorkspaceHref } from '../../parts/Workspace'
import { RELOAD_FAILED } from '../encounters'
import { KINDS, mayBeSent, orderRights, orderTitle, patientWord, priorityText, readOrder, routeOf, text, useFlash, type OrderKind } from './orders'
import { AllergyOverrides, OVERRIDES_NOT_SHOWN } from './AllergyOverrides'
import { ACK_REFUSED_ERROR, storedMedicine, warnAfterRefusal } from './prescribingAllergies'
import { ReleasedResults } from './Results'
import { RouteCard, SendElsewhere } from './Routing'
import {
  LAB_NOT_TOLD, LAB_SEND_HINT, LAB_SENT_BY_OTHERS, labHandoffOutcome, labRequestChoices, labSendRefusal, PHARMACY_ALREADY_HOLDS,
  PHARMACY_NOT_TOLD, prescriptionChanged, PRESCRIPTION_TRANSITIONS, reloadSentence, ROUTED_LAB_CHOICES, rowVersion,
  type Reload, type StatusOption,
} from './words'

const TITLE_ID = 'order-title'
const ACTIONS_ID = 'order-actions-title'
const ROUTE_TITLE_ID = 'order-route-title'
const actionId = (id: string) => `order-action-${id}`

/** Today's Send to Lab refusal, and whether pressing again is the same send (the key is kept). */
class LabSendError extends PlainError {
  constructor(message: string, readonly retry: boolean) { super(message) }
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly text: string }
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly record: ClinicalRecord; readonly crossFacilityOrders: boolean }

interface Action {
  readonly id: string
  readonly label: string
  readonly toggle?: boolean
  /** Prints the order: no form opens, and it is never locked while the order is read again. */
  readonly print?: boolean
}

/**
 * The page's error. After a change whose read of the order failed it has "Try again" beside it (`again`), and counts
 * how many times it has been said, so a failure said again in the same words is announced again.
 */
type PageError = { readonly text: string; readonly again: boolean; readonly said?: number }
const NO_ERROR: PageError = { text: '', again: false }

/** Today's sentence after a change whose read of the order failed (Clinical.tsx loadRecords), with "Try again" beside it. */
function reloadFailed(caught: unknown): PageError {
  return { text: `${RELOAD_FAILED} ${refusalText(caught, '')}`.trim(), again: true }
}

function reason(values: FormValues): string {
  const value = values.reason
  return typeof value === 'string' ? value.trim() : ''
}

/** Today's reason check: "Give a reason of at least {n} characters." */
function minimum(values: FormValues, length: number): FieldErrors {
  return reason(values).length < length ? { reason: `Give a reason of at least ${length} characters.` } : {}
}

/** "Cancel" alone would sit beside the dialog's own Cancel: the design's label for the same change is used. */
function statusLabel(option: StatusOption) {
  return option.value === 'cancelled' ? 'Cancel order' : option.label
}

/**
 * The design's record page for one prescription or lab request of this encounter: meta line, "Saved record",
 * "Available actions" (today's status changes, Send to Pharmacy, Send to Lab, sending to another facility, released
 * results), then what became of an order sent elsewhere, as today's receiving facility reported it.
 */
export function OrderPage({ kind, chart, encounterId, orderId }: { kind: OrderKind; chart: Chart; encounterId: string; orderId: string }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const { flash, setFlash } = useFlash()
  const info = KINDS[kind]
  const lab = kind === 'laboratory'
  const back = href(encounterId)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  // Arrived from the create page: what it said is shown here whatever the read below finds, as today's page says it
  // beside the list after a create (Clinical.tsx createRecord), so a save or a "Do not create it again" is never lost.
  const [created] = useState(() => flash?.orderId === orderId ? flash : null)
  const afterCreate = created !== null
  const [success, setSuccess] = useState(() => created?.success ?? '')
  const [pageError, showPageError] = useState<PageError>(NO_ERROR)
  const setPageError = (text: string) => showPageError(text ? { text, again: false } : NO_ERROR)
  // The order is being read again after a change: no change may start from the version shown (today's recordsLoading).
  const [reloading, setReloading] = useState(false)
  // Only the latest read of the order is kept, and only it lifts the lock: today's recordLoad sequence, shared by the
  // first read and the reads after a change (Clinical.tsx:1319-1334, :1417, :1426, :1435, :1440).
  const readSeq = useRef(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [resultsRevision, setResultsRevision] = useState(0)
  const [asking, setAsking] = useState<{ label: string; description?: string; answer: (yes: boolean) => void } | null>(null)
  const [focusIds, setFocusIds] = useState<readonly string[] | null>(null)
  const pharmacyAttempt = useRef<{ reason: string; key: string } | null>(null)
  const labAttempt = useRef<string | null>(null)
  const chartRef = useRef(chart)
  chartRef.current = chart
  const wrongPatientServed = useWrongPatientServed() === true
  const lateCorrectionServed = useLateCorrectionServed() === true
  const { print, area: printArea } = usePaperPrint()
  const { state: staffState } = useClinical()
  const actor = staffState.status === 'ready' ? staffState.session.actor : null

  // What the create page said is shown here once; it is never kept anywhere else.
  useEffect(() => { if (flash) setFlash(null) }, [])

  useLayoutEffect(() => {
    if (!focusIds) return
    for (const id of focusIds) {
      const element = document.getElementById(id)
      if (element) { element.focus(); break }
    }
    setFocusIds(null)
  }, [focusIds])

  const { facilityId, patientId } = chart
  useEffect(() => {
    const seq = ++readSeq.current
    const latest = () => seq === readSeq.current
    // After a create the list is read afresh, as today's page reads it after a change (Clinical.tsx loadRecords). This
    // is the create's one read: a warning it left ends with what the read came to (reloadSentence), and a failed read
    // is said there, not again ("The change was saved, …"), as today's labWarning and createAndSend replace it
    // (Clinical.tsx:1437, :1447-1448, :1659-1667).
    const warning = created?.warning
    const warn = (read: Reload) => {
      if (warning) setPageError(`${warning.text}${reloadSentence(read, warning.what, warning.listChanged)}`)
    }
    // The open patient's access is checked on the server again before the order is read, as the encounter and record
    // pages do: this page may be reached by its address alone (a link, the browser's Back, a return after signing in).
    chartRef.current.verify().then(() => readOrder(chartRef.current, encounterId, kind, orderId, afterCreate)).then(
      read => {
        if (!latest()) return
        warn(read.record ? [read.record] : [])
        setLoaded(read.record ? { status: 'ready', record: read.record, crossFacilityOrders: read.crossFacilityOrders } : { status: 'missing' })
        setReloading(false)
      },
      caught => {
        if (!latest()) return
        warn('failed')
        // After a create with nothing left to say, the page says the change was saved, with "Try again" beside it.
        if (afterCreate && !warning) showPageError(reloadFailed(caught))
        setLoaded({ status: 'error', text: afterCreate ? '' : plainErrorText(caught, 'Records could not be loaded.', { audience: 'facility' }) })
        setReloading(false)
      },
    )
    return () => { readSeq.current += 1 }
  }, [facilityId, patientId, encounterId, kind, orderId, afterCreate, created])

  /**
   * The order read again after a change, as today's page re-reads its list: the rows, or 'failed' once `failed` is
   * given the sentence (by default the page says it, with "Try again" beside it).
   */
  const reload = async (failed: (error: PageError) => void = showPageError): Promise<Reload> => {
    // Two reads can overlap (a withdrawal while a status change's read is out): an older answer is dropped (null, as
    // today's), and the lock stays until the latest read lands.
    const seq = ++readSeq.current
    setReloading(true)
    try {
      const read = await readOrder(chartRef.current, encounterId, kind, orderId, true)
      if (seq !== readSeq.current) return null
      setLoaded(read.record ? { status: 'ready', record: read.record, crossFacilityOrders: read.crossFacilityOrders } : { status: 'missing' })
      return read.record ? [read.record] : []
    } catch (caught) {
      if (seq !== readSeq.current) return null
      failed(reloadFailed(caught))
      return 'failed'
    } finally {
      if (seq === readSeq.current) setReloading(false)
    }
  }

  /**
   * "Try again": the order read again, fresh, as the change read it, with no access re-check (reads need none). While
   * it reads, the actions are locked, as after any change (a withdrawal is not, as today's is not). The sentence stays
   * until the order is read, then goes, focus moving from Try again to "Actions"; a change made meanwhile says its own
   * outcome, which this never replaces. A try that fails says the sentence again, so it is announced even in the same
   * words.
   */
  const tryAgain = async (event: { readonly currentTarget: HTMLButtonElement }) => {
    const button = event.currentTarget
    const shown = pageError
    const outcome = (next: PageError) => showPageError(current => current !== shown ? current : next)
    const read = await reload(failed => outcome({ ...failed, said: (shown.said ?? 0) + 1 }))
    if (read === 'failed' || read === null) return
    outcome(NO_ERROR)
    // Try again goes with the sentence: focus on it, or on nothing, moves to "Actions", never from elsewhere.
    const active = document.activeElement
    if (active === button || active === null || active === document.body) setFocusIds([ACTIONS_ID, TITLE_ID])
  }

  // What a change said, drawn on every state of the page below the loading one.
  const said = (
    <>
      <div role="status">{success ? <p className="hid-ehr-clinical-status">{success}</p> : null}</div>
      {pageError.text ? (
        <ErrorBox>
          <p key={pageError.said ?? 0}>{pageError.text}</p>
          {/* Busy, it stays focusable (aria-disabled, aria-busy), so focus stays on it, and a second press does nothing. */}
          {pageError.again ? <p><EhrButton variant="secondary" size="sm" onClick={tryAgain}>Try again</EhrButton></p> : null}
        </ErrorBox>
      ) : null}
    </>
  )

  if (loaded.status === 'loading') return <Loading label="Loading records…" />
  if (loaded.status === 'error') return <><RecordHeadingOnly title={info.title} back={back} />{said}{loaded.text ? <ErrorBox>{loaded.text}</ErrorBox> : null}</>
  // The page's heading first, then what the create said, as on the other states.
  if (loaded.status === 'missing') return <><RecordNotFound backHref={back} />{said}</>

  const record = loaded.record
  const status = text(record.status)
  const version = String(record.rowVersion)
  const route = routeOf(record)
  const routed = routedElsewhere(route)
  const rights = orderRights(chart, loaded.crossFacilityOrders)
  const canWrite = chart.canWrite && chart.can(info.write)
  const patient = patientWord(chart)
  const context: RouteContext = { facilityId: chart.facilityId, orderingFacility: chart.facilityName, patient }
  const title = orderTitle(kind, record)

  const choices: readonly StatusOption[] = !canWrite ? []
    : lab ? routed ? ROUTED_LAB_CHOICES[status] ?? [] : labRequestChoices(status, rights.canSendToLab)
      : PRESCRIPTION_TRANSITIONS[status] ?? []
  const warning = routed ? routedChangeWarning(route, patient, wrongPatientServed, lateCorrectionServed)
    : !lab && (status === 'active' || status === 'on_hold') ? PHARMACY_NOT_TOLD : undefined
  const sendPharmacy = !lab && status === 'active' && chart.canWrite && chart.can('pharmacy.work-item.accept') && !routed
  const sendLab = lab && status === 'active' && canWrite && rights.canSendToLab && !routed
  const results = lab && status !== 'draft' && chart.can('lab.result.released.read') && !routed
  const sendElsewhere = rights.canRoute(kind) && mayBeSent(record)
  // The reasons given on this prescription to go ahead over an allergy warning (7fbb04aa), whatever its status: null
  // from an EHR before 7fbb04aa, which does not say (the page says plainly it can't show them, never that there are none).
  const overrides = lab ? null : parsePrescriptionAllergyAcknowledgements(record.allergyAcknowledgements)
  const labNotes = lab && canWrite && !routed
    ? [LAB_NOT_TOLD[status], !rights.canSendToLab ? LAB_SENT_BY_OTHERS[status] : undefined].filter((note): note is string => Boolean(note)) : []

  const actions: Action[] = [
    ...choices.map(option => ({ id: `status-${option.value}`, label: statusLabel(option) })),
    ...(sendPharmacy ? [{ id: 'pharmacy', label: 'Send to Pharmacy' }] : []),
    ...(sendLab ? [{ id: 'lab', label: 'Send to Lab' }] : []),
    ...(sendElsewhere ? [{ id: 'route', label: sendLabel(info.route) }] : []),
    ...(results ? [{ id: 'results', label: resultsOpen ? 'Hide released results' : 'View released results', toggle: true }] : []),
    ...(!lab && isPrintable(record) ? [{ id: 'print', label: 'Print prescription', print: true }] : []),
  ]
  const printedAt = () => formatWhen(new Date().toISOString())
  const printPrescription = () => print('prescription', (
    <PrescriptionPaper facility={chart.facilityName} patient={paperPatient(chart.facts)} drugs={[drugLine(record)]}
      prescriber={prescriberName([record], actor)} printedAt={printedAt()} />
  ))
  const printResult = (test: string, lines: Parameters<typeof LabResultPaper>[0]['lines']) => print('lab-result', (
    <LabResultPaper facility={chart.facilityName} patient={paperPatient(chart.facts)} test={test} lines={lines} printedAt={printedAt()} />
  ))

  const confirm = (label: string, description?: string) => new Promise<boolean>(answer => setAsking({ label, description, answer }))

  /** A saved lab request Lab does not hold, or holds at another version: the change stands, so it is said as a warning. */
  const labWarning = (said: string, reloaded: Reload, { sendable = true, listChanged = false } = {}) => {
    setPageError(`${said}${reloadSentence(reloaded, 'request', listChanged)}`)
    setFocusIds(sendable ? [actionId('lab'), TITLE_ID] : [TITLE_ID])
  }

  /**
   * After the EHR's 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED on Activate, Resume or a send of this draft (0124): the warning
   * for the medicine the prescription holds, shown in the form that was sent, which answers what to say.
   */
  const warnAboutAllergies = (ack: AllergyAcknowledgementState, refusal: AllergyRefusal) =>
    warnAfterRefusal({ ack, refusal, medicine: storedMedicine(record), chart })

  /**
   * A status change. A prescription's Activate or Resume carries `allergyAcknowledgement` only when sent again after
   * the EHR's allergy warning, with the same version and reason for the change (nothing was written on the 409).
   */
  async function changeStatus(next: string, why: string, allergyAcknowledgement: AllergyAcknowledgement | null = null) {
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new PlainError('Reload the record before changing its status.')
    const toLab = lab && next === 'active'
    setSuccess('')
    if (toLab) setPageError('')
    await chart.verify()
    const saved = await staffApi.updateRecord(chart.facilityId, chart.patientId, encounterId, info.record, record.id,
      withAllergyAcknowledgement({ expectedRowVersion, changeReason: why, status: next }, lab ? null : allergyAcknowledgement))
    const outcome = toLab ? labHandoffOutcome(saved?.labHandoff ?? null, record.status === 'on_hold' ? 'resumed' : 'activated', rights.canSendToLab) : null
    if (!outcome || outcome.accepted) setSuccess(outcome?.text ?? (lab ? 'Lab request status updated.' : 'Prescription status updated.'))
    setSelected(null)
    const reloaded = await reload()
    if (outcome && !outcome.accepted) return labWarning(outcome.text, reloaded, outcome)
    setFocusIds([ACTIONS_ID])
  }

  async function handoffPrescription(why: string, key: string) {
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new PlainError('Reload the prescription before sending it to Pharmacy.')
    setSuccess('')
    await chart.verify()
    try {
      await staffApi.acceptPrescription(chart.facilityId, chart.patientId, encounterId, record.id, expectedRowVersion, why, key)
    } catch (caught) {
      if (!isHidApiError(caught)) throw caught
      if (caught.code === 'IDEMPOTENCY_CONFLICT') throw new PlainError(PHARMACY_ALREADY_HOLDS)
      const changed = prescriptionChanged(caught)
      if (!changed) throw caught
      setSelected(null)
      const reloaded = await reload()
      setPageError(`${changed}${reloadSentence(reloaded, 'prescription', true)}`)
      setFocusIds([TITLE_ID])
      return
    }
    setSuccess('Pharmacy accepted this exact prescription version.')
    setSelected(null)
    setFocusIds([actionId('pharmacy'), ACTIONS_ID])
  }

  async function sendLabRequest(key: string) {
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new LabSendError('Reload the lab request before sending it to Lab.', false)
    setSuccess('')
    setPageError('')
    await chart.verify()
    try {
      await staffApi.sendLabRequestToLab(chart.facilityId, chart.patientId, encounterId, record.id, expectedRowVersion, key)
    } catch (caught) {
      const refusal = labSendRefusal(caught)
      if (!refusal.reload) throw new LabSendError(refusal.text, refusal.retry === true)
      setSelected(null)
      const reloaded = await reload()
      labWarning(refusal.text, reloaded, { sendable: refusal.sendable === true, listChanged: true })
      return
    }
    setSuccess('Lab accepted this lab request at its current version.')
    setSelected(null)
    setFocusIds([actionId('lab'), ACTIONS_ID])
  }

  /**
   * Sends the order to another facility. A draft prescription's send is checked against the patient's allergies (0124):
   * it carries `allergyAcknowledgement` only when sent again after the EHR's warning, under the same key (nothing was
   * written on the 409, and the send's digest leaves the acknowledgement out). A lab request never carries one.
   */
  async function sendOrder(destination: OrderDestination, attestationTextVersion: string, key: string,
    allergyAcknowledgement: AllergyAcknowledgement | null = null) {
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new PlainError('Reload the list before sending it.')
    setSuccess('')
    setPageError('')
    await chart.verify()
    try {
      await orderRoutesApi.send(chart.facilityId, chart.patientId, encounterId, info.route, record.id,
        withAllergyAcknowledgement({ expectedRowVersion, receivingFacilityId: destination.facilityId, attestationTextVersion },
          lab ? null : allergyAcknowledgement), key)
    } catch (caught) {
      // The allergy warning, and a reason the EHR did not accept, are the send form's to show: the order is as it was.
      if (!lab && (readAllergyRefusal(caught, false) || (allergyAcknowledgement && acknowledgementRefused(caught)))) throw caught
      const refusal = sendRefusal(caught, info.route, destination.facilityName, patient)
      if (!refusal.reload) throw caught
      setSelected(null)
      const reloaded = await reload()
      setPageError(`${refusal.text}${reloadSentence(reloaded, info.what, true)}`)
      setFocusIds([TITLE_ID])
      return
    }
    setSuccess(`${lab ? 'Lab request' : 'Prescription'} sent to ${destination.facilityName}. It waits there until ${destination.facilityName} accepts it, and ${patient} is told in the Health ID app.`)
    setSelected(null)
    await reload()
    setFocusIds([ROUTE_TITLE_ID, TITLE_ID])
  }

  async function withdrawRoute(sent: OrderRouteSummary, why: OrderRouteWithdrawReason) {
    setSuccess('')
    setPageError('')
    try {
      await orderRoutesApi.withdraw(chart.facilityId, chart.patientId, encounterId, info.route, record.id, sent, why)
    } catch (caught) {
      const refusal = withdrawRefusal(caught)
      if (!refusal.reload) throw caught
      await reload()
      setPageError(refusal.text)
      setFocusIds([ROUTE_TITLE_ID, TITLE_ID])
      return
    }
    setSuccess(`Withdrawn from ${sent.receivingFacility.name ?? 'the other facility'}. ${patient} is told in the Health ID app.`)
    await reload()
    setFocusIds([actionId('route'), TITLE_ID])
  }

  const statusForm = (option: StatusOption) => (
    <StatusChange key={`status-${option.value}-${version}`} option={option} lab={lab} notice={warning} disabled={reloading}
      // "Cancel order?" says the form's warning (Pharmacy not told, or the other facility's change), when it has one.
      confirmCancel={() => confirm(statusLabel(option), warning)} onChange={changeStatus}
      // A prescription's Activate and Resume are checked against the patient's allergies by the EHR (0124).
      warnAboutAllergies={!lab && option.value === 'active' ? warnAboutAllergies : undefined} />
  )

  const pharmacyForm = (
    <div className="hid-ehr-clinical-orders-action-form">
      <p className="hid-ehr-clinical-orders-lead"><strong>Send active prescription to Pharmacy</strong></p>
      <RecordForm
        key={`pharmacy-${version}`}
        fields={[{ key: 'reason', label: 'Reason', required: true, maxLength: 500 }]}
        validate={values => minimum(values, 8)}
        submitLabel="Send to Pharmacy"
        busyLabel="Working…"
        disabled={reloading}
        onSubmit={async values => {
          const why = reason(values)
          if (pharmacyAttempt.current?.reason !== why) pharmacyAttempt.current = { reason: why, key: crypto.randomUUID() }
          try {
            await handoffPrescription(why, pharmacyAttempt.current.key)
            pharmacyAttempt.current = null
          } catch (caught) {
            return { formError: refusalText(caught, 'Send to Pharmacy could not be completed.') }
          }
        }}
      />
    </div>
  )

  const labForm = (
    <div className="hid-ehr-clinical-orders-action-form">
      <RecordForm
        key={`lab-${version}`}
        fields={[]}
        submitLabel="Send to Lab"
        busyLabel="Sending…"
        disabled={reloading}
        onSubmit={async () => {
          labAttempt.current ??= crypto.randomUUID()
          try {
            await sendLabRequest(labAttempt.current)
            labAttempt.current = null
          } catch (caught) {
            const retry = caught instanceof LabSendError ? caught.retry : true
            if (!retry) labAttempt.current = null
            return { formError: plainErrorText(caught, 'The lab request could not be sent to Lab.', { audience: 'facility' }) }
          }
        }}
      >
        <p className="hid-ehr-clinical-orders-muted">{LAB_SEND_HINT}</p>
      </RecordForm>
    </div>
  )

  const form: ReactNode = (() => {
    if (!selected) return null
    const option = choices.find(item => `status-${item.value}` === selected)
    if (option) return statusForm(option)
    if (selected === 'pharmacy' && sendPharmacy) return pharmacyForm
    if (selected === 'lab' && sendLab) return labForm
    if (selected === 'route' && sendElsewhere) {
      return <SendElsewhere key={`route-${version}`} kind={info.route} context={context} priority={lab ? text(record.priority) || undefined : undefined}
        onSend={sendOrder} onCancel={() => { setSelected(null); setFocusIds([actionId('route')]) }}
        warnAboutAllergies={lab ? undefined : warnAboutAllergies} />
    }
    return null
  })()

  const dose = text(record.doseQuantity)
  const items: KeyValue[] = lab ? [
    { label: 'Test', value: text(record.testDisplay) },
    { label: 'Code', value: [text(record.testCodeSystem), text(record.testCode)].filter(Boolean).join(' ') },
    { label: 'Priority', value: priorityText(record.priority) },
    { label: 'Specimen type', value: text(record.specimenTypeCode) },
    { label: 'Clinical information', value: text(record.clinicalInformation) },
    { label: 'Recorded', value: formatWhen(record.createdAt) },
  ] : [
    { label: 'Medicine', value: text(record.medicationDisplay) },
    // The dose always with its unit; a decimal with its leading zero (Value).
    { label: 'Dose', value: dose ? <Value value={dose.replace(/^\./, '0.')} unit={text(record.doseUnit) || null} /> : '' },
    { label: 'Route', value: text(record.routeCode) },
    { label: 'How often', value: text(record.frequency) },
    { label: 'Instructions', value: text(record.instructions) },
    { label: 'Recorded', value: formatWhen(record.createdAt) },
  ]

  return (
    <>
      <EhrPageHeading
        title={<span id={TITLE_ID} tabIndex={-1}>{title}</span>}
        back={<EhrBackButton label="Back to consultation" onClick={() => navigate(back)} />}
      />
      <DetailMeta status={status || 'unknown'} saved={text(record.updatedAt) || record.createdAt} />
      {said}
      <DetailGrid>
        <SavedRecord items={items} />
        <EhrCard title={<span id={ACTIONS_ID} tabIndex={-1}>Actions</span>}>
          {lab ? null : !overrides ? <p className="hid-ehr-clinical-orders-muted hid-ehr-clinical-allergy-override-unknown">{OVERRIDES_NOT_SHOWN}</p>
            : overrides.items.length > 0 || overrides.unread > 0
              ? <AllergyOverrides chart={chart} overrides={overrides} actorId={actor?.id ?? null} /> : null}
          {actions.length > 0 ? (
            <div className="hid-ehr-clinical-orders-actions">
              <ActionList>
                {actions.map(action => {
                  // While the order is read again, a change can't be opened on the version shown (today's
                  // disabled={recordsLoading}): the button stays focusable and says so, and a press does nothing.
                  const locked = reloading && !action.toggle && !action.print && selected !== action.id
                  return (
                    <EhrButton key={action.id} id={actionId(action.id)} variant="secondary"
                      aria-expanded={action.print ? undefined : action.toggle ? resultsOpen : selected === action.id}
                      aria-disabled={locked || undefined}
                      onClick={() => {
                        if (action.print) { printPrescription(); return }
                        if (action.toggle) { setResultsOpen(open => !open); return }
                        if (locked) return
                        setSelected(open => open === action.id ? null : action.id)
                      }}>
                      {action.label}
                    </EhrButton>
                  )
                })}
              </ActionList>
            </div>
          ) : <NoActions />}
          {form}
          {labNotes.map(note => <p key={note} className="hid-ehr-clinical-orders-muted hid-ehr-clinical-orders-gap">{note}</p>)}
        </EhrCard>
      </DetailGrid>
      {results && resultsOpen ? (
        <ReleasedResults facilityId={chart.facilityId} requestId={record.id} revision={resultsRevision} onRefresh={() => setResultsRevision(count => count + 1)}
          onPrint={printResult} />
      ) : null}
      {rights.novu && route ? (
        <RouteCard
          key={`route-${route.id}-${route.version}`}
          titleId={ROUTE_TITLE_ID}
          kind={info.route}
          route={route}
          context={context}
          canWithdraw={rights.canWithdraw}
          onWithdraw={withdrawRoute}
          loadViews={() => orderRoutesApi.routes(chart.facilityId, chart.patientId, encounterId, info.route, record.id).then(answer => answer.items)}
        />
      ) : null}
      <ConfirmAction
        open={asking !== null}
        label={asking?.label ?? 'Cancel order'}
        description={asking?.description}
        onConfirm={() => { asking?.answer(true); setAsking(null) }}
        onCancel={() => { asking?.answer(false); setAsking(null) }}
      />
      {printArea}
    </>
  )
}

/**
 * One status change: today's status form (Clinical.tsx:1819, :1830, :612-618), its title, "New status" and button. The
 * new status is the action pressed above, so the form names it, with today's choice label, rather than asking for it
 * again.
 *
 * A prescription's Activate or Resume (`warnAboutAllergies`) is checked against the patient's allergies by the EHR
 * (0124), which knows the reasons already given for this prescription: it is sent first with no acknowledgement (never
 * one without a warning shown), and on the EHR's 409 the allergy warning appears here, with the tick and "Why is it
 * safe to go ahead?", apart from the reason for the change. Sent again with both, it carries the same reason for the
 * change and version. Closing the form leaves the order as it was, and drops the warning.
 */
function StatusChange({ option, lab, notice, disabled, confirmCancel, onChange, warnAboutAllergies }: {
  option: StatusOption
  lab: boolean
  /** What the change does that the prescriber must know (Pharmacy not told, or the other facility's change). */
  notice: string | undefined
  disabled: boolean
  confirmCancel: () => Promise<boolean>
  onChange: (next: string, why: string, allergyAcknowledgement: AllergyAcknowledgement | null) => Promise<void>
  warnAboutAllergies?: (ack: AllergyAcknowledgementState, refusal: AllergyRefusal) => Promise<string>
}) {
  const ack = useAllergyAcknowledgement()
  const noticeId = `order-status-${option.value}-warning`

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    if (option.value === 'cancelled' && !(await confirmCancel())) return false
    // A warning shown: the tick and the reason first, each with its own error; nothing is sent without both.
    const shown = ack.warning !== null
    const acknowledgement = shown ? ack.acknowledgement() : null
    if (shown && !acknowledgement) return { formError: ALLERGY_GO_AHEAD_ERROR }
    try {
      await onChange(option.value, reason(values), acknowledgement)
    } catch (caught) {
      const refusal = warnAboutAllergies ? readAllergyRefusal(caught, acknowledgement !== null) : null
      if (refusal && warnAboutAllergies) return { formError: await warnAboutAllergies(ack, refusal) }
      if (acknowledgement && acknowledgementRefused(caught)) {
        ack.refuseReason()
        return { formError: ACK_REFUSED_ERROR }
      }
      return { formError: refusalText(caught, 'Status could not be changed.') }
    }
  }

  return (
    <div className="hid-ehr-clinical-orders-action-form">
      <p className="hid-ehr-clinical-orders-lead"><strong>{lab ? 'Lab request status' : 'Prescription status'}</strong></p>
      <p>New status: {option.label}</p>
      <RecordForm
        fields={[{ key: 'reason', label: 'Reason for change', required: true, maxLength: 500 }]}
        validate={values => minimum(values, 3)}
        submitLabel="Update status"
        busyLabel="Updating…"
        disabled={disabled}
        // Today's status form ties its submit to the warning (staff/routes/Clinical.tsx:617-620).
        describedBy={notice ? noticeId : undefined}
        onSubmit={submit}
      >
        {notice ? <div id={noticeId} className="hid-ehr-clinical-orders-notice hid-ehr-clinical-orders-danger">{notice}</div> : null}
        {ack.warning ? <AllergyWarningPanel idPrefix="rx-status" headingLevel={3} warning={ack.warning} ticked={ack.ticked} reason={ack.reason}
          errors={ack.errors} focus={ack.focus} onTickedChange={ack.setTicked} onReasonChange={ack.setReason} /> : null}
      </RecordForm>
    </div>
  )
}

function RecordHeadingOnly({ title, back }: { title: string; back: string }) {
  const navigate = useNavigate()
  return <EhrPageHeading title={title} back={<EhrBackButton label="Back to consultation" onClick={() => navigate(back)} />} />
}
