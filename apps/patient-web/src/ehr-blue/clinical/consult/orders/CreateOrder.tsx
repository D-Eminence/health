import { isHidApiError } from '@hid/http'
import { EhrCard, EhrField, EhrSelect } from '@hid/ui/ehr'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { orderRoutesApi, staffApi, type SavedRecord } from '../../../../staff/api'
import { refusalSentences, refusalText, refusedFields } from '../../../../staff/fieldProblem'
import { sendRefusal } from '../../../../staff/orderRoutes'
import { choiceProblem, NO_DESTINATION, savedNotSent, type DestinationChoice, type RouteContext } from '../../../../staff/routes/OrderRoutes'
import type { Chart } from '../../parts/chart'
import { shortId } from '../../parts/format'
import { Banner, ErrorBox, Loading, RecordHeading } from '../../parts/Notices'
import { patientLine } from '../../parts/PatientHeader'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../../parts/RecordForm'
import { useWorkspaceHref } from '../../parts/Workspace'
import { KINDS, learnFrom, orderRights, patientWord, useFlash, type OrderKind } from './orders'
import { DestinationFields, type RouteErrors } from './Routing'
import {
  DOSE_PAIR, handoffNames, LAB_ACTIVE_NOTE, labDraftWarning, labHandoffOutcome, NO_CHANGES, PRESCRIPTION_HINT, PRESCRIPTION_ROUTING_HINT,
  reloadSentence, rowVersion, SAVED, sendItFrom, type LabOutcome, type Reload,
} from './words'

/** Today's prescription fields and limits (Clinical.tsx RecordForm), in the design's form. */
const PRESCRIPTION_FIELDS: readonly FieldDef[] = [
  { key: 'medicationDisplay', label: 'Medication', required: true, maxLength: 500 },
  { key: 'doseQuantity', label: 'Dose quantity', type: 'number', min: 0.0001, step: 0.0001, inputMode: 'decimal' },
  { key: 'doseUnit', label: 'Dose unit', placeholder: 'mg', maxLength: 80 },
  { key: 'routeCode', label: 'Route code', placeholder: 'oral', maxLength: 100 },
  { key: 'frequency', label: 'Frequency', required: true, placeholder: 'Twice daily', maxLength: 240 },
  { key: 'instructions', label: 'Instructions', type: 'textarea', required: true, maxLength: 4000 },
]

/** Today's lab request fields and limits; Priority and Request handling follow as controlled choices. */
const LAB_FIELDS: readonly FieldDef[] = [
  { key: 'testCodeSystem', label: 'Test code system', required: true, placeholder: 'LOINC', maxLength: 255 },
  { key: 'testCode', label: 'Test code', required: true, maxLength: 100 },
  { key: 'testDisplay', label: 'Test display', required: true, maxLength: 500 },
  { key: 'specimenTypeCode', label: 'Specimen type code', maxLength: 100 },
  { key: 'clinicalInformation', label: 'Clinical information', type: 'textarea', maxLength: 4000 },
]

const PRIORITIES = [
  { value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' },
  { value: 'asap', label: 'As soon as possible' }, { value: 'stat', label: 'Stat' },
] as const

function value(values: FormValues, key: string): string {
  const entry = values[key]
  return typeof entry === 'string' ? entry.trim() : ''
}

/** A refusal as the design's form shows it: today's sentence, and each field the EHR refused marked where it was entered. */
function refused(caught: unknown, fields: readonly FieldDef[]): SubmitOutcome {
  const fieldErrors: Record<string, string> = {}
  for (const item of refusedFields(caught)) {
    if (fields.some(field => field.key === item.field)) fieldErrors[item.field] = refusalSentences(item).join(' ')
  }
  return { formError: refusalText(caught, 'Record could not be saved.'), fieldErrors }
}

/**
 * The design's create page ("New pharmacy", "New laboratory") for a prescription or a lab request on this encounter,
 * with today's fields, limits, checks, calls and refusals. The patient and encounter carry in; "Save record" opens the
 * saved order.
 */
export function CreateOrder({ kind, chart, encounterId }: { kind: OrderKind; chart: Chart; encounterId: string }) {
  const href = useWorkspaceHref()
  const info = KINDS[kind]
  const back = href(encounterId)
  const heading = <RecordHeading title={`New ${info.title.toLowerCase()}`} backHref={back} />

  if (!chart.can(info.write)) {
    return <>{heading}<ErrorBox>You do not have permission to create this record.</ErrorBox></>
  }
  if (!chart.canWrite) {
    return (
      <>
        {heading}
        {chart.writeNotice ? <Banner tone="warning" title="Changes are unavailable">{chart.writeNotice}</Banner> : <Loading label="Checking write access…" />}
      </>
    )
  }
  return (
    <>
      {heading}
      {kind === 'pharmacy' ? <PrescriptionForm chart={chart} encounterId={encounterId} /> : <LabRequestForm chart={chart} encounterId={encounterId} />}
    </>
  )
}

function PatientContext({ chart, encounterId }: { chart: Chart; encounterId: string }) {
  return (
    <section className="hid-ehr-clinical-context-block">
      <h2>Patient context</h2>
      <p>{patientLine(chart.facts)}</p>
      <p>Encounter {shortId(encounterId)}</p>
    </section>
  )
}

/** One Idempotency-Key per attempt: the same values sent again are the same create. */
function useAttempt() {
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  return {
    key(signature: string) {
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
      return attempt.current.key
    },
    clear() { attempt.current = null },
  }
}

function PrescriptionForm({ chart, encounterId }: { chart: Chart; encounterId: string }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const { setFlash } = useFlash()
  const attempt = useAttempt()
  const [form, setForm] = useState(0)
  const [success, setSuccess] = useState('')
  const [crossFacilityOrders, setCrossFacilityOrders] = useState(false)
  const rights = orderRights(chart, crossFacilityOrders)
  useCrossFacility(chart, encounterId, 'pharmacy', setCrossFacilityOrders)

  const validate = (values: FormValues): FieldErrors => {
    const quantity = value(values, 'doseQuantity')
    const unit = value(values, 'doseUnit')
    if (!quantity !== !unit) return { [quantity ? 'doseUnit' : 'doseQuantity']: DOSE_PAIR }
    return {}
  }

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    setSuccess('')
    const quantity = value(values, 'doseQuantity')
    const body = {
      medicationDisplay: value(values, 'medicationDisplay'),
      doseQuantity: quantity ? Number(quantity) : undefined,
      doseUnit: value(values, 'doseUnit') || undefined,
      routeCode: value(values, 'routeCode') || undefined,
      frequency: value(values, 'frequency'),
      instructions: value(values, 'instructions'),
      status: 'draft',
    }
    const key = attempt.key(JSON.stringify(['prescriptions', values]))
    try {
      if (!chart.canWrite) throw new Error(NO_CHANGES)
      await chart.verify()
      const saved = await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'prescriptions', body, key)
      attempt.clear()
      if (typeof saved?.id === 'string') {
        setFlash({ orderId: saved.id, success: SAVED })
        navigate(href(encounterId, 'orders', 'pharmacy', saved.id))
        return
      }
      setSuccess(SAVED)
      setForm(count => count + 1)
    } catch (caught) {
      return refused(caught, PRESCRIPTION_FIELDS)
    }
  }

  return (
    <EhrCard>
      <PatientContext chart={chart} encounterId={encounterId} />
      <div role="status">{success ? <p className="hid-ehr-clinical-status">{success}</p> : null}</div>
      <RecordForm key={form} fields={PRESCRIPTION_FIELDS} validate={validate} onSubmit={submit}>
        <p className="hid-ehr-clinical-note">{rights.canRoute('pharmacy') ? PRESCRIPTION_ROUTING_HINT : PRESCRIPTION_HINT}</p>
      </RecordForm>
    </EhrCard>
  )
}

/**
 * Whether this encounter's orders may be sent to another facility now: today's page learns it from the records list
 * (`crossFacilityOrders`), so it is read once, only when this build and member could send one.
 */
function useCrossFacility(chart: Chart, encounterId: string, kind: OrderKind, set: (open: boolean) => void) {
  const could = orderRights(chart, true).canRoute(kind)
  const { facilityId, patientId } = chart
  useEffect(() => {
    if (!could) return
    let active = true
    staffApi.records(facilityId, patientId, encounterId, KINDS[kind].record).then(
      answer => { const open = learnFrom(answer); if (active) set(open) },
      () => { if (active) set(false) },
    )
    return () => { active = false }
  }, [could, facilityId, patientId, encounterId, kind, set])
}

function LabRequestForm({ chart, encounterId }: { chart: Chart; encounterId: string }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const { setFlash } = useFlash()
  const attempt = useAttempt()
  const warningId = useId()
  const [form, setForm] = useState(0)
  const [success, setSuccess] = useState('')
  const [pageError, setPageError] = useState('')
  const [handling, setHandling] = useState('draft')
  const [handlingError, setHandlingError] = useState('')
  const [priority, setPriority] = useState('routine')
  const [choice, setChoice] = useState<DestinationChoice>(NO_DESTINATION)
  const [routeErrors, setRouteErrors] = useState<RouteErrors>({})
  const [crossFacilityOrders, setCrossFacilityOrders] = useState(false)
  const handlingRef = useRef<HTMLSelectElement>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const attestedRef = useRef<HTMLInputElement>(null)
  useCrossFacility(chart, encounterId, 'laboratory', setCrossFacilityOrders)
  const rights = orderRights(chart, crossFacilityOrders)
  const canSendToLab = rights.canSendToLab
  const routable = rights.canRoute('laboratory')
  const sendingElsewhere = routable && handling === 'route'
  const context: RouteContext = { facilityId: chart.facilityId, orderingFacility: chart.facilityName, patient: patientWord(chart) }

  const reset = () => {
    setForm(count => count + 1)
    setHandling('draft')
    setPriority('routine')
    setChoice(NO_DESTINATION)
  }

  /** The list read again after a create, as today's page does: its rows, or 'failed'. */
  const reload = async (): Promise<Reload> => {
    try {
      const answer = await staffApi.records(chart.facilityId, chart.patientId, encounterId, 'lab-requests', { cursor: undefined, fresh: true })
      learnFrom(answer)
      return Array.isArray(answer?.items) ? answer.items : []
    } catch {
      return 'failed'
    }
  }

  /** Opens the saved request with what the create said, or says it here when the request can't be named. */
  const open = (requestId: string | undefined, said: { success?: string; error?: string }) => {
    if (requestId) {
      setFlash({ orderId: requestId, ...said })
      navigate(href(encounterId, 'orders', 'laboratory', requestId))
      return
    }
    if (said.success) setSuccess(said.success)
    if (said.error) setPageError(said.error)
    reset()
  }

  const create = async (body: Record<string, unknown>, key: string): Promise<void> => {
    const activeLab = body.status === 'active'
    let saved: SavedRecord
    try {
      saved = await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'lab-requests', body, key)
    } catch (caught) {
      const handoff = isHidApiError(caught) && (caught.code === 'LAB_HANDOFF_REFUSED' || caught.code === 'LAB_HANDOFF_UNCONFIRMED')
      if (!activeLab || (!handoff && refusedFields(caught).length > 0)) throw caught
      if (!handoff) {
        const items = await reload()
        const said = refusalText(caught, 'The lab request could not be created.')
        throw new Error(`${/[.!?]$/.test(said) ? said : `${said}.`} The lab request may have been saved and active even so: check the list before creating it again.${reloadSentence(items, 'lab requests', false)}`)
      }
      const named = handoffNames(caught.message)
      const items = await reload()
      const requestId = named.requestId ?? (Array.isArray(items) ? (items as SavedRecord[]).find(item => item.status === 'active'
        && item.testCodeSystem === body.testCodeSystem && item.testCode === body.testCode)?.id : undefined)
      attempt.clear()
      const text = caught.code === 'LAB_HANDOFF_REFUSED'
        ? `Lab request saved and active in the EHR, but Lab refused it${named.code ? ` (${named.code})` : ''}, so the Laboratory does not have it. Do not create it again: once that is resolved, ${sendItFrom(canSendToLab)}.`
        : `Lab request saved and active in the EHR, but Lab did not confirm it, so the Laboratory may not have it. Do not create it again: to send it again, ${sendItFrom(canSendToLab)}.`
      open(requestId, { error: `${text}${reloadSentence(items, 'request', false)}` })
      return
    }
    attempt.clear()
    if (activeLab && !saved) {
      await reload()
      open(undefined, { success: 'Active lab request created; check it in the list.' })
      return
    }
    const outcome: LabOutcome | null = !activeLab ? null : saved.labHandoff === undefined || saved.labHandoff?.state === 'accepted'
      ? { accepted: true, text: 'Active lab request created and accepted by Lab.' }
      : labHandoffOutcome(saved.labHandoff ?? null, 'created', canSendToLab)
    const savedId = typeof saved?.id === 'string' ? saved.id : undefined
    if (!outcome || outcome.accepted) {
      open(savedId, { success: outcome?.text ?? SAVED })
      return
    }
    const items = await reload()
    open(savedId, { error: `${outcome.text}${reloadSentence(items, 'request', outcome.listChanged === true)}` })
  }

  const createAndSend = async (body: Record<string, unknown>, key: string, destination: NonNullable<DestinationChoice['destination']>, attestationTextVersion: string) => {
    const saved = await staffApi.createRecord(chart.facilityId, chart.patientId, encounterId, 'lab-requests', body, key)
    attempt.clear()
    const savedId = typeof saved?.id === 'string' ? saved.id : undefined
    const savedVersion = rowVersion(saved?.rowVersion)
    let notSent: string | null = null
    let unanswered = false
    if (!savedId || !savedVersion) notSent = 'the saved request could not be read back. Find it in the list and use Send to another laboratory on it.'
    else {
      try {
        await orderRoutesApi.send(chart.facilityId, chart.patientId, encounterId, 'lab_request', savedId,
          { expectedRowVersion: savedVersion, receivingFacilityId: destination.facilityId, attestationTextVersion }, crypto.randomUUID())
      } catch (caught) {
        const refusal = sendRefusal(caught, 'lab_request', destination.facilityName, context.patient)
        if (refusal.unanswered) unanswered = true
        else notSent = refusal.text
      }
    }
    const items = await reload()
    if (unanswered) {
      open(savedId, { error: `Saved. Health ID did not answer the send, so it may or may not have gone to ${destination.facilityName}: `
        + `check the row below before sending it again.${reloadSentence(items, 'lab requests', true)}` })
      return
    }
    if (notSent) {
      open(savedId, { error: `${savedNotSent(notSent)}${reloadSentence(items, 'lab requests', false)}` })
      return
    }
    open(savedId, { success: `Lab request created and sent to ${destination.facilityName}. It waits there until ${destination.facilityName} accepts it, and ${context.patient} is told in the Health ID app.` })
  }

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    setSuccess('')
    setPageError('')
    setHandlingError('')
    setRouteErrors({})
    const toAnother = handling === 'route' && routable
    if (handling !== 'draft' && !(handling === 'active' && canSendToLab) && !toAnother) {
      setHandlingError(canSendToLab ? 'Choose draft or active request.' : 'Choose a draft request.')
      handlingRef.current?.focus()
      return false
    }
    const body = {
      testCodeSystem: value(values, 'testCodeSystem'), testCode: value(values, 'testCode'), testDisplay: value(values, 'testDisplay'),
      priority, status: toAnother ? 'draft' : handling,
      specimenTypeCode: value(values, 'specimenTypeCode') || undefined,
      clinicalInformation: value(values, 'clinicalInformation') || undefined,
    }
    if (toAnother) {
      const problem = choiceProblem(choice, 'lab_request')
      if (problem) {
        setRouteErrors({ [problem.field]: problem.text })
        ;(problem.field === 'destination' ? queryRef.current : attestedRef.current ?? queryRef.current)?.focus()
        return false
      }
    }
    const key = attempt.key(JSON.stringify(['lab-requests', values, priority, handling]))
    try {
      if (!chart.canWrite) throw new Error(NO_CHANGES)
      await chart.verify()
      if (toAnother && choice.destination && choice.attestation) await createAndSend(body, key, choice.destination, choice.attestation.version)
      else await create(body, key)
    } catch (caught) {
      return refused(caught, LAB_FIELDS)
    }
  }

  return (
    <EhrCard>
      <PatientContext chart={chart} encounterId={encounterId} />
      <div role="status">{success ? <p className="hid-ehr-clinical-status">{success}</p> : null}</div>
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      <RecordForm
        key={form}
        fields={LAB_FIELDS}
        onSubmit={submit}
        submitLabel={sendingElsewhere && choice.destination ? `Create and send to ${choice.destination.facilityName}` : 'Save record'}
        busyLabel={sendingElsewhere ? 'Sending…' : 'Saving…'}
      >
        <div className="hid-ehr-clinical-form-grid hid-ehr-clinical-orders-choices">
          <EhrField label="Priority">
            <EhrSelect value={priority} onChange={event => setPriority(event.target.value)}>
              {PRIORITIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label={<>Request handling<span aria-hidden="true"> *</span></>} error={handlingError || undefined}>
            <EhrSelect ref={handlingRef} required value={handling} aria-describedby={warningId}
              onChange={event => { setHandling(event.target.value); setHandlingError(''); setRouteErrors({}) }}>
              <option value="draft">Save EHR draft</option>
              {canSendToLab ? <option value="active">{routable ? 'Create active request and send to this facility’s Lab' : 'Create active request and send to Lab'}</option> : null}
              {routable ? <option value="route">Create and send to another laboratory</option> : null}
            </EhrSelect>
          </EhrField>
        </div>
        {sendingElsewhere ? (
          <DestinationFields context={context} kind="lab_request" priority={priority} value={choice} onChange={setChoice}
            errors={routeErrors} queryRef={queryRef} attestedRef={attestedRef} />
        ) : null}
        <div id={warningId} className="hid-ehr-clinical-orders-notice hid-ehr-clinical-orders-danger">{labDraftWarning(sendingElsewhere, canSendToLab, routable)}</div>
        {canSendToLab && !sendingElsewhere ? <p className="hid-ehr-clinical-note">{LAB_ACTIVE_NOTE}</p> : null}
      </RecordForm>
    </EhrCard>
  )
}
