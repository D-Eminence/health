import { useSyncExternalStore } from 'react'

/**
 * "Install the Health ID app" (contract b6-contract.md §11.5). A browser that can install the portal (Chrome, Edge,
 * Samsung Internet on Android) says so once a page loads, with `beforeinstallprompt`; main.tsx starts listening at once,
 * so the event is kept even when Notifications is opened later. The event is held in memory only, and forgotten once used or
 * once the app is installed (`appinstalled`). No push or worker API is touched here.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

let kept: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function changed() { for (const listener of listeners) listener() }

function isInstallPrompt(event: Event): event is InstallPromptEvent {
  return typeof (event as Partial<InstallPromptEvent>).prompt === 'function'
}

/** Keeps the browser's install offer for the Notifications page; returns the way to stop. */
export function listenForInstallPrompt(target: Window = window): () => void {
  const offered = (event: Event) => {
    if (!isInstallPrompt(event)) return
    // The browser's own mini-infobar is not shown: the Notifications page offers it, when the patient asks.
    event.preventDefault()
    kept = event
    changed()
  }
  const installed = () => {
    kept = null
    changed()
  }
  target.addEventListener('beforeinstallprompt', offered)
  target.addEventListener('appinstalled', installed)
  return () => {
    target.removeEventListener('beforeinstallprompt', offered)
    target.removeEventListener('appinstalled', installed)
  }
}

export function installPrompt(): InstallPromptEvent | null { return kept }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The browser's install offer, re-rendering the caller when it comes or goes. */
export function useInstallPrompt(): InstallPromptEvent | null {
  return useSyncExternalStore(subscribe, installPrompt, installPrompt)
}

/**
 * Shows the browser's install dialog. An offer can be shown once: whatever the patient chooses, it is forgotten, and
 * the browser offers again (a new `beforeinstallprompt`) if it still can.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = kept
  if (!event) return 'unavailable'
  try {
    await event.prompt()
    return (await event.userChoice).outcome
  } catch {
    return 'dismissed'
  } finally {
    if (kept === event) { kept = null; changed() }
  }
}

/** For tests: forget the kept offer, as a new page would. */
export function forgetInstallPrompt(): void {
  kept = null
  changed()
}
