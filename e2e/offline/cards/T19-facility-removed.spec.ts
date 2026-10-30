import { test, killSwitchObservation } from '../support/devices'

/**
 * T19 (A8.5), observe only: the coordinator releases a config without Demo Hospital in the pilot list while changes
 * wait on the device; it is treated as the kill switch for that facility (the same observation as T17). The card
 * never changes config or deploys anything.
 *
 * Its own invocation, started before the release (HID_E2E_RELEASE_CARD=T19).
 */
test('T19 Demo Hospital removed from the pilot list: treated as the kill switch for that facility', async ({ kit, ehrA: device, card }) => {
  test.setTimeout(6 * 3_600_000)
  await killSwitchObservation(device, card, kit.env.runId, 'removal of Demo Hospital from the pilot list')
})
