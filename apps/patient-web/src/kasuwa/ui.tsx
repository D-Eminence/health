/**
 * The Kasuwa component kit, ported from paytrail (Usetally) components/ui.js and alert.js: the source of truth for the
 * Health ID rebuild. Same structure, classes and tokens; React Router links instead of Next's. Interactive pieces
 * (Modal, Segmented, Switch, ThemeToggle) live in ./interactive.tsx.
 */
import type { ComponentType, HTMLAttributes, ReactNode, SVGProps } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { Illustration, type IllustrationName } from './illustrations'

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ')

/** Any icon component: Lucide's, Health Icons', or a hand-drawn one. */
export type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>
export type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'info' | 'violet' | 'danger'

export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-tray text-ink-2 ring-line-control/60',
  brand: 'bg-brand-soft text-brand-ink ring-brand-line/70',
  success: 'bg-success-soft text-success-ink ring-success/25',
  warn: 'bg-warn-soft text-warn-ink ring-warn/30',
  info: 'bg-info-soft text-info-ink ring-info/25',
  violet: 'bg-violet-soft text-violet-ink ring-violet/25',
  danger: 'bg-danger-soft text-danger-ink ring-danger/25',
}
export const TONE_OUTLINE: Record<Tone, string> = {
  neutral: 'ring-line-control/80 text-ink-2',
  brand: 'ring-brand-line text-brand-ink',
  success: 'ring-success/30 text-success-ink',
  warn: 'ring-warn/35 text-warn-ink',
  info: 'ring-info/30 text-info-ink',
  violet: 'ring-violet/30 text-violet-ink',
  danger: 'ring-danger/30 text-danger-ink',
}
export const TONE_ICON: Record<Tone, string> = {
  neutral: 'text-ink-3', brand: 'text-brand', success: 'text-success', warn: 'text-warn',
  info: 'text-info', violet: 'text-violet', danger: 'text-danger',
}
/**
 * One meaning per status word, everywhere (similarity; never colour alone: the word is always shown too).
 * statusTone('active') → 'success'. Unknown words are neutral.
 */
const STATUS_TONES: Readonly<Record<string, Tone>> = {
  active: 'success', approved: 'success', accepted: 'success', healthy: 'success', completed: 'success', verified: 'success', linked: 'success',
  dispensed: 'success', resulted: 'success', signed: 'success', live: 'success', enabled: 'success', set: 'success', confirmed: 'success',
  pending: 'warn', waiting: 'warn', review: 'warn', paused: 'warn', draft: 'warn', in_progress: 'brand', open: 'brand', requested: 'brand',
  denied: 'danger', revoked: 'danger', rejected: 'danger', failed: 'danger', suspended: 'danger', disabled: 'danger', cancelled: 'neutral',
  expired: 'neutral', closed: 'neutral', ended: 'neutral', withdrawn: 'neutral', unknown: 'neutral',
}
export const statusTone = (status: string | null | undefined): Tone =>
  STATUS_TONES[(status ?? '').toLowerCase().replace(/[\s-]+/g, '_')] ?? 'neutral'

export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-ink-3', brand: 'bg-brand-fill', success: 'bg-success', warn: 'bg-warn',
  info: 'bg-info', violet: 'bg-violet', danger: 'bg-danger',
}

const BUTTON_BASE = 'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,color,box-shadow] select-none disabled:opacity-45 disabled:pointer-events-none aria-disabled:opacity-45 aria-disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] no-underline'
const BUTTON_VARIANT = {
  primary: 'bg-primary-gradient text-white',
  dark: 'bg-contrast text-white hover:bg-contrast-hover',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line-strong shadow-[var(--shadow-xs)] hover:bg-subtle',
  soft: 'bg-brand-soft text-brand-ink ring-1 ring-inset ring-brand-line/60 hover:ring-brand-line',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  danger: 'text-danger-ink hover:bg-danger-soft',
  destructive: 'bg-danger-fill text-white shadow-[var(--shadow-xs)] hover:bg-danger-fill-hover',
  link: 'text-brand-ink hover:underline underline-offset-4 !h-auto !px-0',
} as const
// 44px on phones (Fitts, WCAG 2.5.5), a little tighter where a pointer is precise.
const BUTTON_SIZE = { sm: 'h-9 sm:h-8 px-3 text-[13px] rounded-sm', md: 'h-11 sm:h-10 px-4 text-sm rounded-md', lg: 'h-12 px-5 text-[15px] rounded-lg' } as const
const ICON_SIZE = { sm: 'size-3.5', md: 'size-4', lg: 'size-[18px]' } as const
export type ButtonVariant = keyof typeof BUTTON_VARIANT
export type ButtonSize = keyof typeof BUTTON_SIZE

export function buttonClass({ variant = 'secondary', size = 'md', block, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) {
  return cx(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], block && 'w-full', className)
}

type ButtonProps = {
  variant?: ButtonVariant; size?: ButtonSize; icon?: Icon; iconRight?: Icon; block?: boolean; loading?: boolean
  className?: string; children?: ReactNode; to?: string; href?: string; type?: 'button' | 'submit' | 'reset'
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> & { disabled?: boolean; form?: string; id?: string; 'aria-label'?: string }

export function Button({ variant = 'secondary', size = 'md', icon: IconL, iconRight: IconR, block, loading, className, children, to, href, type = 'button', disabled, ...rest }: ButtonProps) {
  const classes = buttonClass({ variant, size, block, className })
  const content = <>
    {IconL && <IconL className={cx(ICON_SIZE[size], 'shrink-0', loading && 'animate-spin')} aria-hidden />}
    {children}
    {IconR && <IconR className={cx(ICON_SIZE[size], 'shrink-0')} aria-hidden />}
  </>
  if (to !== undefined) return <Link to={to} className={classes} {...rest}>{content}</Link>
  if (href !== undefined) return <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...rest}>{content}</a>
  return <button type={type} {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={classes}>{content}</button>
}

export function Card({ className, children, as: Tag = 'section', ...rest }: { className?: string; children?: ReactNode; as?: 'section' | 'div' | 'article' | 'li' } & HTMLAttributes<HTMLElement>) {
  return <Tag {...rest} className={cx('overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line', className)}>{children}</Tag>
}

export function IconChip({ icon: I, tone = 'neutral', size = 'md', className }: { icon: Icon; tone?: Tone; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-line shadow-[var(--shadow-xs)]',
    size === 'sm' && 'size-8', size === 'md' && 'size-10', size === 'lg' && 'size-12', className)}>
    <I className={cx(size === 'sm' ? 'size-4' : 'size-[18px]', TONE_ICON[tone])} aria-hidden />
  </span>
}

export function CardHeader({ title, description, icon, iconTone = 'neutral', actions, className, titleId, as: H = 'h3' }: {
  title: ReactNode; description?: ReactNode; icon?: Icon; iconTone?: Tone; actions?: ReactNode; className?: string; titleId?: string; as?: 'h2' | 'h3'
}) {
  return <div className={cx('flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-5 py-4', className)}>
    <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
      {icon && <IconChip icon={icon} tone={iconTone} size="sm" />}
      <div className="min-w-0">
        <H id={titleId} className="m-0 text-title-3 break-words text-ink">{title}</H>
        {description && <p className="m-0 mt-0.5 text-[13px] break-words text-ink-3">{description}</p>}
      </div>
    </div>
    {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
  </div>
}

/** The arrow that goes back, at the top-left just before a page title (owner, 2026-10-31): 44px, named for where it goes. */
export function BackButton({ to, label, className }: { to: string; label: string; className?: string }) {
  return <Link to={to} aria-label={label} title={label}
    className={cx('-ml-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 no-underline transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]', className)}>
    <ArrowLeft className="size-5" aria-hidden />
  </Link>
}

export function PageHeader({ title, description, actions, eyebrow, titleRef, back }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; titleRef?: React.Ref<HTMLHeadingElement>
  /** Where Back goes, and its name: "Back to patients". Drawn as an arrow before the title. */
  back?: { to: string; label: string }
}) {
  return <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
    <div className="min-w-0 flex-[1_1_20rem]">
      {eyebrow && <div className={cx('mb-2', back && 'pl-[38px]')}>{eyebrow}</div>}
      <div className="flex items-center gap-1">
        {back ? <BackButton to={back.to} label={back.label} /> : null}
        <h1 ref={titleRef} tabIndex={-1} className="m-0 min-w-0 text-title-1 break-words text-ink outline-none">{title}</h1>
      </div>
      {description && <p className={cx('m-0 mt-1 max-w-2xl text-sm text-ink-2', back && 'pl-[38px]')}>{description}</p>}
    </div>
    {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
  </div>
}

export function SectionHeader({ title, count, description, action, id }: { title: ReactNode; count?: number | null; description?: ReactNode; action?: ReactNode; id?: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-tray px-4 py-2.5">
    <div className="flex min-w-0 flex-1 items-baseline gap-2">
      <h2 id={id} className="m-0 text-[14px] font-semibold text-ink">{title}</h2>
      {count != null && <span className="text-[13px] text-ink-3 tabular">({count})</span>}
      {description && <span className="hidden truncate text-[13px] text-ink-3 sm:inline">· {description}</span>}
    </div>
    {action}
  </div>
}

export function StatCard({ label, value, hint, icon, tone = 'neutral', trend, className, to }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: Icon; tone?: Tone; trend?: { value: string; direction: 'up' | 'down' }; className?: string; to?: string
}) {
  const body = <>
    {icon && <IconChip icon={icon} tone={tone} />}
    <div className={cx('flex flex-wrap items-center gap-2', icon && 'mt-3 sm:mt-5')}>
      <span className="min-w-0 [overflow-wrap:anywhere] text-[20px] leading-8 font-semibold tracking-[-0.02em] text-ink tabular sm:text-[26px] sm:leading-9">{value}</span>
      {trend && <TrendPill value={trend.value} direction={trend.direction} />}
    </div>
    <span className="mt-0.5 text-[13px] break-words text-ink-2 sm:text-sm">{label}</span>
    {hint && <span className="mt-1 text-xs text-ink-3">{hint}</span>}
  </>
  const cls = cx('flex min-w-0 flex-col rounded-xl bg-surface p-4 sm:p-5 shadow-[var(--shadow-card)] ring-1 ring-line', to && 'no-underline transition-shadow hover:shadow-[var(--shadow-pop)]', className)
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}

export function StatGroup({ children, cols = 4, className, label }: { children: ReactNode; cols?: 2 | 3 | 4; className?: string; label?: string }) {
  return <div role={label ? 'group' : undefined} aria-label={label} className={cx('grid gap-1.5 rounded-2xl bg-tray p-1.5',
      cols === 2 && 'grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))]',
      cols === 3 && 'grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))]',
      cols === 4 && 'hid-stat-grid-4', className)}>
    {children}
  </div>
}

export function TrendPill({ value, direction = 'up' }: { value: string; direction?: 'up' | 'down' }) {
  return <span className={cx('inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold ring-1 ring-inset', direction === 'up' ? TONE_SOFT.success : TONE_SOFT.danger)}>
    {direction === 'up' ? '↑' : '↓'} {value}
  </span>
}

export function Badge({ tone = 'neutral', icon: I, children, className, solid, size = 'md' }: { tone?: Tone; icon?: Icon; children: ReactNode; className?: string; solid?: boolean; size?: 'sm' | 'md' }) {
  return <span className={cx('inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-sm font-medium whitespace-nowrap ring-1 ring-inset',
    size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
    solid ? TONE_SOFT[tone] : cx('bg-surface', TONE_OUTLINE[tone]), className)}>
    {I && <I className={cx(size === 'sm' ? 'size-3' : 'size-3.5', 'shrink-0', !solid && TONE_ICON[tone])} aria-hidden />}
    {!I && <span className={cx('size-1.5 rounded-full', TONE_DOT[tone])} aria-hidden />}
    {children}
  </span>
}

/** The drawing that stands for an icon a screen already passes, by the icon's name (Lucide sets displayName). */
function illustrationFor(I: Icon | undefined): IllustrationName {
  const name = (I as { displayName?: string } | undefined)?.displayName ?? ''
  if (/Calendar|Clock/.test(name)) return 'calendar'
  if (/Flask|TestTube|Microscope/.test(name)) return 'flask'
  if (/Pill|Syringe/.test(name)) return 'pill'
  if (/Search|Compass/.test(name)) return 'search'
  if (/Inbox|Bell|Mail|Check|Send/.test(name)) return 'inbox'
  if (/File|Folder|Clipboard|Book|Notebook|Archive/.test(name)) return 'records'
  if (/User|Stethoscope|Contact|IdCard|Siren|Heart/.test(name)) return 'patient'
  return 'generic'
}

/**
 * Nothing to show (owner, 2026-10-31): a grey line drawing, the title in ink, one line in ink-3, the action as a normal
 * button. No box, no dashed border, no circle: it sits in whatever holds it. `illustration` names the drawing; a screen
 * that passes only `icon` gets the drawing that stands for it.
 */
export function EmptyState({ icon, illustration, title, description, action, compact, titleAs: Title = 'p' }: {
  icon?: Icon; illustration?: IllustrationName; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean
  /** A whole-page state (no access, not set up) names the page: pass 'h1' so the page keeps its one heading. */
  titleAs?: 'p' | 'h1' | 'h2' | 'h3'
}) {
  return <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-3 px-4 py-8' : 'gap-4 px-6 py-14')}>
    <Illustration name={illustration ?? illustrationFor(icon)} className={compact ? 'h-20 w-[100px]' : undefined} />
    <div className="min-w-0 max-w-full">
      <Title className="m-0 text-title-3 break-words text-ink">{title}</Title>
      {description && <p className="m-0 mx-auto mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>}
    </div>
    {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
  </div>
}

/* ---- Alert (paytrail alert.js): neutral surface, intent colour only on the icon and title. ---- */
export type Intent = 'success' | 'error' | 'warning' | 'info'
const INTENTS: Record<Intent, { icon: Icon; text: string; role: 'status' | 'alert'; label: string }> = {
  success: { icon: CircleCheck, text: 'text-intent-success', role: 'status', label: 'Success' },
  error: { icon: CircleAlert, text: 'text-intent-error', role: 'alert', label: 'Error' },
  warning: { icon: TriangleAlert, text: 'text-intent-warning', role: 'alert', label: 'Warning' },
  info: { icon: Info, text: 'text-intent-info', role: 'status', label: 'Info' },
}

export function Alert({ intent = 'info', title, children, icon, action, size = 'md', live = true, className, id }: {
  intent?: Intent; title?: ReactNode; children?: ReactNode; icon?: Icon; action?: ReactNode; /** Kept for callers; both draw the same quiet box (no colour stripe). */ variant?: 'surface' | 'accent'; size?: 'sm' | 'md'; live?: boolean; className?: string; id?: string
}) {
  const it = INTENTS[intent]
  const I = icon ?? it.icon
  const sm = size === 'sm'
  return <div id={id} role={live ? it.role : 'note'} data-intent={intent} className={cx('flex w-full flex-wrap gap-x-3 gap-y-2 rounded-lg border border-notice-line bg-notice text-left',
    sm ? 'px-3 py-2.5' : 'px-4 py-3.5', className)}>
    <I className={cx('shrink-0', sm ? 'mt-px size-4' : 'mt-0.5 size-[18px]', it.text)} strokeWidth={2} aria-hidden />
    <div className="min-w-0 flex-[1_1_10rem] break-words">
      <span className="sr-only">{it.label}: </span>
      {title && <p className={cx('m-0 font-medium leading-snug', sm ? 'text-[13px]' : 'text-sm', it.text)}>{title}</p>}
      {children && <div className={cx('leading-snug [&_a]:font-medium [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-medium [&_strong]:text-ink',
        sm ? 'text-[12.5px]' : 'text-[13.5px]', title ? 'mt-1 text-notice-body' : 'text-ink')}>{children}</div>}
    </div>
    {action && <div className="ml-auto max-w-full shrink-0 self-center">{action}</div>}
  </div>
}

/* ---- Forms ---- */
const CONTROL = 'w-full rounded-md bg-surface text-sm text-ink ring-1 ring-inset ring-line-control shadow-[var(--shadow-xs)] placeholder:text-ink-3 transition-shadow focus:outline-none focus:ring-brand focus:shadow-[var(--shadow-focus)] aria-[invalid=true]:ring-danger disabled:bg-subtle disabled:text-ink-3 border-0'

export function Field({ label, hint, error, children, className, htmlFor, optional, hintId, errorId }: {
  label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; optional?: boolean; hintId?: string; errorId?: string
}) {
  return <div className={cx('flex flex-col gap-1.5', className)}>
    {label && <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">{label} {optional && <span className="font-normal text-ink-3">(optional)</span>}</label>}
    {children}
    {error ? <p id={errorId} className="m-0 text-xs font-medium text-danger-ink">{error}</p> : hint && <p id={hintId} className="m-0 text-xs text-ink-3">{hint}</p>}
  </div>
}

export function Input({ className, icon: I, prefix, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { icon?: Icon; prefix?: string }) {
  if (I || prefix) return <div className={cx('relative', className)}>
    {I && <I className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />}
    {prefix && <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-ink-3">{prefix}</span>}
    <input {...rest} className={cx(CONTROL, 'h-10 pr-3', I ? 'pl-10' : 'pl-8')} />
  </div>
  return <input {...rest} className={cx(CONTROL, 'h-10 px-3.5', className)} />
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(CONTROL, 'px-3.5 py-2.5 leading-relaxed', className)} />
}

export function Select({ className, children, controlSize = 'md', ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { controlSize?: 'sm' | 'md' }) {
  return <div className={cx('relative', className)}>
    <select {...rest} className={cx(CONTROL, 'appearance-none pr-9', controlSize === 'sm' ? 'h-8 rounded-sm pl-2.5 text-[13px]' : 'h-10 pl-3.5')}>{children}</select>
    <svg className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  </div>
}

/* ---- Lists ---- */
export function ListRow({ to, leading, title, subtitle, trailing, className, onClick }: {
  to?: string; leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; className?: string; onClick?: () => void
}) {
  const inner = <>
    {leading}
    <div className="min-w-0 flex-[1_1_10rem]">
      <div className="text-sm font-medium break-words text-ink">{title}</div>
      {subtitle && <div className="mt-0.5 text-[13px] break-words text-ink-3">{subtitle}</div>}
    </div>
    {trailing && <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">{trailing}</div>}
  </>
  const cls = cx('flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5', (to || onClick) && 'no-underline transition-colors hover:bg-subtle', className)
  if (to) return <Link to={to} className={cls}>{inner}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cx(cls, 'w-full border-0 bg-transparent text-left')}>{inner}</button>
  return <div className={cls}>{inner}</div>
}

export function Avatar({ name = '', src, size = 'md', color }: { name?: string; src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; color?: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'
  const sizes = { sm: 'size-7 text-[11px]', md: 'size-9 text-xs', lg: 'size-12 text-sm', xl: 'size-16 text-lg' }
  if (src) return <img src={src} alt="" className={cx('shrink-0 rounded-full bg-white object-cover ring-1 ring-line', sizes[size])} />
  return <span aria-hidden="true" className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', sizes[size], !color && 'bg-brand-soft text-brand-ink')}
    style={color ? { background: color, color: '#fff' } : undefined}>{letters}</span>
}

export function DescriptionList({ items, className }: { items: Array<[ReactNode, ReactNode] | false | null | undefined>; className?: string }) {
  return <dl className={cx('m-0 divide-y divide-line', className)}>
    {items.filter((x): x is [ReactNode, ReactNode] => Boolean(x)).map(([term, value], i) => (
      <div key={i} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-0.5 px-5 py-3 text-sm">
        <dt className="max-w-full text-ink-3">{term}</dt>
        <dd className="m-0 ml-auto min-w-0 max-w-full flex-[0_1_auto] text-right font-medium break-words text-ink">{value}</dd>
      </div>
    ))}
  </dl>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-mono text-[11px] text-ink-3">{children}</kbd>
}

/** paytrail page-skeleton.js: shown the instant a page opens, while its data loads. */
export function PageSkeleton({ rows = 6, stats = true }: { rows?: number; stats?: boolean }) {
  const bar = 'animate-pulse rounded-md bg-hover'
  return <div className="flex flex-col gap-8" aria-busy="true" role="status">
    <span className="sr-only">Loading…</span>
    <div className="flex flex-col gap-2"><div className={`${bar} h-8 w-56`} /><div className={`${bar} h-4 w-80 max-w-full`} /></div>
    {stats && <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-3">
      {[0, 1, 2, 3].map(i => <div key={i} className="h-[104px] rounded-xl bg-surface p-5 ring-1 ring-line"><div className={`${bar} h-3 w-24`} /><div className={`${bar} mt-4 h-7 w-32`} /></div>)}
    </div>}
    <div className="rounded-xl bg-surface ring-1 ring-line">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
        <div className={`${bar} size-9 rounded-full`} /><div className="flex-1 space-y-2"><div className={`${bar} h-3.5 w-1/3`} /><div className={`${bar} h-3 w-1/4`} /></div><div className={`${bar} h-4 w-20`} />
      </div>)}
    </div>
  </div>
}

/** paytrail's filter tabs (document-list.js): a tray of links, the current one lifted onto a white chip. */
export function FilterTabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (value: T) => void; options: ReadonlyArray<{ value: T; label: string; count?: number; tone?: 'danger' }>; label: string
}) {
  return <nav className="inline-flex max-w-full flex-wrap items-center gap-0.5 self-start rounded-lg bg-tray p-1" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
      className={cx('inline-flex h-10 sm:h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 px-3 text-[13px] font-medium whitespace-nowrap',
        value === o.value ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-3 hover:text-ink')}>
      {o.label}{o.count != null && <span className={cx('tabular', o.tone === 'danger' && o.count ? 'text-danger-ink' : 'text-ink-3')}>{o.count}</span>}
    </button>)}
  </nav>
}

/** paytrail's dashboard activity timeline: a dot, who did what, and when. */
export function Timeline({ items, empty }: { items: ReadonlyArray<{ id: string; who?: ReactNode; text: ReactNode; when: ReactNode; to?: string; tone?: Tone }>; empty: ReactNode }) {
  if (items.length === 0) return <p className="m-0 px-5 py-6 text-[13px] text-ink-3">{empty}</p>
  return <ol className="m-0 list-none space-y-4 px-5 py-4">
    {items.map(a => <li key={a.id} className="flex gap-3 text-[13px]">
      <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', a.tone ? TONE_DOT[a.tone] : 'bg-brand-fill/60')} />
      <span className="min-w-0 break-words">
        <span className="text-ink">{a.who && <strong className="font-medium">{a.who} </strong>}{a.to ? <Link to={a.to} className="text-ink no-underline hover:underline">{a.text}</Link> : a.text}</span>
        <span className="block text-xs text-ink-3">{a.when}</span>
      </span>
    </li>)}
  </ol>
}

/** "Good evening" in Lagos time, as paytrail greets. */
export function greeting(now = new Date()) {
  const h = Number(now.toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** "3 min ago", "yesterday", "12 Oct": paytrail's timeAgo. */
export function timeAgo(value: string | null | undefined, now = Date.now()) {
  if (!value) return ''
  const t = Date.parse(value)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  if (s < 604800) return `${Math.round(s / 86400)} days ago`
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}
