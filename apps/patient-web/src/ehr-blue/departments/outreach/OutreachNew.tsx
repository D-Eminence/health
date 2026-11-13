import { useRef, useState, type FormEvent, type MutableRefObject } from 'react'
import { isHidApiError, isStoppedRequest } from '@hid/http'
import { EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { ArrowLeft } from 'lucide-react'
import { FormActions, FormPage, Step } from '../../../kasuwa/parts'
import { Button } from '../../../kasuwa/ui'
import { staffApi, type OutreachCampaign, type OutreachCase, type OutreachCaseInput, type OutreachConsentLanguage, type OutreachConsentMethod } from '../../../staff/api'
import { CONSENT_LANGUAGES, CONSENT_METHODS, OUTREACH_NOTES_LIMIT, REGISTRATION_NOTICE_VERSION, registrationNotice } from '../../../outreachTerms'
import { outreachProblemText } from '../../../outreachProblems'
import { waitReason, waitsForNetwork, waitsForSignIn, type PendingRegistration, type WaitReason } from './offlineQueue'
import { useFocusById } from '../../../staff/focus'
import { errorText } from '../parts/errors'
import {
  AGE_RANGE, AT_LEAST_THREE, campaignRefusedText, COMPLETE_FIELD, controlProps, CREATE_FAILED, ErrorBox, OutreachField, outreachPhoneAccepted,
  PHONE_FORMAT, PHONE_HINT, RETRY_NOTE, type CampaignsUnread, type FieldErrors,
} from './outreachParts'

/**
 * Outreach's refusals of the campaign a case names (outreach.service.ts assertCampaignAcceptsRegistration and the
 * campaign routes), by status and code. A 500 is never one of them: since backend 0110 (hid-system#181), live in production,
 * a 500 is a real fault (the case may have been saved and only its answer lost), so it is said as any other failure and
 * retried as the same command; saving again without the campaign would send a new command and could register the
 * same person twice.
 */
const CAMPAIGN_REFUSALS: ReadonlyArray<readonly [number, string]> = [
  [403, 'OUTREACH_CAMPAIGN_ACCESS_DENIED'],
  [409, 'OUTREACH_CAMPAIGN_NOT_ACCEPTING_REGISTRATIONS'],
  [409, 'OUTREACH_CAMPAIGN_CLOSED'],
  [409, 'OUTREACH_CAMPAIGN_NOT_STARTED'],
  [404, 'OUTREACH_CAMPAIGN_NOT_FOUND'],
]
function campaignRefused(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  return CAMPAIGN_REFUSALS.some(([status, code]) => caught.status === status && caught.code === code)
}

/** "No signal" mode, when this device could not keep the registration. */
const KEEP_FAILED = 'This registration couldn’t be saved on this device. Try again.'

const CAMPAIGN_FIELD = 'outreach-case-campaign'
const CAMPAIGN_REFUSED_ID = 'outreach-case-campaign-refused'
const SAVE_ID = 'outreach-case-save'

/**
 * The case last sent, with its command: its localCommandId (also its Idempotency-Key) and
 * temporary patient ID. Sending the same case again, after a lost answer or a refusal, sends
 * the same command, which Outreach answers with the case it made; a different case, or the
 * next one once this one is created, gets a new command. In memory only, kept by the page
 * so it outlives this form.
 */
export type CaseAttempt = { signature: string; command: { localCommandId: string; temporaryPatientId: string } } | null

/** Where the person lives ("Area, town or LGA"), as Outreach takes it (0118): up to 100 characters. */
const AREA_LIMIT = 100
/** A parent or guardian's name, as Outreach and the database take it: 2 to 120 characters. */
const GUARDIAN_NAME_LIMIT = 120
const UNDER_18_METHOD = 'This person is under 18. Choose “Their parent or guardian agreed for them”.'
/** An age entered as a whole number under 18. */
const isMinorAge = (age: string) => age !== '' && Number.isInteger(Number(age)) && Number(age) >= 0 && Number(age) < 18

type CaseField = 'method' | 'guardian' | 'name' | 'age' | 'phone' | 'area' | 'campaign' | 'notes'
const FIELD_ORDER: readonly CaseField[] = ['method', 'guardian', 'name', 'age', 'phone', 'area', 'campaign', 'notes']
const FIELD_ID: Record<CaseField, string> = {
  method: 'outreach-consent-method-verbal_read_aloud', guardian: 'outreach-consent-guardian',
  name: 'outreach-case-name', age: 'outreach-case-age', phone: 'outreach-case-phone', area: 'outreach-case-area', campaign: 'outreach-case-campaign',
  notes: 'outreach-case-notes',
}

/**
 * At an outreach group (open sign-up on outreach.): the group's name for the notice, and the device's queue, which keeps
 * each registration from before it is first sent until Health ID takes it, so a reload while it is saving loses nothing.
 * A hospital's outreach team has neither.
 */
export interface OutreachGroupForm {
  readonly name: string
  readonly queue: (entry: Pick<PendingRegistration, 'localCommandId' | 'temporaryPatientId' | 'input'>) => Promise<void>
  /** Takes a registration off this device: Health ID took it, or refused it while the person is still here to correct it. */
  readonly dequeue: (localCommandId: string) => Promise<void>
  /** Claims a registration for sending (offlineQueue.ts claimSend): null while another sender has it. */
  readonly claim: (localCommandId: string) => Promise<(() => void) | null>
  /** A registration was kept on this device, and why it could not be sent: the form is cleared for the next person. */
  readonly onQueued: (queued: { readonly fullName: string; readonly localCommandId: string; readonly reason: WaitReason | 'session' }) => void
}

/** Why no campaign is listed, at an outreach group, when it isn't that the person is in none. */
const GROUP_CAMPAIGNS_UNREAD: Readonly<Record<CampaignsUnread, string>> = {
  loading: 'Your campaigns are still loading.',
  offline: 'Your campaigns couldn’t be loaded without signal. Open Outreach again once you have signal, and keep it open to register people offline.',
  failed: 'Your campaigns couldn’t be loaded. Go back to the list and press Refresh.',
}

/**
 * "New registration": a person met in the field, registered as a temporary case in three short steps (who they are,
 * how to reach them, the campaign and notes), on today's registration case request: the same fields, the same checks
 * before sending (CreateRegistrationCaseDto), and the same command for the same case. The case is then opened, with
 * its next step: linking it to a verified Health ID patient.
 */
export function OutreachNew({ facilityId, showCampaign, campaigns, campaignsUnread, attempt, group, healthChecksServed = false, offline = false, onBack, onSending, onCreated }: {
  readonly facilityId: string
  /** Whether the membership reads campaigns, so a case may name one. */
  readonly showCampaign: boolean
  /** The campaigns a case may be registered under: active registration campaigns this membership belongs to. */
  readonly campaigns: readonly OutreachCampaign[]
  /** Set when the campaigns, or their members, are still being read or couldn't be: none listed then says why, never "not in one". */
  readonly campaignsUnread?: CampaignsUnread
  readonly attempt: MutableRefObject<CaseAttempt>
  /**
   * At an outreach group: the person's agreement comes first (the notice, its language, how they agreed, and a guardian
   * for anyone under 18), a campaign is required, notes keep no health check results (those go in Health checks), and a registration that could
   * not be sent waits on this device. Absent at a hospital, where the form is today's.
   */
  readonly group?: OutreachGroupForm
  /**
   * Outreach serves 0118 (its registrations carry `hasScreening`): only then the area field and notes of
   * OUTREACH_NOTES_LIMIT characters; before it, no area and the earlier 280.
   */
  readonly healthChecksServed?: boolean
  /**
   * "No signal" mode (OfflineOutreach.tsx), at an outreach group: the session could not be read, so nothing is sent; the
   * registration is kept on this device at once, with its command, and sent once the session is read again.
   */
  readonly offline?: boolean
  readonly onBack: () => void
  /** A case is being sent: what the last one said no longer applies. */
  readonly onSending: () => void
  readonly onCreated: (created: OutreachCase) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** The campaign that refused the last case sent: the person can be saved without it. */
  const [refusedBy, setRefusedBy] = useState<{ readonly name: string | undefined } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [problems, setProblems] = useState<FieldErrors<CaseField>>({ errors: {}, seq: 0 })
  const [language, setLanguage] = useState<OutreachConsentLanguage>('en')
  const [method, setMethod] = useState<OutreachConsentMethod | ''>('')
  // Under 18, only a parent or guardian can agree (as Outreach and the database check), so that is the only choice.
  const [minorAge, setMinorAge] = useState(false)
  const [notesLength, setNotesLength] = useState(0)
  const focus = useFocusById()
  const groupNotesLimit = healthChecksServed ? OUTREACH_NOTES_LIMIT : 280
  const notesLimit = group ? groupNotesLimit : 2000

  function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send(event.currentTarget)
  }

  /**
   * "Save without the campaign": the same person, everything typed kept, with the campaign set to none. The case is
   * then a different one (its body changes), so it is sent as a new command with its own key.
   */
  function saveWithoutCampaign() {
    const element = formRef.current
    if (busy || !element) return
    const select = element.elements.namedItem('campaignId')
    if (select instanceof HTMLSelectElement) select.value = ''
    // The message and its button go as the case is sent: focus waits on Save, which says it is saving.
    focus(SAVE_ID)
    void send(element)
  }

  async function send(element: HTMLFormElement) {
    if (busy) return
    const form = new FormData(element)
    const campaignId = String(form.get('campaignId') ?? '') || undefined
    const fullName = String(form.get('fullName') ?? '').trim()
    const sex = String(form.get('sex') ?? 'unknown')
    const age = String(form.get('ageYears') ?? '').trim()
    const ageYears = Number(age)
    const phone = String(form.get('phone') ?? '').trim() || undefined
    const area = healthChecksServed ? String(form.get('area') ?? '').trim().replace(/\s+/g, ' ') || undefined : undefined
    const operationalNotes = String(form.get('operationalNotes') ?? '').trim() || undefined
    const guardianName = String(form.get('guardianName') ?? '').trim().replace(/\s+/g, ' ') || undefined
    // The last answer no longer applies.
    setError('')
    setRefusedBy(null)
    // The form checks its own fields as Outreach does (CreateRegistrationCaseDto): a phone number as Outreach reads it
    // (normalizeOutreachPhone), and operational notes at 3 characters or more, or none, as sent: trimmed, which a native
    // minLength does not check. A number Outreach would refuse is caught here, before it is sent or kept on this device.
    const errors: Partial<Record<CaseField, string>> = {}
    if (!fullName) errors.name = COMPLETE_FIELD
    if (!age) errors.age = COMPLETE_FIELD
    else if (!Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) errors.age = AGE_RANGE
    if (phone !== undefined && !outreachPhoneAccepted(phone)) errors.phone = PHONE_FORMAT
    if (area !== undefined && area.length > AREA_LIMIT) errors.area = `Keep the area to ${AREA_LIMIT} characters.`
    if (operationalNotes !== undefined && operationalNotes.length < 3) errors.notes = AT_LEAST_THREE
    if (group) {
      // At an outreach group, as Outreach and the database check: how the person agreed, a guardian for anyone under 18
      // (or when a guardian agreed), a campaign, and notes of OUTREACH_NOTES_LIMIT (1000) characters at most.
      const minor = isMinorAge(age)
      if (!method) errors.method = 'Choose how the person agreed.'
      else if (minor && method !== 'guardian') errors.method = UNDER_18_METHOD
      if (!guardianName && (minor || method === 'guardian')) errors.guardian = minor
        ? 'This person is under 18. Enter the name of the parent or guardian who agreed.'
        : 'Enter the name of the parent or guardian who agreed.'
      else if (guardianName && guardianName.length < 2) errors.guardian = 'Enter at least 2 characters.'
      else if (guardianName && guardianName.length > GUARDIAN_NAME_LIMIT) errors.guardian = `Keep the name to ${GUARDIAN_NAME_LIMIT} characters.`
      if (!campaignId) errors.campaign = campaigns.length ? 'Choose the campaign this person is being registered in.'
        : campaignsUnread ? GROUP_CAMPAIGNS_UNREAD[campaignsUnread] : 'You can register people only in a running registration campaign you belong to.'
      if (operationalNotes !== undefined && operationalNotes.length > groupNotesLimit) {
        errors.notes = `Keep notes to ${groupNotesLimit} characters. Record health check results in Health checks, not in the notes.`
      }
    }
    const first = FIELD_ORDER.find(field => errors[field])
    if (first) {
      const here = document.activeElement?.id === FIELD_ID[first]
      setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
      if (!here) focus(FIELD_ID[first])
      return
    }
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    const input: OutreachCaseInput = { campaignId, fullName, sex, ageYears, phone, ...(area ? { area } : {}), operationalNotes,
      ...(group && method ? { consent: { textVersion: REGISTRATION_NOTICE_VERSION, language, method, ...(guardianName ? { guardianName } : {}) } } : {}) }
    const signature = JSON.stringify([facilityId, input])
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, command: { localCommandId: crypto.randomUUID(), temporaryPatientId: `tmp_${crypto.randomUUID()}` } }
    }
    const { command } = attempt.current
    onSending()
    setBusy(true)
    // "No signal" mode (OfflineOutreach.tsx): kept on this device with its command, and no request is made. It is sent
    // with the same command once the session is confirmed again, so it is registered once.
    if (group && offline) {
      try {
        await group.queue({ ...command, input })
        attempt.current = null
        element.reset()
        resetConsent()
        group.onQueued({ fullName, localCommandId: command.localCommandId, reason: 'connection' })
      } catch {
        setError(KEEP_FAILED)
      } finally {
        setBusy(false)
      }
      return
    }
    // At an outreach group, the registration is kept on this device before it is sent, so a reload or a closed tab while
    // it is saving loses nothing: it is under "Saved on this device" and sent again with the same command (registered
    // once). Claimed first, so no other sender in this tab, or another tab, sends it at the same time.
    const release = group ? await group.claim(command.localCommandId) : null
    let kept = false
    if (group && release) {
      try { await group.queue({ ...command, input }); kept = true } catch { /* the device could not keep it: sent all the same */ }
    }
    try {
      const created = await staffApi.createOutreachCase(facilityId, input, command)
      // Taken by Health ID (or the registration it already made for this command): off this device before it is listed.
      if (kept) await group?.dequeue(command.localCommandId).catch(() => undefined)
      attempt.current = null
      element.reset()
      resetConsent()
      release?.()
      onCreated(created)
    } catch (caught) {
      release?.()
      // Not reached Health ID, or it could not take it just now, or never judged (the session ended, or the page stopped
      // the send): kept on this device with its command, and sent again when it can be. The same command is sent, so it
      // is registered once.
      const session = kept && (waitsForSignIn(caught) || isStoppedRequest(caught))
      if (group && (waitsForNetwork(caught) || session)) {
        try {
          if (!kept) await group.queue({ ...command, input })
          attempt.current = null
          element.reset()
          resetConsent()
          group.onQueued({ fullName, localCommandId: command.localCommandId, reason: session ? 'session' : waitReason(caught) })
          return
        } catch { /* the device could not keep it: said as the refusal below */ }
      }
      // Health ID's answer (a refusal to correct here, with everything typed still on the form): not left waiting on the
      // device, where it would be sent again as it is.
      if (kept) await group?.dequeue(command.localCommandId).catch(() => undefined)
      if (!group && campaignId && campaignRefused(caught)) {
        // Said in plain words with the one way on, and focus on it: no retry with the same button helps here. Not at an
        // outreach group, whose registrations always need their campaign.
        setRefusedBy({ name: campaigns.find(campaign => campaign.id === campaignId)?.name })
        focus(CAMPAIGN_REFUSED_ID)
      } else {
        setError(group ? outreachProblemText(caught, CREATE_FAILED) : errorText(caught, CREATE_FAILED))
      }
    } finally {
      setBusy(false)
    }
  }

  function resetConsent() {
    setLanguage('en')
    setMethod('')
    setMinorAge(false)
    setNotesLength(0)
  }

  const fieldError = (field: CaseField) => problems.errors[field]
  const field = (key: CaseField) => ({ error: fieldError(key), alert: problems.alert === key, seq: problems.seq })

  // Unavailable while the case is sent, so its answer (a refusal to correct, or the case made) is not lost.
  const back = () => { if (!busy) onBack() }
  return (
    <FormPage title="New registration"
      description={group ? 'Register someone you meet at your event, once they agree. They can link their own Health ID to it later.'
        : 'Register someone you meet in the field. They get a temporary record now, and you link it to their Health ID later.'}
      actions={<Button variant="ghost" icon={ArrowLeft} className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Back to list</Button>}>
      <form ref={formRef} className="flex flex-col gap-4" noValidate onSubmit={createCase}>
        <p className="m-0 text-caption text-ink-3">Fields marked * are required.</p>
        {group ? <ConsentStep group={group.name} language={language} method={method} minor={minorAge} onLanguage={setLanguage} onMethod={setMethod}
          methodError={fieldError('method')} methodAlert={problems.alert === 'method'} guardian={field('guardian')} /> : null}
        <Step n={group ? 2 : 1} title="Who they are" hint={group ? 'As they say it.' : 'As they say it. You can correct it when you link their Health ID.'}>
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
              <EhrInput name="ageYears" type="number" inputMode="numeric" min="0" max="130" required {...controlProps(FIELD_ID.age, fieldError('age'), true)}
                onChange={group ? event => {
                  const minor = isMinorAge(event.target.value.trim())
                  setMinorAge(minor)
                  if (minor) setMethod('guardian')
                } : undefined} />
            </OutreachField>
          </div>
        </Step>
        <Step n={group ? 3 : 2} title="How to reach them" hint="Optional. Used to follow up.">
          <OutreachField id={FIELD_ID.phone} label="Phone number (optional)" hint={PHONE_HINT} {...field('phone')}>
            <EhrInput name="phone" type="tel" inputMode="tel" minLength={3} maxLength={32} autoComplete="off" {...controlProps(FIELD_ID.phone, fieldError('phone'), true)} />
          </OutreachField>
          {healthChecksServed ? (
            <OutreachField id={FIELD_ID.area} label="Area, town or LGA (optional)" hint="Where they live, so the team can follow up nearby." {...field('area')}>
              <EhrInput name="area" maxLength={AREA_LIMIT} autoComplete="off" {...controlProps(FIELD_ID.area, fieldError('area'), true)} />
            </OutreachField>
          ) : null}
        </Step>
        <Step n={group ? 4 : 3} title="Campaign and notes">
          {group ? (
            <OutreachField id={FIELD_ID.campaign} label="Campaign" required {...field('campaign')}
              hint={campaigns.length ? 'Only running registration campaigns you belong to are listed.'
                : campaignsUnread ? GROUP_CAMPAIGNS_UNREAD[campaignsUnread] : 'You aren’t in a running registration campaign yet. Ask your organiser.'}>
              <EhrSelect name="campaignId" required {...controlProps(FIELD_ID.campaign, fieldError('campaign'), true)}>
                {campaigns.length !== 1 ? <option value="">Choose a campaign</option> : null}
                {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
              </EhrSelect>
            </OutreachField>
          ) : showCampaign && (
            <OutreachField id={CAMPAIGN_FIELD} label="Campaign (optional)"
              hint={campaigns.length ? 'Only active registration campaigns you belong to are listed.'
                : campaignsUnread === 'loading' ? 'Campaigns are still loading. You can save without one.'
                  : campaignsUnread ? 'Campaigns couldn’t be loaded. You can save without one.' : 'You aren’t in an active registration campaign. You can save without one.'}>
              <EhrSelect name="campaignId" {...controlProps(CAMPAIGN_FIELD, undefined, true)}>
                <option value="">No campaign</option>
                {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
              </EhrSelect>
            </OutreachField>
          )}
          <OutreachField id={FIELD_ID.notes} label="Notes for the team (optional)" {...field('notes')}
            hint={group ? `Where you met them, what they need next. Health check results go in Health checks after you save, not here. ${notesLength} of ${groupNotesLimit} characters.`
              : 'Where you met them, what they need next. Not a clinical note.'}>
            <EhrTextarea name="operationalNotes" rows={3} minLength={3} maxLength={notesLimit} {...controlProps(FIELD_ID.notes, fieldError('notes'), true)}
              onChange={group ? event => setNotesLength(event.target.value.length) : undefined} />
          </OutreachField>
        </Step>
        {refusedBy ? (
          <div id={CAMPAIGN_REFUSED_ID} tabIndex={-1} role="group" aria-labelledby={`${CAMPAIGN_REFUSED_ID}-text`} className="hid-ehr-dept-outreach-error hid-ehr-dept-outreach-refused">
            <p id={`${CAMPAIGN_REFUSED_ID}-text`} className="hid-ehr-dept-outreach-refused-text">{campaignRefusedText(refusedBy.name)}</p>
            <Button variant="primary" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}
              onClick={saveWithoutCampaign}>{busy ? 'Saving…' : 'Save without the campaign'}</Button>
          </div>
        ) : null}
        <ErrorBox message={error} />
        {error ? <small className="hid-ehr-dept-outreach-note">{RETRY_NOTE}</small> : null}
        <FormActions>
          <Button className="hid-ehr-dept-outreach-unavailable" aria-disabled={busy || undefined} onClick={back}>Cancel</Button>
          <Button id={SAVE_ID} type="submit" variant="primary" size="lg" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Save registration'}</Button>
        </FormActions>
      </form>
    </FormPage>
  )
}

/**
 * The person's agreement, before anything about them is written down (open sign-up on outreach.): that the group is an
 * unverified organiser, and the notice, read to them or read by them, in the language chosen (any but English means it
 * was read aloud in that language), how they agreed, and the name of the parent or guardian who agreed for anyone under
 * 18.
 */
function ConsentStep({ group, language, method, minor, onLanguage, onMethod, methodError, methodAlert, guardian }: {
  readonly group: string
  readonly language: OutreachConsentLanguage
  readonly method: OutreachConsentMethod | ''
  /** The age entered is under 18: only a parent or guardian can agree. */
  readonly minor: boolean
  readonly onLanguage: (language: OutreachConsentLanguage) => void
  readonly onMethod: (method: OutreachConsentMethod) => void
  readonly methodError: string | undefined
  readonly methodAlert: boolean
  readonly guardian: { error: string | undefined; alert: boolean; seq: number }
}) {
  return (
    <Step n={1} title="Their agreement" hint="Before you write anything down, give them this notice and ask if they agree.">
      <div className="rounded-xl bg-subtle p-4 text-body text-ink" aria-label="Registration notice" role="note">
        {/* Health ID never verifies an outreach group (owner decision Q38), and the person is told so before agreeing. */}
        <p className="m-0 mb-2"><strong>Unverified organiser.</strong> Health ID has not checked who runs {group.trim() || 'this outreach group'}.</p>
        {registrationNotice(group).map(line => <p key={line} className="m-0 mb-2 last:mb-0">{line}</p>)}
      </div>
      <OutreachField id="outreach-consent-language" label="Language the notice was given in" required
        hint={language === 'en' ? 'Choose another language if you read it aloud in that language.' : 'You read the notice aloud in this language.'}>
        <EhrSelect name="consentLanguage" value={language} onChange={event => onLanguage(event.target.value as OutreachConsentLanguage)}
          {...controlProps('outreach-consent-language', undefined, true)}>
          {CONSENT_LANGUAGES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </EhrSelect>
      </OutreachField>
      <fieldset className="hid-ehr-field m-0 border-0 p-0" aria-describedby={methodError ? 'outreach-consent-method-error' : undefined}
        aria-invalid={methodError ? true : undefined}>
        <legend className="hid-ehr-label">How they agreed<span aria-hidden="true"> *</span></legend>
        {CONSENT_METHODS.map(option => {
          const closed = minor && option.value !== 'guardian'
          return <label key={option.value} className="flex items-start gap-2 py-1" htmlFor={`outreach-consent-method-${option.value}`}>
            <input id={`outreach-consent-method-${option.value}`} type="radio" name="consentMethod" value={option.value} disabled={closed}
              checked={method === option.value} onChange={() => onMethod(option.value)} />
            <span>{option.label}<span className="block text-caption text-ink-3">{closed ? 'Not for anyone under 18.' : option.hint}</span></span>
          </label>
        })}
        {methodError ? <p id="outreach-consent-method-error" className="hid-ehr-error">{methodAlert ? <span role="alert">{methodError}</span> : methodError}</p> : null}
      </fieldset>
      <OutreachField id="outreach-consent-guardian" label="Parent or guardian’s name" hint="Required for anyone under 18." {...guardian}>
        <EhrInput name="guardianName" maxLength={GUARDIAN_NAME_LIMIT} autoComplete="off" {...controlProps('outreach-consent-guardian', guardian.error, true)} />
      </OutreachField>
      <p className="m-0 text-caption text-ink-3">If they say no, don’t register them.</p>
    </Step>
  )
}
