import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, openStaffApp, serve, sessionAt, where, withFramePages } from '../frame/blueHarness'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'

/**
 * Home's shortcuts follow the same rules as the frame's sidebar, run with test pages on the frame's own registry:
 *  - a page on every product's site (`everyProduct`) is a shortcut wherever this host serves its address, still under its
 *    own `visible`; a page without it stays where its product puts it;
 *  - a page whose `listed` says when it changes (`listedChanges`) leaves Home's shortcuts at once when it stops being
 *    listed, and comes back when it is listed again, with no new session.
 * Every account and facility here is fictional, and the hosts are only set as the page's address: nothing is sent there.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
afterEach(() => {
  jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.doUnmock('../../../ehr-blue/routes'); vi.resetModules()
})

/**
 * A lab's administrator who manages staff: no clinical permission and no product's own page to open, so /provider stays
 * on Home on every host, and the EHR's address takes the facility for a lab.
 */
const MANAGER = ['lab.walk-in.create', 'workforce.manage']
const manages = (permissions: readonly string[] | undefined) => permissions?.includes('workforce.manage') === true

/** A small store a page's `listed` reads, as a page learns from the backend whether its read is served. */
function servedStore(initial: boolean) {
  let served = initial
  const listeners = new Set<() => void>()
  return {
    get: () => served,
    set(value: boolean) { served = value; for (const listener of listeners) listener() },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

function everyProductPage(extra: Partial<EhrBluePage> = {}): EhrBluePage {
  return { path: 'figures', group: 'Network & Services', label: 'Reading figures', status: 'partial',
    element: <h1>Reading figures</h1>, everyProduct: true,
    visible: session => manages(session.actor.facility?.permissions), ...extra }
}

const EHR_ONLY: EhrBluePage = { path: 'ward-figures', group: 'Network & Services', label: 'Ward figures', status: 'partial',
  element: <h1>Ward figures</h1> }

async function openHomeAt(host: string | null, permissions: readonly string[] = MANAGER) {
  if (host) jsdom.reconfigure({ url: `https://${host}/provider` })
  const clinic = facility(REAL_FACILITY, 'Riverside Laboratory (fictional)', permissions, ['org_admin'])
  const sent = serve({ [SESSION]: [sessionAt(clinic, [clinic])] })
  await openStaffApp('/provider')
  await screen.findByRole('navigation', { name: 'Main navigation' })
  await waitFor(() => expect(where()).toBe('/provider'))
  return sent
}

/** Opens Edit shortcuts and returns its drawer. */
async function editShortcuts() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  return screen.findByRole('dialog', { name: 'Edit shortcuts' })
}

/** Picks a shortcut and closes the drawer. */
async function pick(label: string) {
  const drawer = await editShortcuts()
  fireEvent.click(within(drawer).getByRole('checkbox', { name: label }))
  fireEvent.click(within(drawer).getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit shortcuts' })).toBeNull())
}

const shortcutsSection = () => screen.getByRole('heading', { name: 'Shortcuts' }).closest('section') as HTMLElement
const shortcutLink = (name: string) => within(shortcutsSection()).queryByRole('link', { name: new RegExp(name) })

const HOSTS = [
  ['ehr.healthidentitydirectory.com'],
  ['lab.healthidentitydirectory.com'],
  ['pharmacy.healthidentitydirectory.com'],
  ['outreach.healthidentitydirectory.com'],
  ['migrate.healthidentitydirectory.com'],
  // No product's host: the frame takes the facility for a lab from its permissions.
  [null],
] as const

describe('Home\'s shortcuts, for a page on every product\'s site', () => {
  it.each(HOSTS)('on %s, offer the page and lead to its address', async host => {
    withFramePages(() => [everyProductPage(), EHR_ONLY])
    await openHomeAt(host)
    await pick('Reading figures')
    expect(shortcutLink('Reading figures')?.getAttribute('href')).toBe('/provider/figures')
  })

  it.each(HOSTS)('on %s, leave the page out where its own visible() turns it down', async host => {
    withFramePages(() => [everyProductPage(), EHR_ONLY])
    await openHomeAt(host, ['lab.walk-in.create'])
    const drawer = await editShortcuts()
    expect(within(drawer).queryByRole('checkbox', { name: 'Reading figures' })).toBeNull()
  })
})

describe('Home\'s shortcuts, for a page without everyProduct', () => {
  it('on a lab\'s site, do not offer an EHR page, as before', async () => {
    withFramePages(() => [everyProductPage(), EHR_ONLY])
    await openHomeAt('lab.healthidentitydirectory.com')
    const drawer = await editShortcuts()
    expect(within(drawer).queryByRole('checkbox', { name: 'Ward figures' })).toBeNull()
    expect(within(drawer).getByRole('checkbox', { name: 'Reading figures' })).toBeDefined()
  })

  it('on the EHR\'s site, offer it, as before', async () => {
    withFramePages(() => [EHR_ONLY])
    await openHomeAt('ehr.healthidentitydirectory.com', ['identity.patient.read', 'workforce.manage'])
    const drawer = await editShortcuts()
    expect(within(drawer).getByRole('checkbox', { name: 'Ward figures' })).toBeDefined()
  })
})

describe('Home\'s shortcuts, for a page whose listed() says when it changes', () => {
  it.each([['ehr.healthidentitydirectory.com'], ['lab.healthidentitydirectory.com']])('on %s, drop the shortcut when listed() turns false, and bring it back when it turns true, with no new session', async host => {
    const store = servedStore(true)
    withFramePages(() => [everyProductPage({ listed: () => store.get(), listedChanges: store.subscribe })])
    const sent = await openHomeAt(host)
    await pick('Reading figures')
    expect(shortcutLink('Reading figures')).not.toBeNull()

    act(() => store.set(false))
    await waitFor(() => expect(shortcutLink('Reading figures')).toBeNull())
    const drawer = await editShortcuts()
    expect(within(drawer).queryByRole('checkbox', { name: 'Reading figures' })).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit shortcuts' })).toBeNull())

    // The person's choice is kept in memory: the shortcut comes back with the page.
    act(() => store.set(true))
    await waitFor(() => expect(shortcutLink('Reading figures')).not.toBeNull())
    expect(sent.filter(call => call.route === SESSION)).toHaveLength(1)
  })
})
