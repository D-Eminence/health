import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * SO-06: when Cloudflare's script fails to load, or the widget fails, the security check said "Please try again" with
 * no way to: the widget was loaded again only after a submit, which needs the token it could not give. Reloading the
 * sign-up lost what was typed. A Try again beside the message now loads the check again in place, keeping the page,
 * and a check that recovers by itself drops the stale message.
 */
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production', turnstileSiteKey: 'site-key', apiBaseUrl: 'https://gateway.test' }) }))

const SCRIPT = 'script[src*="challenges.cloudflare.com/turnstile"]'
const tags = () => document.head.querySelectorAll<HTMLScriptElement>(SCRIPT)

beforeEach(() => { vi.resetModules(); Reflect.deleteProperty(window, 'turnstile') })
afterEach(() => { tags().forEach(tag => tag.remove()); Reflect.deleteProperty(window, 'turnstile') })

async function showCheck() {
  const { Turnstile } = await import('../Turnstile')
  const onToken = vi.fn()
  render(<form><input aria-label="Typed before" defaultValue="Ada" /><Turnstile action="patient-enrollment" onTokenChange={onToken} resetKey={0} /></form>)
  await waitFor(() => expect(tags()).toHaveLength(1))
  return onToken
}

describe('a security check that could not load', () => {
  it('offers Try again, which loads the check again without leaving the page', async () => {
    await showCheck()
    await act(async () => { tags()[0]!.dispatchEvent(new Event('error')) })
    expect((await screen.findByRole('alert')).textContent).toBe('Security check unavailable. Please try again.')
    const retry = screen.getByRole('button', { name: 'Try again' })

    retry.focus()
    await act(async () => { fireEvent.click(retry) })
    await waitFor(() => expect(tags()).toHaveLength(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Typed before') as HTMLInputElement).value).toBe('Ada')
    // Focus stays with the check, not on the page, while it loads again.
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Security check' }))

    const renderWidget = vi.fn(() => 'widget-2')
    window.turnstile = { render: renderWidget, remove: vi.fn(), reset: vi.fn() }
    await act(async () => { tags()[0]!.dispatchEvent(new Event('load')) })
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1))
  })

  it('puts focus on the new Try again when the check fails to load again', async () => {
    await showCheck()
    await act(async () => { tags()[0]!.dispatchEvent(new Event('error')) })
    const retry = await screen.findByRole('button', { name: 'Try again' })
    retry.focus()
    await act(async () => { fireEvent.click(retry) })
    await waitFor(() => expect(tags()).toHaveLength(1))
    await act(async () => { tags()[0]!.dispatchEvent(new Event('error')) })
    await screen.findByRole('alert')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
  })
})

describe('a widget that failed', () => {
  it('offers Try again, which renders the widget again', async () => {
    const options: Array<Record<string, (token?: string) => void>> = []
    const renderWidget = vi.fn((_container: HTMLElement, given: Record<string, unknown>) => {
      options.push(given as Record<string, (token?: string) => void>); return `widget-${options.length}`
    })
    window.turnstile = { render: renderWidget, remove: vi.fn(), reset: vi.fn() }
    const { Turnstile } = await import('../Turnstile')
    render(<Turnstile action="patient-login" onTokenChange={vi.fn()} resetKey={0} />)
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1))
    act(() => { options[0]!['error-callback']!() })
    expect((await screen.findByRole('alert')).textContent).toBe('Security check failed. Please try again.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops the failure once the widget recovers by itself and gives a token', async () => {
    const options: Array<Record<string, (token?: string) => void>> = []
    window.turnstile = { render: vi.fn((_container: HTMLElement, given: Record<string, unknown>) => {
      options.push(given as Record<string, (token?: string) => void>); return 'widget-1'
    }), remove: vi.fn(), reset: vi.fn() }
    const { Turnstile } = await import('../Turnstile')
    const onToken = vi.fn()
    render(<Turnstile action="patient-login" onTokenChange={onToken} resetKey={0} />)
    await waitFor(() => expect(options).toHaveLength(1))
    act(() => { options[0]!['error-callback']!() })
    await screen.findByRole('alert')
    act(() => { options[0]!.callback!('fresh-token') })
    expect(onToken).toHaveBeenLastCalledWith('fresh-token')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})
