import '@hid/ui/ehr.css'
import './signup.css'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { useDocumentTitle } from '../../authSteps'
import {
  hospitalSignUpHref, OUTREACH_TERMS_PATH, outreachSignUpHere, outreachSignUpHref, resolveStaffProductHostname, STAFF_SIGN_IN_PATH,
  staffSignInHref,
} from '../../productHostname'
import { outreachOrganiserApi } from '../../staff/api'
import { Turnstile } from '../../Turnstile'
import { ORGANISER_TERMS_SUMMARY, ORGANISER_TERMS_VERSION } from '../../outreachTerms'
import { EMAIL_HAS_LOGIN, isOutreachProblem, outreachProblemText, SIGNUP_CLOSED, signupClosed, TERMS_CHANGED } from '../../outreachProblems'
import { EMAIL, groupDetailsProblems, NAME } from '../../outreachGroupDetails'
import { PasswordField } from './PasswordField'
import { Required, ScreenHeading } from './parts'
import { SignupShell } from './SignupShell'

/** The steps, as the progress line names them. */
const STEPS = ['Your details', 'Check your email', 'Organiser terms', 'Set a password'] as const
type Stage = 'checking' | 'closed' | 'terms-changed' | 0 | 1 | 2 | 3 | 'done'

const FALLBACK = 'Something went wrong. Please try again.'
/**
 * "Start running outreach" (open sign-up on outreach., owner decisions of 11 November 2026): a volunteer, NGO or
 * community group signs up with the organiser's name, email and phone and the group's name, proves the email with a
 * 6-digit code, accepts the organiser terms and sets a password. Activation creates the group's own private Outreach
 * space and signs the organiser in. It fails safe: unless Identity says sign-up is open, the page says it isn't open
 * yet and offers nothing to send, and a 423 at any step says the same.
 */
export function OutreachOrganiserSignUp() {
  useDocumentTitle('Start running outreach · Health ID Outreach')
  const hostname = window.location.hostname
  // Another product site: the sign-up is outreach.'s (Turnstile accepts it there only).
  const elsewhere = resolveStaffProductHostname(hostname) !== null && !outreachSignUpHere(hostname)
  return (
    <SignupShell centered={elsewhere} footer={<OutreachFooter />} story={{ eyebrow: 'Health ID — Outreach',
      title: <>Register people in the field.<br />Safely, from day one.</>,
      text: 'Your group’s own private space for outreach events. Free for now.' }}>
      {elsewhere ? <OpenOnOutreach href={outreachSignUpHref(hostname)} /> : <SignUpSteps />}
    </SignupShell>
  )
}

function OutreachFooter() {
  return <p>Starting an outreach group sets up your group’s own private Outreach space and the organiser’s login. Health
    ID does not check your group, so the people you register are told you are an unverified organiser.</p>
}

function OpenOnOutreach({ href }: { readonly href: string }) {
  return <>
    <ScreenHeading id="outreach-signup-elsewhere">Start running outreach</ScreenHeading>
    <p className="hid-ehr-signup-intro">Outreach groups sign up on Health ID Outreach.</p>
    <a className="hid-ehr-button hid-ehr-signup-wide" href={href}>Continue to Health ID Outreach</a>
  </>
}

/** A link to this site's own page, or to another site's. */
function PageLink({ href, className, children }: { readonly href: string; readonly className?: string; readonly children: ReactNode }) {
  return href.startsWith('/') ? <Link className={className} to={href}>{children}</Link> : <a className={className} href={href}>{children}</a>
}

function SignInLink({ children }: { readonly children: ReactNode }) {
  return <PageLink className="hid-ehr-signup-link" href={staffSignInHref(window.location.hostname) ?? STAFF_SIGN_IN_PATH}>{children}</PageLink>
}

function SignUpSteps() {
  const [stage, setStage] = useState<Stage>('checking')
  const [error, setError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState({ organiserName: '', email: '', phone: '', groupName: '', kind: 'group' as 'individual' | 'group', registrationNumber: '' })
  const [problems, setProblems] = useState<Partial<Record<string, string>>>({})
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const stepHeading = useRef<HTMLHeadingElement>(null)

  // Fails safe: the form shows only once Identity says sign-up is open. A closed, unknown or failed answer shows nothing to send.
  useEffect(() => {
    const controller = new AbortController()
    outreachOrganiserApi.availability(controller.signal).then(answer => {
      if (controller.signal.aborted) return
      if (answer?.open !== true) setStage('closed')
      // The page accepts only the terms whose text it shows: newer terms at Identity need this page reloaded first.
      else if (typeof answer.termsVersion === 'string' && answer.termsVersion && answer.termsVersion !== ORGANISER_TERMS_VERSION) setStage('terms-changed')
      else setStage(0)
    }, () => { if (!controller.signal.aborted) setStage('closed') })
    return () => controller.abort()
  }, [])

  useLayoutEffect(() => { if (typeof stage === 'number') stepHeading.current?.focus() }, [stage])

  /** A refusal: closed at any step ends the sign-up; an email with a login says how to start a group with it. */
  function refused(caught: unknown) {
    if (signupClosed(caught)) { setStage('closed'); return }
    if (isOutreachProblem(caught, 'OUTREACH_ORGANISER_EMAIL_REGISTERED')) {
      setError(<>{EMAIL_HAS_LOGIN} <SignInLink>Sign in</SignInLink></>)
      return
    }
    if (isOutreachProblem(caught, 'OUTREACH_ORGANISER_SIGNUP_SESSION_INVALID') || isOutreachProblem(caught, 'OUTREACH_ORGANISER_SIGNUP_EXPIRED')) {
      setStage(0)
      setCode('')
    }
    setError(outreachProblemText(caught, FALLBACK))
  }

  async function start(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const found: Record<string, string> = { ...groupDetailsProblems(details) }
    const name = details.organiserName.trim()
    if (name.length < 2) found.organiserName = 'Enter your full name.'
    else if (name.length > 120 || !NAME.test(name)) found.organiserName = 'Use letters and simple punctuation in your name.'
    if (!EMAIL.test(details.email.trim())) found.email = 'Enter an email address you can open now, like name@example.com.'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    if (!turnstileToken) { setError('Complete the security check, then continue.'); return }
    setBusy(true)
    try {
      const registration = details.registrationNumber.replace(/\s+/g, '').toUpperCase()
      const started = await outreachOrganiserApi.start({ organiserName: name, email: details.email.trim(), phone: details.phone.trim(),
        groupName: details.groupName.trim(), kind: details.kind, ...(registration ? { registrationNumber: registration } : {}),
        turnstileToken })
      setChallengeId(started.challengeId)
      setStage(1)
    } catch (caught) {
      refused(caught)
    } finally {
      setBusy(false)
      setTurnstileToken(null)
      setResetKey(key => key + 1)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (!/^[0-9]{6}$/.test(code.trim())) { setProblems({ code: 'Enter the 6-digit code from the email.' }); return }
    setProblems({})
    setBusy(true)
    try {
      await outreachOrganiserApi.verify(challengeId, code.trim())
      setStage(2)
    } catch (caught) { refused(caught) } finally { setBusy(false) }
  }

  function acceptTerms(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!accepted) { setProblems({ terms: 'Tick the box to accept the organiser terms.' }); return }
    setProblems({})
    setStage(3)
  }

  async function activate(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const found: Record<string, string> = {}
    if (password.length < 12) found.password = 'Use at least 12 characters.'
    else if (password.length > 256) found.password = 'Use at most 256 characters.'
    if (confirm !== password) found.confirm = 'The two passwords are not the same.'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      await outreachOrganiserApi.activate({ termsVersion: ORGANISER_TERMS_VERSION, password })
      setPassword('')
      setConfirm('')
      setStage('done')
    } catch (caught) {
      // Terms changed since this page was loaded: the new text needs a reload, so nothing more is sent from here.
      if (isOutreachProblem(caught, 'OUTREACH_TERMS_VERSION_INVALID')) { setAccepted(false); setPassword(''); setConfirm(''); setStage('terms-changed'); return }
      refused(caught)
    } finally { setBusy(false) }
  }

  if (stage === 'checking') return <p role="status" className="hid-ehr-signup-status">Checking that sign-up is open…</p>
  if (stage === 'closed') return <Closed />
  if (stage === 'terms-changed') return <TermsChanged />
  if (stage === 'done') return <Ready />

  const field = (key: string) => problems[key]
  const alert = error ? <p role="alert" className="hid-ehr-signup-alert">{error}</p> : null
  return (
    <>
      <p className="hid-ehr-signup-eyebrow">Health ID Outreach</p>
      <h1 className="hid-ehr-page-title hid-ehr-signup-title">Start running outreach</h1>
      <p className="hid-ehr-signup-intro">For volunteers, NGOs and community groups. Sign up, confirm your email, accept the
        organiser terms and choose a password. Your group gets its own private space straight away. It is free for now.</p>
      <p className="hid-ehr-signup-muted">Registering a hospital? <a className="hid-ehr-signup-link" href={hospitalSignUpHref(window.location.hostname)}>Use Health ID EHR</a>.
        {' '}Already have a Health ID staff login? <SignInLink>Sign in</SignInLink>, then choose “Start an outreach group”.</p>
      <ol className="hid-ehr-signup-muted" aria-label="Steps">
        {STEPS.map((label, index) => <li key={label} aria-current={stage === index ? 'step' : undefined}>
          {stage === index ? <strong>{label}</strong> : label}</li>)}
      </ol>

      {stage === 0 && <form className="hid-ehr-signup-form" noValidate onSubmit={event => void start(event)} aria-labelledby="outreach-signup-step">
        <h2 id="outreach-signup-step" ref={stepHeading} tabIndex={-1} className="hid-ehr-signup-step-title">{STEPS[0]}</h2>
        <div className="hid-ehr-signup-grid">
          <EhrField label={<Required>Your full name</Required>} controlId="outreach-signup-name" error={field('organiserName')}>
            <EhrInput required maxLength={120} autoComplete="name" value={details.organiserName}
              onChange={event => setDetails(previous => ({ ...previous, organiserName: event.target.value }))} />
          </EhrField>
          <EhrField label={<Required>Email</Required>} controlId="outreach-signup-email" error={field('email')}
            hint="We send a 6-digit code to this email. It becomes your login.">
            <EhrInput type="email" required maxLength={254} autoComplete="email" value={details.email}
              onChange={event => setDetails(previous => ({ ...previous, email: event.target.value }))} />
          </EhrField>
          <EhrField label={<Required>Phone number</Required>} controlId="outreach-signup-phone" error={field('phone')}
            hint="Health ID may call this number if there is a problem with your group.">
            <EhrInput type="tel" inputMode="tel" required maxLength={32} autoComplete="tel" value={details.phone}
              onChange={event => setDetails(previous => ({ ...previous, phone: event.target.value }))} />
          </EhrField>
          <EhrField label={<Required>Group name</Required>} controlId="outreach-signup-group" error={field('groupName')}
            hint="As people will know you, for example “Ajegunle Health Volunteers”.">
            <EhrInput required maxLength={120} autoComplete="organization" value={details.groupName}
              onChange={event => setDetails(previous => ({ ...previous, groupName: event.target.value }))} />
          </EhrField>
          <EhrField label={<Required>Who is running it</Required>} controlId="outreach-signup-kind">
            <EhrSelect required value={details.kind}
              onChange={event => setDetails(previous => ({ ...previous, kind: event.target.value as 'individual' | 'group' }))}>
              <option value="group">A group, NGO or community organisation</option>
              <option value="individual">Just me, as a volunteer</option>
            </EhrSelect>
          </EhrField>
          <EhrField label="CAC or IT number (optional)" controlId="outreach-signup-registration" error={field('registrationNumber')}
            hint="If your group is registered. You can leave this empty.">
            <EhrInput autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={22} value={details.registrationNumber}
              onChange={event => setDetails(previous => ({ ...previous, registrationNumber: event.target.value }))} />
          </EhrField>
        </div>
        {alert}
        <div className="hid-ehr-signup-actions">
          <div className="hid-ehr-signup-turnstile">
            <Turnstile action="outreach-organiser-signup" onTokenChange={setTurnstileToken} resetKey={resetKey} />
          </div>
          <EhrButton type="submit" busy={busy}>{busy ? 'Sending code…' : 'Send me a code'}</EhrButton>
        </div>
      </form>}

      {stage === 1 && <form className="hid-ehr-signup-form" noValidate onSubmit={event => void verify(event)} aria-labelledby="outreach-signup-step">
        <h2 id="outreach-signup-step" ref={stepHeading} tabIndex={-1} className="hid-ehr-signup-step-title">{STEPS[1]}</h2>
        <p className="hid-ehr-signup-muted">We sent a 6-digit code to {details.email.trim()}. It may take a minute to arrive.</p>
        <EhrField label={<Required>Code from the email</Required>} controlId="outreach-signup-code" error={field('code')}>
          <EhrInput inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
        </EhrField>
        {alert}
        <div className="hid-ehr-signup-actions">
          <EhrButton type="submit" busy={busy}>{busy ? 'Checking…' : 'Confirm email'}</EhrButton>
          <EhrButton variant="secondary" onClick={() => { setError(null); setCode(''); setStage(0) }}>Change details or get a new code</EhrButton>
        </div>
      </form>}

      {stage === 2 && <form className="hid-ehr-signup-form" noValidate onSubmit={acceptTerms} aria-labelledby="outreach-signup-step">
        <h2 id="outreach-signup-step" ref={stepHeading} tabIndex={-1} className="hid-ehr-signup-step-title">{STEPS[2]}</h2>
        <p className="hid-ehr-signup-muted">In short:</p>
        <ul className="hid-ehr-signup-muted">{ORGANISER_TERMS_SUMMARY.map(point => <li key={point}>{point}</li>)}</ul>
        <p className="hid-ehr-signup-muted"><Link className="hid-ehr-signup-link" to={OUTREACH_TERMS_PATH} target="_blank" rel="noopener">
          Read the full organiser terms</Link> (opens in a new tab).</p>
        <label className="hid-ehr-field" htmlFor="outreach-signup-terms">
          <span><input id="outreach-signup-terms" type="checkbox" checked={accepted} aria-invalid={field('terms') ? true : undefined}
            aria-describedby={field('terms') ? 'outreach-signup-terms-error' : undefined}
            onChange={event => setAccepted(event.target.checked)} /> I have read and accept the organiser terms for my group.</span>
        </label>
        {field('terms') ? <p id="outreach-signup-terms-error" className="hid-ehr-error">{field('terms')}</p> : null}
        {alert}
        <div className="hid-ehr-signup-actions"><EhrButton type="submit">Accept and continue</EhrButton></div>
      </form>}

      {stage === 3 && <form className="hid-ehr-signup-form" noValidate onSubmit={event => void activate(event)} aria-labelledby="outreach-signup-step">
        <h2 id="outreach-signup-step" ref={stepHeading} tabIndex={-1} className="hid-ehr-signup-step-title">{STEPS[3]}</h2>
        <PasswordField label={<Required>Password</Required>} controlId="outreach-signup-password" error={field('password')}
          hint="At least 12 characters. Don’t use a password you use anywhere else." autoComplete="new-password"
          value={password} onChange={event => setPassword(event.target.value)} />
        <PasswordField label={<Required>Type the password again</Required>} controlId="outreach-signup-confirm" error={field('confirm')}
          toggleLabel="Show password confirmation" autoComplete="new-password"
          value={confirm} onChange={event => setConfirm(event.target.value)} />
        {alert}
        <div className="hid-ehr-signup-actions">
          <EhrButton type="submit" busy={busy}>{busy ? 'Creating your group…' : 'Create my outreach group'}</EhrButton>
        </div>
      </form>}
    </>
  )
}

/** Sign-up is off, not served yet, or Identity could not say: nothing to send. */
function Closed() {
  return <>
    <ScreenHeading id="outreach-signup-closed">Start running outreach</ScreenHeading>
    <p className="hid-ehr-signup-intro">{SIGNUP_CLOSED}</p>
    <p className="hid-ehr-signup-muted">Already have a Health ID login? <SignInLink>Sign in</SignInLink>. Registering a
      hospital? <a className="hid-ehr-signup-link" href={hospitalSignUpHref(window.location.hostname)}>Use Health ID EHR</a>.</p>
  </>
}

/** Identity accepts newer organiser terms than this page shows: nothing is sent until the page is reloaded. */
function TermsChanged() {
  return <>
    <ScreenHeading id="outreach-signup-terms-changed">Start running outreach</ScreenHeading>
    <p role="alert" className="hid-ehr-signup-intro">{TERMS_CHANGED}</p>
    <EhrButton className="hid-ehr-signup-wide" onClick={() => window.location.reload()}>Reload the page</EhrButton>
  </>
}

/** The group is made and the organiser signed in: open the workspace, where Outreach says what to do next. */
function Ready() {
  return <>
    <ScreenHeading id="outreach-signup-ready">Your outreach group is ready</ScreenHeading>
    <p className="hid-ehr-signup-intro">You are signed in as its organiser. Create your first campaign, invite your team and
      open the campaign when your event starts.</p>
    <a className="hid-ehr-button hid-ehr-signup-wide" href="/provider/outreach">Open Outreach</a>
  </>
}
