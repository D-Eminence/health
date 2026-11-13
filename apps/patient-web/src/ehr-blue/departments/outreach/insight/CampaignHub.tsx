import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { CalendarCheck, ChartColumn, FileText, FolderCog, PhoneCall, Settings2, UserPlus, Users, UsersRound } from 'lucide-react'
import { EhrBackButton } from '@hid/ui/ehr'
import { FormActions } from '../../../../kasuwa/parts'
import { Badge, Button, cx, type Icon } from '../../../../kasuwa/ui'
import type { OutreachCampaign } from '../../../../staff/api'
import '../../departments.css'
import { useOutreachStandalone } from '../outreachNav'
import { CampaignSetup, CampaignTeam } from '../plan'
import { focusLabel, type OutreachVisit } from '../campaignTypes'
import { campaignStatusLabel } from '../outreachParts'
import { CampaignDashboard } from './CampaignDashboard'
import { CampaignPeople, type PeopleFilter, type PeopleRead } from './CampaignPeople'
import { CampaignToday } from './CampaignToday'
import type { CampaignSummary } from './campaignSummary'
import { FollowUps } from './FollowUps'
import { MoreMenu, type MoreItem } from './MoreMenu'
import { campaignDatesText, hubTabs, roleAction, shownTab, TABS, type CampaignTab } from './tabs'

const SECTION_ICON: Readonly<Record<CampaignTab, Icon>> = {
  overview: ChartColumn, today: CalendarCheck, people: Users, followups: PhoneCall, team: UsersRound, setup: Settings2,
}

/** The page's own width, as it changes (undefined where it can't be measured: then every section is a tab). */
function useWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/** Whether the phone's tab bar is shown (below 64rem, as the shell's lg:hidden). */
function useTabBarShown(): boolean {
  const query = '(max-width: 63.98rem)'
  const [shown, setShown] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const list = matchMedia(query)
    const change = () => setShown(list.matches)
    change()
    list.addEventListener('change', change)
    return () => list.removeEventListener('change', change)
  }, [])
  return shown
}

/** How many sections fit as tabs in one row at this width (all on a wide page). */
function sectionsThatFit(width: number | undefined): number {
  if (width === undefined || width >= 640) return Infinity
  return width >= 352 ? 4 : width >= 260 ? 3 : 2
}

/**
 * Inside one campaign: a compact header (back, the name in at most two lines and More on one row; status and dates on
 * the next; the focuses under them) and its sections, as the member's roles allow, in one row: every section as a tab
 * where they fit, else the first ones (the ones the roles use most) and the rest under one More. One rule against
 * saying a place twice: where Outreach is on its own, a phone's tab bar carries Today, so the row leaves Today out there
 * (unless only one section would be left in it).
 * Where it is, is kept in memory by the page (`tab`) and the section's address.
 */
export function CampaignHub({ campaign, summary, roles, tab, onTab, facilityId, accountId, cases, onBack, onOpenVisit, onRegistered,
  onReport, onRecord }: {
  readonly campaign: OutreachCampaign
  readonly summary: CampaignSummary | undefined
  readonly roles: readonly string[]
  readonly tab: CampaignTab | undefined
  readonly onTab: (tab: CampaignTab) => void
  readonly facilityId: string
  readonly accountId: string | undefined
  readonly cases: PeopleRead | null
  readonly onBack: () => void
  readonly onOpenVisit: (visit: OutreachVisit) => void
  readonly onRegistered: (visit: OutreachVisit) => void
  /** Opens the report, for those who may read it. */
  readonly onReport?: () => void
  /** Opens today's campaign record (open, close, members), for its admins. */
  readonly onRecord?: () => void
}) {
  const tabs = hubTabs(roles, cases !== null)
  const shown = shownTab(tabs, tab)
  const plan = summary ? summary.plan : undefined
  const focuses = plan?.focuses.map(focus => focusLabel(focus)).join(', ')
  const base = `outreach-campaign-${campaign.id}`
  const tabRefs = useRef(new Map<CampaignTab, HTMLButtonElement>())
  // The People filter a dashboard tile asked for (Positive: those who need care); a tab chosen by itself shows the default.
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter | undefined>(undefined)
  const choose = (value: CampaignTab) => { setPeopleFilter(undefined); onTab(value) }
  // The sections in the row: Today left out where the phone's tab bar carries it; as many as fit, the rest under More.
  const root = useRef<HTMLDivElement>(null)
  const width = useWidth(root)
  const standalone = useOutreachStandalone()
  const barShown = useTabBarShown()
  const barCarriesToday = standalone && barShown
  // (Unless that left one section alone in the row: a field role keeps Today | People, a switch rather than a lone button.)
  const withoutToday = tabs.filter(value => value !== 'today')
  const sections = barCarriesToday && withoutToday.length >= 2 ? withoutToday : tabs
  const fit = sectionsThatFit(width)
  const inRow = sections.length <= fit ? sections : sections.slice(0, Math.max(1, fit - 1))

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? inRow.length - 1 : null
    if (next === null) return
    event.preventDefault()
    const value = inRow[(next + inRow.length) % inRow.length]!
    choose(value)
    tabRefs.current.get(value)?.focus()
  }

  let panel: ReactNode = null
  if (shown === 'today') {
    panel = <CampaignToday campaignId={campaign.id} facilityId={facilityId} accountId={accountId} plan={plan}
      canSetUp={roles.includes('coordinator')} onSetUp={() => onTab('setup')} onRegistered={onRegistered} />
  } else if (shown === 'overview') {
    panel = <CampaignDashboard campaignId={campaign.id} roles={roles} opens={tabs} onOpen={(to, filter) => {
      setPeopleFilter(filter)
      onTab(to)
    }} />
  } else if (shown === 'people' && cases) {
    panel = <CampaignPeople key={peopleFilter ?? 'default'} campaignId={campaign.id} cases={cases} stations={plan?.stations} onOpen={onOpenVisit}
      initialFilter={peopleFilter} />
  } else if (shown === 'followups') {
    panel = <FollowUps campaignId={campaign.id} />
  } else if (shown === 'team') {
    panel = <CampaignTeam campaignId={campaign.id} embedded />
  } else if (shown === 'setup') {
    panel = <CampaignSetup campaignId={campaign.id} embedded />
  }

  // The header's secondary actions fold into one More (⋯): never a row of buttons competing with the work.
  const more: MoreItem[] = [
    ...(onReport ? [{ id: `${base}-report`, label: 'Report', icon: FileText, onSelect: onReport }] : []),
    ...(onRecord ? [{ id: `${base}-record`, label: 'Campaign record', icon: FolderCog, onSelect: onRecord }] : []),
  ]
  // Away from Today, the role's main action, in thumb reach at the bottom (sticky on phones, rightmost on a computer).
  const action = shown !== 'today' && tabs.includes('today') ? roleAction(roles) : null
  const labelOf = (value: CampaignTab) => TABS.find(entry => entry.value === value)!.label
  const shownInRow = inRow.includes(shown as CampaignTab)
  const folded = sections.filter(value => !inRow.includes(value))
  const foldedShown = shown !== undefined && folded.includes(shown)

  return (
    <div ref={root} className="hid-ehr-dept">
      <header className="mb-5 flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <EhrBackButton label="All campaigns" onClick={onBack} />
          <h1 className="hid-ehr-page-title m-0 line-clamp-2 min-w-0 flex-1 break-words">{campaign.name}</h1>
          {more.length ? <MoreMenu id={`${base}-more`} items={more} className="shrink-0" /> : null}
        </div>
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
          <Badge size="sm" tone={campaign.status === 'active' ? 'success' : 'neutral'}>{campaignStatusLabel(campaign.status)}</Badge>
          <span className="whitespace-nowrap">{campaignDatesText(campaign)}</span>
        </p>
        {focuses ? <p className="m-0 text-[13px] break-words text-ink-2">{focuses}</p> : null}
      </header>
      <div className="flex flex-col gap-4">
        {inRow.length || folded.length ? (
          <div className="flex min-w-0 items-stretch gap-1 rounded-xl bg-tray p-1">
            {inRow.length ? (
              <div role="tablist" aria-label="Campaign" className="flex min-w-0 flex-1 gap-1 @2xl:flex-none">
                {inRow.map((value, index) => {
                  const selected = value === shown
                  const reachable = selected || (!shownInRow && index === 0)
                  return (
                    <button key={value} type="button" role="tab" id={`${base}-tab-${value}`} aria-selected={selected} aria-controls={`${base}-panel`}
                      tabIndex={reachable ? 0 : -1} ref={element => { if (element) tabRefs.current.set(value, element); else tabRefs.current.delete(value) }}
                      onClick={() => choose(value)} onKeyDown={event => onKey(event, index)}
                      className={cx('inline-flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-lg border-0 px-2 text-[14px] font-medium whitespace-nowrap @2xl:flex-none @2xl:px-4',
                        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
                        selected ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-2 hover:text-ink')}>
                      <span className="truncate">{labelOf(value)}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {folded.length ? (
              <MoreMenu id={`${base}-sections-more`} className="shrink-0"
                label={foldedShown ? { text: labelOf(shown!), name: `${labelOf(shown!)}, more sections`, selected: true } : { text: 'More', name: 'More sections', selected: false }}
                currentId={foldedShown ? `${base}-section-${shown}` : undefined}
                items={folded.map(value => ({ id: `${base}-section-${value}`, label: labelOf(value), icon: SECTION_ICON[value], onSelect: () => choose(value) }))} />
            ) : null}
          </div>
        ) : null}
        <div role="tabpanel" id={`${base}-panel`} className="min-w-0"
          {...(shown && shownInRow ? { 'aria-labelledby': `${base}-tab-${shown}` } : { 'aria-label': shown ? labelOf(shown) : campaign.name })}>
          {panel}
        </div>
        {action ? (
          <FormActions>
            <Button id={`${base}-main`} variant="primary" size="lg" className="h-14" icon={UserPlus} onClick={() => choose('today')}>{action}</Button>
          </FormActions>
        ) : null}
      </div>
    </div>
  )
}
