import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'

/**
 * Two things a page entry can now say to the frame, run with test pages on the frame's own registry:
 *  - `everyProduct`: the page is listed and opens on every staff product's site (EHR, Lab, Pharmacy, Outreach, Migrate),
 *    and on a host that is no product's, wherever the frame guesses the product from the permissions. Its own `visible`
 *    still decides who sees it. A page without it stays where its product puts it.
 *  - `listedChanges`: a page whose `listed` reads something besides the session says when that changed, and the sidebar
 *    leaves it out, or lists it again, at once, with no new session.
 * Every account and facility here is fictional, and the hosts are only set as the page's address: nothing is sent there.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
// vi.resetModules does not drop withFramePages' vi.doMock: the doUnmock keeps the real registry for the next file.
afterEach(() => {
  jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.doUnmock('../../../ehr-blue/routes'); vi.resetModules()
})

/** A self-service facility's administrator: Outreach's permissions and managing staff, no clinical one. */
const MANAGER = ['outreach.registration.read', 'workforce.manage']
const manages = (permissions: readonly string[] | undefined) => permissions?.includes('workforce.manage') === true

/** A small store a page's `listed` reads, as a page learns from the backend whether its read is served. */
function servedStore(initial: boolean) {
  let served = initial
  const listeners = new Set<() => void>()
  return {
    get: () => served,
    set(value: boolean) { served = value; for (const listener of listeners) listener() },
    /** Tells every listener, with nothing changed. */
    ping() { for (const listener of listeners) listener() },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    listening: () => listeners.size,
  }
}

let mounts = 0
function TestPage({ title }: { title: string }) {
  // Counts each time the page is mounted afresh: a sidebar change must not mount the open page again.
  useEffect(() => { mounts += 1 }, [])
  return <><h1>{title}</h1><label>Note<input /></label></>
}

function everyProductPage(extra: Partial<EhrBluePage> = {}): EhrBluePage {
  return { path: 'ocr/quality', group: 'Network & Services', label: 'Reading figures', status: 'partial',
    element: <TestPage title="Reading figures" />, everyProduct: true,
    visible: session => manages(session.actor.facility?.permissions), ...extra }
}

const EHR_ONLY: EhrBluePage = { path: 'ward-figures', group: 'Network & Services', label: 'Ward figures', status: 'partial',
  element: <TestPage title="Ward figures" /> }

async function openAt(host: string | null, path: string, permissions: readonly string[]) {
  if (host) jsdom.reconfigure({ url: `https://${host}${path}` })
  const clinic = facility(REAL_FACILITY, 'Riverside Outreach (fictional)', permissions, ['org_admin'])
  const sent = serve({ [SESSION]: [sessionAt(clinic, [clinic])] })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

const menu = () => within(screen.getByRole('navigation', { name: 'Main navigation' }))

/** Opens every folded group of the sidebar (a group folds unless it holds the page), so each entry can be looked for. */
function unfold() {
  for (const button of menu().queryAllByRole('button')) if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button)
}

/** A link in the sidebar, by its name, in whichever group. */
function menuLink(name: string) {
  unfold()
  return menu().queryByRole('link', { name })
}

/** Every link in the sidebar, in order. */
function menuNames() {
  unfold()
  return menu().getAllByRole('link').map(link => link.textContent)
}

const HOSTS = [
  ['ehr.healthidentitydirectory.com', 'EHR'],
  ['migrate.healthidentitydirectory.com', 'Migrate'],
  ['lab.healthidentitydirectory.com', 'Lab'],
  ['pharmacy.healthidentitydirectory.com', 'Pharmacy'],
  ['outreach.healthidentitydirectory.com', 'Outreach'],
  // No product's host: the frame guesses Outreach from the permissions.
  [null, 'Outreach'],
] as const

describe('a page on every product\'s site', () => {
  it.each(HOSTS)('on %s (%s), is listed and opens at its address', async (host, product) => {
    withFramePages(() => [everyProductPage(), EHR_ONLY])
    await openAt(host, '/provider/ocr/quality', MANAGER)
    expect(await screen.findByRole('heading', { level: 1, name: 'Reading figures' })).toBeDefined()
    expect(where()).toBe('/provider/ocr/quality')
    await waitFor(() => expect(document.title).toBe(`Reading figures · Health ID ${product}`))
    expect(menuLink('Reading figures')?.getAttribute('href')).toBe('/provider/ocr/quality')
  })

  it.each(HOSTS)('on %s (%s), is still left out where its own visible() turns it down', async host => {
    withFramePages(() => [everyProductPage()])
    await openAt(host, '/provider/ocr/quality', ['outreach.registration.read'])
    // The frame's own words where `visible` turns a page down, never the page.
    expect(await screen.findByText(/^Reading figures is part of the Health ID demo only/)).toBeDefined()
    expect(screen.queryByRole('textbox', { name: 'Note' })).toBeNull()
    expect(menuLink('Reading figures')).toBeNull()
  })
})

describe('a page without everyProduct', () => {
  it.each([
    ['lab.healthidentitydirectory.com'],
    ['outreach.healthidentitydirectory.com'],
    [null],
  ])('on %s, is neither listed nor opened, as before', async host => {
    withFramePages(() => [everyProductPage(), EHR_ONLY])
    await openAt(host, '/provider/ward-figures', MANAGER)
    // The product's Home in its place, as for any page of the hospital EHR's.
    await waitFor(() => expect(where()).not.toBe('/provider/ward-figures'))
    expect(screen.queryByRole('heading', { level: 1, name: 'Ward figures' })).toBeNull()
    expect(menuLink('Ward figures')).toBeNull()
    expect(menuLink('Reading figures')).not.toBeNull()
  })

  it('is listed and opens on the EHR\'s site', async () => {
    withFramePages(() => [EHR_ONLY])
    await openAt('ehr.healthidentitydirectory.com', '/provider/ward-figures', MANAGER)
    expect(await screen.findByRole('heading', { level: 1, name: 'Ward figures' })).toBeDefined()
    expect(menuLink('Ward figures')?.getAttribute('href')).toBe('/provider/ward-figures')
  })
})

describe('a page whose listed() says when it changes', () => {
  it('leaves the sidebar when listed() turns false, and comes back when it turns true, with no new session', async () => {
    const store = servedStore(true)
    withFramePages(() => [everyProductPage({ listed: () => store.get(), listedChanges: store.subscribe })])
    const sent = await openAt('ehr.healthidentitydirectory.com', '/provider/ocr/quality', MANAGER)
    await screen.findByRole('heading', { level: 1, name: 'Reading figures' })
    expect(menuLink('Reading figures')).not.toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'kept' } })
    const mounted = mounts

    act(() => store.set(false))
    await waitFor(() => expect(menuLink('Reading figures')).toBeNull())
    // Only the sidebar entry goes: its address still opens, and the open page keeps what was typed.
    expect(screen.getByRole('heading', { level: 1, name: 'Reading figures' })).toBeDefined()
    expect((screen.getByRole('textbox', { name: 'Note' }) as HTMLInputElement).value).toBe('kept')

    act(() => store.set(true))
    await waitFor(() => expect(menuLink('Reading figures')).not.toBeNull())
    expect((screen.getByRole('textbox', { name: 'Note' }) as HTMLInputElement).value).toBe('kept')
    expect(mounts).toBe(mounted)
    // The session was read once: no change of session brought the entry back.
    expect(sent.filter(call => call.route === SESSION)).toHaveLength(1)
  })

  it('leaves the rest of the sidebar as it was, and draws nothing again for a call that changes nothing', async () => {
    const store = servedStore(true)
    const listed = vi.fn(() => store.get())
    withFramePages(() => [everyProductPage({ listed, listedChanges: store.subscribe })])
    await openAt('ehr.healthidentitydirectory.com', '/provider/ocr/quality', MANAGER)
    await screen.findByRole('heading', { level: 1, name: 'Reading figures' })
    const before = menuNames()
    const staffLink = menuLink('Staff & access')
    expect(staffLink).not.toBeNull()

    act(() => store.ping())
    expect(menuNames()).toEqual(before)

    act(() => store.set(false))
    await waitFor(() => expect(menuLink('Reading figures')).toBeNull())
    expect(menuNames()).toEqual(before.filter(name => name !== 'Reading figures'))
    // The other entries are the same links, not drawn afresh.
    expect(menuLink('Staff & access')).toBe(staffLink)
  })

  it('stops listening when the frame closes', async () => {
    const store = servedStore(true)
    withFramePages(() => [everyProductPage({ listed: () => store.get(), listedChanges: store.subscribe })])
    const sent = await openAt('ehr.healthidentitydirectory.com', '/provider/ocr/quality', MANAGER)
    await screen.findByRole('heading', { level: 1, name: 'Reading figures' })
    expect(store.listening()).toBeGreaterThan(0)
    expect(sent.length).toBeGreaterThan(0)
    const { cleanup } = await import('@testing-library/react')
    cleanup()
    expect(store.listening()).toBe(0)
  })

  it('without listedChanges, keeps today\'s behaviour: listed() is asked again only with the session', async () => {
    const store = servedStore(true)
    withFramePages(() => [everyProductPage({ listed: () => store.get() })])
    await openAt('ehr.healthidentitydirectory.com', '/provider/ocr/quality', MANAGER)
    await screen.findByRole('heading', { level: 1, name: 'Reading figures' })
    act(() => store.set(false))
    expect(menuLink('Reading figures')).not.toBeNull()
  })
})
