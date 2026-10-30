import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, CircleCheck, Clock, Eye, Lock, Mail, PenLine, Search, Share2, Stethoscope } from 'lucide-react'
import { Button, PageHeader, cx } from '../kasuwa/ui'
import { useToast } from '../kasuwa/toast'
import { ShareEmailPreview, useMyCard } from './SharedCard'
import { useSession } from '../session'
import { describedBy, sentFromField, useDocumentTitle, useStepFocus } from '../authSteps'
import { learnShareServed, useShareServed } from '../shareServed'
import {
  COLLABORATION_WARNING, PERSON_NAME, SHARE_DURATIONS, SHARE_LEVELS, SHARE_ROLE_LABELS, inviteEmailProblem, shareDurationLabel,
  shareDay, shareLevelLabel, shareUntil,
  type ShareCreated, type ShareDuration, type ShareInvitationCreated, type ShareLevel, type ShareProvider,
} from '../shareRecords'

/**
 * Share my records (hid-1.0 parity B4, hid-system 0095 on Novu; contract b45-contract.md §2.7): one page, /access/share,
 * that Overview's "Share Records" and Access and consent's "Share my records" both open. The patient finds a clinician
 * by their name or their facility's, chooses what they can do and for how long, checks, and shares; or invites one by
 * email who is not on Health ID yet. Where the backend does not serve sharing (404, today's backend) the page opens
 * Access and consent instead, without an error. Every step's heading takes focus as the step is shown, and an error
 * moves focus to itself, in the commit that shows it. Each step's root is keyed by the step, so a step change mounts it
 * afresh: a control kept from the step before (Back, at the same place in the level and duration steps) would hold
 * focus, which the heading should take.
 */

/** The words for a refused share or invitation: the backend's own `detail`, or ours for the security checks. */
export function shareProblem(cause: unknown, fallback: string): string {
  if (!isHidApiError(cause)) return fallback
  if (cause.code === 'PATIENT_RECENT_AUTH_REQUIRED') return 'For your security, sign out, sign in again, and share within 10 minutes.'
  if (cause.code === 'PATIENT_RECENT_RECOVERY_HOLD') {
    return 'Sharing is not available in the 24 hours after you recover your account. Please try again later.'
  }
  if (cause.status === 404 && !cause.code?.startsWith('SHARE_')) return 'Sharing is not available right now. Try again later.'
  return cause.message || fallback
}

/**
 * Learns whether sharing is served, once per page life, by its probe (GET identity/me/share-invitations): 200 served, 404
 * not. Any other failure says nothing and is returned for a page that needs the answer to go on.
 */
export function useShareProbe() {
  const { api } = useSession()
  const served = useShareServed()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (served !== null) return
    const controller = new AbortController()
    setError(null)
    api.shareInvitations(controller.signal).then(() => learnShareServed(true), (cause: unknown) => {
      if (controller.signal.aborted) return
      if (isHidApiError(cause) && cause.status === 404) learnShareServed(false)
      else setError(isHidApiError(cause) ? cause.message : 'Sharing could not be opened.')
    })
    return () => controller.abort()
  }, [api, served, attempt])
  return { served, error, retry: useCallback(() => setAttempt(value => value + 1), []) }
}

type Step = 'search' | 'level' | 'duration' | 'confirm' | 'done' | 'invite' | 'invited'
const STEP_NUMBER: Partial<Record<Step, number>> = { search: 1, level: 2, duration: 2, confirm: 3 }
const QUERY_MIN = 3, QUERY_MAX = 80

/** One key per confirm action, kept while what it sends is the same, so sending it again is answered as a replay. */
function useIdempotencyKey() {
  const held = useRef<{ body: string; key: string } | null>(null)
  return useCallback((body: unknown) => {
    const signature = JSON.stringify(body)
    if (held.current?.body !== signature) held.current = { body: signature, key: crypto.randomUUID() }
    return held.current.key
  }, [])
}

export function ShareRecords() {
  useDocumentTitle('Share your records · Health ID')
  const probe = useShareProbe()
  if (probe.served === false) return <Navigate to="/access" replace />
  return <section className="patient-section max-w-2xl">
    <Link to="/access" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 no-underline hover:text-ink"><ChevronLeft className="size-4" aria-hidden />Access & sharing</Link>
    <PageHeader title="Share your records" />
    {probe.served === true ? <ShareFlow />
      : probe.error ? <div className="patient-card" role="alert"><p>{probe.error}</p>
        <button type="button" onClick={probe.retry}>Try again</button></div>
      : <div className="patient-card patient-loading" role="status">Opening sharing…</div>}
  </section>
}

function ShareFlow() {
  const { api } = useSession()
  const myCard = useMyCard()
  const [params] = useSearchParams()
  const [step, setStep] = useState<Step>(() => params.get('by') === 'email' ? 'invite' : 'search')
  const [query, setQuery] = useState('')
  const [queryProblem, setQueryProblem] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<{ query: string; items: ShareProvider[] } | null>(null)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [provider, setProvider] = useState<ShareProvider | null>(null)
  const [level, setLevel] = useState<ShareLevel>('view_only')
  const [duration, setDuration] = useState<ShareDuration>('24h')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ShareCreated | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [emailProblem, setEmailProblem] = useState<string | null>(null)
  const [nameProblem, setNameProblem] = useState<string | null>(null)
  const [invited, setInvited] = useState<(ShareInvitationCreated & { email: string }) | null>(null)
  // A field's problem from a form sent with Enter in a field, where focus stays (sentFromField): then it is an alert, new
  // for each refusal (its key), since a description on the focused field is not read again. Null when focus moves to it.
  const [problemAlert, setProblemAlert] = useState<number | null>(null)
  const stepFocus = useStepFocus()
  const errorFocus = useStepFocus()
  const fieldFocus = useStepFocus()
  const resultsFocus = useStepFocus()
  const shareKey = useIdempotencyKey()
  const inviteKey = useIdempotencyKey()

  // Whether the error shown is the choice's (the search step's second form) rather than the search's.
  const [choosing, setChoosing] = useState(false)
  const go = (next: Step) => { setStep(next); setError(null); stepFocus.focus() }
  const toast = useToast()
  const fail = (message: string, ofChoice = false) => { setError(message); setChoosing(ofChoice); errorFocus.focus(); if (!ofChoice) toast.error({ title: 'That didn’t go through', message }) }
  const refuseField = (fromField: boolean) => { setProblemAlert(value => fromField ? (value ?? 0) + 1 : null); fieldFocus.focus() }

  const search = async (event: FormEvent) => {
    event.preventDefault()
    if (searching) return
    const fromField = sentFromField(event)
    const text = query.trim()
    if (text.length < QUERY_MIN || text.length > QUERY_MAX) {
      setQueryProblem('Enter at least 3 characters of a name or facility.'); refuseField(fromField); return
    }
    setSearching(true); setQueryProblem(null); setProblemAlert(null); setError(null)
    try {
      const items = await api.searchShareProviders(text)
      setResults({ query: text, items })
      setChosenId(items.some(item => item.membershipId === chosenId) ? chosenId : null)
      resultsFocus.focus()
    } catch (cause) {
      if (isHidApiError(cause) && cause.code === 'SHARE_SEARCH_QUERY_INVALID') { setQueryProblem(cause.message); refuseField(fromField) }
      else fail(shareProblem(cause, 'The search could not be completed. Please try again.'))
    } finally { setSearching(false) }
  }

  const choose = () => {
    const picked = results?.items.find(item => item.membershipId === chosenId) ?? null
    if (!picked) { fail('Choose who to share with.', true); return }
    setProvider(picked); go('level')
  }

  const share = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !provider) return
    const body = { membershipId: provider.membershipId, level, duration }
    setBusy(true); setError(null)
    try {
      const answer = await api.createShare(body, shareKey(body))
      setCreated(answer); go('done')
      toast.success({ title: 'Shared', message: `${answer.clinicianName ?? 'They'} can see your records now.` })
    } catch (cause) {
      fail(shareProblem(cause, 'Your records could not be shared. Please try again.'))
    } finally { setBusy(false) }
  }

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const fromField = sentFromField(event)
    const address = email.trim(), person = name.trim()
    const badEmail = inviteEmailProblem(address)
    const badName = person && !PERSON_NAME.test(person) ? 'Enter their name using letters, spaces, apostrophes, dots or hyphens.' : null
    setEmailProblem(badEmail); setNameProblem(badName); setError(null)
    if (badEmail || badName) { refuseField(fromField); return }
    setProblemAlert(null)
    const body = { email: address, ...(person ? { name: person } : {}), level, duration }
    setBusy(true)
    try {
      const answer = await api.createShareInvitation(body, inviteKey(body))
      setInvited({ ...answer, email: address }); go('invited')
      toast.success({ title: 'Invitation sent', message: `We’ll email ${address}.` })
    } catch (cause) {
      if (isHidApiError(cause) && cause.code === 'SHARE_INVITATION_EMAIL_INVALID') { setEmailProblem(cause.message); refuseField(fromField) }
      else fail(shareProblem(cause, 'The invitation could not be sent. Please try again.'))
    } finally { setBusy(false) }
  }

  const startAgain = (next: 'search' | 'invite') => {
    setCreated(null); setInvited(null); setProvider(null); setChosenId(null); setResults(null); setQuery('')
    setEmail(''); setName(''); setLevel('view_only'); setDuration('24h'); setProblemAlert(null); go(next)
  }

  // A failed request is said at the top (a toast, read out as an alert); only a choice left out is said in place.
  const alert = error && choosing && <p ref={errorFocus.target} tabIndex={-1} role="alert" className="patient-inline-error">{error}</p>
  const number = STEP_NUMBER[step]
  const heading = (text: string, hint?: ReactNode) => <div className="flex flex-col gap-1">
    <h2 ref={stepFocus.target} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{text}</h2>
    {hint && <p className="m-0 text-[13px] text-ink-3">{hint}</p>}
  </div>
  const who = provider ? `${provider.clinicianName} at ${provider.facilityName}` : ''
  // A field's problem line is an alert only when focus could not move to it (problemAlert), and then new for each refusal.
  const alerts = (first: boolean) => first && problemAlert !== null
  const problemKey = (first: boolean) => alerts(first) ? `alert-${problemAlert}` : 'quiet'
  const problemRole = (first: boolean) => alerts(first) ? 'alert' : undefined
  const frame = (key: string, body: ReactNode, footer?: ReactNode) => <div key={key} className="overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line">
    {number && <Stepper at={number} />}
    <div className="flex flex-col gap-5 p-5">{body}</div>
    {footer && <div className="flex flex-wrap-reverse items-center justify-between gap-2 border-t border-line bg-subtle px-5 py-3.5">{footer}</div>}
  </div>

  if (step === 'search') {
    const items = results?.items ?? []
    // Two forms: the search, and the choice of who; each holds its own error, which takes focus when it is shown.
    return frame('search', <>
      <form noValidate onSubmit={event => void search(event)} className="flex flex-col gap-3">
        {heading('Who do you want to share with?', 'Search a doctor, nurse or clinician by their name or their hospital’s. Only their name, role and hospital are shown.')}
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1"><span className="sr-only">Name of the clinician or facility</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input ref={fieldFocus.target} type="search" value={query} maxLength={QUERY_MAX} autoComplete="off" placeholder="e.g. Dr Bello or Lagos General"
              aria-invalid={queryProblem ? true : undefined} aria-describedby={describedBy('share-query-hint', queryProblem && 'share-query-problem')}
              onChange={event => setQuery(event.target.value)} className={cx(FIELD, 'pl-9')} /></label>
          <Button type="submit" variant="primary" loading={searching} disabled={searching}>{searching ? 'Searching…' : 'Search'}</Button>
        </div>
        <p id="share-query-hint" className="m-0 text-[12px] text-ink-3">At least 3 characters.</p>
        {queryProblem && <p key={problemKey(true)} role={problemRole(true)} id="share-query-problem" className="m-0 text-[13px] font-medium text-danger-ink">{queryProblem}</p>}
        <div role="status" className="empty:hidden">{results && <p ref={resultsFocus.target} tabIndex={-1} className="m-0 text-[13px] text-ink-2 outline-none">{items.length === 0
          ? `No one matched “${results.query}”. Check the spelling, or invite them by email.`
          : `${items.length} found for “${results.query}”. Choose who to share with.`}</p>}</div>
        {!choosing && alert}
      </form>
      <form id="share-choose" onSubmit={event => { event.preventDefault(); choose() }} className="flex flex-col gap-3">
        {items.length > 0 && <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Who to share with</legend>
          {items.map(item => <label key={item.membershipId} className={cx(TILE, chosenId === item.membershipId ? TILE_ON : TILE_OFF)}>
            <input type="radio" name="share-provider" value={item.membershipId} checked={chosenId === item.membershipId}
              onChange={() => setChosenId(item.membershipId)} className="sr-only" />
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-ink">{initials(item.clinicianName)}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{item.clinicianName}</span>
              <span className="block text-[13px] text-ink-3">{[SHARE_ROLE_LABELS[item.role], item.facilityName, item.organizationName].filter(Boolean).join(' · ')}</span>
              {item.newOnHealthId && <span className="mt-1 inline-flex rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn-ink">New on Health ID</span>}</span>
            <Radio on={chosenId === item.membershipId} />
          </label>)}
        </fieldset>}
        {choosing && alert}
      </form>
      <button type="button" className="inline-flex cursor-pointer items-center gap-2 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-ink hover:underline" onClick={() => go('invite')}><Mail className="size-4" aria-hidden />Can’t find them? Invite them by email</button>
    </>, <><Button to="/access" variant="ghost">Cancel</Button>
      {items.length > 0 && <Button type="submit" form="share-choose" variant="primary" iconRight={ArrowRight}>Continue</Button>}</>)
  }

  // What they can do and for how long, together: two choices about the same grant, so one step (fewer steps to the goal).
  if (step === 'level' || step === 'duration') return frame('level', <form id="share-access" onSubmit={event => { event.preventDefault(); go('confirm') }} className="flex flex-col gap-6">
    {heading('What can they see, and for how long?', <>Sharing with <strong className="font-medium text-ink">{who}</strong>. You can end it sooner at any time.</>)}
    <LevelChoice name="share-level" value={level} onChange={setLevel} />
    <DurationChoice name="share-duration" value={duration} onChange={setDuration} />
  </form>, <><Button onClick={() => go('search')} icon={ArrowLeft}>Back</Button>
    <Button type="submit" form="share-access" variant="primary" iconRight={ArrowRight}>Continue</Button></>)

  if (step === 'confirm' && provider) return frame('confirm', <form id="share-confirm" onSubmit={event => void share(event)} className="flex flex-col gap-5">
    {heading('Check and share')}
    <div className="flex items-center gap-3 rounded-xl bg-subtle p-3 ring-1 ring-line">
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink">{initials(provider.clinicianName)}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{provider.clinicianName}, {SHARE_ROLE_LABELS[provider.role]}</span>
        <span className="block text-[13px] text-ink-3">{[provider.facilityName, provider.organizationName].filter(Boolean).join(', ')}</span></span>
      <button type="button" onClick={() => go('search')} className="cursor-pointer border-0 bg-transparent text-[13px] font-semibold text-brand-ink hover:underline">Change<span className="sr-only"> who</span></button>
    </div>
    <dl className="m-0 divide-y divide-line rounded-xl ring-1 ring-line">
      <div className="flex items-start gap-3 px-4 py-3"><Eye className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><dt className="text-[12px] text-ink-3">What they can do</dt>
        <dd className="m-0 text-sm font-medium text-ink">{shareLevelLabel(level)}</dd>{level === 'clinical_collaboration' && <dd className="m-0 mt-1 text-[13px] text-warn-ink">{COLLABORATION_WARNING}</dd>}</div>
        <button type="button" onClick={() => go('level')} className="cursor-pointer border-0 bg-transparent text-[13px] font-semibold text-brand-ink hover:underline">Change<span className="sr-only"> what they can do</span></button></div>
      <div className="flex items-start gap-3 px-4 py-3"><Clock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><dt className="text-[12px] text-ink-3">How long</dt>
        <dd className="m-0 text-sm font-medium text-ink">{shareDurationLabel(duration)}</dd></div>
        <button type="button" onClick={() => go('level')} className="cursor-pointer border-0 bg-transparent text-[13px] font-semibold text-brand-ink hover:underline">Change<span className="sr-only"> how long</span></button></div>
    </dl>
    <p className="m-0 flex gap-2 text-[13px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />If you already share with them, this replaces it. Every view is recorded, and you can end it any time.</p>
    {/* Your card is what arrives: the email they will receive, before you send it. */}
    {myCard && <div className="flex flex-col gap-2">
      <p className="m-0 text-[13px] font-medium text-ink-2">What {provider.clinicianName} receives</p>
      <ShareEmailPreview card={myCard} to={provider.clinicianName} level={level} duration={duration} />
    </div>}
    {alert}
  </form>, <><Button disabled={busy} onClick={() => go('level')} icon={ArrowLeft}>Back</Button>
    <Button type="submit" form="share-confirm" variant="primary" icon={Share2} loading={busy} disabled={busy}>{busy ? 'Sharing…' : 'Share my records'}</Button></>)

  if (step === 'done' && created) return frame('done', <div className="flex flex-col items-center gap-3 py-4 text-center">
    <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-7" aria-hidden /></span>
    {heading('Your records are shared')}
    <p className="m-0 max-w-md text-sm text-ink-2">Your card is on its way to {created.clinicianName ? `${created.clinicianName} at ${created.facilityName}` : `a provider at ${created.facilityName}`}. They can open your
      records {shareUntil(created.duration, created.expiresAt)}.</p>
    {created.replacedConsentGrantId && <p className="m-0 text-[13px] text-ink-3">This replaces the share you had with them before.</p>}
    <Link to="/card/preview" className="text-[13px] font-semibold text-brand-ink no-underline hover:underline">Preview what they see when they open your card</Link>
  </div>, <><Button onClick={() => startAgain('search')}>Share with someone else</Button>
    <Button to="/access" variant="primary">See who has access</Button></>)

  if (step === 'invite') return frame('invite', <form id="share-invite" noValidate onSubmit={event => void invite(event)} className="flex flex-col gap-5">
    {heading('Invite them by email', 'For a doctor, nurse or clinician who isn’t on Health ID yet.')}
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">Their email address
      <input ref={emailProblem || !nameProblem ? fieldFocus.target : undefined} type="email" value={email} maxLength={254}
        autoComplete="off" aria-invalid={emailProblem ? true : undefined} aria-describedby={describedBy(emailProblem && 'invite-email-problem')}
        onChange={event => setEmail(event.target.value)} className={FIELD} /></label>
    {emailProblem && <p key={problemKey(true)} role={problemRole(true)} id="invite-email-problem" className="m-0 -mt-3 text-[13px] font-medium text-danger-ink">{emailProblem}</p>}
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2"><span>Their name <span className="font-normal text-ink-3">· optional</span></span>
      <input ref={nameProblem && !emailProblem ? fieldFocus.target : undefined} value={name} maxLength={120} autoComplete="off"
        aria-invalid={nameProblem ? true : undefined} aria-describedby={describedBy('invite-name-hint', nameProblem && 'invite-name-problem')}
        onChange={event => setName(event.target.value)} className={FIELD} /></label>
    <p id="invite-name-hint" className="m-0 -mt-3 text-[12px] text-ink-3">Only you see it. It isn’t put in the email.</p>
    {/* One alert at a time: the email's, when both are wrong. */}
    {nameProblem && <p key={problemKey(!emailProblem)} role={problemRole(!emailProblem)} id="invite-name-problem" className="m-0 -mt-3 text-[13px] font-medium text-danger-ink">{nameProblem}</p>}
    <LevelChoice name="invite-level" value={level} onChange={setLevel} />
    <DurationChoice name="invite-duration" value={duration} onChange={setDuration} />
    <p className="m-0 flex gap-2 text-[13px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Nothing is shared until they join Health ID, accept, and you confirm.</p>
    {alert}
  </form>, <><Button disabled={busy} onClick={() => go('search')} icon={Search}>Search instead</Button>
    <Button type="submit" form="share-invite" variant="primary" icon={Mail} loading={busy} disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</Button></>)

  if (step === 'invited' && invited) return frame('invited', <div className="flex flex-col items-center gap-3 py-4 text-center">
    <span className="inline-flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><Mail className="size-7" aria-hidden /></span>
    {heading('Invitation sent')}
    <p className="m-0 max-w-md text-sm text-ink-2">We’ll email {invited.email}. When they accept, you’ll get a notice and confirm before they can see anything.</p>
    {invited.deliveryOutcome === 'not_confirmed' && <p className="m-0 text-[13px] text-warn-ink">Delivery not confirmed. The invitation stays open
      until {shareDay(invited.expiresAt)}, and you can cancel it in Access & sharing.</p>}
  </div>, <><Button onClick={() => startAgain('invite')}>Invite someone else</Button>
    <Button to="/access" variant="primary">Back to Access & sharing</Button></>)

  // A step whose choice is gone (it cannot happen through the page) starts again.
  return frame('lost', <Button onClick={() => startAgain('search')}>Start again</Button>)
}

const FIELD = 'h-10 w-full rounded-[10px] border-0 bg-surface px-3 text-sm text-ink shadow-[var(--shadow-xs)] ring-1 ring-inset ring-line-control outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-brand'
const TILE = 'flex cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand'
const TILE_ON = 'bg-brand-soft ring-[1.5px] ring-brand'
const TILE_OFF = 'bg-surface ring-1 ring-line hover:bg-subtle'
const initials = (name: string) => name.replace(/^(Dr|Nurse|Mr|Mrs|Ms)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')

function Radio({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={cx('inline-flex size-5 shrink-0 items-center justify-center rounded-full ring-1', on ? 'bg-brand-fill ring-brand' : 'bg-surface ring-line-control')}>
    {on && <span className="size-2 rounded-full bg-white" />}</span>
}

/** Where the patient is: three steps, the done ones ticked (goal gradient: the end is in sight). */
function Stepper({ at }: { at: number }) {
  const steps = ['Who', 'Access', 'Check']
  return <ol aria-label={`Step ${at} of ${steps.length}`} className="m-0 flex list-none items-center gap-2 border-b border-line bg-subtle px-5 py-3">
    {steps.map((label, i) => { const n = i + 1, done = n < at, now = n === at
      return <li key={label} aria-current={now ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cx('inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold', done ? 'bg-success text-white' : now ? 'bg-brand-fill text-white' : 'bg-surface text-ink-3 ring-1 ring-line-control')}>
          {done ? <Check className="size-3.5" aria-hidden /> : n}</span>
        <span className={cx('truncate text-[13px]', now ? 'font-semibold text-ink' : 'text-ink-3')}>{label}</span>
        {n < steps.length && <span aria-hidden="true" className={cx('h-px flex-1', done ? 'bg-success' : 'bg-line-strong')} />}
      </li> })}
  </ol>
}

const LEVEL_ICON: Record<ShareLevel, typeof Eye> = { view_only: Eye, clinical_review: Stethoscope, clinical_collaboration: PenLine }

function LevelChoice({ name, value, onChange }: { name: string; value: ShareLevel; onChange: (value: ShareLevel) => void }) {
  return <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
    <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">What they can do</legend>
    {SHARE_LEVELS.map(option => { const I = LEVEL_ICON[option.value], on = value === option.value
      return <label key={option.value} className={cx(TILE, '!items-start', on ? TILE_ON : TILE_OFF)}>
        <input type="radio" name={name} value={option.value} checked={on} onChange={() => onChange(option.value)} className="sr-only"
          aria-describedby={`${name}-${option.value}-hint`} />
        <span className={cx('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', on ? 'bg-brand-fill text-white' : 'bg-subtle text-ink-2')}><I className="size-[18px]" aria-hidden /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{option.label}</span>
          <span id={`${name}-${option.value}-hint`} className="block text-[13px] text-ink-3">{option.description}{option.value === 'clinical_collaboration' && ` ${COLLABORATION_WARNING}`}</span></span>
        <Radio on={on} />
      </label> })}
  </fieldset>
}

function DurationChoice({ name, value, onChange }: { name: string; value: ShareDuration; onChange: (value: ShareDuration) => void }) {
  return <fieldset className="m-0 border-0 p-0">
    <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">How long</legend>
    <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-tray p-1.5 sm:grid-cols-4">
      {SHARE_DURATIONS.map(option => { const on = value === option.value
        return <label key={option.value} className={cx('flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-2 py-2 text-center text-[13px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
          on ? 'bg-surface text-brand-ink shadow-[var(--shadow-xs)] ring-[1.5px] ring-brand' : 'text-ink-2 hover:bg-surface/70')}>
          <input type="radio" name={name} value={option.value} checked={on} onChange={() => onChange(option.value)} className="sr-only" />
          {option.value === 'until_revoked' ? 'Until I end it' : option.label}
        </label> })}
    </div>
    {value === 'until_revoked' && <p className="m-0 mt-2 text-[12px] text-ink-3">Up to 1 year at most, never forever.</p>}
  </fieldset>
}
