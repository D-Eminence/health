import type * as ApiModuleNs from '../../api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { HidApiError } from '@hid/http'
import { fakeServer, PILOT, realVault } from './offlineFixture'

type ApiModule = typeof ApiModuleNs

/**
 * Review item 1 (A12.1): a chart read answered from the device is the asked patient's own. With the real core, two
 * patients read online, then the connection drops: each gets back only its own consent, reported health and visits.
 */
const api = vi.hoisted(() => ({ consentStatus: vi.fn(), reportedHealthProfile: vi.fn(), encounters: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', name: 'test' }) }))
const { setOfflineRuntimeForTests } = await import('../runtime')
const { ehrReads, forgetDeviceCopies } = await import('../ehrReads')

const A = 'a0000000-0000-4000-8000-00000000000a'
const B = 'b0000000-0000-4000-8000-00000000000b'
const answers: Record<string, { consent: object; profile: object; visits: object }> = {
  [A]: { consent: { patientId: A, facilityId: PILOT, purpose: 'direct-care', readAllowed: true, writeAllowed: true },
    profile: { allergies: null, currentMedications: null, updatedAt: null }, visits: { items: [{ id: 'enc-a' }], nextCursor: null } },
  [B]: { consent: { patientId: B, facilityId: PILOT, purpose: 'direct-care', readAllowed: true, writeAllowed: false },
    profile: { allergies: 'Penicillin (anaphylaxis)', currentMedications: 'Metformin', updatedAt: '2026-10-29T08:00:00.000Z' },
    visits: { items: [{ id: 'enc-b' }], nextCursor: null } },
}

beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  api.consentStatus.mockReset().mockImplementation(async (_f: string, p: string) => answers[p]!.consent)
  api.reportedHealthProfile.mockReset().mockImplementation(async (_f: string, p: string) => answers[p]!.profile)
  api.encounters.mockReset().mockImplementation(async (_f: string, p: string) => answers[p]!.visits)
})
afterEach(() => { setOfflineRuntimeForTests(undefined); forgetDeviceCopies(); vi.unstubAllGlobals() })

describe('offline chart reads are per patient (A12.1)', () => {
  it('gives each patient back only its own consent, reported health and visits', async () => {
    const runtime = await realVault(new IDBFactory(), fakeServer().transport)
    setOfflineRuntimeForTests(runtime)
    for (const patient of [A, B]) {
      await ehrReads.consentStatus(PILOT, patient)
      await ehrReads.reportedHealthProfile(PILOT, patient)
      await ehrReads.encounters(PILOT, patient, { cursor: undefined, fresh: false })
    }

    const unreachable = new HidApiError(0, 'Network error', { code: 'NETWORK_ERROR' })
    api.consentStatus.mockRejectedValue(unreachable)
    api.reportedHealthProfile.mockRejectedValue(unreachable)
    api.encounters.mockRejectedValue(unreachable)

    expect(await ehrReads.consentStatus(PILOT, A)).toEqual(answers[A]!.consent)
    expect(await ehrReads.reportedHealthProfile(PILOT, A)).toEqual(answers[A]!.profile)
    expect(await ehrReads.encounters(PILOT, A, { cursor: undefined, fresh: false })).toEqual(answers[A]!.visits)
    expect(await ehrReads.consentStatus(PILOT, B)).toEqual(answers[B]!.consent)
    expect(await ehrReads.reportedHealthProfile(PILOT, B)).toEqual(answers[B]!.profile)
    expect(await ehrReads.encounters(PILOT, B, { cursor: undefined, fresh: false })).toEqual(answers[B]!.visits)
    runtime.dispose()
  })
})
