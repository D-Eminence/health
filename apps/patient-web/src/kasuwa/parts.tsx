/**
 * The shared building blocks every screen is made from (the review of 2026-10-31: build screens from one set of rules
 * and parts, not one-off styles). Each part carries a rule from UI-PRINCIPLES.md so a screen gets it by using the part:
 *
 * - FormPage: a page that is a form is one centred column, heading on the form's edge (alignment, continuity; rule B).
 * - Step: one numbered chunk of a longer form (chunking, goal gradient).
 * - PageState: loading, error with Retry, and empty, designed once (visibility of system status; every screen's states).
 * - ConfirmSheet: a consequential action names what it acts on and what happens, before it happens (error prevention,
 *   reversal; clinical safety: confirm the patient).
 * - PatientBanner: name, Health ID, date of birth, age and sex on every clinical screen (wrong-patient prevention).
 * - Value / Flag: a measurement always with its unit, and an abnormal one said in words with an icon, not colour alone.
 */
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, CircleAlert, RotateCcw, TriangleAlert } from 'lucide-react'
import { Alert, Badge, Button, Card, EmptyState, PageHeader, cx, type Icon, type Tone } from './ui'
import { Modal } from './interactive'
import type { IllustrationName } from './illustrations'

export function FormPage({ title, description, back, actions, children, titleRef, wide = false }: {
  title: ReactNode; description?: ReactNode
  /** Back as an arrow before the title; `label` names where it goes: "Back to patients". */
  back?: { to: string; label: string }; actions?: ReactNode; children: ReactNode
  titleRef?: React.Ref<HTMLHeadingElement>; wide?: boolean
}) {
  return <div data-layout="column" className={cx('mx-auto flex w-full flex-col gap-6', wide ? 'max-w-3xl' : 'max-w-2xl')}>
    <PageHeader title={title} description={description} actions={actions} titleRef={titleRef} back={back} />
    {children}
  </div>
}

export function Step({ n, title, hint, children, done, bodyClassName }: { n: number; title: string; hint?: string; children: ReactNode; done?: boolean; bodyClassName?: string }) {
  return <Card>
    <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
      <span aria-hidden="true" className={cx('inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white', done ? 'bg-success' : 'bg-brand-fill')}>{n}</span>
      <div className="min-w-0"><h3 className="m-0 text-title-3 break-words text-ink">{title}</h3>{hint ? <p className="m-0 text-caption text-ink-3">{hint}</p> : null}</div>
    </div>
    <div className={cx('flex min-w-0 flex-col gap-4 p-4 sm:p-5', bodyClassName)}>{children}</div>
  </Card>
}

/**
 * A form's buttons (Fitts, thumb reach, Jakob): children in the order [secondary…, primary].
 * - From 640px: one row on the form's right edge, the primary last (rightmost), where the eye ends and people expect it.
 * - Phones: full-width buttons stacked with the primary last (at the bottom, in thumb reach), held at the bottom of the
 *   screen above the 64px tab bar (and the safe area) on the page's surface under a hairline, so it is always in reach.
 * `sticky={false}` for a form that is short or sits inside a card that ends with it.
 */
export function FormActions({ children, sticky = true, className, align = 'end' }: {
  children: ReactNode; sticky?: boolean; className?: string; align?: 'end' | 'start'
}) {
  return <div data-form-actions="" className={cx('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center',
    align === 'end' ? 'sm:justify-end' : 'sm:justify-start',
    '[&>*]:w-full sm:[&>*]:w-auto sm:[&>*]:max-w-full',
    sticky && 'max-sm:sticky max-sm:bottom-[calc(64px+env(safe-area-inset-bottom))] max-sm:z-[var(--z-sticky)] max-sm:-mx-4 max-sm:border-t max-sm:border-line max-sm:bg-surface max-sm:px-4 max-sm:py-3',
    className)}>
    {children}
  </div>
}

/** Rows that look like the list they stand in for, while it loads. */
export function LoadingRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return <div role="status" aria-label={label} className="divide-y divide-line">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-4 px-5 py-4">
      <div className="size-9 animate-pulse rounded-full bg-hover" />
      <div className="flex-1 space-y-2"><div className="h-3.5 w-1/3 animate-pulse rounded-md bg-hover" /><div className="h-3 w-1/4 animate-pulse rounded-md bg-hover" /></div>
    </div>)}
  </div>
}

/**
 * The states of anything that is read: still loading (and nothing to show yet), failed (what failed, and Retry), empty
 * (one line on what will appear), else the content. Content already shown stays while it reloads.
 */
export function PageState({ loading, error, hasData, onRetry, retryLabel = 'Try again', what, empty, children, rows }: {
  loading: boolean; error: string | null | undefined; hasData: boolean; onRetry?: () => void; retryLabel?: string
  /** What is being read, for the error title: "your records". */
  what: string
  empty?: { icon?: Icon; illustration?: IllustrationName; title: string; description?: ReactNode; action?: ReactNode } | null
  children: ReactNode; rows?: number
}) {
  if (loading && !hasData) return <LoadingRows rows={rows} label={`Loading ${what}`} />
  if (error) return <Alert intent="error" title={`Couldn’t load ${what}`} action={onRetry ? <Button size="sm" icon={RotateCcw} onClick={onRetry}>{retryLabel}</Button> : undefined}>{error}</Alert>
  if (empty) return <EmptyState compact icon={empty.icon} illustration={empty.illustration} title={empty.title} description={empty.description} action={empty.action} />
  return <>{children}</>
}

/**
 * Before a consequential action: what it acts on (`subject`, e.g. the patient banner or the facility), what will happen
 * (`effect`), and how to undo it (`undo`, or that it can't be). Destructive actions are red. Cancel is as easy as confirm.
 */
export function ConfirmSheet({ open, onClose, title, subject, effect, undo, confirmLabel, destructive = false, busy = false, onConfirm, children }: {
  open: boolean; onClose: () => void; title: string; subject?: ReactNode; effect: ReactNode; undo?: ReactNode
  confirmLabel: string; destructive?: boolean; busy?: boolean; onConfirm: () => void; children?: ReactNode
}) {
  return <Modal open={open} onClose={() => { if (!busy) onClose() }} title={title} size="sm"
    footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant={destructive ? 'destructive' : 'primary'} loading={busy} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
    <div className="flex flex-col gap-4">
      {subject}
      <p className="m-0 text-body text-ink">{effect}</p>
      {children}
      {undo ? <p className="m-0 text-caption text-ink-3">{undo}</p> : null}
    </div>
  </Modal>
}

function ageOf(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null
  const born = new Date(dateOfBirth)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) age -= 1
  return age
}
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
const words = (value: string | null | undefined) => value ? value.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()) : ''

/**
 * The patient on every clinical screen: name, Health ID, date of birth with age, and sex, always in the same place and
 * shape, so the person acting never has to remember who is open (working memory; wrong-patient prevention).
 */
export function PatientBanner({ name, hid, dateOfBirth, sex, status, sticky = false, compact = false }: {
  name: string; hid: string; dateOfBirth?: string | null; sex?: string | null
  status?: { label: string; tone: Tone } | null; sticky?: boolean; compact?: boolean
}) {
  const age = ageOf(dateOfBirth)
  const initials = name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return <section aria-label={`Patient: ${name}`} className={cx('flex flex-wrap items-center gap-3 rounded-2xl bg-surface ring-1 ring-line',
    compact ? 'px-3 py-2' : 'px-4 py-3', sticky && 'sticky top-16 z-[var(--z-sticky)] lg:top-20')}>
    <span aria-hidden="true" className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-ink', compact ? 'size-8 text-[12px]' : 'size-10 text-sm')}>{initials}</span>
    <div className="min-w-0 flex-[1_1_12rem]">
      <p className="m-0 truncate text-title-3 text-ink">{name}</p>
      <p className="m-0 text-caption text-ink-2">
        <span className="font-medium tracking-[.04em] text-ink">{hid}</span>
        {dateOfBirth ? <> · born {day(dateOfBirth)}{age !== null ? ` (${age})` : ''}</> : null}
        {sex ? <> · {words(sex)}</> : null}
      </p>
    </div>
    {status ? <Badge size="sm" tone={status.tone}>{status.label}</Badge> : null}
  </section>
}

export type FlagLevel = 'low' | 'high' | 'critical' | 'abnormal'
const FLAG: Record<FlagLevel, { text: string; icon: Icon; tone: string }> = {
  low: { text: 'Low', icon: ArrowDown, tone: 'text-warn-ink bg-warn-soft' },
  high: { text: 'High', icon: ArrowUp, tone: 'text-warn-ink bg-warn-soft' },
  abnormal: { text: 'Abnormal', icon: CircleAlert, tone: 'text-warn-ink bg-warn-soft' },
  critical: { text: 'Critical', icon: TriangleAlert, tone: 'text-danger-ink bg-danger-soft' },
}

/** An abnormal value, said in a word with an icon (never colour alone). */
export function Flag({ level }: { level: FlagLevel }) {
  const f = FLAG[level]
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold', f.tone)}><f.icon className="size-3" aria-hidden />{f.text}</span>
}

/** A measurement with its unit, always; its flag when it is out of range. Decimals keep a leading zero. */
export function Value({ value, unit, flag, label }: { value: number | string | null | undefined; unit?: string | null; flag?: FlagLevel | null; label?: string }) {
  if (value === null || value === undefined || value === '') return <span className="text-ink-3">Not recorded</span>
  const shown = typeof value === 'number' ? (Math.abs(value) < 1 && value !== 0 ? value.toFixed(value.toString().split('.')[1]?.length ?? 1).replace(/^(-?)\./, '$10.') : String(value)) : value
  return <span className="inline-flex flex-wrap items-baseline gap-1.5">
    {label ? <span className="text-ink-3">{label}</span> : null}
    <span className="font-semibold text-ink tabular">{shown}</span>{unit ? <span className="text-ink-2">{unit}</span> : null}
    {flag ? <Flag level={flag} /> : null}
  </span>
}
