// Round 5, items 3 and 4: the in-memory queue only ever holds the open vault's current entries.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { OfflineStore } from '../store'
import { createMemoryLocks } from '../testing'
import { PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, privateChannel, settle, signIn, until, type Fault } from './harness'

const ACCOUNT_B = { ...SESSION, accountId: 'acc-b', membershipId: 'mem-b', actorId: 'act-b', email: 'colleague@demo.example' }
const PATIENT_B = '66666666-6666-4666-8666-666666666666'
type Rt = ReturnType<typeof makeRuntime>

describe('round 5 item 3: an answer for A\'s vault never enters B\'s in-memory queue', () => {
  const faults: [string, Fault][] = [
    ['409 CONFLICT', { status: 409, code: 'CONFLICT', problem: true }],
    ['a network error', { status: null, networkError: true }],
  ]
  for (const [name, fault] of faults) {
    it(`A's note answers ${name} after the tab switched to B: B sees only its own entry`, async () => {
      const server = createServer()
      const rt = makeRuntime({ server, env: makeEnv() })
      await signIn(rt, { server })
      let release!: () => void
      server.state.gate = new Promise<void>(r => { release = r })
      await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'enc-1' }, text: 'A private note' }, { awaitMs: 0 })
      await until(() => server.calls.some(c => c.bodyText.includes('A private note')))

      rt.lock('manual')
      await signIn(rt, { server, session: ACCOUNT_B })
      rt.setSessionReady(false)
      const own = await rt.commands.save('ehr.encounter.create', { patientId: PATIENT_B, text: 'B own' }, { awaitMs: 0 })
      const ownId = (own as { commandId: string }).commandId
      // A long queue makes B's reload slow, which leaves room for A's answer to land in memory first.
      for (let i = 0; i < 150; i += 1) await rt.commands.save('ehr.encounter.create', { patientId: `b-${i}`, text: `B ${i}` }, { awaitMs: 0 })
      await until(() => rt.summary().pending === 151)
      const seen: string[] = []
      rt.subscribe(() => {
        void rt.commands.pendingFor(PATIENT).then(p => { for (const x of p) seen.push(JSON.stringify(x.input)) })
        void rt.review.list().then(l => { for (const x of l) seen.push(x.patientId) })
      })

      server.fail(fault)
      release()
      server.state.gate = null
      await settle(rt)

      expect(await rt.commands.pendingFor(PATIENT)).toEqual([])
      expect((await rt.review.list()).map(r => r.patientId)).not.toContain(PATIENT)
      expect((await rt.commands.pendingFor(PATIENT_B)).map(x => x.commandId)).toEqual([ownId])
      expect(seen.join()).not.toContain('A private note')
      expect(seen).not.toContain(PATIENT)
    })
  }
})

describe('round 5 item 4: another tab\'s change invalidates a load already in flight', () => {
  async function twoTabs() {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const locks = createMemoryLocks()
    const extra = { BroadcastChannel: privateChannel() }
    const a = makeRuntime({ server, env, idb, locks, extra })
    await signIn(a, { server })
    a.setSessionReady(false)
    const b = makeRuntime({ server, env, idb, locks, extra })
    await signIn(b, { server })
    b.setSessionReady(false)
    return { a, b }
  }

  /**
   * Hold A's outbox loads after their read. Loads whose read started before `changed()` carry the queue as it was; they
   * are released first, while loads that started after are still held, so A has no fresh load of its own to answer from.
   */
  async function holdLoads(rt: Rt) {
    const store = (await rt.storeForDiagnostics())! as OfflineStore & { read: OfflineStore['read'] }
    const original = store.read.bind(store)
    const held: { release: () => void; stale: boolean }[] = []
    let holding = true
    let after = false
    store.read = (async (stores: readonly string[], fn: never) => {
      const stale = !after
      const result = await original(stores as never, fn)
      if (holding && stores.length === 2 && stores[0] === 'outbox' && stores[1] === 'receipts') {
        await new Promise<void>(r => held.push({ release: r, stale }))
      }
      return result
    }) as OfflineStore['read']
    return {
      held: () => held.length,
      changed() { after = true },
      async releaseStale() {
        for (const h of held.filter(x => x.stale)) h.release()
        await new Promise(r => setTimeout(r, 20))
        holding = false
      },
      releaseRest() { for (const h of held.filter(x => !x.stale)) h.release() },
    }
  }

  for (const change of ['cancel', 'edit'] as const) {
    it(`B's ${change} lands while A's load is held: A then shows the current queue`, async () => {
      const { a, b } = await twoTabs()
      const x = await b.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'amoxicillin 500 mg' }, { awaitMs: 0 })
      const id = (x as { commandId: string }).commandId
      await until(async () => (await a.commands.pendingFor(PATIENT)).length === 1)

      const h = await holdLoads(a)
      // Any outbox change from B makes A reload (external()); this load reads the store before B's change.
      await b.commands.save('ehr.encounter.create', { patientId: PATIENT_B, text: 'other' }, { awaitMs: 0 })
      await until(() => h.held() >= 1)
      h.changed()
      if (change === 'cancel') await b.commands.cancel(id)
      else await b.commands.edit(id, { patientId: PATIENT, text: 'amoxicillin 250 mg' })
      await new Promise(r => setTimeout(r, 20))
      await h.releaseStale()

      const shown = await a.commands.pendingFor(PATIENT)
      h.releaseRest()
      await settle(a)
      if (change === 'cancel') expect(shown).toEqual([])
      else expect(shown.map(p => (p.input as { text: string }).text)).toEqual(['amoxicillin 250 mg'])
    })
  }
})
