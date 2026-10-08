import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { adminApi } from './api'
import { failure, isProblem } from './problems'

/** The administrator closed the confirmation: the action was not carried out. */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Authenticator confirmation was cancelled, so the action was not carried out.')
    this.name = 'StepUpCancelledError'
  }
}

export type RunWithStepUp = <T>(action: () => Promise<T>) => Promise<T>

const StepUpContext = createContext<RunWithStepUp | null>(null)

interface Pending { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }

/**
 * Step-up for high-risk actions. The backend alone decides when a fresh
 * authenticator confirmation is needed (403 STEP_UP_REQUIRED) and records it
 * when the code is correct. The client keeps no assurance state of its own: it
 * asks for a code only after the backend refused, and then repeats the same
 * submission once. Callers keep the submission's idempotency key in the
 * action closure, so the repeat is the same command, never a second one; an
 * action refused this way was not carried out.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const pending = useRef<Pending | null>(null)

  const confirm = useCallback(() => {
    if (!pending.current) {
      let resolve!: () => void
      let reject!: (error: Error) => void
      const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
      pending.current = { promise, resolve, reject }
      setOpen(true)
    }
    return pending.current.promise
  }, [])

  const run = useCallback<RunWithStepUp>(async action => {
    try {
      return await action()
    } catch (error) {
      if (!isProblem(error, 'STEP_UP_REQUIRED')) throw error
      await confirm()
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
    {open && <StepUpDialog onConfirmed={() => settle(true)} onCancel={() => settle(false)} />}
  </StepUpContext.Provider>
}

export function useStepUp(): RunWithStepUp {
  const run = useContext(StepUpContext)
  if (!run) throw new Error('useStepUp must be used inside StepUpProvider.')
  return run
}

function StepUpDialog({ onConfirmed, onCancel }: { onConfirmed: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = /^[0-9]{6}$/.test(code)

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

  return <div className="admin-dialog-backdrop">
    <form className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-step-up-title"
      onSubmit={event => void submit(event)} onKeyDown={event => { if (event.key === 'Escape' && !busy) onCancel() }}>
      <h2 id="admin-step-up-title">Confirm it’s you</h2>
      <p>This is a high-risk action. The server requires a code from your authenticator app from the last
        5 minutes before it carries it out. Nothing has been changed yet.</p>
      <p className="admin-note">Recovery codes cannot confirm high-risk actions.</p>
      <label>Authenticator code<input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required autoFocus /></label>
      {error && <p role="alert" className="admin-error">{error}</p>}
      <div className="admin-dialog-actions">
        <button type="button" className="admin-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="admin-primary" disabled={busy || !valid}>{busy ? 'Checking…' : 'Confirm and continue'}</button>
      </div>
    </form>
  </div>
}
