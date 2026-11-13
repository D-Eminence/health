import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { FileText, FolderCog, UserPlus } from 'lucide-react'
import { FormActions } from '../../../../kasuwa/parts'
import { Badge, Button, cx } from '../../../../kasuwa/ui'
import type { OutreachCampaign } from '../../../../staff/api'
import { DeptPage } from '../../parts/DeptPage'
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

/**
 * Inside one campaign: its header (name, status, dates and focuses in words) and its tabs, as the member's roles allow.
 * Where it is, is kept in memory by the page (`tab`), not in the address.
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

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next === null) return
    event.preventDefault()
    const value = tabs[(next + tabs.length) % tabs.length]!
    choose(value)
    tabRefs.current.get(value)?.focus()
  }

  let panel: ReactNode = null
  if (shown === 'today') {
    panel = <CampaignToday campaignId={campaign.id} facilityId={facilityId} accountId={accountId} plan={plan}
      canSetUp={roles.includes('coordinator')} onSetUp={() => onTab('setup')} onRegistered={onRegistered} />
  } else if (shown === 'dashboard') {
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

  return (
    <DeptPage title={campaign.name} onBack={onBack} backLabel="All campaigns"
      secondaryActions={more.length ? <MoreMenu id={`${base}-more`} items={more} /> : undefined}
      description={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge size="sm" tone={campaign.status === 'active' ? 'success' : 'neutral'}>{campaignStatusLabel(campaign.status)}</Badge>
        <span>{campaignDatesText(campaign)}</span>
        {focuses ? <span>{focuses}</span> : null}
      </span>}>
      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label="Campaign" className="flex max-w-full flex-wrap gap-1 rounded-xl bg-tray p-1">
          {tabs.map((value, index) => {
            const label = TABS.find(entry => entry.value === value)!.label
            const selected = value === shown
            return (
              <button key={value} type="button" role="tab" id={`${base}-tab-${value}`} aria-selected={selected} aria-controls={`${base}-panel`}
                tabIndex={selected ? 0 : -1} ref={element => { if (element) tabRefs.current.set(value, element); else tabRefs.current.delete(value) }}
                onClick={() => choose(value)} onKeyDown={event => onKey(event, index)}
                className={cx('inline-flex h-11 min-w-[5.5rem] flex-1 cursor-pointer items-center justify-center rounded-lg border-0 px-3 text-[14px] font-medium whitespace-nowrap @lg:flex-none',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]',
                  selected ? 'bg-surface text-ink shadow-[var(--shadow-xs)] ring-1 ring-line' : 'bg-transparent text-ink-2 hover:text-ink')}>
                {label}
              </button>
            )
          })}
        </div>
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={shown ? `${base}-tab-${shown}` : undefined} className="min-w-0">
          {panel}
        </div>
        {action ? (
          <FormActions>
            <Button id={`${base}-main`} variant="primary" size="lg" className="h-14" icon={UserPlus} onClick={() => choose('today')}>{action}</Button>
          </FormActions>
        ) : null}
      </div>
    </DeptPage>
  )
}
