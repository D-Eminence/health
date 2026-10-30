import { setTimeout as sleep } from 'node:timers/promises'
import { test, expect, fictionalPhoto } from '../support/devices'
import { DEMO } from '../support/guard'
import { CLINICAL } from '../support/selectors'

/**
 * T3: the connection drops while a save is on its way, and while a document upload is on its way. After reconnecting
 * nothing is lost and nothing is duplicated: each command keeps its Idempotency-Key across the retries.
 * The drop is made by a slow connection (3 s of latency) so the request is in flight, then Chromium's offline switch.
 */
test('T03 offline mid-save and mid-upload, then reconnect: no loss, no duplicate', async ({ ehrA: device, card }) => {
  test.setTimeout(30 * 60_000)
  const visit = card.text('visit')
  const note = card.text('note sent mid-drop')
  const fileName = `e2e-${fileSafe(card.runId)}-t03.jpg`

  await card.step('Online: keep Demo Patient One on this device and start a visit', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(visit)
  })
  const since = device.guard.requests.length

  await card.step('Save a note and drop the connection while it is on its way', async () => {
    await device.slow(true)
    const leaving = device.page.waitForRequest(request => request.method() === 'POST' && /\/clinical-notes$/.test(new URL(request.url()).pathname), { timeout: 60_000 })
    await device.addNote({ title: note, content: card.text('fictional note, not a real patient'), waitFor: '' })
    await leaving
    await device.goOffline()
    await sleep(5000)
    await card.snap(device, 'note saved while the connection dropped')
    await device.goOnline()
    await device.slow(false)
    expect(await device.waitUntilSent(5 * 60_000), 'the note was not sent after reconnecting').toBe(true)
  })

  await card.step('Upload a document and drop the connection while it is on its way', async () => {
    const photo = await fictionalPhoto(device.page, card.text('fictional page'))
    await device.slow(true)
    const leaving = device.page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/ehr/documents/upload-intents', { timeout: 60_000 })
    await device.uploadDocument({ name: fileName, mimeType: 'image/jpeg', buffer: photo })
    await leaving
    await device.goOffline()
    await sleep(5000)
    await card.snap(device, 'upload interrupted')
    await device.goOnline()
    await device.slow(false)
    expect(await device.waitUntilSent(10 * 60_000), 'the document was not sent after reconnecting').toBe(true)
  })

  await card.step('One key per command across retries, and each record once in the chart', async () => {
    const writes = device.guard.requestsSince(since).filter(request => request.method === 'POST')
    for (const [what, pattern] of [['note', /\/clinical-notes$/], ['upload intent', /\/documents\/upload-intents$/]] as const) {
      const keys = new Set(writes.filter(request => pattern.test(request.path)).map(request => request.idempotencyKey))
      card.note(`${what}: ${writes.filter(request => pattern.test(request.path)).length} request(s), ${keys.size} key(s)`)
      expect(keys.size, `${what}: the retries reused one Idempotency-Key`).toBe(1)
    }
    await device.page.reload()
    await device.ready()
    await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
    await device.selectEncounter(visit)
    await device.openTab(CLINICAL.tabs.notes)
    expect(await device.rowsWith(note), 'the note is in the chart once').toBe(1)
    await device.openTab(CLINICAL.tabs.documents)
    expect(await device.rowsWith(fileName), 'the document is in the chart once').toBe(1)
    await card.snap(device, 'chart after reconnecting')
  })
})

/** Run ids may hold dots; a file name keeps letters, digits and dashes. */
function fileSafe(runId: string): string {
  return runId.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}
