import { describe, expect, it, vi } from 'vitest'
import { waitingListPage } from '../../../ehr-blue/departments/waiting/page'
import { areaName, areaTone } from '../../../ehr-blue/home/BlueHome'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

/** A Home shortcut names and colours its page's area as the sidebar files it. */
describe('Home shortcut areas', () => {
  it('files the Waiting list under Front desk, as the sidebar does, not under Care', () => {
    expect(areaName(waitingListPage)).toBe('Front desk')
    expect(areaTone(waitingListPage)).toBe(areaTone({ path: 'patients', group: 'Clinical' }))
    expect(areaTone(waitingListPage)).not.toBe(areaTone({ path: 'triage', group: 'Clinical' }))
  })
})
