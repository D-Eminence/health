import { useState, type FormEvent, type MutableRefObject } from 'react'
import { EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { ArrowLeft } from 'lucide-react'
import { FormActions, FormPage, Step } from '../../../kasuwa/parts'
import { Button } from '../../../kasuwa/ui'
import { staffApi, type OutreachCampaign, type OutreachCase } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { errorText } from '../parts/errors'
import {
  AGE_RANGE, AT_LEAST_THREE, COMPLETE_FIELD, controlProps, CREATE_FAILED, ErrorBox, OutreachField, RETRY_NOTE, type FieldErrors,
} from './outreachParts'

/**
 * The case last sent, with its command: its localCommandId (also its Idempotency-Key) and
 * temporary patient ID. Sending the same case again, after a lost answer or a refusal, sends
 * the same command, which Outreach answers with the case it made; a different case, or the
 * next one once this one is created, gets a new command. In memory only, kept by the page
 * so it outlives this form.
 */
export type CaseAttempt = { signature: string; command: { localCommandId: string; temporaryPatientId: string } } | null

type CaseField = 'name' | 'age' | 'phone' | 'notes'
const FIELD_ORDER: readonly CaseField[] = ['name', 'age', 'phone', 'notes']
const FIELD_ID: Record<CaseField, string> = {
  name: 'outreach-case-name', age: 'outreach-case-age', phone: 'outreach-case-phone', notes: 'outreach-case-notes',
}

/**
 * "New registration": a person met in the field, registered as a temporary case in three short steps (who they are,
 * how to reach them, the campaign and notes), on today's registration case request: the same fields, the same checks
 * before sending (CreateRegistrationCaseDto), and the same command for the same case. The case is then opened, with
 * its next step: linking it to a verified Health ID patient.
 */
export function OutreachNew({ facilityId, showCampaign, campaigns, attempt, onBack, onSending, onCreated }: {
  readonly facilityId: string
  /** Whether the membership reads campaigns, so a case may name one. */
  readonly showCampaign: boolean
  /** The campaigns a case may be registered under: active registration campaigns this membership belongs to. */
  readonly campaigns: readonly OutreachCampaign[]
  readonly attempt: MutableRefObject<CaseAttempt>
  readonly onBack: () => void
  /** A case is being sent: what the last one said no longer applies. */
  readonly onSending: () => void
  readonly onCreated: (created: OutreachCase) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<FieldErrors<CaseField>>({ errors: {}, seq: 0 })
  const focus = useFocusById()

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const element = event.currentTarget
    const form = new FormData(element)
    const campaignId = String(form.get('campaignId') ?? '') || undefined
    const fullName = String(form.get('fullName') ?? '').trim()
    const sex = String(form.get('sex') ?? 'unknown')
    const age = String(form.get('ageYears') ?? '').trim()
    const ageYears = Number(age)
    const phone = String(form.get('phone') ?? '').trim() || undefined
    const operationalNotes = String(form.get('operationalNotes') ?? '').trim() || undefined
    // The last answer no longer applies.
    setError('')
    // The form checks its own fields as Outreach does (CreateRegistrationCaseDto). A phone number and operational
    // notes are taken at 3 characters or more, or none, as sent: trimmed, which a native minLength does not check.
    const errors: Partial<Record<CaseField, string>> = {}
    if (!fullName) errors.name = COMPLETE_FIELD
    if (!age) errors.age = COMPLETE_FIELD
    else if (!Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) errors.age = AGE_RANGE
    if (phone !== undefined && phone.length < 3) errors.phone = AT_LEAST_THREE
    if (operationalNotes !== undefined && operationalNotes.length < 3) errors.notes = AT_LEAST_THREE
    const first = FIELD_ORDER.find(field => errors[field])
    if (first) {
      const here = document.activeElement?.id === FIELD_ID[first]
      setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
      if (!here) focus(FIELD_ID[first])
      return
    }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    const input = { campaignId, fullName, sex, ageYears, phone, operationalNotes }
    const signature = JSON.stringify([facilityId, input])
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, command: { localCommandId: crypto.randomUUID(), temporaryPatientId: `tmp_${crypto.randomUUID()}` } }
    }
    onSending()
    setBusy(true)
    try {
      const created = await staffApi.createOutreachCase(facilityId, input, attempt.current.command)
      attempt.current = null
      element.reset()
      onCreated(created)
    } catch (caught) {
      setError(errorText(caught, CREATE_FAILED))
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (field: CaseField) => problems.errors[field]
  const field = (key: CaseField) => ({ error: fieldError(key), alert: problems.alert === key, seq: problems.seq })

  // Unavailable while the case is sent, so its answer (a refusal to correct, or the case made) is not lost.
  const back = () => { if (!busy) onBack() }
  return (
    <FormPage title="New registration"
      description="Register someone you meet in the field. They get a temporary record now, and you link it to their Health ID later."
      actions={<Button variant="ghost" icon={ArrowLeft} className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Back to list</Button>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={event => void createCase(event)}>
        <p className="m-0 text-caption text-ink-3">Fields marked * are required.</p>
        <Step n={1} title="Who they are" hint="As they say it. You can correct it when you link their Health ID.">
          <OutreachField id={FIELD_ID.name} label="Full name" required {...field('name')}>
            <EhrInput name="fullName" maxLength={200} required autoComplete="off" {...controlProps(FIELD_ID.name, fieldError('name'))} />
          </OutreachField>
          <div className="grid gap-4 @md:grid-cols-2">
            <OutreachField id="outreach-case-sex" label="Sex" required>
              <EhrSelect name="sex" required {...controlProps('outreach-case-sex', undefined)}>
                <option value="unknown">Not known</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </EhrSelect>
            </OutreachField>
            <OutreachField id={FIELD_ID.age} label="Age in years" required hint="A best guess is fine. Under 1 year: enter 0." {...field('age')}>
              <EhrInput name="ageYears" type="number" inputMode="numeric" min="0" max="130" required {...controlProps(FIELD_ID.age, fieldError('age'), true)} />
            </OutreachField>
          </div>
        </Step>
        <Step n={2} title="How to reach them" hint="Optional. Used to follow up.">
          <OutreachField id={FIELD_ID.phone} label="Phone number (optional)" hint="With or without +234." {...field('phone')}>
            <EhrInput name="phone" type="tel" inputMode="tel" minLength={3} maxLength={32} autoComplete="off" {...controlProps(FIELD_ID.phone, fieldError('phone'), true)} />
          </OutreachField>
        </Step>
        <Step n={3} title="Campaign and notes">
          {showCampaign && (
            <OutreachField id="outreach-case-campaign" label="Campaign (optional)"
              hint={campaigns.length ? 'Only active registration campaigns you belong to are listed.' : 'You aren’t in an active registration campaign. You can save without one.'}>
              <EhrSelect name="campaignId" {...controlProps('outreach-case-campaign', undefined, true)}>
                <option value="">No campaign</option>
                {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
              </EhrSelect>
            </OutreachField>
          )}
          <OutreachField id={FIELD_ID.notes} label="Notes for the team (optional)" hint="Where you met them, what they need next. Not a clinical note." {...field('notes')}>
            <EhrTextarea name="operationalNotes" rows={3} minLength={3} maxLength={2000} {...controlProps(FIELD_ID.notes, fieldError('notes'), true)} />
          </OutreachField>
        </Step>
        <ErrorBox message={error} />
        {error ? <small className="hid-ehr-dept-outreach-note">{RETRY_NOTE}</small> : null}
        <FormActions>
          <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Cancel</Button>
          <Button type="submit" variant="primary" size="lg" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Save registration'}</Button>
        </FormActions>
      </form>
    </FormPage>
  )
}
