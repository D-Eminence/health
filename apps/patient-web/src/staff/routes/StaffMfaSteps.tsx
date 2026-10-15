import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { isHidApiError } from '@hid/http'
import { Field, Input } from '@hid/ui'
import type { StaffEnrollmentCodeSent, StaffLoginChallenge, StaffMfaActivation, StaffMfaEnrollment, StaffSession } from '../api'
import { problemProps, problemText, refusal, type FieldProblem } from '../fieldProblem'
import { focusLost } from '../../pageFocus'
import { OtpauthQr } from '../../mfa/OtpauthQr'
import { RecoveryCodes, type RecoveryCodesButton } from '../../mfa/RecoveryCodes'
import { SIX_DIGIT_CODE_FIELD, formatSetupKey, isRecoveryCode, isSixDigitCode, sixDigitCode } from '../../mfa/codes'
import '../../mfa/mfa.css'

/**
 * The second step of staff sign-in (hid-system #71, ADR-054, 0088), after the
 * password step or provider enrollment activation opened a challenge: an
 * authenticator code or one recovery code, or, on a first sign-in, the code
 * emailed to the account's address (sent only when asked), the new
 * authenticator's setup and its first code, and the recovery codes, shown once.
 * Each step is Identity's decision; none is skipped or inferred here. The
 * challenge is an httpOnly cookie the browser sends; the codes typed, the setup
 * secret and the recovery codes live only in these steps' state.
 */

/** Said at the password step too: the account's authenticator verifies platform sign-in only. */
export const STAFF_MFA_FACTOR_UNPROVEN = 'Your authenticator was set up at platform sign-in, so it cannot be used for staff sign-in. '
  + 'Two platform administrators must reset it (one requests the reset, another approves it); then sign in here to set it up again.'
/** Said at the password step too: Identity has no key to protect authenticator secrets with (503 MFA_UNAVAILABLE). */
export const STAFF_MFA_UNAVAILABLE = 'Staff sign-in with an authenticator is temporarily unavailable. '
  + 'Try again later, or contact your administrator if this continues.'
const CHALLENGE_SPENT = 'This sign-in step expired or ran out of attempts. Sign in again.'

type StepName = 'verify' | 'recovery' | 'send' | 'email-code' | 'start' | 'activate'

/** Identity counts each wrong code against the challenge (five attempts) and the account's budget. */
const INVALID_CODE: Record<StepName, string> = {
  verify: 'That code was not accepted. Each code works once: wait for the next code in your authenticator app, then try again.',
  recovery: 'That recovery code was not accepted. Each recovery code works once: check it, or use another.',
  'email-code': 'That code was not accepted. Check the latest email from Health ID (each new code replaces the one before), then try again.',
  activate: 'That code was not accepted. Check that you added the setup key shown here, then enter the next code the app shows.',
  send: 'That was not accepted. Try again.',
  start: 'That was not accepted. Try again.',
}

/**
 * The account's budgets (mfa.service.ts): its fifth failed code in 15 minutes,
 * staff and platform together, refuses every code, a correct one too; sends
 * and setup starts are five each per 15 minutes.
 */
const RATE_LIMITED: Record<StepName, string> = {
  verify: 'Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.',
  recovery: 'Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.',
  activate: 'Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.',
  'email-code': 'Too many attempts. Wait up to 15 minutes, then try again.',
  send: 'Too many codes were asked for. You can ask for up to 5 in 15 minutes; try again later.',
  start: 'Setup was started too many times. Wait up to 15 minutes, then try again.',
}

/** What a refused step means for the steps, and what is said. */
type Refusal =
  /** The challenge is spent, expired or superseded, or the factor cannot verify staff sign-in: a new one is needed. */
  | { then: 'restart'; message: string }
  /** The enrolment needs its emailed proof first. */
  | { then: 'email'; message: string }
  /** The enrolment's proof is already verified: setup starts with no code. */
  | { then: 'proven' }
  /** The account has no email address to prove: the enrolment cannot go on here. */
  | { then: 'no-email'; message: string }
  /** The step stays. `field`: the code typed was refused, and is cleared. */
  | { then: 'stay'; message: string; field: boolean }

/** Identity's refusals of the second steps (INTERFACE_CONTRACT.md, staff sign-in with an authenticator). */
function refusalOf(caught: unknown, step: StepName): Refusal {
  if (!isHidApiError(caught)) return { then: 'stay', field: false, message: caught instanceof Error ? caught.message : 'This step could not be completed. Try again.' }
  switch (caught.code) {
    case 'MFA_CHALLENGE_INVALID': return { then: 'restart', message: CHALLENGE_SPENT }
    case 'STAFF_MFA_FACTOR_UNPROVEN': return { then: 'restart', message: STAFF_MFA_FACTOR_UNPROVEN }
    case 'MFA_ENROLLMENT_PROOF_REQUIRED': return { then: 'email', message: 'Confirm it is you first: ask for a code by email, then enter it.' }
    case 'MFA_ENROLLMENT_PROOF_COMPLETE': return { then: 'proven' }
    case 'MFA_ENROLLMENT_PROOF_UNAVAILABLE': return { then: 'no-email', message: 'There is no work email address on this account to send a code '
      + 'to, so an authenticator cannot be set up here. Contact your facility administrator.' }
    case 'MFA_INVALID_CODE': return { then: 'stay', field: true, message: INVALID_CODE[step] }
    case 'MFA_CODE_REQUIRED': return { then: 'stay', field: true, message: 'Enter either an authenticator code or a recovery code.' }
    case 'MFA_RATE_LIMITED': return { then: 'stay', field: false, message: RATE_LIMITED[step] }
    // A 503 ends nothing: the challenge may still hold, and the step can be sent again.
    case 'MFA_UNAVAILABLE': return { then: 'stay', field: false, message: STAFF_MFA_UNAVAILABLE }
    case 'MFA_ENROLLMENT_CODE_UNDELIVERABLE': return { then: 'stay', field: false, message: 'The code could not be sent to your work email. '
      + 'Try again in a few minutes; if this continues, contact your administrator.' }
  }
  return { then: 'stay', field: caught.status === 400, message: caught.message }
}

/** The calls the steps make: the sign-in page's are the provider's, provider enrollment's the staff API's. */
export interface StaffMfaCalls {
  verify(proof: { code: string } | { recoveryCode: string }): Promise<StaffSession>
  sendEnrollmentCode(): Promise<StaffEnrollmentCodeSent>
  startEnrollment(emailCode?: string): Promise<StaffMfaEnrollment>
  activate(code: string): Promise<StaffMfaActivation>
}

/** How the page around the steps draws them: its heading level, text classes and button. */
export interface StaffMfaLook {
  /** h1 where the steps are the page's content, h2 under the page's own h1. */
  headingAs: 'h1' | 'h2'
  classNames: { step: string; note: string; error: string; status: string }
  /** `primary` marks the step's main action; the others are secondary. */
  Button: RecoveryCodesButton
}

export interface StaffMfaStepsProps {
  challenge: StaffLoginChallenge
  /** 'activation': provider enrollment activation opened the enrolment and is its proof, so no code is emailed. */
  proof?: 'activation'
  calls: StaffMfaCalls
  look: StaffMfaLook
  /** The recovery codes' button, named for what opens next. */
  doneLabel: string
  /** Opens the session verify or activation answered with (the recovery codes left out). */
  onSignedIn(session: StaffSession): void
  /** The challenge cannot go on: back to the step that opens one, saying why (null when the person chose to). */
  onRestart(message: string | null): void
  /** The control that goes back by choice; none where the page has no step to go back to. */
  restartLabel?: string
}

type Step =
  | { kind: 'verify' }
  /** `proven`: whether, and how, the enrolment's proof is verified; `noEmail`: it cannot be. */
  | { kind: 'enrol'; proven: false | 'activation' | 'email'; noEmail?: boolean }
  | { kind: 'email-code'; expiresAt: string }
  | { kind: 'setup'; enrollment: StaffMfaEnrollment }
  | { kind: 'recovery-codes'; activation: StaffMfaActivation }

export function StaffMfaSteps({ challenge, proof, calls, look, doneLabel, onSignedIn, onRestart, restartLabel }: StaffMfaStepsProps) {
  const [step, setStep] = useState<Step>(() => challenge.status === 'mfa_required' ? { kind: 'verify' }
    : { kind: 'enrol', proven: proof === 'activation' ? 'activation' : false })
  // Each step shown is new, takes focus at its heading, and says the refusal that led to it.
  const [shown, setShown] = useState({ count: 0, carried: null as string | null })

  function go(next: Step, carried: string | null = null) {
    setStep(next)
    setShown(previous => ({ count: previous.count + 1, carried }))
  }

  function moved(refused: Exclude<Refusal, { then: 'stay' }>) {
    if (refused.then === 'restart') onRestart(refused.message)
    else if (refused.then === 'email') go({ kind: 'enrol', proven: false }, refused.message)
    else if (refused.then === 'proven') go({ kind: 'enrol', proven: 'email' })
    else go({ kind: 'enrol', proven: false, noEmail: true }, refused.message)
  }

  const restart = restartLabel ? { label: restartLabel, onRestart: () => onRestart(null) } : null
  const common = { look, carried: shown.carried, onMoved: moved, restart }

  if (step.kind === 'verify') {
    return <VerifyStep key={shown.count} {...common} expiresAt={challenge.expiresAt} verify={calls.verify} onVerified={onSignedIn} />
  }
  if (step.kind === 'enrol') {
    return <EnrolStep key={shown.count} {...common} proven={step.proven} noEmail={step.noEmail === true} expiresAt={challenge.expiresAt}
      calls={calls} onSent={sent => go({ kind: 'email-code', expiresAt: sent.expiresAt })}
      onStarted={enrollment => go({ kind: 'setup', enrollment })} />
  }
  if (step.kind === 'email-code') {
    return <EmailCodeStep key={shown.count} {...common} expiresAt={step.expiresAt} calls={calls}
      onStarted={enrollment => go({ kind: 'setup', enrollment })} />
  }
  if (step.kind === 'setup') {
    // The setup secret leaves the steps' state with this step: the recovery codes replace it.
    return <SetupStep key={shown.count} {...common} enrollment={step.enrollment} activate={calls.activate}
      onActivated={activation => go({ kind: 'recovery-codes', activation })} />
  }
  return <RecoveryStep key={shown.count} look={look} activation={step.activation} doneLabel={doneLabel} onDone={onSignedIn} />
}

interface StepProps {
  look: StaffMfaLook
  /** The refusal that led to this step, said as it opens. */
  carried: string | null
  onMoved(refused: Exclude<Refusal, { then: 'stay' }>): void
  restart: { label: string; onRestart(): void } | null
}

/** Back to the step that opens a challenge, by choice; not while a step is on its way, whose answer would then come to nothing. */
function Restart({ look, restart, pending }: { look: StaffMfaLook; restart: StepProps['restart']; pending: boolean }) {
  return restart ? <look.Button onClick={restart.onRestart} disabled={pending}>{restart.label}</look.Button> : null
}

/** A step's heading, which takes focus as the step opens: the step before it, and the control used there, are gone. */
function useStepHeading(): RefObject<HTMLHeadingElement | null> {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return heading
}

function StepHeading({ look, heading, id, children }: { look: StaffMfaLook; heading: RefObject<HTMLHeadingElement | null>; id: string; children: ReactNode }) {
  const Heading = look.headingAs
  return <Heading id={id} ref={heading} tabIndex={-1} className="hid-mfa-heading">{children}</Heading>
}

/**
 * A step's own refusals. One about the code typed is shown at its field
 * (PEHR-04): focus moves there, so its description says why, or, refused from
 * Enter in the field itself, it is an alert. Any other is an alert, and focus
 * lost while the step was sent goes back to the step's control.
 */
function useStepProblems(carried: string | null) {
  const [error, setError] = useState<string | null>(carried)
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; always: boolean } | null>(null)
  useEffect(() => {
    if (!focusRequest) return
    if (focusRequest.always || focusLost()) document.getElementById(focusRequest.id)?.focus()
  }, [focusRequest])
  return {
    error,
    problem,
    clear: useCallback(() => { setError(null); setProblem(null) }, []),
    /** Shows a refusal the step stays on; `control` is the id of its field, or of its main button. */
    show(refused: { message: string; field: boolean }, control: string) {
      if (refused.field) {
        const shown = refusal({ field: control, message: refused.message })
        setProblem(shown)
        if (!shown.alert) setFocusRequest({ id: control, always: true })
      } else {
        setError(refused.message)
        setFocusRequest({ id: control, always: false })
      }
    },
    /** Focus to `control` once the render showing it has committed (a field the step now shows). */
    focus: (control: string) => setFocusRequest({ id: control, always: true }),
  }
}

/** A step's deadline as this device's clock shows it; nothing for a time Identity did not give. */
function clockTime(expiresAt: string): string | null {
  const time = new Date(expiresAt)
  return Number.isNaN(time.getTime()) ? null : time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Deadline({ look, expiresAt, lead }: { look: StaffMfaLook; expiresAt: string; lead: string }) {
  const time = clockTime(expiresAt)
  return time ? <p className={look.classNames.note}>{lead} {time}.</p> : null
}

function StepError({ look, error }: { look: StaffMfaLook; error: string | null }) {
  return error ? <p role="alert" className={look.classNames.error}>{error}</p> : null
}

function VerifyStep({ look, carried, onMoved, restart, expiresAt, verify, onVerified }: StepProps & {
  expiresAt: string; verify: StaffMfaCalls['verify']; onVerified(session: StaffSession): void
}) {
  const heading = useStepHeading()
  const problems = useStepProblems(carried)
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [pending, setPending] = useState(false)
  const control = mode === 'totp' ? 'staff-mfa-code' : 'staff-mfa-recovery-code'
  const valid = mode === 'totp' ? isSixDigitCode(code) : isRecoveryCode(recoveryCode)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !valid) return
    setPending(true)
    problems.clear()
    let session: StaffSession
    try { session = await verify(mode === 'totp' ? { code } : { recoveryCode: recoveryCode.trim() }) }
    catch (caught) {
      setPending(false)
      const refused = refusalOf(caught, mode === 'totp' ? 'verify' : 'recovery')
      if (refused.then !== 'stay') { onMoved(refused); return }
      if (refused.field) { setCode(''); setRecoveryCode('') }
      problems.show(refused, control)
      return
    }
    onVerified(session)
  }

  function switchMode() {
    const next = mode === 'totp' ? 'recovery' : 'totp'
    setMode(next)
    problems.clear()
    problems.focus(next === 'totp' ? 'staff-mfa-code' : 'staff-mfa-recovery-code')
  }

  return <form className={look.classNames.step} onSubmit={event => void submit(event)} aria-labelledby="staff-mfa-verify-title">
    <StepHeading look={look} heading={heading} id="staff-mfa-verify-title">Verify it’s you</StepHeading>
    {mode === 'totp' ? <>
      <p>Enter the 6-digit code from your authenticator app.</p>
      <Field label="Authenticator code" htmlFor="staff-mfa-code" error={problemText(problems.problem, 'staff-mfa-code')} required>
        <Input id="staff-mfa-code" value={code} onChange={event => setCode(sixDigitCode(event.target.value))} {...SIX_DIGIT_CODE_FIELD} required
          {...problemProps(problems.problem, 'staff-mfa-code')} /></Field>
    </> : <>
      <p>Enter one of your recovery codes. Each recovery code works once.</p>
      <Field label="Recovery code" htmlFor="staff-mfa-recovery-code" error={problemText(problems.problem, 'staff-mfa-recovery-code')} required>
        <Input id="staff-mfa-recovery-code" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} autoComplete="off"
          spellCheck={false} maxLength={16} required {...problemProps(problems.problem, 'staff-mfa-recovery-code')} /></Field>
    </>}
    <Deadline look={look} expiresAt={expiresAt} lead="This step expires at" />
    <StepError look={look} error={problems.error} />
    <look.Button primary type="submit" disabled={pending || !valid}>{pending ? 'Verifying…' : 'Verify'}</look.Button>
    <div className="hid-mfa-links">
      <look.Button onClick={switchMode} disabled={pending}>{mode === 'totp' ? 'Use a recovery code instead' : 'Use my authenticator app instead'}</look.Button>
      <Restart look={look} restart={restart} pending={pending} />
    </div>
    <p className={look.classNames.note}>Lost your authenticator and your recovery codes? Two platform administrators must reset your
      authenticator (one requests the reset, another approves it). Then sign in again to set up a new one.</p>
  </form>
}

function EnrolStep({ look, carried, onMoved, restart, proven, noEmail, expiresAt, calls, onSent, onStarted }: StepProps & {
  proven: false | 'activation' | 'email'; noEmail: boolean; expiresAt: string; calls: StaffMfaCalls
  onSent(sent: StaffEnrollmentCodeSent): void; onStarted(enrollment: StaffMfaEnrollment): void
}) {
  const heading = useStepHeading()
  const problems = useStepProblems(carried)
  const [pending, setPending] = useState(false)

  // Each press sends one code, or starts one setup: both count against the account's budget.
  async function act() {
    if (pending) return
    setPending(true)
    problems.clear()
    try {
      if (proven) onStarted(await calls.startEnrollment())
      else onSent(await calls.sendEnrollmentCode())
    } catch (caught) {
      setPending(false)
      const refused = refusalOf(caught, proven ? 'start' : 'send')
      // The step has no field: whatever was refused is said as an alert.
      if (refused.then !== 'stay') onMoved(refused)
      else problems.show({ ...refused, field: false }, 'staff-mfa-enrol-action')
    }
  }

  return <section className={look.classNames.step} aria-labelledby="staff-mfa-enrol-title">
    <StepHeading look={look} heading={heading} id="staff-mfa-enrol-title">Set up an authenticator app</StepHeading>
    {proven === 'activation' ? <p>Your provider account is active. Health ID asks for a code from an authenticator app each time staff sign
      in: set one up now to open the Provider Portal.</p>
      : proven === 'email' ? <p>Your work email address is confirmed for this setup. Continue to add Health ID to your authenticator app.</p>
        : <p>Health ID now asks for a code from an authenticator app each time staff sign in, and this account has none yet. To set one up,
          first confirm it is you with a code sent to the work email address on your account.</p>}
    {!proven && !noEmail && <p className={look.classNames.note}>You can ask for up to 5 codes in 15 minutes.</p>}
    <Deadline look={look} expiresAt={expiresAt} lead="Finish setting up by" />
    <StepError look={look} error={problems.error} />
    {!noEmail && <look.Button primary id="staff-mfa-enrol-action" onClick={() => void act()} disabled={pending}>
      {proven ? (pending ? 'Preparing…' : 'Begin setup') : (pending ? 'Sending…' : 'Email me a code')}</look.Button>}
    {restart && <div className="hid-mfa-links"><Restart look={look} restart={restart} pending={pending} /></div>}
  </section>
}

function EmailCodeStep({ look, carried, onMoved, restart, expiresAt, calls, onStarted }: StepProps & {
  expiresAt: string; calls: StaffMfaCalls; onStarted(enrollment: StaffMfaEnrollment): void
}) {
  const heading = useStepHeading()
  const problems = useStepProblems(carried)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<'check' | 'send' | null>(null)
  const [deadline, setDeadline] = useState(expiresAt)
  // Each new code sent, so each is announced.
  const [sent, setSent] = useState(0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !isSixDigitCode(code)) return
    setPending('check')
    problems.clear()
    try { onStarted(await calls.startEnrollment(code)) }
    catch (caught) {
      setPending(null)
      const refused = refusalOf(caught, 'email-code')
      if (refused.then !== 'stay') { onMoved(refused); return }
      if (refused.field) setCode('')
      problems.show(refused, 'staff-mfa-email-code')
    }
  }

  async function sendAgain() {
    if (pending) return
    setPending('send')
    problems.clear()
    try {
      const again = await calls.sendEnrollmentCode()
      setDeadline(again.expiresAt)
      setCode('')
      setSent(value => value + 1)
      setPending(null)
    } catch (caught) {
      setPending(null)
      const refused = refusalOf(caught, 'send')
      // A refused send is not about the code typed.
      if (refused.then !== 'stay') onMoved(refused)
      else problems.show({ ...refused, field: false }, 'staff-mfa-email-code')
    }
  }

  return <form className={look.classNames.step} onSubmit={event => void submit(event)} aria-labelledby="staff-mfa-email-title">
    <StepHeading look={look} heading={heading} id="staff-mfa-email-title">Enter the code we emailed you</StepHeading>
    <p>We sent a 6-digit code to the work email address on your account. Each new code replaces the one before.</p>
    <Field label="Email code" htmlFor="staff-mfa-email-code" error={problemText(problems.problem, 'staff-mfa-email-code')} required>
      <Input id="staff-mfa-email-code" value={code} onChange={event => setCode(sixDigitCode(event.target.value))} {...SIX_DIGIT_CODE_FIELD} required
        {...problemProps(problems.problem, 'staff-mfa-email-code')} /></Field>
    <Deadline look={look} expiresAt={deadline} lead="Finish setting up by" />
    <StepError look={look} error={problems.error} />
    <look.Button primary type="submit" disabled={pending !== null || !isSixDigitCode(code)}>{pending === 'check' ? 'Checking…' : 'Continue'}</look.Button>
    {/* Mounted throughout, so each new code is announced. */}
    <p role="status" className={look.classNames.status}>{sent > 0 && <span key={sent}>A new code was sent.</span>}</p>
    <div className="hid-mfa-links">
      <look.Button onClick={() => void sendAgain()} disabled={pending !== null}>{pending === 'send' ? 'Sending…' : 'Send a new code'}</look.Button>
      <Restart look={look} restart={restart} pending={pending !== null} />
    </div>
    <p className={look.classNames.note}>You can ask for up to 5 codes in 15 minutes.</p>
  </form>
}

function SetupStep({ look, carried, onMoved, restart, enrollment, activate, onActivated }: StepProps & {
  enrollment: StaffMfaEnrollment; activate: StaffMfaCalls['activate']; onActivated(activation: StaffMfaActivation): void
}) {
  const heading = useStepHeading()
  const problems = useStepProblems(carried)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !isSixDigitCode(code)) return
    setPending(true)
    problems.clear()
    try { onActivated(await activate(code)) }
    catch (caught) {
      setPending(false)
      const refused = refusalOf(caught, 'activate')
      if (refused.then !== 'stay') { onMoved(refused); return }
      if (refused.field) setCode('')
      problems.show(refused, 'staff-mfa-activation-code')
    }
  }

  return <form className={look.classNames.step} onSubmit={event => void submit(event)} aria-labelledby="staff-mfa-setup-title">
    <StepHeading look={look} heading={heading} id="staff-mfa-setup-title">Add Health ID to your authenticator app</StepHeading>
    <ol className="hid-mfa-setup">
      <li>In your authenticator app, add an account and scan this QR code.
        <OtpauthQr uri={enrollment.otpauthUri} className="hid-mfa-qr" /></li>
      <li>Cannot scan it? Enter this setup key instead. On a phone with the app installed you can
        instead <a href={enrollment.otpauthUri}>open it in your authenticator app</a>.
        <code className="hid-mfa-key">{formatSetupKey(enrollment.secret)}</code>
        <small>Time-based · {enrollment.algorithm} · {enrollment.digits} digits · every {enrollment.periodSeconds} seconds. The key is
          shown only during this setup.</small></li>
      <li>Enter the 6-digit code the app now shows.</li>
    </ol>
    <Field label="Authenticator code" htmlFor="staff-mfa-activation-code" error={problemText(problems.problem, 'staff-mfa-activation-code')} required>
      <Input id="staff-mfa-activation-code" value={code} onChange={event => setCode(sixDigitCode(event.target.value))} {...SIX_DIGIT_CODE_FIELD}
        required {...problemProps(problems.problem, 'staff-mfa-activation-code')} /></Field>
    <Deadline look={look} expiresAt={enrollment.expiresAt} lead="Finish setting up by" />
    <StepError look={look} error={problems.error} />
    <look.Button primary type="submit" disabled={pending || !isSixDigitCode(code)}>{pending ? 'Activating…' : 'Activate authenticator'}</look.Button>
    {restart && <div className="hid-mfa-links"><Restart look={look} restart={restart} pending={pending} /></div>}
  </form>
}

/**
 * The recovery codes activation answered with, once. The session is already the
 * browser's; it opens when the person says the codes are stored, without them.
 */
function RecoveryStep({ look, activation, doneLabel, onDone }: {
  look: StaffMfaLook; activation: StaffMfaActivation; doneLabel: string; onDone(session: StaffSession): void
}) {
  const heading = useStepHeading()
  const done = useRef(false)
  function finish() {
    if (done.current) return
    done.current = true
    const { recoveryCodes: _shown, ...session } = activation
    onDone(session)
  }
  return <RecoveryCodes codes={activation.recoveryCodes} onDone={finish} doneLabel={doneLabel}
    limits="Health ID cannot show them again. Once they are used up, a lost authenticator must be reset by two platform administrators."
    fileName="hid-provider-recovery-codes.txt" headingId="staff-mfa-recovery-title" headingAs={look.headingAs} headingRef={heading}
    classNames={{ root: `${look.classNames.step} hid-mfa-recovery`, list: 'hid-mfa-codes', actions: 'hid-mfa-links', success: look.classNames.status,
      error: look.classNames.error, checkbox: 'hid-mfa-checkbox' }} Button={look.Button} />
}
