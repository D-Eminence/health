import { setTimeout as sleep } from 'node:timers/promises'
import { test, expect, waitForReleaseMarker } from '../support/devices'
import { DEMO } from '../support/guard'
import { OFFLINE } from '../support/selectors'

/**
 * T16 (A7), observe only: a new build is released while changes wait on the device. The banner "A new version of
 * Health ID is ready." shows, "Update now" stays disabled while any tab has a command sending, and nothing reloads by
 * itself. The card never clicks Update now, and never changes config or deploys anything.
 *
 * Its own invocation, started before the release (HID_E2E_RELEASE_CARD=T16): phase 1 queues changes offline and
 * waits, offline, until the runner creates out/runs/<id>/release-live; phase 2 goes online (slow, so sending lasts)
 * and watches.
 */

interface Sample { at: string; banner: boolean; updateDisabled: boolean | null; waiting: boolean; indicator: string }

test('T16 a new build while changes wait: the banner shows, Update now is disabled until sent, no automatic reload', async ({ kit, ehrA: device, card }) => {
  test.setTimeout(6 * 3_600_000)

  await card.step('Phase 1, before the release: changes wait on the device, offline', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(card.text('visit'))
    await device.goOffline()
    for (let index = 1; index <= 4; index++) {
      await device.addNote({ title: card.text(`note ${index} waiting through the release`), content: card.text('fictional note') })
    }
    card.note(`Waiting to send: ${await device.pendingCount()}`)
    await card.snap(device, 'phase 1: changes waiting offline')
  })

  await waitForReleaseMarker(kit.env.runId, device, 5 * 3_600_000)

  const samples: Sample[] = []
  let reloads = 0
  await card.step('Phase 2: online (slow), watch the banner and Update now', async () => {
    device.page.on('framenavigated', frame => { if (frame === device.page.mainFrame()) reloads++ })
    // The idle lock will have closed the workspace while waiting: the password reopens it (on the device only).
    if (await device.page.locator(OFFLINE.lock.title).isVisible()) expect(await device.unlock()).toBe('unlocked')
    await device.goOnline()
    await device.slow(true)
    const banner = device.page.getByText(OFFLINE.update.ready)
    const update = device.page.getByRole('button', { name: OFFLINE.update.button, exact: true })
    const end = Date.now() + 45 * 60_000
    let shot = ''
    while (Date.now() < end) {
      const sample: Sample = {
        at: new Date().toISOString(),
        banner: await banner.isVisible(),
        updateDisabled: await update.isVisible() ? await update.isDisabled() : null,
        waiting: await device.page.getByText(OFFLINE.update.waitSending).isVisible(),
        indicator: (await device.page.locator(OFFLINE.indicator.selector).innerText().catch(() => '')).trim(),
      }
      samples.push(sample)
      const state = `${sample.banner}-${sample.updateDisabled}-${sample.indicator}`
      if (state !== shot) { shot = state; await card.snap(device, `banner ${sample.banner ? 'shown' : 'not shown'}, update ${sample.updateDisabled === null ? 'absent' : sample.updateDisabled ? 'disabled' : 'enabled'}`) }
      if (sample.banner && sample.updateDisabled === false && /^Online$/.test(sample.indicator)) break
      await sleep(2000)
    }
    await device.slow(false)
    await card.info.attach('banner samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
  })

  await card.step('What was seen', async () => {
    const shown = samples.filter(sample => sample.banner)
    const whileSending = shown.filter(sample => /^Sending/.test(sample.indicator))
    card.note(`Banner seen in ${shown.length} of ${samples.length} samples; while sending: ${whileSending.length}; main-frame navigations in phase 2: ${reloads}`)
    expect(reloads, 'the page reloaded by itself').toBe(0)
    expect.soft(shown.length, 'the update banner appeared').toBeGreaterThan(0)
    if (whileSending.length > 0) expect.soft(whileSending.every(sample => sample.updateDisabled === true), 'Update now was disabled while changes were sending (A7)').toBe(true)
    else card.note('Inconclusive for A7: sending had finished before the banner appeared.')
    expect.soft(await device.pendingCount(), 'changes still wait after the release').toBe(0)
  })
})
