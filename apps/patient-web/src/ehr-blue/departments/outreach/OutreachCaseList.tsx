import { useCallback, useId, useRef, useState } from 'react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { Alert, Badge, Button } from '../../../kasuwa/ui'
import { staffApi, type OutreachCampaign, type OutreachCase, type OutreachCasesPage } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import { ageText, caseBadgeText, caseBadgeTone, caseName, CASES_NOT_LOADED, caseWaiting, nextStepText, sexText } from './outreachParts'
import { checksRecorded } from './screening'

/*
 * The registration list, read a page at a time (hid-system#247). The first read is the list's own request, as before
 * paging: the newest 100. A paging Outreach says, with X-Next-Cursor, that older ones are left, and "Show more" then adds
 * the next 100 under them. An Outreach before paging sends no cursor, and nothing more is offered.
 */

/** Rows asked for by each "Show more". */
export const MORE_PAGE_SIZE = 100
export const MORE_FAILED = 'Couldn’t load more. Try again.'

/** "Show more" for a list: whether more are left, and reading them. */
export interface MoreCases {
  /** Older registrations are left to read. */
  readonly available: boolean
  readonly loading: boolean
  /** The last "Show more" failed. */
  readonly error: string
  /** Reads the next page: 'more' when still more are left, 'end' when that was the last, 'failed', or 'stale' when the list was read again meanwhile. */
  readonly load: () => Promise<'more' | 'end' | 'failed' | 'stale'>
}

/** The registration list as read, with "Show more". */
export interface CasesRead {
  /** Every registration read so far (the first page and each page added), newest first as sent; null until read. */
  readonly value: OutreachCase[] | null
  readonly loading: boolean
  readonly error: string
  /** Reads the first page again; the pages added are let go. */
  readonly refresh: () => Promise<void>
  readonly more: MoreCases
}

interface Added {
  /** The first page these follow; another first page (a refresh) lets them go. */
  readonly base: OutreachCasesPage | null
  readonly items: readonly OutreachCase[]
  readonly cursor: string | null
  readonly loading: boolean
  readonly error: string
}

const NOTHING_ADDED: Added = { base: null, items: [], cursor: null, loading: false, error: '' }

/**
 * The registrations the working facility can see, or one campaign's (`campaignId`), read as above. Asked of the
 * campaign, an Outreach before paging sends its newest 100 of every campaign, so only that campaign's are kept.
 */
export function useOutreachCases(facilityId: string | undefined, enabled: boolean, campaignId?: string): CasesRead {
  const first = useFacilityRead(facilityId, enabled,
    useCallback((id: string) => staffApi.outreachCasesPage(id, campaignId ? { campaignId } : {}), [campaignId]), CASES_NOT_LOADED)
  const [added, setAdded] = useState<Added>(NOTHING_ADDED)
  const request = useRef(0)
  const base = first.value
  // What was added belongs to the first page it followed.
  const current = added.base === base && base !== null ? added : { ...NOTHING_ADDED, base, cursor: base?.nextCursor ?? null }

  const load = useCallback(async (): Promise<'more' | 'end' | 'failed' | 'stale'> => {
    if (!facilityId || !base || current.loading || !current.cursor) return 'stale'
    const before = current.cursor
    const seq = ++request.current
    setAdded({ ...current, loading: true, error: '' })
    try {
      const page = await staffApi.outreachCasesPage(facilityId, { limit: MORE_PAGE_SIZE, before, ...(campaignId ? { campaignId } : {}) })
      if (seq !== request.current) return 'stale'
      // A cursor that does not move on, or an empty page, would offer the same page for ever.
      const cursor = page.nextCursor && page.nextCursor !== before && page.items.length > 0 ? page.nextCursor : null
      let stale = false
      setAdded(previous => {
        if (previous.base !== base) { stale = true; return previous }
        return { base, items: [...previous.items, ...page.items], cursor, loading: false, error: '' }
      })
      if (stale) return 'stale'
      return cursor ? 'more' : 'end'
    } catch {
      if (seq !== request.current) return 'stale'
      setAdded(previous => (previous.base === base ? { ...previous, loading: false, error: MORE_FAILED } : previous))
      return 'failed'
    }
  }, [facilityId, base, current, campaignId])

  const refresh = first.refresh
  const value = base ? merged(base.items, current.items, campaignId) : null
  return {
    value,
    loading: first.loading,
    error: first.error,
    refresh,
    more: { available: current.cursor !== null, loading: current.loading, error: current.error, load },
  }
}

/** The first page and the pages added, each registration once, and only the campaign's when one is asked. */
function merged(firstPage: readonly OutreachCase[], added: readonly OutreachCase[], campaignId: string | undefined): OutreachCase[] {
  const seen = new Set<string>()
  const rows: OutreachCase[] = []
  for (const item of [...firstPage, ...added]) {
    if (seen.has(item.id) || (campaignId && item.campaignId !== campaignId)) continue
    seen.add(item.id)
    rows.push(item)
  }
  return rows
}

/**
 * "Show more" under a list, while older registrations are left. Focus stays on it as each page is added (it is never
 * disabled, so it keeps focus); after the last page it goes to the line that says everyone is shown. What was added is
 * announced. When a search is typed, a line says it looks only at the registrations shown.
 */
export function ShowMore({ more, shown, searching = false }: {
  readonly more: MoreCases
  /** How many registrations are read so far. */
  readonly shown: number
  /** A search is typed: it looks only at what is read. */
  readonly searching?: boolean
}) {
  const id = useId()
  const focus = useFocusById()
  const [said, setSaid] = useState('')
  const [ended, setEnded] = useState(false)
  const endId = `${id}-end`

  async function showMore() {
    if (more.loading) return
    setSaid('')
    const answer = await more.load()
    if (answer === 'more') setSaid('More registrations added below.')
    else if (answer === 'end') {
      setEnded(true)
      focus(endId)
    } else if (answer === 'failed') setSaid(MORE_FAILED)
  }

  if (!more.available) {
    return ended
      ? <p id={endId} tabIndex={-1} className="m-0 text-body text-ink-2 outline-none">All {shown} registrations are shown.</p>
      : null
  }
  return (
    <div className="flex flex-col items-start gap-2">
      {searching ? <p className="m-0 text-caption text-ink-3">Search looks only at the registrations shown here. Show more to search older ones.</p> : null}
      <Button icon={ChevronDown} className="hid-ehr-dept-outreach-unavailable" aria-busy={more.loading || undefined} aria-disabled={more.loading || undefined}
        onClick={() => void showMore()}>{more.loading ? 'Loading more…' : 'Show more'}</Button>
      {more.error ? <Alert intent="error" live={false}>{more.error}</Alert> : null}
      {/* Mounted throughout, so what was added (or that it failed) is announced. */}
      <p role="status" className="sr-only">{said}</p>
    </div>
  )
}

/** One registration as a card: who (large), age and sex, its status in words, and its next step. One button opens it. */
export function CaseCard({ item, campaign, canLink, group, onOpen }: {
  readonly item: OutreachCase
  readonly campaign: OutreachCampaign | undefined
  readonly canLink: boolean
  readonly group: boolean
  readonly onOpen: () => void
}) {
  const waiting = caseWaiting(item)
  return (
    <li className="flex min-w-0 overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line">
      <button type="button" id={`outreach-case-${item.id}-open`} onClick={onOpen}
        className="flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-4 text-left text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:p-5">
        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 flex-[1_1_10rem] text-[18px] font-semibold leading-tight break-words">{caseName(item)}</span>
          <Badge size="sm" tone={caseBadgeTone(item)}>{caseBadgeText(item)}</Badge>
        </span>
        <span className="text-[14px] text-ink-2">{ageText(item)} · {sexText(item)}{campaign ? ` · ${campaign.name}` : ''}</span>
        {checksRecorded(item) ? <span className="self-start"><Badge size="sm" tone="success">Health checks recorded</Badge></span> : null}
        <span className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[13px]">
          <span className={waiting ? 'inline-flex items-center gap-1 font-medium text-brand-ink' : 'text-ink-3'}>
            {nextStepText(item, canLink, group)}{waiting && canLink ? <ArrowRight className="size-3.5" aria-hidden /> : null}
          </span>
          <span className="text-ink-3 tabular">Registered {dateText(item.createdAt)}</span>
        </span>
      </button>
    </li>
  )
}
