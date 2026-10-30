import { randomUUID } from 'node:crypto'
import { test, expect } from '../support/devices'
import { Secret } from '../support/env'
import { DEMO } from '../support/guard'
import { CLINICAL, OFFLINE, ROUTES, STAFF_SIGN_IN } from '../support/selectors'
import { describeReport } from '../support/storage'

/**
 * T9: 5 wrong offline passwords wipe the readable copy (the cache store) and keep what waits to be sent (outbox, audit
 * and media), as the storage report shows. It runs on device B, so device A's readable copy is not wiped for the cards
 * after it; B's only readable-copy card (T5) runs before.
 *
 * Before each wrong password the offline sign-in screen must be shown (offlineSignIn asserts it), and the guard aborts
 * any online sign-in during this card, so a failed offline emulation never sends wrong passwords to Health ID (five
 * in 15 minutes would lock the shared login for everyone).
 */
test('T09 five wrong offline passwords: the readable copy is wiped and waiting changes are kept', async ({ ehrB: device, card }) => {
  test.setTimeout(30 * 60_000)
  const visit = card.text('visit')
  const note = card.text('note kept through the wipe')

  await card.step('Online: keep Demo Patient One on device B and start a visit', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(visit)
  })

  const before = await card.step('Offline: a note waits; the storage report before', async () => {
    await device.goOffline()
    await device.addNote({ title: note, content: card.text('fictional note, sent after the wipe') })
    const report = await device.storage()
    card.note(`Before: ${describeReport(report)}`)
    expect(report.database.stores.cache ?? 0, 'the readable copy is on the device').toBeGreaterThan(0)
    expect(report.database.stores.outbox ?? 0, 'the note waits in the outbox').toBeGreaterThan(0)
    return report
  })

  device.guard.setNoOnlineSignIn(true)
  try {
    await card.step('Reload offline; five wrong passwords at the offline sign-in', async () => {
      await device.page.reload()
      for (let attempt = 1; attempt <= 5; attempt++) {
        // offlineSignIn asserts the offline sign-in screen first.
        const result = await device.offlineSignIn(new Secret(`E2E-wrong-${attempt}-${randomUUID()}`))
        card.note(`Wrong password ${attempt}: ${result}`)
        expect(result, `wrong password ${attempt} opened the copy`).not.toBe('opened')
      }
      await card.snap(device, 'after five wrong passwords')
    })

    await card.step('The storage report: cache wiped, outbox, audit and media kept', async () => {
      const after = await device.storage()
      card.note(`After: ${describeReport(after)}`)
      expect(after.database.stores.cache ?? 0, 'the readable copy is wiped').toBe(0)
      for (const store of ['outbox', 'audit', 'media'] as const) {
        expect(after.database.stores[store] ?? 0, `${store} is kept`).toBeGreaterThanOrEqual(before.database.stores[store] ?? 0)
      }
      await expect.soft(device.page.getByText(OFFLINE.signIn.wiped).first(), 'the offline sign-in says the copy was cleared').toBeVisible()
    })
  } finally {
    device.guard.setNoOnlineSignIn(false)
  }

  await card.step('Online: sign out and sign in again (as A8.11), and the kept note is sent once', async () => {
    await device.goOnline()
    await device.page.goto(device.url(ROUTES.staff.clinical))
    if (await device.screen() === 'workspace') {
      await device.signOut()
      await device.page.locator(STAFF_SIGN_IN.password).waitFor({ state: 'visible', timeout: 60_000 })
    }
    await device.ready({ offline: true })
    expect(await device.waitUntilSent(10 * 60_000), 'the kept note was not sent').toBe(true)
    await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
    await device.selectEncounter(visit)
    await device.openTab(CLINICAL.tabs.notes)
    expect(await device.rowsWith(note), 'the note is in the chart once').toBe(1)
    await card.snap(device, 'kept note sent')
  })
})
