import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

export interface MoreActionItem {
  readonly id: string
  readonly label: string
}

/**
 * "More actions": the live actions the design's Available actions card does not show (the owner's decision), behind
 * one menu button at the end of that card. The button says it opens a menu (aria-haspopup) and whether it is open;
 * the menu's items are reached with the arrow keys, Home and End, chosen with Enter or Space, and Escape or a press
 * outside closes it. Choosing an item closes the menu, returns focus to the button and calls `onSelect`, which opens
 * the same form as before.
 */
export function MoreActions({ items, selected, onSelect, label = 'More actions' }: {
  items: readonly MoreActionItem[]
  /** The item whose form is open, if any, so the button can say so. */
  selected?: string | null
  onSelect: (id: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  // Which item has focus while the menu is open; -1 asks for the last one.
  const [focusIndex, setFocusIndex] = useState(0)
  const menuId = useId()
  const buttonId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const refocus = useRef(false)

  useLayoutEffect(() => {
    if (open) {
      const index = focusIndex < 0 ? items.length - 1 : Math.min(focusIndex, items.length - 1)
      itemRefs.current[index]?.focus()
      return
    }
    if (refocus.current) {
      refocus.current = false
      buttonRef.current?.focus()
    }
  }, [open, focusIndex, items.length])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  if (items.length === 0) return null

  const show = (index: number) => { setFocusIndex(index); setOpen(true) }
  const close = (returnFocus: boolean) => { refocus.current = returnFocus; setOpen(false) }
  const choose = (id: string) => { close(true); onSelect(id) }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); show(0) }
    if (event.key === 'ArrowUp') { event.preventDefault(); show(-1) }
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = items.length
    const current = itemRefs.current.findIndex(item => item === document.activeElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (current + 1) % count
    else if (event.key === 'ArrowUp') next = (current - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    } else if (event.key === 'Tab') {
      close(false)
      return
    }
    if (next === null) return
    event.preventDefault()
    setFocusIndex(next)
    itemRefs.current[next]?.focus()
  }

  const chosen = items.find(item => item.id === selected)
  return (
    <div ref={rootRef} className="hid-ehr-clinical-more">
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className="hid-ehr-button hid-ehr-button-secondary hid-ehr-clinical-more-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show(0))}
        onKeyDown={onButtonKeyDown}
      >
        {label}
        {chosen ? <span className="hid-ehr-sr-only">{`, ${chosen.label} open`}</span> : null}
        <span aria-hidden="true" className="hid-ehr-clinical-more-caret">▾</span>
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-labelledby={buttonId} className="hid-ehr-clinical-more-menu" onKeyDown={onMenuKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={element => { itemRefs.current[index] = element }}
              type="button"
              role="menuitem"
              tabIndex={index === focusIndex || (focusIndex < 0 && index === items.length - 1) ? 0 : -1}
              className="hid-ehr-clinical-more-item"
              onClick={() => choose(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
