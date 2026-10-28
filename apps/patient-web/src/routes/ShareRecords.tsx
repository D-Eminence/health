import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
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
const STEP_NUMBER: Partial<Record<Step, number>> = { search: 1, level: 2, duration: 3, confirm: 4 }
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
  return <section className="patient-section"><p className="patient-eyebrow">Consent</p>
    <h1 className="patient-page-title">Share your records</h1>
    {probe.served === true ? <ShareFlow />
      : probe.error ? <div className="patient-card" role="alert"><p>{probe.error}</p>
        <button type="button" onClick={probe.retry}>Try again</button></div>
      : <div className="patient-card patient-loading" role="status">Opening sharing…</div>}
  </section>
}

function ShareFlow() {
  const { api } = useSession()
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
  const fail = (message: string, ofChoice = false) => { setError(message); setChoosing(ofChoice); errorFocus.focus() }
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
    } catch (cause) {
      if (isHidApiError(cause) && cause.code === 'SHARE_INVITATION_EMAIL_INVALID') { setEmailProblem(cause.message); refuseField(fromField) }
      else fail(shareProblem(cause, 'The invitation could not be sent. Please try again.'))
    } finally { setBusy(false) }
  }

  const startAgain = (next: 'search' | 'invite') => {
    setCreated(null); setInvited(null); setProvider(null); setChosenId(null); setResults(null); setQuery('')
    setEmail(''); setName(''); setLevel('view_only'); setDuration('24h'); setProblemAlert(null); go(next)
  }

  const alert = error && <p ref={errorFocus.target} tabIndex={-1} role="alert" className="patient-inline-error">{error}</p>
  const number = STEP_NUMBER[step]
  const heading = (text: string) => <>
    {number && <p className="patient-field-hint">Step {number} of 4</p>}
    <h2 ref={stepFocus.target} tabIndex={-1}>{text}</h2>
  </>
  const who = provider ? `${provider.clinicianName} at ${provider.facilityName}` : ''
  // A field's problem line is an alert only when focus could not move to it (problemAlert), and then new for each refusal.
  const alerts = (first: boolean) => first && problemAlert !== null
  const problemKey = (first: boolean) => alerts(first) ? `alert-${problemAlert}` : 'quiet'
  const problemRole = (first: boolean) => alerts(first) ? 'alert' : undefined

  if (step === 'search') {
    const items = results?.items ?? []
    // Two forms: the search, and the choice of who; each holds its own error, which takes focus when it is shown.
    return <div key="search" className="patient-card">
      <form className="patient-form" noValidate onSubmit={event => void search(event)}>
        {heading('Find who to share with')}
        <p className="patient-field-hint">Search for a doctor, clinician or nurse by their name, or by their facility’s name. Only
          their name, role and facility are shown.</p>
        <label>Name of the clinician or facility
          <input ref={fieldFocus.target} type="search" value={query} maxLength={QUERY_MAX} autoComplete="off"
            aria-invalid={queryProblem ? true : undefined} aria-describedby={describedBy('share-query-hint', queryProblem && 'share-query-problem')}
            onChange={event => setQuery(event.target.value)} /></label>
        <p id="share-query-hint" className="patient-field-hint">At least 3 characters.</p>
        {queryProblem && <p key={problemKey(true)} role={problemRole(true)} id="share-query-problem" className="patient-inline-error">{queryProblem}</p>}
        <div><button type="submit" className="patient-secondary-button" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></div>
        <div role="status">{results && <p ref={resultsFocus.target} tabIndex={-1}>{items.length === 0
          ? `No one matched “${results.query}”. Check the spelling, or invite them by email.`
          : `${items.length} found for “${results.query}”. Choose who to share with.`}</p>}</div>
        {!choosing && alert}
      </form>
      <form className="patient-form" onSubmit={event => { event.preventDefault(); choose() }}>
        {items.length > 0 && <fieldset className="patient-share-options">
          <legend>Who to share with</legend>
          {items.map(item => <label key={item.membershipId} className="patient-share-option">
            <input type="radio" name="share-provider" value={item.membershipId} checked={chosenId === item.membershipId}
              onChange={() => setChosenId(item.membershipId)} />
            <span><strong>{item.clinicianName}</strong>
              <span>{[SHARE_ROLE_LABELS[item.role], item.facilityName, item.organizationName].filter(Boolean).join(' · ')}</span>
              {item.newOnHealthId && <span className="patient-status-tag">New on Health ID</span>}</span>
          </label>)}
        </fieldset>}
        {choosing && alert}
        <div className="patient-decision-actions">
          {items.length > 0 && <button type="submit" className="patient-primary-button">Continue</button>}
          <Link to="/access" className="patient-secondary-button">Cancel</Link>
        </div>
        <button type="button" className="patient-text-button" onClick={() => go('invite')}>Can’t find them? Invite them by email</button>
      </form>
    </div>
  }

  if (step === 'level') return <form key="level" className="patient-card patient-form" onSubmit={event => { event.preventDefault(); go('duration') }}>
    {heading('Choose what they can do')}
    <p className="patient-field-hint">Sharing with {who}.</p>
    <LevelChoice name="share-level" value={level} onChange={setLevel} />
    <div className="patient-decision-actions"><button type="submit" className="patient-primary-button">Continue</button>
      <button type="button" className="patient-secondary-button" onClick={() => go('search')}>Back</button></div>
  </form>

  if (step === 'duration') return <form key="duration" className="patient-card patient-form" onSubmit={event => { event.preventDefault(); go('confirm') }}>
    {heading('Choose how long')}
    <p className="patient-field-hint">Sharing with {who}. You can end it sooner at any time in Access and consent.</p>
    <DurationChoice name="share-duration" value={duration} onChange={setDuration} />
    <div className="patient-decision-actions"><button type="submit" className="patient-primary-button">Continue</button>
      <button type="button" className="patient-secondary-button" onClick={() => go('level')}>Back</button></div>
  </form>

  if (step === 'confirm' && provider) return <form key="confirm" className="patient-card patient-form" onSubmit={event => void share(event)}>
    {heading('Check and share')}
    <dl className="patient-details">
      <dt>Who</dt><dd>{provider.clinicianName}, {SHARE_ROLE_LABELS[provider.role]}</dd>
      <dt>Facility</dt><dd>{[provider.facilityName, provider.organizationName].filter(Boolean).join(', ')}</dd>
      <dt>What they can do</dt><dd>{shareLevelLabel(level)}{level === 'clinical_collaboration' && <>. {COLLABORATION_WARNING}</>}</dd>
      <dt>How long</dt><dd>{shareDurationLabel(duration)}</dd>
    </dl>
    <p className="patient-field-hint">If you already share with them, this replaces that share. You can end it at any time in Access and
      consent.</p>
    {alert}
    <div className="patient-decision-actions"><button type="submit" className="patient-primary-button" disabled={busy}>
      {busy ? 'Sharing…' : 'Share my records'}</button>
      <button type="button" className="patient-secondary-button" disabled={busy} onClick={() => go('duration')}>Back</button></div>
  </form>

  if (step === 'done' && created) return <div key="done" className="patient-card">
    {heading('Your records are shared')}
    <p>{created.clinicianName ? `${created.clinicianName} at ${created.facilityName}` : `A provider at ${created.facilityName}`} can see your
      records {shareUntil(created.duration, created.expiresAt)}.</p>
    {created.replacedConsentGrantId && <p className="patient-field-hint">This replaces the share you had with them before.</p>}
    <p className="patient-field-hint">They have been told. You can end this access at any time in Access and consent.</p>
    <div className="patient-decision-actions"><Link to="/access" className="patient-primary-button">Go to Access and consent</Link>
      <button type="button" className="patient-secondary-button" onClick={() => startAgain('search')}>Share with someone else</button></div>
  </div>

  if (step === 'invite') return <form key="invite" className="patient-card patient-form" noValidate onSubmit={event => void invite(event)}>
    {heading('Invite a provider by email')}
    <p className="patient-field-hint">For a doctor, clinician or nurse who is not on Health ID yet.</p>
    <label>Their email address
      <input ref={emailProblem || !nameProblem ? fieldFocus.target : undefined} type="email" value={email} maxLength={254}
        autoComplete="off" aria-invalid={emailProblem ? true : undefined} aria-describedby={describedBy(emailProblem && 'invite-email-problem')}
        onChange={event => setEmail(event.target.value)} /></label>
    {emailProblem && <p key={problemKey(true)} role={problemRole(true)} id="invite-email-problem" className="patient-inline-error">{emailProblem}</p>}
    <label>Their name (optional)
      <input ref={nameProblem && !emailProblem ? fieldFocus.target : undefined} value={name} maxLength={120} autoComplete="off"
        aria-invalid={nameProblem ? true : undefined} aria-describedby={describedBy('invite-name-hint', nameProblem && 'invite-name-problem')}
        onChange={event => setName(event.target.value)} /></label>
    <p id="invite-name-hint" className="patient-field-hint">Only you see it. It is not put in the email.</p>
    {/* One alert at a time: the email's, when both are wrong. */}
    {nameProblem && <p key={problemKey(!emailProblem)} role={problemRole(!emailProblem)} id="invite-name-problem" className="patient-inline-error">{nameProblem}</p>}
    <LevelChoice name="invite-level" value={level} onChange={setLevel} />
    <DurationChoice name="invite-duration" value={duration} onChange={setDuration} />
    <p>We’ll email them. Nothing is shared until they accept in Health ID and you confirm.</p>
    {alert}
    <div className="patient-decision-actions"><button type="submit" className="patient-primary-button" disabled={busy}>
      {busy ? 'Sending…' : 'Send invitation'}</button>
      <button type="button" className="patient-secondary-button" disabled={busy} onClick={() => go('search')}>Search instead</button></div>
  </form>

  if (step === 'invited' && invited) return <div key="invited" className="patient-card">
    {heading('Invitation sent')}
    <p>We’ll email {invited.email}. Nothing is shared until they accept in Health ID and you confirm.</p>
    {invited.deliveryOutcome === 'not_confirmed' && <p className="patient-field-hint">Delivery not confirmed. The invitation stays open
      until {shareDay(invited.expiresAt)}, and you can cancel it in Access and consent.</p>}
    <p className="patient-field-hint">When they accept, you’ll get a notice. You then confirm in Access and consent before they can see your
      records.</p>
    <div className="patient-decision-actions"><Link to="/access" className="patient-primary-button">Go to Access and consent</Link>
      <button type="button" className="patient-secondary-button" onClick={() => startAgain('invite')}>Invite someone else</button></div>
  </div>

  // A step whose choice is gone (it cannot happen through the page) starts again.
  return <div className="patient-card"><button type="button" onClick={() => startAgain('search')}>Start again</button></div>
}

function Options({ legend, children }: { legend: string; children: ReactNode }) {
  return <fieldset className="patient-share-options"><legend>{legend}</legend>{children}</fieldset>
}

function LevelChoice({ name, value, onChange }: { name: string; value: ShareLevel; onChange: (value: ShareLevel) => void }) {
  return <Options legend="What they can do">
    {SHARE_LEVELS.map(option => <label key={option.value} className="patient-share-option">
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)}
        aria-describedby={`${name}-${option.value}-hint`} />
      <span><strong>{option.label}</strong>
        <span id={`${name}-${option.value}-hint`}>{option.description}{option.value === 'clinical_collaboration' && ` ${COLLABORATION_WARNING}`}</span></span>
    </label>)}
  </Options>
}

function DurationChoice({ name, value, onChange }: { name: string; value: ShareDuration; onChange: (value: ShareDuration) => void }) {
  return <Options legend="How long">
    {SHARE_DURATIONS.map(option => <label key={option.value} className="patient-share-option">
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </Options>
}
