/*
 * Health ID's push worker (B6). Registered at /sw.js, scope '/', only when a patient turns on "Notifications on
 * this device" on the Notifications page (apps/patient-web/src/pushDevice.ts). A push carries nothing: whatever arrives, this shows
 * the same fixed notification and never reads the message. Tapping it opens Notifications. It has no request
 * handler and keeps nothing: no stored responses, no storage, no network of its own, so nothing about a patient is
 * kept on the device. scripts/check-launch-build.mjs refuses a build whose sw.js does more; see pushWorker.test.ts.
 */
const TITLE = 'Health ID'
const OPTIONS = Object.freeze({
  body: 'You have a new notification.',
  icon: '/icons/icon-192.png',
  tag: 'hid-inbox',
  renotify: true,
  lang: 'en',
})
const TARGET_PATH = '/notifications'

self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification(TITLE, OPTIONS))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const target = new URL(TARGET_PATH, self.location.origin).href
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const ours = windows.filter(client => new URL(client.url).origin === self.location.origin)
    const open = ours.find(client => new URL(client.url).pathname === TARGET_PATH)
    if (open) return open.focus()
    for (const client of ours) {
      try {
        const moved = await client.navigate(target)
        if (moved) return moved.focus()
      } catch { /* not controlled by this worker: try the next, then open a window */ }
    }
    return self.clients.openWindow(target)
  })())
})
