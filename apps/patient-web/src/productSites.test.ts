import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PORTAL_HOSTNAMES, resolveStaffProductHostname } from './productHostname'
import { offeredHere, otherStaffSites, rightSiteHref, siteElsewhere, siteNameOf, siteOf, siteServing } from './productSites'
import { opensInProduct } from './ehr-blue/frame/product'

/** Each product on its own site: which host a site is, and where an address another site serves goes. */
const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

describe('siteOf', () => {
  it.each([
    ['app.healthidentitydirectory.com', 'web', 'production'],
    ['ehr.healthidentitydirectory.com', 'ehr', 'production'],
    ['lab.healthidentitydirectory.com', 'lab', 'production'],
    ['pharmacy.healthidentitydirectory.com', 'pharmacy', 'production'],
    ['migrate.healthidentitydirectory.com', 'migrate', 'production'],
    ['outreach.healthidentitydirectory.com', 'outreach', 'production'],
    ['staging.healthidentitydirectory.com', 'web', 'staging'],
    ['ehr.staging.healthidentitydirectory.com', 'ehr', 'staging'],
    ['lab.staging.healthidentitydirectory.com', 'lab', 'staging'],
    ['pharmacy.staging.healthidentitydirectory.com', 'pharmacy', 'staging'],
    ['migrate.staging.healthidentitydirectory.com', 'migrate', 'staging'],
    ['outreach.staging.healthidentitydirectory.com', 'outreach', 'staging'],
    [' LAB.HealthIdentityDirectory.com. ', 'lab', 'production'],
  ])('reads %s as the %s site of %s', (hostname, key, deployment) => {
    expect(siteOf(hostname)).toMatchObject({ key, deployment })
  })

  it.each(['localhost', '127.0.0.1', 'healthidentitydirectory.com', 'www.healthidentitydirectory.com',
    'admin.healthidentitydirectory.com', 'admin.staging.healthidentitydirectory.com', 'lab.healthidentitydirectory.com.example.test',
    'evil-lab.healthidentitydirectory.com', 'lab.preview.healthidentitydirectory.com', 'api.healthidentitydirectory.com'])('is no site for %s', hostname => {
    expect(siteOf(hostname)).toBeNull()
  })

  it('knows every staff product host the portal knows, as the same product', () => {
    for (const hostname of PORTAL_HOSTNAMES) {
      const product = resolveStaffProductHostname(hostname)
      if (product) expect(siteOf(hostname)?.key, hostname).toBe(product.key)
    }
  })

  it('names each site as the edge worker serves it', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const worker = readFileSync(resolve(here, '../../../infra/cloudflare/src/frontend-worker.mjs'), 'utf8')
    for (const deployment of ['production', 'staging'] as const) {
      const hosts = ['app', 'ehr', 'lab', 'pharmacy', 'migrate', 'outreach'].map(name => deployment === 'staging'
        ? (name === 'app' ? 'staging.healthidentitydirectory.com' : `${name}.staging.healthidentitydirectory.com`)
        : `${name}.healthidentitydirectory.com`)
      for (const hostname of hosts) {
        expect(worker, hostname).toContain(`'${hostname}'`)
        expect(siteOf(hostname)?.deployment, hostname).toBe(deployment)
      }
    }
  })
})

describe('rightSiteHref', () => {
  it('keeps the address within the site it names, whatever the path holds', () => {
    expect(rightSiteHref(at('//evil.example/records'), 'lab.healthidentitydirectory.com'))
      .toBe('https://app.healthidentitydirectory.com//evil.example/records')
    expect(new URL(rightSiteHref(at('//evil.example/records'), 'lab.healthidentitydirectory.com')!).hostname)
      .toBe('app.healthidentitydirectory.com')
    expect(new URL(rightSiteHref(at('/provider/pharmacy', '?next=https://evil.example', '#@evil.example'),
      'lab.healthidentitydirectory.com')!).hostname).toBe('pharmacy.healthidentitydirectory.com')
  })

  it('reads the provider workspace’s pages whatever their case', () => {
    expect(rightSiteHref(at('/Provider/Pharmacy'), 'lab.healthidentitydirectory.com'))
      .toBe('https://pharmacy.healthidentitydirectory.com/Provider/Pharmacy')
    expect(rightSiteHref(at('/Provider/Clinical'), 'lab.healthidentitydirectory.com')).toBeNull()
    expect(rightSiteHref(at('/PROVIDER/PATIENTS'), 'lab.healthidentitydirectory.com')).toBeNull()
    expect(rightSiteHref(at('/PROVIDER/LABORATORY'), 'lab.healthidentitydirectory.com')).toBeNull()
  })

  it('takes an address that only begins like the workspace’s for the patient portal’s', () => {
    expect(siteServing('/providers', 'ehr.healthidentitydirectory.com')?.key).toBe('web')
    expect(siteServing('/provider-help', 'app.healthidentitydirectory.com')).toBeNull()
  })

  it('never sends the admin pages anywhere: the admin site routes them', () => {
    expect(rightSiteHref(at('/admin/overview'), 'ehr.healthidentitydirectory.com')).toBeNull()
    expect(rightSiteHref(at('/admin'), 'app.healthidentitydirectory.com')).toBeNull()
  })
})

describe('siteServing', () => {
  const PRODUCT_SITES = ['lab', 'pharmacy', 'migrate', 'outreach', 'lab.staging', 'pharmacy.staging', 'migrate.staging', 'outreach.staging']

  // Each product works on its own (owner, 2026-11-02): a page of the hospital EHR's typed on a product site stays on that
  // site, where the frame opens the product's Home in its place (ehr-blue/frame/product.ts opensInProduct). Nothing on
  // a product site sends anyone to the EHR site.
  it.each(PRODUCT_SITES)('keeps the hospital EHR’s pages on %s, Patient registration among them', name => {
    const hostname = `${name}.healthidentitydirectory.com`
    for (const path of ['/provider/registration', '/provider/clinical', '/provider/clinical/5a020001', '/provider/in-person-check',
      '/provider/appointments/5a020001', '/provider/emergency', '/provider/payments', '/provider/tour']) {
      expect(siteServing(path, hostname), `${path} on ${hostname}`).toBeNull()
    }
  })

  // Patients and Access requests on every staff site, each behind its own permission (the classic portal offered both
  // everywhere), with Facility subscription, What's left, Facility setup and the pages that run the facility.
  it.each(PRODUCT_SITES)('serves on %s every page its product opens', name => {
    const hostname = `${name}.healthidentitydirectory.com`
    for (const path of ['/provider', '/provider/patients', '/provider/patients/5a020001', '/provider/requests', '/provider/requests/r-1',
      '/provider/billing', '/provider/whats-left', '/provider/onboarding', '/provider/onboarding/staff', '/provider/staff',
      '/provider/staff/join', '/provider/audit', '/provider/facility', '/provider/hr', '/provider/institutions']) {
      expect(siteServing(path, hostname), `${path} on ${hostname}`).toBeNull()
    }
  })

  it.each(['lab', 'pharmacy'])('serves the till’s money pages on %s, which has a till of its own', name => {
    for (const path of ['/provider/payments', '/provider/price-list', '/provider/end-of-day', '/provider/payment-setup']) {
      expect(siteServing(path, `${name}.healthidentitydirectory.com`), path).toBeNull()
    }
  })

  // Each product site keeps its own sign-up, sign-in, password reset and invitations (owner, 2026-11-02; #114, #115).
  it.each(['ehr', ...PRODUCT_SITES])('serves the public staff pages on %s', name => {
    const hostname = `${name}.healthidentitydirectory.com`
    for (const path of ['/provider/sign-in', '/provider/recover', '/provider/enroll', '/provider/invitation', '/provider/join',
      '/provider/join/status']) {
      expect(siteServing(path, hostname), `${path} on ${hostname}`).toBeNull()
    }
  })

  it.each([
    ['lab', '/provider/pharmacy/sell', 'pharmacy'],
    ['lab', '/provider/ocr', 'migrate'],
    ['lab', '/provider/migrate', 'migrate'],
    ['lab', '/provider/outreach', 'outreach'],
    ['pharmacy', '/provider/laboratory/work/item-1', 'lab'],
    ['migrate', '/provider/pharmacy', 'pharmacy'],
    ['outreach', '/provider/ocr', 'migrate'],
    ['outreach.staging', '/provider/laboratory', 'lab'],
  ])('opens on %s another product’s own page, %s, on that product’s site: %s', (name, path, owner) => {
    expect(siteServing(path, `${name}.healthidentitydirectory.com`)?.key).toBe(owner)
  })

  it('keeps every staff page on the hospital EHR’s site, the hospital’s own laboratory, pharmacy, OCR and outreach included', () => {
    for (const path of ['/provider/laboratory', '/provider/pharmacy', '/provider/ocr', '/provider/migrate', '/provider/outreach',
      '/provider/registration', '/provider/clinical']) {
      expect(siteServing(path, 'ehr.healthidentitydirectory.com'), path).toBeNull()
      expect(siteServing(path, 'ehr.staging.healthidentitydirectory.com'), path).toBeNull()
    }
  })

  // app. serves patients only (owner, 2026-11-02): its staff addresses are the portal's own rule (staffSignIn.tsx, #114),
  // never this table's. This table opens none of them on another site, and adds none to app.
  it('leaves the main site’s staff addresses to the portal’s patients-only rule', () => {
    for (const path of ['/provider', '/provider/sign-in', '/provider/patients', '/provider/requests', '/provider/laboratory',
      '/provider/recover', '/provider/staff/join']) {
      expect(siteServing(path, 'app.healthidentitydirectory.com'), path).toBeNull()
      expect(siteServing(path, 'staging.healthidentitydirectory.com'), path).toBeNull()
    }
  })
})

describe('offeredHere', () => {
  // One list of what a product site offers: the frame's own (opensInProduct), not a second one here.
  it.each(['lab', 'pharmacy', 'migrate', 'outreach'] as const)('offers on %s exactly the pages its product opens', product => {
    const hostname = `${product}.healthidentitydirectory.com`
    for (const page of ['', 'patients', 'requests', 'registration', 'in-person-check', 'clinical', 'laboratory', 'pharmacy', 'ocr',
      'outreach', 'audit', 'billing', 'staff', 'institutions', 'whats-left', 'onboarding', 'payments', 'end-of-day']) {
      expect(offeredHere(page ? `/provider/${page}` : '/provider', hostname), `${page} on ${hostname}`).toBe(opensInProduct(product, page))
    }
  })

  it('offers every staff page on the hospital EHR’s site, and on any host that is not a Health ID site', () => {
    for (const hostname of ['ehr.healthidentitydirectory.com', 'localhost', 'admin.healthidentitydirectory.com']) {
      for (const path of ['/provider/registration', '/provider/clinical', '/provider/laboratory', '/provider/pharmacy']) {
        expect(offeredHere(path, hostname), `${path} on ${hostname}`).toBe(true)
      }
    }
  })

  it('offers nothing another site serves', () => {
    expect(offeredHere('/provider/pharmacy', 'lab.healthidentitydirectory.com')).toBe(false)
    expect(offeredHere('/records', 'lab.healthidentitydirectory.com')).toBe(false)
  })
})

describe('otherStaffSites', () => {
  it('lists the other product sites serving some of the pages, in a fixed order, once each, and never the EHR site', () => {
    const paths = ['/provider/outreach', '/provider/patients', '/provider/clinical', '/provider/laboratory', '/provider/audit',
      '/provider/registration', '/provider/outreach/campaign-1']
    expect(otherStaffSites(paths, 'pharmacy.healthidentitydirectory.com').map(site => site.hostname))
      .toEqual(['lab.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com'])
    expect(otherStaffSites(paths, 'ehr.healthidentitydirectory.com')).toEqual([])
    expect(otherStaffSites(paths, 'localhost')).toEqual([])
  })
})

describe('siteElsewhere', () => {
  it('names a staff site only from another Health ID site of the same deployment', () => {
    expect(siteElsewhere('lab', 'ehr.staging.healthidentitydirectory.com')?.hostname).toBe('lab.staging.healthidentitydirectory.com')
    expect(siteElsewhere('lab', 'lab.healthidentitydirectory.com')).toBeNull()
    expect(siteElsewhere('lab', 'localhost')).toBeNull()
    expect(siteElsewhere('ehr', 'admin.healthidentitydirectory.com')).toBeNull()
  })

  it('names none from the main site, which is not a staff site: staging’s staff pages work for every facility', () => {
    expect(siteElsewhere('ehr', 'staging.healthidentitydirectory.com')).toBeNull()
    expect(siteElsewhere('lab', 'staging.healthidentitydirectory.com')).toBeNull()
    expect(siteElsewhere('ehr', 'app.healthidentitydirectory.com')).toBeNull()
  })
})

describe('siteNameOf', () => {
  it.each([
    ['https://lab.healthidentitydirectory.com/provider/laboratory', 'Health ID Lab'],
    ['https://pharmacy.staging.healthidentitydirectory.com/provider/pharmacy', 'Health ID Pharmacy'],
    ['https://ehr.healthidentitydirectory.com/provider/patients', 'Health ID EHR'],
    ['https://migrate.healthidentitydirectory.com/provider/ocr', 'Health ID Migrate'],
    ['https://outreach.healthidentitydirectory.com/', 'Health ID Outreach'],
    ['https://app.healthidentitydirectory.com/records', 'the main Health ID site'],
    ['https://staging.healthidentitydirectory.com/records', 'the main Health ID site'],
    ['https://elsewhere.example.test/', 'another Health ID site'],
  ])('names the site of %s by its product, never its hostname: %s', (href, name) => {
    expect(siteNameOf(href)).toBe(name)
  })
})
