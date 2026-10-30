import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { OFFLINE } from '../support/selectors'

/**
 * T11: with the device clock 10 minutes behind the last time the vault saw, the clock is "suspect" and offline unlock
 * is refused. The page clock starts 10 minutes back before an offline load. The guard aborts any online sign-in during
 * this card; the device is relaunched afterwards, without the page clock.
 */
test('T11 device clock moved back 10 minutes: offline unlock is refused', async ({ ehrA: device, card }) => {
  test.setTimeout(20 * 60_000)

  await card.step('Online: keep Demo Patient One on this device', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
  })

  device.guard.setNoOnlineSignIn(true)
  try {
    await card.step('Offline, with the clock 10 minutes back: the offline sign-in refuses', async () => {
      await device.goOffline()
      await device.installClock(new Date(Date.now() - 10 * 60_000))
      await device.page.reload()
      const result = await device.offlineSignIn()
      card.note(`Offline sign-in with the clock 10 minutes back: ${result}`)
      expect(result, 'the offline copy opened with a suspect clock').not.toBe('opened')
      expect.soft(result, 'the refusal names the clock').toBe(OFFLINE.signIn.clockSuspect)
      await card.snap(device, 'refused with the clock 10 minutes back')
    })
  } finally {
    device.guard.setNoOnlineSignIn(false)
    await card.step('Relaunch the device without the page clock', async () => {
      await device.relaunch()
      await device.ready()
    })
  }
})
