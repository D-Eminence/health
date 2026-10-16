import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnstileWidget } from '@/components/shared/TurnstileWidget'

/**
 * Cloudflare's normal widget is 300px wide. On /earn the referral form sits in
 * a padded card, which leaves the widget 238px at a 320px screen (320 - 2 x
 * (16 gutter + 1 border + 24 padding)), so it pushed the page sideways by about
 * 21px. As in the portal (apps/patient-web/src/Turnstile.tsx), a slot narrower
 * than 300px gets the compact widget; a slot not laid out yet (0) keeps the
 * normal one. The demo dialog and provider completion use the same widget.
 */
const renderWidget = vi.fn((_container: HTMLElement, _options: Record<string, unknown>) => 'widget-1')
let width = 0

beforeEach(() => {
  renderWidget.mockClear()
  window.turnstile = { render: renderWidget, remove: vi.fn(), reset: vi.fn() }
  // jsdom lays nothing out; this is the width the widget's slot would have.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
})
afterEach(() => {
  Reflect.deleteProperty(window, 'turnstile')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
})

describe('the public site’s security check on a narrow screen', () => {
  it.each([
    [238, 'compact'],
    [278, 'compact'],
    [299, 'compact'],
    [300, 'normal'],
    [460, 'normal'],
    [0, 'normal'],
  ])('in a %ipx slot renders the %s widget', async (slot, size) => {
    width = slot
    render(<TurnstileWidget siteKey="site-key" action="book-demo" resetKey={0} onToken={() => {}} onError={() => {}} />)
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1))
    expect(renderWidget.mock.calls[0]?.[1]).toMatchObject({ size, action: 'book-demo', sitekey: 'site-key' })
  })
})
