/*
 * Health ID registers no service worker, and no Health ID page loads this file.
 *
 * hid-system's earlier apps registered one at /service-worker.js, scope '/',
 * caching pages and assets under names starting 'hid-'. A registered worker
 * keeps controlling its host until the browser's update check fetches a new
 * script from the same URL; this is that script. It deletes those caches and
 * unregisters itself. It has no fetch handler, so it never serves or stores a
 * response, and it reloads no page itself: the pages it took over reach the
 * network directly, and leave its control at their next load. It takes over at
 * once (skipWaiting), so a page whose own code reloads when its worker changes
 * reloads then: hid-system's EHR does, on controllerchange, as on its releases.
 *
 * Kept identical in apps/patient-web/public and apps/public-web/public, so
 * whichever app serves a host retires a worker there (legacyServiceWorker.test.ts).
 */
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith('hid-')).map(name => caches.delete(name)))
    await self.registration.unregister()
  })())
})
