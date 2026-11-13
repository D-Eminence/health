import type { OutreachCampaign } from '../../../../staff/api'
import type { TeamRole } from '../campaignTypes'
import type { CampaignSummary } from './campaignSummary'
import { dayText } from './insightParts'

export type CampaignTab = 'overview' | 'today' | 'people' | 'followups' | 'team' | 'setup'

/**
 * A campaign's sections, in order (owner, 13 Nov 2026): Overview (the campaign's numbers; there is no "Dashboard" in
 * Outreach, as the organisation's Overview is its home), Today, People, Follow-ups, Team, Setup.
 */
export const TABS: ReadonlyArray<{ readonly value: CampaignTab; readonly label: string; readonly roles: ReadonlySet<TeamRole> }> = [
  { value: 'overview', label: 'Overview', roles: new Set<TeamRole>(['coordinator', 'data_checker']) },
  { value: 'today', label: 'Today', roles: new Set<TeamRole>(['coordinator', 'registrar', 'vitals', 'tester', 'counsellor', 'clinician']) },
  { value: 'people', label: 'People', roles: new Set<TeamRole>(['coordinator', 'registrar', 'vitals', 'tester', 'counsellor', 'clinician', 'data_checker']) },
  { value: 'followups', label: 'Follow-ups', roles: new Set<TeamRole>(['coordinator', 'counsellor', 'clinician']) },
  { value: 'team', label: 'Team', roles: new Set<TeamRole>(['coordinator']) },
  { value: 'setup', label: 'Setup', roles: new Set<TeamRole>(['coordinator']) },
]

/** The tabs a member with these roles sees, in order (owner's brief: each role sees only what it works with). */
export function tabsFor(roles: readonly string[]): CampaignTab[] {
  return TABS.filter(tab => roles.some(role => tab.roles.has(role as TeamRole))).map(tab => tab.value)
}

/** The tabs the hub shows: the roles' tabs, People only where registrations can be read. */
export function hubTabs(roles: readonly string[], canReadPeople: boolean): CampaignTab[] {
  return tabsFor(roles).filter(value => value !== 'people' || canReadPeople)
}

/**
 * The tab shown: the one asked for when the roles have it, else their first: Overview for a coordinator or data checker,
 * Today for those who work in the field.
 */
export function shownTab(tabs: readonly CampaignTab[], asked: CampaignTab | undefined): CampaignTab | undefined {
  return asked && tabs.includes(asked) ? asked : tabs[0]
}

/**
 * The main action of a role inside a campaign, away from Today (owner, 13 Nov 2026: one focal point in thumb reach):
 * "Register a person" for a registrar, "Next person" for a station role, none for a coordinator or data checker.
 */
export function roleAction(roles: readonly string[]): string | null {
  if (roles.includes('coordinator') || roles.includes('data_checker')) return null
  if (roles.includes('registrar')) return 'Register a person'
  return roles.some(role => role === 'vitals' || role === 'tester' || role === 'counsellor' || role === 'clinician') ? 'Next person' : null
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

