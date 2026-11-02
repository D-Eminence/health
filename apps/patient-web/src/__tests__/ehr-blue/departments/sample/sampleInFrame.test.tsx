import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../../frame/blueHarness'

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

// Written out, not imported from sampleHarness: that loads the pages, and through their design role check the staff
// session client, before fetch is served, and the client keeps the fetch it finds.
const SAMPLE_TEXT = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

/**
 * Opens the frame at the demo facility for a member with these Health ID roles: a facility administrator unless said
 * otherwise, whom the design (as a Hospital Admin) lets open its finance and administration samples.
 */
async function openDemo(path: string, roles: readonly string[] = ['org_admin']) {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], roles)
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
  // The frame lists no sample workspace in the sidebar (BlueFrame: only live work is listed); they open by address,
  // and their tabs are drawn as before.
  it('draws Claims | Policies once, above the heading, with no sidebar entry for either', async () => {
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
    expect(within(nav).queryByRole('link', { name: 'Insurance & Claims' })).toBeNull()

    fireEvent.click(within(tabs).getByRole('link', { name: 'Claims' }))
    await waitFor(() => expect(where()).toBe('/provider/insurance'))
    expect(heading().textContent).toBe('Insurance & Claims')
    expect(screen.getByRole('button', { name: '2a6f15aa' })).toBeDefined()
  })

  it('keeps Claims | Policies on every view, and the page\'s own tab goes back to its list', async () => {
    // A billing officer: the design lets a Billing Officer create claims (a Hospital Admin may only view them).
    await openDemo('/provider/insurance', ['billing'])
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
    fireEvent.click(within(tabs()).getByRole('link', { name: 'Claims' }))
    expect(heading().textContent).toBe('Insurance & Claims')
    expect(document.activeElement).toBe(heading())
    expectNoticeUnderHeading()
    expect(where()).toBe('/provider/insurance')
  })

  it('shows Supply with Stock and Procurement as its tabs, and none of them in the sidebar', async () => {
    const nav = await openDemo('/provider/supply')
    expect(within(nav).queryByRole('link', { name: 'Supply' })).toBeNull()
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
    expect(within(nav).queryByRole('link', { name: 'Supply' })).toBeNull()
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

describe('the viewer\'s design role, through the frame\'s own check', () => {
  const card = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('section')!
  const actionsOf = () => within(card('Available actions')).queryAllByRole('button').map(button => button.textContent)
  const NONE = 'No further actions for your permission and this record state.'

  it('shows a billing officer no action on DEMO-1, as the design\'s Billing Officer sees it, and the invoice actions on a draft', async () => {
    await openDemo('/provider/patient-billing', ['billing'])
    expect(screen.getByRole('button', { name: 'Create record' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'DEMO-1' }))
    expect(heading().textContent).toBe('DEMO-1')
    // Payments and refunds are a cashier's and the owner's: the design's billing-3-detail1.
    expect(actionsOf()).toEqual([])
    expect(within(card('Available actions')).getByText(NONE)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'DEMO-3' }))
    expect(actionsOf()).toEqual(['Issue invoice', 'Void invoice'])
    expect(within(card('Available actions')).queryByText(NONE)).toBeNull()
  })

  it('lets a facility administrator only look at patient billing: no Create record, no actions', async () => {
    await openDemo('/provider/patient-billing')
    expect(heading().textContent).toBe('Patient billing')
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'DEMO-3' }))
    expect(actionsOf()).toEqual([])
    expect(within(card('Available actions')).getByText(NONE)).toBeDefined()
  })

  it('lets a facility administrator create and act in an administration sample', async () => {
    await openDemo('/provider/quality')
    expect(screen.getByRole('button', { name: 'Create record' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Near-miss labelling (fictional)' }))
    expect(actionsOf()).toEqual(['Assign reviewer'])
  })
})
