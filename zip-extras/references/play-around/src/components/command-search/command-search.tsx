import { cloneElement, forwardRef, isValidElement, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { commandSearchVariants } from './command-search.styles'
import type { CommandSearchFilter as CommandSearchFilterData, CommandSearchGroup, CommandSearchItem, CommandSearchProps } from './command-search.types'

const Icon = ({ children }: { children: ReactNode }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{children}</svg>
const SearchIcon = () => <Icon><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></Icon>
const FilterIcon = () => <Icon><path d="M4 6h16M7 12h10m-7 6h4"/></Icon>
const ClearFilterIcon = () => <Icon><path d="m5 5 14 14M5 7h14M9 12h6m-2 5h2"/></Icon>
const CloseIcon = () => <Icon><path d="m6 6 12 12M18 6 6 18"/></Icon>
const ArrowIcon = () => <Icon><path d="M5 12h14m-6-6 6 6-6 6"/></Icon>

const useControllable = <T,>(controlled: T | undefined, initial: T, onChange?: (value: T) => void) => {
  const [uncontrolled, setUncontrolled] = useState(initial)
  const value = controlled === undefined ? uncontrolled : controlled
  const setValue = (next: T) => { if (controlled === undefined) setUncontrolled(next); onChange?.(next) }
  return [value, setValue] as const
}
const matches = (item: CommandSearchItem, query: string) => !query || [item.label, item.description, item.category, ...(item.metadata ?? []), ...(item.keywords ?? [])].join(' ').toLowerCase().includes(query.toLowerCase())

export function CommandSearchTrigger({ children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`cs-focus ${props.className ?? ''}`} onClick={onClick}>{children}</button>
}
export const CommandSearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input ref={ref} {...props} className={`cs-input ${props.className ?? ''}`} />)
export function CommandSearchFilter({ filter, active, onToggle }: { filter: CommandSearchFilterData; active: boolean; onToggle: () => void }) { return <button type="button" className="cs-filter cs-focus" aria-pressed={active} disabled={filter.disabled} onClick={onToggle}>{filter.icon}{filter.label}</button> }
export function CommandSearchFilters({ filters, activeFilters, onToggle }: { filters: CommandSearchFilterData[]; activeFilters: string[]; onToggle: (id: string) => void }) { return <div className="cs-filters" role="group" aria-label="Filter search results"><span className="cs-filter-label">Filter in:</span>{filters.map(filter => <CommandSearchFilter key={filter.id} filter={filter} active={activeFilters.includes(filter.id)} onToggle={() => onToggle(filter.id)} />)}</div> }
export function CommandSearchItemView({ item, active, onSelect }: { item: CommandSearchItem; active: boolean; onSelect: () => void }) { return <button type="button" role="option" aria-selected={active} disabled={item.disabled} className={`cs-item cs-focus ${active ? 'cs-item--active' : ''}`} onClick={onSelect}><span className="cs-leading">{item.icon ?? (item.avatar ? <span className="cs-avatar">{item.avatar}</span> : null)}<span className="cs-item-label">{item.label}</span></span><span className="cs-item-detail">{item.description ?? item.metadata?.join(' · ')}</span><span className="cs-arrow"><ArrowIcon /></span></button> }
export function CommandSearchGroupView({ group, children }: { group: CommandSearchGroup; children: ReactNode }) { return <section className="cs-group" aria-label={group.label}><div className="cs-group-title">{group.label}</div>{children}</section> }
export function CommandSearchEmpty({ message = 'No results found' }: { message?: string }) { return <div className="cs-state"><strong>{message}</strong><span>Try another keyword or change the selected filters.</span></div> }
export function CommandSearchLoading({ groups }: { groups: CommandSearchGroup[] }) { return <>{groups.map((group, index) => <div className="cs-skeleton-group" key={group.id}><div className="cs-group-title">{group.label}</div>{Array.from({ length: index ? 2 : 3 }, (_, row) => <div className="cs-skeleton-row" key={row}><span className="cs-bone"/><span className="cs-bone"/></div>)}</div>)}</> }
export function CommandSearchError({ onRetry }: { onRetry?: () => void }) { return <div className="cs-state"><strong>We couldn’t load the results.</strong>{onRetry && <button className="cs-retry cs-focus" onClick={onRetry}>Try again</button>}</div> }
export function CommandSearchFooter() { return <footer className="cs-footer"><span className="cs-footer-nav">Navigate <kbd className="cs-key cs-key--round">↑</kbd> <kbd className="cs-key cs-key--round">↓</kbd></span><span>Open <kbd className="cs-key">Enter</kbd></span><span>Close <kbd className="cs-key">Esc</kbd></span></footer> }
export function CommandSearchDialog({ children, className }: { children: ReactNode; className?: string }) { return <section className={className} role="dialog" aria-modal="true" aria-label="Global search">{children}</section> }
export function CommandSearchResults({ children }: { children: ReactNode }) { return <div className="cs-results" role="listbox" aria-label="Search results">{children}</div> }

export function CommandSearch({
  open, defaultOpen = false, onOpenChange, placeholder = 'Search user, order, transaction…', searchValue, defaultSearchValue = '', onSearchValueChange,
  filters = [], activeFilters, onFiltersChange, groups, results = [], loading = false, error = false, emptyMessage, searchDebounce = 250, maxResults = 3,
  onResultSelect, onClear, onRetry, showFooter = true, showFilters = true, trigger, keyboardShortcut = true, className, variant = 'default',
  renderItem, renderGroup, renderEmpty, renderLoading, renderError,
}: CommandSearchProps) {
  const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange)
  const [query, setQuery] = useControllable(searchValue, defaultSearchValue, onSearchValueChange)
  const [selectedFilters, setSelectedFilters] = useControllable(activeFilters, [], onFiltersChange)
  const [filtersOpen, setFiltersOpen] = useState(false); const [debounced, setDebounced] = useState(query); const [searchPending, setSearchPending] = useState(false); const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null); const triggerRef = useRef<HTMLElement | null>(null); const dialogRef = useRef<HTMLDivElement>(null); const liveId = useId()
  useEffect(() => { if (query === debounced) { setSearchPending(false); return }; setSearchPending(true); const id = window.setTimeout(() => { setDebounced(query); setSearchPending(false) }, searchDebounce); return () => window.clearTimeout(id) }, [query, debounced, searchDebounce])
  useEffect(() => { if (!keyboardShortcut) return; const key = (event: KeyboardEvent) => { if (!event.defaultPrevented && !event.isComposing && !event.repeat && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); triggerRef.current = document.activeElement as HTMLElement; setOpen(true) } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [keyboardShortcut])
  useEffect(() => { if (isOpen) requestAnimationFrame(() => inputRef.current?.focus()); else triggerRef.current?.focus() }, [isOpen])
  const available = useMemo(() => results.filter(item => (!selectedFilters.length || selectedFilters.includes(item.category)) && matches(item, debounced)), [results, selectedFilters, debounced])
  const visible = available.slice(0, maxResults > 0 ? maxResults : undefined)
  const resolvedGroups = useMemo(() => groups?.length ? groups : Array.from(new Map(results.map(item => [item.category, { id: item.category, label: item.category }])).values()), [groups, results])
  const loadingGroups = selectedFilters.length ? resolvedGroups.filter(group => selectedFilters.includes(group.id)) : resolvedGroups.slice(0, 2)
  const effectiveLoading = loading || searchPending
  const close = () => setOpen(false)
  const choose = (item: CommandSearchItem) => { if (item.disabled) return; onResultSelect?.(item); if (item.href) window.location.assign(item.href); close() }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(current => current < 0 ? (event.key === 'ArrowDown' ? 0 : Math.max(visible.length - 1, 0)) : (current + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length); return }
    if (event.key === 'Enter') { const item = visible[active < 0 ? 0 : active]; if (item) { event.preventDefault(); choose(item) } }
    if (event.key === 'Tab' && dialogRef.current) { const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')); const first = focusables[0], last = focusables.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } }
  }
  const toggle = (id: string) => { setActive(-1); setSelectedFilters(selectedFilters.includes(id) ? selectedFilters.filter(filter => filter !== id) : [...selectedFilters, id]) }
  const filterLabel = selectedFilters.length ? 'Clear filter' : filtersOpen ? 'Close filter' : 'Open filter'
  const launch = (source?: HTMLElement) => { triggerRef.current = source ?? document.activeElement as HTMLElement; setOpen(true) }
  const triggerNode = trigger && isValidElement(trigger) ? (() => { const element = trigger as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>; return cloneElement(element, { type: element.props.type ?? 'button', 'aria-haspopup': 'dialog', 'aria-expanded': isOpen, onClick: event => { element.props.onClick?.(event); if (!event.defaultPrevented) launch(event.currentTarget) } }) })() : <CommandSearchTrigger aria-haspopup="dialog" aria-expanded={isOpen} onClick={event => launch(event.currentTarget)}>{trigger ?? 'Search'}</CommandSearchTrigger>
  return <>{triggerNode}{isOpen && <div className="cs-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }} onKeyDown={onKeyDown}><CommandSearchDialog className={`${commandSearchVariants(variant)} ${filtersOpen ? 'cs-dialog--filters-open' : ''} ${className ?? ''}`}><div ref={dialogRef} className="cs-head"><div className={`cs-input-wrap ${query ? 'cs-input-wrap--filled' : ''}`}><SearchIcon/><CommandSearchInput ref={inputRef} role="combobox" aria-autocomplete="list" value={query} onChange={event => { setActive(-1); setQuery(event.target.value) }} placeholder={placeholder} aria-controls={liveId} aria-activedescendant={active >= 0 ? `command-item-${active}` : undefined} />{query && <button className="cs-clear cs-focus" onClick={() => { setQuery(''); onClear?.(); inputRef.current?.focus() }}>Clear</button>}</div>{showFilters && filters.length > 0 && <span className="cs-tooltip-wrap"><button className="cs-icon-btn cs-focus" aria-label={filterLabel} aria-expanded={filtersOpen} onClick={() => selectedFilters.length ? setSelectedFilters([]) : setFiltersOpen(value => !value)}>{selectedFilters.length ? <ClearFilterIcon/> : <FilterIcon/>}</button><span className="cs-tooltip" role="tooltip">{filterLabel}</span></span>}<span className="cs-tooltip-wrap"><button className="cs-icon-btn cs-focus" aria-label="Close search" onClick={close}><CloseIcon/></button><span className="cs-tooltip" role="tooltip">Close search</span></span></div>{showFilters && filtersOpen && <CommandSearchFilters filters={filters} activeFilters={selectedFilters} onToggle={toggle}/>}<CommandSearchResults>{effectiveLoading ? (renderLoading?.() ?? <CommandSearchLoading groups={loadingGroups}/>) : error ? (renderError?.() ?? <CommandSearchError onRetry={onRetry}/>) : visible.length ? resolvedGroups.map(group => { const items = visible.filter(item => item.category === group.id); if (!items.length) return null; return renderGroup?.(group) ?? <CommandSearchGroupView key={group.id} group={group}>{items.map(item => <div id={`command-item-${visible.indexOf(item)}`} key={item.id}>{renderItem?.(item, active === visible.indexOf(item)) ?? <CommandSearchItemView item={item} active={active === visible.indexOf(item)} onSelect={() => choose(item)}/>}</div>)}</CommandSearchGroupView> }) : (renderEmpty?.() ?? <CommandSearchEmpty message={emptyMessage}/>)}</CommandSearchResults>{showFooter && <CommandSearchFooter/>}<span id={liveId} className="cs-sr" aria-live="polite">{effectiveLoading ? 'Searching results' : `${visible.length} results available`}</span></CommandSearchDialog></div>}</>
}
