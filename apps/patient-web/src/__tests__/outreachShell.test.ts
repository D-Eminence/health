import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The page's side of Outreach's offline app shell (src/outreachShell.ts): on Outreach's own site, main.tsx registers
 * the portal's worker as the app starts, with the same scope and settings as "Notifications on this device", and names
 * to it the build files this page has loaded. Nothing else goes to the worker. It never throws.
 */
const posted: unknown[] = []
function stubWorker({ register = vi.fn(async () => ({})) } = {}) {
  const active = { postMessage: vi.fn((message: unknown) => { posted.push(message) }) }
  const container = {
    register,
    ready: Promise.resolve({ active }),
    getRegistration: vi.fn(async () => ({ active })),
    addEventListener: vi.fn(),
  }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { name: `${window.location.origin}/assets/index-AbCdEf12.js` },
    { name: `${window.location.origin}/assets/Outreach-MnOpQr56.js` },
    { name: `${window.location.origin}/api/v1/auth/session` },
    { name: `${window.location.origin}/assets/x-AbCdEf12.js?v=1` },
    { name: 'https://cdn.example.test/assets/other-AbCdEf12.js' },
  ] as unknown as PerformanceEntryList)
  return { container, active }
}

afterEach(() => {
  posted.length = 0
  Reflect.deleteProperty(navigator, 'serviceWorker')
  Reflect.deleteProperty(window, 'isSecureContext')
  vi.restoreAllMocks()
})

describe('starting the offline app shell', () => {
  it('registers /sw.js at scope / as push does, and names only this site\'s build files loaded', async () => {
    const { container } = stubWorker()
    const { startOutreachShell } = await import('../outreachShell')
    await startOutreachShell()
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
    expect(posted).toEqual([{ type: 'hid-outreach-keep', assets: ['/assets/index-AbCdEf12.js', '/assets/Outreach-MnOpQr56.js'] }])
    expect(container.addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function), { once: true })
  })

  it('does nothing, and never throws, where the browser has no worker or refuses it', async () => {
    const { startOutreachShell } = await import('../outreachShell')
    await expect(startOutreachShell()).resolves.toBeUndefined()
    stubWorker({ register: vi.fn(async () => { throw new TypeError('refused') }) })
    await expect(startOutreachShell()).resolves.toBeUndefined()
    expect(posted).toEqual([])
  })
})
