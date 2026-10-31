/**
 * paytrail's interactive pieces (components/ui-client.js): Modal (a bottom sheet on phones), Switch, Segmented and the
 * theme toggle. The theme follows the device (prefers-color-scheme); a change made with the toggle holds for the visit
 * only, since this repository persists nothing in browser storage.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Moon, Sun, X } from 'lucide-react'
import { cx } from './ui'

/*
 * Open dialogs and drawers, newest last: Escape closes only the top one (a confirm opened over a drawer closes alone).
 */
const openLayers: symbol[] = []
function useLayer(open: boolean) {
  const id = useRef(Symbol('layer'))
  useLayoutEffect(() => {
    if (!open) return
    const me = id.current
    openLayers.push(me)
    return () => { const i = openLayers.lastIndexOf(me); if (i >= 0) openLayers.splice(i, 1) }
  }, [open])
  return () => openLayers[openLayers.length - 1] === id.current
}

/**
 * A dialog's or drawer's buttons, given as [secondary…, primary]: a right-aligned row with the primary rightmost from
 * 640px; on phones full-width and stacked, the primary last (bottom, in thumb reach). One surface, a hairline above.
 */
const FOOTER = 'flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-4 py-3.5 sm:px-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto'

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const onTop = useLayer(open)
  const topRef = useRef(onTop)
  useEffect(() => { closeRef.current = onClose; topRef.current = onTop })
  // Focus moves as the dialog is shown (a layout effect), so a key pressed at once lands inside it.
  useLayoutEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && topRef.current()) closeRef.current() }
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    const box = ref.current
    ;(box?.querySelector<HTMLElement>('[autofocus],input:not([type=hidden]),select,textarea') ?? box?.querySelector<HTMLElement>('button'))?.focus()
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [open])
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }
  return <div className="fixed inset-0 z-[var(--z-dialog)] flex items-end justify-center p-0 sm:items-center sm:p-4">
    <div className="absolute inset-0 animate-fade-in bg-[#101828]/45 backdrop-blur-[2px]" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
      className={cx('relative flex max-h-[92dvh] w-full min-w-0 animate-rise flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[var(--shadow-dialog)] ring-1 ring-line sm:rounded-2xl', widths[size])}>
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0"><h2 className="m-0 text-title-2 break-words text-ink">{title}</h2>{description && <p className="m-0 mt-1 text-[13px] text-ink-3">{description}</p>}</div>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-hover hover:text-ink sm:size-9"><X className="size-4" /></button>
      </div>
      <div className="@container min-w-0 overflow-y-auto px-4 py-5 sm:px-5">{children}</div>
      {footer && <div className={FOOTER}>{footer}</div>}
    </div>
  </div>
}

/**
 * A drawer: the detail of one thing and what to do with it, without leaving the list (paytrail's Modal, side-docked).
 * From the right on a computer, a sheet from the bottom within thumb reach on a phone. Focus moves in as it opens and
 * back to what opened it as it closes; Escape and the backdrop close it.
 */
export function Drawer({ open, onClose, title, description, icon, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; icon?: ReactNode; children?: ReactNode; footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const onTop = useLayer(open)
  const topRef = useRef(onTop)
  useEffect(() => { closeRef.current = onClose; topRef.current = onTop })
  useLayoutEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && topRef.current()) closeRef.current() }
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    const box = ref.current
    ;(box?.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ?? box?.querySelector<HTMLElement>('h2'))?.focus()
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = scroll; if (previous?.isConnected) previous.focus() }
  }, [open])
  if (!open) return null
  return <div className="fixed inset-0 z-[var(--z-drawer)] flex items-end justify-center sm:items-stretch sm:justify-end">
    <div className="absolute inset-0 animate-fade-in bg-[#101828]/45 backdrop-blur-[2px]" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="hid-drawer-title"
      className="hid-drawer relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[var(--shadow-dialog)] ring-1 ring-line sm:max-h-none sm:w-[min(440px,100vw_-_2rem)] sm:rounded-none sm:rounded-l-2xl">
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        {icon}
        <div className="min-w-0 flex-1"><h2 id="hid-drawer-title" tabIndex={-1} className="m-0 text-title-2 [overflow-wrap:anywhere] text-ink outline-none">{title}</h2>
          {description && <p className="m-0 mt-1 text-[13px] text-ink-3">{description}</p>}</div>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-hover hover:text-ink sm:size-9"><X className="size-4" /></button>
      </div>
      <div className="@container min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">{children}</div>
      {footer && <div className={cx(FOOTER, 'pb-[max(14px,env(safe-area-inset-bottom))]')}>{footer}</div>}
    </div>
  </div>
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
    className="flex w-full cursor-pointer items-start justify-between gap-4 border-0 bg-transparent p-0 text-left disabled:cursor-not-allowed disabled:opacity-50">
    <span className="min-w-0"><span className="block text-sm font-medium text-ink">{label}</span>{description && <span className="mt-0.5 block text-[13px] text-ink-3">{description}</span>}</span>
    <span className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-brand-fill' : 'bg-line-strong')}>
      <span className={cx('inline-block size-5 rounded-full bg-white shadow-[var(--shadow-xs)] transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </span>
  </button>
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md', className, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: ReactNode }>; size?: 'sm' | 'md'; className?: string; ariaLabel: string
}) {
  return <div role="radiogroup" aria-label={ariaLabel} className={cx('inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-tray p-1', className)}>
    {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
      className={cx('inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 px-3 font-medium whitespace-nowrap', size === 'sm' ? 'h-9 sm:h-7 text-[12px]' : 'h-10 sm:h-8 text-[13px]',
        value === o.value ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-3 hover:text-ink')}>{o.label}</button>)}
  </div>
}

type Theme = 'light' | 'dark'

function readTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies the saved (or system) theme once, as the app starts. */
export function applySavedTheme() {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = readTheme()
}

/**
 * Light or dark as a two-way switch (sun | moon), the way people know it from their phones: both choices visible, the
 * current one raised. `vertical` for the collapsed sidebar rail. In memory only, like ThemeToggle.
 */
export function ThemeSwitch({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const pick = (next: Theme) => { document.documentElement.dataset.theme = next; setTheme(next) }
  const option = (value: Theme, I: typeof Sun, label: string) => <button type="button" aria-pressed={theme === value} aria-label={label} title={label} onClick={() => pick(value)}
    className={cx('inline-flex flex-1 cursor-pointer items-center justify-center rounded-full border-0 transition-colors', vertical ? 'size-9' : 'h-9',
      theme === value ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-3 hover:text-ink')}><I className="size-[18px]" aria-hidden /></button>
  return <div role="group" aria-label="Appearance" className={cx('flex gap-1 rounded-full bg-tray p-1', vertical ? 'flex-col items-center' : 'w-full', className)}>
    {option('light', Sun, 'Light mode')}{option('dark', Moon, 'Dark mode')}
  </div>
}

export function ThemeToggle({ row = false, className }: { row?: boolean; className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  const toggle = () => {
    document.documentElement.dataset.theme = next
    setTheme(next)
  }
  const I = theme === 'dark' ? Sun : Moon
  if (row) return <button type="button" onClick={toggle} className={cx('flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-2 text-left text-[14px] font-medium text-ink hover:bg-hover', className)}>
    <span className="inline-flex size-8 items-center justify-center rounded-lg bg-hover"><I className="size-[18px] text-ink-2" /></span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}
  </button>
  return <button type="button" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    className={cx('inline-flex size-10 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-2 ring-1 ring-line-strong ring-inset hover:bg-hover hover:text-ink', className)}>
    <I className="size-[18px]" />
  </button>
}
