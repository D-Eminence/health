import { StrictMode, type ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Cloudflare's api.js is loaded once for the whole portal. The provider and
 * administration sign-in pages used to add their own <script> whenever
 * window.turnstile was not there yet, so StrictMode's second effect, a
 * remount, or moving between the patient, provider and administration pages
 * before it loaded added another copy each time (Turnstile then warns that it
 * was loaded more than once). A failed load is removed, so the next page tries
 * again, and a script that loads without Turnstile is reported, not ignored.
 */
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production', turnstileSiteKey: 'site-key', apiBaseUrl: 'https://gateway.test' }) }))
vi.mock('../staff/env', () => ({ getEnvironment: () => ({ name: 'production', turnstileSiteKey: 'site-key', apiBaseUrl: 'https://gateway.test' }) }))
vi.mock('../staff/App', () => ({ useStaff: () => ({ state: { status: 'signed-out' }, login: vi.fn() }) }))
vi.mock('../admin/env', () => ({ environment: () => ({ name: 'production', turnstileSiteKey: 'site-key', apiBaseUrl: 'https://gateway.test' }) }))
vi.mock('../admin/api', () => ({ adminApi: {} }))
vi.mock('../session', () => ({ useSession: () => ({ api: {} }) }))

const SCRIPT = 'script[src*="challenges.cloudflare.com/turnstile"]'
const tags = () => document.head.querySelectorAll<HTMLScriptElement>(SCRIPT)

/** The three pages, imported afresh so each test starts with nothing loaded. */
async function pages() {
  const [{ SignIn: StaffSignIn }, { AdminSignIn }, { Recovery }] = await Promise.all([
    import('../staff/routes/SignIn'), import('../admin/SignIn'), import('../routes/Recovery')])
  return {
    staff: StaffSignIn as ComponentType,
    admin: (() => <AdminSignIn onSignedIn={async () => undefined} notice={null} />) as ComponentType,
    patient: Recovery as ComponentType,
  }
}
const show = (Page: ComponentType) => render(<StrictMode><MemoryRouter><Page /></MemoryRouter></StrictMode>)

beforeEach(() => { vi.resetModules(); Reflect.deleteProperty(window, 'turnstile') })
afterEach(() => { tags().forEach(tag => tag.remove()); Reflect.deleteProperty(window, 'turnstile') })

describe('loading Cloudflare Turnstile', () => {
  it.each(['staff', 'admin', 'patient'] as const)('the %s sign-in or recovery page adds one script', async page => {
    const Page = (await pages())[page]
    show(Page)
    await waitFor(() => expect(tags().length).toBeGreaterThan(0))
    expect(tags()).toHaveLength(1)
    expect(tags()[0]!.src).toContain('render=explicit')
  })

  it('moving between the patient, provider and administration pages before it loads adds no second script', async () => {
    const { patient, staff, admin } = await pages()
    for (const Page of [patient, staff, admin]) {
      const view = show(Page)
      await waitFor(() => expect(tags().length).toBeGreaterThan(0))
      view.unmount()
    }
    expect(tags()).toHaveLength(1)
  })

  it('once it loads, the page shows one widget', async () => {
    const { staff } = await pages()
    show(staff)
    await waitFor(() => expect(tags()).toHaveLength(1))
    const renderWidget = vi.fn(() => 'widget-1')
    window.turnstile = { render: renderWidget, remove: vi.fn(), reset: vi.fn() }
    await act(async () => { tags()[0]!.dispatchEvent(new Event('load')) })
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1))
  })

  it('a script that failed is removed, says so, and the next page loads it again', async () => {
    const { staff, admin } = await pages()
    const view = show(staff)
    await waitFor(() => expect(tags()).toHaveLength(1))
    await act(async () => { tags()[0]!.dispatchEvent(new Event('error')) })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(tags()).toHaveLength(0)
    view.unmount()
    show(admin)
    await waitFor(() => expect(tags()).toHaveLength(1))
  })

  it.each(['staff', 'admin', 'patient'] as const)('the %s page reports a script that loaded without Turnstile', async page => {
    const Page = (await pages())[page]
    show(Page)
    await waitFor(() => expect(tags()).toHaveLength(1))
    await act(async () => { tags()[0]!.dispatchEvent(new Event('load')) })
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
