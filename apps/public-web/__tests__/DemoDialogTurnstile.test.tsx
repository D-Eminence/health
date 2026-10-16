import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoDialog } from '@/components/shared/DemoDialog'
import ProviderCompletionPage from '@/app/provider/complete/page'
import { getOrganizationCompletionProfile } from '@/lib/provider-application'

/**
 * The demo dialog is mounted on most pages, closed. Its book-demo security
 * check used to be rendered with it, so every such page minted a hidden widget
 * on load, and /provider/complete had two (its own organization-completion one
 * and the dialog's). Closing the dialog also left that widget solved while its
 * token was discarded, so a reopened dialog could not be sent. The check now
 * exists only while the dialog is open, and each opening has a fresh one.
 */
vi.mock('@/lib/env', () => ({
  getEnvironment: () => ({ name: 'production', appOrigin: 'https://www.healthidentitydirectory.com',
    apiBaseUrl: 'https://www.healthidentitydirectory.com', turnstileSiteKey: 'site-key' }),
}))
vi.mock('@/lib/provider-application', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  getOrganizationCompletionProfile: vi.fn(),
}))
// Page chrome that is not under test.
vi.mock('@/components/layout/SiteNav', () => ({ ProviderNav: () => null }))
vi.mock('@/components/layout/SiteFooter', () => ({ SiteFooter: () => null }))
vi.mock('@/components/shared/BackToTop', () => ({ BackToTop: () => null }))

interface Widget { element: HTMLElement; options: Record<string, unknown> }
const widgets = new Map<string, Widget>()
let issued = 0
const turnstile = {
  render: vi.fn((container: HTMLElement, options: Record<string, unknown>) => {
    const id = `widget-${++issued}`
    const element = document.createElement('div')
    element.dataset.fakeTurnstile = String(options.action)
    container.appendChild(element)
    widgets.set(id, { element, options })
    return id
  }),
  remove: vi.fn((id: string) => { widgets.get(id)?.element.remove(); widgets.delete(id) }),
  reset: vi.fn(),
}
const shown = () => Array.from(document.querySelectorAll<HTMLElement>('[data-fake-turnstile]'), element => element.dataset.fakeTurnstile)
function solve(action: string, token: string) {
  const widget = [...widgets.values()].find(item => item.options.action === action && item.element.isConnected)
  if (!widget) throw new Error(`No ${action} widget on the page`)
  act(() => (widget.options.callback as (value: string) => void)(token))
}

beforeAll(() => {
  // jsdom has no modal dialog; opening one only needs to mark it open.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})
beforeEach(() => { widgets.clear(); issued = 0; window.turnstile = turnstile })
afterEach(() => { vi.clearAllMocks(); Reflect.deleteProperty(window, 'turnstile') })

const sendButton = () => screen.getByRole('button', { name: 'Send request', hidden: true }) as HTMLButtonElement

describe('the demo dialog’s security check', () => {
  it('is not rendered while the dialog is closed', async () => {
    render(<><a href="#demo">Book a demo</a><DemoDialog /></>)
    await act(async () => {})
    expect(shown()).toEqual([])
    expect(turnstile.render).not.toHaveBeenCalled()
  })

  it('is rendered once when the dialog opens, removed when it closes, and fresh when it opens again', async () => {
    render(<><a href="#demo">Book a demo</a><DemoDialog /></>)
    fireEvent.click(screen.getByRole('link', { name: 'Book a demo' }))
    await waitFor(() => expect(shown()).toEqual(['book-demo']))
    solve('book-demo', 'first-token')
    expect(sendButton().disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }))
    await waitFor(() => expect(shown()).toEqual([]))
    expect(turnstile.remove).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('link', { name: 'Book a demo' }))
    await waitFor(() => expect(shown()).toEqual(['book-demo']))
    expect(turnstile.render).toHaveBeenCalledTimes(2)
    // The first opening's token was discarded with it: this opening needs its own check.
    expect(sendButton().disabled).toBe(true)
    solve('book-demo', 'second-token')
    expect(sendButton().disabled).toBe(false)
  })
})

describe('the provider completion page', () => {
  it('shows one security check, its own, while the demo dialog is closed', async () => {
    vi.mocked(getOrganizationCompletionProfile).mockRejectedValue(new Error('No completion session'))
    render(await ProviderCompletionPage({ searchParams: Promise.resolve({}) }))
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    await act(async () => {})
    expect(shown()).toEqual(['organization-completion'])
  })
})
