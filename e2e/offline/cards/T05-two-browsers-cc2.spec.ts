import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { CLASS_TITLES, OFFLINE } from '../support/selectors'

/**
 * T5: the same note is revised on two browsers (devices A and B, separate profiles) while both are offline. A syncs
 * first; B's revision then meets a newer version (412) and is held as CC2, and the review shows both versions. The
 * card resolves B's entry by discarding it (its copy stays on B for 30 days), so B's queue is left empty.
 */
test('T05 the same note edited on two browsers offline: the second gets CC2 and the review shows both versions', async ({ ehrA: a, ehrB: b, card }) => {
  test.setTimeout(40 * 60_000)
  const visit = card.text('visit')
  const note = card.text('note revised on two browsers')

  await card.step('A, online: a visit and a note', async () => {
    await a.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await a.startEncounter(visit)
    await a.addNote({ title: note, content: card.text('first version, fictional') })
  })

  await card.step('A and B, online: keep the chart (with the new note) on each device', async () => {
    await a.keepAvailableOffline()
    await b.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
  })

  await card.step('Both offline: A and B revise the same note', async () => {
    await a.page.bringToFront()
    await a.goOffline()
    await a.selectEncounter(visit)
    await a.reviseNote(note, card.text('revision from A, fictional'), 'E2E revision A')
    await expect(a.page.getByText(OFFLINE.savedHere).first()).toBeVisible({ timeout: 30_000 })
    await b.page.bringToFront()
    await b.goOffline()
    await b.openPatient(DEMO.patients.one, DEMO.patientNames.one)
    await b.selectEncounter(visit)
    await b.reviseNote(note, card.text('revision from B, fictional'), 'E2E revision B')
    await expect(b.page.getByText(OFFLINE.savedHere).first()).toBeVisible({ timeout: 30_000 })
    await card.snap(a, 'A revised offline')
    await card.snap(b, 'B revised offline')
  })

  await card.step('A online first: applied', async () => {
    await a.page.bringToFront()
    await a.goOnline()
    expect(await a.waitUntilSent(5 * 60_000), 'A\'s revision was not sent').toBe(true)
  })

  await card.step('B online second: CC2, with "Your change" and "Current record"', async () => {
    await b.page.bringToFront()
    await b.goOnline()
    await b.waitForAttention(5 * 60_000)
    const drawer = await b.openReview()
    await expect(drawer.getByText(CLASS_TITLES.CC2)).toBeVisible({ timeout: 30_000 })
    await expect(drawer.getByText(OFFLINE.review.yourChange)).toBeVisible()
    await expect(drawer.getByText(OFFLINE.review.currentRecord)).toBeVisible()
    await card.snap(b, 'CC2 review on B')
    await b.resolveReview(drawer, CLASS_TITLES.CC2, OFFLINE.review.discard, card.text('A was sent first'))
    await expect.poll(() => b.attentionCount(), { timeout: 60_000 }).toBe(0)
    await card.snap(b, 'B after discarding')
  })
})
