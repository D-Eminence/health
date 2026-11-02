import { describe, expect, it } from 'vitest'
import {
  isPlatformAdminHostname,
  isPlatformAdminRoute,
  isStaffProductRoute,
  resolveStaffProductHostname,
  STAFF_RECOVERY_PATH,
  staffLoginAction,
  staffRecoveryHref,
  staffSignInHref,
  CLINICIAN_SIGNUP_PATH,
  CLINICIAN_STATUS_PATH,
  clinicianOtherSiteHref,
  clinicianPageHref,
  facilitySignUpScope,
  otherFacilitySignUps,
  PROVIDER_ENROLLMENT_PATH,
  providerEnrollmentHref,
  STAFF_INVITATION_PATH,
  STAFF_JOIN_PATH,
  staffHostForRole,
  staffInvitationHref,
  staffPagesOrigin,
  staffSiteForOrganizationType,
  staffSiteHostname,
  staffSiteOrigin,
  staffAddressProduct,
  staffPageElsewhere,
} from './productHostname'

describe('resolveStaffProductHostname', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', '/provider/clinical'],
    ['lab.healthidentitydirectory.com', '/provider/laboratory'],
    ['pharmacy.healthidentitydirectory.com', '/provider/pharmacy'],
    ['migrate.healthidentitydirectory.com', '/provider/ocr'],
    ['outreach.healthidentitydirectory.com', '/provider/outreach'],
  ])('maps %s to %s', (hostname, route) => {
    expect(resolveStaffProductHostname(hostname)?.route).toBe(route)
  })

  // hid-system infra/cloudflare/src/frontend-worker.mjs (DEPLOYMENT_PROFILES.staging).
  it.each([
    ['ehr.staging.healthidentitydirectory.com', '/provider/clinical'],
    ['lab.staging.healthidentitydirectory.com', '/provider/laboratory'],
    ['pharmacy.staging.healthidentitydirectory.com', '/provider/pharmacy'],
    ['migrate.staging.healthidentitydirectory.com', '/provider/ocr'],
    ['outreach.staging.healthidentitydirectory.com', '/provider/outreach'],
  ])('maps the staging host %s to %s', (hostname, route) => {
    expect(resolveStaffProductHostname(hostname)?.route).toBe(route)
  })

  it.each([
    'staging.healthidentitydirectory.com',
    'www.healthidentitydirectory.com',
    'admin.staging.healthidentitydirectory.com',
    'ocr.staging.healthidentitydirectory.com',
    'lab.staging.staging.healthidentitydirectory.com',
    'lab.preview.healthidentitydirectory.com',
    'evil-lab.staging.healthidentitydirectory.com',
    'lab.staging.healthidentitydirectory.com.evil.test',
    'constructor',
    '__proto__',
  ])('maps no other host to a workspace (%s)', hostname => {
    expect(resolveStaffProductHostname(hostname)).toBeNull()
  })

  it('normalizes hostname casing and a trailing dot', () => {
    expect(resolveStaffProductHostname('EHR.HEALTHIDENTITYDIRECTORY.COM.')).toMatchObject({
      key: 'ehr',
      route: '/provider/clinical',
    })
  })

  it('does not treat the root domain as a product hostname', () => {
    expect(resolveStaffProductHostname('healthidentitydirectory.com')).toBeNull()
  })

  it('returns null for an unknown hostname', () => {
    expect(resolveStaffProductHostname('example.com')).toBeNull()
  })
})

describe('isStaffProductRoute', () => {
  it('recognizes only the supported product routes', () => {
    expect(isStaffProductRoute('/provider/clinical')).toBe(true)
    expect(isStaffProductRoute('/provider/laboratory')).toBe(true)
    expect(isStaffProductRoute('/provider/pharmacy')).toBe(true)
    expect(isStaffProductRoute('/provider/ocr')).toBe(true)
    expect(isStaffProductRoute('/provider/outreach')).toBe(true)
    expect(isStaffProductRoute('/provider')).toBe(false)
    expect(isStaffProductRoute('/provider/patients')).toBe(false)
  })
})

describe('platform admin hostname', () => {
  it('recognizes the admin hostname', () => {
    expect(isPlatformAdminHostname('admin.healthidentitydirectory.com')).toBe(true)
    expect(isPlatformAdminHostname('ADMIN.HEALTHIDENTITYDIRECTORY.COM.')).toBe(true)
    expect(isPlatformAdminHostname('healthidentitydirectory.com')).toBe(false)
  })

  it('recognizes the staging admin hostname and no other', () => {
    expect(isPlatformAdminHostname('admin.staging.healthidentitydirectory.com')).toBe(true)
    expect(isPlatformAdminHostname('Admin.Staging.HealthIdentityDirectory.com.')).toBe(true)
    for (const hostname of ['staging.healthidentitydirectory.com', 'admin.staging.staging.healthidentitydirectory.com',
      'admin.preview.healthidentitydirectory.com', 'admin.staging.healthidentitydirectory.com.evil.test',
      'evil-admin.staging.healthidentitydirectory.com']) {
      expect(isPlatformAdminHostname(hostname), hostname).toBe(false)
    }
  })

  it('recognizes the admin routes', () => {
    expect(isPlatformAdminRoute('/admin')).toBe(true)
    expect(isPlatformAdminRoute('/admin/overview')).toBe(true)
    expect(isPlatformAdminRoute('/admin/facilities')).toBe(true)
    expect(isPlatformAdminRoute('/provider/clinical')).toBe(false)
  })
})

/** hid-system's Turnstile allowlist accepts only these actions on each staff product host. */
describe('staffLoginAction', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', 'staff-login'],
    ['lab.healthidentitydirectory.com', 'lab-login'],
    ['pharmacy.healthidentitydirectory.com', 'pharmacy-login'],
    ['migrate.healthidentitydirectory.com', 'ocr-login'],
    ['outreach.healthidentitydirectory.com', 'outreach-login'],
    ['ehr.staging.healthidentitydirectory.com', 'staff-login'],
    ['lab.staging.healthidentitydirectory.com', 'lab-login'],
    ['pharmacy.staging.healthidentitydirectory.com', 'pharmacy-login'],
    ['migrate.staging.healthidentitydirectory.com', 'ocr-login'],
    ['outreach.staging.healthidentitydirectory.com', 'outreach-login'],
    ['MIGRATE.HEALTHIDENTITYDIRECTORY.COM.', 'ocr-login'],
  ])('signs in on %s with %s', (hostname, action) => {
    expect(staffLoginAction(hostname)).toBe(action)
  })

  it.each(['www.healthidentitydirectory.com', 'staging.healthidentitydirectory.com', 'localhost',
    'migrate.example.com', 'evil-migrate.healthidentitydirectory.com', 'migrate.healthidentitydirectory.com.evil.test'])(
    'uses the general staff action on %s', hostname => {
      expect(staffLoginAction(hostname)).toBe('staff-login')
    })
})

/** Every staff product host of both deployments: each serves its own staff pages (hid-system accepts their checks there). */
const PRODUCT_HOSTS = ['ehr', 'lab', 'pharmacy', 'migrate', 'outreach'].flatMap(product =>
  [`${product}.healthidentitydirectory.com`, `${product}.staging.healthidentitydirectory.com`])

/** Hosts that are not Health ID sites, or only look like one: nothing in them may ever reach an address. */
const LOOKALIKE_HOSTS = [
  'app.healthidentitydirectory.com.evil.example', 'evil-app.healthidentitydirectory.com', 'app.evil.healthidentitydirectory.com',
  'admin.healthidentitydirectory.com.evil.example', 'lab.healthidentitydirectory.com.evil.example', 'https://app.healthidentitydirectory.com',
  'app.healthidentitydirectory.com/provider/recover?next=https://evil.example', 'preview.pages.dev', '',
]

/**
 * Each product is its own site (owner, 2026-11-01): hid-system accepts staff-reset, provider-enrollment and
 * staff-invitation on every product site, besides its own sign-in. The production patient portal (app.) serves
 * patients only, and the admin sites platform administrators only: from there, staff pages are the EHR site's.
 */
describe('staffPagesOrigin', () => {
  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com'],
    ['APP.HEALTHIDENTITYDIRECTORY.COM.', 'https://ehr.healthidentitydirectory.com'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com'],
  ])('opens staff pages from %s on %s', (hostname, origin) => {
    expect(staffPagesOrigin(hostname)).toBe(origin)
  })

  it.each([...PRODUCT_HOSTS, 'staging.healthidentitydirectory.com', 'www.healthidentitydirectory.com', 'localhost', '127.0.0.1',
    ...LOOKALIKE_HOSTS])('keeps staff pages on %s itself', hostname => {
    expect(staffPagesOrigin(hostname)).toBeNull()
  })
})

describe('staffRecoveryHref', () => {
  it.each(PRODUCT_HOSTS)('keeps staff recovery on the product site %s, which hid-system accepts there', hostname => {
    expect(staffRecoveryHref(hostname)).toBe(STAFF_RECOVERY_PATH)
    expect(staffRecoveryHref(hostname.toUpperCase() + '.')).toBe(STAFF_RECOVERY_PATH)
  })

  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/recover'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/recover'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com/provider/recover'],
  ])('sends staff on %s, which serves no staff pages, to %s', (hostname, href) => {
    expect(staffRecoveryHref(hostname)).toBe(href)
  })

  it.each(['staging.healthidentitydirectory.com', 'localhost', '127.0.0.1', ...LOOKALIKE_HOSTS])(
    'keeps recovery on %s and never builds an address from it', hostname => {
      // Only three fixed values exist; nothing in the hostname is copied into the link.
      expect(staffRecoveryHref(hostname)).toBe(STAFF_RECOVERY_PATH)
    })
})

/**
 * Clinician self sign-up (hid-system ADR-066) opens on each product site, as every other staff page does; the Novu
 * backend serves no clinician sign-up yet, so no site accepts its checks today.
 */
describe('clinicianOtherSiteHref', () => {
  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com'],
  ])('sends %s to the EHR site', (hostname, origin) => {
    expect(clinicianOtherSiteHref(hostname, CLINICIAN_SIGNUP_PATH)).toBe(`${origin}/provider/join`)
    expect(clinicianOtherSiteHref(hostname, CLINICIAN_STATUS_PATH)).toBe(`${origin}/provider/join/status`)
    expect(clinicianPageHref(hostname, CLINICIAN_SIGNUP_PATH)).toBe(`${origin}/provider/join`)
  })

  it.each([...PRODUCT_HOSTS, 'staging.healthidentitydirectory.com', 'localhost', ...LOOKALIKE_HOSTS])('keeps the page on %s', hostname => {
    expect(clinicianOtherSiteHref(hostname, CLINICIAN_SIGNUP_PATH)).toBeNull()
    expect(clinicianPageHref(hostname, CLINICIAN_STATUS_PATH)).toBe('/provider/join/status')
  })
})

describe('staffSignInHref', () => {
  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['APP.HEALTHIDENTITYDIRECTORY.COM.', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com/provider/sign-in'],
  ])('sends staff on %s to %s', (hostname, href) => {
    expect(staffSignInHref(hostname)).toBe(href)
  })

  it.each([...PRODUCT_HOSTS, 'staging.healthidentitydirectory.com', 'www.healthidentitydirectory.com', 'localhost', ...LOOKALIKE_HOSTS])(
    'keeps staff sign-in on %s itself', hostname => {
      expect(staffSignInHref(hostname)).toBeNull()
    })
})

describe('providerEnrollmentHref', () => {
  it.each(PRODUCT_HOSTS)('keeps facility sign-up on the product site %s, which hid-system accepts there', hostname => {
    expect(providerEnrollmentHref(hostname)).toBe(PROVIDER_ENROLLMENT_PATH)
    expect(PROVIDER_ENROLLMENT_PATH).toBe('/provider/enroll')
  })

  it.each([
    ['app.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
    ['admin.healthidentitydirectory.com', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com/provider/enroll'],
  ])('sends %s, which serves no staff pages, to %s', (hostname, href) => {
    expect(providerEnrollmentHref(hostname)).toBe(href)
  })

  it.each(['staging.healthidentitydirectory.com', 'www.healthidentitydirectory.com', 'localhost', '127.0.0.1', ...LOOKALIKE_HOSTS])(
    'keeps the sign-up page on %s and never builds an address from it', hostname => {
      expect(providerEnrollmentHref(hostname)).toBe(PROVIDER_ENROLLMENT_PATH)
    })
})

/** Each product site signs up its own kind of facility only (owner, 2026-11-02). */
describe('facilitySignUpScope', () => {
  const hospitals = { organizationTypes: ['hospital', 'clinic', 'other'] }
  it.each([
    ['lab.healthidentitydirectory.com', { organizationTypes: ['laboratory'], products: ['laboratory'] }],
    ['lab.staging.healthidentitydirectory.com', { organizationTypes: ['laboratory'], products: ['laboratory'] }],
    ['PHARMACY.HEALTHIDENTITYDIRECTORY.COM.', { organizationTypes: ['pharmacy'], products: ['pharmacy'] }],
    ['pharmacy.staging.healthidentitydirectory.com', { organizationTypes: ['pharmacy'], products: ['pharmacy'] }],
    ['ehr.healthidentitydirectory.com', { ...hospitals, products: ['ehr'] }],
    ['ehr.staging.healthidentitydirectory.com', { ...hospitals, products: ['ehr'] }],
    ['migrate.healthidentitydirectory.com', { ...hospitals, products: ['migrate'] }],
    ['outreach.healthidentitydirectory.com', { ...hospitals, products: ['ehr'] }],
  ])('on %s offers %o', (hostname, scope) => {
    expect(facilitySignUpScope(hostname)).toEqual(scope)
  })

  it.each(['app.healthidentitydirectory.com', 'staging.healthidentitydirectory.com', 'admin.healthidentitydirectory.com', 'localhost',
    ...LOOKALIKE_HOSTS])('offers every kind of facility on %s, as before', hostname => {
    expect(facilitySignUpScope(hostname)).toBeNull()
    expect(otherFacilitySignUps(hostname)).toEqual([])
  })

  it('sends every other kind of facility to its own site’s sign-up, in the same deployment', () => {
    expect(otherFacilitySignUps('lab.healthidentitydirectory.com')).toEqual([
      { kind: 'hospital', name: 'Health ID EHR', href: 'https://ehr.healthidentitydirectory.com/provider/enroll' },
      { kind: 'pharmacy', name: 'Health ID Pharmacy', href: 'https://pharmacy.healthidentitydirectory.com/provider/enroll' },
    ])
    expect(otherFacilitySignUps('pharmacy.staging.healthidentitydirectory.com')).toEqual([
      { kind: 'hospital', name: 'Health ID EHR', href: 'https://ehr.staging.healthidentitydirectory.com/provider/enroll' },
      { kind: 'laboratory', name: 'Health ID Laboratory', href: 'https://lab.staging.healthidentitydirectory.com/provider/enroll' },
    ])
    for (const hostname of ['ehr.healthidentitydirectory.com', 'migrate.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com']) {
      expect(otherFacilitySignUps(hostname), hostname).toEqual([
        { kind: 'laboratory', name: 'Health ID Laboratory', href: 'https://lab.healthidentitydirectory.com/provider/enroll' },
        { kind: 'pharmacy', name: 'Health ID Pharmacy', href: 'https://pharmacy.healthidentitydirectory.com/provider/enroll' },
      ])
    }
  })
})

/** P4b (Novu only): where an invitation is opened, and the staff site each role and facility type signs in on. */
describe('staff invitations and staff sites (P4b)', () => {
  it('opens an invitation on each product site itself, and on the EHR site from the portal or an admin site', () => {
    expect(STAFF_INVITATION_PATH).toBe('/provider/invitation')
    expect(STAFF_JOIN_PATH).toBe('/provider/staff/join')
    for (const host of [...PRODUCT_HOSTS, 'staging.healthidentitydirectory.com', 'localhost', ...LOOKALIKE_HOSTS]) {
      expect(staffInvitationHref(host)).toBe('/provider/invitation')
    }
    expect(staffInvitationHref('app.healthidentitydirectory.com')).toBe('https://ehr.healthidentitydirectory.com/provider/invitation')
    expect(staffInvitationHref('admin.healthidentitydirectory.com')).toBe('https://ehr.healthidentitydirectory.com/provider/invitation')
    expect(staffInvitationHref('admin.staging.healthidentitydirectory.com'))
      .toBe('https://ehr.staging.healthidentitydirectory.com/provider/invitation')
  })

  it.each([['ehr', 'production', 'https://ehr.healthidentitydirectory.com'], ['lab', 'production', 'https://lab.healthidentitydirectory.com'],
    ['pharmacy', 'staging', 'https://pharmacy.staging.healthidentitydirectory.com']] as const)(
    'names the %s site of %s as %s', (site, deployment, origin) => {
      expect(staffSiteOrigin(site, deployment)).toBe(origin)
    })

  it.each([
    ['doctor', 'ehr'], ['clinician', 'ehr'], ['nurse', 'ehr'], ['receptionist', 'ehr'], ['org_admin', 'ehr'],
    ['lab', 'lab'], ['pharmacist', 'pharmacy'],
  ])('signs a %s in on the %s site, in production and on staging', (role, site) => {
    expect(staffHostForRole(role, 'app.healthidentitydirectory.com')).toBe(`${site}.healthidentitydirectory.com`)
    expect(staffHostForRole(role, 'ehr.healthidentitydirectory.com')).toBe(`${site}.healthidentitydirectory.com`)
    expect(staffHostForRole(role, 'staging.healthidentitydirectory.com')).toBe(`${site}.staging.healthidentitydirectory.com`)
    expect(staffHostForRole(role, 'lab.staging.healthidentitydirectory.com')).toBe(`${site}.staging.healthidentitydirectory.com`)
  })

  it.each([['hospital', 'ehr'], ['clinic', 'ehr'], ['other', 'ehr'], ['laboratory', 'lab'], ['pharmacy', 'pharmacy']])(
    'signs a %s’s administrator in on the %s site', (type, site) => {
      expect(staffSiteForOrganizationType(type)).toBe(site)
    })

  it('names no staff site outside production and staging, where this portal’s own sign-in is used', () => {
    for (const host of ['localhost', '127.0.0.1', 'preview.pages.dev', 'healthidentitydirectory.com.evil.example']) {
      expect(staffSiteHostname('ehr', host)).toBeNull()
      expect(staffHostForRole('pharmacist', host)).toBeNull()
    }
  })
})

/**
 * Where a staff address opens from a site that serves no staff pages (owner, 2026-11-02: app. is for patients only, and
 * each product has its own sign-up, sign-in, password reset and invitation): the product site the address names, else
 * the EHR site. The edge (frontend-worker.mjs, staffSiteOf) follows the same rule.
 */
describe('staffAddressProduct', () => {
  it.each([
    ['/provider', '', 'ehr'],
    ['/provider/sign-in', '', 'ehr'],
    ['/provider/recover', '', 'ehr'],
    ['/provider/invitation', '', 'ehr'],
    ['/provider/join', '', 'ehr'],
    ['/provider/enroll', '', 'ehr'],
    ['/provider/enroll', '?product=ehr', 'ehr'],
    ['/provider/enroll', '?product=laboratory', 'lab'],
    ['/provider/enroll/', '?product=laboratory', 'lab'],
    ['/Provider/Enroll', '?product=pharmacy', 'pharmacy'],
    ['/provider/enroll', '?product=migrate', 'migrate'],
    ['/provider/enroll', '?type=laboratory', 'lab'],
    ['/provider/enroll', '?type=pharmacy&product=ehr', 'pharmacy'],
    ['/provider/enroll', '?type=hospital&product=migrate', 'migrate'],
    ['/provider/enroll', '?product=outreach', 'ehr'],
    ['/provider/enroll', '?product=toString', 'ehr'],
    ['/provider/enroll', '?type=__proto__', 'ehr'],
    ['/provider/enroll', '?product=https://lab.healthidentitydirectory.com', 'ehr'],
    ['/provider/recover', '?product=laboratory', 'ehr'],
    ['/provider/clinical', '', 'ehr'],
    ['/provider/laboratory', '', 'lab'],
    ['/provider/laboratory/queue', '?x=1', 'lab'],
    ['/provider/pharmacy', '', 'pharmacy'],
    ['/provider/ocr', '', 'migrate'],
    ['/provider/outreach', '', 'outreach'],
    ['/provider/laboratoryx', '', 'ehr'],
    ['/provider/sign-in', '?returnTo=/provider/laboratory', 'lab'],
    ['/provider/sign-in', '?returnTo=/provider/pharmacy?tab=queue', 'pharmacy'],
    ['/provider/sign-in', '?returnTo=//evil.example/provider/laboratory', 'ehr'],
    ['/provider/sign-in', '?returnTo=https://lab.healthidentitydirectory.com/provider/laboratory', 'ehr'],
  ])('sends %s%s to the %s site', (pathname, search, product) => {
    expect(staffAddressProduct(pathname, search)).toBe(product)
  })
})

describe('staffPageElsewhere', () => {
  it.each([
    ['app.healthidentitydirectory.com', '/provider/enroll', '?product=laboratory', '',
      'https://lab.healthidentitydirectory.com/provider/enroll?product=laboratory'],
    ['app.healthidentitydirectory.com', '/provider/invitation', '', '#a1.token',
      'https://ehr.healthidentitydirectory.com/provider/invitation#a1.token'],
    ['APP.HEALTHIDENTITYDIRECTORY.COM.', '/provider/pharmacy', '', '', 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy'],
    ['admin.healthidentitydirectory.com', '/provider/ocr', '', '', 'https://migrate.healthidentitydirectory.com/provider/ocr'],
    ['admin.staging.healthidentitydirectory.com', '/provider/enroll', '?type=pharmacy', '',
      'https://pharmacy.staging.healthidentitydirectory.com/provider/enroll?type=pharmacy'],
    ['admin.staging.healthidentitydirectory.com', '/provider/recover', '', '', 'https://ehr.staging.healthidentitydirectory.com/provider/recover'],
  ])('on %s, opens %s%s%s at %s', (hostname, pathname, search, hash, href) => {
    expect(staffPageElsewhere(hostname, { pathname, search, hash })?.href).toBe(href)
  })

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.staging.healthidentitydirectory.com',
    'staging.healthidentitydirectory.com', 'localhost', ...LOOKALIKE_HOSTS])('is null on %s, which serves its own staff pages', hostname => {
    expect(staffPageElsewhere(hostname, { pathname: '/provider/enroll', search: '?product=laboratory', hash: '' })).toBeNull()
  })

  it('keeps only the path, query and fragment: the origin is always a fixed product site', () => {
    for (const pathname of ['//evil.example/provider', '/provider//evil.example', '/provider/@evil.example']) {
      const href = staffPageElsewhere('app.healthidentitydirectory.com', { pathname, search: '', hash: '' })?.href ?? ''
      expect(new URL(href).origin, pathname).toBe('https://ehr.healthidentitydirectory.com')
    }
  })
})
