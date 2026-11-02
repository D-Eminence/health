import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { servedHere } from '../../productSites'
import { DEMO_LABORATORY } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, bluePages, blueProduct, classicPages, EVERY_CLASSIC_PAGE, EVERY_PERMISSION, openBlueOn, openClassicOn, openPortalOn,
  siteLinks,
} from './siteHarness'

/**
 * A host that is not a Health ID site (local, preview), and the admin site: every address is served there, as before
 * each product had its own site, so development, previews and the admin site keep working.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const PATHS = ['/', '/records', '/sign-in', '/provider', '/provider/sign-in', '/provider/patients', '/provider/laboratory',
  '/provider/pharmacy', '/provider/ocr', '/provider/outreach', '/provider/appointments/5a020001', '/provider/join', '/admin/overview']

describe.each(['localhost', '127.0.0.1', 'preview.example.test', 'admin.healthidentitydirectory.com',
  'admin.staging.healthidentitydirectory.com', 'www.healthidentitydirectory.com'])('%s', hostname => {
  it.each(PATHS)('serves %s', path => {
    expect(servedHere(path, hostname)).toBe(true)
  })
})

describe('localhost', () => {
  it('opens every staff page here, behind this sign-in', async () => {
    await openPortalOn('localhost', '/provider/pharmacy')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in')
    expect(opened).not.toHaveBeenCalled()
  })

  it('lists every page in today’s sidebar, and no other site', async () => {
    const sidebar = await openClassicOn('localhost')
    expect(classicPages(sidebar)).toEqual(EVERY_CLASSIC_PAGE)
    expect(siteLinks(sidebar)).toEqual([])
  })

  it('opens the blue EHR at any demo facility, as the Hospital EHR, with every page', async () => {
    const nav = await openBlueOn('localhost', { id: DEMO_LABORATORY, name: 'Demo Laboratory' }, EVERY_PERMISSION)
    expect(blueProduct()).toBe('EHR')
    expect(bluePages(nav)).toEqual(expect.arrayContaining(['Home', 'Patients']))
    expect(siteLinks(nav)).toEqual([])
    expect(screen.queryByRole('heading', { name: /works on/ })).toBeNull()
  })
})
