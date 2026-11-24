/**
 * Outreach with no signal (owner, 13 November 2026): on Health ID Outreach's own sites only (offlineShellHere), the
 * page registers the portal's worker, /sw.js, as it starts, with the same scope and settings as "Notifications on this
 * device" (pushDevice.ts), so push works there exactly as before. On those sites the worker adds the offline app shell
 * (public/sw-outreach.js): a reload, or opening Outreach, with no signal still gets the app.
 *
 * main.tsx loads this with import('./outreachShell') on those sites only, so it is a chunk of its own
 * (assets/outreachShell-<hash>.js) that scripts/check-launch-build.mjs finds by name, and no other site loads it. Like
 * pushDevice.ts it is allowed the worker API (eslint.config.js). It sends the worker nothing but the names of the
 * build's own files this page has loaded, so they are kept too; nothing about a person, a session or a Health ID answer.
 */

/** The build files (/assets/...) this page has loaded so far, by path. */
export function loadedAssets(): string[] {
  const entries = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
    ? performance.getEntriesByType('resource') : []
  const paths = new Set<string>()
  for (const entry of entries) {
    try {
      const url = new URL(entry.name)
      if (url.origin === window.location.origin && url.pathname.startsWith('/assets/') && !url.search) paths.add(url.pathname)
    } catch { /* not an address */ }
  }
  return [...paths]
}

/** Tells the worker which build files this page has loaded, so a reload with no signal finds them. Never throws. */
export async function keepLoadedAssets(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const registration = await navigator.serviceWorker.getRegistration('/')
    registration?.active?.postMessage({ type: 'hid-outreach-keep', assets: loadedAssets() })
  } catch { /* the app still works online */ }
}

/**
 * Registers /sw.js at scope '/' (as pushDevice.ts does) and, once it is active, names the files this page loaded before
 * it took over. Never throws: without a worker the app works online only, as before.
 */
export async function startOutreachShell(): Promise<void> {
  try {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return
    // The worker's path is written here, and in pushDevice.ts, only: the launch build check sees what each chunk registers.
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    await navigator.serviceWorker.ready
    await keepLoadedAssets()
    // A worker that takes this page over after it has loaded more (a page opened meanwhile) hears of those too.
    navigator.serviceWorker.addEventListener('controllerchange', () => { void keepLoadedAssets() }, { once: true })
  } catch { /* no worker: online only, as before */ }
}
