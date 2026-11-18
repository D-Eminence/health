import { resolveStaffProductHostname } from './productHostname'
import { SITE_PRODUCT_NAMES } from './productSites'

/*
 * What a staff sign-in says when the password was right but the account cannot work on this site (owner's answer to
 * Q88, 17 Nov 2026). identity-api answers either only after the password is proven, and records neither as a failed
 * sign-in; a wrong password keeps its own words ("That email address or password isn’t right. Try again.").
 */

/** 403 NO_ACTIVE_FACILITY_MEMBERSHIP: no facility or outreach group yet. On outreach. such an account starts a group instead. */
export const NO_FACILITY_YET = 'You aren’t part of a facility or outreach group yet.'

/**
 * 403 PRODUCT_NOT_AUTHORISED: none of the account's facilities does this site's work. Named as the site calls itself
 * (productSites.ts): Health ID EHR on ehr. and wherever no product site is named, Health ID Lab, Health ID Pharmacy,
 * Health ID Migrate, Health ID Outreach.
 */
export function productNotAuthorised(hostname: string = window.location.hostname): string {
  return `This account isn’t set up for ${SITE_PRODUCT_NAMES[resolveStaffProductHostname(hostname)?.key ?? 'ehr']}.`
}
