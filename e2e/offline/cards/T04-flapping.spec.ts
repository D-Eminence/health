import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { CLINICAL } from '../support/selectors'

/** T4: the connection flaps (offline and online every 5 seconds) for 2 minutes with 10 changes queued; all end applied. */
test('T04 flapping for 2 minutes with 10 queued changes: all end applied, none twice', async ({ ehrA: device, card }) => {
  test.setTimeout(40 * 60_000)
  const visit = card.text('visit')
  const notes = Array.from({ length: 9 }, (_, index) => card.text(`note ${index + 1} of 9`))

  await card.step('Online: keep Demo Patient One on this device', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
  })
  const since = device.guard.requests.length

  await card.step('Offline: queue 10 changes (a visit and 9 notes)', async () => {
    await device.goOffline()
    await device.startEncounter(visit)
    for (const title of notes) await device.addNote({ title, content: card.text('fictional note for the flapping card') })
    const waiting = await device.pendingCount()
    card.note(`Waiting to send before flapping: ${waiting}`)
    expect(waiting, '10 changes wait on this device').toBe(10)
    await card.snap(device, '10 changes queued')
  })

  await card.step('Flap for 2 minutes, every 5 seconds', async () => {
    const toggles = await device.flap(2 * 60_000)
    card.note(`Toggled the connection ${toggles} times`)
    await card.snap(device, 'after flapping')
  })

  await card.step('Online: all 10 applied', async () => {
    expect(await device.waitUntilSent(15 * 60_000), 'changes still wait after flapping').toBe(true)
    const writes = device.guard.requestsSince(since).filter(request => request.method === 'POST' && /\/(encounters|clinical-notes)$/.test(request.path))
    const keys = new Set(writes.map(request => request.idempotencyKey))
    card.note(`${writes.length} write request(s) for ${keys.size} key(s) (retries reuse their key)`)
    expect(keys.size, 'one key per change').toBe(10)
    await device.page.reload()
    await device.ready()
    await device.openPatient(DEMO.patients.one, DEMO.patientNames.one)
    expect(await device.page.locator(CLINICAL.encounterRow).filter({ hasText: visit }).count(), 'the visit once').toBe(1)
    await device.selectEncounter(visit)
    await device.openTab(CLINICAL.tabs.notes)
    for (const title of notes) expect(await device.rowsWith(title), `"${title}" once`).toBe(1)
    await card.snap(device, 'all applied')
  })
})
