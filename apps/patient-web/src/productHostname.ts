export const STAFF_PRODUCT_ROUTES = {
  ehr: '/provider/clinical',
  lab: '/provider/laboratory',
  pharmacy: '/provider/pharmacy',
  migrate: '/provider/ocr',
  outreach: '/provider/outreach',
} as const

export const PLATFORM_ADMIN_HOSTNAME = 'admin.healthidentitydirectory.com'
/** The admin site of each deployment, as hid-system's Cloudflare config names it (infra/cloudflare). */
const PLATFORM_ADMIN_HOSTNAMES: readonly string[] = [PLATFORM_ADMIN_HOSTNAME, 'admin.staging.healthidentitydirectory.com']
export const PLATFORM_ADMIN_ROUTE = '/admin/overview'

export type StaffProductKey = keyof typeof STAFF_PRODUCT_ROUTES

export interface StaffProduct {
  key: StaffProductKey
  hostname: string
  route: (typeof STAFF_PRODUCT_ROUTES)[StaffProductKey]
}

/**
 * Each staff product host of each deployment, exactly as hid-system's Cloudflare
 * config names them (infra/cloudflare/src/frontend-worker.mjs, production and
 * staging). Only a host listed here opens a product workspace.
 */
const STAFF_PRODUCT_HOSTNAMES: Record<string, StaffProduct> = {
  'ehr.healthidentitydirectory.com': { key: 'ehr', hostname: 'ehr.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.ehr },
  'lab.healthidentitydirectory.com': { key: 'lab', hostname: 'lab.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.lab },
  'pharmacy.healthidentitydirectory.com': { key: 'pharmacy', hostname: 'pharmacy.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.pharmacy },
  'migrate.healthidentitydirectory.com': { key: 'migrate', hostname: 'migrate.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.migrate },
  'outreach.healthidentitydirectory.com': { key: 'outreach', hostname: 'outreach.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.outreach },
  'ehr.staging.healthidentitydirectory.com': { key: 'ehr', hostname: 'ehr.staging.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.ehr },
  'lab.staging.healthidentitydirectory.com': { key: 'lab', hostname: 'lab.staging.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.lab },
  'pharmacy.staging.healthidentitydirectory.com': { key: 'pharmacy', hostname: 'pharmacy.staging.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.pharmacy },
  'migrate.staging.healthidentitydirectory.com': { key: 'migrate', hostname: 'migrate.staging.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.migrate },
  'outreach.staging.healthidentitydirectory.com': { key: 'outreach', hostname: 'outreach.staging.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.outreach },
}

/** Every staff product and admin host of each deployment, as the dev and preview servers allow them. */
export const PORTAL_HOSTNAMES: readonly string[] = [...Object.keys(STAFF_PRODUCT_HOSTNAMES), ...PLATFORM_ADMIN_HOSTNAMES]

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '')
}

export function resolveStaffProductHostname(hostname: string): StaffProduct | null {
  const normalized = normalizeHostname(hostname)
  return Object.hasOwn(STAFF_PRODUCT_HOSTNAMES, normalized) ? STAFF_PRODUCT_HOSTNAMES[normalized]! : null
}

/**
 * The Turnstile action of a staff sign-in. hid-system accepts only these on each
 * staff product host, in production and staging (turnstile.service.ts); any
 * other action there is refused as TURNSTILE_CONTEXT_MISMATCH. Elsewhere (www,
 * staging, local) the general `staff-login` applies.
 */
export type StaffLoginAction = 'staff-login' | 'lab-login' | 'pharmacy-login' | 'ocr-login' | 'outreach-login'

const STAFF_LOGIN_ACTIONS: Record<StaffProductKey, StaffLoginAction> = {
  ehr: 'staff-login',
  lab: 'lab-login',
  pharmacy: 'pharmacy-login',
  migrate: 'ocr-login',
  outreach: 'outreach-login',
}

export function staffLoginAction(hostname: string): StaffLoginAction {
  const product = /^(ehr|lab|pharmacy|migrate|outreach)\.(?:staging\.)?healthidentitydirectory\.com$/.exec(normalizeHostname(hostname))?.[1]
  return product ? STAFF_LOGIN_ACTIONS[product as StaffProductKey] : 'staff-login'
}

/** The staff password-recovery page. */
export const STAFF_RECOVERY_PATH = '/provider/recover'

/** The staff sign-in page. */
export const STAFF_SIGN_IN_PATH = '/provider/sign-in'

/** The production patient portal, which serves patients only (owner, 2026-11-01). */
const PRODUCTION_PORTAL_HOSTNAME = 'app.healthidentitydirectory.com'

/** The production EHR site. */
export const PRODUCTION_EHR_ORIGIN = 'https://ehr.healthidentitydirectory.com'

/** Where production staff sign in from the patient portal: the EHR site, which hid-system accepts `staff-login` on. */
export const PRODUCTION_STAFF_SIGN_IN = 'https://ehr.healthidentitydirectory.com/provider/sign-in'

/** The EHR site of each deployment, as hid-system's Cloudflare config names it. */
const EHR_SITE_ORIGINS = {
  production: PRODUCTION_EHR_ORIGIN,
  staging: 'https://ehr.staging.healthidentitydirectory.com',
} as const

/**
 * Where this site's staff pages (/provider and every page under it: sign-in, recovery, facility sign-up, invitations,
 * the clinician pages and the workspace) open when this site serves none of them: the EHR site of the deployment, from
 * the production patient portal (app., patients only, owner 2026-11-01) and from each admin site (platform
 * administrators only). Null anywhere else: each product site (ehr, lab, pharmacy, migrate, outreach, production and
 * staging) serves its own sign-up, sign-in, recovery and invitations, whose security checks hid-system accepts there
 * (staff-reset, provider-enrollment and staff-invitation besides its own sign-in), and so do staging's portal and a
 * local or preview build. One of two fixed values: nothing copied from the hostname.
 */
export function staffPagesOrigin(hostname: string): string | null {
  const normalized = normalizeHostname(hostname)
  if (normalized === PRODUCTION_PORTAL_HOSTNAME || normalized === PLATFORM_ADMIN_HOSTNAME) return EHR_SITE_ORIGINS.production
  if (normalized === 'admin.staging.healthidentitydirectory.com') return EHR_SITE_ORIGINS.staging
  return null
}

/** Where the staff page at `path` opens from here: this site's own page, or the EHR site's (staffPagesOrigin). */
function staffPageHref(hostname: string, path: string): string {
  return `${staffPagesOrigin(hostname) ?? ''}${path}`
}

/**
 * Where staff sign in from here, when it is not this site: the EHR site's sign-in from the production patient portal
 * (owner decisions, 2026-10-22 and 2026-11-01) or an admin site (staffPagesOrigin). One of two fixed values, nothing
 * copied from the hostname, no return address; null anywhere else, staging's portal included, where this site's own
 * staff sign-in is accepted.
 */
export function staffSignInHref(hostname: string): string | null {
  const origin = staffPagesOrigin(hostname)
  return origin ? `${origin}${STAFF_SIGN_IN_PATH}` : null
}

/**
 * Where staff reset a forgotten password from here: this site's own recovery page on each product site (hid-system
 * accepts `staff-reset` there), staging's portal and local; the EHR site's from the production patient portal or an
 * admin site. One of three fixed values: nothing from the hostname is copied into it, and it carries no return address.
 */
export function staffRecoveryHref(hostname: string): string {
  return staffPageHref(hostname, STAFF_RECOVERY_PATH)
}

/** The facility self sign-up page ("Register your facility"). */
export const PROVIDER_ENROLLMENT_PATH = '/provider/enroll'

/**
 * Where a facility signs itself up from here: this site's own page on each product site (hid-system accepts
 * `provider-enrollment` there), staging's portal and local; the EHR site's from the production patient portal or an
 * admin site. As staffRecoveryHref: one of three fixed values, nothing copied from the hostname, no return address.
 */
export function providerEnrollmentHref(hostname: string): string {
  return staffPageHref(hostname, PROVIDER_ENROLLMENT_PATH)
}

/** What facility sign-up starts with on a product site whose product it is (facilitySignUpPreset). */
export interface FacilitySignUpPreset {
  organizationType: 'hospital' | 'laboratory' | 'pharmacy'
  productCode: 'laboratory' | 'pharmacy' | 'migrate'
}

const FACILITY_SIGN_UP_PRESETS: Partial<Record<StaffProductKey, FacilitySignUpPreset>> = {
  lab: { organizationType: 'laboratory', productCode: 'laboratory' },
  pharmacy: { organizationType: 'pharmacy', productCode: 'pharmacy' },
  migrate: { organizationType: 'hospital', productCode: 'migrate' },
}

/**
 * The choice facility sign-up starts with on this site when its address names no facility type or product: a
 * laboratory signing up for Health ID Laboratory on lab., a pharmacy for Health ID Pharmacy on pharmacy., a hospital
 * for Health ID Migrate on migrate. (production and staging). Null anywhere else, where the form starts as before (a
 * hospital, Health ID EHR); outreach has no product of its own to sign up for. Only the form's own choices: nothing new
 * is sent to Identity.
 */
export function facilitySignUpPreset(hostname: string): FacilitySignUpPreset | null {
  const product = resolveStaffProductHostname(hostname)?.key
  return (product && FACILITY_SIGN_UP_PRESETS[product]) || null
}

export function isStaffProductRoute(pathname: string): boolean {
  return Object.values(STAFF_PRODUCT_ROUTES).includes(pathname as (typeof STAFF_PRODUCT_ROUTES)[StaffProductKey])
}

export function isPlatformAdminHostname(hostname: string): boolean {
  return PLATFORM_ADMIN_HOSTNAMES.includes(normalizeHostname(hostname))
}

export function isPlatformAdminRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname === PLATFORM_ADMIN_ROUTE || pathname.startsWith('/admin/')
}

/** Clinician self sign-up and its status page (hid-system ADR-066): public pages outside the provider workspace. */
export const CLINICIAN_SIGNUP_PATH = '/provider/join'
export const CLINICIAN_STATUS_PATH = '/provider/join/status'
export type ClinicianPagePath = typeof CLINICIAN_SIGNUP_PATH | typeof CLINICIAN_STATUS_PATH

/**
 * The address of a clinician page on the EHR site, from the production patient portal or an admin site
 * (staffPagesOrigin); null anywhere else, where the page opens on this site, as every other staff page does. The Novu
 * backend serves no clinician sign-up yet (servesClinicianApplications), so no site accepts the pages' security checks
 * (`clinician-application`, `clinician-application-status`) today; when it does, it must accept them on each product
 * site. As staffRecoveryHref: one of four fixed values, nothing copied from the hostname, no return address.
 */
export function clinicianOtherSiteHref(hostname: string, path: ClinicianPagePath): string | null {
  const origin = staffPagesOrigin(hostname)
  return origin ? `${origin}${path}` : null
}

/** Where a clinician page is opened from here: this site's own page, or the EHR site's (clinicianOtherSiteHref). */
export function clinicianPageHref(hostname: string, path: ClinicianPagePath): string {
  return clinicianOtherSiteHref(hostname, path) ?? path
}

/**
 * A facility's staff invitation (P4b, Novu only): the public page the invitation email links to, on the staff site of
 * the invitee's role (hid-system notification-api staffSiteOrigin), where hid-system accepts its security check
 * (`staff-invitation`). The link carries the invitation in its fragment (`#<invitationId>.<token>`), which never
 * reaches a server.
 */
export const STAFF_INVITATION_PATH = '/provider/invitation'

/** Where existing staff accept an invitation, signed in on their own staff site (P4b). */
export const STAFF_JOIN_PATH = '/provider/staff/join'

/**
 * Where an invitation is opened from here: this site's own page on each product site, staging's portal and local; the
 * EHR site's from the production patient portal or an admin site. As providerEnrollmentHref: one of three fixed
 * values, nothing copied from the hostname, no return address.
 */
export function staffInvitationHref(hostname: string): string {
  return staffPageHref(hostname, STAFF_INVITATION_PATH)
}

/** The deployment a Health ID hostname belongs to; null for any other host (local, preview). */
function deploymentOf(hostname: string): 'production' | 'staging' | null {
  const normalized = normalizeHostname(hostname)
  if (normalized === 'staging.healthidentitydirectory.com' || normalized.endsWith('.staging.healthidentitydirectory.com')) return 'staging'
  if (normalized === 'healthidentitydirectory.com' || normalized.endsWith('.healthidentitydirectory.com')) return 'production'
  return null
}

/** The staff site whose sign-in each kind of work opens on (hid-system's Turnstile actions per host). */
export type StaffSiteKey = 'ehr' | 'lab' | 'pharmacy'

const STAFF_SITE_HOSTNAMES: Record<'production' | 'staging', Record<StaffSiteKey, string>> = {
  production: { ehr: 'ehr.healthidentitydirectory.com', lab: 'lab.healthidentitydirectory.com',
    pharmacy: 'pharmacy.healthidentitydirectory.com' },
  staging: { ehr: 'ehr.staging.healthidentitydirectory.com', lab: 'lab.staging.healthidentitydirectory.com',
    pharmacy: 'pharmacy.staging.healthidentitydirectory.com' },
}

/** The staff site a facility role works on: Laboratory scientists on lab, pharmacists on pharmacy, everyone else on ehr. */
export function staffSiteForRole(role: string): StaffSiteKey {
  return role === 'lab' ? 'lab' : role === 'pharmacist' ? 'pharmacy' : 'ehr'
}

/** The staff site a self-signed-up facility's administrator works on, by the facility's type (P4b). */
export function staffSiteForOrganizationType(organizationType: string): StaffSiteKey {
  return organizationType === 'laboratory' ? 'lab' : organizationType === 'pharmacy' ? 'pharmacy' : 'ehr'
}

/**
 * The hostname of the staff site `site` in this deployment (production or staging), or null anywhere else, where this
 * portal's own staff sign-in is used. One of six fixed values: nothing copied from the hostname.
 */
export function staffSiteHostname(site: StaffSiteKey, hostname: string): string | null {
  const deployment = deploymentOf(hostname)
  return deployment ? STAFF_SITE_HOSTNAMES[deployment][site] : null
}

/** The host a facility role signs in on (P4b): ehr, lab or pharmacy, production or staging; null elsewhere. */
export function staffHostForRole(role: string, hostname: string): string | null {
  return staffSiteHostname(staffSiteForRole(role), hostname)
}

/** The staff site `site` of a deployment: one of six fixed origins. */
export function staffSiteOrigin(site: StaffSiteKey, deployment: 'production' | 'staging'): string {
  return `https://${STAFF_SITE_HOSTNAMES[deployment][site]}`
}
