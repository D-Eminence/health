import { useCallback, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { cx, StatCard, StatGroup } from '../../../../kasuwa/ui'
import { campaignFlowErrorText, isNotOffered } from '../campaignApi'
import { focusLabel, type FocusId, type TeamRole } from '../campaignTypes'
import { TESTS } from '../screeningTemplates'

/*
 * What the campaign's insight screens (dashboard, follow-ups, report) share: one read with "not offered", Lagos dates
 * and hours in words, and the plain CSS bars every chart here is made of (a value in words beside every bar, so nothing
 * is said by colour or length alone).
 */

/** The focuses whose results are sensitive (HIV, hepatitis B): their positives are counts only those allowed may see. */
export const SENSITIVE_FOCUSES: ReadonlySet<FocusId> = new Set(Object.values(TESTS).filter(test => test.sensitive).map(test => test.focus))

export function testName(testId: string, fromPlan?: ReadonlyArray<{ readonly id: string; readonly name: string }>): string {
  return fromPlan?.find(test => test.id === testId)?.name ?? TESTS[testId]?.name ?? 'Test kit'
}

/** A short name for a kit's test, for tight places: "Hepatitis B" rather than the whole test name. */
export function kitTestLabel(testId: string): string {
  const test = TESTS[testId]
  return test ? focusLabel(test.focus) : 'Test'
}

const LAGOS = 'Africa/Lagos'

/** "13 Nov" (or "13 Nov 2026" with the year), for a YYYY-MM-DD day or an ISO time, in Lagos. */
export function dayText(value: string | null | undefined, year = false): string {
  if (!value) return 'No date'
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
  if (Number.isNaN(time.getTime())) return 'No date'
  return time.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: LAGOS })
}

/** "09:00", the hour an ISO time starts, in Lagos. */
export function hourText(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: LAGOS })
}

/** Today in Lagos as YYYY-MM-DD. */
export function lagosToday(now = Date.now()): string {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: LAGOS })
}

/** Whether a YYYY-MM-DD day is within `days` days from today (or already past). */
export function withinDays(day: string, days: number, now = Date.now()): boolean {
  const time = Date.parse(`${day}T23:59:59Z`)
  return !Number.isNaN(time) && time - now < days * 24 * 60 * 60 * 1000
}

export type CampaignRead<T> =
  | { readonly state: 'loading'; readonly value: null }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'not_offered'; readonly value: null }
  | { readonly state: 'error'; readonly value: T | null; readonly error: string; readonly caught: unknown }

/**
 * One read of a campaign route: loading, the answer, "not offered" (this Outreach doesn't serve it yet), or a failure in
 * words (what was read before stays). `refresh` reads again; an answer to an earlier read is dropped.
 */
export function useCampaignRead<T>(enabled: boolean, load: (signal: AbortSignal) => Promise<T>, fallback: string) {
  const [read, setRead] = useState<CampaignRead<T>>({ state: 'loading', value: null })
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    if (!enabled) return
    const request = ++epoch.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    try {
      const value = await load(abort.signal)
      if (epoch.current === request) setRead({ state: 'ready', value })
    } catch (caught) {
      if (epoch.current !== request || abort.signal.aborted) return
      if (isNotOffered(caught)) setRead({ state: 'not_offered', value: null })
      else setRead(previous => ({ state: 'error', value: previous.value, error: campaignFlowErrorText(caught, fallback), caught }))
    } finally {
      if (epoch.current === request) setBusy(false)
    }
  }, [enabled, load, fallback])
  useEffect(() => {
    void refresh()
    return () => { epoch.current += 1; controller.current?.abort() }
  }, [refresh])
  return { read, busy, refresh }
}

/**
 * Reads again every `ms` while the page is shown, and as soon as it is shown again or the window gets focus. Nothing is
 * read while the tab is hidden.
 */
export function useLiveRefresh(refresh: () => void, ms = 30_000, enabled = true) {
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    if (!enabled) return
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const timer = setInterval(() => { if (visible()) latest.current() }, ms)
    const shown = () => { if (visible()) latest.current() }
    document.addEventListener('visibilitychange', shown)
    window.addEventListener('focus', shown)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
      window.removeEventListener('focus', shown)
    }
  }, [ms, enabled])
}

/** One bar with its label and value in words. The bar's length is out of `max`; it is drawn for sighted readers only. */
export function BarRow({ label, value, max, valueText, tone = 'brand', detail }: {
  readonly label: ReactNode
  readonly value: number
  readonly max: number
  /** The value as read out and shown; the number by default. */
  readonly valueText?: string
  readonly tone?: 'brand' | 'warn' | 'danger' | 'muted'
  readonly detail?: ReactNode
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1">
      <span className="min-w-0 text-[14px] break-words text-ink">{label}</span>
      <span className="text-[14px] font-semibold text-ink tabular">{valueText ?? value}</span>
      <span aria-hidden="true" className="col-span-2 block h-2 overflow-hidden rounded-full bg-tray">
        <span className={cx('block h-full rounded-full',
          tone === 'brand' && 'bg-brand-fill', tone === 'warn' && 'bg-warn', tone === 'danger' && 'bg-danger', tone === 'muted' && 'bg-ink-3')}
        style={{ width: `${share * 100}%`, minWidth: value > 0 ? 4 : 0 }} />
      </span>
      {detail ? <span className="col-span-2 text-[13px] text-ink-3">{detail}</span> : null}
    </li>
  )
}

/** A titled block of the dashboard or report: a card with an h2, and its content. */
export function InsightCard({ title, id, children, action, className }: {
  readonly title: string
  readonly id: string
  readonly children: ReactNode
  readonly action?: ReactNode
  readonly className?: string
}) {
  return (
    <section aria-labelledby={id} className={cx('flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="m-0 text-title-3 text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * A count as every dashboard shows one (Kasuwa's StatCard, in a StatGroup's grey tray: its icon, the big number, what it
 * counts and a line under it). With `onOpen` the whole tile is one button that opens what it counts (a tab), as Home's
 * tiles link to their pages; the page keeps where it is in memory, so it is a button rather than a link.
 */
export function StatTile({ onOpen, id, ...card }: ComponentProps<typeof StatCard> & { readonly onOpen?: () => void; readonly id?: string }) {
  if (!onOpen) return <StatCard {...card} />
  return (
    <button type="button" id={id} onClick={onOpen}
      className="group flex min-w-0 cursor-pointer rounded-xl border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]">
      <StatCard {...card} className={cx('w-full transition-shadow group-hover:shadow-[var(--shadow-pop)]', card.className)} />
    </button>
  )
}

/**
 * Outreach's five number tiles (the organisation's and a campaign's Overview), by the room the page gives them
 * (index.css .hid-outreach-tiles): one row of five on a wide page; narrower, the first tile (`hero`: people reached, or
 * registered) across the row and the other four in one row, or two by two on a phone, each tile compact there (its icon
 * beside the number). No tile left alone on a row, and a number never breaks. Kasuwa's StatGroup and StatCard as they are.
 */
export function NumberTiles({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <StatGroup label={label} className="hid-outreach-tiles">{children}</StatGroup>
}

/** One of NumberTiles' tiles: a StatTile with the tile's compact layout; `hero` for the first, wide one. */
export function NumberTile({ hero, ...tile }: ComponentProps<typeof StatTile> & { readonly hero?: boolean }) {
  return <StatTile {...tile} className={cx('hid-outreach-tile', hero && 'hid-outreach-tile-hero', tile.className)} />
}

/** The roles' words, joined: "Registrar and vital signs". */
export function rolesWords(roles: readonly TeamRole[], label: (role: string) => string): string {
  const words = roles.map(label)
  if (words.length <= 1) return words[0] ?? 'Team member'
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)!.toLowerCase()}`
}

/**
 * One part of a page at a time (owner, 13 Nov 2026: no long pages): one row of tabs (44px tall, arrow keys move between
 * them; on a phone they share the row's width rather than wrap) and the chosen part under it. The first part shows to begin with.
 */
export function SectionSwitch<T extends string>({ id, label, sections, initial }: {
  readonly id: string
  readonly label: string
  readonly sections: ReadonlyArray<{ readonly value: T; readonly label: string; readonly content: ReactNode }>
  readonly initial?: T
}) {
  const [chosen, setChosen] = useState<T | undefined>(initial)
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const shown = sections.find(section => section.value === chosen) ?? sections[0]
  if (!shown) return null
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null
    if (next === null) return
    event.preventDefault()
    const value = sections[(next + sections.length) % sections.length]!.value
    setChosen(value)
    buttons.current.get(value)?.focus()
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label={label} className="flex w-full min-w-0 gap-0.5 rounded-xl bg-tray p-1 @xl:w-auto @xl:self-start @xl:gap-1">
        {sections.map((section, index) => {
          const selected = section.value === shown.value
          return (
            <button key={section.value} type="button" role="tab" id={`${id}-tab-${section.value}`} aria-selected={selected} aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1} onClick={() => setChosen(section.value)} onKeyDown={event => onKey(event, index)}
              ref={element => { if (element) buttons.current.set(section.value, element); else buttons.current.delete(section.value) }}
              className={cx('inline-flex h-11 min-w-0 flex-auto cursor-pointer items-center justify-center rounded-lg border-0 px-1.5 text-[13px] font-medium whitespace-nowrap @xl:flex-none @xl:px-3 @xl:text-[14px]',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
                selected ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-2 hover:text-ink')}>
              <span className="truncate">{section.label}</span>
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${shown.value}`} className="min-w-0">{shown.content}</div>
    </div>
  )
}
