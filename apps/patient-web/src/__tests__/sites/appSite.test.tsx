import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { rightSiteHref, servedHere } from '../../productSites'
import { backToTestSite, onSite, openPortalOn } from './siteHarness'

/**
 * app. (staging. on staging): the patient portal, for patients only (owner, 2026-11-02). Its staff addresses follow the
 * portal's own rule (staffSignIn.tsx, #114 and #115), which sends them to the EHR site. This branch's table of sites
 * adds no staff page to app. and sends none of its addresses anywhere itself. Every account here is fictional.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
const replace = vi.fn()
beforeEach(() => { opened.mockClear(); replace.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const APP = 'app.healthidentitydirectory.com'
const STAGING = 'staging.healthidentitydirectory.com'

/** The portal at `path` on app., with the browser's own replace of the page stood in for (staffSignIn.tsx calls it). */
async function openOnApp(path: string) {
  onSite(APP, path)
  vi.stubGlobal('location', { ...window.location, replace })
  await openPortalOn(APP, path)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
}

describe(APP, () => {
  it.each(['/', '/records', '/profile', '/access/share', '/notifications', '/sign-in', '/enroll', '/recover', '/admin/overview'])(
    'serves the patient portal’s %s', path => {
      expect(servedHere(path, APP)).toBe(true)
      expect(servedHere(path, STAGING)).toBe(true)
    })

  it.each([
    ['/provider', '', ''],
    ['/provider/sign-in', '?returnTo=%2Fprovider%2Frequests', ''],
    ['/provider/requests', '?status=pending', ''],
    ['/provider/laboratory', '', ''],
    ['/provider/recover', '', ''],
    ['/provider/staff/join', '', '#invitation-1.fictional-token'],
  ])('sends none of its staff addresses, %s%s, to another site itself', (pathname, search, hash) => {
    expect(rightSiteHref({ pathname, search, hash }, APP)).toBeNull()
    expect(rightSiteHref({ pathname, search, hash }, STAGING)).toBeNull()
  })

  // The portal's own rule (staffSignIn.tsx) sends them on: today the staff entrance, sign-in and, through it, any
  // workspace page open the EHR sign-in (#114); #115 will open the same page on the EHR site. Either way, this table
  // shows no leaving page of its own and no staff page renders on app.
  it.each(['/provider', '/provider/sign-in', '/provider/requests?status=pending', '/provider/clinical'])(
    'sends %s to the EHR site by the portal’s own rule: no staff page shows here', async path => {
      await openOnApp(path)
      await waitFor(() => expect(replace).toHaveBeenCalled())
      expect(replace.mock.calls.at(-1)?.[0]).toMatch(/^https:\/\/ehr\.healthidentitydirectory\.com\/provider(\/|$)/)
      expect(screen.getByRole('status').textContent).toMatch(/^Opening /)
      expect(screen.queryByText(/Opening it there/)).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
      expect(opened).not.toHaveBeenCalled()
    })
})

describe(STAGING, () => {
  it('leaves staff sign-in to the portal, which keeps staging’s own (#114): this branch sends it nowhere', async () => {
    await openPortalOn(STAGING, '/provider/sign-in')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(opened).not.toHaveBeenCalled()
  })
})
