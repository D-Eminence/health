import { useEffect, useRef, useState } from 'react'
import { staffApi, type OutreachCase, type OutreachCasesPage } from '../../../staff/api'
import { EXPORT_PAGE_SIZE, readAllCases } from './outreachExport'

/**
 * Registration numbers (owner, 14 Nov 2026: the frontend-only part of the campaign dashboard in the Outreach backend handover):
 * counted on this phone from every registration it has read (not only today's), so they need nothing new from Outreach. A count Outreach
 * does not send yet (health checks before 0118, Health IDs before 0119) is left out, never shown as 0.
 */
export interface OutreachNumbersCount {
  readonly registered: number
  readonly healthChecks?: number
  readonly healthIds?: number
}

export function outreachNumbers(cases: readonly OutreachCase[]): OutreachNumbersCount {
  const checksKnown = cases.some(item => 'hasScreening' in item)
  const idsKnown = cases.some(item => 'healthId' in item)
  return {
    registered: cases.length,
    ...(checksKnown ? { healthChecks: cases.filter(item => item.hasScreening === true).length } : {}),
    ...(idsKnown ? { healthIds: cases.filter(item => Boolean(item.healthId)).length } : {}),
  }
}

/**
 * The numbers counted over every registration, not only those the list has loaded (owner, 14 Nov 2026: "Registered 100"
 * while the export held 138). `capped`: more were left after the most an export reads; `latestOnly`: an Outreach before
 * paging sent only its newest 100. Either way the numbers cover only the newest they hold.
 */
export interface OutreachTotals {
  readonly counted: OutreachNumbersCount
  readonly capped: boolean
  readonly latestOnly: boolean
}

/**
 * Reads every registration (as the export does, a page of 500 at a time) and counts them, each time the list reads its
 * first page again (`firstPage` is a new page then: the minute's refresh, Refresh, a new registration), so never more
 * often than the list. Only while older registrations are left to read: when the first page has everything, the list's
 * own count is the total. A read that fails keeps the last numbers read; null until one is read.
 *
 * One read at a time: a request cannot be cancelled, so a new first page while a read is running (an outreach group's
 * queue sending one registration after another) only asks for one more read once it ends, and the running read's
 * numbers are kept (older but whole numbers beat none).
 */
export function useOutreachTotals(facilityId: string | undefined, enabled: boolean, firstPage: OutreachCasesPage | null,
  campaignId?: string): OutreachTotals | null {
  const key = `${facilityId ?? ''}\u0000${campaignId ?? ''}`
  const [read, setRead] = useState<{ key: string; totals: OutreachTotals } | null>(null)
  const needed = Boolean(facilityId && enabled && firstPage?.nextCursor)
  /** What the page asks for now: a read that ends looks here, to keep its numbers and to know whether to read again. */
  const wanted = useRef({ needed, facilityId, campaignId, key })
  const running = useRef(false)
  /** A new first page came while a read was running: read once more when it ends. */
  const again = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    wanted.current = { needed, facilityId, campaignId, key }
    if (!needed || !facilityId) return
    if (running.current) {
      again.current = true
      return
    }
    const start = (facility: string, campaign: string | undefined, readKey: string) => {
      running.current = true
      again.current = false
      readAllCases(before => staffApi.outreachCasesPage(facility, { limit: EXPORT_PAGE_SIZE, before, ...(campaign ? { campaignId: campaign } : {}) }))
        .then(all => {
          if (!mounted.current || wanted.current.key !== readKey) return
          const rows = campaign ? all.cases.filter(item => item.campaignId === campaign) : all.cases
          setRead({ key: readKey, totals: { counted: outreachNumbers(rows), capped: all.capped, latestOnly: all.latestOnly } })
        }, () => {
          // Nothing to say: the last numbers read stay until a read succeeds.
        })
        .finally(() => {
          running.current = false
          const now = wanted.current
          if (again.current && mounted.current && now.needed && now.facilityId) start(now.facilityId, now.campaignId, now.key)
        })
    }
    start(facilityId, campaignId, key)
  }, [needed, facilityId, campaignId, firstPage, key])
  return read && read.key === key ? read.totals : null
}

/** Every count the list's own registrations give is no more than the totals' (totals read before the list's newest read may be behind it). */
function covers(totals: OutreachNumbersCount, loaded: OutreachNumbersCount): boolean {
  return (Object.keys(loaded) as (keyof OutreachNumbersCount)[]).every(name => {
    const total = totals[name]
    return total !== undefined && total >= (loaded[name] ?? 0)
  })
}

export function OutreachNumbers({ cases, more, totals = null, waitingOnPhone, label }: {
  /** The registrations read so far; nothing is shown until they are read. */
  readonly cases: readonly OutreachCase[] | null
  /** Older registrations are left to read ("Show more"): the counts say they cover only those read, unless `totals` are known. */
  readonly more: boolean
  /** Every registration counted (useOutreachTotals), when read. */
  readonly totals?: OutreachTotals | null
  /** Registrations kept on this phone, waiting for signal (an outreach group's queue). */
  readonly waitingOnPhone?: number
  readonly label: string
}) {
  if (!cases || cases.length === 0 && !waitingOnPhone) return null
  const loaded = outreachNumbers(cases)
  // The totals, while older registrations are left to read; never a number below what the list itself shows.
  const whole = more && totals && covers(totals.counted, loaded) ? totals : null
  const counted = whole ? whole.counted : loaded
  const tiles: Array<readonly [string, number]> = [['Registered', counted.registered]]
  if (counted.healthChecks !== undefined) tiles.push(['Health checks done', counted.healthChecks])
  if (counted.healthIds !== undefined) tiles.push(['Health IDs made', counted.healthIds])
  if (waitingOnPhone !== undefined) tiles.push(['Waiting on this phone', waitingOnPhone])
  const line = whole
    ? (whole.capped || whole.latestOnly ? `Counted from the newest ${counted.registered.toLocaleString('en-GB')} registrations.` : '')
    : more ? `Counted from the ${counted.registered} registrations loaded. Press “Show more” below to count older ones.` : ''
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <dl className="m-0 grid grid-cols-2 gap-3 @xl:grid-cols-4">
        {tiles.map(([title, value]) => (
          <div key={title} className="flex flex-col gap-0.5 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
            <dt className="text-[13px] text-ink-3">{title}</dt>
            <dd className="m-0 text-[24px] font-semibold leading-tight text-ink tabular">{value}</dd>
          </div>
        ))}
      </dl>
      {line ? <p className="m-0 text-[13px] text-ink-3">{line}</p> : null}
    </section>
  )
}
