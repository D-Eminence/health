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

/** The portal's staff password-recovery page. */
export const STAFF_RECOVERY_PATH = '/provider/recover'

/** The portal's staff sign-in page. */
export const STAFF_SIGN_IN_PATH = '/provider/sign-in'

/** Where production staff sign in: the EHR site, which hid-system accepts `staff-login` on. */
export const PRODUCTION_STAFF_SIGN_IN = 'https://ehr.healthidentitydirectory.com/provider/sign-in'

/**
 * Where staff sign in from here, when it is not this site. hid-system refuses
 * `staff-login` on the production portal (app.healthidentitydirectory.com),
 * which serves patients, so staff there are sent to the EHR site's sign-in
 * (owner decision, 2026-10-22). One fixed value, nothing copied from the
 * hostname, no return address; null anywhere else, staging included, where
 * the portal's own staff sign-in is accepted.
 */
export function staffSignInHref(hostname: string): string | null {
  return normalizeHostname(hostname) === 'app.healthidentitydirectory.com' ? PRODUCTION_STAFF_SIGN_IN : null
}

/**
 * The main site of each deployment, where this portal serves the staff pages:
 * app in production (www only redirects to the public site), staging on
 * staging. hid-system accepts the staff password-reset check, `staff-reset`,
 * there (turnstile.service.ts, hid-system#41). Staff product hosts accept only
 * their own sign-in action, and the admin site only admin-login and
 * admin-reset, so a staff recovery started there is refused.
 */
export const MAIN_SITE_ORIGINS = {
  production: 'https://app.healthidentitydirectory.com',
  staging: 'https://staging.healthidentitydirectory.com',
} as const

/**
 * Where staff reset a forgotten password. On a staff product host (ehr, lab,
 * pharmacy, migrate, outreach) or the admin site, in production or staging,
 * that is the main site's recovery page; anywhere else it is this site's own.
 * The address is one of three fixed values: nothing from the hostname is copied
 * into it, and it carries no return address.
 */
export function staffRecoveryHref(hostname: string): string {
  const productHost = /^(?:ehr|lab|pharmacy|migrate|outreach|admin)\.(staging\.)?healthidentitydirectory\.com$/.exec(normalizeHostname(hostname))
  if (!productHost) return STAFF_RECOVERY_PATH
  return `${productHost[1] ? MAIN_SITE_ORIGINS.staging : MAIN_SITE_ORIGINS.production}${STAFF_RECOVERY_PATH}`
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
 * The main site's address of a clinician page, on a staff product host (ehr,
 * lab, pharmacy, migrate, outreach) or the admin site, in production or
 * staging; null anywhere else, where the page works itself. hid-system accepts
 * the clinician pages' security checks (`clinician-application`,
 * `clinician-application-status`) only on the main site, so a form shown on a
 * product host would always be refused. As staffRecoveryHref: one of four
 * fixed values, nothing copied from the hostname, no return address.
 */
export function clinicianMainSiteHref(hostname: string, path: ClinicianPagePath): string | null {
  const productHost = /^(?:ehr|lab|pharmacy|migrate|outreach|admin)\.(staging\.)?healthidentitydirectory\.com$/.exec(normalizeHostname(hostname))
  if (!productHost) return null
  return `${productHost[1] ? MAIN_SITE_ORIGINS.staging : MAIN_SITE_ORIGINS.production}${path}`
}

/** Where a clinician page is opened from here: this site's own page, or the main site's on a product or admin host. */
export function clinicianPageHref(hostname: string, path: ClinicianPagePath): string {
  return clinicianMainSiteHref(hostname, path) ?? path
}
