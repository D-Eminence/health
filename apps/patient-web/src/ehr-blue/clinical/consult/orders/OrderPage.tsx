import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard, EhrPageHeading } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  orderRoutesApi, staffApi, type ClinicalRecord, type OrderDestination, type OrderRouteSummary, type OrderRouteWithdrawReason,
} from '../../../../staff/api'
import { refusalText } from '../../../../staff/fieldProblem'
import { routedChangeWarning, routedElsewhere, sendRefusal, withdrawRefusal } from '../../../../staff/orderRoutes'
import { sendLabel, type RouteContext } from '../../../../staff/routes/OrderRoutes'
import { useLateCorrectionServed } from '../../../../lateCorrectionServed'
import { useWrongPatientServed } from '../../../../wrongPatientServed'
import type { Chart } from '../../parts/chart'
import { ActionList, ConfirmAction, DetailGrid, DetailMeta, SavedRecord } from '../../parts/Detail'
import { formatWhen, shortId } from '../../parts/format'
import type { KeyValue } from '../../parts/KeyValueList'
import { Banner, ErrorBox, Loading, NoActions, RecordNotFound } from '../../parts/Notices'
import { patientLine } from '../../parts/PatientHeader'
import { RecordForm, type FieldErrors, type FormValues, type SubmitOutcome } from '../../parts/RecordForm'
import { useWorkspaceHref } from '../../parts/Workspace'
import { KINDS, mayBeSent, orderRights, orderTitle, patientWord, priorityText, readOrder, routeOf, text, useFlash, type OrderKind } from './orders'
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
class LabSendError extends Error {
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
  const [success, setSuccess] = useState(() => flash?.orderId === orderId ? flash.success ?? '' : '')
  const [pageError, setPageError] = useState(() => flash?.orderId === orderId ? flash.error ?? '' : '')
  const [selected, setSelected] = useState<string | null>(null)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [resultsRevision, setResultsRevision] = useState(0)
  const [asking, setAsking] = useState<{ label: string; answer: (yes: boolean) => void } | null>(null)
  const [focusIds, setFocusIds] = useState<readonly string[] | null>(null)
  const pharmacyAttempt = useRef<{ reason: string; key: string } | null>(null)
  const labAttempt = useRef<string | null>(null)
  const chartRef = useRef(chart)
  chartRef.current = chart
  const wrongPatientServed = useWrongPatientServed() === true
  const lateCorrectionServed = useLateCorrectionServed() === true

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
    let active = true
    readOrder(chartRef.current, encounterId, kind, orderId, false).then(
      read => {
        if (!active) return
        setLoaded(read.record ? { status: 'ready', record: read.record, crossFacilityOrders: read.crossFacilityOrders } : { status: 'missing' })
      },
      caught => { if (active) setLoaded({ status: 'error', text: caught instanceof Error ? caught.message : 'Records could not be loaded.' }) },
    )
    return () => { active = false }
  }, [facilityId, patientId, encounterId, kind, orderId])

  /** The order read again after a change, as today's page re-reads its list: the rows, or 'failed'. */
  const reload = async (): Promise<Reload> => {
    try {
      const read = await readOrder(chartRef.current, encounterId, kind, orderId, true)
      setLoaded(read.record ? { status: 'ready', record: read.record, crossFacilityOrders: read.crossFacilityOrders } : { status: 'missing' })
      return read.record ? [read.record] : []
    } catch (caught) {
      setPageError(`The change was saved, but the records could not be reloaded. ${refusalText(caught, '')}`.trim())
      return 'failed'
    }
  }

  if (loaded.status === 'loading') return <Loading label="Loading records…" />
  if (loaded.status === 'error') return <><RecordHeadingOnly title={info.title} back={back} /><ErrorBox>{loaded.text}</ErrorBox></>
  if (loaded.status === 'missing') return <RecordNotFound backHref={back} />

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
  const labNotes = lab && canWrite && !routed
    ? [LAB_NOT_TOLD[status], !rights.canSendToLab ? LAB_SENT_BY_OTHERS[status] : undefined].filter((note): note is string => Boolean(note)) : []

  const actions: Action[] = [
    ...choices.map(option => ({ id: `status-${option.value}`, label: statusLabel(option) })),
    ...(sendPharmacy ? [{ id: 'pharmacy', label: 'Send to Pharmacy' }] : []),
    ...(sendLab ? [{ id: 'lab', label: 'Send to Lab' }] : []),
    ...(sendElsewhere ? [{ id: 'route', label: sendLabel(info.route) }] : []),
    ...(results ? [{ id: 'results', label: resultsOpen ? 'Hide released results' : 'View released results', toggle: true }] : []),
  ]

  const confirm = (label: string) => new Promise<boolean>(answer => setAsking({ label, answer }))

  /** A saved lab request Lab does not hold, or holds at another version: the change stands, so it is said as a warning. */
  const labWarning = (said: string, reloaded: Reload, { sendable = true, listChanged = false } = {}) => {
    setPageError(`${said}${reloadSentence(reloaded, 'request', listChanged)}`)
    setFocusIds(sendable ? [actionId('lab'), TITLE_ID] : [TITLE_ID])
  }

  async function changeStatus(next: string, why: string) {
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the record before changing its status.')
    const toLab = lab && next === 'active'
    setSuccess('')
    if (toLab) setPageError('')
    await chart.verify()
    const saved = await staffApi.updateRecord(chart.facilityId, chart.patientId, encounterId, info.record, record.id,
      { expectedRowVersion, changeReason: why, status: next })
    const outcome = toLab ? labHandoffOutcome(saved?.labHandoff ?? null, record.status === 'on_hold' ? 'resumed' : 'activated', rights.canSendToLab) : null
    if (!outcome || outcome.accepted) setSuccess(outcome?.text ?? (lab ? 'Lab request status updated.' : 'Prescription status updated.'))
    setSelected(null)
    const reloaded = await reload()
    if (outcome && !outcome.accepted) return labWarning(outcome.text, reloaded, outcome)
    setFocusIds([ACTIONS_ID])
  }

  async function handoffPrescription(why: string, key: string) {
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the prescription before sending it to Pharmacy.')
    setSuccess('')
    await chart.verify()
    try {
      await staffApi.acceptPrescription(chart.facilityId, chart.patientId, encounterId, record.id, expectedRowVersion, why, key)
    } catch (caught) {
      if (!isHidApiError(caught)) throw caught
      if (caught.code === 'IDEMPOTENCY_CONFLICT') throw new Error(PHARMACY_ALREADY_HOLDS)
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

  async function sendOrder(destination: OrderDestination, attestationTextVersion: string, key: string) {
    const expectedRowVersion = rowVersion(record.rowVersion)
    if (!expectedRowVersion) throw new Error('Reload the list before sending it.')
    setSuccess('')
    setPageError('')
    await chart.verify()
    try {
      await orderRoutesApi.send(chart.facilityId, chart.patientId, encounterId, info.route, record.id,
        { expectedRowVersion, receivingFacilityId: destination.facilityId, attestationTextVersion }, key)
    } catch (caught) {
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

  const statusForm = (option: StatusOption) => {
    const label = statusLabel(option)
    const submit = async (values: FormValues): Promise<SubmitOutcome> => {
      if (option.value === 'cancelled' && !(await confirm(label))) return false
      try {
        await changeStatus(option.value, reason(values))
      } catch (caught) {
        return { formError: refusalText(caught, 'Status could not be changed.') }
      }
    }
    return (
      <RecordForm
        key={`status-${option.value}-${version}`}
        className="hid-ehr-clinical-orders-action-form"
        fields={[{ key: 'reason', label: 'Reason for change', required: true, maxLength: 500 }]}
        validate={values => minimum(values, 3)}
        submitLabel={label}
        busyLabel="Updating…"
        onSubmit={submit}
      >
        {warning ? <div className="hid-ehr-clinical-orders-notice hid-ehr-clinical-orders-danger">{warning}</div> : null}
      </RecordForm>
    )
  }

  const pharmacyForm = (
    <div className="hid-ehr-clinical-orders-action-form">
      <p className="hid-ehr-clinical-orders-lead"><strong>Send active prescription to Pharmacy</strong></p>
      <RecordForm
        key={`pharmacy-${version}`}
        fields={[{ key: 'reason', label: 'Reason', required: true, maxLength: 500 }]}
        validate={values => minimum(values, 8)}
        submitLabel="Send to Pharmacy"
        busyLabel="Working…"
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
        onSubmit={async () => {
          labAttempt.current ??= crypto.randomUUID()
          try {
            await sendLabRequest(labAttempt.current)
            labAttempt.current = null
          } catch (caught) {
            const retry = caught instanceof LabSendError ? caught.retry : true
            if (!retry) labAttempt.current = null
            return { formError: caught instanceof Error ? caught.message : 'The lab request could not be sent to Lab.' }
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
        onSend={sendOrder} onCancel={() => { setSelected(null); setFocusIds([actionId('route')]) }} />
    }
    return null
  })()

  const items: KeyValue[] = lab ? [
    { label: 'Encounter', value: shortId(encounterId) },
    { label: 'Test code system', value: text(record.testCodeSystem) },
    { label: 'Test code', value: text(record.testCode) },
    { label: 'Test display', value: text(record.testDisplay) },
    { label: 'Priority', value: priorityText(record.priority) },
    { label: 'Specimen type code', value: text(record.specimenTypeCode) },
    { label: 'Clinical information', value: text(record.clinicalInformation) },
    { label: 'Recorded', value: formatWhen(record.createdAt) },
  ] : [
    { label: 'Encounter', value: shortId(encounterId) },
    { label: 'Medication', value: text(record.medicationDisplay) },
    { label: 'Dose quantity', value: text(record.doseQuantity) },
    { label: 'Dose unit', value: text(record.doseUnit) },
    { label: 'Route code', value: text(record.routeCode) },
    { label: 'Frequency', value: text(record.frequency) },
    { label: 'Instructions', value: text(record.instructions) },
    { label: 'Recorded', value: formatWhen(record.createdAt) },
  ]

  return (
    <>
      <EhrPageHeading
        title={<span id={TITLE_ID} tabIndex={-1}>{title}</span>}
        primaryAction={<EhrButton variant="secondary" onClick={() => navigate(back)}>Back to list</EhrButton>}
      />
      <DetailMeta status={status || 'unknown'} patient={patientLine(chart.facts)} saved={text(record.updatedAt) || record.createdAt} />
      <div role="status">{success ? <p className="hid-ehr-clinical-status">{success}</p> : null}</div>
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : null}
      <DetailGrid>
        <SavedRecord items={items} />
        <EhrCard title={<span id={ACTIONS_ID} tabIndex={-1}>Available actions</span>}>
          {actions.length > 0 ? (
            <div className="hid-ehr-clinical-orders-actions">
              <ActionList>
                {actions.map(action => (
                  <EhrButton key={action.id} id={actionId(action.id)} variant="secondary"
                    aria-expanded={action.toggle ? resultsOpen : selected === action.id}
                    onClick={() => {
                      if (action.toggle) { setResultsOpen(open => !open); return }
                      setSelected(open => open === action.id ? null : action.id)
                    }}>
                    {action.label}
                  </EhrButton>
                ))}
              </ActionList>
            </div>
          ) : <NoActions />}
          {form}
          {labNotes.map(note => <p key={note} className="hid-ehr-clinical-orders-muted hid-ehr-clinical-orders-gap">{note}</p>)}
        </EhrCard>
      </DetailGrid>
      {results && resultsOpen ? (
        <ReleasedResults facilityId={chart.facilityId} requestId={record.id} revision={resultsRevision} onRefresh={() => setResultsRevision(count => count + 1)} />
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
        onConfirm={() => { asking?.answer(true); setAsking(null) }}
        onCancel={() => { asking?.answer(false); setAsking(null) }}
      />
    </>
  )
}

function RecordHeadingOnly({ title, back }: { title: string; back: string }) {
  const navigate = useNavigate()
  return <EhrPageHeading title={title} primaryAction={<EhrButton variant="secondary" onClick={() => navigate(back)}>Back to list</EhrButton>} />
}
