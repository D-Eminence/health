import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { Field, Input } from '@hid/ui'
import { Turnstile } from '../../Turnstile'
import { SIX_DIGIT_CODE_FIELD, isSixDigitCode, sixDigitCode } from '../../mfa/codes'
import { problemProps, problemText, refusal, type FieldProblem } from '../fieldProblem'
import type { ClinicianCodeSent } from '../clinicianApplicationApi'
import { PrimaryButton, StepError, StepHeading, TextButton, shownError } from './ui'

export type EmailCodeStage = 'email' | 'code'

export interface EmailCodeProps<Answer> {
  /** Ids of this page's fields, so a step's controls and errors are tied together. */
  idPrefix: string
  action: 'clinician-application' | 'clinician-application-status'
  /** The address, kept by the page across its steps. */
  email: string
  onEmail(email: string): void
  /** Whether the email step's heading takes focus as it opens (not on a page just opened). */
  focusFirst: boolean
  copy: {
    emailHeading: string
    emailIntro: ReactNode
    sent(email: string): string
    codeInvalid: string
  }
  send(email: string, turnstileToken: string): Promise<ClinicianCodeSent>
  verify(challengeId: string, email: string, code: string): Promise<Answer>
  /** The page's words for a refused send or check; null when the page has taken it over (another screen). */
  refused(caught: unknown, call: 'send' | 'verify'): string | null
  onStage(stage: EmailCodeStage): void
  onVerified(answer: Answer): void
}

/**
 * The two email steps both clinician pages open with: an address and a
 * security check, then the 6-digit code emailed to it. Identity answers every
 * address the same (202), so the page says only that a code was sent if the
 * address can be used. A new code needs a new security check, and is offered
 * once the wait Identity gave has passed; that is said once, politely.
 */
export function EmailCode<Answer>({ idPrefix, action, email, onEmail, focusFirst, copy, send, verify, refused, onStage,
  onVerified }: EmailCodeProps<Answer>) {
  const [stage, setStage] = useState<EmailCodeStage>('email')
  const [challenge, setChallenge] = useState<ClinicianCodeSent | null>(null)
  const [code, setCode] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [checkKey, setCheckKey] = useState(0)
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const [error, setError] = useState<{ id: number; message: string } | null>(null)
  const [problem, setProblem] = useState<FieldProblem | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; count: number } | null>(null)
  // Each code sent opens a wait before another may be asked for. `notice` is what the status line says, once each.
  const [canResend, setCanResend] = useState(false)
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  // Back at the email step from the code step ("Use a different email"): its heading takes focus, the button used being gone.
  const [returned, setReturned] = useState(false)
  const emailId = `${idPrefix}-email`
  const codeId = `${idPrefix}-code`

  useEffect(() => {
    if (!challenge) return
    setCanResend(false)
    const timer = setTimeout(() => {
      setCanResend(true)
      setNotice(previous => ({ id: (previous?.id ?? 0) + 1, text: 'You can send a new code now.' }))
    }, Math.max(0, challenge.resendAfterSeconds) * 1000)
    return () => clearTimeout(timer)
  }, [challenge])

  useEffect(() => { if (focusRequest) document.getElementById(focusRequest.id)?.focus() }, [focusRequest])

  function moveTo(next: EmailCodeStage) {
    setStage(next)
    setError(null)
    setProblem(null)
    setNotice(null)
    setCode('')
    if (next === 'email') { setChallenge(null); setReturned(true) }
    onStage(next)
  }

  function refuse(caught: unknown, call: 'send' | 'verify', fallbackField: string) {
    const message = refused(caught, call)
    if (message !== null) {
      setError(shownError(message))
      setFocusRequest(previous => ({ id: fallbackField, count: (previous?.count ?? 0) + 1 }))
    }
  }

  function fieldRefusal(field: string, message: string) {
    setProblem(refusal({ field, message }))
    setFocusRequest(previous => ({ id: field, count: (previous?.count ?? 0) + 1 }))
  }

  async function sendCode(again: boolean) {
    const address = email.trim().toLowerCase()
    if (busy || !token || !address) return
    setBusy('send')
    setError(null)
    setProblem(null)
    try {
      const sent = await send(address, token)
      onEmail(address)
      setChallenge(sent)
      if (again) {
        setCode('')
        setNotice(previous => ({ id: (previous?.id ?? 0) + 1, text: copy.sent(address) }))
      } else moveTo('code')
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'VALIDATION_FAILED' && !again) fieldRefusal(emailId, 'Enter a valid email address.')
      else refuse(caught, 'send', again ? codeId : emailId)
    } finally {
      // Each security check is used once.
      setToken(null)
      setCheckKey(value => value + 1)
      setBusy(null)
    }
  }

  async function check(event: FormEvent) {
    event.preventDefault()
    if (busy || !challenge || !isSixDigitCode(code)) return
    setBusy('verify')
    setError(null)
    setProblem(null)
    let answer: Answer
    try { answer = await verify(challenge.challengeId, email, code) }
    catch (caught) {
      setBusy(null)
      if (isHidApiError(caught) && (caught.code === 'CLINICIAN_APPLICATION_CODE_INVALID' || caught.code === 'VALIDATION_FAILED')) {
        setCode('')
        fieldRefusal(codeId, copy.codeInvalid)
      } else refuse(caught, 'verify', codeId)
      return
    }
    setBusy(null)
    onVerified(answer)
  }

  if (stage === 'email') {
    return <form key="email" className="patient-form" aria-labelledby={`${idPrefix}-email-title`} aria-busy={busy !== null}
      onSubmit={event => { event.preventDefault(); void sendCode(false) }}>
      <StepHeading id={`${idPrefix}-email-title`} focus={focusFirst || returned}>{copy.emailHeading}</StepHeading>
      {copy.emailIntro}
      <StepError error={error} />
      <Field label="Work email" htmlFor={emailId} error={problemText(problem, emailId)} required>
        <Input id={emailId} type="email" autoComplete="email" maxLength={254} required value={email}
          onChange={event => onEmail(event.target.value)} {...problemProps(problem, emailId)} />
      </Field>
      <Turnstile action={action} onTokenChange={setToken} resetKey={checkKey} />
      <button type="submit" className="patient-primary-button" disabled={busy !== null || !token || !email.trim()}>
        {busy === 'send' ? 'Sending…' : 'Send code'}</button>
    </form>
  }

  return <form key="code" className="patient-form" aria-labelledby={`${idPrefix}-code-title`} aria-busy={busy !== null}
    onSubmit={event => void check(event)}>
    <StepHeading id={`${idPrefix}-code-title`} focus>Enter the 6-digit code</StepHeading>
    <p className="patient-field-hint">{copy.sent(email)}</p>
    <StepError error={error} />
    <Field label="6-digit code" htmlFor={codeId} error={problemText(problem, codeId)} required>
      <Input id={codeId} value={code} onChange={event => setCode(sixDigitCode(event.target.value))} {...SIX_DIGIT_CODE_FIELD}
        maxLength={6} required {...problemProps(problem, codeId)} />
    </Field>
    <button type="submit" className="patient-primary-button" disabled={busy !== null || !isSixDigitCode(code)}>
      {busy === 'verify' ? 'Checking…' : 'Verify email'}</button>
    {/* Mounted throughout, so each change is announced once. */}
    <p role="status" className="patient-field-hint">{notice && <span key={notice.id}>{notice.text}</span>}</p>
    {canResend ? <>
      <Turnstile action={action} onTokenChange={setToken} resetKey={checkKey} />
      <div className="clinician-actions">
        <PrimaryButton className="patient-secondary-button" onClick={() => void sendCode(true)} disabled={busy !== null || !token}>
          {busy === 'send' ? 'Sending…' : 'Send a new code'}</PrimaryButton>
        <TextButton onClick={() => moveTo('email')} disabled={busy !== null}>Use a different email</TextButton>
      </div>
    </> : <>
      <p className="patient-field-hint">You can ask for a new code {challenge ? `${challenge.resendAfterSeconds} seconds` : 'a minute'} after
        the last one was sent.</p>
      <TextButton onClick={() => moveTo('email')} disabled={busy !== null}>Use a different email</TextButton>
    </>}
  </form>
}
