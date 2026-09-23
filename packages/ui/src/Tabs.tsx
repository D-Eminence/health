'use client'

import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from './primitives'

/**
 * An accessible tab set.
 *
 * Implements the WAI-ARIA tabs pattern properly, because a row of buttons that
 * swaps a panel is not the same thing: this gives arrow-key movement, Home and
 * End, a roving tabindex so Tab enters and leaves the set in one step, and the
 * `aria-controls` / `aria-labelledby` pairing that tells a screen reader which
 * panel belongs to which tab.
 *
 * Shared rather than written per section, so the six tabbed surfaces across the
 * ecosystem behave identically.
 */

export interface TabItem {
  /** Stable identifier. Used in generated element ids, so keep it URL-safe. */
  readonly id: string
  readonly label: string
}

export interface TabsProps {
  readonly items: readonly TabItem[]
  readonly selectedId: string
  readonly onSelect: (id: string) => void
  /** Names the tab list for assistive technology. */
  readonly label: string
  /**
   * `pill` for filter chips, `underline` for section navigation, `strip` for the
   * full-width segmented bar the module switcher uses — equal columns divided by
   * hairlines, with the selected column raised on a white surface.
   */
  readonly variant?: 'pill' | 'underline' | 'strip'
  readonly className?: string
  /** Namespace for the generated ids, so panels can reference them. */
  readonly idPrefix: string
}

export function TabList({
  items,
  selectedId,
  onSelect,
  label,
  variant = 'underline',
  className,
  idPrefix,
}: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex(item => item.id === selectedId)
    if (index < 0) return

    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1

    if (next === null) return
    event.preventDefault()

    const target = items[next]
    if (!target) return
    onSelect(target.id)
    // Follow focus, which is the expected behaviour for tabs that activate on
    // selection rather than on Enter.
    refs.current[target.id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={move}
      className={cx(
        'flex',
        variant === 'strip'
          ? 'overflow-x-auto border-y border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'gap-1 overflow-x-auto',
        variant === 'underline' && 'border-b border-line',
        className,
      )}
    >
      {items.map(item => {
        const selected = item.id === selectedId

        return (
          <button
            key={item.id}
            ref={element => {
              refs.current[item.id] = element
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            // Only the selected tab is in the tab order; arrows move within.
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(item.id)}
            className={cx(
              'shrink-0 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              variant !== 'strip' && 'transition-colors',
              variant === 'pill' &&
                cx(
                  'rounded-(--radius-control) border px-4 py-2',
                  selected
                    ? 'border-brand bg-brand text-white shadow-[0_8px_20px_rgba(8,109,217,0.28)]'
                    : 'border-white/70 bg-white/60 text-muted backdrop-blur-md hover:border-white hover:bg-white/80 hover:text-ink',
                ),
              variant === 'underline' &&
                cx(
                  'border-b-2 px-4 py-3',
                  selected
                    ? 'border-brand text-brand'
                    : 'border-transparent text-muted hover:text-ink',
                ),
              variant === 'strip' &&
                cx(
                  'flex-1 px-3 py-[22px] text-[15px] transition-[background-color,color,box-shadow] duration-200',
                  selected
                    ? 'bg-surface font-semibold text-ink shadow-[0_8px_20px_rgba(15,39,66,0.06)]'
                    : 'text-faint hover:text-ink',
                ),
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export interface TabPanelProps {
  readonly id: string
  readonly idPrefix: string
  readonly children: ReactNode
  readonly className?: string
}

export function TabPanel({ id, idPrefix, children, className }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      // Focusable so a keyboard user can reach panel content that holds no
      // controls of its own.
      tabIndex={0}
      className={cx('focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand', className)}
    >
      {children}
    </div>
  )
}

/** Wires the selected-tab state, since every caller needs the same three lines. */
export function useTabs(items: readonly TabItem[], initialId?: string) {
  const idPrefix = useId().replace(/:/g, '')
  const [selectedId, setSelectedId] = useState(initialId ?? items[0]?.id ?? '')

  return { selectedId, setSelectedId, idPrefix }
}
