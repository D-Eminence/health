import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { ArrowRight, CircleCheck, Link2, Printer, UserPlus } from 'lucide-react'
import { FormActions } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { useConfirm } from '../../clinical/parts/confirm'
import { staffApi, type OutreachCampaign, type OutreachCase, type PatientSummary } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptPage } from '../parts/DeptPage'
import { DeptFacts } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { birthDateText, dateText } from '../parts/format'
import {
  ageText, caseFacts, caseName, caseTone, COMPLETE_FIELD, controlProps, ErrorBox, HEALTH_ID_FORMAT, HEALTH_ID_HINT,
  HEALTH_ID_NO_ACCESS, HEALTH_ID_NOT_FOUND, HEALTH_ID_ROLE, healthIdFrom, LINK_FAILED, LINK_NEEDS_SHARE, LOOKUP_FAILED,
  OutreachField, PENDING, LINK_RETRY_NOTE, REASON_LENGTH, sexText, statusLabel, type FieldErrors,
} from './outreachParts'
import { LINKS_LATER } from './outreachGroup'
import { GetHealthIdNow } from './GetHealthIdNow'
import { HealthChecks, leaveHealthChecks } from './HealthChecks'
import { CreateHealthId, type MadeHere } from './CreateHealthId'
import { OutreachSlip, useSlipPrint } from './OutreachSlip'
import { keptClaimCode } from './tabMemory'

type LinkField = 'patient' | 'reason'

/** Identity's refusals of the lookup that mean no access to this person's record (identity.service.ts). */
const NO_ACCESS: ReadonlySet<string> = new Set(['ACCESS_DENIED', 'OUTREACH_PATIENT_ACCESS_REQUIRED', 'IDENTITY_AUTHORIZATION_DENIED'])
/**
 * Outreach's refusals of the link itself for want of write access to the record (identity.service.ts
 * authorizeExistingPatient). Not ACCESS_DENIED: that is outreach-api's code for any 403 without one of its own.
 */
const NO_WRITE: ReadonlySet<string> = new Set(['IDENTITY_AUTHORIZATION_DENIED', 'OUTREACH_PATIENT_ACCESS_REQUIRED'])

/** What a refused lookup means for the Health ID field, or undefined when it is not about the person (said in the form). */
function lookupFieldText(caught: unknown): string | undefined {
  if (!isHidApiError(caught)) return undefined
  if (caught.status === 404 && caught.code !== 'API_ROUTE_NOT_FOUND') return HEALTH_ID_NOT_FOUND
  if (caught.status === 400 && caught.code === 'VALIDATION_FAILED') return HEALTH_ID_FORMAT
  if (caught.status === 403 && caught.code === 'PERMISSION_DENIED') return HEALTH_ID_ROLE
  if (caught.status === 403 && NO_ACCESS.has(caught.code)) return HEALTH_ID_NO_ACCESS
  return undefined
}

/** The person's name as Identity holds it, never their ID. */
function personName(patient: PatientSummary) {
  return patient.fullName?.trim() || [patient.firstName, patient.lastName].filter(Boolean).join(' ').trim() || 'Name not recorded'
}

/**
 * One registration case: who it is, its status, and one clear next step. While the case waits for identity, the next
 * step is today's one action (link a verified existing patient, for a membership that may write registrations); once
 * linked, a done state with the way on.
 */
export function OutreachCaseView({ facilityId, item, campaign, canLink, canWrite = canLink, group = false, created, listError, onBack, onNew, onChanged, onFocusHeading }: {
  readonly facilityId: string
  /**
   * At an outreach group, which can't link anyone to a Health ID (Identity and Outreach refuse it): no "Link existing
   * patient" and no link preview, and a plain sentence that the person links their own Health ID later.
   */
  readonly group?: boolean
  readonly item: OutreachCase
  readonly campaign: OutreachCampaign | undefined
  readonly canLink: boolean
  /** Whether the membership may write registrations: health checks are recorded then, else only read. */
  readonly canWrite?: boolean
  /** Opened from the create form, which made this case. */
  readonly created: boolean
  /** The registration case list's last read failed: what is shown may be out of date. */
  readonly listError: string
  readonly onBack: () => void
  /** Opens "New registration", when the membership may write registrations. */
  readonly onNew?: () => void
  /** Reads the cases again. */
  readonly onChanged: () => Promise<void>
  /** Moves focus to the record's heading if focus was lost. */
  readonly onFocusHeading: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // What is being sent: the Health ID looked up, or the link. Only a refused link has read the case again.
  const [checking, setChecking] = useState(false)
  const [readAgain, setReadAgain] = useState(false)
  const [linked, setLinked] = useState(false)
  const [problems, setProblems] = useState<FieldErrors<LinkField>>({ errors: {}, seq: 0 })
  const focus = useFocusById()
  const patientId = `outreach-patient-${item.id}`
  const reasonId = `outreach-reason-${item.id}`
  const formId = `outreach-link-${item.id}`
  const pending = item.status === PENDING
  const offered = canLink && pending && !group
  const { ask, sheet } = useConfirm()
  const asking = useRef(false)
  const doneId = `outreach-case-${item.id}-done`
  const { facility, actorId } = useDeptAccess()
  // The Health ID made here just now, with its claim code when made with no email or phone, for the slip. After a reload
  // the claim code is printed for 15 minutes from this tab's own copy (tabMemory.ts), never shown on screen again.
  const [madeHere, setMadeHere] = useState<MadeHere | null>(null)
  const { print, area: slipArea } = useSlipPrint()
  const printSlip = () => {
    const healthId = madeHere?.healthId ?? item.healthId
    print(<OutreachSlip groupName={facility?.name} campaign={campaign} item={item}
      healthId={healthId} claimCode={madeHere?.claimCode ?? keptClaimCode(actorId, facilityId, item.id, healthId)} />)
  }

  async function linkExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || asking.current) return
    const form = new FormData(event.currentTarget)
    const typed = String(form.get('healthId') ?? '').trim()
    const hid = healthIdFrom(typed)
    const reason = String(form.get('reason') ?? '').trim()
    setError('')
    // Sent only with a Health ID and a reason of at least 8 characters, as Identity and Outreach take them.
    const errors: Partial<Record<LinkField, string>> = {}
    if (!typed) errors.patient = COMPLETE_FIELD
    else if (!hid) errors.patient = HEALTH_ID_FORMAT
    if (!reason) errors.reason = COMPLETE_FIELD
    else if (reason.length < 8) errors.reason = REASON_LENGTH
    if (refuse(errors)) return
    clearProblems()
    // The person is looked up by their Health ID first: who they are is confirmed by name and date of birth, and only
    // the lookup's own answer names the record linked. Its ID is sent, never shown.
    setBusy(true)
    setChecking(true)
    let patient: PatientSummary | undefined
    try {
      const lookup = await staffApi.lookupPatient(facilityId, hid)
      // An allowed lookup only (as staff/api.ts isAllowedPatientLookup reads it): anything else is no access.
      if (lookup.authorization.decision === 'allow' && lookup.patient?.patientId) patient = lookup.patient
      else refuse({ patient: HEALTH_ID_NO_ACCESS })
    } catch (caught) {
      const words = lookupFieldText(caught)
      if (words) refuse({ patient: words })
      else { setError(errorText(caught, LOOKUP_FAILED)); setReadAgain(false) }
    } finally {
      setBusy(false)
      setChecking(false)
    }
    if (!patient) return
    const born = birthDateText(patient.dateOfBirth)
    // Linking joins this person's field record to their Health ID record: confirm it is the same person, before it is sent.
    asking.current = true
    let confirmed = false
    try {
      confirmed = await ask({ title: 'Confirm the link', subject: <Card className="px-4 py-3"><p className="m-0 text-title-3 text-ink">{caseName(item)}</p>
        <p className="m-0 text-caption text-ink-2">{ageText(item)} · {sexText(item)} · registered {dateText(item.createdAt)}</p></Card>,
      effect: <>Link this registration to the Health ID record of <strong>{personName(patient)}</strong>,
        {' '}{born ? <>born <strong>{born}</strong></> : 'whose date of birth is not recorded'}? Check it is the same person.
        {' '}Health ID checked: <strong>{hid}</strong>.</>,
      confirmLabel: 'Link patient' })
    } finally { asking.current = false }
    if (!confirmed) return
    setBusy(true)
    setLinked(false)
    try {
      await staffApi.linkExistingOutreachCase(facilityId, item, patient.patientId, reason)
      setLinked(true)
      setOpen(false)
      // A link resolves the case, which removes its form: focus goes to what was done.
      focus(doneId)
      await onChanged()
      onFocusHeading()
    } catch (caught) {
      // Linking needs access to write the record: a share for care, not a PIN (which gives read only).
      if (isHidApiError(caught) && caught.status === 403 && NO_WRITE.has(caught.code)) refuse({ patient: LINK_NEEDS_SHARE })
      else { setError(errorText(caught, LINK_FAILED)); setReadAgain(true) }
      // Read the case again, so a retry is checked against its latest version, not the one refused.
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  /** Marks the refused fields, focus on the first (or an alert there, when focus is in it already). True when any was refused. */
  function refuse(errors: Partial<Record<LinkField, string>>): boolean {
    const first = errors.patient ? 'patient' : errors.reason ? 'reason' : undefined
    if (!first) return false
    const target = first === 'patient' ? patientId : reasonId
    const here = document.activeElement?.id === target
    setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
    if (!here) focus(target)
    return true
  }
  function clearProblems() {
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
  }

  const field = (key: LinkField) => ({ error: problems.errors[key], alert: problems.alert === key, seq: problems.seq })

  const back = () => { if (!busy && leaveHealthChecks()) onBack() }
  const facts = caseFacts(item, campaign)

  // The one next step, or the done state.
  let nextStep
  if (linked || !pending) {
    nextStep = (
      <Card>
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-7" aria-hidden /></span>
          <h2 id={doneId} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{linked ? 'Patient linked' : 'Nothing more to do'}</h2>
          <p className="m-0 max-w-md text-body text-ink-2">{linked
            ? 'This registration is now joined to the verified Health ID patient. Their care continues under their Health ID.'
            : `This registration is ${statusLabel(item.status).toLowerCase()}. No further step is needed here.`}</p>
          <FormActions sticky={false} align="start" className="mt-2">
            {onNew ? <Button variant="primary" icon={UserPlus} onClick={onNew}>Register another person</Button> : null}
            <Button onClick={back}>Back to list</Button>
          </FormActions>
        </div>
      </Card>
    )
  } else if (offered) {
    nextStep = (
      <Card>
        <CardHeader as="h2" icon={Link2} iconTone="brand" title="Next step: link their Health ID"
          description="Ask for their Health ID. We look them up, you check it’s the same person, and their temporary record joins their Health ID record." />
        <div className="flex flex-col gap-4 p-5">
          {!open ? (
            <Button variant="primary" size="lg" aria-expanded={false} aria-controls={formId} className="self-start" onClick={() => setOpen(true)}>Link existing patient</Button>
          ) : (
            <form id={formId} className="flex flex-col gap-4" noValidate aria-label="Link existing patient" onSubmit={event => void linkExisting(event)}>
              <OutreachField id={patientId} label="Health ID" required hint={HEALTH_ID_HINT} {...field('patient')}>
                <EhrInput name="healthId" readOnly={busy} required maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} {...controlProps(patientId, problems.errors.patient, true)} />
              </OutreachField>
              <OutreachField id={reasonId} label="How you know it’s the same person" required hint="For example: name, age and phone match; seen in person." {...field('reason')}>
                <EhrTextarea name="reason" readOnly={busy} rows={3} minLength={8} maxLength={1000} required {...controlProps(reasonId, problems.errors.reason, true)} />
              </OutreachField>
              <p className="hid-ehr-dept-muted m-0">You can link someone only if they have shared their record with your facility for care. You’ll see their name and date of birth to check before anything is linked.</p>
              <ErrorBox message={error} />
              {error && readAgain ? <small className="hid-ehr-dept-outreach-note">{LINK_RETRY_NOTE}</small> : null}
              <FormActions sticky={false}>
                <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={() => { if (!busy) { setOpen(false); setError('') } }}>Cancel</Button>
                <Button type="submit" variant="primary" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{checking ? 'Checking…' : busy ? 'Saving…' : 'Link existing patient'}</Button>
              </FormActions>
            </form>
          )}
        </div>
      </Card>
    )
  } else if (group) {
    nextStep = (
      <Alert intent="info" title="Their Health ID comes later">{LINKS_LATER}</Alert>
    )
  } else {
    nextStep = (
      <Alert intent="info" title="Waiting to be linked">
        This is a temporary registration. Someone who may write registrations needs to link it to the person’s Health ID.
      </Alert>
    )
  }

  return (
    <DeptPage title={caseName(item)} secondaryActions={<Button icon={Printer} onClick={printSlip}>Print slip</Button>} primaryAction={(
      // Unavailable while the link is sent, so its answer is not lost.
      <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Back to list</Button>
    )}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <Badge tone={linked ? 'success' : caseTone(item.status)}>{linked ? 'Linked' : statusLabel(item.status)}</Badge>
          <span>{ageText(item)} · {sexText(item)}</span>
          <span className="text-ink-3">Registered {dateText(item.createdAt)}</span>
        </div>
        <ErrorBox message={listError} />
        {/* Mounted throughout, so what was recorded is announced. */}
        <div id={`outreach-case-status-${item.id}`} role="status" className="hid-ehr-sr-only">
          {linked ? 'Patient linked. This registration case is now linked to the verified Health ID patient.' : ''}
        </div>
        {/* A refusal whose form is gone (the case, read again, no longer offers the link) is said here instead. */}
        {error && !(offered && open) ? <><ErrorBox message={error} />{readAgain ? <p className="hid-ehr-dept-outreach-note">{LINK_RETRY_NOTE}</p> : null}</> : null}
        {created && !linked
          ? <Alert intent="success" title="Registration saved">{pending ? group ? 'They have a temporary record. They can link their own Health ID to it later.'
            : 'They have a temporary record. Link it to their Health ID when you find it.' : `Its status is ${statusLabel(item.status).toLowerCase()}.`}</Alert>
          : null}
        {created && item.possibleDuplicate
          ? <Alert intent="warning" title="This may be someone already registered">Another registration in this campaign has the same
            phone number, or the same name and age. Check with the person before registering them again.</Alert>
          : null}
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @3xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            {nextStep}
            <HealthChecks facilityId={facilityId} caseId={item.id} canWrite={canWrite} />
            {/* While the registration waits for a Health ID: the person can make their own now, on their phone. */}
            {/* Where Outreach can make the Health ID (its registrations carry healthId), that comes first, and the person's own
                sign-up is the fallback; elsewhere the sign-up is the way, while the registration waits for a Health ID. */}
            {(pending && !linked) || item.healthId
              ? <CreateHealthId facilityId={facilityId} item={item} canWrite={canWrite} onPrintSlip={printSlip}
                onCreated={made => { if (made) setMadeHere(made); void onChanged() }} /> : null}
            {pending && !linked && !item.healthId
              ? <GetHealthIdNow id={`outreach-case-${item.id}-health-id`} fallback={'healthId' in item} /> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader as="h2" title="Registration" />
              <div className="p-5"><DeptFacts facts={facts} /></div>
            </Card>
          </div>
        </div>
        {onNew && pending && !linked ? <Button variant="link" iconRight={ArrowRight} className="self-start" onClick={onNew}>Register another person</Button> : null}
      </div>
      {sheet}
      {slipArea}
    </DeptPage>
  )
}
