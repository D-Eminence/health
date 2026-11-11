import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Error reporting on the public site (owner's approval, 2026-11-03): it starts only when the build carries a DSN, and
 * a report holds the error's type, its stack, the route name and the build, nothing else.
 */

const KEY = '0123456789abcdef0123456789abcdef'
const DSN = `https://${KEY}@o12345.ingest.us.sentry.io/4504123456789`
const EMAIL = 'ada@example.com'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  window.history.replaceState(null, '', '/')
})

function configure(extra: Record<string, string> = {}) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
  vi.stubEnv('NEXT_PUBLIC_HID_API_BASE_URL', 'https://healthidentitydirectory.com')
  vi.stubEnv('NEXT_PUBLIC_HID_APP_ORIGIN', 'https://healthidentitydirectory.com')
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value)
}

function stubFetch() {
  const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function sentEvent(fetch: ReturnType<typeof stubFetch>, call = 0) {
  const body = String((fetch.mock.calls[call] as unknown as [string, RequestInit])[1].body)
  return { body, event: JSON.parse(body.split('\n')[2] ?? '{}') as Record<string, unknown> }
}

describe('public site error reporting', () => {
  it('reads the build by name', async () => {
    configure({ NEXT_PUBLIC_HID_BUILD: '0123456789ab' })
    const { getEnvironment } = await import('@/lib/env')
    expect(getEnvironment().build).toBe('0123456789ab')
  })

  it('does not start without a DSN: no listener and no request', async () => {
    configure({ NEXT_PUBLIC_HID_BUILD: '0123456789ab' })
    const fetch = stubFetch()
    const listen = vi.spyOn(window, 'addEventListener')
    const { ErrorReporting } = await import('../app/ErrorReporting')
    const { unmount } = render(createElement(ErrorReporting))
    const types = listen.mock.calls.map(([type]) => type)
    expect(types).not.toContain('error')
    expect(types).not.toContain('unhandledrejection')
    window.dispatchEvent(new ErrorEvent('error', { message: 'x' }))
    expect(fetch).not.toHaveBeenCalled()
    unmount()
  })

  it('reports an uncaught error with the route name and the build only, and stops when unmounted', async () => {
    configure({ NEXT_PUBLIC_HID_SENTRY_DSN: DSN, NEXT_PUBLIC_HID_BUILD: '0123456789ab' })
    const fetch = stubFetch()
    const { ErrorReporting } = await import('../app/ErrorReporting')
    const { unmount } = render(createElement(ErrorReporting))
    window.history.replaceState(null, '', `/blog/setting-up-your-facility/abc123?email=${EMAIL}`)
    const error = new TypeError(`failed for ${EMAIL}`)
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
    expect(fetch).toHaveBeenCalledTimes(1)
    const { body, event } = sentEvent(fetch)
    expect(event.tags).toEqual({ build: '0123456789ab', route: '/blog/setting-up-your-facility/:id' })
    expect(event.environment).toBe('production')
    expect(event.release).toBe('0123456789ab')
    expect(body).not.toContain(EMAIL)
    expect(body).not.toContain('abc123')

    unmount()
    // An event with no error object: a reporter still listening would send it (as NonErrorThrow), and the test runner
    // does not rethrow it as uncaught once nothing listens.
    window.dispatchEvent(new ErrorEvent('error', { message: 'later' }))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports the error a page boundary shows, once, and still offers to try again', async () => {
    configure({ NEXT_PUBLIC_HID_SENTRY_DSN: DSN, NEXT_PUBLIC_HID_BUILD: '0123456789ab' })
    const fetch = stubFetch()
    const { ErrorReporting } = await import('../app/ErrorReporting')
    const { default: PageError } = await import('../app/error')
    window.history.replaceState(null, '', '/pricing')
    render(createElement('div', null, createElement(ErrorReporting),
      createElement(PageError, { error: new Error(`failed for ${EMAIL}`), retry: () => {} })))
    expect(screen.getByRole('heading', { name: 'This page is unavailable' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    const { body, event } = sentEvent(fetch)
    expect(event.tags).toEqual({ build: '0123456789ab', route: '/pricing' })
    expect((event.exception as { values: { mechanism: unknown }[] }).values[0]?.mechanism).toEqual({ type: 'react', handled: false })
    expect(body).not.toContain(EMAIL)
  })

  it('sends nothing from a page boundary without a DSN', async () => {
    configure()
    const fetch = stubFetch()
    const { default: PageError } = await import('../app/error')
    render(createElement(PageError, { error: new Error('x'), retry: () => {} }))
    expect(screen.getByRole('heading', { name: 'This page is unavailable' })).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is rendered once, by the root layout', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const layout = readFileSync(resolve(here, '../app/layout.tsx'), 'utf8')
    expect(layout.match(/<ErrorReporting \/>/g)).toHaveLength(1)
    expect(layout).toMatch(/import \{ ErrorReporting \} from '\.\/ErrorReporting'/)
  })
})
