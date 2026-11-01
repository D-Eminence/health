import { useRef, useState, type FormEvent } from 'react'
import { EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { ArrowRight, CircleCheck, Link2, UserPlus } from 'lucide-react'
import { FormActions } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader } from '../../../kasuwa/ui'
import { useConfirm } from '../../clinical/parts/confirm'
import { staffApi, type OutreachCampaign, type OutreachCase } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptPage } from '../parts/DeptPage'
import { DeptFacts } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import {
  ageText, caseFacts, caseName, caseTone, COMPLETE_FIELD, controlProps, ErrorBox, LINK_FAILED, OutreachField, PENDING, reference,
  LINK_RETRY_NOTE, REASON_LENGTH, sexText, statusLabel, type FieldErrors,
} from './outreachParts'

type LinkField = 'patient' | 'reason'

/**
 * One registration case: who it is, its status, and one clear next step. While the case waits for identity, the next
 * step is today's one action (link a verified existing patient, for a membership that may write registrations); once
 * linked, a done state with the way on.
 */
export function OutreachCaseView({ facilityId, item, campaign, canLink, created, listError, onBack, onNew, onChanged, onFocusHeading }: {
  readonly facilityId: string
  readonly item: OutreachCase
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
  const doneId = `outreach-case-${item.id}-done`

  async function linkExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || asking.current) return
    const form = new FormData(event.currentTarget)
    const canonicalPatientId = String(form.get('patientId') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    setError('')
    // Sent only with a patient ID and a reason of at least 8 characters, as Outreach takes them.
    const errors: Partial<Record<LinkField, string>> = {}
    if (!canonicalPatientId) errors.patient = COMPLETE_FIELD
    if (!reason) errors.reason = COMPLETE_FIELD
    else if (reason.length < 8) errors.reason = REASON_LENGTH
    const first = errors.patient ? 'patient' : errors.reason ? 'reason' : undefined
    if (first) {
      const target = first === 'patient' ? patientId : reasonId
      const here = document.activeElement?.id === target
      setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
      if (!here) focus(target)
      return
    }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    // Linking joins this person's field record to a patient's Health ID: confirm who, before it is sent.
    asking.current = true
    let confirmed = false
    try {
      confirmed = await ask({ title: 'Confirm the link', subject: <Card className="px-4 py-3"><p className="m-0 text-title-3 text-ink">{caseName(item)}</p>
        <p className="m-0 text-caption text-ink-2">{ageText(item)} · {sexText(item)} · case {reference(item.id)}</p></Card>,
      effect: <>Link this registration to the Health ID patient <strong className="tracking-[.04em]">{canonicalPatientId}</strong>? Check it is the same person.</>,
      confirmLabel: 'Link patient' })
    } finally { asking.current = false }
    if (!confirmed) return
    setBusy(true)
    setLinked(false)
    try {
      await staffApi.linkExistingOutreachCase(facilityId, item, canonicalPatientId, reason)
      setLinked(true)
      setOpen(false)
      // A link resolves the case, which removes its form: focus goes to what was done.
      focus(doneId)
      await onChanged()
      onFocusHeading()
    } catch (caught) {
      setError(errorText(caught, LINK_FAILED))
      // Read the case again, so a retry is checked against its latest version, not the one refused.
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const field = (key: LinkField) => ({ error: problems.errors[key], alert: problems.alert === key, seq: problems.seq })

  const back = () => { if (!busy) onBack() }
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
          description="Once you have found this person’s Health ID record, link it here so the temporary record joins it." />
        <div className="flex flex-col gap-4 p-5">
          {!open ? (
            <Button variant="primary" size="lg" aria-expanded={false} aria-controls={formId} className="self-start" onClick={() => setOpen(true)}>Link existing patient</Button>
          ) : (
            <form id={formId} className="flex flex-col gap-4" noValidate aria-label="Link existing patient" onSubmit={event => void linkExisting(event)}>
              <OutreachField id={patientId} label="Patient ID" required hint="The patient ID shown on their Health ID record." {...field('patient')}>
                <EhrInput name="patientId" required autoComplete="off" spellCheck={false} {...controlProps(patientId, problems.errors.patient, true)} />
              </OutreachField>
              <OutreachField id={reasonId} label="How you know it’s the same person" required hint="For example: name, age and phone match; seen in person." {...field('reason')}>
                <EhrTextarea name="reason" rows={3} minLength={8} maxLength={1000} required {...controlProps(reasonId, problems.errors.reason, true)} />
              </OutreachField>
              <p className="hid-ehr-dept-muted m-0">Health ID checks that you may open this patient and that the case hasn’t changed since you opened it.</p>
              <ErrorBox message={error} />
              {error ? <small className="hid-ehr-dept-outreach-note">{LINK_RETRY_NOTE}</small> : null}
              <FormActions sticky={false}>
                <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={() => { if (!busy) { setOpen(false); setError('') } }}>Cancel</Button>
                <Button type="submit" variant="primary" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Link existing patient'}</Button>
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
          <span className="text-ink-3">Registered {dateText(item.createdAt)} · case {reference(item.id)}</span>
        </div>
        <ErrorBox message={listError} />
        {/* Mounted throughout, so what was recorded is announced. */}
        <div id={`outreach-case-status-${item.id}`} role="status" className="hid-ehr-sr-only">
          {linked ? 'Patient linked. This registration case is now linked to the verified Health ID patient.' : ''}
        </div>
        {/* A refusal whose form is gone (the case, read again, no longer offers the link) is said here instead. */}
        {error && !(offered && open) ? <><ErrorBox message={error} /><p className="hid-ehr-dept-outreach-note">{LINK_RETRY_NOTE}</p></> : null}
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
        {onNew && pending && !linked ? <Button variant="link" iconRight={ArrowRight} className="self-start" onClick={onNew}>Register another person</Button> : null}
      </div>
      {sheet}
    </DeptPage>
  )
}
