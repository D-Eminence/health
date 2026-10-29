import { shellMode, type ShellUpdateState } from './shellUpdate'

/**
 * The app shell's worker side (docs/OFFLINE-CONTRACT.md 2.12, amendment A5): the only module besides pushDevice.ts
 * allowed the service worker API (ESLint NO_SERVICE_WORKER is off here). Reach it only with import(), so Vite emits it
 * as a chunk of its own (assets/shell-<hash>.js) that no page preloads; the launch build check lets that chunk
 * register /sw.js and nothing else, and refuses a static import or preload of it. Apps import the update banner's
 * hook and setUnsavedFormsSource from shellUpdate.ts (no worker API), which loads this module itself; they call
 * enableShell and purgeShell through import('…/offline/shell').
 *
 * - enableShell(): the EHR calls it once the offline runtime has opened a vault for an enabled facility. It registers
 *   /sw.js (or finds it) and asks the worker to keep this build's shell (HID_SHELL_ENABLE). Before that, nothing is
 *   registered for the shell and the worker keeps nothing.
 * - purgeShell(): the offline runtime calls it when this facility left the pilot (policy reason facility-off, the vault
 *   open send-only) while the build stays pilot; it asks any worker already there to delete the shell.
 * - purgeShellWhenOff(): on load, in a build whose offline mode is off for this host, asks any worker already there
 *   to delete its shell (HID_PURGE_SHELL): the kill switch. Neither purge registers or unregisters, because push may
 *   use the same registration.
 * - watchShellUpdate() and activateWaiting(): the worker side of shellUpdate.ts's useShellUpdate. The first reports
 *   whether a new build waits behind the one running this page, or another tab took it; the second asks the waiting
 *   worker to take over (HID_SKIP_WAITING) and reloads this tab once it has.
 */

const WORKER_PATH = '/sw.js'

function workerApi(): ServiceWorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null
}

// --- What this tab has seen of the registration ---

let current: ShellUpdateState = { ready: false, updatedElsewhere: false }
const reporters = new Set<(next: ShellUpdateState) => void>()
let watched: ServiceWorkerRegistration | null = null
let reloadRequested = false
let controllerWatched = false
let reloadPage = () => window.location.reload()

function report(next: Partial<ShellUpdateState>) {
  current = { ...current, ...next }
  for (const reporter of reporters) reporter(current)
}

function watch(registration: ServiceWorkerRegistration, api: ServiceWorkerContainer) {
  // A new build is ready when a worker waits behind the one controlling this page.
  const check = () => report({ ready: Boolean(registration.waiting && api.controller) })
  if (watched !== registration) {
    watched = registration
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', check)
    })
  }
  if (!controllerWatched) {
    controllerWatched = true
    api.addEventListener('controllerchange', () => {
      if (reloadRequested) {
        reloadPage()
        return
      }
      report({ ready: false, updatedElsewhere: true })
    })
  }
  check()
}

/** Test seam: forget what this tab has seen, and replace the reload. */
export function resetShellForTests({ reload = () => window.location.reload() }: { reload?: () => void } = {}) {
  reloadPage = reload
  current = { ready: false, updatedElsewhere: false }
  reporters.clear()
  watched = null
  reloadRequested = false
  controllerWatched = false
}

// --- Registration ---

/**
 * Called by the EHR after the offline runtime opened a vault for an enabled facility (A5). Registers /sw.js with the
 * same options as pushDevice.ts, so both share one registration, and asks the active worker to keep this build's
 * shell. Answers whether it asked. Never throws: the EHR works the same without a shell, it just cannot reload
 * offline.
 */
export async function enableShell(): Promise<boolean> {
  const api = workerApi()
  if (shellMode() === 'off' || !api) return false
  try {
    const registration = await api.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    watch(registration, api)
    const active = registration.active ?? (await api.ready).active
    if (!active) return false
    active.postMessage({ type: 'HID_SHELL_ENABLE' })
    return true
  } catch {
    return false
  }
}

/**
 * Asks each worker of this site's /sw.js registration (if there is one) to delete the shell (HID_PURGE_SHELL), whatever
 * the build's mode. The offline runtime calls it when the policy reason is facility-off and a vault opens send-only
 * (docs/OFFLINE-CONTRACT.md 2.3 kill switch, T19, A8.5): the facility left the pilot while the build stays pilot.
 * enableShell() saves the shell again if a vault for a still-enabled facility opens later. Never registers, never
 * unregisters, never throws.
 */
export async function purgeShell(): Promise<void> {
  const api = workerApi()
  if (!api) return
  try {
    const registration = await api.getRegistration('/')
    if (!registration || !new URL(registration.active?.scriptURL ?? registration.waiting?.scriptURL
      ?? registration.installing?.scriptURL ?? 'about:blank').pathname.endsWith(WORKER_PATH)) return
    for (const worker of [registration.active, registration.waiting, registration.installing]) {
      worker?.postMessage({ type: 'HID_PURGE_SHELL' })
    }
  } catch { /* nothing registered, or the browser refused: nothing to purge */ }
}

/** Called on every load (main.tsx): in a build whose offline mode is off for this host, purgeShell(). */
export async function purgeShellWhenOff(): Promise<void> {
  if (shellMode() !== 'off') return
  return purgeShell()
}

// --- Update ---

/**
 * Reports to `onChange` whether a new build waits behind the one running this page (ready) or another tab took it
 * (updatedElsewhere), now and on each change, until the returned function is called. Only in an offline build.
 * This tab may never have called enableShell (a reload with the vault still locked): it finds the registration.
 */
export async function watchShellUpdate(onChange: (next: ShellUpdateState) => void): Promise<() => void> {
  const api = workerApi()
  if (shellMode() === 'off' || !api) return () => undefined
  reporters.add(onChange)
  const stop = () => { reporters.delete(onChange) }
  try {
    const registration = await api.getRegistration('/')
    if (registration) watch(registration, api)
    else onChange(current)
  } catch { /* no registration: nothing to update */ }
  return stop
}

/**
 * Asks the waiting worker to take over (HID_SKIP_WAITING) and reloads this tab once it has. Answers whether one was
 * waiting. shellUpdate.ts calls it only after checking that no form is unsaved and nothing is being sent.
 */
export async function activateWaiting(): Promise<boolean> {
  const api = workerApi()
  if (!api) return false
  try {
    const waiting = watched?.waiting ?? (await api.getRegistration('/'))?.waiting
    if (!waiting) return false
    reloadRequested = true
    waiting.postMessage({ type: 'HID_SKIP_WAITING' })
    return true
  } catch {
    return false
  }
}
