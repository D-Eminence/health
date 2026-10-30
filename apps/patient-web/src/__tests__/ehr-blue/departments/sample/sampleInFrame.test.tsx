import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../../frame/blueHarness'
import { SAMPLE_TEXT } from './sampleHarness'

/*
 * The sample workspaces inside the blue EHR's frame, in place of its stand-ins for them: the frame draws their tabs
 * from tabOf and tabLabel, and the addresses Home's dashboards and the Notifications drawer link to
 * (/provider/insurance/<id>) open the page's list at its base. Every account, facility and record is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The frame's own registry and Home, with the sample pages joining it as departments/pages.ts does. Registered per
// test: a vi.mock factory's module outlives vi.resetModules.
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { samplePages } = await import('../../../../ehr-blue/departments/sample/pages')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: samplePages } }),
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

async function openDemo(path: string) {
  // A facility administrator: the design opens its finance and administration samples to a Hospital Admin.
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], ['org_admin'])
  serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([]), () => json([])] })
  await openStaffApp(path)
  return screen.findByRole('navigation', { name: 'Main navigation' })
}

function heading() {
  return screen.getByRole('heading', { level: 1 })
}

/** The page's own sample notice (not the frame's), right under its heading. */
function expectNoticeUnderHeading() {
  const notice = screen.getByRole('note')
  expect(notice.textContent).toBe(SAMPLE_TEXT)
  expect(heading().closest('.hid-ehr-page-heading')?.nextElementSibling).toBe(notice)
}

/** Each sample page's base and its heading. */
const PAGES = [
  ['patient-billing', 'Patient billing'], ['insurance', 'Insurance & Claims'], ['policies', 'Policies'], ['services', 'Service catalogue'],
  ['supply', 'Stock'], ['procurement', 'Procurement'], ['quality', 'Quality & Safety'], ['shifts', 'Shifts & Roster'],
  ['ambulance', 'Dispatch'], ['vehicles', 'Vehicle configuration'],
] as const

describe('a record link from Home or the Notifications drawer', () => {
  for (const [base, title] of PAGES) {
    it(`opens ${title}'s list at /provider/${base}, not "Page not found"`, async () => {
      await openDemo(`/provider/${base}/5a000001`)
      expect(heading().textContent).toBe(title)
      expect(screen.queryByText('Page not found')).toBeNull()
      expectNoticeUnderHeading()
      expect(screen.getByRole('table')).toBeDefined()
      await waitFor(() => expect(where()).toBe(`/provider/${base}`))
      expect(heading().textContent).toBe(title)
    })
  }
})

describe('the frame\'s tabs', () => {
  it('draws Claims | Policies once, above the heading, with no sidebar entry for Policies', async () => {
    const nav = await openDemo('/provider/policies')
    expect(screen.getAllByRole('navigation', { name: 'Insurance & Claims' })).toHaveLength(1)
    const tabs = screen.getByRole('navigation', { name: 'Insurance & Claims' })
    expect(within(tabs).getAllByRole('link').map(link => link.textContent)).toEqual(['Claims', 'Policies'])
    expect(within(tabs).getByRole('link', { name: 'Policies' }).getAttribute('aria-current')).toBe('page')
    expect(tabs.compareDocumentPosition(heading()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(heading().textContent).toBe('Policies')
    expectNoticeUnderHeading()
    expect(screen.getByRole('button', { name: 'POL-DEMO' })).toBeDefined()
    expect(within(nav).queryByRole('link', { name: 'Policies' })).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Insurance & Claims' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(within(tabs).getByRole('link', { name: 'Claims' }))
    await waitFor(() => expect(where()).toBe('/provider/insurance'))
    expect(heading().textContent).toBe('Insurance & Claims')
    expect(screen.getByRole('button', { name: '2a6f15aa' })).toBeDefined()
  })

  it('keeps Claims | Policies on every view, and the page\'s own tab or sidebar entry goes back to its list', async () => {
    const nav = await openDemo('/provider/insurance')
    const tabs = () => screen.getByRole('navigation', { name: 'Insurance & Claims' })
    fireEvent.click(screen.getByRole('button', { name: '2a6f15aa' }))
    expect(heading().textContent).toBe('2a6f15aa')
    expect(within(tabs()).getAllByRole('link').map(link => link.textContent)).toEqual(['Claims', 'Policies'])
    expect(within(tabs()).getByRole('link', { name: 'Claims' }).getAttribute('aria-current')).toBe('page')

    // The address does not change, so the frame keeps the page: the page itself goes back to its list.
    fireEvent.click(within(tabs()).getByRole('link', { name: 'Claims' }))
    expect(heading().textContent).toBe('Insurance & Claims')
    expect(document.activeElement).toBe(heading())
    expect(screen.getByRole('button', { name: '2a6f15aa' })).toBeDefined()
    expect(where()).toBe('/provider/insurance')

    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(heading().textContent).toBe('New insurance & claims')
    expect(within(tabs()).getAllByRole('link').map(link => link.textContent)).toEqual(['Claims', 'Policies'])
    fireEvent.click(within(nav).getByRole('link', { name: 'Insurance & Claims' }))
    expect(heading().textContent).toBe('Insurance & Claims')
    expect(document.activeElement).toBe(heading())
    expectNoticeUnderHeading()
    expect(where()).toBe('/provider/insurance')
  })

  it('shows Supply in the sidebar, with Stock and Procurement as its tabs', async () => {
    const nav = await openDemo('/provider/supply')
    expect(within(nav).getByRole('link', { name: 'Supply' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).queryByRole('link', { name: 'Procurement' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Stock' })).toBeNull()
    expect(screen.getAllByRole('navigation', { name: 'Supply' })).toHaveLength(1)
    const tabs = screen.getByRole('navigation', { name: 'Supply' })
    expect(within(tabs).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')]))
      .toEqual([['Stock', '/provider/supply'], ['Procurement', '/provider/procurement']])
    expect(within(tabs).getAllByRole('link').map(link => link.getAttribute('aria-current'))).toEqual(['page', null])
    expect(heading().textContent).toBe('Stock')
    expectNoticeUnderHeading()
    expect(screen.getByRole('button', { name: 'Fictional Med A' })).toBeDefined()

    fireEvent.click(within(tabs).getByRole('link', { name: 'Procurement' }))
    await waitFor(() => expect(where()).toBe('/provider/procurement'))
    expect(heading().textContent).toBe('Procurement')
    expect(screen.getByRole('button', { name: 'Stock request' })).toBeDefined()
    const after = screen.getByRole('navigation', { name: 'Supply' })
    expect(within(after).getAllByRole('link').map(link => link.getAttribute('aria-current'))).toEqual([null, 'page'])
    expect(within(nav).getByRole('link', { name: 'Supply' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('connected hospital history', () => {
  it('links each connected record\'s page under /provider and opens it', async () => {
    await openDemo('/provider/patient-billing')
    fireEvent.click(screen.getByRole('button', { name: 'DEMO-1' }))
    expect(heading().textContent).toBe('DEMO-1')
    const history = screen.getByRole('heading', { name: 'Connected hospital history' }).closest('section')!
    expect(within(history).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Insurance & Claims · 9d41c7b3', '/provider/insurance'],
      ['Policies · POL-DEMO-2', '/provider/policies'],
    ])
    fireEvent.click(within(history).getByRole('link', { name: 'Policies · POL-DEMO-2' }))
    await waitFor(() => expect(where()).toBe('/provider/policies'))
    expect(heading().textContent).toBe('Policies')
  })
})
