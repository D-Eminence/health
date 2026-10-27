import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { Field, Input } from '@hid/ui'
import { OtpauthQr } from '../../mfa/OtpauthQr'
import { RecoveryCodes } from '../../mfa/RecoveryCodes'
import { SIX_DIGIT_CODE_FIELD, formatSetupKey, isRecoveryCode, isSixDigitCode, sixDigitCode } from '../../mfa/codes'
import '../../mfa/mfa.css'
import { problemProps, problemText, refusal, type FieldProblem } from '../fieldProblem'
import { clinicianApplicationApi, type ClinicianAccountView, type ClinicianActivation,
  type ClinicianAuthenticatorSetup } from '../clinicianApplicationApi'
import { ACCOUNT_INELIGIBLE, FACTOR_UNPROVEN, MAINTENANCE, STAFF_SIGN_IN_REQUIRED } from './copy'
import { PrimaryButton, StepError, StepHeading, TextButton, shownError } from './ui'

/**
 * The authenticator an applicant sets up, or verifies, before any review
 * (hid-system ADR-066, P5-P9), on the application page: no session is issued
 * and nothing here signs anyone in. The capability cookie drives a 0088
 * challenge Identity derives and never sends, so the steps are the staff
 * sign-in's (an emailed proof, the setup key, the first code and the recovery
 * codes; or a code or one recovery code) with their own words. The setup key
 * leaves this component's state when the recovery codes replace it, and the
 * recovery codes when the person continues.
 */

const EXPIRED = 'This step expired. Start it again.'
const UNAVAILABLE = "We couldn't complete this step right now. Try again in a few minutes."

type Step =
  | { kind: 'enrol' }
  | { kind: 'email-code'; expiresAt: string }
  | { kind: 'setup'; setup: ClinicianAuthenticatorSetup }
  | { kind: 'recovery'; activation: ClinicianActivation }
  | { kind: 'verify' }
  /** The challenge expired, ran out, or none was opened: P9 opens a new one. */
  | { kind: 'reopen' }
  /** Nothing more can be done here. */
  /** `signIn`: the way on is staff sign-in, where the authenticator is set up again. */
  | { kind: 'blocked'; message: string; signIn?: boolean }
  /** An activation went through but its answer, the only one with the recovery codes, never arrived. */
  | { kind: 'codes-unseen' }

type StepName = 'send' | 'email-code' | 'activate' | 'verify' | 'recovery' | 'reopen'

const INVALID_CODE: Record<StepName, string> = {
  send: UNAVAILABLE,
  'email-code': 'That code was not accepted. Check the latest email from Health ID (each new code replaces the one before), then try again.',
  activate: 'That code was not accepted. Check that you added the setup key shown here, then enter the next code the app shows.',
  verify: 'That code was not accepted. Each code works once: wait for the next code in your authenticator app, then try again.',
  recovery: 'That recovery code was not accepted. Each recovery code works once: check it, or use another.',
  reopen: UNAVAILABLE,
}

const RATE_LIMITED: Record<StepName, string> = {
  send: 'Too many codes were asked for. Wait up to 15 minutes, then try again.',
  'email-code': 'Too many attempts. Wait up to 15 minutes, then try again.',
  activate: 'Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.',
  verify: 'Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.',
  recovery: 'Too many incorrect codes. Codes are refused for up to 15 minutes, even a correct one. Try again later.',
  reopen: 'This step was started too many times. Wait up to 15 minutes, then start it again.',
}

/** What a refused step means here. */
type Outcome =
  | { then: 'ended' }
  | { then: 'ready' }
  | { then: 'step'; step: Step; message: string | null }
  /** The step stays; `field`: the code typed was refused, and is cleared. */
  | { then: 'stay'; message: string; field: boolean }

function outcomeOf(caught: unknown, step: StepName): Outcome {
  if (!isHidApiError(caught)) return { then: 'stay', field: false, message: UNAVAILABLE }
  switch (caught.code) {
    // The application page ended (30 minutes, or ended elsewhere): only that, never a staff sign-out.
    case 'CLINICIAN_APPLICATION_SESSION_INVALID': return { then: 'ended' }
    // Already set up. At activation that means an earlier activation went through unseen, its recovery codes with it.
    case 'CLINICIAN_APPLICATION_AUTHENTICATOR_READY':
      return step === 'activate' ? { then: 'step', step: { kind: 'codes-unseen' }, message: null } : { then: 'ready' }
    case 'MFA_CHALLENGE_INVALID': return { then: 'step', step: { kind: 'reopen' }, message: EXPIRED }
    case 'STAFF_MFA_FACTOR_UNPROVEN': return { then: 'step', step: { kind: 'blocked', message: FACTOR_UNPROVEN }, message: null }
    case 'CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE': return { then: 'step', step: { kind: 'blocked', message: ACCOUNT_INELIGIBLE }, message: null }
    // A reset authenticator of an approved clinician or a staff member: set up again only at staff sign-in (P7, P9).
    case 'CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED':
      return { then: 'step', step: { kind: 'blocked', message: STAFF_SIGN_IN_REQUIRED, signIn: true }, message: null }
    case 'MFA_ENROLLMENT_PROOF_UNAVAILABLE': return { then: 'step', step: { kind: 'blocked',
      message: 'There is no email address on this account to confirm the setup. Contact HID support.' }, message: null }
    // The email proof of this challenge was already used, by a start whose answer never arrived: a new challenge (P9) needs a new proof.
    case 'MFA_ENROLLMENT_PROOF_COMPLETE': return { then: 'step', step: { kind: 'reopen' },
      message: 'This setup was already confirmed by email but not finished. Start it again to continue.' }
    case 'MFA_ENROLLMENT_PROOF_REQUIRED':
      return { then: 'step', step: { kind: 'enrol' }, message: 'Confirm it is you first: ask for a code by email, then enter it.' }
    case 'MFA_INVALID_CODE': return { then: 'stay', field: true, message: INVALID_CODE[step] }
    case 'MFA_CODE_REQUIRED': return { then: 'stay', field: true, message: 'Enter either an authenticator code or a recovery code.' }
    case 'MFA_RATE_LIMITED': return { then: 'stay', field: false, message: RATE_LIMITED[step] }
    case 'MFA_ENROLLMENT_CODE_UNDELIVERABLE':
      return { then: 'stay', field: false, message: 'The code could not be sent to your email. Try again in a few minutes.' }
    case 'PLATFORM_MAINTENANCE': return { then: 'stay', field: false, message: MAINTENANCE }
  }
  // An outage (503 MFA_UNAVAILABLE, CLINICIAN_APPLICATION_UNAVAILABLE) ends nothing: the step can be sent again.
  return { then: 'stay', field: caught.status === 400, message: caught.status === 400 ? INVALID_CODE[step] : UNAVAILABLE }
}

export interface ClinicianAuthenticatorProps {
  /** The step Identity opened: set one up, verify the one the account has, or open the step again. */
  start: 'enrol' | 'verify' | 'reopen'
  /** Where the steps are: sign-up just submitted, or the status page. */
  context: 'signup' | 'status'
  /** The address the emailed code goes to, as the person typed it on this page. */
  email: string
  /** Why the step opens as `reopen`. */
  reason?: string
  doneLabel: string
  /** The authenticator is set up or verified: the applications as Identity answered. */
  onReady(account: ClinicianAccountView | null): void
  /** The application page ended (401 CLINICIAN_APPLICATION_SESSION_INVALID). */
  onEnded(): void
  /** A way out of the setup's first step, where the page has one (the status page's list). */
  skip?: { label: string; onSkip(): void }
  /**
   * Shown after every step but the recovery codes (the page's "Close this page"): leaving there would lose codes
   * Health ID can't show again.
   */
  footer?: ReactNode
}

export function ClinicianAuthenticator({ start, context, email, reason, doneLabel, onReady, onEnded, skip, footer }: ClinicianAuthenticatorProps) {
  const [step, setStep] = useState<Step>({ kind: start })
  // Each step shown is new, takes focus at its heading, and says the refusal that led to it.
  const [shown, setShown] = useState({ count: 0, carried: start === 'reopen' ? reason ?? null : null })

  function go(next: Step, carried: string | null = null) {
    setStep(next)
    setShown(previous => ({ count: previous.count + 1, carried }))
  }

  function moved(outcome: Exclude<Outcome, { then: 'stay' }>) {
    if (outcome.then === 'ended') onEnded()
    else if (outcome.then === 'ready') onReady(null)
    else go(outcome.step, outcome.message)
  }

  function shownStep(): ReactNode {
    const common = { carried: shown.carried, onMoved: moved }
    const key = shown.count
    switch (step.kind) {
      case 'enrol': return <EnrolStep key={key} {...common} context={context} email={email} skip={skip}
        onSent={expiresAt => go({ kind: 'email-code', expiresAt })} />
      case 'email-code': return <EmailCodeStep key={key} {...common} email={email} expiresAt={step.expiresAt}
        onStarted={setup => go({ kind: 'setup', setup })} />
      case 'setup': return <SetupStep key={key} {...common} setup={step.setup} onActivated={activation => go({ kind: 'recovery', activation })} />
      case 'recovery': return <RecoveryStep key={key} activation={step.activation} doneLabel={doneLabel} onDone={onReady} />
      case 'verify': return <VerifyStep key={key} {...common} onVerified={onReady} />
      case 'reopen': return <ReopenStep key={key} {...common} onOpened={purpose => go(purpose === 'verify' ? { kind: 'verify' } : { kind: 'enrol' })} />
      case 'blocked': return <BlockedStep key={key} message={step.message} signIn={step.signIn ?? false} />
      case 'codes-unseen': return <CodesUnseenStep key={key} doneLabel={doneLabel} onDone={() => onReady(null)} />
    }
  }

  return <>{shownStep()}{step.kind === 'recovery' ? null : footer}</>
}

interface StepProps {
  carried: string | null
  onMoved(outcome: Exclude<Outcome, { then: 'stay' }>): void
}

/** A step's own refusals: one about the code typed at its field, any other as an alert; focus goes back to the step's control. */
function useStepProblems(carried: string | null) {
  const [error, setError] = useState(carried ? shownError(carried) : null)
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; count: number } | null>(null)
  // In the commit that shows the refusal, not an effect a task later: a check made as soon as it is shown finds the focus moved.
  useLayoutEffect(() => { if (focusRequest) document.getElementById(focusRequest.id)?.focus() }, [focusRequest])
  return {
    error,
    problem,
    clear() { setError(null); setProblem(null) },
    show(outcome: { message: string; field: boolean }, control: string) {
      if (outcome.field) setProblem(refusal({ field: control, message: outcome.message }))
      else setError(shownError(outcome.message))
      setFocusRequest(previous => ({ id: control, count: (previous?.count ?? 0) + 1 }))
    },
    focus(control: string) { setFocusRequest(previous => ({ id: control, count: (previous?.count ?? 0) + 1 })) },
  }
}

/** Runs one call of a step: a refusal that moves the steps on is passed up, one that stays is shown. */
async function attempt<T>(call: () => Promise<T>, step: StepName, problems: ReturnType<typeof useStepProblems>,
  onMoved: StepProps['onMoved'], control: string, onStay?: (outcome: { field: boolean }) => void): Promise<T | undefined> {
  problems.clear()
  try { return await call() }
  catch (caught) {
    const outcome = outcomeOf(caught, step)
    if (outcome.then !== 'stay') { onMoved(outcome); return undefined }
    onStay?.(outcome)
    problems.show(outcome, control)
    return undefined
  }
}

function clockTime(expiresAt: string): string | null {
  const time = new Date(expiresAt)
  return Number.isNaN(time.getTime()) ? null : time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function Deadline({ expiresAt }: { expiresAt: string }) {
  const time = clockTime(expiresAt)
  return time ? <p className="patient-field-hint">Finish this step by {time}.</p> : null
}

function EnrolStep({ carried, onMoved, context, email, skip, onSent }: StepProps & {
  context: ClinicianAuthenticatorProps['context']; email: string; skip: ClinicianAuthenticatorProps['skip']
  onSent(expiresAt: string): void
}) {
  const problems = useStepProblems(carried)
  const [pending, setPending] = useState(false)

  async function send() {
    if (pending) return
    setPending(true)
    const sent = await attempt(() => clinicianApplicationApi.authenticator.sendEmailCode(), 'send', problems, onMoved,
      'clinician-mfa-send')
    setPending(false)
    if (sent) onSent(sent.expiresAt)
  }

  return <section className="patient-form" aria-labelledby="clinician-mfa-enrol-title">
    <StepHeading id="clinician-mfa-enrol-title" focus>Set up your authenticator</StepHeading>
    {context === 'signup'
      ? <p className="patient-field-hint">One more step: set up an authenticator app. First we'll email another 6-digit code to {email} to
        confirm it's you setting it up. HID can't review your application until this is done.</p>
      : <p className="patient-field-hint">Set up an authenticator app to send your application for review. First we'll email a 6-digit code
        to {email} to confirm it's you setting it up.</p>}
    <p className="patient-field-hint">You'll need an authenticator app on your phone. HID administrators will ask you to read a code from it
      when they call you, and you'll use it to sign in once your access is approved.</p>
    <StepError error={problems.error} />
    <PrimaryButton id="clinician-mfa-send" onClick={() => void send()} disabled={pending}>{pending ? 'Sending…' : 'Email me a code'}</PrimaryButton>
    {skip && <TextButton onClick={skip.onSkip} disabled={pending}>{skip.label}</TextButton>}
  </section>
}

function EmailCodeStep({ carried, onMoved, email, expiresAt, onStarted }: StepProps & {
  email: string; expiresAt: string; onStarted(setup: ClinicianAuthenticatorSetup): void
}) {
  const problems = useStepProblems(carried)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<'check' | 'send' | null>(null)
  const [deadline, setDeadline] = useState(expiresAt)
  const [sent, setSent] = useState(0)
  const control = 'clinician-mfa-email-code'

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !isSixDigitCode(code)) return
    setPending('check')
    const setup = await attempt(() => clinicianApplicationApi.authenticator.start(code), 'email-code', problems, onMoved, control,
      outcome => { if (outcome.field) setCode('') })
    setPending(null)
    if (setup) onStarted(setup)
  }

  async function sendAgain() {
    if (pending) return
    setPending('send')
    const again = await attempt(() => clinicianApplicationApi.authenticator.sendEmailCode(), 'send', problems, onMoved, control)
    setPending(null)
    if (again) { setDeadline(again.expiresAt); setCode(''); setSent(value => value + 1) }
  }

  return <form className="patient-form" aria-labelledby="clinician-mfa-email-title" aria-busy={pending !== null} onSubmit={event => void submit(event)}>
    <StepHeading id="clinician-mfa-email-title" focus>Enter the code we emailed you</StepHeading>
    <p className="patient-field-hint">We sent a 6-digit code to {email}. Each new code replaces the one before.</p>
    <StepError error={problems.error} />
    <Field label="Email code" htmlFor={control} error={problemText(problems.problem, control)} required>
      <Input id={control} value={code} onChange={event => setCode(sixDigitCode(event.target.value))} {...SIX_DIGIT_CODE_FIELD} maxLength={6}
        required {...problemProps(problems.problem, control)} /></Field>
    <Deadline expiresAt={deadline} />
    <button type="submit" className="patient-primary-button" disabled={pending !== null || !isSixDigitCode(code)}>
      {pending === 'check' ? 'Checking…' : 'Continue'}</button>
    <p role="status" className="patient-field-hint">{sent > 0 && <span key={sent}>A new code was sent.</span>}</p>
    <TextButton onClick={() => void sendAgain()} disabled={pending !== null}>{pending === 'send' ? 'Sending…' : 'Send a new code'}</TextButton>
  </form>
}

function SetupStep({ carried, onMoved, setup, onActivated }: StepProps & {
  setup: ClinicianAuthenticatorSetup; onActivated(activation: ClinicianActivation): void
}) {
  const problems = useStepProblems(carried)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const control = 'clinician-mfa-activation-code'

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !isSixDigitCode(code)) return
    setPending(true)
    const activation = await attempt(() => clinicianApplicationApi.authenticator.activate(code), 'activate', problems, onMoved, control,
      outcome => { if (outcome.field) setCode('') })
    setPending(false)
    if (activation) onActivated(activation)
  }

  return <form className="patient-form" aria-labelledby="clinician-mfa-setup-title" aria-busy={pending} onSubmit={event => void submit(event)}>
    <StepHeading id="clinician-mfa-setup-title" focus>Add Health ID to your authenticator app</StepHeading>
    <ol className="hid-mfa-setup">
      <li>In your authenticator app, add an account and scan this QR code.
        <OtpauthQr uri={setup.otpauthUri} className="hid-mfa-qr" /></li>
      <li>Can't scan it? Enter this setup key instead. On a phone with the app installed you can
        instead <a href={setup.otpauthUri}>open it in your authenticator app</a>.
        <code className="hid-mfa-key">{formatSetupKey(setup.secret)}</code>
        <small>Time-based · {setup.algorithm} · {setup.digits} digits · every {setup.periodSeconds} seconds. The key is shown only during
          this setup.</small></li>
      <li>Enter the 6-digit code the app now shows.</li>
    </ol>
    <StepError error={problems.error} />
    <Field label="Authenticator code" htmlFor={control} error={problemText(problems.problem, control)} required>
      <Input id={control} value={code} onChange={event => setCode(sixDigitCode(event.target.value))} {...SIX_DIGIT_CODE_FIELD} maxLength={6}
        required {...problemProps(problems.problem, control)} /></Field>
    <Deadline expiresAt={setup.expiresAt} />
    <button type="submit" className="patient-primary-button" disabled={pending || !isSixDigitCode(code)}>
      {pending ? 'Activating…' : 'Activate authenticator'}</button>
  </form>
}

/** The recovery codes activation answered with, once; the applications follow without them. */
function RecoveryStep({ activation, doneLabel, onDone }: {
  activation: ClinicianActivation; doneLabel: string; onDone(account: ClinicianAccountView): void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  const done = useRef(false)
  function finish() {
    if (done.current) return
    done.current = true
    const { recoveryCodes: _shown, ...account } = activation
    onDone(account)
  }
  return <RecoveryCodes codes={activation.recoveryCodes} onDone={finish} doneLabel={doneLabel}
    limits="Health ID can't show them again."
    fileName="hid-clinician-recovery-codes.txt" headingId="clinician-mfa-recovery-title" headingAs="h2" headingRef={heading}
    classNames={{ root: 'patient-form hid-mfa-recovery', list: 'hid-mfa-codes', actions: 'hid-mfa-links', success: 'patient-field-hint',
      error: 'patient-inline-error', checkbox: 'hid-mfa-checkbox' }}
    Button={CodesButton} />
}

function CodesButton({ primary, ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={primary ? 'patient-primary-button' : 'patient-text-button'} {...rest} />
}

function VerifyStep({ carried, onMoved, onVerified }: StepProps & { onVerified(account: ClinicianAccountView): void }) {
  const problems = useStepProblems(carried)
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [pending, setPending] = useState(false)
  const control = mode === 'totp' ? 'clinician-mfa-code' : 'clinician-mfa-recovery-code'
  const valid = mode === 'totp' ? isSixDigitCode(code) : isRecoveryCode(recoveryCode)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !valid) return
    setPending(true)
    const account = await attempt(() => clinicianApplicationApi.authenticator.verify(mode === 'totp' ? { code } : { recoveryCode: recoveryCode.trim() }),
      mode === 'totp' ? 'verify' : 'recovery', problems, onMoved, control,
      outcome => { if (outcome.field) { setCode(''); setRecoveryCode('') } })
    setPending(false)
    if (account) onVerified(account)
  }

  function switchMode() {
    const next = mode === 'totp' ? 'recovery' : 'totp'
    setMode(next)
    problems.clear()
    problems.focus(next === 'totp' ? 'clinician-mfa-code' : 'clinician-mfa-recovery-code')
  }

  return <form className="patient-form" aria-labelledby="clinician-mfa-verify-title" aria-busy={pending} onSubmit={event => void submit(event)}>
    <StepHeading id="clinician-mfa-verify-title" focus>Enter a code from your authenticator app</StepHeading>
    <p className="patient-field-hint">{mode === 'totp' ? 'Open the authenticator app you set up for Health ID and enter the 6-digit code it shows.'
      : 'Enter one of your recovery codes. Each recovery code works once.'}</p>
    <StepError error={problems.error} />
    {mode === 'totp'
      ? <Field label="Authenticator code" htmlFor="clinician-mfa-code" error={problemText(problems.problem, 'clinician-mfa-code')} required>
        <Input id="clinician-mfa-code" value={code} onChange={event => setCode(sixDigitCode(event.target.value))} {...SIX_DIGIT_CODE_FIELD}
          maxLength={6} required {...problemProps(problems.problem, 'clinician-mfa-code')} /></Field>
      : <Field label="Recovery code" htmlFor="clinician-mfa-recovery-code" error={problemText(problems.problem, 'clinician-mfa-recovery-code')} required>
        <Input id="clinician-mfa-recovery-code" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} autoComplete="off"
          spellCheck={false} maxLength={16} required {...problemProps(problems.problem, 'clinician-mfa-recovery-code')} /></Field>}
    <button type="submit" className="patient-primary-button" disabled={pending || !valid}>{pending ? 'Verifying…' : 'Verify'}</button>
    <TextButton onClick={switchMode} disabled={pending}>{mode === 'totp' ? 'Use a recovery code instead' : 'Use my authenticator app instead'}</TextButton>
    <p className="patient-field-hint">Lost your authenticator and your recovery codes? Contact HID support: it can't be reset from this page.</p>
  </form>
}

function ReopenStep({ carried, onMoved, onOpened }: StepProps & { onOpened(purpose: 'enroll' | 'verify'): void }) {
  const problems = useStepProblems(carried)
  const [pending, setPending] = useState(false)

  async function reopen() {
    if (pending) return
    setPending(true)
    const opened = await attempt(() => clinicianApplicationApi.authenticator.reopen(), 'reopen', problems, onMoved, 'clinician-mfa-reopen')
    setPending(false)
    if (opened) onOpened(opened.purpose)
  }

  return <section className="patient-form" aria-labelledby="clinician-mfa-reopen-title">
    <StepHeading id="clinician-mfa-reopen-title" focus>Start the authenticator step</StepHeading>
    <StepError error={problems.error} />
    <p className="patient-field-hint">Each authenticator step is open for a few minutes. Start it again to continue; your application is kept.</p>
    <PrimaryButton id="clinician-mfa-reopen" onClick={() => void reopen()} disabled={pending}>{pending ? 'Starting…' : 'Start again'}</PrimaryButton>
  </section>
}

/**
 * The authenticator is set up, but this page may never have shown its
 * recovery codes (P7 is the only answer that carries them, and the provider
 * portal cannot make new ones): said before the person goes on.
 */
function CodesUnseenStep({ doneLabel, onDone }: { doneLabel: string; onDone(): void }) {
  return <section className="patient-form" aria-labelledby="clinician-mfa-codes-unseen-title">
    <StepHeading id="clinician-mfa-codes-unseen-title" focus>Your authenticator is set up</StepHeading>
    <p role="alert">Your authenticator app is already set up. If you didn't see and save its recovery codes, Health ID can't show
      them again: keep your authenticator app safe, and contact HID support if you lose it.</p>
    <PrimaryButton onClick={onDone}>{doneLabel}</PrimaryButton>
  </section>
}

function BlockedStep({ message, signIn }: { message: string; signIn: boolean }) {
  return <section className="patient-form" aria-labelledby="clinician-mfa-blocked-title">
    <StepHeading id="clinician-mfa-blocked-title" focus>Your authenticator can't be set up here</StepHeading>
    <p role="alert" className="patient-inline-error">{message}</p>
    {signIn && <div><Link className="patient-primary-button" to="/provider/sign-in">Sign in to the provider portal</Link></div>}
  </section>
}
