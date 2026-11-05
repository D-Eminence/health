import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { ArrowRight, CircleCheck, Link2, UserPlus } from 'lucide-react'
import { FormActions } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { useConfirm } from '../../clinical/parts/confirm'
import { staffApi, type OutreachCampaign, type OutreachCase, type PatientSummary } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptPage } from '../parts/DeptPage'
import { DeptFacts } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { refusedFields } from '../../../staff/fieldProblem'
import { birthDateText, dateText } from '../parts/format'
import {
  ageText, CASE_GONE, caseFacts, caseName, caseTone, COMPLETE_FIELD, controlProps, ErrorBox, HEALTH_ID_FORMAT, HEALTH_ID_HINT,
  HEALTH_ID_LIMIT, HEALTH_ID_NO_ACCESS, HEALTH_ID_NOT_FOUND, HEALTH_ID_ROLE, healthIdFrom, LINK_ALREADY_DONE, LINK_CHANGED,
  LINK_FAILED, LINK_NEEDS_SHARE, LOOKUP_FAILED, OutreachField, PENDING, LINK_RETRY_NOTE, REASON_LENGTH, registeredByText, sexText,
  statusLabel, type FieldErrors,
} from './outreachParts'
import { outreachVisitsApi, type OutreachCaseServed, type OutreachLinkPreview } from './outreachVisitsApi'
import { learnOutreachVisitsServed, useOutreachVisitsServed } from './outreachVisitsServed'
import { OutreachVisits } from './OutreachVisits'

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

/** Where a refused Health ID preview or link leaves the form (hid-system 0115): a field's words, or the form's. */
type ServedRefusal = { field: Partial<Record<LinkField, string>> } | { form: string; readAgain: boolean; reread: boolean }

/**
 * A refusal of the Health ID preview (`preview`) or of the link by Health ID, in plain words. A case already resolved, a
 * version gone stale, or a case gone is read again, so the next attempt is made against what is there now.
 */
function servedRefusal(caught: unknown, step: 'preview' | 'link'): ServedRefusal {
  const fallback = step === 'preview' ? LOOKUP_FAILED : LINK_FAILED
  if (!isHidApiError(caught)) return { form: errorText(caught, fallback), readAgain: false, reread: false }
  const { status, code } = caught
  if (status === 404 && code === 'OUTREACH_HEALTH_ID_NOT_FOUND') return { field: { patient: HEALTH_ID_NOT_FOUND } }
  if (status === 404 && code === 'OUTREACH_REGISTRATION_NOT_FOUND') return { form: CASE_GONE, readAgain: false, reread: true }
  if (status === 429) return { field: { patient: HEALTH_ID_LIMIT } }
  if (status === 409) return { form: LINK_ALREADY_DONE, readAgain: false, reread: true }
  if (status === 412) return { form: LINK_CHANGED, readAgain: false, reread: true }
  if (status === 400 && code === 'VALIDATION_FAILED') {
    const fields = refusedFields(caught).map(entry => entry.field)
    if (fields.includes('reason')) return { field: { reason: REASON_LENGTH } }
    return { field: { patient: HEALTH_ID_FORMAT } }
  }
  if (status === 403 && code === 'PERMISSION_DENIED') return { field: { patient: HEALTH_ID_ROLE } }
  // Reading the record needs access; linking it needs a share for care, which a PIN never gives.
  if (status === 403 && step === 'preview' && NO_ACCESS.has(code)) return { field: { patient: HEALTH_ID_NO_ACCESS } }
  if (status === 403 && step === 'link' && NO_WRITE.has(code)) return { field: { patient: LINK_NEEDS_SHARE } }
  return { form: errorText(caught, fallback), readAgain: step === 'link', reread: step === 'link' }
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
export function OutreachCaseView({ facilityId, item, campaign, canLink, canRead = true, created, listError, onBack, onNew, onChanged, onFocusHeading }: {
  readonly facilityId: string
  readonly item: OutreachCase
  /** The membership may read registrations: the case's visits are listed (once served). */
  readonly canRead?: boolean
  readonly campaign: OutreachCampaign | undefined
  readonly canLink: boolean
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
  const offered = canLink && pending
  const { ask, sheet } = useConfirm()
  const asking = useRef(false)
  /** The key of the last link by Health ID sent, kept for a repeat of the same link (a lost answer) and dropped once settled. */
  const linkAttempt = useRef<{ body: string; key: string } | null>(null)
  const doneId = `outreach-case-${item.id}-done`
  const served = useOutreachVisitsServed()

  /** Who this registration is, as the confirm sheet shows it above the person found. */
  const confirmSubject = () => <Card className="px-4 py-3"><p className="m-0 text-title-3 text-ink">{caseName(item)}</p>
    <p className="m-0 text-caption text-ink-2">{ageText(item)} · {sexText(item)} · registered {dateText(item.createdAt)}</p></Card>

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
    if (served) {
      await linkByHealthId(hid, reason)
      return
    }
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
      confirmed = await ask({ title: 'Confirm the link', subject: confirmSubject(),
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

  /**
   * Once 0115 is served: Outreach previews the person the Health ID names (name, date of birth, the Health ID's last
   * four), says so plainly when the link would be refused, and links by the Health ID itself, looking it up again.
   */
  async function linkByHealthId(hid: string, reason: string) {
    setBusy(true)
    setChecking(true)
    let preview: OutreachLinkPreview | undefined
    try {
      preview = await outreachVisitsApi.previewLink(facilityId, item.id, hid)
    } catch (caught) {
      await sayRefusal(servedRefusal(caught, 'preview'))
    } finally {
      setBusy(false)
      setChecking(false)
    }
    if (!preview) return
    // They can be viewed (a PIN, or a read-only share) but not linked: said before anyone tries, with no Link offered.
    if (!preview.canLink) {
      refuse({ patient: LINK_NEEDS_SHARE })
      return
    }
    const name = preview.patient.fullName?.trim() || 'Name not recorded'
    const born = birthDateText(preview.patient.dateOfBirth)
    const last4 = preview.patient.healthIdLast4
    asking.current = true
    let confirmed = false
    try {
      confirmed = await ask({ title: 'Confirm the link', subject: confirmSubject(),
      effect: <>Link this registration to the Health ID record of <strong>{name}</strong>,
        {' '}{born ? <>born <strong>{born}</strong></> : 'whose date of birth is not recorded'}? Check it is the same person.
        {last4 ? <>{' '}Their Health ID ends in <strong>{last4}</strong>.</> : null}</>,
      confirmLabel: 'Link patient' })
    } finally { asking.current = false }
    if (!confirmed) return
    setBusy(true)
    setLinked(false)
    const body = JSON.stringify([item.id, hid, reason, item.rowVersion])
    const key = linkAttempt.current?.body === body ? linkAttempt.current.key : crypto.randomUUID()
    linkAttempt.current = { body, key }
    try {
      const answer = await outreachVisitsApi.linkByHealthId(facilityId, item, hid, reason, key)
      linkAttempt.current = null
      learnOutreachVisitsServed([answer])
      setLinked(true)
      setOpen(false)
      focus(doneId)
      await onChanged()
      onFocusHeading()
    } catch (caught) {
      // Settled by the refusal: the case is read again, and a new attempt is a new link.
      if (isHidApiError(caught) && (caught.status === 409 || caught.status === 412)) linkAttempt.current = null
      await sayRefusal(servedRefusal(caught, 'link'), true)
    } finally {
      setBusy(false)
    }
  }

  /** Says a refusal of the preview or link by Health ID; reads the case again when it asks to (always, after a link). */
  async function sayRefusal(refusal: ServedRefusal, afterLink = false) {
    if ('field' in refusal) refuse(refusal.field)
    else { setError(refusal.form); setReadAgain(refusal.readAgain) }
    if (afterLink || ('reread' in refusal && refusal.reread)) await onChanged()
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

  const back = () => { if (!busy) onBack() }
  const facts = caseFacts(item, campaign, served)
  // Once served: who registered the case, and its campaign by name (the answer's own, for a membership that can't read campaigns).
  const registeredBy = served ? registeredByText(item as OutreachCaseServed) : ''
  const campaignName = served ? (campaign?.name ?? (item as OutreachCaseServed).campaignName?.trim()) || '' : ''

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
  } else {
    nextStep = (
      <Alert intent="info" title="Waiting to be linked">
        This is a temporary registration. Someone who may write registrations needs to link it to the person’s Health ID.
      </Alert>
    )
  }

  return (
    <DeptPage title={caseName(item)} primaryAction={(
      // Unavailable while the link is sent, so its answer is not lost.
      <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Back to list</Button>
    )}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <Badge tone={linked ? 'success' : caseTone(item.status)}>{linked ? 'Linked' : statusLabel(item.status)}</Badge>
          <span>{ageText(item)} · {sexText(item)}</span>
          <span className="text-ink-3">Registered {dateText(item.createdAt)}</span>
          {registeredBy ? <span>{registeredBy}</span> : null}
          {campaignName ? <span>{campaignName}</span> : null}
        </div>
        <ErrorBox message={listError} />
        {/* Mounted throughout, so what was recorded is announced. */}
        <div id={`outreach-case-status-${item.id}`} role="status" className="hid-ehr-sr-only">
          {linked ? 'Patient linked. This registration case is now linked to the verified Health ID patient.' : ''}
        </div>
        {/* A refusal whose form is gone (the case, read again, no longer offers the link) is said here instead. */}
        {error && !(offered && open) ? <><ErrorBox message={error} />{readAgain ? <p className="hid-ehr-dept-outreach-note">{LINK_RETRY_NOTE}</p> : null}</> : null}
        {created && !linked
          ? <Alert intent="success" title="Registration saved">{pending ? 'They have a temporary record. Link it to their Health ID when you find it.' : `Its status is ${statusLabel(item.status).toLowerCase()}.`}</Alert>
          : null}
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @3xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">{nextStep}</div>
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader as="h2" title="Registration" />
              <div className="p-5"><DeptFacts facts={facts} /></div>
            </Card>
          </div>
        </div>
        {served && (canRead || canLink) ? <OutreachVisits facilityId={facilityId} caseId={item.id} canRead={canRead} canWrite={canLink} onCaseChanged={onChanged} /> : null}
        {onNew && pending && !linked ? <Button variant="link" iconRight={ArrowRight} className="self-start" onClick={onNew}>Register another person</Button> : null}
      </div>
      {sheet}
    </DeptPage>
  )
}
