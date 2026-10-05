export const STAFF_PRODUCT_ROUTES = {
  ehr: '/provider/clinical',
  lab: '/provider/laboratory',
  pharmacy: '/provider/pharmacy',
  migrate: '/provider/ocr',
  outreach: '/provider/outreach',
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

export function resolveStaffProductHostname(hostname: string): StaffProduct | null {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/, '')
  return STAFF_PRODUCT_HOSTNAMES[normalized] ?? null
}

export function isStaffProductRoute(pathname: string): boolean {
  return Object.values(STAFF_PRODUCT_ROUTES).includes(pathname as (typeof STAFF_PRODUCT_ROUTES)[StaffProductKey])
}
