import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PORTAL_HOSTNAMES, resolveStaffProductHostname } from './productHostname'
import { otherStaffSites, ownProductPage, rightSiteHref, siteElsewhere, siteOf, siteServing } from './productSites'

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
    expect(new URL(rightSiteHref(at('/provider/patients', '?next=https://evil.example', '#@evil.example'),
      'lab.healthidentitydirectory.com')!).hostname).toBe('ehr.healthidentitydirectory.com')
  })

  it('reads the provider workspace’s pages whatever their case', () => {
    expect(rightSiteHref(at('/Provider/Patients'), 'lab.healthidentitydirectory.com'))
      .toBe('https://ehr.healthidentitydirectory.com/Provider/Patients')
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

describe('otherStaffSites', () => {
  it('lists the other sites serving some of the pages, in a fixed order, once each', () => {
    const paths = ['/provider/outreach', '/provider/patients', '/provider/clinical', '/provider/laboratory', '/provider/audit']
    expect(otherStaffSites(paths, 'pharmacy.healthidentitydirectory.com').map(site => site.hostname))
      .toEqual(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com'])
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
})

describe('ownProductPage', () => {
  it('is a product page a staff site serves, never one every staff site serves', () => {
    const ehr = 'ehr.healthidentitydirectory.com'
    const lab = 'lab.staging.healthidentitydirectory.com'
    for (const path of ['/provider/patients', '/provider/clinical/encounter-1', '/provider/laboratory', '/provider/pharmacy/sell']) {
      expect(ownProductPage(path, ehr)).toBe(true)
    }
    for (const path of ['/provider/laboratory', '/provider/laboratory/work/item-1', '/PROVIDER/LABORATORY']) expect(ownProductPage(path, lab)).toBe(true)
    for (const path of ['/provider', '/provider/', '/provider/sign-in', '/provider/institutions', '/provider/staff', '/provider/staff/join',
      '/provider/billing', '/provider/audit', '/provider/facility', '/provider/hr', '/provider/recover', '/provider/join']) {
      expect(ownProductPage(path, ehr)).toBe(false)
      expect(ownProductPage(path, lab)).toBe(false)
    }
    // Another site's page, the patient portal and the admin pages are not this site's product.
    for (const path of ['/provider/patients', '/provider/pharmacy', '/records', '/', '/admin/overview']) expect(ownProductPage(path, lab)).toBe(false)
  })

  it('is false on any host that is not a staff site', () => {
    for (const hostname of ['app.healthidentitydirectory.com', 'admin.healthidentitydirectory.com', 'localhost', 'evil.example']) {
      expect(ownProductPage('/provider/laboratory', hostname)).toBe(false)
    }
  })
})
