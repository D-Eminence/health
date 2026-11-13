import { useState } from 'react'
import { Check, Search, Users } from 'lucide-react'
import { PageState } from '../../../../kasuwa/parts'
import { Alert, Badge, Button, FilterTabs, Input, type Tone } from '../../../../kasuwa/ui'
import type { OutreachCase } from '../../../../staff/api'
import { useFocusById } from '../../../../staff/focus'
import { dateText, matchesSearch } from '../../parts/format'
import { stationLabel, STATIONS, type OutreachVisit, type StationKind } from '../campaignTypes'
import { ageText, caseName, sexText } from '../outreachParts'
import { outcomeText } from '../screeningTemplates'

/** The list shows this many people a page. */
const PAGE_SIZE = 50

type PeopleFilter = 'seeing' | 'finished' | 'all'

export interface PeopleRead {
  readonly value: OutreachCase[] | null
  readonly loading: boolean
  readonly error: string
  readonly refresh: () => Promise<void>
}

/** A visit's outcome as a badge: its word, and a tone that only repeats it. */
export function outcomeBadge(visit: OutreachVisit): { label: string; tone: Tone } {
  const outcome = visit.outcome
  if (!outcome) return { label: 'Being seen', tone: 'neutral' }
  if (outcome.kind === 'normal') return { label: outcomeText('normal'), tone: 'success' }
  if (outcome.kind === 'follow_up') return { label: outcomeText('follow_up'), tone: 'warn' }
  return { label: outcomeText('refer', outcome.urgency), tone: outcome.urgency === 'urgent' ? 'danger' : 'warn' }
}

const digitsOf = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')
/** A phone's last nine digits: "08031234567", "+2348031234567" and "803 123 4567" are the same number. */
const phoneKey = (value: string | null | undefined) => digitsOf(value).slice(-9)

/** Whether a visit matches the search: by name (every word), by visit code (with or without the dash), or by phone. */
export function visitMatches(visit: OutreachVisit, query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  const digits = digitsOf(trimmed)
  // A number of 7 or more digits is a phone number: it matches the end of theirs.
  if (digits.length >= 7 && digits.length === trimmed.replace(/[\s+()-]/g, '').length) {
    const theirs = phoneKey(visit.phone)
    return theirs.length > 0 && (theirs.endsWith(digits.slice(-9)) || digits.slice(-9).endsWith(theirs))
  }
  const code = (visit.visitCode ?? '').toUpperCase()
  const bare = trimmed.toUpperCase().replace(/[\s-]/g, '')
  if (code && bare.length >= 3 && code.replace('-', '').includes(bare)) return true
  return matchesSearch(trimmed, [caseName(visit), code])
}

/**
 * The campaign's People tab: everyone registered in it, newest first, as cards (name, age and sex, visit code, the
 * stations done, the outcome), with search by name, visit code or phone, a filter by whether they are still being seen,
 * and pages of 50. A card opens the person's visit.
 */
export function CampaignPeople({ campaignId, cases, stations, onOpen }: {
  readonly campaignId: string
  readonly cases: PeopleRead
  /** The stations the plan uses, in order (all of them when unknown). */
  readonly stations?: readonly StationKind[]
  readonly onOpen: (visit: OutreachVisit) => void
}) {
  const [filter, setFilter] = useState<PeopleFilter>('seeing')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const focus = useFocusById()
  const searchId = `outreach-people-search-${campaignId}`
  const all = (cases.value ?? []).filter(item => item.campaignId === campaignId) as OutreachVisit[]
  all.sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
  const seeing = all.filter(visit => !visit.outcome)
  const inFilter = (visit: OutreachVisit) => filter === 'all' || (filter === 'seeing') === !visit.outcome
  const rows = all.filter(visit => inFilter(visit) && visitMatches(visit, search))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const shownPage = Math.min(page, pages - 1)
  const first = shownPage === 0
  const last = shownPage + 1 >= pages
  const order = stations?.length ? stations : STATIONS.map(station => station.value)
  const listed = cases.value !== null
  const empty = all.length === 0
    ? { icon: Users, title: 'No one registered yet', description: 'People registered in this campaign show here, with how far each has got.' }
    : rows.length ? null
      : search ? { icon: Search, title: 'No one matches', description: 'Check the spelling, or search by visit code or phone number.' }
        : filter === 'seeing' ? { icon: Check, title: 'No one is being seen', description: 'Everyone registered has an outcome.' }
          : { icon: Users, title: 'No one has finished yet', description: 'People show here once their outcome is confirmed.' }

  return (
    <section aria-label="People" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 @xl:flex-row @xl:flex-wrap @xl:items-center @xl:justify-between">
        <FilterTabs label="Show people" value={filter} onChange={value => { setFilter(value); setPage(0) }} options={[
          { value: 'seeing', label: 'Being seen', count: seeing.length },
          { value: 'finished', label: 'Finished', count: all.length - seeing.length },
          { value: 'all', label: 'All', count: all.length },
        ]} />
        <div className="flex min-w-0 items-center gap-2 @xl:w-96">
          <label htmlFor={searchId} className="sr-only">Search people</label>
          <Input id={searchId} type="search" icon={Search} className="min-w-0 flex-1" value={search} autoComplete="off"
            placeholder="Name, visit code or phone" onChange={event => { setSearch(event.target.value); setPage(0) }} />
          {search ? <Button onClick={() => { setSearch(''); setPage(0); focus(searchId) }}>Clear</Button> : null}
        </div>
      </div>
      {cases.error && listed ? <Alert intent="error" title="Couldn’t refresh the list">{cases.error}</Alert> : null}
      <PageState loading={cases.loading} error={listed ? null : cases.error || null} hasData={listed} onRetry={() => void cases.refresh()}
        what="people" empty={empty}>
        <ul aria-label="People in this campaign" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
          {rows.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE).map(visit => (
            <VisitCard key={visit.id} visit={visit} order={order} onOpen={() => onOpen(visit)} />
          ))}
        </ul>
        {rows.length > PAGE_SIZE ? (
          <nav className="flex flex-wrap items-center justify-center gap-3" aria-label="People pages">
            <Button aria-disabled={first || undefined} onClick={() => { if (!first) setPage(shownPage - 1) }}>Previous page</Button>
            <span className="text-[14px] text-ink-2">Page {shownPage + 1} of {pages}</span>
            <Button aria-disabled={last || undefined} onClick={() => { if (!last) setPage(shownPage + 1) }}>Next page</Button>
          </nav>
        ) : null}
      </PageState>
    </section>
  )
}

/** One person: name (large), age and sex, the visit code, each station ticked or not, and the outcome. One button opens it. */
function VisitCard({ visit, order, onOpen }: { readonly visit: OutreachVisit; readonly order: readonly StationKind[]; readonly onOpen: () => void }) {
  const badge = outcomeBadge(visit)
  const done = new Set(visit.stationsDone ?? ['register'])
  const doneCount = order.filter(station => done.has(station)).length
  return (
    <li className="flex min-w-0 overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line">
      <button type="button" id={`outreach-visit-${visit.id}-open`} onClick={onOpen}
        className="flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-4 text-left text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:p-5">
        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 flex-[1_1_10rem] text-[18px] leading-tight font-semibold break-words">{caseName(visit)}</span>
          <Badge size="sm" tone={badge.tone}>{badge.label}</Badge>
        </span>
        <span className="text-[14px] text-ink-2">{ageText(visit)} · {sexText(visit)}</span>
        {visit.visitCode ? <span className="text-[14px] text-ink-2">Visit code <span className="font-semibold tracking-[.06em] text-ink">{visit.visitCode}</span></span> : null}
        <span className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
          <span className="sr-only">{doneCount} of {order.length} stations done:</span>
          <span className="flex flex-wrap gap-1.5">
            {order.map(station => (
              <span key={station} className={done.has(station)
                ? 'inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[12px] font-medium text-success-ink'
                : 'inline-flex items-center gap-1 rounded-full bg-tray px-2 py-0.5 text-[12px] text-ink-3'}>
                {done.has(station) ? <Check className="size-3" aria-hidden /> : null}
                {stationLabel(station)}<span className="sr-only">{done.has(station) ? ' done' : ' not yet'},</span>
              </span>
            ))}
          </span>
          <span className="text-[13px] text-ink-3 tabular">Registered {dateText(visit.createdAt)}</span>
        </span>
      </button>
    </li>
  )
}
