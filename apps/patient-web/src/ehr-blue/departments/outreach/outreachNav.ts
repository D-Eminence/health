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

/*
 * One search (owner, 13 November 2026): the top bar's Search finds people by name, phone or visit code in the campaign
 * open or remembered (and registrations outside any campaign), and campaigns by name. Outreach hands the frame a
 * function while it is shown; the frame asks it as the person types and opens what is chosen. Nothing found is kept.
 */
export interface OutreachSearchHit {
  readonly id: string
  readonly kind: 'person' | 'campaign'
  readonly title: string
  /** A line under it: age and sex with the visit code, or the campaign's status and dates. */
  readonly detail: string
  readonly open: () => void
}

export interface OutreachSearchSource {
  readonly facilityId: string
  readonly search: (query: string) => readonly OutreachSearchHit[]
}

let searchSource: OutreachSearchSource | null = null
const searchListeners = new Set<() => void>()

/** Outreach says how to search it (null: it isn't shown). */
export function setOutreachSearch(next: OutreachSearchSource | null) {
  if (searchSource === next) return
  searchSource = next
  for (const listener of searchListeners) listener()
}

function subscribeSearch(listener: () => void) {
  searchListeners.add(listener)
  return () => { searchListeners.delete(listener) }
}

/** How to search Outreach at the facility open now, while it is shown. */
export function useOutreachSearch(facilityId: string | undefined): OutreachSearchSource | null {
  const source = useSyncExternalStore(subscribeSearch, () => searchSource, () => null)
  return source && source.facilityId === facilityId ? source : null
}
