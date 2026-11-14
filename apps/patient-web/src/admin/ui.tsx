import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Inbox, RefreshCw, RotateCcw } from 'lucide-react'
import {
  Alert, Badge, Button as KButton, EmptyState, Field, PageHeader as KPageHeader, Select, Textarea, statusTone, type ButtonSize,
  type ButtonVariant, type Tone,
} from '../kasuwa/ui'
import { ConfirmSheet, LoadingRows } from '../kasuwa/parts'
import { useToast } from '../kasuwa/toast'
import { useSearchParams } from 'react-router-dom'
import { newIdempotencyKey, type AdminActor, type CursorPage } from './api'
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
  const loaded = useRef(load)

  useEffect(() => {
    // A new query starts empty. A reload of the same query keeps the current
    // data on screen, so forms and their confirmations are not unmounted.
    if (loaded.current !== load) { loaded.current = load; setData(null) }
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
  // paytrail's PageHeader, with the area's section as a quiet overline above the title.
  return <section className="admin-page flex flex-col gap-6">
    <KPageHeader eyebrow={<p className="m-0 text-overline text-ink-3">{eyebrow}</p>} title={title} description={description} actions={action} />
    {children}
  </section>
}

export function Refresh({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return <KButton icon={RefreshCw} onClick={onClick} disabled={disabled}>Refresh</KButton>
}

export function ResourceView<T>({ resource, empty, emptyTitle = 'Nothing here yet', children }: {
  resource: Resource<T>; empty?: (value: T) => boolean; emptyTitle?: string; children: (value: T) => ReactNode
}) {
  if (resource.loading && resource.data === null) return <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-line"><LoadingRows label="Loading" /></div>
  if (resource.error) return <Alert intent="error" title="Couldn’t load this"
    action={<KButton size="sm" icon={RotateCcw} onClick={resource.reload}>Try again</KButton>}>{resource.error}</Alert>
  if (!resource.data) return <EmptyState compact icon={Inbox} title="Nothing came back" />
  if (empty?.(resource.data)) return <EmptyState compact icon={Inbox} title={emptyTitle} />
  return <>
    {resource.loading && <p className="sr-only" role="status">Refreshing…</p>}
    {children(resource.data)}
  </>
}

/** Admin statuses the shared map does not know, by the tone that says them. */
const ADMIN_TONES: Readonly<Record<string, Tone>> = {
  success: 'success', ready: 'success', available: 'success', ok: 'success', qualified: 'success', approved_new_identity: 'success',
  linked_existing: 'success', resolved_existing_identity: 'success', coming_soon: 'info', reviewed: 'success',
  new: 'info', contacted: 'warn', degraded: 'warn', submitted: 'warn', under_review: 'warn', awaiting_authenticator: 'warn',
  ready_for_review: 'warn', pending_verification: 'warn', pending_reset: 'warn', review_required: 'warn',
  pending_new_identity_approval: 'warn', retired: 'neutral', hidden: 'neutral', referral: 'violet',
  failure: 'danger', unavailable: 'danger', locked: 'danger', released: 'danger', deleted: 'neutral', inactive: 'neutral',
  on: 'success', off: 'neutral',
}
export function adminTone(value: string): Tone {
  return ADMIN_TONES[value.toLowerCase().replace(/[\s-]+/g, '_')] ?? statusTone(value)
}

/** A status in words, with its tone (never colour alone). `text` replaces the label where the value is a code. */
export function Status({ value, text }: { value: string; text?: string }) {
  return <span className="admin-status" data-state={value.toLowerCase()}><Badge size="sm" solid tone={adminTone(value)}>{text ?? label(value)}</Badge></span>
}

/**
 * A table on a computer; on phones each row reads as a card, every value under its column's name (owner, 2026-10-31:
 * no sideways scrolling). Rows are written by each page, so the column names are put on their cells here.
 */
export function Table({ headings, children }: { headings: string[]; children: ReactNode }) {
  const body = useRef<HTMLTableSectionElement>(null)
  useLayoutEffect(() => {
    body.current?.querySelectorAll('tr').forEach(row => {
      Array.from(row.children).forEach((cell, index) => { const name = headings[index]; if (name) cell.setAttribute('data-label', name) })
    })
  })
  return <div className="admin-table-scroll"><table className="admin-table">
    <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody ref={body}>{children}</tbody>
  </table></div>
}

/** Previous/next paging over the backend's page, pageSize and total. */
export function Pager({ page, pageSize, total, onPage, disabled = false }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void; disabled?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return <nav className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2" aria-label="Pages">
    <KButton size="sm" icon={ChevronLeft} disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Previous</KButton>
    <span aria-current="page">Page {page} of {pages}</span>
    <KButton size="sm" iconRight={ChevronRight} disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Next</KButton>
  </nav>
}

interface MorePages<T> { first: CursorPage<T>; items: T[]; next: string | null; loading: boolean; error: string | null }

/**
 * Further pages of a cursor-paged list, appended below its first page. The
 * first page comes from `resource`; any reload or filter change starts again
 * from it. Appended pages belong to the first page they extend: a page that
 * arrives after the list was reloaded or refiltered is dropped, never added to
 * the new list. `loadPage` must use the same filters, because a cursor is bound
 * to them; the backend refuses any other cursor with ADMIN_INVALID_CURSOR.
 */
export function useCursorPages<T>(resource: Resource<CursorPage<T>>,
  loadPage: (cursor: string, signal: AbortSignal) => Promise<CursorPage<T>>, errorMessage: string) {
  const first = resource.data
  const [state, setState] = useState<MorePages<T> | null>(null)
  const more = state && state.first === first ? state : null
  const request = useRef<{ first: CursorPage<T>; controller: AbortController } | null>(null)
  // A new first page (or leaving the page) cancels a load for the previous one,
  // never a load already started for the new one: the effects of the render that
  // showed it can run after a click on "Load more".
  useEffect(() => () => {
    if (request.current?.first === first) request.current.controller.abort()
  }, [first])
  const next = more ? more.next : first?.nextCursor ?? null
  const items = first ? [...first.items, ...(more?.items ?? [])] : []

  async function loadMore() {
    if (!first || !next || more?.loading) return
    const controller = new AbortController()
    request.current = { first, controller }
    setState({ first, items: more?.items ?? [], next, loading: true, error: null })
    const settle = (change: (current: MorePages<T>) => MorePages<T>) => {
      if (!controller.signal.aborted) setState(current => current?.first === first ? change(current) : current)
    }
    try {
      const page = await loadPage(next, controller.signal)
      settle(current => ({ ...current, items: [...current.items, ...page.items], next: page.nextCursor ?? null, loading: false }))
    } catch (caught) {
      settle(current => ({ ...current, loading: false, error: failure(caught, errorMessage) }))
    }
  }

  return { items, hasMore: next !== null, loading: more?.loading ?? false, error: more?.error ?? null, loadMore }
}

export function LoadMore({ pages, label: title }: {
  pages: { hasMore: boolean; loading: boolean; error: string | null; loadMore: () => Promise<void> }; label: string
}) {
  return <>
    {pages.error ? <Alert intent="error" size="sm">{pages.error}</Alert> : null}
    {pages.hasMore ? <KButton className="self-start" onClick={() => void pages.loadMore()} loading={pages.loading}
      disabled={pages.loading}>{pages.loading ? 'Loading…' : title}</KButton> : null}
  </>
}

/**
 * Filters kept in the URL, so a filtered view can be linked, reloaded and
 * reopened after signing in again. Empty values are removed.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams()
  const values = Object.fromEntries(keys.map(key => [key, params.get(key) ?? ''])) as Record<K, string>
  const update = useCallback((next: Partial<Record<K, string>>) => {
    setParams(current => {
      const updated = new URLSearchParams(current)
      for (const [key, value] of Object.entries(next) as Array<[K, string | undefined]>) {
        if (value) updated.set(key, value)
        else updated.delete(key)
      }
      return updated
    }, { replace: true })
  }, [setParams])
  return [values, update] as const
}

/** A positive page number from the URL, defaulting to the first page. */
export function pageNumber(value: string): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1
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

  /** `what` names the action for the authenticator check ("suspend Demo Hospital"). */
  async function submit<T>(command: (idempotencyKey: string) => Promise<T>, fallback: string,
    context?: Readonly<Record<string, string>>, what?: string): Promise<T | null> {
    if (busy) return null
    const idempotencyKey = newIdempotencyKey()
    setBusy(true); setError(null)
    try {
      return await withStepUp(() => command(idempotencyKey), what)
    } catch (caught) {
      setError(commandFailure(caught, fallback, context))
      return null
    } finally { setBusy(false) }
  }

  return { submit, busy, error, setError }
}

/** What a confirmation says: the item, what will happen, how to undo it, and the toast once it's done. */
export interface ConfirmSpec {
  /** The sheet's title, e.g. "Suspend Demo Hospital?" */
  title: string
  /** The item acted on, shown first (a name, a line under it). */
  subject?: ReactNode
  /** What will happen, in words: "Everyone at Demo Hospital loses access at once." */
  effect: ReactNode
  /** How to undo it, or that it can't be. */
  undo?: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** The toast once it's done: exactly what changed (from the command's answer, where it says more). */
  done: string | ((result: unknown) => string)
  /** For the authenticator check: "suspend Demo Hospital". Defaults to the confirm label. */
  stepUp?: string
}

/** The item a confirmation acts on: its name and one line under it. */
export function Subject({ name, detail }: { name: ReactNode; detail?: ReactNode }) {
  return <div className="rounded-lg bg-subtle px-3.5 py-2.5 ring-1 ring-line">
    <p className="m-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{name}</p>
    {detail ? <p className="m-0 text-caption text-ink-3 [overflow-wrap:anywhere]">{detail}</p> : null}
  </div>
}

const REASON_MIN = 8

/** A drawer's close that waits while a dialog opened from it is showing (its Escape is that dialog's). */
export function unlessDialogAbove(close: () => void) {
  return () => { if (!document.querySelector('[role="dialog"][aria-modal="true"]:not(.hid-drawer)')) close() }
}

/**
 * The one confirmation for a governed change: a sheet that names the item and the effect and asks for the reason the
 * audit log keeps. The command runs with one idempotency key per submission, the authenticator check (named after the
 * action) when the backend asks for it, and ends with a toast that says what changed.
 */
export function ReasonConfirm({ open, onClose, spec, onSubmit, children, fallback = 'The change could not be saved. Try again.', problems, ready = true }: {
  open: boolean; onClose: () => void; spec: ConfirmSpec
  onSubmit: (reason: string, idempotencyKey: string) => Promise<unknown>
  children?: ReactNode; fallback?: string; problems?: Readonly<Record<string, string>>; ready?: boolean
}) {
  const [reason, setReason] = useState('')
  // Each refused confirm counts up, so focus moves back to the reason every time.
  const [refusals, setRefusals] = useState(0)
  const short = refusals > 0
  const setShort = (value: boolean) => setRefusals(count => value ? count + 1 : 0)
  const governed = useGovernedSubmit()
  const toast = useToast()
  const id = useId()
  useLayoutEffect(() => { if (refusals > 0) document.getElementById(`${id}-reason`)?.focus() }, [refusals, id])

  function close() { if (governed.busy) return; setReason(''); setShort(false); governed.setError(null); onClose() }

  async function confirm() {
    if (governed.busy || !ready) return
    if (reason.trim().length < REASON_MIN) { setShort(true); return }
    const done = await governed.submit(async key => ({ result: await onSubmit(reason.trim(), key) }), fallback, problems,
      spec.stepUp ?? spec.confirmLabel.toLowerCase())
    if (done) { toast.success(typeof spec.done === 'function' ? spec.done(done.result) : spec.done); setReason(''); onClose() }
  }

  return <ConfirmSheet open={open} onClose={close} title={spec.title} subject={spec.subject} effect={spec.effect} undo={spec.undo}
    confirmLabel={spec.confirmLabel} destructive={spec.destructive} busy={governed.busy} onConfirm={() => void confirm()}>
    {children}
    <Field label="Reason for this change" htmlFor={`${id}-reason`} hint="Kept in the audit log." errorId={`${id}-error`}
      error={short ? `Give a reason of at least ${REASON_MIN} characters.` : undefined}>
      <Textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} aria-invalid={short || undefined}
        aria-describedby={short ? `${id}-error` : undefined}
        onChange={event => { setReason(event.target.value); if (short) setShort(false) }} />
    </Field>
    {governed.error && <Alert intent="error" size="sm">{governed.error}</Alert>}
  </ConfirmSheet>
}

/** A button that opens a ReasonConfirm. */
export function ConfirmAction({ label: text, spec, onSubmit, variant = 'secondary', size = 'sm', disabled, fallback, problems, icon, children }: {
  label: string; spec: ConfirmSpec; onSubmit: (reason: string, idempotencyKey: string) => Promise<unknown>
  variant?: ButtonVariant; size?: ButtonSize; disabled?: boolean; fallback?: string; problems?: Readonly<Record<string, string>>
  icon?: Parameters<typeof KButton>[0]['icon']; children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <>
    <KButton size={size} variant={variant} icon={icon} disabled={disabled} onClick={() => setOpen(true)}>{text}</KButton>
    <ReasonConfirm open={open} onClose={() => setOpen(false)} spec={spec} onSubmit={onSubmit} fallback={fallback} problems={problems}>{children}</ReasonConfirm>
  </>
}

interface Choice { value: string; title: string }

/**
 * A change with a choice of new value (a provider, a status): a button that opens the confirmation with the choice in
 * it. `describe` says, for the chosen value, what will happen; without it the sheet says the choice in plain words.
 */
export function ActionForm({ title, options, onSubmit, disabled = false, note, subject, describe }: {
  title: string; options?: Choice[]; disabled?: boolean; note?: ReactNode; subject?: ReactNode
  describe?: (choice: Choice | undefined) => Partial<ConfirmSpec>
  onSubmit: (choice: string, reason: string, idempotencyKey: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState(options?.[0]?.value ?? '')
  const id = useId()
  // The options can change under an open sheet (a reload): keep a value that is still offered.
  const current = options?.find(option => option.value === choice) ?? options?.[0]
  const custom = describe?.(current) ?? {}
  const spec: ConfirmSpec = {
    title, subject,
    effect: current ? <>The new value will be <strong>{current.title}</strong>.</> : 'This change takes effect at once.',
    confirmLabel: current ? `Change to ${current.title}` : title,
    done: current ? `${title}: ${current.title}.` : `${title}: done.`,
    stepUp: title.toLowerCase(),
    ...custom,
  }
  return <>
    <KButton size="sm" disabled={disabled} onClick={() => setOpen(true)}>{title}</KButton>
    <ReasonConfirm open={open} onClose={() => setOpen(false)} spec={spec} ready={!options || Boolean(current)}
      onSubmit={(reason, key) => onSubmit(current?.value ?? '', reason, key)}>
      {note}
      {options && options.length > 1 && <Field label="Change to" htmlFor={`${id}-choice`}>
        <Select id={`${id}-choice`} value={current?.value ?? ''} onChange={event => setChoice(event.target.value)}>
          {options.map(option => <option key={option.value} value={option.value}>{option.title}</option>)}
        </Select></Field>}
    </ReasonConfirm>
  </>
}
