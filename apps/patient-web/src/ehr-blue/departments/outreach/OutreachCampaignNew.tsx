import { useState, type FormEvent } from 'react'
import { EhrInput } from '@hid/ui/ehr'
import { isHidApiError } from '@hid/http'
import { ArrowLeft } from 'lucide-react'
import { FormActions, FormPage, Step } from '../../../kasuwa/parts'
import { Button } from '../../../kasuwa/ui'
import { staffApi, type OutreachCampaign } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import {
  CAMPAIGN_CREATE_FAILED, CAMPAIGN_CREATE_UNSURE, CAMPAIGN_SERVICES, campaignErrorText, CHOOSE_SERVICE, COMPLETE_FIELD, controlProps,
  END_AFTER_START, ErrorBox, lagosDayInstant, NAME_LENGTH, OutreachField, RETRY_NOTE, type FieldErrors,
} from './outreachParts'

type CampaignField = 'name' | 'services' | 'starts' | 'ends'
const FIELD_ORDER: readonly CampaignField[] = ['name', 'services', 'starts', 'ends']
const FIELD_ID: Record<CampaignField, string> = {
  name: 'outreach-campaign-name', services: `outreach-campaign-service-${CAMPAIGN_SERVICES[0]!.value}`,
  starts: 'outreach-campaign-starts', ends: 'outreach-campaign-ends',
}
const SERVICES_ID = 'outreach-campaign-services'

/**
 * "New campaign" (hid-system#222, 0122): a name, the services the team will offer, and its dates, checked here as
 * Outreach checks them (CreateCampaignDto: a name of 2 to 200 characters, known services, an end after the start). The
 * person who creates it becomes its first admin. Dates are days in Nigerian time: it starts at the start of its first
 * day and ends at the end of its last. Outreach takes no Idempotency-Key here, so a create whose answer was lost is
 * not sent again by itself: the list is read again and the person is asked to check it first.
 */
export function OutreachCampaignNew({ facilityId, onBack, onCreated, onUnsure }: {
  readonly facilityId: string
  readonly onBack: () => void
  readonly onCreated: (created: OutreachCampaign) => void
  /** No answer came: reads the campaigns again, since this one may be saved. */
  readonly onUnsure: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; unsure: boolean } | null>(null)
  const [problems, setProblems] = useState<FieldErrors<CampaignField>>({ errors: {}, seq: 0 })
  const focus = useFocusById()

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const services = CAMPAIGN_SERVICES.map(service => service.value).filter(value => form.getAll('services').includes(value))
    const starts = String(form.get('startsOn') ?? '')
    const ends = String(form.get('endsOn') ?? '')
    setError(null)
    const errors: Partial<Record<CampaignField, string>> = {}
    if (!name) errors.name = COMPLETE_FIELD
    else if (name.length < 2) errors.name = NAME_LENGTH
    if (!services.length) errors.services = CHOOSE_SERVICE
    if (!starts) errors.starts = COMPLETE_FIELD
    if (starts && ends && ends < starts) errors.ends = END_AFTER_START
    const first = FIELD_ORDER.find(field => errors[field])
    if (first) {
      const here = document.activeElement?.id === FIELD_ID[first]
      setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
      if (!here) focus(FIELD_ID[first])
      return
    }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    setBusy(true)
    try {
      const created = await staffApi.createOutreachCampaign(facilityId, {
        name, services, startsAt: lagosDayInstant(starts), ...(ends ? { endsAt: lagosDayInstant(ends, true) } : {}),
      })
      onCreated(created)
    } catch (caught) {
      // Refused by Outreach: nothing was saved. No answer, or the gateway's lost one (502, 504): it may have been.
      const unsure = !isHidApiError(caught) || caught.status === 0 || caught.status === 502 || caught.status === 504
      setError({ text: campaignErrorText(caught, CAMPAIGN_CREATE_FAILED), unsure })
      if (unsure) onUnsure()
    } finally {
      setBusy(false)
    }
  }

  const field = (key: CampaignField) => ({ error: problems.errors[key], alert: problems.alert === key, seq: problems.seq })
  const servicesError = problems.errors.services
  const back = () => { if (!busy) onBack() }
  return (
    <FormPage title="New campaign"
      description="Plan outreach work. You become the campaign’s first admin: you add the people who work on it, and open and close it."
      actions={<Button variant="ghost" icon={ArrowLeft} className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Back to list</Button>}>
      <form className="flex flex-col gap-4" noValidate onSubmit={event => void create(event)}>
        <p className="m-0 text-caption text-ink-3">Fields marked * are required.</p>
        <Step n={1} title="What it is">
          <OutreachField id={FIELD_ID.name} label="Campaign name" required hint="For example: the place and what it is for." {...field('name')}>
            <EhrInput name="name" maxLength={200} required autoComplete="off" {...controlProps(FIELD_ID.name, problems.errors.name, true)} />
          </OutreachField>
          <fieldset id={SERVICES_ID} className="hid-ehr-blue-check-field m-0 border-0 p-0"
            aria-describedby={servicesError ? `${SERVICES_ID}-error` : `${SERVICES_ID}-hint`} aria-invalid={servicesError ? true : undefined}>
            <legend className="hid-ehr-label">Services<span aria-hidden="true"> *</span></legend>
            {CAMPAIGN_SERVICES.map(service => (
              <label key={service.value} className="hid-ehr-blue-check">
                <input type="checkbox" id={`outreach-campaign-service-${service.value}`} name="services" value={service.value}
                  className="hid-ehr-blue-check-input" defaultChecked={service.value === 'registration'} />
                <span>{service.label}{service.hint ? <span className="hid-ehr-dept-muted"> · {service.hint}</span> : null}</span>
              </label>
            ))}
            {servicesError
              ? <p id={`${SERVICES_ID}-error`} className="hid-ehr-error">{problems.alert === 'services' ? <span key={problems.seq} role="alert">{servicesError}</span> : servicesError}</p>
              : <p id={`${SERVICES_ID}-hint`} className="hid-ehr-hint">What the team will do on it.</p>}
          </fieldset>
        </Step>
        <Step n={2} title="When it runs" hint="Days in Nigerian time. You open it once it has started, and close it when the work is done.">
          <div className="grid gap-4 @md:grid-cols-2">
            <OutreachField id={FIELD_ID.starts} label="Start date" required {...field('starts')}>
              <EhrInput name="startsOn" type="date" required {...controlProps(FIELD_ID.starts, problems.errors.starts)} />
            </OutreachField>
            <OutreachField id={FIELD_ID.ends} label="End date (optional)" hint="Leave blank if it has no set end." {...field('ends')}>
              <EhrInput name="endsOn" type="date" {...controlProps(FIELD_ID.ends, problems.errors.ends, true)} />
            </OutreachField>
          </div>
        </Step>
        <ErrorBox message={error?.text ?? ''} />
        {error ? <small className="hid-ehr-dept-outreach-note">{error.unsure ? CAMPAIGN_CREATE_UNSURE : RETRY_NOTE}</small> : null}
        <FormActions>
          <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Cancel</Button>
          <Button type="submit" variant="primary" size="lg" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Create campaign'}</Button>
        </FormActions>
      </form>
    </FormPage>
  )
}
