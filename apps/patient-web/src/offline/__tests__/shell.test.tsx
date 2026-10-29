import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANNEL, type UpdateSafeAnswer, type UpdateSafeQuery } from '../../../../../packages/offline/src/contracts'

/**
 * The app shell's page side (docs/OFFLINE-CONTRACT.md 2.12, amendment A5): registration only when asked after a vault
 * opened in an offline build, the kill switch's purge in a build with offline off, and the update hook that waits for
 * unsaved forms and sending commands. The browser's service worker container and the offline runtime's broadcast
 * answer are test doubles.
 */
const environment = vi.hoisted(() => ({ VITE_HID_OFFLINE_MODE: 'pilot' as string | undefined }))
vi.mock('../../publicEnvironment', () => ({ PUBLIC_ENVIRONMENT: environment }))

import type * as ShellUpdate from '../shellUpdate'

const shell = await import('../shell')
const shellUpdate = await import('../shellUpdate')

class FakeWorker extends EventTarget {
  postMessage = vi.fn()
  constructor(readonly scriptURL = 'https://ehr.healthidentitydirectory.com/sw.js') { super() }
}

class FakeRegistration extends EventTarget {
  active: FakeWorker | null = new FakeWorker()
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  unregister = vi.fn()
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null
  registration: FakeRegistration | undefined = undefined
  register = vi.fn(async () => {
    this.registration ??= new FakeRegistration()
    return this.registration
  })
  getRegistration = vi.fn(async () => this.registration)
  get ready() { return Promise.resolve(this.registration!) }
}

let container: FakeContainer
const reload = vi.fn()

beforeEach(() => {
  environment.VITE_HID_OFFLINE_MODE = 'pilot'
  container = new FakeContainer()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  shell.resetShellForTests({ reload })
  shellUpdate.resetShellUpdateForTests()
  reload.mockReset()
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('shellMode', () => {
  it('is pilot or on only when the build says exactly that; anything else is off', () => {
    expect(shellUpdate.shellMode({ VITE_HID_OFFLINE_MODE: 'pilot' })).toBe('pilot')
    expect(shellUpdate.shellMode({ VITE_HID_OFFLINE_MODE: 'on' })).toBe('on')
    for (const mode of [undefined, '', 'off', 'ON', 'true']) expect(shellUpdate.shellMode({ VITE_HID_OFFLINE_MODE: mode })).toBe('off')
  })

  it('uses the offline package\'s channel name and its update-safe message types (A7)', () => {
    expect(shellUpdate.OFFLINE_CHANNEL).toBe(CHANNEL)
    // Compile-time: the shell's messages are assignable both ways to the frozen contract's.
    const query: UpdateSafeQuery = { type: 'update-safe-query', id: 'q' } satisfies ShellUpdate.UpdateSafeQuery
    const answer: UpdateSafeAnswer = { type: 'update-safe', id: 'q', safe: false } satisfies ShellUpdate.UpdateSafeAnswer
    const back: [ShellUpdate.UpdateSafeQuery, ShellUpdate.UpdateSafeAnswer] = [query, answer]
    expect(back).toHaveLength(2)
  })
})

describe('enableShell', () => {
  it('registers /sw.js as pushDevice does and asks the active worker to keep the shell', async () => {
    expect(await shell.enableShell()).toBe(true)
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
    expect(container.registration!.active!.postMessage).toHaveBeenCalledWith({ type: 'HID_SHELL_ENABLE' })
  })

  it('does nothing in a build with offline off', async () => {
    environment.VITE_HID_OFFLINE_MODE = 'off'
    expect(await shell.enableShell()).toBe(false)
    expect(container.register).not.toHaveBeenCalled()
  })

  it('never throws when the browser refuses, and never unregisters', async () => {
    container.register.mockRejectedValueOnce(new DOMException('refused', 'SecurityError'))
    expect(await shell.enableShell()).toBe(false)
    container.registration = new FakeRegistration()
    await shell.enableShell()
    expect(container.registration.unregister).not.toHaveBeenCalled()
  })
})

describe('purgeShellWhenOff (the kill switch)', () => {
  it('asks every worker of an existing /sw.js registration to delete the shell, without registering or unregistering', async () => {
    environment.VITE_HID_OFFLINE_MODE = 'off'
    const registration = new FakeRegistration()
    registration.waiting = new FakeWorker()
    container.registration = registration
    await shell.purgeShellWhenOff()
    expect(registration.active!.postMessage).toHaveBeenCalledWith({ type: 'HID_PURGE_SHELL' })
    expect(registration.waiting.postMessage).toHaveBeenCalledWith({ type: 'HID_PURGE_SHELL' })
    expect(container.register).not.toHaveBeenCalled()
    expect(registration.unregister).not.toHaveBeenCalled()
  })

  it('purgeShell() purges in a pilot build too (a facility left the pilot), without registering or unregistering', async () => {
    const registration = new FakeRegistration()
    registration.waiting = new FakeWorker()
    registration.installing = new FakeWorker()
    container.registration = registration
    await shell.purgeShell()
    for (const worker of [registration.active, registration.waiting, registration.installing]) {
      expect(worker!.postMessage).toHaveBeenCalledWith({ type: 'HID_PURGE_SHELL' })
    }
    expect(container.register).not.toHaveBeenCalled()
    expect(registration.unregister).not.toHaveBeenCalled()
  })

  it('purgeShell() leaves a registration of another script alone, and never throws', async () => {
    const registration = new FakeRegistration()
    registration.active = new FakeWorker('https://ehr.healthidentitydirectory.com/service-worker.js')
    container.registration = registration
    await shell.purgeShell()
    expect(registration.active.postMessage).not.toHaveBeenCalled()
    container.getRegistration.mockRejectedValueOnce(new DOMException('refused', 'SecurityError'))
    await expect(shell.purgeShell()).resolves.toBeUndefined()
  })

  it('does nothing in an offline build, or without a registration', async () => {
    container.registration = new FakeRegistration()
    await shell.purgeShellWhenOff()
    expect(container.registration.active!.postMessage).not.toHaveBeenCalled()
    environment.VITE_HID_OFFLINE_MODE = 'off'
    container.registration = undefined
    await expect(shell.purgeShellWhenOff()).resolves.toBeUndefined()
  })
})

/** A BroadcastChannel double with one offline runtime answering on the other side. */
function channelWith(answer: ((query: { type: string; id: string }) => unknown) | null) {
  const target = new EventTarget()
  const channel = {
    postMessage: vi.fn((query: { type: string; id: string }) => {
      const reply = answer?.(query)
      if (reply !== undefined) queueMicrotask(() => target.dispatchEvent(new MessageEvent('message', { data: reply })))
    }),
    close: vi.fn(),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
  return channel
}

describe('broadcastSending (the update-safe query)', () => {
  it('asks on the health-id-offline channel and is true when a runtime answers that it is sending', async () => {
    const channel = channelWith(query => ({ type: 'update-safe', id: query.id, safe: false }))
    const open = vi.fn(() => channel)
    expect(await shellUpdate.broadcastSending(open as never, 50)).toBe(true)
    expect(open).toHaveBeenCalledWith('health-id-offline')
    expect(channel.postMessage).toHaveBeenCalledWith({ type: 'update-safe-query', id: expect.any(String) })
    expect(channel.close).toHaveBeenCalled()
  })

  it('is false when every answer is safe, when nobody answers, and without BroadcastChannel', async () => {
    expect(await shellUpdate.broadcastSending((() => channelWith(query => ({ type: 'update-safe', id: query.id, safe: true }))) as never, 20)).toBe(false)
    expect(await shellUpdate.broadcastSending((() => channelWith(null)) as never, 20)).toBe(false)
    expect(await shellUpdate.broadcastSending(() => null, 20)).toBe(false)
  })

  it('ignores answers to another question', async () => {
    const channel = channelWith(() => ({ type: 'update-safe', id: 'someone-else', safe: false }))
    expect(await shellUpdate.broadcastSending((() => channel) as never, 20)).toBe(false)
  })
})

describe('useShellUpdate', () => {
  function waitingUpdate() {
    const registration = new FakeRegistration()
    registration.waiting = new FakeWorker()
    container.registration = registration
    container.controller = registration.active
    return registration
  }
  const safety = (unsaved: boolean, sending: boolean) => ({ hasUnsavedForms: vi.fn(() => unsaved), isSending: vi.fn(async () => sending) })

  it('is ready when a new build waits behind the running one, and can update when nothing is unsaved or sending', async () => {
    waitingUpdate()
    const safe = safety(false, false)
    const { result } = renderHook(() => shellUpdate.useShellUpdate(safe))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await waitFor(() => expect(result.current.canUpdate).toBe(true))
  })

  it('cannot update while a form is unsaved', async () => {
    waitingUpdate()
    const { result } = renderHook(() => shellUpdate.useShellUpdate(safety(true, false)))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(result.current.canUpdate).toBe(false)
  })

  it('cannot update while any tab is sending, and update() then does nothing', async () => {
    const registration = waitingUpdate()
    const { result } = renderHook(() => shellUpdate.useShellUpdate(safety(false, true)))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await result.current.update() })
    expect(result.current.canUpdate).toBe(false)
    expect(result.current.sending).toBe(true)
    expect(registration.waiting!.postMessage).not.toHaveBeenCalled()
  })

  it('update() asks the waiting worker to take over, then reloads this tab once it has', async () => {
    const registration = waitingUpdate()
    const { result } = renderHook(() => shellUpdate.useShellUpdate(safety(false, false)))
    await waitFor(() => expect(result.current.canUpdate).toBe(true))
    await act(async () => { await result.current.update() })
    expect(registration.waiting!.postMessage).toHaveBeenCalledWith({ type: 'HID_SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    act(() => { container.dispatchEvent(new Event('controllerchange')) })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('says another tab updated, and never reloads by itself, when the takeover was not asked for here', async () => {
    waitingUpdate()
    const { result } = renderHook(() => shellUpdate.useShellUpdate(safety(false, false)))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => { container.dispatchEvent(new Event('controllerchange')) })
    expect(result.current.updatedElsewhere).toBe(true)
    expect(result.current.ready).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('keeps telling the other banners when one unmounts', async () => {
    waitingUpdate()
    const first = renderHook(() => shellUpdate.useShellUpdate(safety(false, false)))
    const second = renderHook(() => shellUpdate.useShellUpdate(safety(false, false)))
    await waitFor(() => expect(second.result.current.ready).toBe(true))
    await waitFor(() => expect(container.getRegistration).toHaveBeenCalledTimes(2))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    first.unmount()
    act(() => { container.dispatchEvent(new Event('controllerchange')) })
    expect(second.result.current.updatedElsewhere).toBe(true)
  })

  it('is not ready on a first install, with no worker running the page', async () => {
    const registration = waitingUpdate()
    container.controller = null
    const { result } = renderHook(() => shellUpdate.useShellUpdate(safety(false, false)))
    await waitFor(() => expect(container.getRegistration).toHaveBeenCalled())
    expect(result.current.ready).toBe(false)
    expect(registration.waiting!.postMessage).not.toHaveBeenCalled()
  })

  it('is never ready in a build with offline off', async () => {
    environment.VITE_HID_OFFLINE_MODE = 'off'
    waitingUpdate()
    const { result } = renderHook(() => shellUpdate.useShellUpdate(safety(false, false)))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(result.current).toMatchObject({ ready: false, canUpdate: false })
    expect(container.getRegistration).not.toHaveBeenCalled()
  })
})

describe('shellUpdate.ts, which apps import statically', () => {
  it('has no service worker API and reaches shell.ts only through import()', async () => {
    const [{ readFileSync }, { dirname, resolve }, { fileURLToPath }] = await Promise.all([import('node:fs'), import('node:path'), import('node:url')])
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../shellUpdate.ts'), 'utf8')
    expect(source).not.toMatch(/serviceWorker|pushManager|showNotification/)
    expect(source).not.toMatch(/^\s*import\b[^(]*['"]\.\/shell['"]/m)
    expect(source).not.toMatch(/^\s*export\b[^(]*from\s*['"]\.\/shell['"]/m)
    expect(source).toContain("import('./shell')")
  })
})
