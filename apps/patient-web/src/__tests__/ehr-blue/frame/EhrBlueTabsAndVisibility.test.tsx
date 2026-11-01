import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { parse } from '../../cssRules'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'
import { DEMO_HOSPITAL, REQUESTS, SESSION, accountButton, facility, homeHeading, json, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'

/**
 * The frame's page options and its safety net: tabs that group pages as the design does (tabOf), pages a session does
 * not see (visible), and a page that fails to render, which leaves the frame and the way back to Home.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

async function openDemo(path: string) {
  // A facility administrator who is also a clinician: the design opens its clinical, finance and administration
  // samples to a Hospital Admin and a Doctor between them.
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], ['org_admin', 'clinician'])
  serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([]), () => json([])] })
  await openStaffApp(path)
  return screen.findByRole('navigation', { name: 'Main navigation' })
}

describe('tabs (tabOf)', () => {
  it('draws a workspace\'s tabs above its heading, under one sidebar entry, as the design does', async () => {
    const nav = await openDemo('/provider/policies')
    const tabs = screen.getByRole('navigation', { name: 'Insurance & Claims' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Policies' })
    expect(tabs.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['Claims', 'Policies'])
    expect(within(tabs).getByRole('link', { name: 'Policies' }).getAttribute('aria-current')).toBe('page')
    // The tab has no sidebar entry; nor has the sample workspace it joins (only working screens are listed).
    expect(within(nav).queryByRole('link', { name: 'Policies' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Insurance & Claims' })).toBeNull()

    fireEvent.click(within(tabs).getByRole('link', { name: 'Claims' }))
    await waitFor(() => expect(where()).toBe('/provider/insurance'))
    expect(screen.getByRole('heading', { level: 1, name: 'Insurance & Claims' })).toBeDefined()
    expect(within(screen.getByRole('navigation', { name: 'Insurance & Claims' })).getByRole('link', { name: 'Claims' })
      .getAttribute('aria-current')).toBe('page')
  })

  it('shows Supply with Stock and Procurement as its tabs, and neither in the sidebar (samples are not listed)', async () => {
    const nav = await openDemo('/provider/supply')
    expect(within(nav).queryByRole('link', { name: 'Supply' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Procurement' })).toBeNull()
    expect(within(nav).queryByRole('button', { name: 'Supply' })).toBeNull()
    const tabs = screen.getByRole('navigation', { name: 'Supply' })
    expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['Stock', 'Procurement'])
    expect(screen.getByRole('heading', { level: 1, name: 'Stock' })).toBeDefined()
  })

  it('draws no tabs on a page without them', async () => {
    await openDemo('/provider/radiology')
    expect(screen.getByRole('heading', { level: 1, name: 'Radiology' })).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Radiology' })).toBeNull()
  })
})

describe('visible()', () => {
  // A live page: sample pages are never listed now, so a live one shows what visible() does to the sidebar.
  const page = (visible: EhrBluePage['visible']): EhrBluePage =>
    ({ path: 'self-signed', group: 'People', label: 'Self-signed setup', status: 'live', element: <p>Self-signed setup page</p>, visible })

  it('keeps a page it turns down out of the sidebar and search, and refuses its address', async () => {
    withFramePages(() => [page(session => session.actor.facility?.name === 'Riverside Teaching Hospital (fictional)')])
    const nav = await openDemo('/provider/self-signed')
    expect(within(nav).queryByRole('link', { name: 'Self-signed setup' })).toBeNull()
    expect(screen.getByText('Self-signed setup is part of the Health ID demo only')).toBeDefined()
    expect(screen.queryByText('Self-signed setup page')).toBeNull()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const search = await screen.findByRole('dialog', { name: 'Search' })
    fireEvent.change(within(search).getByRole('searchbox', { name: 'Health ID or page' }), { target: { value: 'Self-signed' } })
    expect(within(search).queryByRole('link', { name: /Self-signed setup/ })).toBeNull()
  })

  it('shows the page where it says yes', async () => {
    withFramePages(() => [page(session => session.actor.facility?.name === 'Demo Hospital')])
    const nav = await openDemo('/provider/self-signed')
    expect(within(nav).getByRole('link', { name: 'Self-signed setup' })).toBeDefined()
    expect(screen.getByText('Self-signed setup page')).toBeDefined()
  })
})

describe('a page that fails to render', () => {
  function Broken(): never {
    throw new Error('A fictional failure, with nothing to show')
  }

  beforeEach(() => {
    // React reports the caught error on the console; the test expects it.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    withFramePages(() => [{ path: 'broken', group: 'Insight', label: 'Broken page', status: 'sample', element: <Broken /> }])
  })

  it('says so inside the frame, keeps the sidebar and account menu, and shows nothing of the failure', async () => {
    const nav = await openDemo('/provider/broken')
    const alert = screen.getByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeDefined()
    expect(within(alert).getByText('This page could not be shown. Reload it to try again, or go back to Home.')).toBeDefined()
    expect(document.body.textContent).not.toContain('fictional failure')
    expect(document.activeElement).toBe(within(alert).getByRole('heading', { level: 1 }))
    expect(accountButton()).toBeDefined()
    // Another page tries again.
    act(() => { fireEvent.click(within(nav).getByRole('link', { name: 'Home' })) })
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The classic EHR was removed: the message offers Reload and Home instead.
  it('offers Reload and Home from the message itself, and no classic EHR', async () => {
    await openDemo('/provider/broken')
    const alert = screen.getByRole('alert')
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeDefined()
    expect(within(alert).getByRole('button', { name: 'Go to Home' })).toBeDefined()
    expect(within(alert).queryByRole('button', { name: 'Use the classic EHR' })).toBeNull()
    expect(where()).toBe('/provider/broken')
  })
})

describe('frame.css', () => {
  it('lets a long action in a card wrap, so a tour\'s "Start: …" never widens a phone screen', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(resolve(here, '../../../ehr-blue/frame/frame.css'), 'utf8')
    const rule = parse(css).find(candidate => candidate.selectors.includes('.hid-ehr .hid-ehr-blue-facility-card .hid-ehr-button'))
    expect(rule?.body).toMatch(/white-space:\s*normal/)
    expect(rule?.body).toMatch(/max-width:\s*100%/)
  })

  it('spaces the tabs from the heading by the page\'s own gap, as the design does', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(resolve(here, '../../../ehr-blue/frame/frame.css'), 'utf8')
    const rule = parse(css).find(candidate => candidate.selectors.includes('.hid-ehr .hid-ehr-blue-page > .hid-ehr-module-tabs'))
    expect(rule?.body).toMatch(/margin-bottom:\s*0/)
  })
})
