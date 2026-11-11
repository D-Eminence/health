import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { screen } from '@testing-library/react'
import { AppErrorBoundary } from '../AppErrorBoundary'
import type * as ErrorReportingModule from '../errorReporting'

/**
 * Error reporting in the portal (owner's approval, 2026-11-03): it starts only when the build carries a DSN, and a
 * report holds the error's type, its stack, the route name and the build, nothing else.
 */

const KEY = '0123456789abcdef0123456789abcdef'
const DSN = `https://${KEY}@o12345.ingest.us.sentry.io/4504123456789`
const HEALTH_ID = 'HID-ADA2345'
const EMAIL = 'ada@example.com'

type Reporting = typeof ErrorReportingModule
type Reporter = NonNullable<ReturnType<Reporting['startPortalErrorReporting']>>

const started: Reporter[] = []

afterEach(() => {
  for (const reporter of started.splice(0)) reporter.stop()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  window.history.replaceState(null, '', '/')
})

function configure(extra: Record<string, string> = {}) {
  vi.stubEnv('VITE_HID_ENVIRONMENT', 'staging')
  vi.stubEnv('VITE_HID_API_BASE_URL', 'https://staging.healthidentitydirectory.com')
  vi.stubEnv('VITE_HID_APP_ORIGIN', 'https://staging.healthidentitydirectory.com')
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value)
}

async function load(): Promise<Reporting> {
  vi.resetModules()
  return import('../errorReporting')
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

function start(reporting: Reporting): Reporter | null {
  const reporter = reporting.startPortalErrorReporting()
  if (reporter) started.push(reporter)
  return reporter
}

function Broken(): never {
  throw new Error(`Cannot read properties of undefined (reading "${EMAIL}")`)
}

describe('portal error reporting', () => {
  it('does not start without a DSN: no listener, no request, and React keeps its own error handling', async () => {
    configure({ VITE_HID_BUILD: 'abc123def456' })
    const fetch = stubFetch()
    const listen = vi.spyOn(window, 'addEventListener')
    const reporting = await load()
    expect(start(reporting)).toBeNull()
    expect(listen.mock.calls.map(([type]) => type)).not.toContain('error')
    expect(listen.mock.calls.map(([type]) => type)).not.toContain('unhandledrejection')
    expect(reporting.rootErrorOptions(null)).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not start, and does not stop the portal, when its configuration is incomplete', async () => {
    vi.stubEnv('VITE_HID_SENTRY_DSN', DSN)
    const fetch = stubFetch()
    const reporting = await load()
    expect(() => start(reporting)).not.toThrow()
    expect(start(reporting)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports an uncaught error with the route name and the build only', async () => {
    configure({ VITE_HID_SENTRY_DSN: DSN, VITE_HID_BUILD: 'abc123def456' })
    const fetch = stubFetch()
    const reporter = start(await load())
    expect(reporter).not.toBeNull()
    window.history.replaceState(null, '', `/provider/patients/${HEALTH_ID}?email=${EMAIL}`)
    const error = new TypeError(`lookup failed for ${EMAIL}`)
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url] = fetch.mock.calls[0] as unknown as [string]
    expect(url).toBe(`https://o12345.ingest.us.sentry.io/api/4504123456789/envelope/?sentry_key=${KEY}&sentry_version=7`)
    const { body, event } = sentEvent(fetch)
    expect(event.tags).toEqual({ build: 'abc123def456', route: '/provider/patients/:id' })
    expect(event.release).toBe('abc123def456')
    expect(event.environment).toBe('staging')
    expect((event.exception as { values: { type: string }[] }).values[0]?.type).toBe('TypeError')
    for (const secret of [EMAIL, HEALTH_ID, 'lookup failed', 'localhost']) expect(body).not.toContain(secret)
  })

  it('tags a report "unknown" when the build has no build name', async () => {
    configure({ VITE_HID_SENTRY_DSN: DSN })
    const fetch = stubFetch()
    start(await load())
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('x'), message: 'x' }))
    expect(sentEvent(fetch).event.tags).toEqual({ build: 'unknown', route: '/' })
  })

  it('reports an error a boundary caught, and the boundary still shows its screen', async () => {
    configure({ VITE_HID_SENTRY_DSN: DSN, VITE_HID_BUILD: 'abc123def456' })
    const fetch = stubFetch()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reporting = await load()
    const reporter = start(reporting)
    window.history.replaceState(null, '', '/records')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container, reporting.rootErrorOptions(reporter))
    await act(async () => { root.render(<AppErrorBoundary reload={() => {}}><Broken /></AppErrorBoundary>) })
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
    const { body, event } = sentEvent(fetch)
    expect(event.tags).toEqual({ build: 'abc123def456', route: '/records' })
    expect((event.exception as { values: { mechanism: unknown }[] }).values[0]?.mechanism).toEqual({ type: 'react', handled: false })
    expect(body).not.toContain(EMAIL)
    // React's own handling of a caught error (it logs it) is kept.
    expect(logged.mock.calls.some(([value]) => value instanceof Error)).toBe(true)
    act(() => root.unmount())
    container.remove()
  })

  it('starts once, before the portal renders, and hands React its error handlers', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const main = readFileSync(resolve(here, '../main.tsx'), 'utf8')
    const start = main.indexOf('startPortalErrorReporting()')
    expect(start).toBeGreaterThan(-1)
    expect(main.indexOf('startPortalErrorReporting()', start + 1)).toBe(-1)
    expect(main).toMatch(/createRoot\(container, rootErrorOptions\([A-Za-z]+\)\)\.render\(/)
    expect(start).toBeLessThan(main.indexOf('createRoot(container'))
  })
})
