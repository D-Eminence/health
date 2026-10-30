import { test, killSwitchObservation } from '../support/devices'

/**
 * T17 (A8.5), observe only: the coordinator releases a config with offline mode "off" (the kill switch) while changes
 * wait on the device. On the next online load the readable copy and the shell caches are wiped, the vault opens
 * send-only, the waiting changes are still sent, and the vault is deleted once its outbox is empty. The card never
 * changes config or deploys anything (killSwitchObservation in support/devices.ts).
 *
 * Its own invocation, started before the release (HID_E2E_RELEASE_CARD=T17).
 */
test('T17 kill switch released while changes wait: caches and shell caches wiped, waiting changes still sent', async ({ kit, ehrA: device, card }) => {
  test.setTimeout(6 * 3_600_000)
  await killSwitchObservation(device, card, kit.env.runId, 'kill switch')
})
