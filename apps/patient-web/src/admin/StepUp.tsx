import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Alert, Button, Field, Input } from '../kasuwa/ui'
import { Modal } from '../kasuwa/interactive'
import { adminApi } from './api'
import { failure, isProblem } from './problems'
import { SIX_DIGIT_CODE_FIELD, isSixDigitCode, sixDigitCode } from '../mfa/codes'

/** The administrator closed the confirmation: the action was not carried out. */
export class StepUpCancelledError extends Error {
  constructor() {
    super('You cancelled the code check, so nothing was changed.')
    this.name = 'StepUpCancelledError'
  }
}

/**
 * Runs a command, asking for an authenticator code if the backend requires one. `what` names the action the code
 * protects, as a verb phrase ("suspend Demo Hospital"), so the dialog says what is being confirmed.
 */
export type RunWithStepUp = <T>(action: () => Promise<T>, what?: string) => Promise<T>

const StepUpContext = createContext<RunWithStepUp | null>(null)

interface Pending { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }

/** The backend's step-up refusals: none in this session, or one older than 5 minutes (Stage 4A). */
const STEP_UP_CODES = ['STEP_UP_REQUIRED', 'STEP_UP_EXPIRED'] as const

/**
 * Step-up for high-risk actions. The backend alone decides when a fresh
 * authenticator confirmation is needed (403 STEP_UP_REQUIRED, or
 * STEP_UP_EXPIRED when the last one is older than 5 minutes) and records it
 * when the code is correct. The client keeps no assurance state of its own: it
 * asks for a code only after the backend refused, and then repeats the same
 * submission once. Callers keep the submission's idempotency key in the
 * action closure, so the repeat is the same command, never a second one; an
 * action refused this way was not carried out.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [expired, setExpired] = useState(false)
  const [what, setWhat] = useState<string | undefined>(undefined)
  const pending = useRef<Pending | null>(null)

  const confirm = useCallback((afterExpiry: boolean, action?: string) => {
    if (!pending.current) {
      setExpired(afterExpiry)
      setWhat(action)
      let resolve!: () => void
      let reject!: (error: Error) => void
      const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
      pending.current = { promise, resolve, reject }
      setOpen(true)
    }
    return pending.current.promise
  }, [])

  const run = useCallback<RunWithStepUp>(async (action, label) => {
    try {
      return await action()
    } catch (error) {
      if (!STEP_UP_CODES.some(code => isProblem(error, code))) throw error
      await confirm(isProblem(error, 'STEP_UP_EXPIRED'), label)
      return action()
    }
  }, [confirm])

  const settle = useCallback((confirmed: boolean) => {
    const current = pending.current
    pending.current = null
    setOpen(false)
    if (confirmed) current?.resolve()
    else current?.reject(new StepUpCancelledError())
  }, [])

  // A provider that unmounts (for example on sign-out) cancels a waiting action.
  useEffect(() => () => {
    pending.current?.reject(new StepUpCancelledError())
    pending.current = null
  }, [])

  return <StepUpContext.Provider value={run}>
    {children}
    {open && <StepUpDialog expired={expired} what={what} onConfirmed={() => settle(true)} onCancel={() => settle(false)} />}
  </StepUpContext.Provider>
}

export function useStepUp(): RunWithStepUp {
  const run = useContext(StepUpContext)
  if (!run) throw new Error('useStepUp must be used inside StepUpProvider.')
  return run
}

function StepUpDialog({ expired, what, onConfirmed, onCancel }: { expired: boolean; what?: string; onConfirmed: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = isSixDigitCode(code)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !valid) return
    setBusy(true); setError(null)
    try {
      await adminApi.stepUp(code)
      onConfirmed()
    } catch (caught) {
      setCode('')
      setError(failure(caught, 'Your code could not be checked. Try again.'))
    } finally { setBusy(false) }
  }

  return <Modal open size="sm" onClose={() => { if (!busy) onCancel() }} title="Confirm it’s you"
    footer={<><Button onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" form="admin-step-up-form" variant="primary" loading={busy} disabled={busy || !valid}>{busy ? 'Checking…' : 'Confirm and continue'}</Button></>}>
    <form id="admin-step-up-form" onSubmit={event => void submit(event)} className="flex flex-col gap-4">
      <p className="m-0 text-body text-ink">{what
        ? <>To {what}, enter the 6-digit code from your authenticator app.</>
        : <>Enter the 6-digit code from your authenticator app to continue.</>} Nothing has changed yet.</p>
      {expired && <p className="m-0 text-caption text-ink-3">Your last code was more than 5 minutes ago.</p>}
      <Field label="Authenticator code" htmlFor="admin-step-up-code" hint="Recovery codes can’t be used here.">
        <Input id="admin-step-up-code" value={code} onChange={event => setCode(sixDigitCode(event.target.value))}
          {...SIX_DIGIT_CODE_FIELD} required className="tracking-[.2em]" />
      </Field>
      {error && <Alert intent="error" size="sm">{error}</Alert>}
    </form>
  </Modal>
}
