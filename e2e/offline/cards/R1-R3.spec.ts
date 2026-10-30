import { test } from '../support/devices'

/**
 * The real-device cards: a person toggles Wi-Fi and follows the checklist in README.md ("Manual cards"). They are
 * listed so the report shows them, and marked fixme so they never run.
 */

test.fixme('R1 low-end Android: offline unlock in under 3 s (manual; see README.md)', async ({ ehrA: device, card }) => {
  // An optional approximation on a computer, not a substitute for the phone: CPU throttling, then a timed unlock.
  const session = await device.context.newCDPSession(device.page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await device.ready({ offline: true })
  await device.goOffline()
  await device.page.reload()
  const started = Date.now()
  await device.offlineSignIn()
  card.note(`Offline unlock with 6x CPU throttling took ${Date.now() - started} ms`)
})

test.fixme('R2 iPhone Safari installed to the Home Screen: the persist() result is shown (manual; cannot be automated here)', async () => {})

test.fixme('R3 shared ward PC: two accounts, no cross-access (manual; needs a second demo staff login, which does not exist yet)', async () => {})
