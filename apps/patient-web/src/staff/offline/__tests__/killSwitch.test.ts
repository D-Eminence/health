import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createOfflineRuntime, DB_NAME, TransportError, type Json, type OfflineEnv, type SendSpec } from '@hid/offline'
import { PASSWORD, PILOT, readyFor, snapshotOf } from './offlineFixture'

/**
 * The kill switch in an `off` build (§2.3, A8.5, A11.1), with the real core on an in-memory IndexedDB: the staff app
 * makes the runtime only when this origin already keeps an offline database, and that runtime sends what is pending
 * after the next sign-in, then deletes the vault. With no database, no runtime is made and IndexedDB is never opened.
 */
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', name: 'test' }) }))
const { resolveOfflineRuntime, setOfflineRuntimeDepsForTests, setOfflineRuntimeForTests } = await import('../runtime')
const { setOfflineEnvironmentForTests } = await import('../environment')
const { attachOnlineSession } = await import('../session')
const { STAFF_OFFLINE_REGISTRY } = await import('../registry')

const PATIENT = 'b1000000-0000-4000-8000-00000000a7c3'
const staffSession = {
  actor: { kind: 'staff' as const, id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: [], permissions: [],
    facilities: [{ id: PILOT, membershipId: `member-${PILOT}`, organizationId: 'org-1', name: 'Demo Hospital', roles: [], permissions: [], isPrimary: true }],
    facility: { id: PILOT, membershipId: `member-${PILOT}`, organizationId: 'org-1', name: 'Demo Hospital', roles: [], permissions: [], isPrimary: true } },
}

/** A stand-in for ehr-api: notes are created; everything else answers 200. */
function server() {
  const sent: SendSpec[] = []
  const state = { offline: false }
  const transport = async (spec: SendSpec) => {
    if (state.offline) throw new TransportError({ status: null, networkError: true })
    sent.push(spec)
    if (spec.path.endsWith('/clinical-notes')) return { status: 201, body: { id: 'note-1', rowVersion: 1 }, date: null }
    return { status: 200, body: {}, date: null }
  }
  return { sent, state, transport }
}

function runtimeOn(idb: IDBFactory, transport: ReturnType<typeof server>['transport'], env: OfflineEnv, appHost = 'ehr') {
  const runtime = createOfflineRuntime({ appHost, env, transport, idbFactory: idb, calibrate: async () => 1000, timers: false,
    BroadcastChannel: null, locks: null, storage: null })
  runtime.commands.register(STAFF_OFFLINE_REGISTRY)
  return runtime
}

afterEach(() => {
  setOfflineRuntimeDepsForTests(null)
  setOfflineRuntimeForTests(undefined)
  setOfflineEnvironmentForTests(null)
  vi.unstubAllGlobals()
})

describe('kill switch in an off build (A11.1)', () => {
  it('with an offline database holding a queued change: makes the runtime, sends the change after sign-in, then deletes the vault', async () => {
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
    const idb = new IDBFactory()
    const api = server()
    // Earlier, in the pilot: a note saved on this device while Health ID could not be reached.
    const pilot = runtimeOn(idb, api.transport, { mode: 'pilot', facilities: PILOT, hosts: 'ehr,ocr' })
    pilot.prepareFromSignIn('ada@example.test', PASSWORD)
    await pilot.attachSession(snapshotOf(PILOT, staffSession), { optIn: true, online: true })
    api.state.offline = true
    await pilot.commands.save('ehr.note.create', { facilityId: PILOT, patientId: PATIENT, encounter: { server: 'enc-1' },
      body: { noteType: 'Consultation', title: 'Ward round', status: 'draft', content: 'Stable' } } as unknown as Json, { awaitMs: 0 })
    await pilot.settle()
    pilot.dispose()
    api.state.offline = false
    expect(api.sent.filter(spec => spec.path.endsWith('/clinical-notes'))).toEqual([])

    // Now a release with offline off, on the EHR host.
    setOfflineEnvironmentForTests({ mode: 'off', hosts: [], appHost: 'ehr' })
    const create = vi.fn((o: { appHost: string; env: OfflineEnv }) => runtimeOn(idb, api.transport, o.env, o.appHost))
    setOfflineRuntimeDepsForTests({ exists: async () => ((await idb.databases()).some(item => item.name === DB_NAME)), create })
    const runtime = (await resolveOfflineRuntime()) as ReturnType<typeof runtimeOn>
    expect(runtime).not.toBeNull()
    expect(create).toHaveBeenCalledWith({ appHost: 'ehr', env: expect.objectContaining({ mode: 'off' }) })

    // The next sign-in: as SignIn and App do it.
    runtime.prepareFromSignIn('ada@example.test', PASSWORD)
    expect(await attachOnlineSession(runtime, staffSession)).toMatchObject({ result: 'none' })
    expect(runtime.policy()).toMatchObject({ enabled: false, reason: 'mode-off' })
    readyFor(runtime, staffSession.actor.id)
    await runtime.settle()
    await runtime.settle()

    const notes = api.sent.filter(spec => spec.path.endsWith('/clinical-notes'))
    expect(notes).toHaveLength(1)
    expect(notes[0]!.body).toEqual({ noteType: 'Consultation', title: 'Ward round', status: 'draft', content: 'Stable' })
    expect(await runtime.hasVaults()).toBe(false)
    runtime.dispose()
  })

  it('with no offline database: makes no runtime and never opens IndexedDB', async () => {
    setOfflineEnvironmentForTests({ mode: 'off', hosts: [], appHost: 'ehr' })
    const browserDatabase = { open: vi.fn(), deleteDatabase: vi.fn(), databases: vi.fn(async () => []), cmp: vi.fn() }
    vi.stubGlobal('indexedDB', browserDatabase)
    const create = vi.fn()
    const exists = vi.fn(async () => false)
    setOfflineRuntimeDepsForTests({ exists, create })
    expect(await resolveOfflineRuntime()).toBeNull()
    expect(exists).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(browserDatabase.open).not.toHaveBeenCalled()

    // The default check (before @hid/offline exports one) answers "none" without touching IndexedDB at all.
    setOfflineRuntimeDepsForTests({ create })
    expect(await resolveOfflineRuntime()).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(browserDatabase.open).not.toHaveBeenCalled()
    expect(browserDatabase.databases).not.toHaveBeenCalled()
  })

  it('makes no runtime on a host that is not the EHR or Migrate', async () => {
    setOfflineEnvironmentForTests({ mode: 'off', hosts: [], appHost: null })
    const exists = vi.fn(async () => true)
    const create = vi.fn()
    setOfflineRuntimeDepsForTests({ exists, create })
    expect(await resolveOfflineRuntime()).toBeNull()
    expect(exists).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
