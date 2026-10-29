import { HID_ENDPOINTS } from '@hid/contracts'
import { describe, expect, it } from 'vitest'
import { OFFLINE_PATHS } from '../../../../../packages/offline/src/contracts'

/**
 * The four offline-first routes (docs/OFFLINE-CONTRACT.md 2.10) are in the contracts registry, which the staff client
 * (createRegisteredBrowserClient) requires, exactly as the frozen contract names them, and still proposed.
 */
describe('offline-first routes in the contracts registry', () => {
  it.each([
    ['ehr.offlinePing', OFFLINE_PATHS.ping, 'GET', 'public'],
    ['ehr.offlineReceipts', OFFLINE_PATHS.receipts, 'POST', 'authenticated'],
    ['ehr.offlineAuditEvents', OFFLINE_PATHS.audit, 'POST', 'authenticated'],
    ['ehr.offlineEscrowKey', OFFLINE_PATHS.escrow, 'POST', 'authenticated'],
  ])('%s is %s, %s, %s, proposed', (name, path, method, auth) => {
    const entry = HID_ENDPOINTS.find(descriptor => descriptor.name === name)
    expect(entry).toMatchObject({ path, service: 'ehr', methods: [method], auth: { kind: auth }, status: 'proposed' })
    // Any of ehr.encounter.read or ehr.document.write: the registry's permissions are all-of, so none is listed.
    expect(entry?.permissions).toBeUndefined()
  })
})
