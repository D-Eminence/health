import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { NotificationsPage, ProfilePage } from '../routes/Portal'
import { forgetInstallPrompt, listenForInstallPrompt } from '../installPrompt'
import { json, press, problem, profile, renderPortal } from './portalHarness'

/**
 * "Install the Health ID app" on the Notifications page (B6, contract b6-contract.md §11.5): a button where the browser has offered
 * installing (`beforeinstallprompt`, kept from the moment the page loads), the Home Screen steps in an iPhone or iPad
 * browser, and nothing in the installed app, in an app's built-in web view, or in a browser that offers neither.
 */
vi.mock('../backendContract', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), usesNovuBackend: () => true }))

const HEADING = 'Install the Health ID app'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'
const CHROME_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'
/** Instagram's built-in browser (a WKWebView): no "Safari/" token, and no Share > Add to Home Screen. */
const INSTAGRAM_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0'

let stop: () => void = () => {}
const defined: Array<[object, string]> = []
function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, value })
  defined.push([target, key])
}
beforeEach(() => { forgetInstallPrompt(); stop = listenForInstallPrompt(window) })
afterEach(() => {
  stop()
  for (const [target, key] of defined.splice(0)) Reflect.deleteProperty(target, key)
})

/** The browser's offer to install, as Chrome sends it: `outcome` is what the patient will choose. */
function offer(outcome: 'accepted' | 'dismissed' = 'accepted') {
  let choose: () => void = () => {}
  const chosen = new Promise<{ outcome: typeof outcome; platform: string }>(resolve => { choose = () => resolve({ outcome, platform: 'web' }) })
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => undefined), userChoice: chosen,
  })
  act(() => { window.dispatchEvent(event) })
  return { event, choose }
}

const LIST_READY = 'You have no notifications.'
const page = () => renderPortal(<NotificationsPage />, path => path === '/identity/me/notifications' ? json([]) : problem(404, 'NOT_FOUND', 'Not served'))

describe('Install the Health ID app', () => {
  it('is not shown in a browser that has offered nothing', async () => {
    page()
    expect(await screen.findByText(LIST_READY)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
  })

  it('keeps the browser\'s offer from before Notifications opened, and shows it only when the patient asks', async () => {
    const { event, choose } = offer()
    // The browser's own mini-infobar is held back.
    expect(event.defaultPrevented).toBe(true)
    page()
    expect(await screen.findByRole('heading', { name: HEADING })).toBeTruthy()
    expect(screen.getByText('Open Health ID like an app on this device.')).toBeTruthy()
    expect(event.prompt).not.toHaveBeenCalled()
    await press(screen.getByRole('button', { name: 'Install Health ID' }))
    expect(event.prompt).toHaveBeenCalledTimes(1)
    await act(async () => { choose() })
    await waitFor(() => expect(screen.queryByRole('heading', { name: HEADING })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Notifications' }))
  })

  it('is not on the profile', async () => {
    offer()
    renderPortal(<ProfilePage />, path => path === '/identity/me' ? json(profile) : problem(404, 'NOT_FOUND', 'Not served'))
    expect(await screen.findByRole('heading', { name: /Bio-data/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
  })

  it('goes once the patient declines, too: an offer can be shown once', async () => {
    const { choose } = offer('dismissed')
    page()
    await press(await screen.findByRole('button', { name: 'Install Health ID' }))
    await act(async () => { choose() })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install Health ID' })).toBeNull())
  })

  it('goes when the app is installed another way', async () => {
    offer()
    page()
    expect(await screen.findByRole('heading', { name: HEADING })).toBeTruthy()
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
  })

  it('on iPhone and iPad, says how to add it to the Home Screen', async () => {
    define(navigator, 'userAgent', IPHONE)
    page()
    expect(await screen.findByRole('heading', { name: HEADING })).toBeTruthy()
    expect(screen.getByText('Tap the Share button, then Add to Home Screen.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install Health ID' })).toBeNull()
  })

  it.each([
    ['Chrome on iPhone', CHROME_IPHONE],
    ['iPadOS Safari, which says Macintosh', IPAD_DESKTOP],
  ])('in %s, says how to add it to the Home Screen as well', async (_name, agent) => {
    define(navigator, 'userAgent', agent)
    if (agent === IPAD_DESKTOP) define(navigator, 'maxTouchPoints', 5)
    page()
    expect(await screen.findByRole('heading', { name: HEADING })).toBeTruthy()
    expect(screen.getByText('Tap the Share button, then Add to Home Screen.')).toBeTruthy()
  })

  it('is not shown in an app\'s built-in web view on iPhone, which has no Add to Home Screen', async () => {
    define(navigator, 'userAgent', INSTAGRAM_IPHONE)
    page()
    expect(await screen.findByText(LIST_READY)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
    expect(screen.queryByText('Tap the Share button, then Add to Home Screen.')).toBeNull()
  })

  it.each([
    ['the installed app', () => define(window, 'matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)', media: query }))],
    ['the Home Screen app on iPhone', () => { define(navigator, 'userAgent', IPHONE); define(navigator, 'standalone', true) }],
  ])('is not shown in %s', async (_name, setUp) => {
    setUp()
    offer()
    page()
    expect(await screen.findByText(LIST_READY)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: HEADING })).toBeNull()
  })
})
