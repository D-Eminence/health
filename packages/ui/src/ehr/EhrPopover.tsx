'use client'

/**
 * A small panel anchored to the button that opens it (the account menu, the demo chip, the connection status). It is
 * not modal: the page stays usable. The button says whether it is open (aria-expanded) and which panel it controls;
 * Escape and a press outside close it, and Escape returns focus to the button. It never holds a form that needs saving.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../primitives'

export interface EhrPopoverProps {
  /** The button's content: its name, unless `triggerLabel` gives one. */
  readonly trigger: ReactNode
  /** The button's accessible name when its content is not text (an avatar). */
  readonly triggerLabel?: string
  /** The panel's name, read as it opens. */
  readonly label: string
  /** The panel's content; `close` shuts it, for an item that acts. */
  readonly children: (close: (returnFocus?: boolean) => void) => ReactNode
  /** Which edge of the button the panel lines up with. */
  readonly align?: 'start' | 'end'
  /** Opens upwards, for a button at the bottom of the screen. */
  readonly placement?: 'below' | 'above'
  readonly className?: string
  readonly triggerClassName?: string
}

export function EhrPopover({
  trigger,
  triggerLabel,
  label,
  children,
  align = 'end',
  placement = 'below',
  className,
  triggerClassName,
}: EhrPopoverProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const refocus = useRef(false)

  const close = (returnFocus = true) => {
    refocus.current = returnFocus
    setOpen(false)
  }

  // Into the panel as it opens; back to the button when it closes by Escape or an item.
  useLayoutEffect(() => {
    if (open) {
      panelRef.current?.focus()
      return
    }
    if (refocus.current) {
      refocus.current = false
      buttonRef.current?.focus()
    }
  }, [open])

  // A press anywhere outside closes it, leaving focus where the press put it.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }

  return (
    <div ref={rootRef} className={cx('hid-ehr-popover', className)} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={cx('hid-ehr-button', 'hid-ehr-button-secondary', 'hid-ehr-popover-trigger', triggerClassName)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={triggerLabel}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {trigger}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className={cx('hid-ehr-popover-panel', align === 'start' && 'hid-ehr-popover-start', placement === 'above' && 'hid-ehr-popover-above')}
        role="region"
        aria-label={label}
        tabIndex={-1}
        hidden={!open}
      >
        {open ? children(close) : null}
      </div>
    </div>
  )
}
