import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { CLASS_TITLES, OFFLINE } from '../support/selectors'

/**
 * T6: device A has a prescription waiting while Demo Patient One adds an allergy in the portal (allergies are
 * patient-entered, on the health information page). When A reconnects, the prescription is held for review (CC4) and
 * the review shows the new allergy information. A8.3 holds any prescription saved offline anyway, so the card records
 * whether the new allergy is shown. It discards the fictional prescription and puts the allergy text back as it was.
 */
test('T06 an allergy added on another browser while a prescription waits: A shows the CC4 hold', async ({ ehrA: device, patient1, card }) => {
  test.setTimeout(30 * 60_000)
  const medication = card.text('fictional medication')
  const allergy = card.text('fictional allergy, for an offline test')
  let original: string | null = null

  await card.step('A, online: keep Demo Patient One and start a visit', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(card.text('visit'))
  })

  await card.step('A, offline: a prescription waits on the device', async () => {
    await device.goOffline()
    await device.addPrescription({ medication, instructions: card.text('fictional, for an offline test only') })
    await card.snap(device, 'prescription waiting')
  })

  try {
    await card.step('Demo Patient One adds an allergy in the portal', async () => {
      await patient1.ready()
      original = await (await patient1.allergies()).inputValue()
      await patient1.setAllergies(original ? `${original}\n${allergy}` : allergy)
      await card.snap(patient1, 'allergy added by the patient')
    })

    await card.step('A, online: the prescription is held (CC4) with the new allergy information', async () => {
      await device.page.bringToFront()
      await device.goOnline()
      await device.waitForAttention(5 * 60_000)
      const drawer = await device.openReview()
      await expect(drawer.getByText(CLASS_TITLES.CC4)).toBeVisible({ timeout: 30_000 })
      const shown = await drawer.getByText(allergy).count()
      card.note(shown > 0 ? 'The review shows the allergy the patient added.' : 'The review does not show the allergy the patient added: see the screenshot (A8.3 holds offline prescriptions anyway).')
      expect.soft(shown, 'the review shows the new allergy').toBeGreaterThan(0)
      await card.snap(device, 'CC4 safety hold')
      await device.resolveReview(drawer, CLASS_TITLES.CC4, OFFLINE.review.discard, card.text('fictional prescription, discarded after the hold'))
      await expect.poll(() => device.attentionCount(), { timeout: 60_000 }).toBe(0)
    })
  } finally {
    if (original !== null) {
      const restore = original
      await card.step('Put the allergy text back as it was', async () => {
        await patient1.page.bringToFront()
        await patient1.setAllergies(restore).catch(error => card.note(`The allergy text was not restored: ${String(error).split('\n')[0]}`))
      })
    }
  }
})
