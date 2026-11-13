import { ChevronRight } from 'lucide-react'
import { Badge } from '../../../../kasuwa/ui'
import type { OutreachCampaign } from '../../../../staff/api'
import { dateText } from '../../parts/format'
import { canSeeSensitive, focusLabel } from '../campaignTypes'
import { campaignStatusLabel, servicesText } from '../outreachParts'
import { campaignDatesText } from './tabs'
import type { CampaignSummary } from './campaignSummary'
import { SENSITIVE_FOCUSES } from './insightParts'

/** The numbers a campaign's card shows, from its summary; null for a campaign whose routes aren't offered. */
export function cardCounts(summary: CampaignSummary | undefined, registeredHere: number | undefined) {
  const dashboard = summary?.dashboard
  if (!summary?.offered) return null
  const sensitive = canSeeSensitive(summary.team?.you?.roles ?? [])
  const focusRows = dashboard?.byFocus ?? []
  const hidesSome = !sensitive && focusRows.some(row => SENSITIVE_FOCUSES.has(row.focus))
  return {
    sites: summary.plan?.sites.length ?? null,
    registered: dashboard?.registered ?? registeredHere ?? null,
    positives: dashboard && !hidesSome ? focusRows.reduce((sum, row) => sum + row.positive, 0) : null,
    referrals: dashboard ? dashboard.outcomes.referUrgent + dashboard.outcomes.referRoutine : null,
    urgent: dashboard?.outcomes.referUrgent ?? 0,
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * The campaigns as cards: name (large), status in words, dates, focuses, and where the campaign routes are served its
 * sites, people registered, positives (to those who may see them) and referrals. One button opens it.
 */
export function CampaignCards({ campaigns, summaryOf, registeredIn, onOpen }: {
  readonly campaigns: readonly OutreachCampaign[]
  readonly summaryOf: (campaignId: string) => CampaignSummary | undefined
  readonly registeredIn: (campaignId: string) => number | undefined
  readonly onOpen: (campaign: OutreachCampaign) => void
}) {
  return (
    <ul aria-label="Campaigns" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3 p-0">
      {campaigns.map(campaign => {
        const summary = summaryOf(campaign.id)
        const counts = cardCounts(summary, registeredIn(campaign.id))
        const focuses = summary?.plan?.focuses.map(focus => focusLabel(focus)).join(', ')
        const stats = counts ? [
          counts.sites !== null ? plural(counts.sites, 'site', 'sites') : null,
          counts.registered !== null ? `${counts.registered} registered` : null,
          counts.positives !== null ? `${counts.positives} positive` : null,
          counts.referrals !== null ? plural(counts.referrals, 'referral', 'referrals') : null,
        ].filter(Boolean) as string[] : []
        return (
          <li key={campaign.id} className="flex min-w-0 overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line">
            <button type="button" id={`outreach-campaign-${campaign.id}-open`} onClick={() => onOpen(campaign)}
              className="flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-4 text-left text-ink transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)] sm:p-5">
              <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 flex-[1_1_10rem] text-[18px] leading-tight font-semibold break-words">{campaign.name}</span>
                <Badge size="sm" tone={campaign.status === 'active' ? 'success' : 'neutral'}>{campaignStatusLabel(campaign.status)}</Badge>
              </span>
              {counts ? <>
                <span className="text-[14px] text-ink-2">{campaignDatesText(campaign)}</span>
                {focuses ? <span className="text-[14px] text-ink-2">{focuses}</span> : null}
              </> : <span className="text-[13px] text-ink-3">{servicesText(campaign.services)} · starts {dateText(campaign.startsAt)}</span>}
              {stats.length ? (
                <span className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-[13px] text-ink-2 tabular">
                  <span>{stats.join(' · ')}</span>
                  {counts && counts.urgent > 0 && campaign.status !== 'closed' ? <Badge size="sm" tone="danger">{counts.urgent} urgent</Badge> : <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
