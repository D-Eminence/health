import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { Turnstile } from '../Turnstile'

vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production', turnstileSiteKey: 'site-key' }) }))

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

/**
 * Cloudflare's flexible widget is at least 300px wide. At 320px the auth card
 * leaves it 250px, so it stretched the card past the screen (354px measured).
 */
describe('the security check on a narrow screen', () => {
  it.each([
    [250, 'compact'],
    [299, 'compact'],
    [300, 'flexible'],
    [420, 'flexible'],
    [0, 'flexible'],
  ])('in a %ipx slot renders the %s widget', async (slot, size) => {
    width = slot
    render(<Turnstile action="patient-login" onTokenChange={() => {}} resetKey={0} />)
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1))
    expect(renderWidget.mock.calls[0]?.[1]).toMatchObject({ size, action: 'patient-login' })
  })
})
