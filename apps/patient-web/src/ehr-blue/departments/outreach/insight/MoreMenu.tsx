import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Ellipsis } from 'lucide-react'
import { cx, type Icon } from '../../../../kasuwa/ui'

export interface MoreItem {
  readonly id: string
  readonly label: string
  readonly icon: Icon
  readonly onSelect: () => void
}

/**
 * A page's secondary actions folded into one "More" (⋯) button (Hick: one focal point, not a row of buttons). It opens a
 * short list of buttons under it; Escape or a press outside closes it and focus goes back to the button.
 */
export function MoreMenu({ id, items, label, currentId, className }: {
  readonly id: string
  readonly items: readonly MoreItem[]
  /**
   * Words on the button in place of ⋯ (a campaign's section switcher: "More", or the section shown from it): `text` is
   * shown, `name` is the button's accessible name (it holds `text`). Choosing an item then puts focus back on the button.
   */
  readonly label?: { readonly text: string; readonly name: string; readonly selected: boolean }
  /** The item shown now (aria-current). */
  readonly currentId?: string
  readonly className?: string
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()

  useLayoutEffect(() => {
    if (open) box.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      const target = event.target as Node
      if (!box.current?.contains(target) && !button.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => { document.removeEventListener('pointerdown', away) }
  }, [open])

  if (!items.length) return null
  return (
    <div className={cx('relative', className)} onKeyDown={event => {
      if (event.key !== 'Escape' || !open) return
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }}>
      {label ? (
        <button ref={button} id={id} type="button" aria-label={label.name} aria-expanded={open} aria-controls={open ? listId : undefined}
          onClick={() => setOpen(value => !value)}
          className={cx('inline-flex h-11 w-full cursor-pointer items-center justify-center gap-1 rounded-lg border-0 px-2.5 text-[14px] font-medium whitespace-nowrap',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
            label.selected ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-2 hover:text-ink')}>
          <span className="min-w-0 truncate">{label.text}</span><ChevronDown className="size-4 shrink-0" aria-hidden />
        </button>
      ) : (
        <button ref={button} id={id} type="button" aria-label="More" title="More" aria-expanded={open} aria-controls={open ? listId : undefined}
          onClick={() => setOpen(value => !value)}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-0 bg-surface text-ink-2 ring-1 ring-line-control ring-inset transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
          <Ellipsis className="size-5" aria-hidden />
        </button>
      )}
      {open ? (
        <div ref={box} id={listId} className="absolute right-0 z-40 mt-2 min-w-56 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-line">
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map(item => (
              <li key={item.id}>
                <button type="button" id={item.id} aria-current={item.id === currentId || undefined}
                  onClick={() => { setOpen(false); item.onSelect(); if (label) button.current?.focus() }}
                  className={cx('flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 text-left text-[15px] text-ink hover:bg-hover',
                    item.id === currentId && 'bg-hover font-semibold',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]')}>
                  <item.icon className="size-4 shrink-0 text-ink-3" aria-hidden />{item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
