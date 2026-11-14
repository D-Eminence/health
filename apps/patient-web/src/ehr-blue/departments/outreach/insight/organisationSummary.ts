import { useCallback } from 'react'
import type { OutreachCampaign, OutreachCase } from '../../../../staff/api'
import { outreachCampaignApi } from '../campaignApi'
import { canSeeSensitive, focusIdOf, focusLabel, type FocusId, type OrganisationSummary } from '../campaignTypes'
import type { CampaignSummary } from './campaignSummary'
import { useCampaignRead, SENSITIVE_FOCUSES } from './insightParts'

/*
 * The organisation's numbers for the Outreach home (owner, 13 November 2026: "the proper numbers first"): from the
 * proposed GET …/organisation/summary where Outreach serves it; else worked out here from what is already read (the
 * campaigns listed, each one's plan and dashboard, and the registrations this login may read). Where nothing can be
 * worked out, there are no numbers and the home shows the campaigns.
 */

/** Today's month in Lagos, as YYYY-MM. */
const lagosMonth = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).slice(0, 7)

/** A campaign running now: open, and inside its dates. */
export const isRunning = (campaign: OutreachCampaign, now = Date.now()) => campaign.status === 'active'
  && Date.parse(campaign.startsAt) <= now && (!campaign.endsAt || Date.parse(campaign.endsAt) > now)

/**
 * The organisation's numbers worked out from the campaigns' own reads. Null when no campaign's dashboard was read (then
 * there is nothing to count but campaigns, which the list says itself).
 */
export function workOutSummary(campaigns: readonly OutreachCampaign[], summaryOf: (campaignId: string) => CampaignSummary | undefined,
  cases: readonly OutreachCase[] | null, now = Date.now()): OrganisationSummary | null {
  const read = campaigns.map(campaign => ({ campaign, summary: summaryOf(campaign.id) }))
  const counted = read.filter(entry => entry.summary?.dashboard)
  if (!counted.length) return null
  const byFocus = new Map<FocusId, { focus: FocusId; label: string; campaigns: number; screened: number; positive: number; referred: number }>()
  const row = (focus: FocusId, label: string) => {
    const found = byFocus.get(focus) ?? { focus, label, campaigns: 0, screened: 0, positive: 0, referred: 0 }
    byFocus.set(focus, found)
    return found
  }
  for (const { summary } of read) {
    for (const focus of summary?.plan?.focuses ?? []) row(focusIdOf(focus), focusLabel(focus)).campaigns += 1
  }
  let screened = 0
  let positive = 0
  let referred = 0
  let registered = 0
  for (const { summary } of counted) {
    const dashboard = summary!.dashboard!
    // Positives of HIV and hepatitis B only where this login may see them, as on the campaign's own dashboard.
    const sensitive = canSeeSensitive(summary!.team?.you?.roles ?? [])
    const labels = new Map((summary!.plan?.focuses ?? []).map(focus => [focusIdOf(focus), focusLabel(focus)]))
    registered += dashboard.registered
    screened += dashboard.screened
    referred += dashboard.outcomes.referUrgent + dashboard.outcomes.referRoutine
    for (const focusRow of dashboard.byFocus) {
      const shows = sensitive || !SENSITIVE_FOCUSES.has(focusRow.focus)
      const entry = row(focusRow.focus, labels.get(focusRow.focus) ?? focusLabel(focusRow.focus, focusRow.label))
      if (!summary!.plan) entry.campaigns += 1
      entry.screened += focusRow.screened
      entry.referred += focusRow.referred
      if (shows) { entry.positive += focusRow.positive; positive += focusRow.positive }
    }
  }
  const inCampaigns = cases?.filter(item => item.campaignId) ?? null
  const month = lagosMonth(now)
  const rows = [...byFocus.values()]
  return {
    campaigns: {
      total: campaigns.length,
      running: campaigns.filter(campaign => isRunning(campaign, now)).length,
      planned: campaigns.filter(campaign => campaign.status === 'planned').length,
      closed: campaigns.filter(campaign => campaign.status === 'closed').length,
    },
    people: inCampaigns
      ? { reached: inCampaigns.length, thisMonth: inCampaigns.filter(item => item.createdAt && lagosMonth(Date.parse(item.createdAt)) === month).length }
      : { reached: registered, thisMonth: -1 },
    screened, positive, referred,
    byFocus: rows,
    // A general check looks for no one condition: the conditions are the rest.
    conditions: rows.filter(entry => entry.focus !== 'general_check' && entry.screened > 0)
      .map(entry => ({ condition: entry.focus, label: entry.label, screened: entry.screened, positive: entry.positive })),
  }
}

export type OrganisationNumbers =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: OrganisationSummary }
  /** Nothing to count yet (or nothing could be read): the home shows its campaigns. */
  | { readonly state: 'none' }

/** The organisation's numbers: the served summary, else worked out from what the page already read. */
export function useOrganisationNumbers(facilityId: string | undefined, enabled: boolean, worked: () => OrganisationSummary | null, settled: boolean): OrganisationNumbers {
  const { read } = useCampaignRead(Boolean(facilityId) && enabled,
    useCallback((signal: AbortSignal) => outreachCampaignApi.organisationSummary(facilityId!, signal), [facilityId]), 'The numbers could not be read.')
  if (read.state === 'ready') return { state: 'ready', value: read.value }
  if (read.state === 'loading' && enabled) return { state: 'loading' }
  if (read.state === 'error' && read.value) return { state: 'ready', value: read.value }
  // Not served (or not read): what the campaigns' own reads say, once they are in.
  const value = worked()
  if (value) return { state: 'ready', value }
  return settled ? { state: 'none' } : { state: 'loading' }
}
