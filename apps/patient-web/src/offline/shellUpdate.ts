import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { PUBLIC_ENVIRONMENT } from '../publicEnvironment'

/**
 * The app shell's update banner state (docs/OFFLINE-CONTRACT.md 2.12, amendment A7), without the service worker API:
 * apps import this statically (useShellUpdate, setUnsavedFormsSource). Everything that touches the worker is in
 * shell.ts, which is reached only through import(), so it stays a chunk of its own that no page preloads or imports
 * statically (scripts/check-launch-build.mjs). The hook loads it when it mounts, in an offline build only.
 *
 * "A new version of Health ID is ready": Update is possible only while no form has unsaved changes and no tab is
 * sending a saved change; it then asks the waiting worker to take over (HID_SKIP_WAITING) and reloads this tab once
 * it has. Never automatic. Another tab's update shows as updatedElsewhere ("reload when ready").
 */

export type ShellMode = 'off' | 'pilot' | 'on'

/** The offline mode this build was made with for its host; anything but pilot or on is off. */
export function shellMode(environment: { VITE_HID_OFFLINE_MODE?: string } = PUBLIC_ENVIRONMENT): ShellMode {
  const mode = environment.VITE_HID_OFFLINE_MODE
  return mode === 'pilot' || mode === 'on' ? mode : 'off'
}

// docs/OFFLINE-CONTRACT.md 2.16 CHANNEL, written out so this module does not pull in the offline package
// (shell.test.tsx checks they agree, and that the messages match A7's UpdateSafeQuery and UpdateSafeAnswer).
export const OFFLINE_CHANNEL = 'health-id-offline'
const UPDATE_SAFE_WAIT_MS = 500
const UPDATE_SAFE_RECHECK_MS = 3000

// --- Is it safe to update now? ---

/** What the Update button waits for. */
export interface ShellUpdateSafety {
  /** True while any form on this page has changes not yet saved (the useUnsavedGuard registry). */
  hasUnsavedForms(): boolean
  /** True while any tab of this site is sending a saved change (the offline runtime's update-safe answer). */
  isSending(): Promise<boolean>
}

let unsavedForms: () => boolean = () => false

/** The dirty-form registry (useUnsavedGuard) plugs in here (A7); until it does, no form counts as unsaved. */
export function setUnsavedFormsSource(source: () => boolean): () => void {
  unsavedForms = source
  return () => { if (unsavedForms === source) unsavedForms = () => false }
}

/** The question each tab's offline runtime answers on the health-id-offline channel (A7). */
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

// --- Update state, shared by every useShellUpdate in this tab ---

/** What shell.ts reports about the worker: a new build waits, or another tab took it. */
export interface ShellUpdateState { readonly ready: boolean; readonly updatedElsewhere: boolean }
let state: ShellUpdateState = { ready: false, updatedElsewhere: false }
const listeners = new Set<() => void>()

function setState(next: ShellUpdateState) {
  if (next.ready === state.ready && next.updatedElsewhere === state.updatedElsewhere) return
  state = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const snapshot = () => state

/** The worker side, loaded only when needed: shell.ts in the app, a double in tests. */
export interface ShellWorkerSide {
  watchShellUpdate(report: (next: ShellUpdateState) => void): Promise<() => void>
  activateWaiting(): Promise<boolean>
}
const loadShell = (): Promise<ShellWorkerSide> => import('./shell')

/** Test seam: forget what this tab has seen. */
export function resetShellUpdateForTests() {
  state = { ready: false, updatedElsewhere: false }
  listeners.clear()
  unsavedForms = () => false
}

// --- The hook ---

export interface ShellUpdate {
  /** A new version of Health ID is ready in this browser. */
  readonly ready: boolean
  /** No form is unsaved and nothing is being sent, so Update now may be pressed. */
  readonly canUpdate: boolean
  /** Another tab took the update: this tab should reload when the person is ready. */
  readonly updatedElsewhere: boolean
  /** A tab was sending a saved change at the last check, so the update waits for it. */
  readonly sending: boolean
  /** Takes the update and reloads this tab, if it is still safe; otherwise does nothing. */
  update(): Promise<void>
  /** Reloads this tab (after another tab took the update). */
  reload(): void
}

const reloadTab = () => window.location.reload()

export function useShellUpdate(safety: ShellUpdateSafety = defaultSafety, load: () => Promise<ShellWorkerSide> = loadShell): ShellUpdate {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [safe, setSafe] = useState(false)
  const [sending, setSending] = useState(false)
  const offline = shellMode() !== 'off'

  // The worker side loads only in an offline build, after the page; it reports the registration's state here.
  useEffect(() => {
    if (!offline) return
    let live = true
    let stop: (() => void) | null = null
    load().then(shell => shell.watchShellUpdate(setState)).then(unwatch => {
      if (live) stop = unwatch
      else unwatch()
    }).catch(() => { /* no worker API, or the chunk could not load: nothing to update */ })
    return () => {
      live = false
      stop?.()
    }
  }, [offline, load])

  useEffect(() => {
    if (!current.ready) {
      setSafe(false)
      setSending(false)
      return
    }
    let live = true
    const check = async () => {
      const busy = await safety.isSending()
      if (!live) return
      setSending(busy)
      setSafe(!busy && !safety.hasUnsavedForms())
    }
    void check()
    const timer = setInterval(() => { void check() }, UPDATE_SAFE_RECHECK_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [current.ready, safety])

  const update = useCallback(async () => {
    if (!state.ready) return
    const busy = await safety.isSending()
    if (busy || safety.hasUnsavedForms()) {
      setSending(busy)
      setSafe(false)
      return
    }
    await load().then(shell => shell.activateWaiting()).catch(() => false)
  }, [safety, load])

  return { ready: offline && current.ready, canUpdate: offline && current.ready && safe, updatedElsewhere: current.updatedElsewhere,
    sending: offline && current.ready && sending, update, reload: reloadTab }
}
