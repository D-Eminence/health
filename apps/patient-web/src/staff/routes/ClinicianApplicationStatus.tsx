import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useDocumentTitle } from '../../authSteps'
import { CLINICIAN_STATUS_PATH, clinicianMainSiteHref } from '../../productHostname'
import { CLINICIAN_REGULATOR_OF, clinicianApplicationApi, newClinicianIdempotencyKey, type ClinicianAccountView,
  type ClinicianApplicationDetails, type ClinicianApplicationView, type ClinicianStatusVerified } from '../clinicianApplicationApi'
import { ClinicianAuthenticator } from '../clinician/ClinicianAuthenticator'
import { Declarations, DetailsFields, EMPTY_DETAILS, FIELD, applicationDetails, declarationProblems, detailsProblems,
  type DetailsValue } from '../clinician/ClinicianDetails'
import { EmailCode } from '../clinician/EmailCode'
import { ACCOUNT_UNAVAILABLE, APPLICATION_CHANGED, APPLY_REFUSAL, FACILITY_UNAVAILABLE, MAINTENANCE, PAGE_EXPIRED, PROFESSION_NAME,
  REGULATOR_NAME, STATE_LABEL, codeOf, formatDate, refusalCopy, stateCopy, statusCodeSentCopy } from '../clinician/copy'
import { ClinicianFrame, ErrorSummary, MainSiteOnly, PrimaryButton, StepError, StepHeading, TextButton, shownError,
  type Problem } from '../clinician/ui'

/**
 * The clinician application status page at /provider/join/status (hid-system
 * ADR-064, P10-P15). The applicant proves the email address with a code, then
 * their authenticator (or sets it up), and sees each application in fixed
 * words; they can withdraw one, apply to another facility, or close the page.
 * Nothing here signs anyone in to the provider portal: the capability
 * Identity sets is an httpOnly cookie for these routes only. A 401 means only
 * that this page closed (30 minutes); an outage keeps what is shown and
 * offers Retry, and never asks for the email again.
 */

type Phase = 'loading' | 'failed' | 'form' | 'authenticator' | 'list'

const OPEN_STATES = new Set(['awaiting_authenticator', 'submitted', 'under_review'])
const COULD_NOT_LOAD = "We couldn't load your application right now."
const RETRY = 'clinician-status-retry'
const LIST_RETRY = 'clinician-status-list-retry'
const CLOSE = 'clinician-status-close'

/** A change Identity made (a withdrawal, a new application): what to say, and how it changes the list shown. */
interface Done { notice: string; change(view: ClinicianAccountView): ClinicianAccountView }

export function ClinicianApplicationStatus() {
  const mainSite = clinicianMainSiteHref(window.location.hostname, CLINICIAN_STATUS_PATH)
  return mainSite ? <MainSiteOnly href={mainSite} path={CLINICIAN_STATUS_PATH} /> : <StatusPage />
}

function StatusPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  // Whether the page has moved from what it opened with: from then on each heading shown takes focus.
  const [moved, setMoved] = useState(false)
  // Each failure to load is new, so the same words are announced again after a Retry.
  const [failure, setFailure] = useState(() => shownError(COULD_NOT_LOAD))
  const [formNotice, setFormNotice] = useState<{ text: string; tone: 'alert' | 'status' } | null>(null)
  const [formRound, setFormRound] = useState(0)
  const [authenticatorStart, setAuthenticatorStart] = useState<'enrol' | 'verify'>('verify')
  const [email, setEmail] = useState('')
  const [account, setAccount] = useState<ClinicianAccountView | null>(null)
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const [listError, setListError] = useState<{ id: number; message: string } | null>(null)
  const [closeError, setCloseError] = useState<{ id: number; message: string } | null>(null)
  const [withdrawing, setWithdrawing] = useState<ClinicianApplicationView | null>(null)
  const [withdrawError, setWithdrawError] = useState<{ id: number; message: string } | null>(null)
  const [busy, setBusy] = useState<'withdraw' | 'close' | 'reload' | null>(null)
  // A request of "Apply to another facility" (sending, or a facility search) is running: closing the page, or reading
  // the list again, waits for its answer, which would otherwise reach a page already closed.
  const [applyWorking, setApplyWorking] = useState(false)
  const noticeLine = useRef<HTMLParagraphElement>(null)
  // Whether this page holds an application capability (an email code was checked, or the applications were read):
  // only then does a 401 mean that it closed.
  const held = useRef(false)
  // A control to focus once drawn again: the one used was disabled while its request ran.
  const [focusRequest, setFocusRequest] = useState<{ id: string; count: number } | null>(null)

  useDocumentTitle(phase === 'list' ? 'Your clinician applications · Health ID Provider' : 'Clinician application · Health ID Provider')

  function move(next: Phase) {
    setPhase(next)
    setMoved(true)
  }

  function focusOn(id: string) {
    setFocusRequest(previous => ({ id, count: (previous?.count ?? 0) + 1 }))
  }

  function toForm(text: string | null, tone: 'alert' | 'status' = 'alert') {
    held.current = false
    setFormNotice(text ? { text, tone } : null)
    setFormRound(value => value + 1)
    setAccount(null)
    setWithdrawing(null)
    move('form')
  }

  function toAuthenticator(start: 'enrol' | 'verify') {
    setAuthenticatorStart(start)
    setWithdrawing(null)
    move('authenticator')
  }

  function showList(view: ClinicianAccountView, text: string | null = null) {
    setAccount(view)
    setListError(null)
    setCloseError(null)
    setNotice(text ? previous => ({ id: (previous?.id ?? 0) + 1, text }) : null)
    move('list')
  }

  /** Takes over a refusal that ends what is shown: the page closed, or the authenticator must be verified again. */
  function takeOver(caught: unknown): boolean {
    const code = codeOf(caught)
    if (code === 'CLINICIAN_APPLICATION_SESSION_INVALID') { toForm(PAGE_EXPIRED); return true }
    if (code === 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED') { toAuthenticator('verify'); return true }
    return false
  }

  /**
   * Reads the applications. From the list, an outage keeps the list; otherwise it is said with Retry. True when it
   * could not read them and the page says so. After a change that went through (`done`), that change is said and
   * shown as Identity answered it even when the list cannot be read again.
   */
  async function load(options: { notice?: string; done?: Done; fromList?: boolean; initial?: boolean } = {}): Promise<boolean> {
    try {
      const view = await clinicianApplicationApi.current()
      held.current = true
      if (options.initial) { setAccount(view); setPhase('list') } else showList(view, options.done?.notice ?? options.notice ?? null)
      return false
    } catch (caught) {
      const code = codeOf(caught)
      // No application page was open here (a first visit, perhaps after an outage): the form, with nothing said about one closing.
      if (code === 'CLINICIAN_APPLICATION_SESSION_INVALID' && !held.current) {
        if (options.initial) setPhase('form'); else toForm(null)
        return false
      }
      // The account was disabled or is no longer active: reading again cannot help, so the form says so, with no Retry.
      if (code === 'CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE') {
        if (options.initial) { setFormNotice({ text: ACCOUNT_UNAVAILABLE, tone: 'alert' }); setPhase('form') } else toForm(ACCOUNT_UNAVAILABLE)
        return false
      }
      if (code === 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED') held.current = true
      if (options.initial && code === 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED') { setAuthenticatorStart('verify'); setPhase('authenticator'); return false }
      if (takeOver(caught)) return false
      const message = code === 'PLATFORM_MAINTENANCE' ? MAINTENANCE : COULD_NOT_LOAD
      if (options.fromList) {
        const done = options.done
        if (done) {
          setAccount(current => current && done.change(current))
          setNotice(previous => ({ id: (previous?.id ?? 0) + 1, text: done.notice }))
        }
        setListError(shownError(`${message} Try again.`))
      } else { setFailure(shownError(message)); if (options.initial) setPhase('failed'); else move('failed') }
      return true
    }
  }

  // Once, as the page opens.
  useEffect(() => { void load({ initial: true }) }, [])

  useEffect(() => { if (notice) noticeLine.current?.focus() }, [notice])

  useEffect(() => { if (focusRequest) document.getElementById(focusRequest.id)?.focus() }, [focusRequest])

  async function retry(fromList: boolean) {
    setBusy('reload')
    const failed = await load({ fromList })
    setBusy(null)
    // Still failing: focus goes back to Retry, and the failure (a new alert) is said again.
    if (failed) focusOn(fromList ? LIST_RETRY : RETRY)
  }

  function statusRefused(caught: unknown, call: 'send' | 'verify'): string {
    return refusalCopy(caught, call === 'send' ? "We couldn't send a code right now. Try again in a few minutes."
      : "We couldn't check the code right now. Try again.", 'Too many attempts from your network. Try again later.')
  }

  async function confirmWithdraw() {
    if (!withdrawing || busy) return
    const view = withdrawing
    setBusy('withdraw')
    setWithdrawError(null)
    try {
      const withdrawn = await clinicianApplicationApi.withdraw(view)
      setWithdrawing(null)
      await load({ fromList: true, done: { notice: `You withdrew your application to ${view.facility.name}.`,
        change: shown => ({ ...shown, applications: shown.applications.map(application =>
          application.applicationId === withdrawn.applicationId ? withdrawn : application) }) } })
    } catch (caught) {
      const code = codeOf(caught)
      if (code === 'VERSION_CONFLICT' || code === 'CLINICIAN_APPLICATION_STATE_INVALID' || code === 'CLINICIAN_APPLICATION_NOT_FOUND') {
        setWithdrawing(null)
        await load({ notice: APPLICATION_CHANGED, fromList: true })
      } else if (code === 'CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE') {
        toForm(ACCOUNT_UNAVAILABLE)
      } else if (!takeOver(caught)) {
        setWithdrawError(shownError(code === 'PLATFORM_MAINTENANCE' ? MAINTENANCE : "We couldn't withdraw it right now. Try again."))
      }
    } finally {
      setBusy(null)
    }
  }

  async function closePage() {
    if (busy || applyWorking) return
    setBusy('close')
    setCloseError(null)
    try {
      await clinicianApplicationApi.endSession()
    } catch {
      // Its own words beside "Close this page", pressed again to retry: a Retry here would only read the list again.
      setCloseError(shownError("This page couldn't be closed right now. Try again."))
      setBusy(null)
      focusOn(CLOSE)
      return
    }
    setBusy(null)
    setEmail('')
    toForm('This page is closed.', 'status')
  }

  if (phase === 'loading') {
    return <ClinicianFrame><p role="status" className="patient-page-copy">Opening your clinician application…</p></ClinicianFrame>
  }

  if (phase === 'failed') {
    return <ClinicianFrame labelledBy="clinician-status-title">
      <StepHeading id="clinician-status-title" level={1} focus={moved}>Check your clinician application</StepHeading>
      <StepError error={failure} />
      <PrimaryButton id={RETRY} onClick={() => { setMoved(true); void retry(false) }} disabled={busy !== null}>
        {busy === 'reload' ? 'Loading…' : 'Retry'}</PrimaryButton>
    </ClinicianFrame>
  }

  if (phase === 'form' || phase === 'authenticator') {
    return <ClinicianFrame labelledBy="clinician-status-title">
      <StepHeading key={`${phase}-${formRound}`} id="clinician-status-title" level={1} focus={moved && phase === 'form'}>
        Check your clinician application</StepHeading>
      {phase === 'form' && <>
        {formNotice && <p role={formNotice.tone} className={formNotice.tone === 'alert' ? 'patient-inline-error' : 'patient-inline-success'}>
          {formNotice.text}</p>}
        <p className="patient-page-copy">Enter the email address you applied with. We'll send it a code. This doesn't sign you in to the
          provider portal.</p>
        <EmailCode key={formRound} idPrefix="clinician-status" action="clinician-application-status" email={email} onEmail={setEmail}
          focusFirst={false}
          copy={{ emailHeading: 'Your work email', emailIntro: null, sent: statusCodeSentCopy, codeInvalid: 'That code is wrong or has expired.' }}
          send={clinicianApplicationApi.sendStatusCode} verify={clinicianApplicationApi.verifyStatusCode} refused={statusRefused}
          onStage={() => setMoved(true)}
          onVerified={(answer: ClinicianStatusVerified) => {
            held.current = true
            toAuthenticator(answer.next === 'authenticator_setup' ? 'enrol' : 'verify')
          }} />
      </>}
      {phase === 'authenticator' && <ClinicianAuthenticator key={formRound} start={authenticatorStart} context="status"
        email={email || account?.account.email || 'your email address'} doneLabel="Continue to your applications"
        onReady={view => { if (view) showList(view); else void load() }} onEnded={() => toForm(PAGE_EXPIRED)}
        skip={authenticatorStart === 'enrol' ? { label: 'See your applications first', onSkip: () => void load() } : undefined} />}
      <p className="patient-auth-footer">Not applied yet? <Link to="/provider/join">Apply as a doctor or nurse</Link>.</p>
    </ClinicianFrame>
  }

  const view = account!
  return <ClinicianFrame labelledBy="clinician-status-title">
    <StepHeading id="clinician-status-title" level={1} focus={moved}>Your clinician applications</StepHeading>
    <p className="patient-page-copy">Applications made with {view.account.email}. This page doesn't sign you in to the provider portal.</p>
    <p ref={noticeLine} tabIndex={-1} role="status" className="patient-field-hint">{notice && <span key={notice.id}>{notice.text}</span>}</p>
    {listError && <div className="clinician-actions">
      <StepError error={listError} />
      <TextButton id={LIST_RETRY} onClick={() => void retry(true)} disabled={busy !== null || applyWorking}>{busy === 'reload' ? 'Loading…' : 'Retry'}</TextButton>
    </div>}
    {/* The account has no authenticator (reset, or its waiting applications closed) and no card offers to set one up. */}
    {view.stage === 'enrolment_required' && !view.applications.some(application => application.state === 'awaiting_authenticator') &&
      <div className="clinician-panel">
        <p className="patient-page-copy">Your account has no authenticator app set up.
          {view.applications.some(application => OPEN_STATES.has(application.state))
            ? " HID can't go on with your applications until you set one up." : ''}</p>
        <div><PrimaryButton onClick={() => toAuthenticator('enrol')}>Set up authenticator</PrimaryButton></div>
      </div>}
    {view.applications.length === 0 && <p className="patient-page-copy">There are no applications for this address.</p>}
    <ul className="clinician-applications">
      {view.applications.map(application => <li key={application.applicationId}>
        <ApplicationCard view={application} stage={view.stage} onSetUp={() => toAuthenticator('enrol')}
          onWithdraw={() => { setWithdrawError(null); setWithdrawing(application) }} />
      </li>)}
    </ul>
    <ApplyAnother account={view} takeOver={takeOver} onWorking={setApplyWorking} onApplied={async (created, facility) => {
      await load({ fromList: true, done: { notice: `Your application to ${facility} was sent. It is in HID's verification queue.`,
        change: shown => shown.applications.some(application => application.applicationId === created.applicationId) ? shown
          : { ...shown, applications: [created, ...shown.applications] } } })
    }} />
    <div className="clinician-panel">
      <StepError error={closeError} />
      <TextButton id={CLOSE} onClick={() => void closePage()} disabled={busy !== null || applyWorking}>{busy === 'close' ? 'Closing…' : 'Close this page'}</TextButton>
    </div>
    {withdrawing && <WithdrawDialog view={withdrawing} busy={busy === 'withdraw'} error={withdrawError}
      onConfirm={() => void confirmWithdraw()} onCancel={() => setWithdrawing(null)} />}
  </ClinicianFrame>
}

function ApplicationCard({ view, stage, onSetUp, onWithdraw }: {
  view: ClinicianApplicationView; stage: ClinicianAccountView['stage']; onSetUp(): void; onWithdraw(): void
}) {
  const titleId = `clinician-application-${view.applicationId}`
  const open = OPEN_STATES.has(view.state)
  const decided = formatDate(view.decidedAt)
  const active = view.state === 'approved' && view.accessState === 'active'
  return <article className="clinician-application" aria-labelledby={titleId}>
    <h2 id={titleId}>{view.facility.name}</h2>
    <span className={active ? 'patient-status-tag patient-status-tag-ok' : 'patient-status-tag'}>{STATE_LABEL[view.state] ?? view.state}</span>
    <dl className="clinician-facts">
      <dt>Profession</dt><dd>{PROFESSION_NAME[view.profession] ?? view.profession}</dd>
      <dt>Regulator</dt><dd>{REGULATOR_NAME[view.regulator.code] ?? view.regulator.name}</dd>
      <dt>Licence number</dt><dd>ending {view.licenceNumberHint}</dd>
      {formatDate(view.submittedAt) && <><dt>Submitted</dt><dd>{formatDate(view.submittedAt)}</dd></>}
      {open && formatDate(view.expiresAt) && <><dt>Open until</dt><dd>{formatDate(view.expiresAt)}</dd></>}
      {!open && decided && <><dt>Decided</dt><dd>{decided}</dd></>}
    </dl>
    {stateCopy(view).map(text => <p key={text}>{text}</p>)}
    <div className="clinician-actions">
      {view.state === 'awaiting_authenticator' && stage === 'enrolment_required' &&
        <PrimaryButton onClick={onSetUp}>Set up authenticator</PrimaryButton>}
      {active && <Link className="patient-primary-button" to="/provider/sign-in">Sign in to the provider portal</Link>}
      {view.canWithdraw && <button type="button" className="patient-secondary-button" onClick={onWithdraw}>
        Withdraw<span className="patient-visually-hidden"> application to {view.facility.name}</span></button>}
    </div>
  </article>
}

/**
 * Withdrawing, confirmed in a dialog that holds focus while open and gives it
 * back to the control that opened it. It sends the version the page shows.
 * The button pressed is only marked disabled while its request runs: a
 * browser would take focus from a disabled button and leave it outside the
 * dialog, where Tab and Escape no longer reach it.
 */
function WithdrawDialog({ view, busy, error, onConfirm, onCancel }: {
  view: ClinicianApplicationView; busy: boolean; error: { id: number; message: string } | null; onConfirm(): void; onCancel(): void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    keep.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])

  function holdFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onCancel(); return }
    if (event.key !== 'Tab' || !dialog.current) return
    const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <div className="clinician-dialog-backdrop">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="clinician-withdraw-title" aria-describedby="clinician-withdraw-copy"
      className="clinician-dialog" onKeyDown={holdFocus}>
      <h2 id="clinician-withdraw-title">Withdraw this application?</h2>
      <p id="clinician-withdraw-copy">HID will stop reviewing it. You can apply again later.</p>
      <p>Application to {view.facility.name}.</p>
      <StepError error={error} />
      <div className="clinician-actions">
        <button type="button" className="patient-danger-button" onClick={onConfirm} aria-disabled={busy || undefined}>
          {busy ? 'Withdrawing…' : 'Withdraw application'}</button>
        <button ref={keep} type="button" className="patient-secondary-button" onClick={onCancel} disabled={busy}>Keep application</button>
      </div>
    </div>
  </div>
}

const SEND = 'clinician-apply-send'
const APPLY_OPEN = 'clinician-apply-open'

/** Applying to another facility (P14), with the sign-up's details and declarations; the account's name is already known. */
function ApplyAnother({ account, onApplied, takeOver, onWorking }: {
  account: ClinicianAccountView; onApplied(created: ClinicianApplicationView, facility: string): Promise<void>
  takeOver(caught: unknown): boolean
  /** Whether a request of this form (sending, or a facility search) is running. */
  onWorking(working: boolean): void
}) {
  const [applying, setApplying] = useState(false)
  const [details, setDetails] = useState<DetailsValue>(EMPTY_DETAILS)
  const [accurate, setAccurate] = useState(false)
  const [consent, setConsent] = useState(false)
  const [problems, setProblems] = useState<Problem[]>([])
  const [summaryKey, setSummaryKey] = useState(0)
  const [error, setError] = useState<{ id: number; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  useEffect(() => { onWorking(busy || searching) }, [busy, searching, onWorking])
  useEffect(() => () => onWorking(false), [onWorking])
  const submission = useRef<{ key: string; fingerprint: string } | null>(null)
  // Where focus goes after a refusal that keeps the form: its button was disabled while busy.
  const [focusRequest, setFocusRequest] = useState<{ id: string; count: number } | null>(null)
  useEffect(() => { if (focusRequest) document.getElementById(focusRequest.id)?.focus() }, [focusRequest])
  const focusOn = (id: string) => setFocusRequest(previous => ({ id, count: (previous?.count ?? 0) + 1 }))

  if (!account.canApply) {
    const refusal = account.applyRefusal
    const note = refusal === 'CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED' ? 'Set up your authenticator before applying to another facility.'
      : refusal && Object.hasOwn(APPLY_REFUSAL, refusal) ? APPLY_REFUSAL[refusal] : null
    return note ? <p className="patient-field-hint clinician-panel">{note}</p> : null
  }

  if (!applying) {
    return <div className="clinician-panel">
      <PrimaryButton id={APPLY_OPEN} onClick={() => setApplying(true)}>Apply to another facility</PrimaryButton>
    </div>
  }

  function keyFor(input: ClinicianApplicationDetails): string {
    const fingerprint = JSON.stringify(input)
    if (submission.current?.fingerprint !== fingerprint) submission.current = { key: newClinicianIdempotencyKey(), fingerprint }
    return submission.current.key
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const refused = [...detailsProblems(details), ...declarationProblems(accurate, consent)]
    if (refused.length > 0) { setProblems(refused); setSummaryKey(value => value + 1); return }
    const input = applicationDetails(details)
    const key = keyFor(input)
    setBusy(true)
    setError(null)
    setProblems([])
    try {
      const { replayed: _replayed, ...created } = await clinicianApplicationApi.apply(input, key)
      submission.current = null
      setApplying(false)
      setDetails(EMPTY_DETAILS)
      setAccurate(false)
      setConsent(false)
      await onApplied(created, created.facility?.name ?? details.facility?.name ?? 'the facility')
    } catch (caught) {
      if (takeOver(caught)) return
      const code = codeOf(caught)
      if (code === 'CLINICIAN_APPLICATION_FACILITY_UNAVAILABLE') {
        setDetails(value => ({ ...value, facility: null }))
        setError(shownError(FACILITY_UNAVAILABLE))
        focusOn(FIELD.facility)
      } else if (code === 'IDEMPOTENCY_CONFLICT') {
        submission.current = null
        setError(shownError('Your details changed since your last attempt. Send the application again.'))
        focusOn(SEND)
      } else if (code === 'CLINICIAN_APPLICATION_INVALID' || code === 'VALIDATION_FAILED') {
        setError(shownError("Some details weren't accepted. Check that your licence number is as on your licence and that the licence "
          + 'is valid after today and for at most five more years.'))
        focusOn(FIELD.licenceNumber)
      } else {
        setError(shownError(refusalCopy(caught, "We couldn't send your application right now. Your details are still here; try again.",
          'Too many applications were sent from your network. Try again later.')))
        focusOn(SEND)
      }
    } finally {
      setBusy(false)
    }
  }

  const regulator = details.profession ? REGULATOR_NAME[CLINICIAN_REGULATOR_OF[details.profession]] : 'your regulator'
  return <form className="patient-form" aria-labelledby="clinician-apply-title" aria-busy={busy} noValidate onSubmit={event => void send(event)}>
    <StepHeading id="clinician-apply-title" focus>Apply to another facility</StepHeading>
    <p className="patient-field-hint">All fields are required. Give them exactly as they are on your practising licence. Two HID
      administrators review each application.</p>
    <StepError error={error} />
    <ErrorSummary problems={problems} focusKey={summaryKey} />
    <DetailsFields value={details} onChange={setDetails} problems={problems} onSearchRefused={takeOver} onSearching={setSearching} />
    <Declarations accurate={accurate} consent={consent} onAccurate={setAccurate} onConsent={setConsent} regulator={regulator}
      facility={details.facility?.name ?? 'the facility'} problems={problems} />
    <div className="clinician-actions">
      <button id={SEND} type="submit" className="patient-primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send application'}</button>
      <TextButton onClick={() => { setApplying(false); focusOn(APPLY_OPEN) }} disabled={busy}>Cancel</TextButton>
    </div>
  </form>
}
