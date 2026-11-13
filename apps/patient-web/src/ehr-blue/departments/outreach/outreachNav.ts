import { useSyncExternalStore } from 'react'
import { TABS, type CampaignTab } from './insight/tabs'

/*
 * What Outreach on its own tells the frame's menu (owner, 13 November 2026): the tabs of the campaign open or remembered,
 * as this person's roles allow them, so the sidebar and the phone tab bar list Campaigns and those tabs only. Kept in
 * memory for the visit: never anything about a person, and nothing of a campaign but which tabs it has.
 *
 * Each tab has its own address below Outreach (/provider/outreach/dashboard), so the menu can point at it and show
 * where the person is. Which campaign it is stays in memory (and in the day settings on this device), never the address.
 */

export const OUTREACH_HOME = '/provider/outreach'

export interface OutreachNavState {
  readonly facilityId: string
  /** The campaign's name, for the menu's heading. */
  readonly campaignName: string
  readonly tabs: readonly CampaignTab[]
}

let current: OutreachNavState | null = null
const listeners = new Set<() => void>()

function same(a: OutreachNavState | null, b: OutreachNavState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.facilityId === b.facilityId && a.campaignName === b.campaignName && a.tabs.join() === b.tabs.join()
}

/** Says which campaign tabs the menu lists now (null: none, only Campaigns). */
export function setOutreachNav(next: OutreachNavState | null) {
  if (same(current, next)) return
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The campaign tabs the menu lists, for the facility open now. */
export function useOutreachNav(facilityId: string | undefined): OutreachNavState | null {
  const state = useSyncExternalStore(subscribe, () => current, () => null)
  return state && state.facilityId === facilityId ? state : null
}

/** The address of a campaign tab. */
export const tabAddress = (tab: CampaignTab) => `${OUTREACH_HOME}/${tab}`

/** The tab an address names (/provider/outreach/people → people), or null for Outreach's own address or any other. */
export function tabOfAddress(pathname: string): CampaignTab | null {
  const match = /^\/provider\/outreach\/([a-z-]+)\/?$/.exec(pathname)
  const tab = match ? TABS.find(entry => entry.value === match[1]) : undefined
  return tab ? tab.value : null
}

/** Whether an address is Outreach's own (its list) or one of its tabs. */
export const isOutreachAddress = (pathname: string) => pathname === OUTREACH_HOME || pathname === `${OUTREACH_HOME}/` || tabOfAddress(pathname) !== null

export const tabLabel = (tab: CampaignTab) => TABS.find(entry => entry.value === tab)?.label ?? tab
