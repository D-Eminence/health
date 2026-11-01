'use client'

/**
 * A keyboard-first command palette.
 *
 * The component owns dialog, focus, keyboard and filtering behaviour. Hosts
 * supply their own destinations and handle selection, which keeps routes,
 * permissions and product data outside the shared UI package.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import ArrowRight02Icon from '@hugeicons/core-free-icons/ArrowRight02Icon'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import FilterHorizontalIcon from '@hugeicons/core-free-icons/FilterHorizontalIcon'
import Loading03Icon from '@hugeicons/core-free-icons/Loading03Icon'
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon'

export interface CommandPaletteItem {
  readonly id: string
  readonly label: string
  readonly category: string
  readonly description?: string
  /** Extra matching terms that do not need to appear in the visual row. */
  readonly keywords?: readonly string[]
  /** Hosts may pass a Hugeicons-backed mark or another semantic visual. */
  readonly icon?: ReactNode
  readonly disabled?: boolean
}

export interface CommandPaletteGroup {
  readonly id: string
  readonly label: string
}

export interface CommandPaletteFilter {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
}

type TriggerProps = {
  readonly onClick?: MouseEventHandler<HTMLElement>
  readonly 'aria-haspopup'?: 'dialog' | boolean
  readonly 'aria-expanded'?: boolean
  readonly 'aria-controls'?: string
}

export interface CommandPaletteProps {
  /** A button-like element. Its own click handler still runs before opening. */
  readonly trigger?: ReactElement
  readonly items: readonly CommandPaletteItem[]
  /** Controls category names and their order. Unknown categories follow these. */
  readonly groups?: readonly CommandPaletteGroup[]
  readonly filters?: readonly CommandPaletteFilter[]
  /** Suggestions shown before a query is entered. Defaults to every item. */
  readonly initialItems?: readonly CommandPaletteItem[]
  /** Optional host-owned, in-memory recent result ids. Never required for search. */
  readonly recentItemIds?: readonly string[]
  readonly onRecentItemIdsChange?: (ids: readonly string[]) => void
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly onSelect?: (item: CommandPaletteItem) => void
  readonly loading?: boolean
  /** A truthy value shows the palette's own plain retry state; its text is never shown. */
  readonly error?: ReactNode | boolean
  readonly onRetry?: () => void
  readonly placeholder?: string
  readonly title?: string
  readonly emptyTitle?: string
  readonly emptyDescription?: string
  readonly maxResults?: number
  readonly keyboardShortcut?: boolean
  readonly shortcutLabel?: string
  readonly className?: string
}

function searchableText(item: CommandPaletteItem): string {
  return [item.label, item.description, item.category, ...(item.keywords ?? [])]
    .join(' ')
    .toLocaleLowerCase()
}

function uniqueItems(items: readonly CommandPaletteItem[]): readonly CommandPaletteItem[] {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/**
 * A command palette with a real dialog/listbox/combobox relationship.
 *
 * It deliberately keeps recent choices in component memory rather than
 * browser storage. A host dealing with sensitive data can therefore adopt it
 * without creating a new persistence surface.
 */
export function CommandPalette({
  trigger,
  items,
  groups = [],
  filters = [],
  initialItems,
  recentItemIds,
  onRecentItemIdsChange,
  open,
  defaultOpen = false,
  onOpenChange,
  onSelect,
  loading = false,
  error = false,
  onRetry,
  placeholder = 'Search',
  title = 'Search',
  emptyTitle = 'No results found',
  emptyDescription = 'Try another keyword or adjust the selected filters.',
  maxResults = 8,
  keyboardShortcut = true,
  shortcutLabel = '⌘/Ctrl K',
  className,
}: CommandPaletteProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedFilters, setSelectedFilters] = useState<readonly string[]>([])
  const [uncontrolledRecentIds, setUncontrolledRecentIds] = useState<readonly string[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const isOpen = open ?? uncontrolledOpen
  const recentIds = recentItemIds ?? uncontrolledRecentIds
  const dialogId = useId()
  const titleId = useId()
  const instructionsId = useId()
  const resultsId = useId()
  const liveId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const openedRef = useRef(false)
  const suppressFocusRestoreRef = useRef(false)

  const setOpen = useCallback((next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }, [onOpenChange, open])

  const dismiss = useCallback((restoreFocus = true) => {
    suppressFocusRestoreRef.current = !restoreFocus
    setQuery('')
    setFiltersOpen(false)
    setSelectedFilters([])
    setActiveIndex(-1)
    setOpen(false)
  }, [setOpen])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const isDefaultView = !normalizedQuery && selectedFilters.length === 0
  const sourceItems = isDefaultView && initialItems?.length ? initialItems : items

  const matchingItems = useMemo(() => uniqueItems(sourceItems.filter(item => {
    const matchesFilters = selectedFilters.length === 0 || selectedFilters.includes(item.category)
    return matchesFilters && (!normalizedQuery || searchableText(item).includes(normalizedQuery))
  })), [normalizedQuery, selectedFilters, sourceItems])

  const recentItems = useMemo(() => {
    if (!isDefaultView || recentIds.length === 0) return []
    const byId = new Map(items.map(item => [item.id, item]))
    return recentIds.map(id => byId.get(id)).filter((item): item is CommandPaletteItem => Boolean(item))
  }, [isDefaultView, items, recentIds])

  const visibleItems = useMemo(() => {
    const recent = uniqueItems(recentItems)
    const recentItemIds = new Set(recent.map(item => item.id))
    return [...recent, ...matchingItems.filter(item => !recentItemIds.has(item.id))].slice(0, Math.max(1, maxResults))
  }, [matchingItems, maxResults, recentItems])

  const sections = useMemo(() => {
    const result: { id: string; label: string; items: readonly CommandPaletteItem[] }[] = []
    const recentItemIds = new Set(recentItems.map(item => item.id))
    const visibleRecent = visibleItems.filter(item => recentItemIds.has(item.id))
    if (visibleRecent.length) result.push({ id: '__recent', label: 'Recent', items: visibleRecent })

    const knownGroups = new Map(groups.map(group => [group.id, group.label]))
    const categoryIds = [
      ...groups.map(group => group.id),
      ...visibleItems.map(item => item.category).filter(category => !knownGroups.has(category)),
    ]
    const seenCategories = new Set<string>()

    for (const category of categoryIds) {
      if (seenCategories.has(category)) continue
      seenCategories.add(category)
      const categoryItems = visibleItems.filter(item => item.category === category && !recentItemIds.has(item.id))
      if (categoryItems.length) result.push({ id: category, label: knownGroups.get(category) ?? category, items: categoryItems })
    }

    return result
  }, [groups, recentItems, visibleItems])

  useEffect(() => {
    setActiveIndex(-1)
  }, [normalizedQuery, selectedFilters, loading, error])

  useEffect(() => {
    if (!keyboardShortcut) return
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.isComposing
        || event.repeat
        || (!event.ctrlKey && !event.metaKey)
        || event.key.toLocaleLowerCase() !== 'k'
      ) return

      event.preventDefault()
      const activeElement = document.activeElement
      openerRef.current = activeElement instanceof HTMLElement ? activeElement : null
      suppressFocusRestoreRef.current = false
      setOpen(true)
    }

    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [keyboardShortcut, setOpen])

  // The search field takes focus in the commit that shows the palette, not a
  // frame later, so a check made as soon as it is shown finds it focused. Where
  // focus was is noted first, for a palette its host opened.
  useLayoutEffect(() => {
    if (!isOpen) return
    if (!openerRef.current) {
      const activeElement = document.activeElement
      openerRef.current = activeElement instanceof HTMLElement ? activeElement : null
    }
    inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      openedRef.current = true
      return
    }
    if (!openedRef.current) return

    openedRef.current = false
    const opener = openerRef.current
    openerRef.current = null
    const restoreFocus = !suppressFocusRestoreRef.current
    suppressFocusRestoreRef.current = false
    if (restoreFocus && opener?.isConnected) {
      // A frame later, deliberately: a press on the backdrop closes the palette
      // during mousedown, and the browser's own focus handling for that press,
      // which runs after it, would otherwise take focus straight off the opener.
      // eslint-disable-next-line no-restricted-syntax -- the frame is the point: the backdrop press's own focus handling has to run first.
      window.requestAnimationFrame(() => opener.focus())
    }
  }, [isOpen])

  const choose = useCallback((item: CommandPaletteItem) => {
    if (item.disabled) return
    const nextRecentIds = [item.id, ...recentIds.filter(id => id !== item.id)].slice(0, 4)
    if (recentItemIds === undefined) setUncontrolledRecentIds(nextRecentIds)
    onRecentItemIdsChange?.(nextRecentIds)
    dismiss(false)
    onSelect?.(item)
  }, [dismiss, onRecentItemIdsChange, onSelect, recentIds, recentItemIds])

  const toggleFilter = useCallback((id: string) => {
    setSelectedFilters(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id])
  }, [])

  const trapFocus = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable.item(0)
    const last = focusable.item(focusable.length - 1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  const onDialogKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
      return
    }

    trapFocus(event)
    if (event.target !== inputRef.current || loading || Boolean(error) || visibleItems.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(current => current < visibleItems.length - 1 ? current + 1 : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(current => current > 0 ? current - 1 : visibleItems.length - 1)
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      const selectedItem = visibleItems[activeIndex]
      if (!selectedItem) return
      event.preventDefault()
      choose(selectedItem)
    }
  }, [activeIndex, choose, dismiss, error, loading, trapFocus, visibleItems])

  const triggerNode = isValidElement(trigger)
    ? (() => {
      const element = trigger as ReactElement<TriggerProps>
      const originalClick = element.props.onClick
      return cloneElement(element, {
        'aria-haspopup': 'dialog',
        'aria-expanded': isOpen,
        'aria-controls': dialogId,
        onClick: (event: MouseEvent<HTMLElement>) => {
          originalClick?.(event)
          if (event.defaultPrevented) return
          openerRef.current = event.currentTarget
          suppressFocusRestoreRef.current = false
          setOpen(true)
        },
      })
    })()
    : null

  const liveMessage = loading
    ? 'Searching results'
    : error
      ? 'Search results could not be loaded'
      : `${visibleItems.length} ${visibleItems.length === 1 ? 'result' : 'results'} available`

  return (
    <>
      {triggerNode}
      {isOpen ? (
        <div
          className="waya-command-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) dismiss()
          }}
        >
          <section
            ref={dialogRef}
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-filters-open={filtersOpen}
            className={`waya-command ${className ?? ''}`}
            onKeyDown={onDialogKeyDown}
          >
            <h2 id={titleId} className="waya-command__sr-only">{title}</h2>
            <span id={instructionsId} className="waya-command__sr-only">
              Use the arrow keys to navigate results, Enter to open a result, and Escape to close search.
              {keyboardShortcut ? ` Open search with ${shortcutLabel}.` : ''}
            </span>
            <header className="waya-command__header">
              <div className={`waya-command__input-wrap${query ? ' is-filled' : ''}`}>
                <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={1.7} aria-hidden="true" />
                <input
                  ref={inputRef}
                  type="search"
                  role="combobox"
                  aria-label={title}
                  aria-autocomplete="list"
                  aria-controls={resultsId}
                  aria-describedby={`${instructionsId} ${liveId}`}
                  aria-activedescendant={activeIndex >= 0 ? `${resultsId}-option-${activeIndex}` : undefined}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={placeholder}
                  className="waya-command__input"
                />
                {query ? (
                  <button
                    type="button"
                    className="waya-command__clear"
                    onClick={() => {
                      setQuery('')
                      inputRef.current?.focus()
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {filters.length ? (
                <button
                  type="button"
                  aria-label={selectedFilters.length ? 'Clear filters' : 'Filter results'}
                  aria-expanded={filtersOpen}
                  className="waya-command__icon-button"
                  onClick={() => {
                    if (selectedFilters.length) {
                      setSelectedFilters([])
                    } else {
                      setFiltersOpen(current => !current)
                    }
                  }}
                >
                  <HugeiconsIcon icon={selectedFilters.length ? Cancel01Icon : FilterHorizontalIcon} size={18} strokeWidth={1.7} aria-hidden="true" />
                </button>
              ) : null}

              <button
                type="button"
                aria-label="Close search"
                className="waya-command__icon-button"
                onClick={() => dismiss()}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </header>

            {filtersOpen && filters.length ? (
              <div className="waya-command__filters" role="group" aria-label="Filter search results">
                <span className="waya-command__filter-label">Filter in:</span>
                {filters.map(filter => (
                  <button
                    key={filter.id}
                    type="button"
                    disabled={filter.disabled}
                    aria-pressed={selectedFilters.includes(filter.id)}
                    className="waya-command__filter"
                    onClick={() => toggleFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div id={resultsId} role="listbox" aria-label="Search results" className="waya-command__results">
              {loading ? (
                <div className="waya-command__state" role="status">
                  <HugeiconsIcon icon={Loading03Icon} size={22} strokeWidth={1.7} className="waya-command__spinner" aria-hidden="true" />
                  <strong>Searching Health ID</strong>
                  <span>Loading the available destinations.</span>
                </div>
              ) : error ? (
                <div className="waya-command__state" role="alert">
                  <strong>We couldn’t load the results.</strong>
                  <span>Please check your connection and try again.</span>
                  {onRetry ? <button type="button" className="waya-command__retry" onClick={onRetry}>Try again</button> : null}
                </div>
              ) : visibleItems.length ? (
                sections.map(section => (
                  <section key={section.id} className="waya-command__group" aria-label={section.label}>
                    <p className="waya-command__group-title">{section.label}</p>
                    {section.items.map(item => {
                      const index = visibleItems.indexOf(item)
                      const active = activeIndex === index
                      return (
                        <button
                          key={item.id}
                          id={`${resultsId}-option-${index}`}
                          type="button"
                          role="option"
                          disabled={item.disabled}
                          aria-selected={active}
                          className="waya-command__item"
                          onMouseEnter={() => setActiveIndex(index)}
                          onFocus={() => setActiveIndex(index)}
                          onClick={() => choose(item)}
                        >
                          <span className="waya-command__leading">
                            {item.icon ? <span aria-hidden="true" className="waya-command__item-icon">{item.icon}</span> : null}
                            <span className="waya-command__item-label">{item.label}</span>
                          </span>
                          {item.description ? <span className="waya-command__item-description">{item.description}</span> : <span />}
                          <HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={1.7} className="waya-command__arrow" aria-hidden="true" />
                        </button>
                      )
                    })}
                  </section>
                ))
              ) : (
                <div className="waya-command__state">
                  <HugeiconsIcon icon={Search01Icon} size={22} strokeWidth={1.7} aria-hidden="true" />
                  <strong>{emptyTitle}</strong>
                  <span>{emptyDescription}</span>
                </div>
              )}
            </div>

            <span id={liveId} className="waya-command__sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</span>
          </section>
        </div>
      ) : null}
    </>
  )
}
