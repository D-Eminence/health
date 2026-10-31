import type { FormEvent } from 'react'
import { buttonClass } from '../../kasuwa/ui'
import { describedBy } from '../../authSteps'
import { CodeBoxes, codeComplete } from '../../CodeBoxes'

/** Codes one registration may send to the phone on the NIN record (hid-system ADR-062). */
export const HOLDER_CODES_PER_REGISTRATION = 3

interface HolderCodeStepProps {
  /** The heading takes focus on arrival, the field after a refusal about the code. */
  focusTarget: (element: HTMLElement | null) => void
  busy: boolean
  /** The error is about the code typed. */
  codeError: boolean
  errorId: string | undefined
  /** Seconds the code lives, when Identity said. */
  expiresInSeconds: number | null
  code: string
  onCode: (code: string) => void
  onSubmit: (event: FormEvent) => void
  /** Whether a new code may be asked for now (recoveryWait.ts useResendWait), and the wait said until then. */
  resendReady: boolean
  resendWaitSeconds: number
  onResend: () => void
  onOtherWay: () => void
  onDifferentNin: () => void
}

/** The code texted to the phone on the NIN record (POST .../holder/verify). */
export function HolderCodeStep(props: HolderCodeStepProps) {
  const { focusTarget, busy, codeError, errorId, expiresInSeconds, code, onCode, onSubmit,
    resendReady, resendWaitSeconds, onResend, onOtherWay, onDifferentNin } = props
  const minutes = expiresInSeconds !== null && expiresInSeconds > 0 ? Math.ceil(expiresInSeconds / 60) : null
  const incomplete = !codeComplete(code)
  return <form onSubmit={onSubmit} className="flex flex-col gap-4 [&_h2]:m-0 [&_h2]:text-title-2 [&_h2]:text-ink [&_h2]:outline-none">
    <h2 ref={codeError ? undefined : focusTarget} tabIndex={-1}>Enter the code we texted you</h2>
    <p id="enroll-holder-code-hint" className="m-0 text-[13px] text-ink-3">
      We sent a 6-digit code to the phone number linked to your NIN.{minutes !== null && ` It expires in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`}
    </p>
    <CodeBoxes id="enroll-holder-code" label="Verification code" value={code} onChange={onCode} inputRef={codeError ? focusTarget : undefined}
      busy={busy} invalid={codeError ? true : undefined} describedBy={describedBy('enroll-holder-code-hint', codeError && errorId)} />
    {incomplete && <p id="enroll-holder-code-needed" className="m-0 text-[13px] text-ink-3">Enter the 6-digit code to continue.</p>}
    <button type="submit" className={buttonClass({ variant: 'primary', size: 'lg', block: true })} disabled={busy || incomplete}
      aria-describedby={incomplete ? 'enroll-holder-code-needed' : undefined}>{busy ? 'Checking…' : 'Verify code'}</button>
    <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} disabled={busy || !resendReady} onClick={onResend}
      aria-describedby={resendReady ? undefined : 'enroll-resend-wait'}>Send a new code</button>
    {!resendReady && <p id="enroll-resend-wait" className="m-0 text-[13px] text-ink-3">A new code can be sent {resendWaitSeconds} seconds after the last one.</p>}
    {/* Mounted throughout, so a new code being on offer is announced once, politely. */}
    <p role="status" className="m-0 text-[13px] text-ink-3">{resendReady ? 'You can ask for a new code now.' : ''}</p>
    <p className="m-0 text-[13px] text-ink-3">This registration can get up to {HOLDER_CODES_PER_REGISTRATION} codes.</p>
    <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} disabled={busy} onClick={onOtherWay}>I can't get the code</button>
    <button type="button" className={buttonClass({ variant: 'link', className: 'self-start' })} disabled={busy} onClick={onDifferentNin}>Use a different NIN</button>
  </form>
}
