import { isHidApiError } from '@hid/http'
import { EhrCard, EhrField, EhrSelect } from '@hid/ui/ehr'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { orderRoutesApi, staffApi, type SavedRecord } from '../../../../staff/api'
import { refusalSentences, refusalText, refusedFields } from '../../../../staff/fieldProblem'
import { sendRefusal } from '../../../../staff/orderRoutes'
import { choiceProblem, NO_DESTINATION, savedNotSent, type DestinationChoice, type RouteContext } from '../../../../staff/routes/OrderRoutes'
import { shortId } from '../../parts/format'
import { ChartBanner, type Chart } from '../../parts/chart'
import { useConfirm } from '../../parts/confirm'
import { ErrorBox, Loading, RecordHeading } from '../../parts/Notices'
import { RecordForm, type FieldDef, type FieldErrors, type FormValues, type SubmitOutcome } from '../../parts/RecordForm'
import { useWorkspaceHref } from '../../parts/Workspace'
import { KINDS, learnFrom, orderRights, patientWord, useFlash, type CreateWarning, type OrderKind } from './orders'
import { DestinationFields, type RouteErrors } from './Routing'
import {
  DOSE_NUMBER_TEXT, DOSE_PAIR, handoffNames, LAB_ACTIVE_NOTE, labDraftWarning, labHandoffOutcome, NO_CHANGES, PRESCRIPTION_HINT, PRESCRIPTION_ROUTING_HINT,
  reloadSentence, rowVersion, SAVED, sendItFrom, type LabOutcome, type Reload,
} from './words'

/**
 * The common dose units, picked from a list beside the dose (a unit is never typed by accident or left off); "Other"
 * opens a field for one not listed.
 */
export const DOSE_UNITS = ['mg', 'g', 'mcg', 'mL', 'units', 'tablet(s)', 'capsule(s)', 'drop(s)', 'puff(s)'] as const
const OTHER_UNIT = 'other'

/** ".5" is written "0.5" as it is typed: a decimal point is never the first thing on a dose. */
export function leadingZero(value: string): string {
  return value.replace(/^\s*\./, '0.')
}

/** A dose: a positive number with at most four decimal places, written with its leading zero. */
const DOSE_NUMBER = /^\d+(\.\d{1,4})?$/

/**
 * The prescription's fields and limits, one column; the dose and its unit side by side. As today, the dose and its unit
 * may both be left blank ("as directed", a cream applied thinly): only one without the other is refused (DOSE_PAIR,
 * staff/routes/Clinical.tsx:505-510, :567).
 */
// Today's labels and placeholders, word for word (Clinical.tsx:567); the unit is picked from a list.
const PRESCRIPTION_FIELDS: readonly FieldDef[] = [
  { key: 'medicationDisplay', label: 'Medication', required: true, maxLength: 500 },
  { key: 'doseQuantity', label: 'Dose quantity', inputMode: 'decimal', placeholder: '0.5', maxLength: 12, row: 'dose', normalise: leadingZero },
  { key: 'doseUnitChoice', label: 'Dose unit', row: 'dose',
    choices: [...DOSE_UNITS.map(unit => ({ value: unit, label: unit })), { value: OTHER_UNIT, label: 'Other…' }] },
  { key: 'doseUnit', label: 'Other unit', required: true, maxLength: 80, when: values => values.doseUnitChoice === OTHER_UNIT },
  { key: 'routeCode', label: 'Route code', placeholder: 'oral', maxLength: 100 },
  { key: 'frequency', label: 'Frequency', required: true, placeholder: 'Twice daily', maxLength: 240 },
  { key: 'instructions', label: 'Instructions', type: 'textarea', required: true, maxLength: 4000 },
]

/** The unit a prescription is saved with: the one picked, or the one typed for "Other". */
function doseUnitOf(values: FormValues): string {
  const choice = value(values, 'doseUnitChoice')
  return choice === OTHER_UNIT ? value(values, 'doseUnit') : choice
}

/** The lab request's fields and limits, with today's labels (Clinical.tsx:570); Priority and Request handling follow as controlled choices. */
const LAB_FIELDS: readonly FieldDef[] = [
  { key: 'testDisplay', label: 'Test display', required: true, maxLength: 500 },
  { key: 'testCodeSystem', label: 'Test code system', required: true, placeholder: 'LOINC', maxLength: 255, row: 'code' },
  { key: 'testCode', label: 'Test code', required: true, maxLength: 100, row: 'code' },
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

/** A refusal as the form shows it: the sentence, and each field the EHR refused marked where it was entered. */
function refused(caught: unknown, fields: readonly FieldDef[]): SubmitOutcome {
  const fieldErrors: Record<string, string> = {}
  for (const item of refusedFields(caught)) {
    // A refused unit is shown at the unit picked from the list (or typed, for "Other").
    const key = item.field === 'doseUnit' && fields.some(field => field.key === 'doseUnitChoice') ? 'doseUnitChoice' : item.field
    if (fields.some(field => field.key === key)) fieldErrors[key] = refusalSentences(item).join(' ')
  }
  return { formError: refusalText(caught, 'Record could not be saved.'), fieldErrors }
}

/**
 * The design's create page ("New pharmacy", "New laboratory") for a prescription or a lab request on this encounter,
 * with today's fields, limits, checks, calls and refusals. The patient (in the banner, confirmed before saving) and
 * encounter carry in; a new prescription also shows the patient's recorded allergies. Saving opens the saved order.
 */
export function CreateOrder({ kind, chart, encounterId }: { kind: OrderKind; chart: Chart; encounterId: string }) {
  const href = useWorkspaceHref()
  const info = KINDS[kind]
  const back = href(encounterId)
  // Today's form heading, "Add {tab}" (Clinical.tsx:561).
  const heading = <RecordHeading title={kind === 'pharmacy' ? 'Add prescriptions' : 'Add lab requests'} backHref={back} />

  // Today's form sits in the records tab that needs the read permission (staff/routes/Clinical.tsx:1232, :1853): a role
  // that can't see this encounter's orders adds none.
  if (!chart.can(info.read) || !chart.can(info.write)) {
    return <>{heading}<ErrorBox>Your role can’t add this order.</ErrorBox></>
  }
  if (!chart.canWrite) {
    // Read only: the chart's gate already says so, once, under the patient banner. Nothing to fill in here.
    return <>{heading}{chart.writeNotice ? null : <Loading label="Checking your access…" />}</>
  }
  return (
    <>
      {heading}
      {kind === 'pharmacy' ? <PrescriptionForm chart={chart} encounterId={encounterId} /> : <LabRequestForm chart={chart} encounterId={encounterId} />}
    </>
  )
}

/** The consultation the order belongs to (the patient is in the banner above, and confirmed before saving). */
function OrderContext({ encounterId }: { encounterId: string }) {
  return <p className="hid-ehr-clinical-note">For consultation {shortId(encounterId)}</p>
}

/** "Send this lab request for Adaeze Okafor?": the patient, compact, and what saving does, before anything is sent. */
function usePatientCheck(chart: Chart) {
  const { ask, sheet } = useConfirm()
  const confirm = (effect: string, confirmLabel: string) => ask({ subject: <ChartBanner chart={chart} compact />, effect, confirmLabel })
  return { confirm, sheet }
}

type Reported = { readonly state: 'loading' | 'hidden' | 'none' | 'failed' } | { readonly state: 'shown'; readonly allergies: string }

/**
 * The patient's recorded allergies on a new prescription (the patient is named in the banner above). Restated word for word from NewConsultation.tsx and NewTriage.tsx, which keep theirs private. Today's only
 * allergy record is what the patient reported in their Health ID portal, which today's chart page reads beside the
 * prescription form (staff/routes/PatientReportedHealth.tsx, direct care with ehr.note.read): nothing is said while it
 * loads, without ehr.note.read, or when EHR refuses (403) or does not serve it (404); "None recorded" only after a read
 * that answered.
 */
function RecordedAllergies({ chart }: { chart: Chart }) {
  const { facilityId, patientId } = chart
  const reads = chart.can('ehr.note.read')
  const [reported, setReported] = useState<Reported>({ state: reads ? 'loading' : 'hidden' })

  useEffect(() => {
    if (!reads) return
    const controller = new AbortController()
    staffApi.reportedHealthProfile(facilityId, patientId, controller.signal).then(
      profile => controller.signal.aborted ? undefined : setReported(profile?.allergies ? { state: 'shown', allergies: profile.allergies } : { state: 'none' }),
      caught => {
        if (controller.signal.aborted) return
        const hidden = !isHidApiError(caught) || caught.status === 403 || caught.status === 404
        setReported({ state: hidden ? 'hidden' : 'failed' })
      },
    )
    return () => controller.abort()
  }, [facilityId, patientId, reads])

  if (reported.state === 'loading' || reported.state === 'hidden') return null
  return (
    <p className="hid-ehr-clinical-note">
      {reported.state === 'shown'
        ? `Recorded allergies: ${reported.allergies} (patient-reported: entered by the patient in their Health ID portal, not clinically verified).`
        : reported.state === 'failed'
          ? 'Recorded allergies: what the patient entered about their health could not be loaded. Confirm with the patient.'
          : 'Recorded allergies: None recorded. Confirm with the patient.'}
    </p>
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

  const { confirm, sheet } = usePatientCheck(chart)

  const validate = (values: FormValues): FieldErrors => {
    const quantity = value(values, 'doseQuantity')
    if (quantity && (!DOSE_NUMBER.test(quantity) || Number(quantity) <= 0)) return { doseQuantity: DOSE_NUMBER_TEXT }
    if (!quantity !== !doseUnitOf(values)) return { [quantity ? 'doseUnitChoice' : 'doseQuantity']: DOSE_PAIR }
    return {}
  }

  const submit = async (values: FormValues): Promise<SubmitOutcome> => {
    setSuccess('')
    const quantity = value(values, 'doseQuantity')
    const body = {
      medicationDisplay: value(values, 'medicationDisplay'),
      doseQuantity: quantity ? Number(quantity) : undefined,
      doseUnit: doseUnitOf(values) || undefined,
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
      <OrderContext encounterId={encounterId} />
      <RecordedAllergies chart={chart} />
      <div role="status">{success ? <p className="hid-ehr-clinical-status">{success}</p> : null}</div>
      <RecordForm key={form} fields={PRESCRIPTION_FIELDS} validate={validate} onSubmit={submit} submitLabel="Save draft"
        confirm={values => confirm(`Save this prescription of ${value(values, 'medicationDisplay')} for ${chart.facts.name}?`, 'Save prescription')}>
        <p className="hid-ehr-clinical-note">{rights.canRoute('pharmacy') ? PRESCRIPTION_ROUTING_HINT : PRESCRIPTION_HINT}</p>
      </RecordForm>
      {sheet}
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
  const { confirm, sheet } = usePatientCheck(chart)

  /** What saving does, said before it is done: send to this Lab, send to another laboratory, or keep as a draft. */
  const confirmLab = (values: FormValues) => {
    const test = value(values, 'testDisplay')
    // Sending elsewhere without a laboratory chosen or the patient's agreement ticked: nothing is asked (nor sent); the
    // save stops at the missing choice, said at its field. Never "Save … as a draft?" for a send that can't go yet.
    if (handling === 'route' && routable && choiceProblem(choice, 'lab_request')) return Promise.resolve(true)
    if (handling === 'route' && routable && choice.destination) return confirm(`Send this lab request (${test}) for ${chart.facts.name} to ${choice.destination.facilityName}?`, 'Send lab request')
    if (handling === 'active' && canSendToLab) return confirm(`Send this lab request (${test}) for ${chart.facts.name}?`, 'Send lab request')
    return confirm(`Save this lab request (${test}) for ${chart.facts.name} as a draft?`, 'Save draft')
  }

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

  /**
   * Opens the saved request with what the create said, or says it here when the request can't be named. The saved
   * request's page reads the list afresh and ends a warning with what that read came to; here, with no request to
   * open, this page reads it (or has read it, `read`). Either way the list is read once after the create and the
   * warning says once what the read came to, as today's (Clinical.tsx labWarning :1447-1448, createAndSend :1659-1667).
   */
  const open = async (requestId: string | undefined, said: { success: string } | { warning: CreateWarning }, read?: Reload) => {
    if (requestId) {
      setFlash({ orderId: requestId, ...said })
      navigate(href(encounterId, 'orders', 'laboratory', requestId))
      return
    }
    if ('success' in said) setSuccess(said.success)
    else {
      const { text, what, listChanged } = said.warning
      setPageError(`${text}${reloadSentence(read ?? await reload(), what, listChanged)}`)
    }
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
      attempt.clear()
      const text = caught.code === 'LAB_HANDOFF_REFUSED'
        ? `Lab request saved and active in the EHR, but Lab refused it${named.code ? ` (${named.code})` : ''}, so the Laboratory does not have it. Do not create it again: once that is resolved, ${sendItFrom(canSendToLab)}.`
        : `Lab request saved and active in the EHR, but Lab did not confirm it, so the Laboratory may not have it. Do not create it again: to send it again, ${sendItFrom(canSendToLab)}.`
      const warning = { text, what: 'request', listChanged: false }
      if (named.requestId) return open(named.requestId, { warning })
      // A 502 names no request; the newest active one for this test heads the list read (Clinical.tsx:1480-1484).
      const items = await reload()
      const requestId = Array.isArray(items) ? (items as SavedRecord[]).find(item => item.status === 'active'
        && item.testCodeSystem === body.testCodeSystem && item.testCode === body.testCode)?.id : undefined
      return open(requestId, { warning }, items)
    }
    attempt.clear()
    if (activeLab && !saved) {
      await reload()
      return open(undefined, { success: 'Active lab request created; check it in the list.' })
    }
    const outcome: LabOutcome | null = !activeLab ? null : saved.labHandoff === undefined || saved.labHandoff?.state === 'accepted'
      ? { accepted: true, text: 'Active lab request created and accepted by Lab.' }
      : labHandoffOutcome(saved.labHandoff ?? null, 'created', canSendToLab)
    const savedId = typeof saved?.id === 'string' ? saved.id : undefined
    if (!outcome || outcome.accepted) return open(savedId, { success: outcome?.text ?? SAVED })
    return open(savedId, { warning: { text: outcome.text, what: 'request', listChanged: outcome.listChanged === true } })
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
    if (unanswered) {
      return open(savedId, { warning: { text: `Saved. Health ID did not answer the send, so it may or may not have gone to ${destination.facilityName}: `
        + 'check the row below before sending it again.', what: 'lab requests', listChanged: true } })
    }
    if (notSent) return open(savedId, { warning: { text: savedNotSent(notSent), what: 'lab requests', listChanged: false } })
    return open(savedId, { success: `Lab request created and sent to ${destination.facilityName}. It waits there until ${destination.facilityName} accepts it, and ${context.patient} is told in the Health ID app.` })
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
      // A refused request handling ('status') is marked at its select, as today's markRefused marks the control named
      // status (staff/routes/Clinical.tsx:546-548, :570).
      const handlingRefused = refusedFields(caught).find(item => item.field === 'status')
      if (handlingRefused) setHandlingError(refusalSentences(handlingRefused).join(' '))
      return refused(caught, LAB_FIELDS)
    }
  }

  return (
    <EhrCard>
      <OrderContext encounterId={encounterId} />
      <div role="status">{success ? <p className="hid-ehr-clinical-status">{success}</p> : null}</div>
      {pageError ? <ErrorBox>{pageError}</ErrorBox> : null}
      {sheet}
      <RecordForm
        key={form}
        fields={LAB_FIELDS}
        onSubmit={submit}
        confirm={confirmLab}
        submitLabel={sendingElsewhere && choice.destination ? `Create and send to ${choice.destination.facilityName}` : 'Create lab request'}
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
