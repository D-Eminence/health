import { useState, type FormEvent } from 'react'
import { EhrButton, EhrInput, EhrTextarea } from '@hid/ui/ehr'
import { staffApi, type OutreachCampaign, type OutreachCase } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptActions, DeptContextLine, DeptFacts, DeptRecordLayout } from '../parts/DeptRecord'
import { errorText } from '../parts/errors'
import { dateText } from '../parts/format'
import {
  caseFacts, caseName, COMPLETE_FIELD, controlProps, ErrorBox, LINK_FAILED, NO_ACTIONS, OutreachField, PENDING, reference,
  REASON_LENGTH, RETRY_NOTE, statusWords, type FieldErrors,
} from './outreachParts'

type LinkField = 'patient' | 'reason'

/**
 * One registration case as the design's record view: its status line, "Saved record",
 * "Available actions" with today's one action (link a verified existing patient, while the
 * case is pending identity resolution and the membership may write registrations), and what
 * the last step said.
 */
export function OutreachCaseView({ facilityId, item, campaign, canLink, created, listError, onBack, onChanged, onFocusHeading }: {
  readonly facilityId: string
  readonly item: OutreachCase
  readonly campaign: OutreachCampaign | undefined
  readonly canLink: boolean
  /** Opened from the create form, which made this case. */
  readonly created: boolean
  /** The registration case list's last read failed: what is shown may be out of date. */
  readonly listError: string
  readonly onBack: () => void
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

  async function linkExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
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
    setBusy(true)
    setLinked(false)
    try {
      await staffApi.linkExistingOutreachCase(facilityId, item, canonicalPatientId, reason)
      setLinked(true)
      setOpen(false)
      await onChanged()
      // A link resolves the case, which removes its form: focus goes to the case.
      onFocusHeading()
    } catch (caught) {
      setError(errorText(caught, LINK_FAILED))
    } finally {
      setBusy(false)
    }
  }

  const field = (key: LinkField) => ({ error: problems.errors[key], alert: problems.alert === key, seq: problems.seq })

  return (
    <DeptPage title={caseName(item)} onBack={onBack}>
      <DeptContextLine status={statusWords(item.status)} items={[`${caseName(item)} · ${reference(item.id)}`, `Created ${dateText(item.createdAt)}`]} />
      <ErrorBox message={listError} />
      {/* Mounted throughout, so what was recorded is announced. */}
      <div id={`outreach-case-status-${item.id}`} role="status">
        {linked && (
          <DeptNotice title="Patient linked">This registration case is now linked to the verified Health ID patient.</DeptNotice>
        )}
      </div>
      {pending && !linked && (created
        ? <DeptNotice title="Registration case created">It stays pending until it is linked to a verified Health ID patient.</DeptNotice>
        : <DeptNotice title="Identity resolution pending">This is a temporary registration. It stays pending until it is linked to a verified Health ID patient.</DeptNotice>)}
      <DeptRecordLayout
        main={<DeptSection title="Saved record"><DeptFacts facts={caseFacts(item, campaign)} /></DeptSection>}
        aside={(
          <DeptActions empty={NO_ACTIONS}>
            {offered && (
              <EhrButton variant="secondary" aria-expanded={open} aria-controls={open ? formId : undefined} onClick={() => setOpen(value => !value)}>
                Link existing patient
              </EhrButton>
            )}
            {offered && open && (
              <form id={formId} className="hid-ehr-dept-action-form" noValidate aria-label="Link existing patient" onSubmit={event => void linkExisting(event)}>
                <OutreachField id={patientId} label="Patient ID" required {...field('patient')}>
                  <EhrInput name="patientId" required autoComplete="off" spellCheck={false} {...controlProps(patientId, problems.errors.patient)} />
                </OutreachField>
                <OutreachField id={reasonId} label="Reason for linking" required {...field('reason')}>
                  <EhrTextarea name="reason" rows={3} minLength={8} maxLength={1000} required {...controlProps(reasonId, problems.errors.reason)} />
                </OutreachField>
                <p className="hid-ehr-dept-muted">Health ID checks that you may open this patient and that the case has not changed since you opened it.</p>
                <ErrorBox message={error} />
                <div className="hid-ehr-dept-outreach-footer">
                  <EhrButton type="submit" busy={busy}>{busy ? 'Saving…' : 'Link existing patient'}</EhrButton>
                  {error ? <small className="hid-ehr-dept-outreach-note">{RETRY_NOTE}</small> : null}
                </div>
              </form>
            )}
          </DeptActions>
        )}
      />
    </DeptPage>
  )
}
