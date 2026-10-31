import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { rightSiteHref, servedHere } from '../../productSites'
import { backToTestSite, expectOpenedElsewhere, openPortalOn } from './siteHarness'

/**
 * app. (staging. on staging): the patient portal only, with the public staff pages Identity accepts only there (staff
 * recovery, facility sign-up, a staff invitation, clinician sign-up). Every other staff page, sign-in included, opens on
 * the hospital EHR's site, which serves them all.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const APP = 'app.healthidentitydirectory.com'
const STAGING = 'staging.healthidentitydirectory.com'

describe(APP, () => {
  it.each(['/', '/records', '/profile', '/access/share', '/notifications', '/sign-in', '/enroll', '/recover', '/provider/recover',
    '/provider/enroll', '/provider/invitation', '/provider/join', '/provider/join/status', '/admin/overview'])('serves %s', path => {
    expect(servedHere(path, APP)).toBe(true)
    expect(servedHere(path, STAGING)).toBe(true)
  })

  it.each([
    ['/provider', '', '', 'https://ehr.healthidentitydirectory.com/provider'],
    ['/provider/sign-in', '?returnTo=%2Fprovider%2Frequests', '', 'https://ehr.healthidentitydirectory.com/provider/sign-in?returnTo=%2Fprovider%2Frequests'],
    ['/provider/patients', '', '', 'https://ehr.healthidentitydirectory.com/provider/patients'],
    ['/provider/laboratory', '', '', 'https://ehr.healthidentitydirectory.com/provider/laboratory'],
    ['/provider/outreach', '', '', 'https://ehr.healthidentitydirectory.com/provider/outreach'],
    ['/provider/staff/join', '', '#invitation-1.fictional-token', 'https://ehr.healthidentitydirectory.com/provider/staff/join#invitation-1.fictional-token'],
  ])('opens %s%s on the hospital EHR’s site', (pathname, search, hash, href) => {
    expect(rightSiteHref({ pathname, search, hash }, APP)).toBe(href)
  })

  it('sends staff sign-in to the hospital EHR’s, in place of this address: no staff sign-in is shown here', async () => {
    await openPortalOn(APP, '/provider/sign-in')
    await expectOpenedElsewhere(opened, 'https://ehr.healthidentitydirectory.com/provider/sign-in')
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
  })

  it('sends the provider workspace there too, with its query', async () => {
    await openPortalOn(APP, '/provider/requests?status=pending')
    await expectOpenedElsewhere(opened, 'https://ehr.healthidentitydirectory.com/provider/requests?status=pending')
  })

  it('opens clinician sign-up here, where Identity accepts its check', async () => {
    await openPortalOn(APP, '/provider/join')
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.queryByText(/Opening it there/)).toBeNull()
    expect(screen.queryByRole('link', { name: /main Health ID site/ })).toBeNull()
    expect(opened).not.toHaveBeenCalled()
  })
})

describe(STAGING, () => {
  it('sends staff sign-in to the staging EHR site', async () => {
    await openPortalOn(STAGING, '/provider/sign-in')
    await expectOpenedElsewhere(opened, 'https://ehr.staging.healthidentitydirectory.com/provider/sign-in')
  })

  it('opens Pharmacy on the staging EHR site, which serves every staff page', () => {
    expect(rightSiteHref({ pathname: '/provider/pharmacy', search: '', hash: '' }, STAGING))
      .toBe('https://ehr.staging.healthidentitydirectory.com/provider/pharmacy')
  })
})
