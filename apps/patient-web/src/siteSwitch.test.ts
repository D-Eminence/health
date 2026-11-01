import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HEALTH_ID_PATTERN } from '@hid/contracts'
import { siteHref, siteOf, type Site } from './productSites'

/**
 * Moving between the staff sites with a way back (siteSwitch.ts). The site hostnames are productSites.ts's fixed table,
 * used as strings only: jsdom's address is set to them and nothing is contacted. Attacker hosts are *.example.
 */
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href

const EHR = 'ehr.healthidentitydirectory.com'
const LAB = 'lab.healthidentitydirectory.com'
const PHARMACY = 'pharmacy.healthidentitydirectory.com'
const site = (hostname: string) => siteOf(hostname)!

/** The module as a page loads it at `url`: a fresh copy, with nothing read yet. */
async function loadAt(url: string) {
  jsdom.reconfigure({ url })
  vi.resetModules()
  return import('./siteSwitch')
}

const address = () => window.location.pathname + window.location.search + window.location.hash

afterEach(() => { jsdom.reconfigure({ url: servedFrom }); vi.unstubAllEnvs(); vi.restoreAllMocks() })

/** Addresses no switch may come back to, each for its own reason. */
const BAD_BACK_PATHS = [
  '//evil.example', '//evil.example/provider', '/\\evil.example', 'https://evil.example/provider', 'http:/provider',
  'javascript:alert(1)', 'provider/patients', '/provider/../admin', '/provider/./patients', '/provider/%2e%2e/admin',
  '/provider/%2Fevil.example', '/provider/patients%23x', '/provider/patients?x=1', '/provider/patients#x', '/provider/',
  '/provider//patients', '/Provider/patients', '/provider/Patients', '/provider/patients ', ' /provider/patients',
  '/provider/patients\n', '/provider/pat\u0000ients', '/provider/@evil.example', '/provider/patients\\x',
  '/provider/clinical/HID-ABCDEF23', '/provider/clinical/b1000000-0000-4000-8000-00000000a7c3',
  // A Health ID of letters only (HID-ABCDEFGH fits HEALTH_ID_PATTERN), lower-cased, anywhere in the address.
  '/provider/clinical/hid-abcdefgh', '/provider/hid-abcdefgh', '/provider/hid-abcdefghjkmn/patients', '/provider/patients/hid-abc',
  '/provider/requests/7', '/provider/laboratory/work/item-1', '/provider/a/b/c', '/provider/-patients', '/provider/patients-',
  '/provider/in--person', '/records', '/admin/overview', '/', '', `/provider/${'a'.repeat(60)}`,
]

describe('isSwitchBackPath', () => {
  it.each(['/provider', '/provider/patients', '/provider/laboratory/work', '/provider/in-person-check',
    '/provider/tour/register-and-launch'])('takes %s', async path => {
    const { isSwitchBackPath } = await loadAt(`https://${EHR}/provider`)
    expect(isSwitchBackPath(path)).toBe(true)
  })

  it.each(BAD_BACK_PATHS)('refuses %j', async path => {
    const { isSwitchBackPath } = await loadAt(`https://${EHR}/provider`)
    expect(isSwitchBackPath(path)).toBe(false)
  })

  it('refuses a Health ID made of letters only, which the words alone would take', async () => {
    const { isSwitchBackPath } = await loadAt(`https://${EHR}/provider`)
    // Real Health IDs by the contract's own pattern: without a digit, the lower-case words would let them through.
    for (const healthId of ['HID-ABCDEFGH', 'HID-ABCDEFGHJKMN']) {
      expect(HEALTH_ID_PATTERN.test(healthId)).toBe(true)
      expect(isSwitchBackPath(`/provider/clinical/${healthId.toLowerCase()}`)).toBe(false)
      expect(isSwitchBackPath(`/provider/${healthId.toLowerCase()}`)).toBe(false)
    }
    // A word that only starts with the same letters is not one.
    expect(isSwitchBackPath('/provider/hidden')).toBe(true)
  })

  it('refuses anything that is not a string', async () => {
    const { isSwitchBackPath } = await loadAt(`https://${EHR}/provider`)
    for (const value of [null, undefined, 1, ['/provider'], { toString: () => '/provider' }]) expect(isSwitchBackPath(value)).toBe(false)
  })
})

describe('switchHref, off (VITE_HID_SSO unset or anything but "1")', () => {
  it.each([undefined, '', '0', 'true', 'yes', ' 1', '1 '])('is today’s siteHref exactly with VITE_HID_SSO=%j', async value => {
    if (value !== undefined) vi.stubEnv('VITE_HID_SSO', value)
    const { switchHref } = await loadAt(`https://${EHR}/provider/patients`)
    for (const to of [LAB, PHARMACY, 'migrate.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com']) {
      expect(switchHref(site(to), EHR, '/provider/patients')).toBe(siteHref(site(to)))
      expect(switchHref(site(to), EHR, '/provider/patients')).toBe(`https://${to}/`)
    }
  })
})

describe('switchHref, on (VITE_HID_SSO=1)', () => {
  it('opens the other site’s workspace with from= this site and back= this page, and nothing else', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { switchHref } = await loadAt(`https://${EHR}/provider/patients`)
    const href = switchHref(site(LAB), EHR, '/provider/patients')
    expect(href).toBe('https://lab.healthidentitydirectory.com/provider?from=ehr&back=%2Fprovider%2Fpatients')
    expect([...new URL(href).searchParams.keys()]).toEqual(['from', 'back'])
  })

  it.each(BAD_BACK_PATHS)('leaves back out when the page %j fails the check', async path => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { switchHref } = await loadAt(`https://${EHR}/provider`)
    expect(switchHref(site(LAB), EHR, path)).toBe('https://lab.healthidentitydirectory.com/provider?from=ehr')
  })

  it('leaves back out when this site does not serve the page (it would only send the person on)', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { switchHref } = await loadAt(`https://${LAB}/provider/laboratory`)
    expect(switchHref(site(EHR), LAB, '/provider/patients')).toBe('https://ehr.healthidentitydirectory.com/provider?from=lab')
    expect(switchHref(site(EHR), LAB, '/provider/laboratory/work'))
      .toBe('https://ehr.healthidentitydirectory.com/provider?from=lab&back=%2Fprovider%2Flaboratory%2Fwork')
  })

  it('takes the other site’s hostname from the fixed table, never from the Site it is given', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { switchHref } = await loadAt(`https://${EHR}/provider`)
    const forged: Site = { key: 'lab', deployment: 'production', hostname: 'lab.evil.example' }
    expect(new URL(switchHref(forged, EHR, '/provider')).hostname).toBe(LAB)
  })

  it('stays within the deployment: staging links to staging', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { switchHref } = await loadAt('https://ehr.staging.healthidentitydirectory.com/provider')
    expect(switchHref(site('lab.healthidentitydirectory.com'), 'ehr.staging.healthidentitydirectory.com', '/provider/patients'))
      .toBe('https://lab.staging.healthidentitydirectory.com/provider?from=ehr&back=%2Fprovider%2Fpatients')
  })

  it('is today’s siteHref from a host that is not a staff site, to the main site, and to this site itself', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { switchHref } = await loadAt(`https://${EHR}/provider`)
    for (const from of ['localhost', 'admin.healthidentitydirectory.com', 'app.healthidentitydirectory.com', 'evil.example']) {
      expect(switchHref(site(LAB), from, '/provider')).toBe(`https://${LAB}/`)
    }
    expect(switchHref(site('app.healthidentitydirectory.com'), EHR, '/provider')).toBe('https://app.healthidentitydirectory.com/')
    expect(switchHref(site(EHR), EHR, '/provider')).toBe(`https://${EHR}/`)
  })
})

describe('takeSwitchArrival, off', () => {
  it('reads nothing and leaves the address exactly as it was', async () => {
    const { takeSwitchArrival, switchArrival } = await loadAt(`https://${LAB}/provider?from=ehr&back=%2Fprovider%2Fpatients#top`)
    const replace = vi.spyOn(window.history, 'replaceState')
    expect(takeSwitchArrival()).toBeNull()
    expect(switchArrival()).toBeNull()
    expect(address()).toBe('/provider?from=ehr&back=%2Fprovider%2Fpatients#top')
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('takeSwitchArrival, on', () => {
  it('takes from and back out of the address, keeping the rest of it and the history entry’s state', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival, switchArrival } = await loadAt(
      `https://${LAB}/provider/laboratory?view=day&from=ehr&q=a+b%20c&back=%2Fprovider%2Fpatients#top`)
    window.history.replaceState({ usr: null, key: 'router-key', idx: 0 }, '')
    const arrival = takeSwitchArrival()
    expect(arrival).toEqual({ from: 'ehr', name: 'Hospital EHR', path: '/provider/patients', href: 'https://ehr.healthidentitydirectory.com/provider/patients' })
    expect(switchArrival()).toBe(arrival)
    expect(address()).toBe('/provider/laboratory?view=day&q=a+b%20c#top')
    expect(window.history.state).toEqual({ usr: null, key: 'router-key', idx: 0 })
  })

  it('takes them out however their names are written', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival } = await loadAt(`https://${LAB}/provider?%66rom=ehr&b%61ck=%2Fprovider%2Fpatients`)
    expect(takeSwitchArrival()?.href).toBe('https://ehr.healthidentitydirectory.com/provider/patients')
    expect(address()).toBe('/provider')
  })

  it('reads once: later addresses are never read, and the first arrival stays', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival, switchArrival } = await loadAt(`https://${LAB}/provider?from=ehr`)
    const first = takeSwitchArrival()
    window.history.pushState(null, '', '/provider/laboratory?from=pharmacy&back=%2Fprovider%2Fpharmacy')
    const replace = vi.spyOn(window.history, 'replaceState')
    expect(takeSwitchArrival()).toBe(first)
    expect(switchArrival()?.from).toBe('ehr')
    expect(address()).toBe('/provider/laboratory?from=pharmacy&back=%2Fprovider%2Fpharmacy')
    expect(replace).not.toHaveBeenCalled()
  })

  it('reads once even when the first load carried nothing', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival } = await loadAt(`https://${LAB}/provider`)
    expect(takeSwitchArrival()).toBeNull()
    window.history.pushState(null, '', '/provider?from=ehr')
    expect(takeSwitchArrival()).toBeNull()
    expect(address()).toBe('/provider?from=ehr')
  })

  it('leaves an address without from or back as it is', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival } = await loadAt(`https://${LAB}/provider/laboratory?work=item-1`)
    const replace = vi.spyOn(window.history, 'replaceState')
    expect(takeSwitchArrival()).toBeNull()
    expect(address()).toBe('/provider/laboratory?work=item-1')
    expect(replace).not.toHaveBeenCalled()
  })

  it.each(BAD_BACK_PATHS)('comes back to the other site’s workspace, never to %j', async path => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival } = await loadAt(`https://${LAB}/provider?from=ehr&back=${encodeURIComponent(path)}`)
    expect(takeSwitchArrival()).toEqual({ from: 'ehr', name: 'Hospital EHR', path: '/provider', href: 'https://ehr.healthidentitydirectory.com/provider' })
    expect(address()).toBe('/provider')
  })

  it('comes back to the other site’s workspace when that site does not serve the page', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    // Patients is the Hospital EHR's page: the laboratory site would only send the person on.
    const { takeSwitchArrival } = await loadAt(`https://${PHARMACY}/provider?from=lab&back=%2Fprovider%2Fpatients`)
    expect(takeSwitchArrival()?.href).toBe('https://lab.healthidentitydirectory.com/provider')
  })

  it.each(['web', 'admin', 'auth', 'EHR', 'ehr ', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'evil.example',
    'https://evil.example'])('offers no way back from=%j, and still takes it out of the address', async from => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival, switchArrival } = await loadAt(`https://${LAB}/provider?from=${encodeURIComponent(from)}&back=%2Fprovider`)
    expect(takeSwitchArrival()).toBeNull()
    expect(switchArrival()).toBeNull()
    expect(address()).toBe('/provider')
  })

  it('offers no way back to the site it is on', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival } = await loadAt(`https://${LAB}/provider?from=lab&back=%2Fprovider%2Flaboratory`)
    expect(takeSwitchArrival()).toBeNull()
    expect(address()).toBe('/provider')
  })

  it.each([
    'from=ehr&from=pharmacy', 'from=ehr&back=%2Fprovider&back=%2Fprovider%2Fpatients', 'back=%2Fprovider%2Fpatients',
  ])('offers no way back for a link no site writes (%s)', async query => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival } = await loadAt(`https://${LAB}/provider?${query}`)
    expect(takeSwitchArrival()).toBeNull()
    expect(address()).toBe('/provider')
  })

  it('comes back within the deployment: staging to staging', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const { takeSwitchArrival } = await loadAt('https://lab.staging.healthidentitydirectory.com/provider?from=ehr&back=%2Fprovider%2Fpatients')
    expect(takeSwitchArrival()?.href).toBe('https://ehr.staging.healthidentitydirectory.com/provider/patients')
  })

  it.each(['app.healthidentitydirectory.com', 'admin.healthidentitydirectory.com', 'localhost'])(
    'reads nothing on %s, which takes no part in switching', async hostname => {
      vi.stubEnv('VITE_HID_SSO', '1')
      const { takeSwitchArrival } = await loadAt(`https://${hostname}/provider?from=ehr&back=%2Fprovider%2Fpatients`)
      expect(takeSwitchArrival()).toBeNull()
      expect(address()).toBe('/provider?from=ehr&back=%2Fprovider%2Fpatients')
    })
})

describe('switchArrivalQuery', () => {
  it('is empty without an arrival, and carries only from and back with one', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    let loaded = await loadAt(`https://${LAB}/provider`)
    loaded.takeSwitchArrival()
    expect(loaded.switchArrivalQuery()).toBe('')
    loaded = await loadAt(`https://${LAB}/provider?from=ehr&back=%2Fprovider%2Fpatients&view=day`)
    loaded.takeSwitchArrival()
    expect(loaded.switchArrivalQuery()).toBe('from=ehr&back=%2Fprovider%2Fpatients')
    loaded = await loadAt(`https://${LAB}/provider?from=ehr&back=%2F%2Fevil.example`)
    loaded.takeSwitchArrival()
    expect(loaded.switchArrivalQuery()).toBe('from=ehr')
  })
})

describe('main.tsx', () => {
  it('reads the switch before the router reads the address', () => {
    const main = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'main.tsx'), 'utf8')
    const taken = main.indexOf('\ntakeSwitchArrival()')
    expect(taken).toBeGreaterThan(-1)
    expect(taken).toBeLessThan(main.indexOf('createRoot('))
  })
})
