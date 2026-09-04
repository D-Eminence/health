/**
 * The primitives every Health ID surface is built from.
 *
 * These exist so a heading, a button or a section band is defined once and
 * reused, rather than each page restating a font stack and a padding value.
 * They carry no product content and make no network calls, which is what keeps
 * them genuinely shareable between the public site and the authenticated
 * applications.
 */

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ElementType, ReactNode } from 'react'

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

/** The content column. One max-width for the whole site. */
export function Wrap({ children, className }: WrapProps) {
  return (
    <div className={cx('mx-auto w-full max-w-(--container-wrap) px-5 sm:px-8 lg:px-12', className)}>
      {children}
    </div>
  )
}

export interface SectionProps {
  readonly children: ReactNode
  readonly id?: string
  /** `tight` for a closing call to action; `default` for a full band. */
  readonly rhythm?: 'default' | 'tight'
  /** Inverted navy band. Sets the inverse tokens for everything inside. */
  readonly tone?: 'plain' | 'sunk' | 'inverse'
  readonly className?: string
  readonly labelledBy?: string
}

const RHYTHM = {
  default: 'py-16 sm:py-20 lg:py-24',
  tight: 'py-12 sm:py-14 lg:py-16',
} as const

const TONE = {
  plain: 'bg-surface text-ink',
  sunk: 'bg-surface-tint text-ink',
  inverse: 'bg-inverse-surface text-inverse-ink',
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
 * Sizes are fluid so a headline holds its proportions from phone to desktop
 * without a breakpoint for every step.
 */
const DISPLAY_SIZE = {
  xl: 'text-[clamp(2.375rem,5.4vw,4.25rem)] leading-[1.04] tracking-[-0.025em]',
  lg: 'text-[clamp(1.875rem,4.2vw,3.5rem)] leading-[1.08]',
  md: 'text-[clamp(1.625rem,3vw,2.5rem)] leading-[1.1]',
  sm: 'text-[clamp(1.3125rem,2vw,1.6875rem)] leading-[1.16]',
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
        'text-base/relaxed text-muted',
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

/** The small uppercase label that opens a section. */
export function Eyebrow({ children, tone = 'plain', className }: EyebrowProps) {
  const tones = {
    plain: 'bg-surface-sunk text-muted',
    outline: 'border border-line bg-surface text-brand',
    inverse: 'bg-white/10 text-white/75',
  } as const

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-(--radius-control) px-3.5 py-1.5 font-mono text-[11px] font-medium tracking-[0.14em] uppercase',
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

type ButtonTone = 'primary' | 'secondary' | 'inverse'
type ButtonSize = 'md' | 'sm'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-(--radius-control) font-semibold whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

const BUTTON_TONE: Record<ButtonTone, string> = {
  primary: 'bg-brand text-white border border-brand hover:bg-brand-dark hover:border-brand-dark',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-brand hover:text-brand',
  inverse: 'bg-white text-ink border border-white hover:bg-white/90',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: 'px-7 py-3.5 text-[15px]',
  sm: 'px-5 py-2.5 text-sm',
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

/**
 * The trailing arrow used on inline "keep going" links.
 * Decorative, so it is hidden from assistive technology — the link text
 * already says where it leads.
 */
export function Arrow({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx('ml-1', className)}>
      &rarr;
    </span>
  )
}

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly children: ReactNode
}

export function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <a
      className={cx(
        'inline-flex items-center font-semibold text-brand hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  )
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export interface CardProps {
  readonly children: ReactNode
  readonly className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cx('rounded-(--radius-panel) border border-line bg-surface', className)}>
      {children}
    </div>
  )
}

export interface SectionHeaderProps {
  readonly eyebrow?: string
  readonly title: ReactNode
  readonly lede?: ReactNode
  readonly align?: 'center' | 'left'
  readonly tone?: 'plain' | 'inverse'
  readonly id?: string
  readonly size?: DisplayProps['size']
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
}: SectionHeaderProps) {
  return (
    <div className={cx('flex flex-col gap-4', align === 'center' ? 'items-center' : 'items-start')}>
      {eyebrow ? <Eyebrow tone={tone === 'inverse' ? 'inverse' : 'plain'}>{eyebrow}</Eyebrow> : null}
      <Display
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
