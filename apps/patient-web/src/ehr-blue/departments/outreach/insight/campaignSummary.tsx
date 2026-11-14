import { useEffect } from 'react'
import { isHidApiError } from '@hid/http'
import { outreachCampaignApi, whenOffered } from '../campaignApi'
import type { CampaignDashboard, CampaignTeam, OutreachPlan } from '../campaignTypes'

/**
 * What the hub knows of one campaign from its campaign routes (owner decisions of 13 November 2026): whether this
 * Outreach serves them for it (`offered`), the caller's place on its team, its plan (null when none is saved yet) and
 * its counts. A campaign whose routes are not offered is shown as today's campaign record; the rest open the campaign
 * hub. Each part is null when it could not be read.
 */
export interface CampaignSummary {
  readonly facilityId: string
  /** True when served, false when this Outreach doesn't serve them (404), null when it couldn't be told (no connection). */
  readonly offered: boolean | null
  readonly team: CampaignTeam | null
  readonly plan: OutreachPlan | null
  readonly dashboard: CampaignDashboard | null
}

async function settle<T>(call: () => Promise<T>): Promise<{ offered: boolean | null; value: T | null }> {
  try {
    const answer = await whenOffered(call)
    return answer.offered ? { offered: true, value: answer.value } : { offered: false, value: null }
  } catch (caught) {
    // An answer from Outreach (a refusal, no plan yet) means the route is served; anything else says nothing either way.
    return { offered: isHidApiError(caught) ? true : null, value: null }
  }
}

export async function readCampaignSummary(facilityId: string, campaignId: string, signal?: AbortSignal): Promise<CampaignSummary> {
  const [team, plan, dashboard] = await Promise.all([
    settle(async () => outreachCampaignApi.team(facilityId, campaignId, signal)),
    settle(async () => outreachCampaignApi.plan(facilityId, campaignId, signal)),
    settle(async () => outreachCampaignApi.dashboard(facilityId, campaignId, signal)),
  ])
  const parts = [team.offered, plan.offered, dashboard.offered]
  const offered = parts.includes(true) ? true : parts.includes(null) ? null : false
  return { facilityId, offered, team: team.value, plan: plan.value, dashboard: dashboard.value }
}

/**
 * Reads one campaign's summary as it is listed (and again when `epoch` changes), and hands it to the page. It draws
 * nothing, as CampaignMembersRead.
 */
export function CampaignSummaryRead({ facilityId, campaignId, epoch, onRead }: {
  readonly facilityId: string
  readonly campaignId: string
  readonly epoch: number
  readonly onRead: (campaignId: string, summary: CampaignSummary) => void
}) {
  useEffect(() => {
    const abort = new AbortController()
    void readCampaignSummary(facilityId, campaignId, abort.signal).then(summary => { if (!abort.signal.aborted) onRead(campaignId, summary) })
    return () => abort.abort()
  }, [facilityId, campaignId, epoch, onRead])
  return null
}
