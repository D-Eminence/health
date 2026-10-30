import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { OFFLINE } from '../support/selectors'

/**
 * T14: a note whose body would be over 8 KB (8000 bytes, the edge limit) is refused at save with the split message,
 * and nothing is sent. Online, so the absence of a request proves the refusal happened on the device.
 */
test('T14 a note over 8 KB is refused at save with the split message', async ({ ehrA: device, card }) => {
  test.setTimeout(20 * 60_000)

  await card.step('Online: keep Demo Patient One and start a visit', async () => {
    await device.keepPatientOffline(DEMO.patients.one, DEMO.patientNames.one)
    await device.startEncounter(card.text('visit'))
  })
  const since = device.guard.requests.length

  await card.step('Save a 9 KB note: refused with "split it"', async () => {
    const content = `${card.text('oversized fictional note')} ${'x'.repeat(9000)}`
    await device.addNote({ title: card.text('oversized note'), content, waitFor: '' })
    await expect(device.page.getByText(OFFLINE.tooLong).first()).toBeVisible({ timeout: 30_000 })
    await card.snap(device, 'too long to save')
  })

  await card.step('Nothing was sent or kept', async () => {
    const sent = device.guard.requestsSince(since).filter(request => request.method === 'POST' && /\/clinical-notes$/.test(request.path))
    expect(sent, 'a note request left the device').toEqual([])
    expect(await device.pendingCount(), 'nothing waits to be sent').toBe(0)
  })
})
