import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { describeReport, plaintextScan } from '../support/storage'

/**
 * T12: every store of the offline database (and the shell caches and web storage) is read, serialized and searched
 * for the patient's name, Health ID and the run's note text. Expect 0 matches. Read-only: nothing is written to any
 * store, and the database is opened only if indexedDB.databases() lists it.
 */
test('T12 the storage scan finds no plaintext name, Health ID or note text', async ({ ehrA: device, card }) => {
  test.setTimeout(20 * 60_000)
  const content = card.text('plaintext probe note, fictional')

  await card.step('Online: keep Demo Patient One and start a visit', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(card.text('visit'))
  })

  await card.step('Offline: a note with the probe text waits on the device', async () => {
    await device.goOffline()
    await device.addNote({ title: card.text('plaintext probe'), content })
  })

  await card.step('Scan every store: 0 plaintext matches', async () => {
    card.note(describeReport(await device.storage()))
    const needles = [DEMO.patientNames.one, DEMO.patients.one, content]
    const scan = await plaintextScan(device.page, needles)
    await card.info.attach('plaintext scan', { body: JSON.stringify({ needles: ['patient name', 'Health ID', 'note text'], ...scan }, null, 2), contentType: 'application/json' })
    card.note(`Scanned ${scan.recordsScanned} records on ${scan.origin}: ${scan.total} match(es)`)
    expect(scan.recordsScanned, 'the offline database had records to scan').toBeGreaterThan(0)
    expect(scan.matches, 'plaintext found on the device').toEqual({})
  })

  await card.step('Online: the note is sent', async () => {
    await device.goOnline()
    expect(await device.waitUntilSent(5 * 60_000)).toBe(true)
  })
})
