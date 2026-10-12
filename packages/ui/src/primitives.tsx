/**
 * The primitives every Health ID surface is built from.
 *
 * These exist so a heading, a button or a section band is defined once and
 * reused, rather than each page restating a font stack and a padding value.
 * They carry no product content and make no network calls, which is what keeps
 * them genuinely shareable between the public site and the authenticated
 * applications.
 */

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ElementType,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react'

/** Joins class names, dropping anything falsy. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface WrapProps {
  readonly children: ReactNode
  readonly className?: string
}

/** Broad by default; dense product screens should retain usable width. */
export function Wrap({ children, className }: WrapProps) {
  return (
    <div className={cx('mx-auto w-full max-w-(--container-wrap) px-4 sm:px-5 lg:px-6', className)}>
      {children}
    </div>
  )
}

export interface SectionProps {
  readonly children: ReactNode
  readonly id?: string
  /** `tight` for a closing call to action; `default` for a full band. */
  readonly rhythm?: 'default' | 'tight'
  /**
   * `wash` is a pale-blue solid band for occasional emphasis. It remains
   * intentionally quiet so hierarchy comes from spacing and product UI rather
   * than a decorative colour treatment.
   */
  readonly tone?: 'plain' | 'sunk' | 'inverse' | 'wash'
  readonly className?: string
  readonly labelledBy?: string
}

const RHYTHM = {
  default: 'py-12 sm:py-14 lg:py-20',
  tight: 'py-8 sm:py-10 lg:py-12',
} as const

const TONE = {
  plain: 'bg-surface text-ink',
  sunk: 'bg-surface-tint text-ink',
  inverse: 'bg-inverse-surface text-inverse-ink',
  wash: 'bg-brand-tint text-ink',
} as const

export function Section({
  children,
  id,
  rhythm = 'default',
  tone = 'plain',
  className,
  labelledBy,
}: SectionProps) {
  return (
    <section
      {...(id ? { id } : {})}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
      className={cx(RHYTHM[rhythm], TONE[tone], className)}
    >
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export interface DisplayProps {
  readonly children: ReactNode
  readonly as?: ElementType
  readonly size?: 'xl' | 'lg' | 'md' | 'sm'
  readonly className?: string
  readonly id?: string
}

/**
 * The serif display face, used for headings only.
 * Waya display type stays deliberately compact: it adds editorial character
 * without making an application screen feel like a campaign page.
 */
const DISPLAY_SIZE = {
  xl: 'text-[clamp(2.4375rem,4vw,3rem)] leading-[1.06] tracking-[-0.03em]',
  lg: 'text-[clamp(2rem,3.5vw,2.5rem)] leading-[1.08] tracking-[-0.025em]',
  md: 'text-[clamp(1.625rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em]',
  sm: 'text-[1.25rem] leading-[1.2] tracking-[-0.015em]',
} as const

export function Display({ children, as: Tag = 'h2', size = 'lg', className, id }: DisplayProps) {
  return (
    <Tag
      {...(id ? { id } : {})}
      className={cx('font-display font-normal text-balance', DISPLAY_SIZE[size], className)}
    >
      {children}
    </Tag>
  )
}

export interface LedeProps {
  readonly children: ReactNode
  readonly align?: 'center' | 'left'
  readonly className?: string
}

export function Lede({ children, align = 'center', className }: LedeProps) {
  return (
    <p
      className={cx(
        'text-[15px]/[1.45] text-muted',
        align === 'center' ? 'mx-auto max-w-[560px] text-center' : 'max-w-[560px]',
        className,
      )}
    >
      {children}
    </p>
  )
}

export interface EyebrowProps {
  readonly children: ReactNode
  readonly tone?: 'plain' | 'inverse' | 'outline'
  readonly className?: string
}

/** The small label that opens a section without becoming a decorative pill. */
export function Eyebrow({ children, tone = 'plain', className }: EyebrowProps) {
  const tones = {
    plain: 'text-muted',
    outline: 'text-brand',
    inverse: 'text-inverse-muted',
  } as const

  return (
    <span
      className={cx(
        'inline-flex items-center font-sans text-[11px] font-medium tracking-[0.1em] uppercase',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type ButtonTone = 'primary' | 'neutral' | 'secondary' | 'quiet' | 'inverse'
type ButtonSize = 'md' | 'sm'

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-(--radius-button) font-sans text-[14px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 ease-(--ease-standard) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-45'

const BUTTON_TONE: Record<ButtonTone, string> = {
  primary: 'border border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover active:border-brand-active active:bg-brand-active',
  neutral: 'border border-inverse-surface bg-inverse-surface text-inverse-ink hover:opacity-90 active:opacity-80',
  secondary: 'border border-line-strong bg-surface text-ink hover:border-brand-border hover:bg-brand-tint hover:text-brand active:bg-brand-tint-hover',
  quiet: 'border border-transparent bg-transparent text-ink hover:bg-surface-hover active:bg-surface-selected',
  inverse: 'border border-inverse-ink bg-inverse-ink text-inverse-surface hover:opacity-90 active:opacity-80',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: 'h-[38px] px-3.5',
  sm: 'h-8 px-3 text-[13px]',
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly tone?: ButtonTone
  readonly size?: ButtonSize
}

/** A link styled as a button. Used for navigation; renders an anchor. */
export function ButtonLink({ tone = 'primary', size = 'md', className, ...rest }: ButtonLinkProps) {
  return <a className={cx(BUTTON_BASE, BUTTON_TONE[tone], BUTTON_SIZE[size], className)} {...rest} />
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: ButtonTone
  readonly size?: ButtonSize
}

/** A button that performs an action. Never use it for navigation. */
export function Button({
  tone = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(BUTTON_BASE, BUTTON_TONE[tone], BUTTON_SIZE[size], className)}
      {...rest}
    />
  )
}

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly children: ReactNode
}

export function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <a
      className={cx(
        'inline-flex items-center gap-2 font-semibold text-brand transition-colors duration-150 hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  )
}

// ---------------------------------------------------------------------------
// Forms and feedback
// ---------------------------------------------------------------------------

// Field, Input, Textarea and Select live in Field.tsx, a client module: Field
// reaches its control through context, which React's server build lacks.

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Accessible name; use a visible Field label where search context is not self-evident. */
  readonly label: string
  readonly startAdornment?: ReactNode
  readonly endAdornment?: ReactNode
}

/** A 44px search shell that keeps icon controls inside one integrated input. */
export function SearchField({ label, startAdornment, endAdornment, className, ...rest }: SearchFieldProps) {
  return (
    <div className="relative flex h-11 w-full items-center rounded-(--radius-pill) border border-line-control bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand focus-within:ring-2 focus-within:ring-brand/25">
      {startAdornment ? <span aria-hidden="true" className="ml-3.5 flex shrink-0 text-muted">{startAdornment}</span> : null}
      <input
        type="search"
        aria-label={label}
        className={cx('h-full min-w-0 flex-1 bg-transparent px-3 text-[14px] text-ink outline-none placeholder:text-faint', className)}
        {...rest}
      />
      {endAdornment ? <span className="mr-2 flex shrink-0">{endAdornment}</span> : null}
    </div>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly size?: 'sm' | 'md'
  readonly 'aria-label': string
}

/** A labelled interaction target around a compact Hugeicons glyph. */
export function IconButton({ size = 'sm', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-(--radius-button) border border-transparent text-muted transition-[background-color,color,border-color] duration-150 hover:bg-surface-hover hover:text-ink active:bg-surface-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-8 w-8' : 'h-[38px] w-[38px]',
        className,
      )}
      {...rest}
    />
  )
}

type BadgeTone = 'neutral' | 'information' | 'success' | 'warning' | 'danger'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone
  readonly children: ReactNode
}

/** Compact status text. Callers can include a Hugeicon when colour alone is insufficient. */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'border-line-strong bg-surface-tint text-muted',
    information: 'border-brand-border bg-brand-tint text-brand',
    success: 'border-positive/20 bg-positive/10 text-positive-ink',
    warning: 'border-caution/20 bg-caution/10 text-caution-ink',
    danger: 'border-critical/20 bg-critical/10 text-critical',
  }

  return (
    <span
      className={cx('inline-flex min-h-5 items-center gap-1 rounded-(--radius-pill) border px-2 text-[11px] font-medium leading-none', tones[tone], className)}
      {...rest}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded-(--radius-compact) bg-surface-selected', className)} {...rest} />
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly icon?: ReactNode
  readonly action?: ReactNode
}

/** A restrained, useful empty state; no mandatory illustration or decoration. */
export function EmptyState({ title, description, icon, action, className, ...rest }: EmptyStateProps) {
  return (
    <div className={cx('flex min-h-48 flex-col items-start justify-center rounded-(--radius-card) border-[0.5px] border-line bg-surface-sunk p-5', className)} {...rest}>
      {icon ? <span aria-hidden="true" className="mb-3 text-brand">{icon}</span> : null}
      <h2 className="text-[18px] font-medium leading-[1.25] text-ink">{title}</h2>
      {description ? <p className="mt-2 max-w-[52ch] text-[14px] leading-[1.45] text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export interface CardProps {
  readonly children: ReactNode
  readonly className?: string
  /** Retained only for compatibility; raised cards use a quiet surface. */
  readonly glass?: boolean
}

const CARD_SOLID = 'rounded-(--radius-card) border-[0.5px] border-line bg-surface'

/**
 * Compatibility export for older callers. Waya elevation is quiet: it avoids
 * blur and reserves shadows for menus, popovers and dialogs.
 */
export const glassSurface =
  'border-[0.5px] border-line bg-surface shadow-none'

const CARD_GLASS = `rounded-(--radius-card) ${glassSurface}`

export function Card({ children, className, glass = false }: CardProps) {
  return <div className={cx(glass ? CARD_GLASS : CARD_SOLID, className)}>{children}</div>
}

export interface SectionHeaderProps {
  readonly eyebrow?: string
  readonly title: ReactNode
  readonly lede?: ReactNode
  readonly align?: 'center' | 'left'
  readonly tone?: 'plain' | 'inverse'
  readonly id?: string
  readonly size?: DisplayProps['size']
  /** `h1` when the header opens a page rather than a section within one. */
  readonly as?: ElementType
}

/** Eyebrow + heading + lede, composed the same way in every section. */
export function SectionHeader({
  eyebrow,
  title,
  lede,
  align = 'center',
  tone = 'plain',
  id,
  size = 'lg',
  as,
}: SectionHeaderProps) {
  return (
    <div className={cx('flex flex-col gap-4', align === 'center' ? 'items-center' : 'items-start')}>
      {eyebrow ? <Eyebrow tone={tone === 'inverse' ? 'inverse' : 'plain'}>{eyebrow}</Eyebrow> : null}
      <Display
        {...(as ? { as } : {})}
        size={size}
        id={id}
        className={cx(align === 'center' && 'text-center', tone === 'inverse' && 'text-white')}
      >
        {title}
      </Display>
      {lede ? (
        <Lede align={align} className={tone === 'inverse' ? 'text-inverse-muted' : undefined}>
          {lede}
        </Lede>
      ) : null}
    </div>
  )
}
