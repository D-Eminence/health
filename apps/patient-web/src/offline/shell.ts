import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { PUBLIC_ENVIRONMENT } from '../publicEnvironment'

/**
 * The app shell's side of the page (docs/OFFLINE-CONTRACT.md 2.12, amendment A5): the only module besides pushDevice.ts
 * allowed the service worker API (ESLint NO_SERVICE_WORKER is off here). Load it only with import(), so Vite emits it
 * as a chunk of its own (assets/shell-<hash>.js) that no page preloads; the launch build check lets that chunk
 * register /sw.js and nothing else, and refuses a static import or preload of it.
 *
 * - enableShell(): the EHR calls it once the offline runtime has opened a vault for an enabled facility. It registers
 *   /sw.js (or finds it) and asks the worker to keep this build's shell (HID_SHELL_ENABLE). Before that, nothing is
 *   registered for the shell and the worker keeps nothing.
 * - purgeShell(): the offline runtime calls it when this facility left the pilot (policy reason facility-off, the vault
 *   open send-only) while the build stays pilot; it asks any worker already there to delete the shell.
 * - purgeShellWhenOff(): on load, in a build whose offline mode is off for this host, asks any worker already there
 *   to delete its shell (HID_PURGE_SHELL): the kill switch. It never registers and never unregisters, because push
 *   may use the same registration.
 * - useShellUpdate(): "A new version of Health ID is ready". Update is possible only while no form has unsaved
 *   changes and no tab is sending a saved change; it then asks the waiting worker to take over (HID_SKIP_WAITING)
 *   and reloads this tab once it has. Never automatic.
 */

export type ShellMode = 'off' | 'pilot' | 'on'

const WORKER_PATH = '/sw.js'
// docs/OFFLINE-CONTRACT.md 2.16 CHANNEL, written out so this chunk does not pull in the offline package
// (shell.test.ts checks they agree).
export const OFFLINE_CHANNEL = 'health-id-offline'
const UPDATE_SAFE_WAIT_MS = 500
const UPDATE_SAFE_RECHECK_MS = 3000

/** The offline mode this build was made with for its host; anything but pilot or on is off. */
export function shellMode(environment: { VITE_HID_OFFLINE_MODE?: string } = PUBLIC_ENVIRONMENT): ShellMode {
  const mode = environment.VITE_HID_OFFLINE_MODE
  return mode === 'pilot' || mode === 'on' ? mode : 'off'
}

function workerApi(): ServiceWorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null
}

// --- Update state, shared by every useShellUpdate in this tab ---

interface ShellState { readonly ready: boolean; readonly updatedElsewhere: boolean }
let state: ShellState = { ready: false, updatedElsewhere: false }
const listeners = new Set<() => void>()
let watched: ServiceWorkerRegistration | null = null
let reloadRequested = false
let controllerWatched = false
let reloadPage = () => window.location.reload()

function setState(next: Partial<ShellState>) {
  const merged = { ...state, ...next }
  if (merged.ready === state.ready && merged.updatedElsewhere === state.updatedElsewhere) return
  state = merged
  for (const listener of listeners) listener()
}

function watch(registration: ServiceWorkerRegistration, api: ServiceWorkerContainer) {
  // A new build is ready when a worker waits behind the one controlling this page.
  const check = () => setState({ ready: Boolean(registration.waiting && api.controller) })
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
      setState({ ready: false, updatedElsewhere: true })
    })
  }
  check()
}

/** Test seam: forget what this tab has seen, and replace the reload. */
export function resetShellForTests({ reload = () => window.location.reload() }: { reload?: () => void } = {}) {
  reloadPage = reload
  state = { ready: false, updatedElsewhere: false }
  listeners.clear()
  watched = null
  reloadRequested = false
  controllerWatched = false
  unsavedForms = () => false
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

// --- Is it safe to update now? ---

/** What the Update button waits for. */
export interface ShellUpdateSafety {
  /** True while any form on this page has changes not yet saved (the useUnsavedGuard registry). */
  hasUnsavedForms(): boolean
  /** True while any tab of this site is sending a saved change (the offline runtime's update-safe answer). */
  isSending(): Promise<boolean>
}

let unsavedForms: () => boolean = () => false

/** The dirty-form registry (useUnsavedGuard) plugs in here; until it does, no form counts as unsaved. */
export function setUnsavedFormsSource(source: () => boolean): () => void {
  unsavedForms = source
  return () => { if (unsavedForms === source) unsavedForms = () => false }
}

/** The question each tab's offline runtime answers on the health-id-offline channel. */
export interface UpdateSafeQuery { readonly type: 'update-safe-query'; readonly id: string }
/** Each runtime's answer: safe is false while it has a command in state `sending`. */
export interface UpdateSafeAnswer { readonly type: 'update-safe'; readonly id: string; readonly safe: boolean }

type ChannelLike = Pick<BroadcastChannel, 'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'>

/**
 * Asks every tab's offline runtime, over BroadcastChannel, whether a command is being sent; waits briefly for answers.
 * No answer means no runtime is running, so nothing is being sent. Without BroadcastChannel no runtime can coordinate
 * either, and the outbox keeps whatever was in flight across a reload, so that also counts as not sending.
 */
export function broadcastSending(
  open: (name: string) => ChannelLike | null = name => typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name),
  waitMs = UPDATE_SAFE_WAIT_MS,
): Promise<boolean> {
  const channel = open(OFFLINE_CHANNEL)
  if (!channel) return Promise.resolve(false)
  const id = crypto.randomUUID()
  return new Promise(resolve => {
    let done = false
    const finish = (sending: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      channel.removeEventListener('message', onMessage)
      channel.close()
      resolve(sending)
    }
    const onMessage = (event: Event) => {
      const answer = (event as MessageEvent).data as Partial<UpdateSafeAnswer> | null
      if (answer?.type === 'update-safe' && answer.id === id && answer.safe === false) finish(true)
    }
    const timer = setTimeout(() => finish(false), waitMs)
    channel.addEventListener('message', onMessage)
    channel.postMessage({ type: 'update-safe-query', id } satisfies UpdateSafeQuery)
  })
}

const defaultSafety: ShellUpdateSafety = {
  hasUnsavedForms: () => unsavedForms(),
  isSending: () => broadcastSending(),
}

// --- The hook ---

export interface ShellUpdate {
  /** A new version of Health ID is ready in this browser. */
  readonly ready: boolean
  /** No form is unsaved and nothing is being sent, so Update now may be pressed. */
  readonly canUpdate: boolean
  /** Another tab took the update: this tab should reload when the person is ready. */
  readonly updatedElsewhere: boolean
  /** Takes the update and reloads this tab, if it is still safe; otherwise does nothing. */
  update(): Promise<void>
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const snapshot = () => state

export function useShellUpdate(safety: ShellUpdateSafety = defaultSafety): ShellUpdate {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [safe, setSafe] = useState(false)
  const offline = shellMode() !== 'off'

  // This tab may never have called enableShell (a reload with the vault still locked): find the registration anyway.
  useEffect(() => {
    const api = workerApi()
    if (!offline || !api) return
    let live = true
    api.getRegistration('/').then(registration => {
      if (live && registration) watch(registration, api)
    }).catch(() => { /* no registration: nothing to update */ })
    return () => { live = false }
  }, [offline])

  useEffect(() => {
    if (!current.ready) {
      setSafe(false)
      return
    }
    let live = true
    const check = async () => {
      const ok = !safety.hasUnsavedForms() && !(await safety.isSending())
      if (live) setSafe(ok)
    }
    void check()
    const timer = setInterval(() => { void check() }, UPDATE_SAFE_RECHECK_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [current.ready, safety])

  const update = useCallback(async () => {
    const waiting = watched?.waiting
    if (!waiting) return
    if (safety.hasUnsavedForms() || await safety.isSending()) {
      setSafe(false)
      return
    }
    reloadRequested = true
    waiting.postMessage({ type: 'HID_SKIP_WAITING' })
  }, [safety])

  return { ready: offline && current.ready, canUpdate: offline && current.ready && safe, updatedElsewhere: current.updatedElsewhere, update }
}
