import type { OutreachCampaign } from '../../../../staff/api'
import type { TeamRole } from '../campaignTypes'
import type { CampaignSummary } from './campaignSummary'
import { dayText } from './insightParts'

export type CampaignTab = 'today' | 'dashboard' | 'people' | 'followups' | 'team' | 'setup'

export const TABS: ReadonlyArray<{ readonly value: CampaignTab; readonly label: string; readonly roles: ReadonlySet<TeamRole> }> = [
  { value: 'today', label: 'Today', roles: new Set<TeamRole>(['coordinator', 'registrar', 'vitals', 'tester', 'counsellor', 'clinician']) },
  { value: 'dashboard', label: 'Dashboard', roles: new Set<TeamRole>(['coordinator', 'data_checker']) },
  { value: 'people', label: 'People', roles: new Set<TeamRole>(['coordinator', 'registrar', 'vitals', 'tester', 'counsellor', 'clinician', 'data_checker']) },
  { value: 'followups', label: 'Follow-ups', roles: new Set<TeamRole>(['coordinator', 'counsellor', 'clinician']) },
  { value: 'team', label: 'Team', roles: new Set<TeamRole>(['coordinator']) },
  { value: 'setup', label: 'Setup', roles: new Set<TeamRole>(['coordinator']) },
]

/** The tabs a member with these roles sees, in order (owner's brief: each role sees only what it works with). */
export function tabsFor(roles: readonly string[]): CampaignTab[] {
  return TABS.filter(tab => roles.some(role => tab.roles.has(role as TeamRole))).map(tab => tab.value)
}

/** Who may read the report: coordinators and data checkers. */
export const canReadReport = (roles: readonly string[]) => roles.includes('coordinator') || roles.includes('data_checker')

/**
 * The roles the hub goes by: the caller's on the campaign's team; someone not on it (or before the team is read) is a
 * coordinator when they may write campaigns here, else a registrar.
 */
export function hubRoles(summary: CampaignSummary | undefined, mayWriteCampaigns: boolean): readonly string[] {
  const you = summary?.team?.you
  if (you && you.roles.length) return you.roles
  return mayWriteCampaigns ? ['coordinator'] : ['registrar']
}

/** "13 Nov to 14 Nov 2026", or "From 13 Nov 2026". */
export function campaignDatesText(campaign: Pick<OutreachCampaign, 'startsAt' | 'endsAt'>): string {
  return campaign.endsAt ? `${dayText(campaign.startsAt)} to ${dayText(campaign.endsAt, true)}` : `From ${dayText(campaign.startsAt, true)}`
}

