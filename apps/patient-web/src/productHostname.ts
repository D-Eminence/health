export const STAFF_PRODUCT_ROUTES = {
  ehr: '/provider/clinical',
  lab: '/provider/laboratory',
  pharmacy: '/provider/pharmacy',
  migrate: '/provider/ocr',
  outreach: '/provider/outreach',
} as const

export const PLATFORM_ADMIN_HOSTNAME = 'admin.healthidentitydirectory.com'
export const STAGING_ADMIN_HOSTNAME = 'admin.staging.healthidentitydirectory.com'
export const PLATFORM_ADMIN_ROUTE = '/admin/overview'

const STAFF_LOGIN_ACTIONS = {
  ehr: 'ehr-login', lab: 'lab-login', pharmacy: 'pharmacy-login',
  migrate: 'ocr-login', outreach: 'outreach-login',
} as const

export type StaffProductKey = keyof typeof STAFF_PRODUCT_ROUTES

export interface StaffProduct {
  key: StaffProductKey
  hostname: string
  route: (typeof STAFF_PRODUCT_ROUTES)[StaffProductKey]
}

const STAFF_PRODUCT_HOSTNAMES: Record<string, StaffProduct> = {
  'ehr.healthidentitydirectory.com': { key: 'ehr', hostname: 'ehr.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.ehr },
  'lab.healthidentitydirectory.com': { key: 'lab', hostname: 'lab.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.lab },
  'pharmacy.healthidentitydirectory.com': { key: 'pharmacy', hostname: 'pharmacy.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.pharmacy },
  'migrate.healthidentitydirectory.com': { key: 'migrate', hostname: 'migrate.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.migrate },
  'outreach.healthidentitydirectory.com': { key: 'outreach', hostname: 'outreach.healthidentitydirectory.com', route: STAFF_PRODUCT_ROUTES.outreach },
}

// Exact aliases only: an unrelated hostname must not select a product portal.
for (const product of Object.values(STAFF_PRODUCT_HOSTNAMES)) {
  const hostname = product.hostname.replace('.healthidentitydirectory.com', '.staging.healthidentitydirectory.com')
  STAFF_PRODUCT_HOSTNAMES[hostname] = { ...product, hostname }
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '')
}

export function resolveStaffProductHostname(hostname: string): StaffProduct | null {
  return STAFF_PRODUCT_HOSTNAMES[normalizeHostname(hostname)] ?? null
}

export function isStaffProductRoute(pathname: string): boolean {
  return Object.values(STAFF_PRODUCT_ROUTES).includes(pathname as (typeof STAFF_PRODUCT_ROUTES)[StaffProductKey])
}

export function isPlatformAdminHostname(hostname: string): boolean {
  return [PLATFORM_ADMIN_HOSTNAME, STAGING_ADMIN_HOSTNAME].includes(normalizeHostname(hostname))
}

/** The widget and login request use the same action accepted by Identity. */
export function resolveStaffLoginAction(hostname: string) {
  const product = resolveStaffProductHostname(hostname)
  return product ? STAFF_LOGIN_ACTIONS[product.key] : 'staff-login'
}

/** Staff reset is accepted on the canonical portal origin, not product hosts. */
export function resolveStaffRecoveryUrl(hostname: string): string {
  const product = resolveStaffProductHostname(hostname)
  if (!product) return '/provider/recover'
  const canonical = product.hostname.includes('.staging.')
    ? 'staging.healthidentitydirectory.com' : 'www.healthidentitydirectory.com'
  return `https://${canonical}/provider/recover?returnTo=${product.key}`
}

/** A recovery return can name only a known product, never an arbitrary URL. */
export function resolveRecoverySignInUrl(hostname: string, search: string): string {
  const normalized = normalizeHostname(hostname)
  if (!['staging.healthidentitydirectory.com', 'www.healthidentitydirectory.com'].includes(normalized)) return '/provider/sign-in'
  const key = new URLSearchParams(search).get('returnTo')
  const staging = normalized === 'staging.healthidentitydirectory.com'
  const product = Object.values(STAFF_PRODUCT_HOSTNAMES).find(item => item.key === key
    && item.hostname.includes('.staging.') === staging)
  return product ? `https://${product.hostname}/provider/sign-in` : '/provider/sign-in'
}

export function isPlatformAdminRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname === PLATFORM_ADMIN_ROUTE || pathname.startsWith('/admin/')
}
