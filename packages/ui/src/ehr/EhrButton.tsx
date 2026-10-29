'use client'

/**
 * EHR buttons: always a native <button>, type="button" unless told otherwise.
 * The browser turns Enter and Space into a click, so there is no key handler
 * here: one would fire the action twice.
 *
 * A busy button keeps its label and width, says so with aria-busy, and ignores
 * further clicks. It is busy while `busy` is set, and on its own while a
 * promise returned by onClick is pending.
 */

import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react'
import { cx } from '../primitives'

export type EhrButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type EhrButtonSize = 'md' | 'sm'

interface EhrButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  readonly variant?: EhrButtonVariant
  /** 40px (md) or 30px (sm) high. */
  readonly size?: EhrButtonSize
  readonly busy?: boolean
  /** Return a promise to hold the button busy until it settles. */
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>
  readonly ref?: Ref<HTMLButtonElement>
}

export interface EhrButtonProps extends EhrButtonBaseProps {
  /** A decorative icon before the label. */
  readonly icon?: ReactNode
  readonly children: ReactNode
}

export function EhrButton({ icon, children, className, ...props }: EhrButtonProps) {
  return (
    <ButtonBase {...props} className={className}>
      {icon !== undefined ? <span className="hid-ehr-button-icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </ButtonBase>
  )
}

export interface EhrIconButtonProps extends Omit<EhrButtonBaseProps, 'aria-label' | 'children'> {
  /** The button's only name: an icon has none. */
  readonly 'aria-label': string
  readonly icon: ReactNode
}

export function EhrIconButton({ icon, className, ...props }: EhrIconButtonProps) {
  return (
    <ButtonBase {...props} className={cx('hid-ehr-icon-button', className)}>
      <span className="hid-ehr-button-icon" aria-hidden="true">{icon}</span>
    </ButtonBase>
  )
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function'
}

function ButtonBase({
  variant = 'primary',
  size = 'md',
  busy = false,
  type = 'button',
  className,
  onClick,
  ref,
  children,
  ...rest
}: EhrButtonBaseProps & { readonly children: ReactNode }) {
  const [pending, setPending] = useState(false)
  // Set at once, so a second click before React re-renders is ignored too.
  const pendingRef = useRef(false)
  const showBusy = busy || pending

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (showBusy || pendingRef.current) {
      event.preventDefault()
      return
    }
    const result: unknown = onClick?.(event)
    if (isPromiseLike(result)) {
      pendingRef.current = true
      setPending(true)
      const settle = () => {
        pendingRef.current = false
        setPending(false)
      }
      result.then(settle, settle)
    }
  }

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        'hid-ehr-button',
        variant !== 'primary' && `hid-ehr-button-${variant}`,
        size === 'sm' && 'hid-ehr-button-sm',
        className,
      )}
      aria-busy={showBusy || undefined}
      aria-disabled={showBusy ? true : rest['aria-disabled']}
      onClick={handleClick}
    >
      {children}
    </button>
  )
}
