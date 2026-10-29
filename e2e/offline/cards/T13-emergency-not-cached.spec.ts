import { test, expect } from '../support/devices'
import { DEMO } from '../support/guard'
import { describeReport, plaintextScan } from '../support/storage'

/**
 * T13 (D5): emergency (break-glass) records are never written to the device. Emergency access is used for a demo
 * patient with no login (the guard refuses it for any other), and the storage report and scan show nothing new.
 */
test('T13 emergency access: nothing is cached on the device', async ({ ehrA: device, card }) => {
  test.setTimeout(20 * 60_000)
  const hid = DEMO.noLogin[0]

  await device.ready({ offline: true })
  const before = await card.step('The storage report before', async () => {
    const report = await device.storage()
    card.note(`Before: ${describeReport(report)}`)
    return report
  })

  await card.step(`Emergency access for ${hid} (a demo patient without a login)`, async () => {
    await device.emergencyAccess(hid, card.text('emergency access test, fictional reason'))
    await card.snap(device, 'emergency summary')
  })

  await card.step('Nothing new on the device', async () => {
    const after = await device.storage()
    card.note(`After: ${describeReport(after)}`)
    expect(after.database.stores.cache ?? 0, 'no new cache entry').toBe(before.database.stores.cache ?? 0)
    const scan = await plaintextScan(device.page, [hid])
    expect(scan.matches, 'the emergency patient\'s Health ID on the device').toEqual({})
  })
})
