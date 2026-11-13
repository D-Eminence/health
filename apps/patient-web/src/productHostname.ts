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

/** Each product site of each deployment, as hid-system's Cloudflare config names it. */
const PRODUCT_SITE_HOSTNAMES: Record<'production' | 'staging', Record<StaffProductKey, string>> = {
  production: { ehr: 'ehr.healthidentitydirectory.com', lab: 'lab.healthidentitydirectory.com',
    pharmacy: 'pharmacy.healthidentitydirectory.com', migrate: 'migrate.healthidentitydirectory.com',
    outreach: 'outreach.healthidentitydirectory.com' },
  staging: { ehr: 'ehr.staging.healthidentitydirectory.com', lab: 'lab.staging.healthidentitydirectory.com',
    pharmacy: 'pharmacy.staging.healthidentitydirectory.com', migrate: 'migrate.staging.healthidentitydirectory.com',
    outreach: 'outreach.staging.healthidentitydirectory.com' },
}

/** What each product is called, as its own site names it. */
export const PRODUCT_SITE_NAMES: Readonly<Record<StaffProductKey, string>> = {
  ehr: 'Health ID EHR',
  lab: 'Health ID Laboratory',
  pharmacy: 'Health ID Pharmacy',
  migrate: 'Health ID Migrate',
  outreach: 'Health ID Outreach',
}

/** The workspace a staff address opens, by its first two steps (/provider/laboratory/...), in any case; null for none. */
function workspaceProductOf(pathname: string): StaffProductKey | null {
  const path = pathname.toLowerCase()
  for (const [key, route] of Object.entries(STAFF_PRODUCT_ROUTES) as Array<[StaffProductKey, string]>) {
    if (path === route || path.startsWith(`${route}/`)) return key
  }
  return null
}

/** The site whose facility sign-up registers each kind of facility the address names (?type=, then ?product=). */
const SIGN_UP_TYPE_SITES: Readonly<Record<string, StaffProductKey>> = { laboratory: 'lab', pharmacy: 'pharmacy' }
const SIGN_UP_PRODUCT_SITES: Readonly<Record<string, StaffProductKey>> = {
  ehr: 'ehr', laboratory: 'lab', pharmacy: 'pharmacy', migrate: 'migrate',
}

/**
 * The product site a staff address belongs on, when it is opened on a site that serves no staff pages (the production
 * patient portal, an admin site). The address picks the site only where it names a product itself:
 * - a product's workspace, or a page in it (/provider/laboratory, /provider/pharmacy, /provider/ocr,
 *   /provider/outreach, /provider/clinical): that product's site;
 * - facility sign-up (/provider/enroll) for a laboratory or a pharmacy (?type=laboratory or pharmacy), or for one
 *   product (?product=laboratory, pharmacy, migrate or ehr, as the public site and the landing pages link it): that
 *   product's site;
 * - the staff sign-in returning to a product's workspace (?returnTo=/provider/laboratory): that product's site.
 * Anything else (the staff entrance, sign-in, password reset, invitations, the clinician pages): the EHR site. The
 * infra/cloudflare edge (frontend-worker.mjs, staffSiteOf) follows the same rule. Only a choice among five keys: nothing
 * of the address is copied.
 */
export function staffAddressProduct(pathname: string, search: string): StaffProductKey {
  const workspace = workspaceProductOf(pathname)
  if (workspace) return workspace
  const page = pathname.toLowerCase().replace(/\/+$/, '')
  const params = new URLSearchParams(search)
  if (page === PROVIDER_ENROLLMENT_PATH) {
    const type = params.get('type')
    if (type && Object.hasOwn(SIGN_UP_TYPE_SITES, type)) return SIGN_UP_TYPE_SITES[type]!
    const product = params.get('product')
    if (product && Object.hasOwn(SIGN_UP_PRODUCT_SITES, product)) return SIGN_UP_PRODUCT_SITES[product]!
  }
  if (page === STAFF_SIGN_IN_PATH) {
    const back = params.get('returnTo')
    const product = back && back.startsWith('/') && !back.startsWith('//') ? workspaceProductOf(back.split(/[?#]/)[0]!) : null
    if (product) return product
  }
  return 'ehr'
}

/**
 * Where the staff address `location` opens from here, when this site serves no staff pages (staffPagesOrigin: the
 * production patient portal, an admin site): the product site staffAddressProduct names, in this site's deployment,
 * with the address's path, query and fragment. Null anywhere else, where the page is this site's own. Only the path,
 * query and fragment come from the address: the origin is one of ten fixed ones.
 */
export function staffPageElsewhere(hostname: string, location: { pathname: string; search: string; hash: string }):
  { href: string; product: StaffProductKey } | null {
  const origin = staffPagesOrigin(hostname)
  if (!origin) return null
  const deployment = origin === EHR_SITE_ORIGINS.production ? 'production' : 'staging'
  const product = staffAddressProduct(location.pathname, location.search)
  const target = new URL(`https://${PRODUCT_SITE_HOSTNAMES[deployment][product]}`)
  target.pathname = location.pathname
  target.search = location.search
  target.hash = location.hash
  return { href: target.href, product }
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

/**
 * Where the administrator of a facility that has just signed up signs in ("Your account may already be ready"): the
 * staff sign-in of the facility's own site. On each product site that is this site's own sign-in, as it signs up its
 * own kind of facility only (facilitySignUpScope). On a site that serves no staff pages (the production patient portal,
 * an admin site), where no sign-up runs any more, the facility type's site (a laboratory's on lab., a pharmacy's on
 * pharmacy., anyone else's on ehr.) in that deployment. Anywhere else (staging's portal, local) this site's own. One of
 * a few fixed values: nothing copied from the hostname.
 */
export function facilitySignInHref(organizationType: string | null | undefined, hostname: string): string {
  const origin = staffPagesOrigin(hostname)
  if (!origin) return STAFF_SIGN_IN_PATH
  const deployment = origin === EHR_SITE_ORIGINS.production ? 'production' : 'staging'
  return `${staffSiteOrigin(staffSiteForOrganizationType(organizationType ?? ''), deployment)}${STAFF_SIGN_IN_PATH}`
}

/** The patient portal's sign-in in each deployment: app. serves patients, and only patients (owner, 2026-11-02). */
const PATIENT_SIGN_IN = {
  production: 'https://app.healthidentitydirectory.com/sign-in',
  staging: 'https://staging.healthidentitydirectory.com/sign-in',
} as const

/**
 * Where a patient who opened a staff page signs in ("Are you a patient?"): the patient portal's sign-in in this site's
 * deployment, or this build's own /sign-in anywhere else (local, preview). One of three fixed values.
 */
export function patientSignInHref(hostname: string): string {
  const deployment = deploymentOf(hostname)
  return deployment ? PATIENT_SIGN_IN[deployment] : '/sign-in'
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

/**
 * Open sign-up to run outreach (owner decisions of 11 November 2026): on outreach. the main way in, "Start running
 * outreach", is the organiser sign-up, at the address facility sign-up has on the other sites; this address serves the
 * same page on any site that is not a product site (staging's portal, a local or preview build).
 */
export const OUTREACH_SIGNUP_PATH = '/provider/start-outreach'
/** The organiser terms an outreach organiser accepts, public and readable before signing up. */
export const OUTREACH_TERMS_PATH = '/provider/outreach-terms'
/** Where an outreach invitation's link opens (notification-api: `https://outreach.<deployment>/provider/outreach-invitation#…`). */
export const OUTREACH_INVITATION_PATH = '/provider/outreach-invitation'

/** Whether this site's facility sign-up address serves the outreach organiser sign-up: outreach.'s, in each deployment. */
export function outreachSignUpHere(hostname: string): boolean {
  return resolveStaffProductHostname(hostname)?.key === 'outreach'
}

/**
 * Whether this site keeps Outreach's offline app shell (public/sw-outreach.js, outreachShell.ts): Health ID Outreach's
 * own site, in each deployment, and nowhere else. public/sw.js names the same hosts (OFFLINE_SHELL_HOSTS).
 */
export function offlineShellHere(hostname: string): boolean {
  return resolveStaffProductHostname(hostname)?.key === 'outreach'
}

/**
 * Where the outreach organiser sign-up is, from this site: outreach.'s own on outreach. and from another product site
 * (Turnstile accepts the sign-up there only); this build's own page anywhere else. One of a few fixed values.
 */
export function outreachSignUpHref(hostname: string): string {
  if (outreachSignUpHere(hostname)) return PROVIDER_ENROLLMENT_PATH
  const deployment = deploymentOf(hostname)
  return deployment && resolveStaffProductHostname(hostname)
    ? `https://${PRODUCT_SITE_HOSTNAMES[deployment].outreach}${PROVIDER_ENROLLMENT_PATH}` : OUTREACH_SIGNUP_PATH
}

/** "Registering a hospital? Use Health ID EHR": the EHR site's facility sign-up in this deployment, else this build's own. */
export function hospitalSignUpHref(hostname: string): string {
  const deployment = deploymentOf(hostname)
  return deployment ? `https://${PRODUCT_SITE_HOSTNAMES[deployment].ehr}${PROVIDER_ENROLLMENT_PATH}` : PROVIDER_ENROLLMENT_PATH
}

/** The kinds of facility and the products facility sign-up knows (staff/routes/ProviderEnrollment.tsx). */
export type FacilityTypeCode = 'hospital' | 'clinic' | 'laboratory' | 'pharmacy' | 'other'
export type FacilityProductCode = 'ehr' | 'laboratory' | 'pharmacy' | 'migrate'

/** What facility sign-up on a product site offers: that site's own kinds of facility and its own product. */
export interface FacilitySignUpScope {
  readonly organizationTypes: readonly FacilityTypeCode[]
  readonly products: readonly FacilityProductCode[]
}

/** A hospital, a clinic or another healthcare provider: the facilities Health ID EHR is for. */
const HOSPITAL_TYPES: readonly FacilityTypeCode[] = ['hospital', 'clinic', 'other']

/**
 * Each product site signs up its own kind of facility only (owner, 2026-11-02: sign-up, sign-in and password reset on
 * each product site, individually). lab. a laboratory for Health ID Laboratory; pharmacy. a pharmacy for Health ID
 * Pharmacy; ehr. a hospital, clinic or other provider for Health ID EHR; migrate. the same facilities for Health ID
 * Migrate (a hospital moving its records: the public site's Migrate page). On outreach. the sign-up address serves the
 * outreach organiser sign-up instead (outreachSignUpHere, owner decisions of 11 November 2026), which links to Health ID
 * EHR's for a hospital; its entry here is kept for the facility sign-up page's own checks. A laboratory or a pharmacy
 * signs up on its own site.
 */
const FACILITY_SIGN_UP_SCOPES: Readonly<Record<StaffProductKey, FacilitySignUpScope>> = {
  ehr: { organizationTypes: HOSPITAL_TYPES, products: ['ehr'] },
  lab: { organizationTypes: ['laboratory'], products: ['laboratory'] },
  pharmacy: { organizationTypes: ['pharmacy'], products: ['pharmacy'] },
  migrate: { organizationTypes: HOSPITAL_TYPES, products: ['migrate'] },
  outreach: { organizationTypes: HOSPITAL_TYPES, products: ['ehr'] },
}

/**
 * What facility sign-up offers on this site (FACILITY_SIGN_UP_SCOPES), on each product site in production and on
 * staging; null anywhere else (staging's portal, a local or preview build), where it offers every kind of facility
 * and product, as before. Only the form's own choices: nothing new is sent to Identity.
 */
export function facilitySignUpScope(hostname: string): FacilitySignUpScope | null {
  const product = resolveStaffProductHostname(hostname)?.key
  return product ? FACILITY_SIGN_UP_SCOPES[product] : null
}

/** Whether facility sign-up on this site offers this kind of facility. */
export function offersFacilityType(hostname: string, type: FacilityTypeCode): boolean {
  return facilitySignUpScope(hostname)?.organizationTypes.includes(type) ?? true
}

/** Whether facility sign-up on this site offers this product. */
export function offersFacilityProduct(hostname: string, product: FacilityProductCode): boolean {
  return facilitySignUpScope(hostname)?.products.includes(product) ?? true
}

/** The site whose facility sign-up registers each kind of facility, and what it is called there. */
const FACILITY_TYPE_SITES: Readonly<Record<FacilityTypeCode, StaffProductKey>> = {
  hospital: 'ehr', clinic: 'ehr', other: 'ehr', laboratory: 'lab', pharmacy: 'pharmacy',
}

/**
 * The other product sites' facility sign-ups, for someone on this product site who registers another kind of facility:
 * a hospital or clinic on Health ID EHR's, a laboratory on Health ID Laboratory's, a pharmacy on Health ID Pharmacy's,
 * those this site does not sign up. Each a fixed address in this site's deployment; none anywhere else (no scope).
 */
export function otherFacilitySignUps(hostname: string): ReadonlyArray<{ kind: 'hospital' | 'laboratory' | 'pharmacy'; name: string; href: string }> {
  const scope = facilitySignUpScope(hostname)
  const deployment = deploymentOf(hostname)
  if (!scope || !deployment) return []
  const kinds = (['hospital', 'laboratory', 'pharmacy'] as const).filter(kind => !scope.organizationTypes.includes(kind))
  return kinds.map(kind => {
    const site = FACILITY_TYPE_SITES[kind]
    return { kind, name: PRODUCT_SITE_NAMES[site], href: `https://${PRODUCT_SITE_HOSTNAMES[deployment][site]}${PROVIDER_ENROLLMENT_PATH}` }
  })
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
