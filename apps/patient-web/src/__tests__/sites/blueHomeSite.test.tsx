import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { servedHere } from '../../productSites'
import { DEMO_HOSPITAL, DEMO_LABORATORY, homeHeading } from '../ehr-blue/frame/blueHarness'
import { backToTestSite, EVERY_PERMISSION, OUTREACH_DEMO, PHARMACY_DEMO, openBlueOn } from './siteHarness'

/**
 * The blue Home on each staff site. A product site never shows Home: the redesign's frame opens the product's own page
 * in its place (frame/product.ts), so none of Home's cards can link to a page another site serves. ehr. shows Home,
 * and every link on it is a page ehr. serves. Every facility here is fictional.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const EHR = 'ehr.healthidentitydirectory.com'

describe('the blue Home on each staff site', () => {
  it.each([
    ['lab.healthidentitydirectory.com', DEMO_LABORATORY, 'Demo Laboratory', '/provider/laboratory'],
    ['lab.staging.healthidentitydirectory.com', DEMO_LABORATORY, 'Demo Laboratory', '/provider/laboratory'],
    ['pharmacy.healthidentitydirectory.com', PHARMACY_DEMO, 'Demo Pharmacy', '/provider/pharmacy'],
    ['outreach.healthidentitydirectory.com', OUTREACH_DEMO, 'Demo Outreach', '/provider/outreach'],
  ])('%s opens its own product in place of Home', async (host, id, name, own) => {
    await openBlueOn(host, { id, name }, EVERY_PERMISSION, [], '/provider')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(own))
    expect(screen.queryByRole('heading', { name: homeHeading() })).toBeNull()
    // The product's page is this site's own: nothing opens another site.
    expect(servedHere(own, host)).toBe(true)
    expect(opened).not.toHaveBeenCalled()
  })

  it(`${EHR} shows Home, and every link on it is a page ${EHR} serves`, async () => {
    await openBlueOn(EHR, { id: DEMO_HOSPITAL, name: 'Demo Hospital' }, EVERY_PERMISSION, [], '/provider')
    expect(await screen.findByRole('heading', { name: homeHeading() })).toBeTruthy()
    const main = document.getElementById('main-content')!
    const links = [...main.querySelectorAll('a[href^="/provider"]')].map(link => link.getAttribute('href')!.split(/[?#]/)[0]!)
    // The work Home links to: Patients, Consult, Access requests, the hospital's own laboratory and pharmacy, and so on.
    expect(links).toEqual(expect.arrayContaining(['/provider/patients', '/provider/laboratory', '/provider/pharmacy']))
    expect(links.filter(href => !servedHere(href, EHR))).toEqual([])
    expect(opened).not.toHaveBeenCalled()
  })
})
