import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, CloudOff, MessageSquare, Printer, Search, UserPlus } from 'lucide-react'
import { Segmented } from '../../../../kasuwa/interactive'
import { FormActions } from '../../../../kasuwa/parts'
import { Alert, Button, Input, Select } from '../../../../kasuwa/ui'
import { useFocusById } from '../../../../staff/focus'
import type { OutreachCaseInput, OutreachConsentLanguage } from '../../../../staff/api'
import { CONSENT_LANGUAGES } from '../../../../outreachTerms'
import { outreachProblemText } from '../../../../outreachProblems'
import { errorText } from '../../parts/errors'
import { campaignFlowErrorText, isNotOffered, newLocalCommandId, outreachCampaignApi } from '../campaignApi'
import type { ConsentCodeSent, OutreachPlan, OutreachVisit, ParticipantMatch, ScreeningConsentInput } from '../campaignTypes'
import { waitsForNetwork } from '../offlineQueue'
import { CREATE_FAILED, healthIdFrom } from '../outreachParts'
import { caseVisit, DayScope, hivConsentKey, useCampaignDay, useDraft, type DayVisit } from './dayContext'
import { PlanState } from './DayStart'
import {
  ageFromBirthDate, ageWords, BIG_INPUT, BigChoice, DayField, dayControl, Panel, PrintSlip, sexWords, VisitCodeText,
} from './dayParts'

/*
 * Registering one person in under a minute (owner, 13 November 2026): search by phone or Health ID first, so someone
 * already known keeps their one record; then name, sex, age and phone; then their agreement, read to them; then Register,
 * which gives the visit code at once (or, offline at an outreach group, keeps the registration on this phone: no code
 * is made up). Registration is today's served POST, unchanged; the same command is sent again after a lost answer, so a
 * person is registered once.
 */

/** A parent or guardian's name, as Outreach and the database take it: 2 to 120 characters. */
const GUARDIAN_NAME_LIMIT = 120
const NOTES_LIMIT = 280

export interface RegisterForm {
  readonly fullName: string
  readonly sex: 'female' | 'male' | 'other' | 'unknown' | null
  readonly ageMode: 'age' | 'dob'
  readonly age: string
  readonly birthDate: string
  readonly phone: string
  readonly community: string | null
  readonly language: OutreachConsentLanguage
  readonly guardianName: string
  readonly hivAgreed: boolean
  /** The person the search found and they said was them: their Health ID record is used. */
  readonly match: ParticipantMatch | null
}

const EMPTY: RegisterForm = { fullName: '', sex: null, ageMode: 'age', age: '', birthDate: '', phone: '', community: null, language: 'en',
  guardianName: '', hivAgreed: false, match: null }

type Field = 'fullName' | 'sex' | 'age' | 'phone' | 'guardianName'
const IDS: Record<Field | 'search' | 'code', string> = {
  search: 'outreach-register-search', fullName: 'outreach-register-name', sex: 'outreach-register-sex', age: 'outreach-register-age',
  phone: 'outreach-register-phone', guardianName: 'outreach-register-guardian', code: 'outreach-register-code',
}

/** What a registration came to: a visit Outreach made, or one kept on this phone until it can be sent. */
export type Registered =
  | { readonly kind: 'visit'; readonly visit: OutreachVisit; readonly already: boolean; readonly consentByCode: boolean }
  | { readonly kind: 'queued'; readonly dayVisit: DayVisit }

type Stage =
  | { readonly step: 'search'; readonly note?: string }
  | { readonly step: 'matches'; readonly matches: readonly ParticipantMatch[]; readonly byPhone: string | null }
  | { readonly step: 'details' }
  | { readonly step: 'consent' }
  | { readonly step: 'code'; readonly visit: OutreachVisit; readonly sent: ConsentCodeSent }
  | { readonly step: 'done'; readonly registered: Registered; readonly note?: string }

/**
 * Registration at the registration station: search, details, agreement, Register, and the visit code. `onDone` hears each
 * visit made (or found already registered) as its code is shown; the screen stays on the code until "Next person".
 */
export function RegisterPerson({ campaignId, onDone }: { readonly campaignId: string; readonly onDone: (visit: OutreachVisit) => void }) {
  return <DayScope campaignId={campaignId}><RegisterFlow onDone={onDone} /></DayScope>
}

export function RegisterFlow({ onDone, onRegistered, embedded = false, resetKey = 0 }: {
  readonly onDone?: (visit: OutreachVisit) => void
  /** Every registration, kept on this phone or made: AllInOne goes on with the person. */
  readonly onRegistered?: (visit: DayVisit, registered: Registered) => void
  /** Inside AllInOne: no "Next person" here (AllInOne has it at the end). */
  readonly embedded?: boolean
  /** Changing it starts again with the next person. */
  readonly resetKey?: number
}) {
  const day = useCampaignDay()
  return (
    <section aria-labelledby="outreach-register-heading" className="flex flex-col gap-4">
      <PlanState plan={day.plan} onRetry={day.refreshPlan}>
        {plan => <RegisterSteps key={resetKey} plan={plan} embedded={embedded} onDone={onDone} onRegistered={onRegistered} />}
      </PlanState>
    </section>
  )
}

function RegisterSteps({ plan, embedded, onDone, onRegistered }: {
  readonly plan: OutreachPlan
  readonly embedded: boolean
  readonly onDone?: (visit: OutreachVisit) => void
  readonly onRegistered?: (visit: DayVisit, registered: Registered) => void
}) {
  const day = useCampaignDay()
  const { facilityId, campaignId, settings, online, group, queue, remember } = day
  const focus = useFocusById()
  const [stage, setStage] = useState<Stage>({ step: 'search' })
  const [form, setForm] = useDraft<RegisterForm>('register|new', () => EMPTY)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // The command of the registration last sent: the same person sent again (a lost answer) is the same command.
  const attempt = useRef<{ signature: string; command: { localCommandId: string; temporaryPatientId: string } } | null>(null)

  const site = plan.sites.find(item => item.id === settings?.siteId) ?? (plan.sites.length === 1 ? plan.sites[0] : undefined)
  const community = form.community ?? site?.community ?? ''
  const hiv = plan.focuses.includes('hiv') || plan.package.tests.some(test => test.separateConsent)
  const ageYears = form.ageMode === 'age' ? (form.age.trim() === '' ? null : Number(form.age)) : ageFromBirthDate(form.birthDate)
  const minor = ageYears !== null && Number.isInteger(ageYears) && ageYears >= 0 && ageYears < 18
  const languages = CONSENT_LANGUAGES.filter(option => option.value === 'en' || (plan.consent.languages ?? []).includes(option.value))
  const update = (change: Partial<RegisterForm>) => setForm(previous => ({ ...previous, ...change }))

  // Focus goes where the work continues as each step shows: the first field, or the code.
  const shown = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (shown.current === stage.step) return
    const first = shown.current === null
    shown.current = stage.step
    const target = stage.step === 'search' ? IDS.search : stage.step === 'details' ? IDS.fullName : stage.step === 'code' ? IDS.code
      : `outreach-register-${stage.step}-heading`
    // On first showing inside AllInOne, focus stays where the person is.
    if (first && embedded) return
    focus(target)
  }, [stage.step, embedded, focus])

  function nextPerson() {
    attempt.current = null
    setForm(EMPTY)
    setErrors({})
    setError('')
    setStage({ step: 'search' })
  }

  // ------------------------------------------------------------------------------------------------- 1. search --
  const [searchMode, setSearchMode] = useState<'phone' | 'healthId'>('phone')
  const [searchText, setSearchText] = useState('')
  const [searchError, setSearchError] = useState('')
  async function search(event?: FormEvent) {
    event?.preventDefault()
    if (busy) return
    const typed = searchText.trim()
    const digits = typed.replace(/\D/g, '')
    const healthId = searchMode === 'healthId' ? healthIdFrom(typed) : ''
    if (searchMode === 'phone' && (digits.length < 10 || digits.length > 14)) { setSearchError('Enter their phone number, like 08012345678.'); focus(IDS.search); return }
    if (searchMode === 'healthId' && !healthId) { setSearchError('Enter the Health ID as written on their card. It starts with HID-.'); focus(IDS.search); return }
    setSearchError('')
    const byPhone = searchMode === 'phone' ? typed : null
    if (!online) {
      update({ phone: byPhone ?? form.phone })
      setStage({ step: 'details' })
      return
    }
    setBusy(true)
    try {
      const { matches } = await outreachCampaignApi.searchParticipants(facilityId, campaignId, byPhone ? { phone: byPhone } : { healthId })
      if (matches.length) setStage({ step: 'matches', matches, byPhone })
      else {
        update({ phone: byPhone ?? form.phone, match: null })
        setStage({ step: 'details' })
      }
    } catch (caught) {
      if (isNotOffered(caught) || waitsForNetwork(caught)) {
        // Searching isn't possible here: register them as new; a phone number already known is matched by Health ID.
        update({ phone: byPhone ?? form.phone, match: null })
        setStage({ step: 'details' })
      } else {
        setSearchError(campaignFlowErrorText(caught, 'The search didn’t work. Try again, or register them as new.'))
        focus(IDS.search)
      }
    } finally {
      setBusy(false)
    }
  }

  async function itsThem(match: ParticipantMatch, byPhone: string | null) {
    if (busy) return
    if (match.inThisCampaign && match.caseId) {
      // Already registered in this campaign: never twice. Their visit goes on.
      setBusy(true)
      try {
        const visit = await outreachCampaignApi.visit(facilityId, match.caseId)
        finish({ kind: 'visit', visit, already: true, consentByCode: false })
      } catch (caught) {
        setError(campaignFlowErrorText(caught, 'Their visit could not be opened. Find them by their visit code at the station.'))
      } finally {
        setBusy(false)
      }
      return
    }
    const sex = match.sex === 'female' || match.sex === 'male' ? match.sex : null
    update({ match, sex: form.sex ?? sex, age: form.age || (match.ageYears != null ? String(match.ageYears) : ''), ageMode: 'age', phone: byPhone ?? form.phone })
    setStage({ step: 'details' })
  }

  // ------------------------------------------------------------------------------------------------ 2. details --
  function checkDetails(): boolean {
    const found: Partial<Record<Field, string>> = {}
    const name = form.fullName.trim()
    if (!name) found.fullName = 'Enter their full name.'
    else if (name.length > 200) found.fullName = 'Keep the name to 200 characters.'
    if (!form.sex) found.sex = 'Choose their sex.'
    if (form.ageMode === 'age') {
      if (form.age.trim() === '') found.age = 'Enter their age. A best guess is fine.'
      else if (ageYears === null || !Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) found.age = 'Enter an age in whole years, from 0 to 130.'
    } else if (ageYears === null) found.age = 'Enter a date of birth that has passed.'
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (form.phone.trim() && (phoneDigits.length < 10 || phoneDigits.length > 14)) found.phone = 'Enter a phone number like 08012345678, or leave it empty.'
    setErrors(found)
    const first = (['fullName', 'sex', 'age', 'phone'] as const).find(field => found[field])
    if (first) { focus(IDS[first]); return false }
    return true
  }

  // ------------------------------------------------------------------------------------------ 3. agreement, send --
  async function register(how: 'loud' | 'code') {
    if (busy) return
    const guardianName = form.guardianName.trim().replace(/\s+/g, ' ')
    if (minor && (guardianName.length < 2 || guardianName.length > GUARDIAN_NAME_LIMIT)) {
      setErrors({ guardianName: guardianName.length > GUARDIAN_NAME_LIMIT ? `Keep the name to ${GUARDIAN_NAME_LIMIT} characters.`
        : 'This person is under 18. Enter the name of the parent or guardian who agreed.' })
      focus(IDS.guardianName)
      return
    }
    setErrors({})
    setError('')
    const phone = form.phone.trim() || undefined
    const where = community.trim() ? `Community: ${community.trim()}`.slice(0, NOTES_LIMIT) : undefined
    const input: OutreachCaseInput = {
      campaignId, fullName: form.fullName.trim(), sex: form.sex ?? 'unknown', ageYears: ageYears ?? 0, phone, operationalNotes: where,
      // Read to them out loud in the language chosen: they agreed, or (under 18) their parent or guardian did. A code
      // read back from their phone is recorded on top of it, once the registration exists.
      consent: { textVersion: plan.consent.version, language: form.language, method: minor ? 'guardian' : 'verbal_read_aloud', ...(minor ? { guardianName } : {}) },
    }
    const signature = JSON.stringify([facilityId, input])
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, command: { localCommandId: newLocalCommandId(), temporaryPatientId: `tmp_${crypto.randomUUID()}` } }
    }
    const { command } = attempt.current
    setBusy(true)
    try {
      const visit = await outreachCampaignApi.createVisit(facilityId, input, command)
      attempt.current = null
      if (how === 'code' && phone) {
        try {
          const sent = await outreachCampaignApi.sendConsentCode(facilityId, visit.id, { purpose: 'registration', language: form.language,
            version: plan.consent.version, ...(minor ? { guardianName } : {}) }, newLocalCommandId())
          announce(visit)
          setStage({ step: 'code', visit, sent })
          return
        } catch (caught) {
          finish({ kind: 'visit', visit, already: false, consentByCode: false },
            `${campaignFlowErrorText(caught, 'The code couldn’t be sent.')} They agreed out loud, so the registration stands.`)
          return
        }
      }
      finish({ kind: 'visit', visit, already: false, consentByCode: false })
    } catch (caught) {
      if (group && waitsForNetwork(caught)) {
        try {
          // Kept on this phone with its command and sent when the network is back: no code until then, none made up.
          await queue.add({ ...command, input })
          attempt.current = null
          const dayVisit: DayVisit = { kind: 'queued', key: `queued-${command.localCommandId}`, registrationCommandId: command.localCommandId,
            temporaryPatientId: command.temporaryPatientId, person: { fullName: input.fullName, sex: input.sex, ageYears: input.ageYears, phone: phone ?? null } }
          finish({ kind: 'queued', dayVisit })
          return
        } catch { /* the device could not keep it: said below */ }
      }
      setError(group ? outreachProblemText(caught, CREATE_FAILED) : errorText(caught, CREATE_FAILED))
    } finally {
      setBusy(false)
    }
  }

  const announced = useRef<string | null>(null)
  function announce(visit: OutreachVisit) {
    if (announced.current === visit.id) return
    announced.current = visit.id
    remember('register', caseVisit(visit))
    onDone?.(visit)
    onRegistered?.(caseVisit(visit), { kind: 'visit', visit, already: false, consentByCode: false })
  }

  function finish(registered: Registered, note?: string) {
    const key = registered.kind === 'visit' ? caseVisit(registered.visit).key : registered.dayVisit.key
    if (hiv && form.hivAgreed) {
      // The separate HIV agreement, witnessed by this team member: the HIV test on this phone sends it with the result.
      const guardianName = form.guardianName.trim().replace(/\s+/g, ' ')
      const consent: ScreeningConsentInput = { method: 'witnessed', witnessName: day.staffName, language: form.language,
        version: plan.consent.hivVersion ?? plan.consent.version, ...(minor && guardianName ? { guardianName } : {}) }
      day.drafts.set(hivConsentKey(key), consent)
    }
    if (registered.kind === 'visit') announce(registered.visit)
    else {
      remember('register', registered.dayVisit)
      onRegistered?.(registered.dayVisit, registered)
    }
    setForm(EMPTY)
    setStage({ step: 'done', registered, note })
  }

  // --------------------------------------------------------------------------------------------- 4. the code --
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  async function verify(visit: OutreachVisit, sent: ConsentCodeSent, typed = code) {
    if (busy) return
    if (!/^\d{6}$/.test(typed)) { setCodeError('Enter the 6 numbers from their text message.'); focus(IDS.code); return }
    setBusy(true)
    setCodeError('')
    try {
      await outreachCampaignApi.verifyConsentCode(facilityId, visit.id, { challengeId: sent.challengeId, code: typed }, newLocalCommandId())
      setCode('')
      finish({ kind: 'visit', visit, already: false, consentByCode: true })
    } catch (caught) {
      setCodeError(campaignFlowErrorText(caught, 'The code could not be checked. Try again.'))
      focus(IDS.code)
    } finally {
      setBusy(false)
    }
  }
  async function resend(visit: OutreachVisit) {
    if (busy) return
    setBusy(true)
    setCodeError('')
    try {
      const sent = await outreachCampaignApi.sendConsentCode(facilityId, visit.id, { purpose: 'registration', language: form.language,
        version: plan.consent.version }, newLocalCommandId())
      setStage({ step: 'code', visit, sent })
    } catch (caught) {
      setCodeError(campaignFlowErrorText(caught, 'A new code could not be sent. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------------------------------------------- views --
  if (stage.step === 'search') {
    return (
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 id="outreach-register-heading" className="m-0 text-title-2 text-ink">Register a person</h2>
        {stage.note ? <Alert intent="info" size="sm">{stage.note}</Alert> : null}
        <form className="flex flex-col gap-3" noValidate onSubmit={event => void search(event)} aria-label="Find them first">
          <Segmented ariaLabel="Search by" value={searchMode} onChange={mode => { setSearchMode(mode); setSearchError('') }}
            options={[{ value: 'phone', label: 'Phone number' }, { value: 'healthId', label: 'Health ID' }]} />
          <DayField id={IDS.search} label="Phone number or Health ID" error={searchError}
            hint={searchMode === 'phone' ? 'Someone already on Health ID keeps their own record.' : 'On their card or in their Health ID app. It starts with HID-.'}>
            <Input {...dayControl(IDS.search, searchError || undefined, true)} className={BIG_INPUT} value={searchText} autoComplete="off" spellCheck={false}
              type={searchMode === 'phone' ? 'tel' : 'text'} inputMode={searchMode === 'phone' ? 'numeric' : 'text'}
              autoCapitalize={searchMode === 'phone' ? 'off' : 'characters'} maxLength={40}
              onChange={event => setSearchText(event.target.value)} />
          </DayField>
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button type="submit" variant="primary" size="lg" icon={Search} aria-disabled={busy || undefined}>{busy ? 'Searching…' : 'Search'}</Button>
            <Button size="lg" icon={UserPlus} onClick={() => { update({ match: null, phone: searchMode === 'phone' ? searchText.trim() : form.phone }); setStage({ step: 'details' }) }}>
              New person, no search
            </Button>
          </div>
        </form>
      </Panel>
    )
  }

  if (stage.step === 'matches') {
    return (
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 id="outreach-register-matches-heading" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Is this them?</h2>
        <p className="m-0 text-[15px] text-ink-2">Ask them their age, and check the last numbers of their phone.</p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="People found">
          {stage.matches.map(match => (
            <li key={match.matchId} className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-line">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[18px] font-semibold text-brand-ink">{match.initials}</span>
                <div className="min-w-0">
                  <p className="m-0 text-title-3 text-ink"><span className="sr-only">Initials </span>{match.initials}</p>
                  <p className="m-0 text-[14px] text-ink-2">{ageWords(match.ageYears)} · {sexWords(match.sex)}{match.maskedPhone ? ` · phone ${match.maskedPhone}` : ''}</p>
                  {match.inThisCampaign ? <p className="m-0 text-[14px] font-medium text-brand-ink">Already registered here{match.visitCode ? `: visit code ${match.visitCode}` : ''}</p> : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" onClick={() => { update({ match: null, phone: stage.byPhone ?? form.phone }); setStage({ step: 'details' }) }}>Someone else</Button>
                <Button size="lg" variant="primary" aria-disabled={busy || undefined} onClick={() => void itsThem(match, stage.byPhone)}>Yes, that’s them</Button>
              </div>
            </li>
          ))}
        </ul>
        {error ? <Alert intent="error">{error}</Alert> : null}
        <Button variant="link" className="self-start" onClick={() => setStage({ step: 'search' })}>Search again</Button>
      </Panel>
    )
  }

  if (stage.step === 'details') {
    return (
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 id="outreach-register-details-heading" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{form.match ? 'Their details' : 'New person'}</h2>
        {form.match ? <Alert intent="info" size="sm">Their own Health ID record is used. Check their name and age with them.</Alert> : null}
        <form className="flex flex-col gap-4" noValidate aria-label="Their details"
          onSubmit={event => { event.preventDefault(); if (checkDetails()) setStage({ step: 'consent' }) }}>
          <DayField id={IDS.fullName} label="Full name" error={errors.fullName}>
            <Input {...dayControl(IDS.fullName, errors.fullName, false)} className={BIG_INPUT} value={form.fullName} maxLength={200} autoComplete="off"
              autoCapitalize="words" enterKeyHint="next" onChange={event => update({ fullName: event.target.value })}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); focus(IDS.sex) } }} />
          </DayField>
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-[14px] font-medium text-ink" id={`${IDS.sex}-label`}>Sex</p>
            <BigChoice label="Sex" id={IDS.sex} value={form.sex === 'female' || form.sex === 'male' ? form.sex : null} invalid={Boolean(errors.sex)}
              describedBy={errors.sex ? `${IDS.sex}-error` : undefined}
              onChange={sex => { update({ sex }); setErrors(previous => ({ ...previous, sex: undefined })); focus(IDS.age) }}
              options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} />
            {errors.sex ? <p id={`${IDS.sex}-error`} className="m-0 text-[13px] font-medium text-danger-ink">{errors.sex}</p> : null}
            <Button variant="link" className="self-start" aria-pressed={form.sex === 'other' || form.sex === 'unknown'}
              onClick={() => { update({ sex: 'unknown' }); focus(IDS.age) }}>{form.sex === 'unknown' ? 'Not known (chosen)' : 'Not known or other'}</Button>
          </div>
          <div className="flex flex-col gap-2">
            <Segmented ariaLabel="Age or date of birth" value={form.ageMode} onChange={ageMode => update({ ageMode })}
              options={[{ value: 'age', label: 'Age' }, { value: 'dob', label: 'Date of birth' }]} />
            {form.ageMode === 'age' ? (
              <DayField id={IDS.age} label="Age in years" error={errors.age} hint="A best guess is fine. Under 1 year: enter 0.">
                <Input {...dayControl(IDS.age, errors.age, true)} className={BIG_INPUT} value={form.age} inputMode="numeric" pattern="[0-9]*" maxLength={3}
                  enterKeyHint="next" autoComplete="off" onChange={event => update({ age: event.target.value.replace(/\D/g, '') })}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); focus(IDS.phone) } }} />
              </DayField>
            ) : (
              <DayField id={IDS.age} label="Date of birth" error={errors.age} hint={ageYears !== null ? `${ageYears} years old` : undefined}>
                <Input {...dayControl(IDS.age, errors.age, ageYears !== null)} className={BIG_INPUT} type="date" value={form.birthDate}
                  onChange={event => update({ birthDate: event.target.value })} />
              </DayField>
            )}
          </div>
          <DayField id={IDS.phone} label="Phone number" optional error={errors.phone} hint="Their visit code and results can be sent here.">
            <Input {...dayControl(IDS.phone, errors.phone, true)} className={BIG_INPUT} type="tel" inputMode="tel" value={form.phone} maxLength={20}
              autoComplete="off" enterKeyHint="next" onChange={event => update({ phone: event.target.value })} />
          </DayField>
          <DayField id="outreach-register-community" label="Community" optional hint={site ? `Where they live. ${site.name} is in ${site.community || 'this community'}.` : 'Where they live.'}>
            <Input {...dayControl('outreach-register-community', undefined, true)} className={BIG_INPUT} value={community} maxLength={120}
              autoComplete="off" onChange={event => update({ community: event.target.value })} />
          </DayField>
          <FormActions>
            <Button size="lg" onClick={() => setStage({ step: 'search' })}>Back</Button>
            <Button type="submit" variant="primary" size="lg" iconRight={ArrowRight}>Next: their agreement</Button>
          </FormActions>
        </form>
      </Panel>
    )
  }

  if (stage.step === 'consent') {
    const phone = form.phone.trim()
    const codeBlocked = !phone ? 'They gave no phone number.' : !online ? 'Needs a connection.' : null
    return (
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 id="outreach-register-consent-heading" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Read this to {form.fullName.trim() || 'them'}</h2>
        <div role="note" aria-label="What they agree to" className="rounded-xl bg-subtle p-4 text-[16px] leading-relaxed text-ink">
          <p className="m-0">{plan.consent.text}</p>
        </div>
        {languages.length > 1 ? (
          <DayField id="outreach-register-language" label="Language you read it in">
            <Select id="outreach-register-language" value={form.language} onChange={event => update({ language: event.target.value as OutreachConsentLanguage })}>
              {languages.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </DayField>
        ) : null}
        {minor ? (
          <DayField id={IDS.guardianName} label="Parent or guardian’s name" error={errors.guardianName} hint="They are under 18: their parent or guardian agrees for them.">
            <Input {...dayControl(IDS.guardianName, errors.guardianName, true)} className={BIG_INPUT} value={form.guardianName} maxLength={GUARDIAN_NAME_LIMIT}
              autoComplete="off" onChange={event => update({ guardianName: event.target.value })} />
          </DayField>
        ) : null}
        {hiv ? (
          <div className="flex flex-col gap-2 rounded-xl p-4 ring-1 ring-line">
            <p className="m-0 text-[15px] font-medium text-ink">HIV test: a separate agreement</p>
            {plan.consent.hivText ? <p className="m-0 text-[15px] text-ink">{plan.consent.hivText}</p> : null}
            <label className="flex min-h-12 cursor-pointer items-center gap-3 text-[15px] text-ink">
              <input type="checkbox" className="size-6 shrink-0" checked={form.hivAgreed} onChange={event => update({ hivAgreed: event.target.checked })} />
              They also agree to the HIV test
            </label>
          </div>
        ) : null}
        <p className="m-0 text-[14px] text-ink-2">If they say no, don’t register them.</p>
        {error ? <Alert intent="error">{error}</Alert> : null}
        <FormActions>
          <Button size="lg" onClick={() => setStage({ step: 'details' })}>Back</Button>
          <Button size="lg" icon={MessageSquare} aria-disabled={busy || codeBlocked !== null || undefined}
            aria-describedby={codeBlocked ? 'outreach-register-code-blocked' : undefined}
            onClick={() => { if (!codeBlocked) void register('code') }}>Send code to their phone</Button>
          <Button variant="primary" size="lg" aria-disabled={busy || undefined} onClick={() => void register('loud')}>
            {busy ? 'Registering…' : minor ? 'Parent or guardian agreed' : 'They agreed out loud'}
          </Button>
        </FormActions>
        {codeBlocked ? <p id="outreach-register-code-blocked" className="m-0 text-[13px] text-ink-2">Code by text: {codeBlocked}</p> : null}
        <p className="m-0 text-[13px] text-ink-2">Recorded as agreed out loud, with you ({day.staffName}) as witness.</p>
      </Panel>
    )
  }

  if (stage.step === 'code') {
    const { visit, sent } = stage
    return (
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 id="outreach-register-code-heading" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">Enter the code from their phone</h2>
        <p className="m-0 text-[15px] text-ink-2">A 6-number code went by text to {sent.sentTo}. Ask them to read it out.</p>
        <form noValidate className="flex flex-col gap-3" aria-label="Their code" onSubmit={event => { event.preventDefault(); void verify(visit, sent) }}>
          <DayField id={IDS.code} label="Code" error={codeError}>
            <Input {...dayControl(IDS.code, codeError || undefined, false)} className="!h-14 !text-[28px] tracking-[.3em] tabular" value={code}
              inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6}
              onChange={event => {
                const typed = event.target.value.replace(/\D/g, '').slice(0, 6)
                setCode(typed)
                if (typed.length === 6) void verify(visit, sent, typed)
              }} />
          </DayField>
          <FormActions sticky={false}>
            <Button size="lg" aria-disabled={busy || undefined} onClick={() => void resend(visit)}>Send a new code</Button>
            <Button size="lg" onClick={() => finish({ kind: 'visit', visit, already: false, consentByCode: false })}>They agreed out loud instead</Button>
            <Button type="submit" variant="primary" size="lg" aria-disabled={busy || undefined}>{busy ? 'Checking…' : 'Check the code'}</Button>
          </FormActions>
        </form>
      </Panel>
    )
  }

  return <DoneCard registered={stage.registered} note={stage.note} embedded={embedded} language={form.language} onNext={nextPerson} />
}

/** The visit code, huge, with their Health ID, the slip to print or text, and Next person. */
function DoneCard({ registered, note, embedded, language, onNext }: {
  readonly registered: Registered
  readonly note?: string
  readonly embedded: boolean
  readonly language: OutreachConsentLanguage
  readonly onNext: () => void
}) {
  const { facilityId, online, campaignName } = useCampaignDay()
  const [sms, setSms] = useState<{ state: 'idle' | 'sending' | 'sent' | 'failed'; text: string }>({ state: 'idle', text: '' })
  const smsCommand = useRef<string | null>(null)

  if (registered.kind === 'queued') {
    const { person } = registered.dayVisit as Extract<DayVisit, { kind: 'queued' }>
    return (
      <Panel className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 id="outreach-register-done-heading" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{person.fullName}</h2>
        <Alert intent="warning" icon={CloudOff} title="Saved on this phone">The code arrives when you’re back online.</Alert>
        <p className="m-0 text-[15px] text-ink-2">{embedded ? 'Carry on with them here: what you record waits with their registration.'
          : 'Send them on: the next station finds them once this phone has sent the registration.'}</p>
        {!embedded ? <FormActions><Button variant="primary" size="lg" icon={UserPlus} onClick={onNext}>Next person</Button></FormActions> : null}
      </Panel>
    )
  }

  const { visit, already, consentByCode } = registered
  async function text() {
    if (sms.state === 'sending') return
    smsCommand.current ??= newLocalCommandId()
    setSms({ state: 'sending', text: '' })
    try {
      const sent = await outreachCampaignApi.sendSlipSms(facilityId, visit.id, { kind: 'visit_code', language }, smsCommand.current)
      setSms(sent.deliveryOutcome === 'definitive_failure'
        ? { state: 'failed', text: 'The text could not be delivered. Give them the printed slip.' }
        : { state: 'sent', text: `Sent to ${sent.sentTo}.` })
      smsCommand.current = null
    } catch (caught) {
      setSms({ state: 'failed', text: campaignFlowErrorText(caught, 'The text could not be sent. Give them the printed slip.') })
      // Sent again as the same command only when the answer may have been lost: Health ID sends one text, never two.
      if (!waitsForNetwork(caught)) smsCommand.current = null
    }
  }

  return (
    <Panel className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="outreach-register-done-heading" tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{already ? 'Already registered' : 'Registered'}: {visit.fullName}</h2>
        <p className="m-0 text-[14px] text-ink-2">{ageWords(visit.ageYears)} · {sexWords(visit.sex)}{consentByCode ? ' · agreed by code' : ''}</p>
      </div>
      {note ? <Alert intent="warning" size="sm">{note}</Alert> : null}
      {visit.possibleDuplicate && !already ? <Alert intent="info" size="sm">Someone with this phone number is already on Health ID: their record is used.</Alert> : null}
      <div className="flex flex-col items-start gap-1 rounded-xl bg-subtle p-4">
        {visit.visitCode ? <>
          <p className="m-0 text-[14px] font-medium text-ink-2">Visit code</p>
          <VisitCodeText code={visit.visitCode} id="outreach-register-visit-code" />
        </> : <p className="m-0 text-[15px] text-ink">The visit code is not given yet. Find them by name at the next station.</p>}
        {visit.healthId ? <p className="m-0 mt-2 text-[15px] text-ink">Health ID <strong className="tracking-[.04em]">{visit.healthId}</strong></p> : null}
      </div>
      <div className="grid gap-2 @md:grid-cols-2">
        <Button size="lg" icon={Printer} onClick={() => window.print()}>Print slip</Button>
        {visit.phone ? (
          <Button size="lg" icon={MessageSquare} aria-disabled={sms.state === 'sending' || !online || undefined}
            onClick={() => { if (online) void text() }}>{sms.state === 'sending' ? 'Sending…' : sms.state === 'sent' ? 'Text it again' : 'Text it to them'}</Button>
        ) : null}
      </div>
      <div role="status" className="text-[14px] text-ink-2">{sms.text}</div>
      {!embedded ? <FormActions><Button variant="primary" size="lg" icon={UserPlus} onClick={onNext}>Next person</Button></FormActions> : null}
      <PrintSlip fullName={visit.fullName ?? ''} visitCode={visit.visitCode ?? null} healthId={visit.healthId ?? null} campaignName={campaignName} />
    </Panel>
  )
}
