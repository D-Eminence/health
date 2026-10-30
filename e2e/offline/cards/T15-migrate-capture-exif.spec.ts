import { setTimeout as sleep } from 'node:timers/promises'
import { test, expect, fictionalPhoto, jpegMetadata } from '../support/devices'
import { DEMO } from '../support/guard'
import { OFFLINE, ROUTES } from '../support/selectors'
import { describeReport } from '../support/storage'

/**
 * T15 (D7): on migrate., a photo of a page is captured offline (Capture documents, /provider/capture, shown only
 * while offline is in use at the facility). It is a fictional JPEG drawn and encoded by Chromium, with fake EXIF
 * (a made-up camera and a GPS position) added by the kit. Online, it uploads into the patient's EHR documents; the
 * uploaded object, downloaded with a GET, has no EXIF, and the media chunks are gone from the device once applied.
 */
test('T15 Migrate: a page photographed offline uploads without EXIF, and its chunks are gone after apply', async ({ migrateA: device, card }) => {
  test.setTimeout(40 * 60_000)
  const visit = card.text('visit for capture')
  const fileName = `e2e-${card.runId.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-t15.jpg`

  await card.step('Online on migrate.: keep Demo Patient One on this device and start a visit', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(visit)
  })
  const since = device.guard.requests.length

  const photo = await card.step('A fictional page photo with fake EXIF', async () => {
    const bytes = await fictionalPhoto(device.page, card.text('fictional page'))
    const meta = jpegMetadata(bytes)
    expect(meta, 'the photo carries EXIF, a GPS position and the fake camera before upload').toEqual({ jpeg: true, exif: true, gps: true, fakeMake: true })
    return bytes
  })

  await card.step('Offline: capture it for the visit', async () => {
    await device.goOffline()
    await device.navigate(ROUTES.staff.capture)
    const patient = device.page.locator(OFFLINE.capture.patient)
    await expect(patient, 'Capture documents is not shown (offline must be in use on migrate. at Demo Hospital)').toBeVisible({ timeout: 30_000 })
    await patient.selectOption({ label: `${DEMO.patientNames.one} · ${DEMO.patients.one}` })
    // TODO(stream-b): visits are listed newest first by type and date; the visit just started is the first one.
    const visitSelect = device.page.locator(OFFLINE.capture.visit)
    await expect(visitSelect).toBeVisible({ timeout: 30_000 })
    const firstVisit = await visitSelect.locator('option').nth(1).getAttribute('value')
    if (!firstVisit) throw new Error('No visit to capture into')
    await visitSelect.selectOption(firstVisit)
    await device.page.locator(OFFLINE.capture.file).setInputFiles({ name: fileName, mimeType: 'image/jpeg', buffer: photo })
    await device.page.getByRole('button', { name: OFFLINE.capture.submit, exact: true }).click()
    await expect(device.page.getByText(OFFLINE.capture.saved)).toBeVisible({ timeout: 60_000 })
    const report = await device.storage()
    card.note(`After capture: ${describeReport(report)}`)
    expect(report.database.stores.media ?? 0, 'the photo is sealed on the device in media chunks').toBeGreaterThan(0)
    await card.snap(device, 'captured offline')
  })

  await card.step('Online: it uploads, and the chunks are gone', async () => {
    await device.goOnline()
    expect(await device.waitUntilSent(15 * 60_000), 'the capture was not uploaded').toBe(true)
    await expect.poll(async () => (await device.storage()).database.stores.media ?? 0, { timeout: 5 * 60_000, message: 'media chunks left on the device after apply' }).toBe(0)
    card.note(`After upload: ${describeReport(await device.storage())}`)
    await card.snap(device, 'uploaded')
  })

  await card.step('Download the uploaded object online: no EXIF', async () => {
    const complete = device.guard.requestsSince(since).find(request => request.method === 'POST' && /^\/api\/v1\/ehr\/documents\/[^/]+\/complete$/.test(request.path) && request.status !== null && request.status < 300)
    const documentId = complete?.path.split('/')[5]
    if (!documentId) throw new Error('No completed document upload was seen')
    const headers = { 'X-Facility-ID': DEMO.facilities.hospital, 'X-Purpose-Of-Use': 'direct-care' }
    let url: string | null = null
    for (let attempt = 0; attempt < 40 && !url; attempt++) {
      // A document opens only once its virus scan is clean.
      const answer = await device.guard.get(`/api/v1/ehr/documents/${encodeURIComponent(documentId)}/download`, headers)
      if (answer.ok()) url = (await answer.json() as { url?: string }).url ?? null
      else await sleep(15_000)
    }
    if (!url || !url.startsWith('https://')) throw new Error('No signed download link for the uploaded document (its scan may not be clean yet)')
    const object = await device.context.request.get(url, { failOnStatusCode: true })
    const meta = jpegMetadata(await object.body())
    card.note(`Downloaded object: ${JSON.stringify(meta)}`)
    expect(meta.jpeg, 'the uploaded object is a JPEG').toBe(true)
    expect(meta, 'EXIF and the fake camera are gone').toMatchObject({ exif: false, gps: false, fakeMake: false })
  })
})
