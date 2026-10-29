import { test, expect, freshProfileDir } from '../support/devices'
import { DEMO } from '../support/guard'
import { OFFLINE, ROUTES } from '../support/selectors'
import { describeReport } from '../support/storage'

/**
 * T1 (amended by A5): there is no offline checkbox on the sign-in page. After an online sign-in at Demo Hospital, on a
 * device with no vault yet, the EHR offers a one-time choice; T1 accepts it, keeps a chart, reloads offline, and gets
 * the offline sign-in and the chart's "Saved copy from". It runs on a fresh profile of its own (out/profiles/<run>/A-t1)
 * and signs out online at the end, which wipes that profile's readable copy.
 */
test('T01 accept the one-time offline choice, keep a chart, reload offline: offline sign-in and "Saved copy from"', async ({ kit, card }) => {
  test.setTimeout(25 * 60_000)
  const device = await kit.staff('A-t1', 'ehr', { choice: 'leave', profileDir: freshProfileDir(kit.env.runId, 'A-t1') })
  try {
    await card.step('Sign in online on a profile with no vault', async () => {
      await device.page.goto(device.url(ROUTES.staff.signIn))
      await device.signIn({ choice: 'leave' })
    })

    await card.step('The one-time choice appears; keep an offline copy', async () => {
      const choice = device.page.locator(OFFLINE.choice.title)
      await expect(choice, 'The one-time offline choice did not appear (A5). Is the production offline config live for Demo Hospital on ehr.?')
        .toBeVisible({ timeout: 60_000 })
      await expect(choice).toHaveText(OFFLINE.choice.titleText)
      await card.snap(device, 'one-time offline choice')
      await device.page.getByRole('button', { name: OFFLINE.choice.keep, exact: true }).click()
      await expect(choice).toBeHidden({ timeout: 60_000 })
      await device.requireOfflineInUse()
    })

    await card.step('Open Demo Patient One and keep the chart available offline', async () => {
      await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
      await device.keepAvailableOffline()
      await card.snap(device, 'chart kept offline')
      card.note(`Storage after keeping the chart: ${describeReport(await device.storage())}`)
    })

    await card.step('Go offline and reload: the offline sign-in opens the copy', async () => {
      await device.goOffline()
      await device.page.reload().catch(error => {
        throw new Error(`The EHR could not load offline (is the shell cached and /sw.js active?): ${String(error).split('\n')[0]}`)
      })
      await expect(device.page.locator(OFFLINE.signIn.title)).toHaveText(OFFLINE.signIn.titleText, { timeout: 60_000 })
      await card.snap(device, 'offline sign-in')
      expect(await device.offlineSignIn(), 'the offline copy did not open').toBe('opened')
    })

    await card.step('The chart shows the copy saved on this device', async () => {
      await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
      await expect(device.page.getByText(OFFLINE.cachedPrefix).first()).toBeVisible({ timeout: 30_000 })
      await card.snap(device, 'saved copy from')
    })
  } finally {
    await card.step('Back online, and sign out of this profile', async () => {
      await device.ready().then(() => device.signOut()).catch(error => card.note(`Sign-out at the end did not complete: ${String(error).split('\n')[0]}`))
    })
    await device.close()
  }
})
