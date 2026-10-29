import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { CLINICAL, OFFLINE } from '../support/selectors'

/**
 * T8: 5 minutes without use lock the workspace; the password reopens it, and a form in progress keeps its text.
 * The page clock is installed before a load and fast-forwarded 5 minutes (real waiting is the fallback). The text is
 * typed into the visit form and never saved. The clock stays installed for the whole browser, so the device is
 * relaunched afterwards.
 */
test('T08 idle 5 minutes: the workspace locks, the password reopens it, and a form in progress keeps its text', async ({ ehrA: device, card }) => {
  test.setTimeout(30 * 60_000)
  const draft = card.text('form in progress, never saved')
  try {
    await card.step('Install the page clock, reload, and open a chart', async () => {
      await device.ready({ offline: true })
      await device.installClock()
      await device.page.reload()
      await device.ready({ offline: true })
      await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
      await device.page.locator(CLINICAL.chiefComplaint).fill(draft)
    })

    await card.step('5 minutes without use: the workspace locks', async () => {
      await device.fastForward(5 * 60_000 + 5_000)
      const lock = device.page.locator(OFFLINE.lock.title)
      if (!await lock.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)) {
        card.note('Fast-forwarding the page clock did not lock the workspace; waiting in real time instead (up to 7 minutes).')
        await lock.waitFor({ state: 'visible', timeout: 7 * 60_000 })
      }
      await expect(lock).toHaveText(OFFLINE.lock.titleText)
      await card.snap(device, 'locked after 5 minutes idle')
    })

    await card.step('The password reopens it, and the form kept its text', async () => {
      expect(await device.unlock(), 'the password did not reopen the workspace').toBe('unlocked')
      await expect(device.page.locator(CLINICAL.chiefComplaint)).toHaveValue(draft)
      await card.snap(device, 'unlocked, form text kept')
    })
  } finally {
    await device.page.locator(CLINICAL.chiefComplaint).fill('').catch(() => undefined)
    await card.step('Relaunch the device without the page clock', async () => {
      await device.relaunch()
      await device.ready()
    })
  }
})
