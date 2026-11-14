import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cx } from '../../../../kasuwa/ui'
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
 * Outreach's five numbers (the organisation's and a campaign's Overview; owner, 14 Nov 2026): a card each, its label
 * first, the number, and a line under it. By the room the page gives them (index.css .hid-outreach-stats): one row of
 * five on a wide page; narrower, the first across the row over the other four, or two by two on a phone.
 */
export function NumberCards({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <div role="group" aria-label={label} className="hid-outreach-stats grid gap-3">{children}</div>
}

/**
 * One of NumberCards' cards. `lead` starts the line under the number in colour: a rise in green, something urgent in red.
 * With `onOpen` the card has ↗, a 44px button that opens what it counts.
 */
export function NumberCard({ label, value, hint, lead, onOpen, openLabel }: {
  readonly label: string
  readonly value: number | string
  readonly hint?: string
  readonly lead?: { readonly text: string; readonly tone: 'up' | 'urgent' }
  readonly onOpen?: () => void
  readonly openLabel?: string
}) {
  return (
    <div className="relative flex min-w-0 flex-col rounded-xl bg-surface p-4 ring-1 ring-line @md:p-5">
      <span className={cx('min-h-6 min-w-0 text-[14px] break-words text-ink-2', onOpen && 'pr-8')}>{label}</span>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={openLabel ?? `Open ${label.toLowerCase()}`}
          className="absolute top-1.5 right-1.5 inline-flex size-11 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-3 hover:bg-tray hover:text-ink focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] @md:top-2.5 @md:right-2.5">
          <ArrowUpRight className="size-4" aria-hidden />
        </button>
      ) : null}
      <span className="mt-2 text-[26px] leading-9 font-semibold tracking-[-0.02em] text-ink tabular @md:text-[30px] @md:leading-10">{typeof value === 'number' ? value.toLocaleString('en-GB') : value}</span>
      {lead || hint ? (
        <span className="mt-1 text-[13px] text-ink-2">
          {lead ? <span className={cx('font-medium', lead.tone === 'up' ? 'text-success-ink' : 'text-danger-ink')}>{lead.text}</span> : null}
          {lead && hint ? ' ' : null}{hint}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Counts as a table (owner, 14 Nov 2026: the Overview's tables): the first column names the row, the rest are counts,
 * right-aligned. Columns marked `wide` are left out on a phone so the table never scrolls sideways.
 */
export function CountTable({ label, columns, rows }: {
  readonly label: string
  readonly columns: ReadonlyArray<{ readonly head: string; readonly wide?: boolean }>
  readonly rows: ReadonlyArray<{ readonly key: string; readonly name: ReactNode; readonly cells: readonly ReactNode[] }>
}) {
  const hide = (index: number) => (columns[index + 1]?.wide ? 'hidden @md:table-cell' : '')
  return (
    <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-line">
      <table aria-label={label} className="w-full border-collapse text-left text-[13px] @md:text-[14px]">
        <thead className="bg-tray text-ink-2">
          <tr>
            {columns.map((column, index) => (
              <th key={column.head} scope="col" className={cx('border-b border-line px-2.5 py-2.5 font-medium whitespace-nowrap @md:px-4',
                index > 0 && 'border-l text-right', index > 0 && hide(index - 1))}>{column.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key} className="border-b border-line last:border-b-0">
              <th scope="row" className="px-2.5 py-3 font-medium break-words text-ink @md:px-4">{row.name}</th>
              {row.cells.map((cell, index) => (
                <td key={index} className={cx('border-l border-line px-2.5 py-3 text-right text-ink tabular @md:px-4', hide(index))}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A date written as 2026-12-05 inside a sentence from Outreach, in words: 5 Dec 2026. */
export const datesInWords = (text: string) => text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, date => dayText(date, true))

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
