import type { StaffSession } from './api'
import { resolveStaffProductHostname } from '../productHostname'

/** "Start an outreach group" (owner decision 5 of 11 November 2026): the one page an account-only session opens. */
export { START_OUTREACH_GROUP_PATH } from '../productHostname'

/**
 * Whether a staff session holds the account only, with no facility (owner's answer to Q88, 17 Nov 2026): a verified
 * staff login that is not yet part of any facility or outreach group. identity-api gives one only on outreach., where
 * it may reach "Start an outreach group" and nothing else; every other site refuses the sign-in with 403
 * NO_ACTIVE_FACILITY_MEMBERSHIP. A platform administrator signed in with no facility keeps today's screen.
 */
export function accountOnlySession(session: StaffSession): boolean {
  return session.actor.facilities.length === 0 && !session.actor.facility
    && !session.actor.permissions.includes('platform.admin.access')
}

/** Whether this site opens "Start an outreach group" for an account-only session: outreach., in each deployment. */
export function opensAccountOnly(session: StaffSession, hostname: string = window.location.hostname): boolean {
  return accountOnlySession(session) && resolveStaffProductHostname(hostname)?.key === 'outreach'
}
