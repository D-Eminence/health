import { getEnvironment } from '../env'
import type { StaffProductKey } from '../productHostname'
import { siteOf, type Site } from '../productSites'
import { isSafeReturnPath } from './handOff'
import { leavePage } from './leave'
import { STAFF_HAND_OFF } from './staffHandOffSwitch'

/**
 * Whether single sign-on hands off on this page (contract v2): the build's VITE_HID_SSO setting is on, and this host is
 * a Health ID product site (productSites.ts siteOf: app. as `web`, and the five staff sites), each a client of the
 * provider on `auth.`. The site, or null: setting unset or off, a configuration this page cannot read, or any other host
 * (local, preview, admin.), where every sign-in page stays today's.
 */
export function singleSignOnSite(hostname: string = window.location.hostname): Site | null {
  let enabled = false
  try { enabled = getEnvironment().ssoEnabled === true } catch { enabled = false }
  return enabled ? siteOf(hostname) : null
}

/** Whether the patient portal hands off here: single sign-on on, on app. (or staging.). */
export function portalHandsOff(): boolean {
  return singleSignOnSite()?.key === 'web'
}

/** A staff product site, where the provider workspace signs in. */
export type StaffSite = Site & { readonly key: StaffProductKey }

/**
 * The staff product site when the provider workspace hands off here, else null: single sign-on on, and the staff
 * hand-off switched on (staffHandOffSwitch.ts), which waits for the staff sign-out to end the provider's session.
 */
export function staffHandOffSite(hostname: string = window.location.hostname): StaffSite | null {
  if (!STAFF_HAND_OFF) return null
  const site = singleSignOnSite(hostname)
  return site && site.key !== 'web' ? { ...site, key: site.key } : null
}

/**
 * `path` (pathname and query) when the provider workspace hands off here (staffHandOffSite) and a sign-in on this site
 * may come back to it (handOff.ts isSafeReturnPath), else null: always null while either is off. For the staff Gate and
 * its session-ended page, which carry only staff/session.ts's pages today, to carry a clinical record page too (their
 * owner's change).
 */
export function singleSignOnReturnPath(path: string, hostname: string = window.location.hostname): string | null {
  return staffHandOffSite(hostname) && isSafeReturnPath(path, hostname) ? path : null
}

/**
 * A sign-out made in this page, held in its memory only and gone with it. `leaving`: the tab is on its way to the
 * provider's end-session address. `signedOut`: the person signed out here, so the next hand-off from this page asks
 * them to sign in again (`prompt=login`) rather than taking up the provider's session without a word.
 */
let signedOut = false
let leaving = false

/**
 * After a product sign-out with single sign-on on: leaves for the provider's end-session address, which ends the
 * provider's session and signs every product out (contract v2, item 4); with no address, stays, and the next sign-in
 * from this page is asked for. Does nothing while single sign-on does not hand off here.
 */
export function leaveAfterSignOut(endSession: string | null): void {
  if (!singleSignOnSite()) return
  signedOut = true
  if (endSession === null) return
  leaving = true
  leavePage(endSession)
}

/** Whether this page is leaving for the provider's end-session address. */
export function leavingAfterSignOut(): boolean {
  return leaving
}

/** Whether the person signed out in this page. */
export function signedOutInThisPage(): boolean {
  return signedOut
}
