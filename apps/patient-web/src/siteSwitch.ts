import type { StaffProductKey } from './productHostname'
import { siteElsewhere, siteHref, siteOf, siteServing, SITE_NAMES, STAFF_SITES, type Site } from './productSites'

/**
 * Moving between the staff sites with a way back (single sign-on contract v2, health "switch-back"). Signed in on one
 * staff site, a person opens another from its list of sites. The link says which site they left (`from`) and the page
 * they were on (`back`), and nothing else. The site they arrive on reads both once, as the page loads, takes them out
 * of the address, keeps them in this page's memory only, and offers "Back to <site>" to that page on that site's fixed
 * hostname.
 *
 * Dark: only a build that sets VITE_HID_SSO to exactly "1" does any of this. Unset, every link is today's siteHref,
 * and no address is read or changed.
 */

/** Whether single sign-on's switching is on in this build. */
export function switchingOn(): boolean {
  return import.meta.env.VITE_HID_SSO === '1'
}

/**
 * Where a switch opens the other site: its workspace. The site's root is the product's landing page, which the edge
 * serves from the public site, so a link there would never reach the workspace that reads `from` and `back`.
 */
export const SWITCH_ENTRY = '/provider'

/**
 * A page address a switch may come back to: /provider, or a page under it named by at most two lower-case words
 * joined by single hyphens (/provider/patients, /provider/laboratory/work, /provider/in-person-check). Nothing else:
 * no host, scheme, query, fragment, dot segment, backslash, percent escape, upper case or trailing slash, and no
 * digit, so no record id (a UUID always holds one).
 */
const BACK_PATH = /^\/provider(?:\/[a-z]+(?:-[a-z]+)*){0,2}$/
const BACK_PATH_MAX = 64
/**
 * A Health ID may be letters only (HID-ABCDEFGH: @hid/contracts HEALTH_ID_PATTERN), which the words above would take
 * once lower-cased. No part of the address may start as one does, whatever follows.
 */
const HEALTH_ID_PART = /\/hid-/

export function isSwitchBackPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= BACK_PATH_MAX && BACK_PATH.test(path) && !HEALTH_ID_PART.test(path)
}

function isStaffSite(key: string): key is StaffProductKey {
  return (STAFF_SITES as readonly string[]).includes(key)
}

/**
 * The link from this staff site to another: that site's workspace on its fixed hostname, with from=<this site> and,
 * when `backPath` passes isSwitchBackPath and this site serves it, back=<backPath>. Nothing else of this page goes.
 * Today's siteHref(site) while switching is off, and from or to any host that is not a staff site.
 */
export function switchHref(site: Site, hostname: string, backPath: string | null): string {
  const here = siteOf(hostname)
  if (!switchingOn() || !here || !isStaffSite(here.key) || !isStaffSite(site.key)) return siteHref(site)
  // The other site's own hostname, from the fixed table: never one a caller passes in.
  const there = siteElsewhere(site.key, hostname)
  if (!there) return siteHref(site)
  const query = new URLSearchParams({ from: here.key })
  if (isSwitchBackPath(backPath) && siteServing(backPath, hostname) === null) query.set('back', backPath)
  return `https://${there.hostname}${SWITCH_ENTRY}?${query.toString()}`
}

/** The way back after a switch: the site left, and its page, on that site's fixed hostname. */
export interface SwitchArrival {
  readonly from: StaffProductKey
  /** What "Back to …" names: SITE_NAMES of the site left. */
  readonly name: string
  /** The page left (a path that passed isSwitchBackPath), else that site's workspace. */
  readonly path: string
  /** The address "Back to …" opens: `https://<that site's hostname><path>`, never an address read from the request. */
  readonly href: string
}

const SWITCH_KEYS: ReadonlySet<string> = new Set(['from', 'back'])

let arrival: SwitchArrival | null = null
let taken = false

/** The arrival `from` and `back` describe, or null when they do not name a page of another staff site. */
function arrivalFrom(from: readonly string[], back: readonly string[], hostname: string): SwitchArrival | null {
  // One of each at most, and a site: a repeated key is a link no site of ours writes.
  if (from.length !== 1 || back.length > 1) return null
  const key = from[0]!
  if (!isStaffSite(key)) return null
  // Another staff site of this deployment: null on that site itself, and on any host that is not a Health ID site.
  const site = siteElsewhere(key, hostname)
  if (!site) return null
  const asked = back[0]
  const path = isSwitchBackPath(asked) && siteServing(asked, site.hostname) === null ? asked : SWITCH_ENTRY
  return { from: key, name: SITE_NAMES[key], path, href: `https://${site.hostname}${path}` }
}

/**
 * Reads `from` and `back` once, as the page loads (main.tsx, before the router reads the address): takes both out of
 * the address with history.replaceState, keeping the rest of it and the history entry's state, and keeps the way back
 * in memory. Later calls answer from memory and never read the address again. Off, or on a host that is not a staff
 * site, the address is left as it is.
 */
export function takeSwitchArrival(): SwitchArrival | null {
  if (taken) return arrival
  taken = true
  if (!switchingOn()) return null
  const { hostname, pathname, search, hash } = window.location
  const here = siteOf(hostname)
  if (!here || !isStaffSite(here.key)) return null
  const query = new URLSearchParams(search)
  if (!query.has('from') && !query.has('back')) return null
  // The rest of the query exactly as it was written: only the pairs whose key is `from` or `back` go.
  const kept = search.replace(/^\?/, '').split('&').filter(pair => pair !== '' && !SWITCH_KEYS.has([...new URLSearchParams(pair).keys()][0] ?? ''))
  window.history.replaceState(window.history.state, '', `${pathname}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hash}`)
  arrival = arrivalFrom(query.getAll('from'), query.getAll('back'), hostname)
  return arrival
}

/** The way back this page arrived with, if any: kept in memory only, for the page's life. */
export function switchArrival(): SwitchArrival | null {
  return arrival
}

/**
 * The arrival as the query a return path carries through the sign-in hand-off (from=<site>&back=<path>), so that it
 * survives the round trip through the sign-in site; '' when there is none. The site reads it again, once, on the load
 * that follows.
 */
export function switchArrivalQuery(): string {
  if (!arrival) return ''
  const query = new URLSearchParams({ from: arrival.from })
  if (arrival.path !== SWITCH_ENTRY) query.set('back', arrival.path)
  return query.toString()
}
