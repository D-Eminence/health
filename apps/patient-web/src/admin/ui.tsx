import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { newIdempotencyKey, type AdminActor } from './api'
import { failure } from './problems'
import { StepUpCancelledError, useStepUp } from './StepUp'

/** A display hint only: the backend authorizes every request. */
export function has(actor: AdminActor, permission: string) {
  return actor.platformPermissions.includes(permission)
}

export function label(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, first => first.toUpperCase())
}

export function date(value: string | null | undefined) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(parsed)
}

export interface Resource<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useResource<T>(load: (signal?: AbortSignal) => Promise<T>, errorMessage: string): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void load(controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(failure(reason, errorMessage))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [load, errorMessage, revision])

  return { data, loading, error, reload: () => setRevision(value => value + 1) }
}

export function Page({ eyebrow, title, description, children, action }: {
  eyebrow: string; title: string; description: string; children: ReactNode; action?: ReactNode
}) {
  return <section className="admin-page">
    <header className="admin-page-head">
      <div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {action}
    </header>
    {children}
  </section>
}

export function Refresh({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="admin-secondary" onClick={onClick} disabled={disabled}>Refresh</button>
}

export function ResourceView<T>({ resource, empty, children }: {
  resource: Resource<T>; empty?: (value: T) => boolean; children: (value: T) => ReactNode
}) {
  if (resource.loading) return <div className="admin-state" role="status">Loading current information…</div>
  if (resource.error) return <div className="admin-state admin-state-error" role="alert">
    <p>{resource.error}</p><Refresh onClick={resource.reload} />
  </div>
  if (!resource.data) return <div className="admin-state">No information was returned.</div>
  if (empty?.(resource.data)) return <div className="admin-state">No items are available in this area.</div>
  return <>{children(resource.data)}</>
}

export function Status({ value }: { value: string }) {
  return <span className="admin-status" data-state={value.toLowerCase()}>{label(value)}</span>
}

export function Table({ headings, children }: { headings: string[]; children: ReactNode }) {
  return <div className="admin-table-scroll"><table className="admin-table">
    <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody>{children}</tbody>
  </table></div>
}

/** The message for a governed command that did not complete. */
export function commandFailure(caught: unknown, fallback: string, context?: Readonly<Record<string, string>>) {
  return caught instanceof StepUpCancelledError ? caught.message : failure(caught, fallback, context)
}

/**
 * Runs a governed command: one idempotency key per submission, and the
 * backend's step-up refusal answered by confirming and repeating that same
 * submission. Returns null when the command did not complete.
 */
export function useGovernedSubmit() {
  const withStepUp = useStepUp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit<T>(command: (idempotencyKey: string) => Promise<T>, fallback: string,
    context?: Readonly<Record<string, string>>): Promise<T | null> {
    if (busy) return null
    const idempotencyKey = newIdempotencyKey()
    setBusy(true); setError(null)
    try {
      return await withStepUp(() => command(idempotencyKey))
    } catch (caught) {
      setError(commandFailure(caught, fallback, context))
      return null
    } finally { setBusy(false) }
  }

  return { submit, busy, error, setError }
}

interface Choice { value: string; title: string }

export function ActionForm({ title, options, onSubmit, disabled = false, note }: {
  title: string; options?: Choice[]; disabled?: boolean; note?: ReactNode
  onSubmit: (choice: string, reason: string, idempotencyKey: string) => Promise<void>
}) {
  const [choice, setChoice] = useState(options?.[0]?.value ?? '')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const governed = useGovernedSubmit()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || disabled || reason.trim().length < 8 || (options && !choice)) return
    setNotice(null)
    const done = await governed.submit(async key => { await onSubmit(choice, reason.trim(), key); return true },
      'The change could not be saved. Try again.')
    if (done) {
      setNotice('Saved. Current information is being refreshed.')
      setReason('')
    }
  }

  return <details className="admin-action">
    <summary>{title}</summary>
    <form onSubmit={event => void submit(event)} className="admin-action-form">
      {note}
      {options && <label>New value<select value={choice} onChange={event => setChoice(event.target.value)} required>
        {options.map(option => <option key={option.value} value={option.value}>{option.title}</option>)}
      </select></label>}
      <label>Reason for this change<textarea required minLength={8} maxLength={500} rows={3}
        value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button type="submit" className="admin-primary" disabled={governed.busy || disabled || reason.trim().length < 8 || Boolean(options && !choice)}>
        {governed.busy ? 'Saving…' : 'Confirm change'}
      </button>
      {governed.error && <p className="admin-error" role="alert">{governed.error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
    </form>
  </details>
}
